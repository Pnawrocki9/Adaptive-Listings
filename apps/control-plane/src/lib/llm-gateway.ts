/**
 * LLM Gateway: Haiku tweak band, else the generation model; history in ADR-0024 [ADP-002].
 * @module apps/control-plane/src/lib/llm-gateway
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { AdaptationDirectives, ArchetypeId, TextDirective } from '@estalara/shared';
import type { PlaybookEntry } from '@estalara/shared/playbooks';
import {
  getTraitAddOns,
  renderTraitRules,
  steersByFamilialStatus,
} from '@estalara/shared/playbook-traits';
import { getGlobalGenerationModel } from '@/lib/global-config-store';
import { DAILY_SPEND_CAP_USD, getDailySpend } from '@/lib/llm-spend-counter';
// FOLLOW-1297: one price table for the adapt and description paths (ADR-0023 §3).
import { computeCost } from '@/lib/llm-pricing';
// FOLLOW-1061: the `llm_calls` INSERT moved to its own module so the `/api/adapt` route can book
// its pre-LLM segment on the SAME register instead of standing up a competing one.
import { logLlmCallAsync } from '@/lib/llm-calls-register';
import { isAuthoredSectionLabel, isNonAssertiveSlot } from '@/lib/ungrounded-directives';
import {
  slotRefusal,
  buildClaimGrounding,
  checkUnsupportedClaims,
  type ClaimViolation,
} from '@/lib/claim-containment';
import { afterResponse } from '@/lib/after-response';
import * as Sentry from '@sentry/nextjs';

// ── Types ──

export interface LlmGatewayInput {
  archetypeId: ArchetypeId;
  confidence: number;
  similarity: number;
  basePlaybook: PlaybookEntry;
  sessionContext?: {
    recentEvents?: string[];
    quizAnswers?: { purpose: string; horizon: string };
  };
  /** Listing facts + FAQ answers; non-empty → a "Listing context" block [TICKET-AGENCY-001]. */
  listingContext?: Record<string, string>;
  /** Session ID for per-session LLM cost attribution in ClickHouse [F-10]. */
  sessionId?: string;
  /** Tenant ID for per-tenant LLM cost attribution in ClickHouse [F-10]. */
  tenantId?: string;
  /** Force a DEMO_ALLOWED_MODELS model, bypassing routing [DEMO-001]. */
  forceModel?: string;
  /** Why the call returns `null`; once per null exit, never on success [FOLLOW-1056]. */
  onFallback?: (reason: NonNullable<AdaptationDirectives['fallback_reason']>) => void;
  /** Facts were requested but none arrived → `listing_context_unavailable` [FOLLOW-1120]. */
  groundingMissing?: boolean;
  /**
   * Buyer trait ids from the quiz [FOLLOW-1360]. Unknown ids are dropped; the present ones add
   * grounded prompt rules and change nothing about the checks every directive passes.
   */
  traits?: readonly string[];
}

export interface LlmGatewayOutput {
  directives: TextDirective[];
  /** Actual Anthropic model ID used (may be forceModel from DEMO MODE). */
  model: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
  latency_ms: number;
}

// ── Constants ──

const HAIKU_MODEL = 'claude-haiku-4-5' as const;

const DAILY_WARN_USD = 90;

/** Deadline for ONE judge round trip, ~2× the slowest measured [MP-013, FOLLOW-1040]. */
const JUDGE_DEADLINE_MS = 2000;

/**
 * Tweak-band judge budget: worst case across locales [FOLLOW-1178, FOLLOW-1180]. Invariant: derived
 * from the 3 playbook slots — a 4th slot must raise this in the same change.
 */
const JUDGE_CALL_BUDGET_TWEAK_BAND = 3;

/**
 * Generation-band budget: 3 slots, none exempt; equal to the tweak band by coincidence
 * [FOLLOW-1178].
 */
const JUDGE_CALL_BUDGET_GENERATION_BAND = 3;

/**
 * Judge budget for this band (same split as `generationSource`); over budget stays rejected
 * [FOLLOW-1178].
 */
function judgeCallBudget(model: string): number {
  return model === HAIKU_MODEL ? JUDGE_CALL_BUDGET_TWEAK_BAND : JUDGE_CALL_BUDGET_GENERATION_BAND;
}

/**
 * `llm_calls.source` per judge verdict, so `overrides ÷ flags` is a query [FOLLOW-1041, MP-012].
 */
const JUDGE_VERDICT_SOURCE = {
  /** Judge said grounded: the token-scan flag is overridden. */
  override: 'fact_check_judge_override',
  /** Judge said ungrounded: the token-scan flag stands. */
  flagConfirmed: 'fact_check_judge_flag_confirmed',
  /** API responded but the reply didn't parse to `{"grounded": true|false}`. */
  unavailableMalformed: 'fact_check_judge_unavailable_malformed',
  /** `JUDGE_DEADLINE_MS` expired before the API responded. */
  unavailableTimeout: 'fact_check_judge_unavailable_timeout',
  /** Any other thrown error (network, non-2xx, or an abort not caused by the deadline). */
  unavailableError: 'fact_check_judge_unavailable_error',
} as const;

/** Over-budget source cardinality cap: above it the value says `_9_or_more` [FOLLOW-1183]. */
const UNJUDGED_OVER_BUDGET_FLAG_CEILING = 9;

/** Source for flags the judge never saw; completes MP-012's partition [FOLLOW-1183, MP-014]. */
const FACT_CHECK_UNJUDGED_SOURCE = {
  /** Provenance exemption cleared the flag; no judge call [FOLLOW-1177, FOLLOW-1251]. */
  exemptAuthored: 'fact_check_unjudged_exempt_authored',
  /** Batch over the band's budget; one row per batch with the count [FOLLOW-1183]. */
  overBudget: (flagCount: number): string =>
    flagCount >= UNJUDGED_OVER_BUDGET_FLAG_CEILING
      ? `fact_check_unjudged_over_budget_flags_${String(UNJUDGED_OVER_BUDGET_FLAG_CEILING)}_or_more`
      : `fact_check_unjudged_over_budget_flags_${String(flagCount)}`,
} as const;

/** Source for ONE refused slot; unknown slot names → `other` [FOLLOW-1312]. */
function factCheckSlotRefusedSource(
  playbook: PlaybookEntry,
  slot: string,
  violation: DirectiveFactViolation | ClaimViolation | TraitViolation,
): string {
  const knownSlot = playbook.slots.some((s) => s.slot === slot) ? slot : 'other';
  return `fact_check_slot_refused_${knownSlot}_${violation}`;
}

/**
 * Generation outcome on its own `llm_calls` row; `llm_*` alone means served [FOLLOW-1056, MP-010].
 */
type GenerationOutcome =
  /** Directives survived the fact check and were returned to the caller. */
  | 'served'
  /** The model answered and was billed; the FOLLOW-457 fact check discarded the batch. */
  | 'fact_check_rejected'
  /** The model answered and was billed; the reply carried no usable directive array. */
  | 'unavailable_malformed'
  /** The call threw — network, non-2xx, abort. No usage block was ever received. */
  | 'unavailable_error';

/** The single place a generation `source` is picked [FOLLOW-1041]. */
function generationSource(model: string, outcome: GenerationOutcome): string {
  const band = model === HAIKU_MODEL ? 'llm_tweaked' : 'llm_full';
  return outcome === 'served' ? band : `${band}_${outcome}`;
}

// ── Zod schema for LLM response validation ──

/** One directive. Invariant: judge budgets derive from the slot count [FOLLOW-1178]. */
const TextDirectiveSchema = z.object({
  type: z.literal('text'),
  slot: z.string().min(1),
  value: z.string().min(1),
  archetype: z.string(),
  confidence: z.number().min(0).max(1),
});

// ── Prompt builders ──

function buildListingContextBlock(listingContext: Record<string, string>): string {
  const entries = Object.entries(listingContext);
  if (entries.length === 0) return '';
  const lines = entries.map(([k, v]) => `${k}: ${v}`).join('\n');
  return (
    `\nListing context (agency-provided):\n` +
    `${lines}\n` +
    `Use this data to fill placeholder tokens in copy (e.g., replace {yield} with the\n` +
    `value from "yield" context key). If a key is missing, omit the token rather than\n` +
    `guessing.\n`
  );
}

/**
 * Grounding rule over the checker's own sources, never the playbook (ESC-076, §E.7.0)
 * [FOLLOW-1166].
 */
const GROUNDING_RULE =
  `\nGrounding rule (enforced after generation — output that breaks it is DISCARDED and the\n` +
  `buyer is served generic template copy instead):\n` +
  `- Every number and every proper name you write must appear in the listing context above.\n` +
  `- If a figure you would like to cite is not there, rewrite the line so it is not needed.\n` +
  `- Never estimate, extrapolate or invent a yield, a price, a rating, a school, a district,\n` +
  `  a developer or a brand — not even a plausible one.\n` +
  `- Adapt EMPHASIS and FRAMING for the archetype; do not add facts.\n` +
  // Token-level rule; never spell a forbidden example — a primed token is suggested [MP-012].
  `- Copy every figure and unit EXACTLY as the context writes it, character for character.\n` +
  `  Do not reformat, convert, translate or abbreviate numbers or units.\n` +
  // The context ONLY: the checker no longer grounds on directives [FOLLOW-1166].
  `- Reuse the wording of the context. Do not coin new capitalised\n` +
  `  or hyphenated terms, and if the context is in another language, do not\n` +
  `  translate its nouns — quote them as written.\n` +
  // The base directives are still in the Haiku prompt and the model can see them, so saying
  // nothing about them leaves it to guess which half of the prompt is evidence. State it.
  `- Any directives shown above are the archetype's ANGLE, not facts about this property:\n` +
  `  templates written before this property was known. Take the emphasis they suggest; do not\n` +
  `  carry their vocabulary into your output unless the context uses it too.\n` +
  `- Use ONLY the context. You may recognise this property, its building or its area from your\n` +
  `  own knowledge — do not use that knowledge, even when you are certain it is true. A fact\n` +
  `  that is not written in the context above does not exist.\n` +
  `- Write headlines in sentence case; capitalise only proper names that the context contains.\n`;

/** The trait rules as a prompt block, or `''` so a request without traits is unchanged [FOLLOW-1360]. */
function traitRulesBlock(input: LlmGatewayInput): string {
  const block = renderTraitRules(getTraitAddOns(input.traits));
  return block === '' ? '' : `\n${block}\n`;
}

function buildHaikuPrompt(input: LlmGatewayInput): string {
  const { archetypeId, basePlaybook, sessionContext, listingContext } = input;
  const baseDirectivesJson = JSON.stringify(
    basePlaybook.slots.map((s) => ({
      type: 'text',
      slot: s.slot,
      value: s.en,
      archetype: archetypeId,
      confidence: input.confidence,
    })),
  );

  const signals = basePlaybook.signals.slice(0, 5).join(', ');
  const recentEvents = sessionContext?.recentEvents?.slice(0, 5).join(', ') ?? 'none';
  const contextBlock =
    listingContext && Object.keys(listingContext).length > 0
      ? buildListingContextBlock(listingContext)
      : '';

  return (
    `You are an AI adapting real estate listing descriptions for a specific buyer archetype.\n` +
    `Archetype: ${archetypeId} — ${basePlaybook.description}\n` +
    `Signals: ${signals}\n` +
    // Framing, not evidence [FOLLOW-1166].
    `Current directives — the archetype's existing framing (JSON): ${baseDirectivesJson}\n` +
    `Buyer's recent actions: ${recentEvents}\n` +
    contextBlock +
    GROUNDING_RULE +
    traitRulesBlock(input) +
    `\nReturn a JSON array of TextDirective objects that improve upon the current directives,\n` +
    `using the listing context above as the only source of facts.\n` +
    `Keep slot names unchanged. Output JSON only, no explanation.\n` +
    `Schema: [{"type":"text","slot":"<slot>","value":"<value>","archetype":"${archetypeId}","confidence":<float>}]`
  );
}

function buildSonnetPrompt(input: LlmGatewayInput): string {
  const { archetypeId, basePlaybook, sessionContext, listingContext } = input;
  const signals = basePlaybook.signals.slice(0, 8).join(', ');
  const recentEvents = sessionContext?.recentEvents?.slice(0, 5).join(', ') ?? 'none';
  const quizAnswers = sessionContext?.quizAnswers
    ? `purpose: ${sessionContext.quizAnswers.purpose}, horizon: ${sessionContext.quizAnswers.horizon}`
    : 'not provided';
  const contextBlock =
    listingContext && Object.keys(listingContext).length > 0
      ? buildListingContextBlock(listingContext)
      : '';

  return (
    `You are an AI generating real estate listing adaptations for a specific buyer archetype.\n` +
    `Archetype: ${archetypeId} — ${basePlaybook.description}\n` +
    `Signals that define this archetype: ${signals}\n` +
    // Invariant: JUDGE_CALL_BUDGET_GENERATION_BAND derives from this list [FOLLOW-1178].
    `Available slots: headline, cta, feature\n` +
    `Buyer's recent actions: ${recentEvents}\n` +
    `Quiz answers: ${quizAnswers}\n` +
    contextBlock +
    GROUNDING_RULE +
    traitRulesBlock(input) +
    `\nGenerate 2-3 TextDirective objects that would resonate with this buyer.\n` +
    `Output JSON only.\n` +
    `Schema: [{"type":"text","slot":"<slot>","value":"<value>","archetype":"${archetypeId}","confidence":<float>}]`
  );
}

// ── Parse and validate LLM response ──

function parseDirectivesFromResponse(
  text: string,
  archetypeId: ArchetypeId,
): TextDirective[] | null {
  try {
    // Extract JSON array from response (model may include surrounding text)
    const match = /\[[\s\S]*\]/.exec(text);
    if (!match) return null;

    const parsed: unknown = JSON.parse(match[0]);
    if (!Array.isArray(parsed)) return null;

    const result: TextDirective[] = [];
    for (const item of parsed) {
      const validated = TextDirectiveSchema.safeParse(item);
      if (validated.success) {
        result.push({
          ...validated.data,
          archetype: archetypeId,
        });
      }
    }

    return result.length > 0 ? result : null;
  } catch {
    return null;
  }
}

// Fact whitelist: listing facts + session events only, never playbook copy (ESC-076) [FOLLOW-457].

const FACT_CHECK_STOP_CAPS: ReadonlySet<string> = new Set([
  // Articles, prepositions, conjunctions
  'A',
  'An',
  'The',
  'In',
  'On',
  'At',
  'Of',
  'For',
  'To',
  'And',
  'Or',
  'But',
  'With',
  'From',
  'By',
  'As',
  'Its',
  'Is',
  'Are',
  'Was',
  'Be',
  'Has',
  'Have',
  'This',
  'That',
  'These',
  'Those',
  'Your',
  'Our',
  'Their',
  // Common real-estate descriptive adjectives / openers (not proper names)
  'Ideal',
  'Prime',
  'Strong',
  'Stunning',
  'Spacious',
  'Modern',
  'Elegant',
  'Bright',
  'Charming',
  'Impressive',
  'Exceptional',
  'Superb',
  'Excellent',
  'Beautiful',
  'Luxury',
  'Luxurious',
  'Attractive',
  'Unique',
  'Rare',
  'Perfect',
  'Classic',
  'Contemporary',
  'Traditional',
  'Cosy',
  'Cozy',
  'Quiet',
  'Peaceful',
  'Vibrant',
  'Sought',
  'Desirable',
  'Prestigious',
  'Newly',
  'Well',
  'Fully',
  'Tastefully',
  'Beautifully',
  'Recently',
  'Lovingly',
  'Generously',
  'Conveniently',
  // Archetype framing words that open adapted directives
  'Investor',
  'Family',
  'Investment',
  'Lifestyle',
  'Portfolio',
  'Request',
  // Words that never assert a fact; consulted before the judge, so keep them [FOLLOW-1042].
  'Get',
  'Book',
  'Discover',
  'Explore',
  'View',
  'Learn',
  'Analyze',
  'Analyse',
  'Maximize',
  'Maximise',
  'Secure',
  'Unlock',
  'Compare',
  'Schedule',
  'Contact',
  'Start',
  'Own',
  'Plan',
  'Calculate',
  'Property',
  'Home',
  'Apartment',
  'House',
  'Studio',
  'Returns',
  'Opportunity',
  'Potential',
  'Character',
  'Piece',
  'Rural',
]);

/** Digit sequences: numbers, prices, percentages, areas (m²/sqft), dates, etc. */
const FACT_CHECK_DIGIT_RE = /\d[\d.,/%m²sqft-]*/g;

type DirectiveFactViolation = 'hallucinated_number' | 'hallucinated_proper_name';

/** Familial-status steering, refused on every request [FOLLOW-1360, ESC-086]. */
type TraitViolation = 'familial_steering';

function escapeRegExpToken(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Grounding text a directive value must trace to. */
function buildDirectiveGroundingText(input: LlmGatewayInput): string {
  const { listingContext, sessionContext } = input;
  // Listing facts + the buyer's own events; templates are not evidence (ESC-076) [FOLLOW-1162].
  const parts = [
    listingContext ? JSON.stringify(listingContext) : '',
    sessionContext?.recentEvents?.join(' ') ?? '',
  ];
  return parts.join(' ').toLowerCase();
}

/**
 * Fact check for one directive value: canonical digits, then capitalised words [FOLLOW-457].
 * @returns A violation reason code, or null when the value is fully grounded.
 */
/** Canonical digits of a token: compare facts, not typography [ESC-063]. */
function canonNumber(token: string): string {
  return token.replace(/[^0-9.]/g, '').replace(/^\.+|\.+$/g, '');
}

/** Case-folded one-suffix English stem, applied to both sides [FOLLOW-1042]. */
function stemLoose(word: string): string {
  const w = word.toLowerCase();
  for (const suffix of ['ing', 'ed', 'es', 's', 'e']) {
    if (w.length > suffix.length + 2 && w.endsWith(suffix)) {
      return w.slice(0, -suffix.length);
    }
  }
  return w;
}

/**
 * Is the value this archetype's own authored copy? Exact, English-only, fail-closed [FOLLOW-1176].
 * @param playbook - The archetype's playbook entry, as handed to this request.
 * @param slot - The directive's slot name.
 * @param value - The directive's value, as the model returned it.
 * @returns `true` when the value is this archetype's shipped copy for that slot.
 */
function isTemplateAuthoredValue(playbook: PlaybookEntry, slot: string, value: string): boolean {
  const normalise = (s: string): string => s.trim().toLowerCase();
  const candidate = normalise(value);
  return playbook.slots
    .filter((s) => s.slot === slot)
    .flatMap((s) => [s.en, ...(s.variants?.en ?? [])])
    .some((authored) => normalise(authored) === candidate);
}

function checkDirectiveFacts(value: string, grounding: string): DirectiveFactViolation | null {
  // Same regex both sides: "5" never matches inside "425000" [FOLLOW-457].
  const groundingNumbers = new Set(
    Array.from(grounding.matchAll(FACT_CHECK_DIGIT_RE), (m) => canonNumber(m[0])),
  );
  for (const match of value.matchAll(FACT_CHECK_DIGIT_RE)) {
    const canon = canonNumber(match[0]);
    if (canon !== '' && !groundingNumbers.has(canon)) {
      return 'hallucinated_number';
    }
  }

  // Unicode word class: accented words enter whole [FOLLOW-1042].
  const groundingStems = new Set(grounding.split(/[^\p{L}\p{N}-]+/u).map(stemLoose));
  // Segment-initial capitals carry no proper-name signal [MP-012].
  let segmentInitial = true;
  for (const word of value.split(/\s+/)) {
    const startsSegment = segmentInitial;
    segmentInitial = /[|:;•—.!?]$/.test(word) || /^[|•—]$/.test(word);
    const clean = word.replace(/["'.,;:!?)]+$/, '');
    // `\p{Lu}`, not `[A-Z]`, so accented capitals are checked [FOLLOW-1054].
    if (
      startsSegment ||
      clean.length < 2 ||
      !/^\p{Lu}/u.test(clean) ||
      FACT_CHECK_STOP_CAPS.has(clean)
    ) {
      continue;
    }
    // Unicode lookarounds, not `\b`: no match inside accented words [FOLLOW-1042].
    const boundary = new RegExp(
      `(?<![\\p{L}\\p{N}])${escapeRegExpToken(clean)}(?![\\p{L}\\p{N}])`,
      'iu',
    );
    if (!boundary.test(grounding) && !groundingStems.has(stemLoose(clean))) {
      return 'hallucinated_proper_name';
    }
  }

  return null;
}

/**
 * Judge a proper-name flag; any failure → 'unavailable', rejection stands [FOLLOW-1034].
 * @returns 'grounded' | 'ungrounded' | 'unavailable'
 */
async function judgeNameGrounding(
  client: Anthropic,
  value: string,
  grounding: string,
  input: LlmGatewayInput,
): Promise<'grounded' | 'ungrounded' | 'unavailable'> {
  const prompt =
    `You are a strict grounding auditor for real-estate marketing copy.\n\n` +
    `CONTEXT — the only source of truth:\n<<<\n${grounding}\n>>>\n\n` +
    `COPY under audit:\n<<<\n${value}\n>>>\n\n` +
    `The copy was flagged because it contains a capitalised word absent from the context.\n` +
    `Decide whether the copy asserts any SPECIFIC fact the context does not support:\n` +
    `- a proper name (place, building, school, brand, person) the context never mentions;\n` +
    `- a named amenity, feature or nearby attraction the context never mentions;\n` +
    `- a usage or status claim (rental type, tenancy, certification) absent from the context.\n` +
    `Generic marketing vocabulary, translations or rephrasings of facts that ARE in the\n` +
    `context, and pure style words are NOT violations. Real-world knowledge you may have\n` +
    `about this property does not count as support — only the context above does.\n\n` +
    `Answer with ONLY this JSON, nothing else:\n` +
    `{"grounded": true} or {"grounded": false}`;

  // This race bounds the total; the abort stops spend [FOLLOW-1040].
  const controller = new AbortController();
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  // Only place a timeout is distinguishable; object for eslint [FOLLOW-1041].
  const deadlineState = { exceeded: false };
  const deadline = new Promise<never>((_resolve, reject) => {
    deadlineTimer = setTimeout(() => {
      deadlineState.exceeded = true;
      controller.abort();
      reject(new Error(`deadline exceeded after ${String(JUDGE_DEADLINE_MS)}ms`));
    }, JUDGE_DEADLINE_MS);
  });

  const startedAt = Date.now();

  // One logging point for every judge outcome [FOLLOW-1041].
  const logVerdict = (source: string, tokensIn: number, tokensOut: number, latencyMs: number) => {
    afterResponse(() =>
      logLlmCallAsync({
        sessionId: input.sessionId ?? 'unknown',
        tenantId: input.tenantId ?? 'unknown',
        archetypeId: input.archetypeId,
        model: HAIKU_MODEL,
        tokensIn,
        tokensOut,
        costUsd: computeCost(HAIKU_MODEL, tokensIn, tokensOut),
        latencyMs,
        source,
      }),
    );
  };

  try {
    const response = await Promise.race([
      client.messages.create(
        {
          model: HAIKU_MODEL,
          max_tokens: 50,
          messages: [{ role: 'user', content: prompt }],
        },
        { signal: controller.signal },
      ),
      deadline,
    ]);
    const latencyMs = Date.now() - startedAt;
    const tokensIn = response.usage.input_tokens;
    const tokensOut = response.usage.output_tokens;

    const block = response.content[0];
    const text = block?.type === 'text' ? block.text : '';
    const match = /\{[^{}]*"grounded"[^{}]*\}/.exec(text);
    // Unparseable reply = `_unavailable_malformed`, real tokens [FOLLOW-1049].
    let parsed: unknown = null;
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {
        parsed = null;
      }
    }
    const grounded =
      typeof parsed === 'object' && parsed !== null
        ? (parsed as Record<string, unknown>).grounded
        : undefined;

    // Judge rows carry their own source and verdict [FOLLOW-1041].
    if (grounded === true) {
      logVerdict(JUDGE_VERDICT_SOURCE.override, tokensIn, tokensOut, latencyMs);
      return 'grounded';
    }
    if (grounded === false) {
      logVerdict(JUDGE_VERDICT_SOURCE.flagConfirmed, tokensIn, tokensOut, latencyMs);
      return 'ungrounded';
    }
    logVerdict(JUDGE_VERDICT_SOURCE.unavailableMalformed, tokensIn, tokensOut, latencyMs);
    return 'unavailable';
  } catch (err) {
    console.warn(
      '[llm-gateway] fact-check judge unavailable (failing closed):',
      err instanceof Error ? err.message : err,
    );
    // Timeout vs error split; `0, 0` means UNKNOWN [FOLLOW-1041, FOLLOW-1049].
    logVerdict(
      deadlineState.exceeded
        ? JUDGE_VERDICT_SOURCE.unavailableTimeout
        : JUDGE_VERDICT_SOURCE.unavailableError,
      0,
      0,
      Date.now() - startedAt,
    );
    return 'unavailable';
  } finally {
    clearTimeout(deadlineTimer);
  }
}

// ── Main gateway function ──

let _client: Anthropic | null = null;
let _startupWarningLogged = false;

function getClient(): Anthropic | null {
  if (_client) return _client;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    if (!_startupWarningLogged) {
      console.warn(
        '[llm-gateway] ANTHROPIC_API_KEY not set — LLM gateway disabled. Fallback to playbook.',
      );
      _startupWarningLogged = true;
    }
    return null;
  }

  _client = new Anthropic({ apiKey });
  return _client;
}

/**
 * Generate or tweak directives; null on any failure, reason via `input.onFallback` [FOLLOW-1056].
 */
export async function callLlmGateway(input: LlmGatewayInput): Promise<LlmGatewayOutput | null> {
  // Every null exit reports its reason here [FOLLOW-1056].
  const fallback = (
    reason: NonNullable<AdaptationDirectives['fallback_reason']>,
  ): LlmGatewayOutput | null => {
    // An ungroundable prompt is not an LLM outage [FOLLOW-1120, MP-017].
    const effective =
      reason === 'llm_unavailable' && input.groundingMissing === true
        ? 'listing_context_unavailable'
        : reason;
    input.onFallback?.(effective);
    return null;
  };

  const client = getClient();
  if (!client) return fallback('llm_unavailable');

  const { confidence, similarity } = input;

  // Model: forceModel, then Haiku on the tweak band, then the admin model [FOLLOW-161].
  let model: string;
  if (input.forceModel) {
    // DEMO MODE takes absolute precedence (DEMO-001).
    model = input.forceModel;
  } else if (similarity > 0.6 && similarity <= 0.85) {
    // Low-latency Haiku tweak path — stays Haiku, not selectable.
    model = HAIKU_MODEL;
  } else {
    // Returns the default when the config DB is down [FOLLOW-161].
    model = await getGlobalGenerationModel();
  }

  // Circuit breaker: today's spend, one O(1) Upstash read (FOLLOW-1290; fail-open)
  const currentSpend = await getDailySpend();

  if (currentSpend >= DAILY_SPEND_CAP_USD) {
    console.warn(
      `[llm-gateway] Daily spend cap reached ($${currentSpend.toFixed(2)} >= $${DAILY_SPEND_CAP_USD.toFixed(0)}). Returning null.`,
    );
    // No call, no row; mirrors the route's `source` on this path.
    return fallback('llm_unavailable');
  }

  if (currentSpend >= DAILY_WARN_USD) {
    console.warn(
      `[llm-gateway] Daily spend approaching cap: $${currentSpend.toFixed(2)} / $${DAILY_SPEND_CAP_USD.toFixed(0)}`,
    );
  }

  // Build prompt — use haiku-style for haiku, sonnet-style for all others.
  const prompt = model === HAIKU_MODEL ? buildHaikuPrompt(input) : buildSonnetPrompt(input);

  const startMs = Date.now();

  try {
    const message = await client.messages.create({
      // Pass model string directly. For DEMO MODE forceModel this is e.g.
      // 'claude-opus-4-8' or 'claude-haiku-4-5-20251001'.
      model,
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    });

    const latencyMs = Date.now() - startMs;
    const tokensIn = message.usage.input_tokens;
    const tokensOut = message.usage.output_tokens;
    const costUsd = computeCost(model, tokensIn, tokensOut);

    // One logging point for every outcome below [FOLLOW-1056].
    const logGeneration = (outcome: GenerationOutcome) => {
      afterResponse(() =>
        logLlmCallAsync({
          sessionId: input.sessionId ?? 'unknown',
          tenantId: input.tenantId ?? 'unknown',
          archetypeId: input.archetypeId,
          model,
          tokensIn,
          tokensOut,
          costUsd,
          latencyMs,
          source: generationSource(model, outcome),
        }),
      );
    };

    /** Zero-cost row: these zeros are measured, not unknown [FOLLOW-1183, FOLLOW-1312]. */
    const logFreeRow = (source: string) => {
      afterResponse(() =>
        logLlmCallAsync({
          sessionId: input.sessionId ?? 'unknown',
          tenantId: input.tenantId ?? 'unknown',
          archetypeId: input.archetypeId,
          model,
          tokensIn: 0,
          tokensOut: 0,
          costUsd: 0,
          latencyMs: 0,
          source,
        }),
      );
    };

    // Extract text from response
    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock) {
      console.warn('[llm-gateway] No text block in Anthropic response');
      // Billed and unusable: tokens are real here [FOLLOW-1049].
      logGeneration('unavailable_malformed');
      return fallback('llm_unavailable');
    }

    const responseText = 'text' in textBlock ? textBlock.text : null;
    if (!responseText) {
      console.warn('[llm-gateway] No text content in Anthropic response block');
      logGeneration('unavailable_malformed');
      return fallback('llm_unavailable');
    }

    const directives = parseDirectivesFromResponse(responseText, input.archetypeId);
    if (!directives) {
      console.warn('[llm-gateway] Failed to parse directives from LLM response');
      logGeneration('unavailable_malformed');
      return fallback('llm_unavailable');
    }

    // Refuse ungrounded slots, serve the rest; numbers final, names judged [FOLLOW-1034,
    // FOLLOW-1312].
    const grounding = buildDirectiveGroundingText(input);

    // Deterministic scan first; exemptions by PROVENANCE only; numbers/claims never exempt
    // [FOLLOW-1176, FOLLOW-1305].
    const claimGrounding = buildClaimGrounding(input.listingContext);
    // Familial-status steering is refused on EVERY request, trait or not; the seller's wording is
    // no licence (fair-housing exposure, ESC-086) [FOLLOW-1360].
    const scanned = directives.map((directive) => {
      const factViolation = checkDirectiveFacts(directive.value, grounding);
      const claimViolation: ClaimViolation | null =
        factViolation === 'hallucinated_number'
          ? null
          : checkUnsupportedClaims(directive.value, claimGrounding);
      const exempt =
        claimViolation === null &&
        factViolation === 'hallucinated_proper_name' &&
        ((isNonAssertiveSlot(directive.slot) &&
          isTemplateAuthoredValue(input.basePlaybook, directive.slot, directive.value)) ||
          isAuthoredSectionLabel(input.basePlaybook, directive.slot, directive.value));
      const steering: TraitViolation | null = steersByFamilialStatus(directive.value)
        ? 'familial_steering'
        : null;
      const violation: DirectiveFactViolation | ClaimViolation | TraitViolation | null =
        steering ??
        (factViolation === 'hallucinated_number'
          ? factViolation
          : (claimViolation ?? (exempt ? null : factViolation)));
      return { directive, violation, exempt };
    });

    // One refusal path per refused slot [FOLLOW-1312].
    const refuseSlot = (
      directive: TextDirective,
      violation: DirectiveFactViolation | ClaimViolation | TraitViolation,
    ): void => {
      const msg =
        `[llm-gateway] directive fact-check violation: ${violation} ` +
        `archetype=${input.archetypeId} slot=${directive.slot} value=${JSON.stringify(directive.value)}`;
      console.warn(msg);
      Sentry.captureMessage(msg, {
        level: 'warning',
        tags: { area: 'adapt', kind: 'directive_fact_check_violation', violation },
        extra: { archetypeId: input.archetypeId, slot: directive.slot, model },
      });
      logFreeRow(factCheckSlotRefusedSource(input.basePlaybook, directive.slot, violation));
    };

    // An exemption books a row, only where the scan flagged [FOLLOW-1177].
    for (const { exempt } of scanned) {
      if (exempt) logFreeRow(FACT_CHECK_UNJUDGED_SOURCE.exemptAuthored);
    }

    // Over budget: flagged slots refused unjudged, others served [FOLLOW-1178, FOLLOW-1312].
    const judgeBudget = judgeCallBudget(model);
    const flaggedSlots = scanned
      .filter((s) => s.violation === 'hallucinated_proper_name')
      .map((s) => s.directive.slot);
    const overJudgeBudget = flaggedSlots.length > judgeBudget;
    if (overJudgeBudget) {
      // Not a silent skip — this line says why, names the band (Rule AV) and names every slot
      // that goes unadjudicated (each is also named by its own violation line below).
      console.warn(
        `[llm-gateway] judge budget exceeded — ${String(flaggedSlots.length)} ` +
          `proper-name flags (slots: ${flaggedSlots.join(', ')}) exceed the ` +
          `${String(judgeBudget)}-call budget for model=${model}; skipping adjudication, the ` +
          `flagged slots are refused unjudged and cost no round trip`,
      );
      // A row, not just a log: budget binding is a query [FOLLOW-1183].
      logFreeRow(FACT_CHECK_UNJUDGED_SOURCE.overBudget(flaggedSlots.length));
    }

    // Deterministic verdicts are final; judge the rest within budget [FOLLOW-1305, FOLLOW-1312].
    const verdicts: {
      slot: string;
      value: string;
      violation: DirectiveFactViolation | ClaimViolation | TraitViolation | null;
      directive: TextDirective;
    }[] = [];
    for (const { directive, violation: scannedViolation } of scanned) {
      let violation = scannedViolation;
      // Reaching the judge implies `flaggedSlots.length <= judgeBudget`, and at most one call
      // is made per flagged directive, so the budget cannot be exceeded here.
      if (violation === 'hallucinated_proper_name' && !overJudgeBudget) {
        const verdict = await judgeNameGrounding(client, directive.value, grounding, input);
        if (verdict === 'grounded') {
          // Debugging aid only; the override row is already written [FOLLOW-1041].
          console.info(
            `[llm-gateway] judge overrode token fact-check: slot=${directive.slot} ` +
              `value=${JSON.stringify(directive.value)}`,
          );
          violation = null;
        }
      }
      verdicts.push({ slot: directive.slot, value: directive.value, violation, directive });
    }

    // FOLLOW-1312 (CEO ruling 2026-10-11, §E.7.0 / ESC-076 amendment) — the SLOT is the unit of
    // refusal. `slotRefusal` is the one place that policy lives.
    const { served, refused } = slotRefusal(verdicts);
    for (const { directive, violation } of refused) {
      if (violation) refuseSlot(directive, violation);
    }

    if (served.length === 0) {
      // Every slot refused: own generation source [FOLLOW-1312, FOLLOW-1056].
      logGeneration('fact_check_rejected');
      return fallback('fact_check_refused');
    }

    const output: LlmGatewayOutput = {
      directives: served.map((v) => v.directive),
      model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_usd: costUsd,
      latency_ms: latencyMs,
    };

    // 'served' even with refused slots; after() keeps the write alive [FOLLOW-431, FOLLOW-1312].
    logGeneration('served');

    // Attach confidence from input confidence score
    const outputWithConfidence = {
      ...output,
      directives: output.directives.map((d) => ({ ...d, confidence })),
    };

    return outputWithConfidence;
  } catch (err) {
    console.error('[llm-gateway] Anthropic API error:', err instanceof Error ? err.message : err);

    // API-error exit writes its own row; `0, 0` = UNKNOWN [FOLLOW-1056, FOLLOW-1049].
    afterResponse(() =>
      logLlmCallAsync({
        sessionId: input.sessionId ?? 'unknown',
        tenantId: input.tenantId ?? 'unknown',
        archetypeId: input.archetypeId,
        model,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
        latencyMs: Date.now() - startMs,
        source: generationSource(model, 'unavailable_error'),
      }),
    );

    return fallback('llm_unavailable');
  }
}
