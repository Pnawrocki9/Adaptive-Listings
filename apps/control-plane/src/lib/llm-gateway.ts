/**
 * LLM Gateway — routes adaptation decisions through Claude Haiku or Sonnet.
 *
 * Routing policy (per ADP-002 spec):
 *   similarity > 0.85       → no LLM call (playbook path, not this module)
 *   0.6 < similarity ≤ 0.85 → Haiku 4.5: tweak 1-2 directives (low-latency path; stays Haiku)
 *   similarity ≤ 0.6, conf > 0.6 → global default model: full directive generation (FOLLOW-161)
 *   confidence ≤ 0.6        → no LLM call (default path, not this module)
 *
 * Model precedence for the full-generation path (similarity ≤ 0.6):
 *   1. forceModel (DEMO MODE, DEMO-001) — highest precedence, bypasses all routing.
 *   2. getGlobalGenerationModel() (FOLLOW-161) — admin-configured global default.
 *   3. SONNET_MODEL constant — static fallback when DB returns the default.
 *
 * The Haiku tweak path (0.6 < similarity ≤ 0.85) always stays Haiku regardless of
 * forceModel or the global config. It is the low-latency path and its model is not
 * user-selectable.
 *
 * Chat/intent classifier note (AC4 / FOLLOW-087):
 *   The real-time chat/intent classifier model is NOT user-selectable and stays
 *   Haiku-class. Its <500ms latency budget constrains it to a Haiku-class model.
 *   It is not wired through this gateway.
 *
 * Circuit breaker: $100/day rolling 24h spend cap via ClickHouse llm_calls table.
 * Returns null on: missing API key, cap hit, or any Anthropic API error.
 *
 * @module apps/control-plane/src/lib/llm-gateway
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { ArchetypeId, TextDirective } from '@estalara/shared';
import type { PlaybookEntry } from '@estalara/sdk/playbooks';
import { getGlobalGenerationModel } from '@/lib/global-config-store';
import { clickhouseAuthHeaders } from '@/lib/clickhouse-http';
import { afterResponse } from '@/lib/after-response';
import * as Sentry from '@sentry/nextjs';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LlmGatewayInput {
  archetypeId: ArchetypeId;
  confidence: number;
  similarity: number;
  basePlaybook: PlaybookEntry;
  sessionContext?: {
    recentEvents?: string[];
    quizAnswers?: { purpose: string; horizon: string };
  };
  /**
   * Agency-curated listing metadata, keyed by field name.
   * Populated by RAG retrieval in the adapt route (TICKET-AGENCY-001).
   * When non-empty, prompt builders append a "Listing context" block that
   * instructs the LLM to substitute placeholder tokens (e.g. `{yield}`).
   */
  listingContext?: Record<string, string>;
  /** Session ID for per-session LLM cost attribution in ClickHouse [F-10]. */
  sessionId?: string;
  /** Tenant ID for per-tenant LLM cost attribution in ClickHouse [F-10]. */
  tenantId?: string;
  /**
   * Force a specific Anthropic model ID, bypassing the similarity-based routing
   * policy. Used by DEMO MODE (DEMO-001) when the operator selects a model from
   * the admin UI. Must be one of the curated DEMO_ALLOWED_MODELS.
   * When null/undefined, the standard routing policy applies.
   */
  forceModel?: string;
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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const HAIKU_MODEL = 'claude-haiku-4-5' as const;
const SONNET_MODEL = 'claude-sonnet-4-6' as const;

/** Cost per 1K tokens in USD (approximate list pricing, adjust as needed). */
const COST_PER_1K_INPUT: Record<string, number> = {
  [HAIKU_MODEL]: 0.00025,
  [SONNET_MODEL]: 0.003,
};
const COST_PER_1K_OUTPUT: Record<string, number> = {
  [HAIKU_MODEL]: 0.00125,
  [SONNET_MODEL]: 0.015,
};

const DAILY_SPEND_CAP_USD = 100;
const DAILY_WARN_USD = 90;

/**
 * Wall-clock deadline for ONE fact-check judge round trip [FOLLOW-1040].
 *
 * Not guessed: chosen against the judge's own measured latency band in **[MP-013]**, at
 * roughly twice the slowest judge round trip in that premise's sample, which is itself far
 * below the same model's generation-call band (the judge is capped at `max_tokens: 50`, so
 * it is structurally the cheaper call).
 *
 * The asymmetry that sets the value: expiry costs a RECOVERY (the token rejection stands
 * and the caller falls back to playbook copy — the pre-#787 behaviour), while waiting costs
 * the buyer, on a path where the host anti-flicker cloak has already expired. A judge call
 * slower than this deadline is worth less than the seconds it spends.
 */
const JUDGE_DEADLINE_MS = 2000;

/**
 * Maximum judge round trips per `/adapt` request [FOLLOW-1040].
 *
 * Why 2, and not the 3 the current slot count happens to allow: the judge exists to recover
 * ISOLATED false positives from the token scan. A batch in which every slot trips the scan is
 * a systemic grounding/prompt failure ([MP-012]'s state), not three independent false
 * positives — and because one surviving violation rejects the whole batch, a third judge call
 * only changes the outcome when all three flags are false positives at once. That is the
 * least likely case and the most expensive one to pay for serially.
 *
 * Exceeding the cap does NOT skip the fact check: the remaining flags fall through to the
 * deterministic pre-judge behaviour (reject), so the cap can only make the gateway stricter.
 *
 * Worst-case judge contribution to one `/adapt` response is therefore
 * `MAX_JUDGE_CALLS_PER_REQUEST × JUDGE_DEADLINE_MS` = 4 s, independent of how many slots the
 * prompt offers. Before this cap, worst case grew with the slot count and nothing said so.
 */
const MAX_JUDGE_CALLS_PER_REQUEST = 2;

/**
 * `llm_calls.source` values for the judge's OWN ClickHouse row, one per verdict [FOLLOW-1041].
 *
 * Rule AJ, not Rule K.2 (K.2 governs the fire-and-forget `console.info` at the override call
 * site below — a producer-side obligation it already satisfied; AJ is what makes the signal
 * COUNTABLE). This widens the SAME row `judgeNameGrounding` already wrote per invocation
 * (`source: 'fact_check_judge'`, pre-#1041) rather than adding a new column — `source` is
 * `LowCardinality(String)` (`infra/clickhouse/migrations/0004_create_llm_calls.sql`), so new
 * values need no DDL. `overrides ÷ flags` is now `countIf(source = override) / count()` over
 * `source LIKE 'fact_check_judge%'` — see docs/ops/MEASURED_PREMISES.md MP-012's saved query,
 * the consumer of record.
 *
 * A cap-exceeded flag (`MAX_JUDGE_CALLS_PER_REQUEST` reached) never calls `judgeNameGrounding`
 * and so never writes a row here — a fourth outcome that must NOT count as a judge verdict.
 * Timeout and API error are indistinguishable to the CALLER by design (FOLLOW-1040: both land
 * in the same catch and return `'unavailable'`), but that split is exactly what a counter
 * needs, so it happens HERE, inside `judgeNameGrounding`'s own catch — not at the call site.
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

// ---------------------------------------------------------------------------
// Zod schema for LLM response validation
// ---------------------------------------------------------------------------

/**
 * The shape of one directive the model may return.
 *
 * SLOT COUNT → LATENCY, read this before adding a slot [FOLLOW-1040]. Every directive the
 * model returns is fact-checked individually, and a `hallucinated_proper_name` flag is
 * adjudicated by a SERIAL judge round trip (`judgeNameGrounding`). Adding a slot therefore
 * used to add a round trip to the worst case of a request a buyer is waiting on. It no
 * longer does: `MAX_JUDGE_CALLS_PER_REQUEST` bounds the judge at 2 calls per request
 * regardless of slot count. What still scales with the slot count is the GENERATION call's
 * output length — the term Track LATENCY (FOLLOW-1037/1038/1039) owns.
 */
const TextDirectiveSchema = z.object({
  type: z.literal('text'),
  slot: z.string().min(1),
  value: z.string().min(1),
  archetype: z.string(),
  confidence: z.number().min(0).max(1),
});

// ---------------------------------------------------------------------------
// Circuit breaker — ClickHouse rolling 24h spend check
// ---------------------------------------------------------------------------

async function getRolling24hSpend(): Promise<number> {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  if (!clickhouseUrl) return 0;

  const clickhouseUser = process.env.CLICKHOUSE_USER ?? 'default';
  const clickhousePassword = process.env.CLICKHOUSE_PASSWORD ?? '';
  const query = `SELECT sum(cost_usd) as total FROM llm_calls WHERE ts >= now() - INTERVAL 1 DAY FORMAT JSON`;

  try {
    const res = await fetch(clickhouseUrl, {
      method: 'POST',
      body: query,
      headers: {
        'Content-Type': 'text/plain',
        ...clickhouseAuthHeaders({ user: clickhouseUser, password: clickhousePassword }),
      },
    });

    if (!res.ok) return 0;

    const json = (await res.json()) as { data?: { total?: string }[] };
    const total = parseFloat(json.data?.[0]?.total ?? '0');
    return isNaN(total) ? 0 : total;
  } catch {
    // If we can't check, allow the call (fail open — better than blocking legitimate traffic)
    return 0;
  }
}

// ---------------------------------------------------------------------------
// ClickHouse logging
// ---------------------------------------------------------------------------

function logLlmCallAsync(params: {
  sessionId: string;
  tenantId: string;
  archetypeId: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  source: string;
}): Promise<void> {
  // Returns a promise so callers can register it via after() and guarantee
  // completion after the response is sent (FOLLOW-431 / ESC-033).
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  if (!clickhouseUrl) return Promise.resolve();

  const clickhouseUser = process.env.CLICKHOUSE_USER ?? 'default';
  const clickhousePassword = process.env.CLICKHOUSE_PASSWORD ?? '';
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');

  // FOLLOW-261 (F-30): parameterized INSERT — {name:Type} placeholders eliminate string
  // interpolation; values passed as ?param_name= URL query params (ClickHouse HTTP interface).
  const query =
    `INSERT INTO llm_calls ` +
    `(session_id, tenant_id, archetype, model, tokens_in, tokens_out, cost_usd, latency_ms, source, ts) ` +
    `VALUES ({p_session_id:String}, {p_tenant_id:String}, {p_archetype:String}, {p_model:String}, ` +
    `{p_tokens_in:UInt32}, {p_tokens_out:UInt32}, {p_cost_usd:Float64}, {p_latency_ms:UInt32}, ` +
    `{p_source:String}, {p_ts:String})`;

  const url = new URL(clickhouseUrl);
  url.searchParams.set('param_p_session_id', params.sessionId);
  url.searchParams.set('param_p_tenant_id', params.tenantId);
  url.searchParams.set('param_p_archetype', params.archetypeId);
  url.searchParams.set('param_p_model', params.model);
  url.searchParams.set('param_p_tokens_in', String(params.tokensIn));
  url.searchParams.set('param_p_tokens_out', String(params.tokensOut));
  url.searchParams.set('param_p_cost_usd', String(params.costUsd));
  url.searchParams.set('param_p_latency_ms', String(params.latencyMs));
  url.searchParams.set('param_p_source', params.source);
  url.searchParams.set('param_p_ts', ts);

  return fetch(url.toString(), {
    method: 'POST',
    body: query,
    headers: {
      'Content-Type': 'text/plain',
      ...clickhouseAuthHeaders({ user: clickhouseUser, password: clickhousePassword }),
    },
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => '<unreadable body>');
        const msg = `[llm-gateway] ClickHouse INSERT rejected: HTTP ${String(res.status)} — ${body.slice(0, 500)}`;
        console.error(msg);
        Sentry.captureException(new Error(msg), {
          tags: { area: 'adapt', sink: 'clickhouse', kind: 'insert_rejected', table: 'llm_calls' },
          extra: { status: res.status },
        });
      }
    })
    .catch((err: unknown) => {
      // Network-layer failure (DNS, connection refused, malformed URL, timeout).
      // Analytics failures must not surface to callers — log + Sentry only.
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[llm-gateway] ClickHouse log failed:', msg);
      Sentry.captureException(err instanceof Error ? err : new Error(msg), {
        tags: { area: 'adapt', sink: 'clickhouse', kind: 'network', table: 'llm_calls' },
      });
    });
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

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
 * The grounding rule that `checkDirectiveFacts` (FOLLOW-457) enforces, stated TO the model.
 *
 * FOLLOW-1022: the guardrail was enforced but never communicated, and in production every
 * generated directive was discarded for `hallucinated_number` or `hallucinated_proper_name`
 * — the measurement is registered as [MP-010]. The model was doing exactly what it was asked:
 * the base directives it is told to "improve upon" are playbook templates that DEMAND figures
 * (`"Rental Yield: {yield}% | Gross Income: {income}/yr"`), while nothing in the prompt said
 * those figures must come from the listing. Stating the rule costs a few tokens; leaving it
 * unstated cost 100% of the LLM path.
 */
const GROUNDING_RULE =
  `\nGrounding rule (enforced after generation — output that breaks it is DISCARDED and the\n` +
  `buyer is served generic template copy instead):\n` +
  `- Every number and every proper name you write must appear in the listing context above.\n` +
  `- If a figure you would like to cite is not there, rewrite the line so it is not needed.\n` +
  `- Never estimate, extrapolate or invent a yield, a price, a rating, a school, a district,\n` +
  `  a developer or a brand — not even a plausible one.\n` +
  `- Adapt EMPHASIS and FRAMING for the archetype; do not add facts.\n` +
  // FOLLOW-1034 second half (ESC-063 residue): the enforcement is a TOKEN check, so the rule
  // must state its token-level consequences or the model keeps failing it in good faith. The
  // three constraints below map one-to-one onto the three false-positive classes measured in
  // [MP-012] (abbreviation, Title-Case coinage, translation). The checker cannot see semantic
  // equivalence; the model CAN avoid needing it. Stating typography and vocabulary constraints
  // costs tokens; not stating them costs the LLM path, which was [MP-010].
  // No negative examples in the rule text: the first deploy quoted two forbidden coinages
  // verbatim and the model promptly wrote one of them into a headline — a primed token is a
  // suggested token. State the rule; never spell the counterexample. [MP-012]
  `- Copy every figure and unit EXACTLY as the context writes it, character for character.\n` +
  `  Do not reformat, convert, translate or abbreviate numbers or units.\n` +
  `- Reuse the wording of the context and the current directives. Do not coin new capitalised\n` +
  `  or hyphenated terms, and if the context is in another language, do not\n` +
  `  translate its nouns — quote them as written.\n` +
  `- Use ONLY the context. You may recognise this property, its building or its area from your\n` +
  `  own knowledge — do not use that knowledge, even when you are certain it is true. A fact\n` +
  `  that is not written in the context above does not exist.\n` +
  `- Write headlines in sentence case; capitalise only proper names that the context contains.\n`;

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
    `Current directives (JSON): ${baseDirectivesJson}\n` +
    `Buyer's recent actions: ${recentEvents}\n` +
    contextBlock +
    GROUNDING_RULE +
    `\nReturn a JSON array of TextDirective objects that improve upon the current directives.\n` +
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
    // Adding a slot to this list adds a directive to fact-check, and a flagged directive
    // costs a SERIAL judge round trip on a request the buyer is waiting on. The judge is
    // bounded (`JUDGE_DEADLINE_MS`, `MAX_JUDGE_CALLS_PER_REQUEST` — see their doc comments),
    // so a fourth slot no longer widens the worst case; it does lengthen the generation
    // call itself. Do not add one without reading [FOLLOW-1040] and [MP-013].
    `Available slots: headline, cta, feature\n` +
    `Buyer's recent actions: ${recentEvents}\n` +
    `Quiz answers: ${quizAnswers}\n` +
    contextBlock +
    GROUNDING_RULE +
    `\nGenerate 2-3 TextDirective objects that would resonate with this buyer.\n` +
    `Output JSON only.\n` +
    `Schema: [{"type":"text","slot":"<slot>","value":"<value>","archetype":"${archetypeId}","confidence":<float>}]`
  );
}

// ---------------------------------------------------------------------------
// Parse and validate LLM response
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Fact-whitelist grounding check (FOLLOW-457 AC2)
// ---------------------------------------------------------------------------
//
// The description/headline generation path already suppresses any headline
// asserting a specific number or proper name absent from its grounding
// sources (apps/llm-gateway/src/jobs/generate_description.py
// _check_headline_facts, FOLLOW-169/FOLLOW-272). This directive path
// (buildHaikuPrompt / buildSonnetPrompt) had no equivalent — an LLM-returned
// directive could assert a hallucinated price, area, or named entity and it
// would ship unchecked.
//
// Grounding sources for the directive path — there is no original_description
// here (LlmGatewayInput has none), so the whitelist is built from every
// trusted input the prompt builders already pass to the model:
//   - basePlaybook.description / signals / slots[].en — curated seed copy,
//     safe by construction (author-approved, not LLM output).
//   - listingContext — agency-provided per-listing facts (RAG retrieval).
//   - sessionContext.recentEvents — behavioural event labels.
// Any number or capitalised word in a returned directive value that cannot be
// traced to one of these is treated as a hallucination. The whole gateway
// call is failed (returns null) so the caller falls back to playbook copy —
// same fail-safe contract runDecisionTree already applies on any null return.

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
  // FOLLOW-1034 / ESC-063: generic imperatives and generic property-marketing nouns.
  // Production logs showed grounded batches dying on words like "Get" — a Title-Case
  // verb is not a proper name. This list stays bounded to words that can never assert
  // an entity or a figure; places, schools, developers and brands are still caught.
  //
  // FOLLOW-1042 AC(4), re-checked and KEPT IN FULL — nothing removed. The question was
  // whether the #787 judge tier makes these redundant. It does not, and cannot: this set
  // is consulted BEFORE a violation is raised, and the judge only ever runs AFTER one, so
  // deleting an entry does not hand the word to the judge — it converts a free pass into a
  // paid model call whose failure mode drops the whole gateway response to playbook copy.
  // Measured after the tokeniser fix, with this set emptied and each word probed
  // mid-segment through callLlmGateway against the pilot's French listing: 28 of the 30
  // (the stub says 31; there are 30) are LOAD-BEARING — they are flagged without the entry.
  // The 2 that are not ("View", "Maximize") are grounded only via THIS playbook's own
  // `signals`/`description` ("views_yield_data", "maximizing"), which differ per archetype,
  // so their redundancy is a property of one fixture and not a reason to delete them.
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

function escapeRegExpToken(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build the combined grounding text a directive value must be traceable to.
 * Mirrors the description path's (original_description + listing_context)
 * grounding pair — see the section docstring above.
 */
function buildDirectiveGroundingText(input: LlmGatewayInput): string {
  const { basePlaybook, listingContext, sessionContext } = input;
  const parts = [
    basePlaybook.description,
    basePlaybook.signals.join(' '),
    basePlaybook.slots.map((s) => s.en).join(' '),
    // FOLLOW-1034: the served copy can BE a bandit variant (FOLLOW-342), and the
    // copy_template's "preferred lexicon" is vocabulary we ORDER the model to use —
    // both are authored text, so both must ground. Before this, "Tenant in Place"
    // (verbatim variant copy) was discarded as a hallucinated proper name.
    basePlaybook.slots.flatMap((s) => s.variants?.en ?? []).join(' '),
    basePlaybook.copy_template.en,
    listingContext ? JSON.stringify(listingContext) : '',
    sessionContext?.recentEvents?.join(' ') ?? '',
  ];
  return parts.join(' ').toLowerCase();
}

/**
 * Post-generation fact check for a single directive value (FOLLOW-457 AC2).
 * Descended from generate_description.py `_check_headline_facts`
 * (FOLLOW-169/FOLLOW-272) but DIVERGED by FOLLOW-1034 / ESC-063: numbers are
 * compared by canonical digits rather than typography, and inflection of
 * grounded vocabulary is tolerated via a loose stem applied to BOTH sides. The
 * python sibling still has the pre-1034 behaviour — FOLLOW-1036 tracks the port.
 *
 * 1. Digit tokens are canonicalised (digits + decimal point) on both sides, and
 *    the grounding side is tokenised with the SAME regex before canonicalising —
 *    so a short token like "5" is still never "verified" by matching inside
 *    "425000" or "1,500": those enter the comparison set whole.
 * 2. Capitalised words (including the first word) are checked for a
 *    whole-token match in the grounding text; the stop-caps set filters
 *    generic sentence-starters so they are not falsely flagged.
 *
 * @returns A violation reason code, or null when the value is fully grounded.
 */
/**
 * Canonicalise a digit token to what it ASSERTS: digits and the decimal point.
 * "€97,200" and "97200 EUR" both canonicalise to "97200"; "158m²" and "158 m²"
 * to "158"; "6.5%" to "6.5". The check compares facts, not typography —
 * production was discarding grounded prices because the model wrote the
 * thousands separator the context did not have (ESC-063).
 */
function canonNumber(token: string): string {
  return token.replace(/[^0-9.]/g, '').replace(/^\.+|\.+$/g, '');
}

/**
 * Loose stem for grounding comparison: strips one common English suffix so
 * "Maximize" grounds against the playbook description's "maximizing".
 *
 * What is guaranteed [FOLLOW-1042]: this function is applied to both sides, and
 * it is case-folding, so the comparison is case-insensitive and one English
 * suffix deep. What is NOT guaranteed — the previous docblock claimed it, and
 * the claim is what hid the bug through three PRs — is that a value absent from
 * the grounding matches nothing. Identical STEMMING does not imply a safe
 * comparison; that depends on how each side is TOKENISED, and the grounding side
 * used to be split on `[^a-z0-9-]+`, which shredded every accented word into
 * fragments a fabricated name could match. Both sides are now tokenised on the
 * same Unicode word class (see `checkDirectiveFacts`). The residual is narrower
 * but real: this stemmer is English-only, so `pièce`/`pièces` collapse by luck
 * of a shared suffix letter while e.g. `rénover`/`rénovée` do not — a French
 * inflection can still be flagged, and the judge tier exists for that.
 */
function stemLoose(word: string): string {
  const w = word.toLowerCase();
  for (const suffix of ['ing', 'ed', 'es', 's', 'e']) {
    if (w.length > suffix.length + 2 && w.endsWith(suffix)) {
      return w.slice(0, -suffix.length);
    }
  }
  return w;
}

function checkDirectiveFacts(value: string, grounding: string): DirectiveFactViolation | null {
  // Numbers: every digit token in the value must canonicalise to a digit token
  // of the grounding. Tokenising the grounding with the SAME regex preserves the
  // FOLLOW-457 poisoned-context property: "5" is never verified by the inside of
  // "425000", because "425000" enters the set whole.
  const groundingNumbers = new Set(
    Array.from(grounding.matchAll(FACT_CHECK_DIGIT_RE), (m) => canonNumber(m[0])),
  );
  for (const match of value.matchAll(FACT_CHECK_DIGIT_RE)) {
    const canon = canonNumber(match[0]);
    if (canon !== '' && !groundingNumbers.has(canon)) {
      return 'hallucinated_number';
    }
  }

  // FOLLOW-1042: the grounding is tokenised on a UNICODE word class. The previous
  // `[^a-z0-9-]+` made every character outside lower-ASCII a delimiter, so each
  // accented grounded word entered the set as fragments — `caractère` → `caract` +
  // `re`, `propriété` → `propri` + `t` — on exactly the languages this estate serves.
  // That broke the check in both directions at once: grounded French/Spanish/Polish
  // vocabulary stopped matching its own stem (the ESC-063 false-rejection class), and
  // a fabricated name that IS a grounded name minus its accented first letter
  // (`Évian` → `Vian`) matched a fragment and passed. `\p{L}` also covers upper-case,
  // which the only in-repo caller pre-lower-cases (`buildDirectiveGroundingText`) —
  // that half changes nothing today and is deliberate: the property now belongs to
  // this function rather than to its caller, so the FOLLOW-1036 Python port inherits
  // the property and not the coupling. `-` stays a word character so hyphenated names
  // ("Saint-Dizier-les-Domaines") enter whole.
  const groundingStems = new Set(grounding.split(/[^\p{L}\p{N}-]+/u).map(stemLoose));
  // Segment/sentence-INITIAL capitals carry no proper-name signal: in "X | Y | Z" headlines
  // every segment starts capitalised, in any language — [MP-012]'s third act was a fully
  // obedient French headline dying on "Potentiel" straight after a "|". A capital is
  // name-evidence only MID-segment ("…in Santa Maria's boutique…" is still caught; so are
  // "Redland Primary" and "Beaumont Academy", whose second word is mid-segment). Residual,
  // accepted and stated: a single-word entity opening a segment is no longer catchable.
  let segmentInitial = true;
  for (const word of value.split(/\s+/)) {
    const startsSegment = segmentInitial;
    segmentInitial = /[|:;•—.!?]$/.test(word) || /^[|•—]$/.test(word);
    const clean = word.replace(/["'.,;:!?)]+$/, '');
    if (
      startsSegment ||
      clean.length < 2 ||
      !/^[A-Z]/.test(clean) ||
      FACT_CHECK_STOP_CAPS.has(clean)
    ) {
      continue;
    }
    // Exact token match first (pre-1034 behaviour), then the stemmed fallback so
    // inflection of grounded vocabulary is not read as an invented entity.
    //
    // FOLLOW-1042: the delimiters are asserted with `\p{L}\p{N}` lookarounds rather
    // than `\b`, for the same reason as the stem tokeniser above — `\b` is ASCII, so
    // `\bVian\b` MATCHED inside `évian` (the `é` reads as a word boundary) and the
    // fabricated name passed the scan. The judge cannot recover that: it only ever
    // adjudicates values the scan REJECTS. This is the only tightening in the change,
    // and it bites in exactly one case — the value is a fragment of a longer accented
    // grounded word — because every other former `\b` boundary (space, punctuation,
    // `-`, string edge) is also a non-`\p{L}\p{N}` position. `_` moves the other way
    // (it is a `\b` word character but not a letter), which loosens nothing in
    // practice: underscore-delimited fragments — the `signals` names and the
    // `listingContext` JSON keys — are already in the stem set either way.
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
 * Semantic adjudication of a `hallucinated_proper_name` flag (FOLLOW-1034 judge tier).
 *
 * The token scan is the high-recall sieve; this is the precision filter on its
 * rejections. It answers one question — does the flagged copy assert a SPECIFIC
 * fact the context does not support — with the whole context in view, which is
 * exactly what a token comparison cannot do (translations, register vocabulary,
 * segment-position capitals; the measured classes are [MP-012]).
 *
 * Authority boundary: numbers are NEVER routed here — `hallucinated_number` is a
 * deterministic reject upstream. Failure posture: any error or unparseable
 * verdict returns 'unavailable' and the caller keeps the rejection (fail closed).
 *
 * Time posture [FOLLOW-1040]: bounded by `JUDGE_DEADLINE_MS`. Expiry is not a new
 * outcome to the CALLER — it lands in the SAME catch as an API error and returns
 * 'unavailable', so a slow judge and a broken judge are indistinguishable to the caller
 * by design. Internally, this function DOES split them — see `JUDGE_VERDICT_SOURCE`.
 *
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

  // FOLLOW-1040: enforce the deadline HERE rather than delegating to the Anthropic
  // SDK's `timeout` request option. That option bounds one ATTEMPT and the SDK retries
  // by default, so it bounds no total; this race does. The AbortController is not
  // decoration — it cancels the in-flight HTTP request, so a judge call this gateway
  // has stopped waiting for also stops burning tokens.
  const controller = new AbortController();
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  // FOLLOW-1041: only the deadline timer can tell a timeout apart from any other
  // rejection of the raced promise — by the time `catch` runs below, both look like
  // an ordinary thrown error. This flag is the sole place that distinction survives.
  // An object property, not a bare `let`: a bare boolean reassigned only inside the
  // setTimeout closure below gets over-narrowed by eslint's flow analysis to its
  // initial literal, which makes the ternary in `catch` read as "always falsy".
  const deadlineState = { exceeded: false };
  const deadline = new Promise<never>((_resolve, reject) => {
    deadlineTimer = setTimeout(() => {
      deadlineState.exceeded = true;
      controller.abort();
      reject(new Error(`deadline exceeded after ${String(JUDGE_DEADLINE_MS)}ms`));
    }, JUDGE_DEADLINE_MS);
  });

  const startedAt = Date.now();

  // FOLLOW-1041: one shared logging point for every outcome this function can reach —
  // success (any verdict, including a malformed reply) and failure (timeout or error)
  // all funnel through here so `JUDGE_VERDICT_SOURCE` can never be picked in one place
  // and applied in another.
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
    // FOLLOW-1049: the regex above matches shapes `JSON.parse` rejects — a python-style
    // `True`, a trailing comma, a bare word — and all three are things a model actually
    // emits. Unguarded (as #793 shipped it) that throw escaped to the outer catch and was
    // booked as `_unavailable_error`, the NETWORK bucket, with `0, 0` tokens: two wrong
    // facts about a call the API had answered and Anthropic had billed. A reply that
    // arrives and does not parse is `_unavailable_malformed` by that constant's own
    // docblock, and its spend is real. Swallowing to `null` reaches both, because the
    // `grounded === undefined` path below already logs the malformed verdict with the
    // tokens and latency still in hand.
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

    // Spend is spend (FOLLOW-431): the judge's ClickHouse row carries its own source so
    // nobody mistakes adjudication cost for generation cost — and, as of FOLLOW-1041,
    // the verdict itself, so `overrides ÷ flags` is a query (see JUDGE_VERDICT_SOURCE).
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
    // FOLLOW-1041: the split the caller deliberately does not get (FOLLOW-1040 — both
    // land in the same 'unavailable' return) happens here instead, because this is the
    // only place `deadlineState.exceeded` is still known.
    //
    // The `0, 0` below means UNKNOWN, not zero [FOLLOW-1049]. We never received a usage
    // block on this path, so this client cannot know what was billed — and on the timeout
    // branch it probably was: `controller.abort()` closes our socket, it does not un-bill a
    // completion the provider already generated. Reading these rows as free is therefore
    // wrong in the one direction that matters to the rolling-24h $100 breaker
    // (`getRolling24hSpend`), which under-counts by exactly this amount. It is left at zero
    // rather than estimated because an invented number is worse than a known-absent one; if
    // the judge's timeout rate ever becomes material, the fix is to bound the estimate from
    // the prompt size, not to guess. Parse failures are NOT in this bucket any more — they
    // carry their real cost via the malformed branch above.
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

// ---------------------------------------------------------------------------
// Compute cost
// ---------------------------------------------------------------------------

function computeCost(model: string, tokensIn: number, tokensOut: number): number {
  const inputCost = (tokensIn / 1000) * (COST_PER_1K_INPUT[model] ?? 0.001);
  const outputCost = (tokensOut / 1000) * (COST_PER_1K_OUTPUT[model] ?? 0.005);
  return Math.round((inputCost + outputCost) * 1e6) / 1e6; // 6 decimal places
}

// ---------------------------------------------------------------------------
// Main gateway function
// ---------------------------------------------------------------------------

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
 * Call the LLM gateway to generate or tweak adaptation directives.
 *
 * Returns null on: missing API key, circuit breaker triggered ($100/day cap),
 * or any Anthropic API error.
 *
 * The caller is responsible for falling back to playbook directives on null.
 */
export async function callLlmGateway(input: LlmGatewayInput): Promise<LlmGatewayOutput | null> {
  const client = getClient();
  if (!client) return null;

  const { confidence, similarity } = input;

  // Select model using precedence chain:
  //   1. forceModel (DEMO MODE, DEMO-001) — bypasses all routing.
  //   2. Haiku (low-latency tweak path) — when 0.6 < similarity ≤ 0.85.
  //      This path is NOT affected by the global config (FOLLOW-161):
  //      it is the real-time latency-sensitive path; its model is not selectable.
  //   3. getGlobalGenerationModel() (FOLLOW-161) — admin-configured global default
  //      for the full-generation path (similarity ≤ 0.6).
  let model: string;
  if (input.forceModel) {
    // DEMO MODE takes absolute precedence (DEMO-001).
    model = input.forceModel;
  } else if (similarity > 0.6 && similarity <= 0.85) {
    // Low-latency Haiku tweak path — stays Haiku, not selectable.
    model = HAIKU_MODEL;
  } else {
    // Full-generation path — use admin-configured global default (FOLLOW-161).
    // getGlobalGenerationModel() returns the default on DB absence/error, so
    // this path never hard-fails even when config DB is unavailable.
    model = await getGlobalGenerationModel();
  }

  // Circuit breaker: check rolling 24h spend
  const currentSpend = await getRolling24hSpend();

  if (currentSpend >= DAILY_SPEND_CAP_USD) {
    console.warn(
      `[llm-gateway] Daily spend cap reached ($${currentSpend.toFixed(2)} >= $${DAILY_SPEND_CAP_USD.toFixed(0)}). Returning null.`,
    );
    return null;
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

    // Extract text from response
    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock) {
      console.warn('[llm-gateway] No text block in Anthropic response');
      return null;
    }

    const responseText = 'text' in textBlock ? textBlock.text : null;
    if (!responseText) {
      console.warn('[llm-gateway] No text content in Anthropic response block');
      return null;
    }

    const directives = parseDirectivesFromResponse(responseText, input.archetypeId);
    if (!directives) {
      console.warn('[llm-gateway] Failed to parse directives from LLM response');
      return null;
    }

    // FOLLOW-457 AC2/AC3: reject the whole batch if any directive value asserts
    // a specific fact (number, proper name) absent from the trusted grounding
    // sources. Rule K.2: log + Sentry so the suppression is observable. The cost
    // was still incurred (Anthropic was called), so the ClickHouse spend log
    // below still runs — only the directives themselves are discarded, and the
    // caller (runDecisionTree) falls back to playbook copy on a null return.
    //
    // FOLLOW-1034 judge tier: [MP-012]'s falsification condition fired — three
    // token-level fixes and two prompt passes took the prod pass rate from 0% to
    // only ~33%, because generic-vocabulary false positives are an unbounded set
    // (any language, any register). The split of authority is deliberate:
    //   - `hallucinated_number` stays a DETERMINISTIC reject. Figures are the
    //     compliance-critical half (a wrong area or an invented yield), their
    //     semantics are exact, and the canonical-digit check has no false-positive
    //     class left — no model gets to overrule it.
    //   - `hallucinated_proper_name` becomes a high-recall FLAG adjudicated by a
    //     Haiku judge that sees the whole context and the flagged copy. The judge
    //     runs ONLY on the path that today ends in a fallback anyway, so its cost
    //     and latency price a recovery, not the happy path. Any judge failure —
    //     API error, malformed verdict — fails CLOSED to the pre-judge behaviour.
    //
    // FOLLOW-1040 — the judge is awaited SERIALLY inside this loop, so its cost is
    // per-flagged-directive, not per-request. Two bounds make that cost finite and
    // independent of the schema: `JUDGE_DEADLINE_MS` per call and
    // `MAX_JUDGE_CALLS_PER_REQUEST` calls per request. Both fail CLOSED.
    const grounding = buildDirectiveGroundingText(input);
    let judgeCalls = 0;
    for (const directive of directives) {
      let violation = checkDirectiveFacts(directive.value, grounding);
      if (violation === 'hallucinated_proper_name' && judgeCalls >= MAX_JUDGE_CALLS_PER_REQUEST) {
        // Cap reached: the remaining flags keep the deterministic rejection. Not a silent
        // skip — the batch is about to be discarded and this line says why.
        console.warn(
          `[llm-gateway] judge cap reached (${String(MAX_JUDGE_CALLS_PER_REQUEST)}/request) — ` +
            `slot=${directive.slot} keeps its token rejection unadjudicated`,
        );
      } else if (violation === 'hallucinated_proper_name') {
        judgeCalls += 1;
        const verdict = await judgeNameGrounding(client, directive.value, grounding, input);
        if (verdict === 'grounded') {
          // Rule AJ, not Rule K.2 [FOLLOW-1041] — K.2 only requires this console.info to
          // fire at all (a producer-side obligation it already met); it does not make the
          // override COUNTABLE. `judgeNameGrounding` already wrote the countable signal —
          // a `fact_check_judge_override` row (`JUDGE_VERDICT_SOURCE`) — before returning
          // this verdict, so `overrides ÷ flags` answers from ClickHouse. This line is a
          // human-debugging aid only; see docs/ops/MEASURED_PREMISES.md MP-012.
          console.info(
            `[llm-gateway] judge overrode token fact-check: slot=${directive.slot} ` +
              `value=${JSON.stringify(directive.value)}`,
          );
          violation = null;
        }
      }
      if (violation) {
        const msg =
          `[llm-gateway] directive fact-check violation: ${violation} ` +
          `archetype=${input.archetypeId} slot=${directive.slot} value=${JSON.stringify(directive.value)}`;
        console.warn(msg);
        Sentry.captureMessage(msg, {
          level: 'warning',
          tags: { area: 'adapt', kind: 'directive_fact_check_violation', violation },
          extra: { archetypeId: input.archetypeId, slot: directive.slot, model },
        });

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
            source: model === HAIKU_MODEL ? 'llm_tweaked' : 'llm_full',
          }),
        );

        return null;
      }
    }

    const output: LlmGatewayOutput = {
      directives,
      model,
      tokens_in: tokensIn,
      tokens_out: tokensOut,
      cost_usd: costUsd,
      latency_ms: latencyMs,
    };

    // Log to ClickHouse (fire-and-forget).
    // FOLLOW-431 / ESC-033: registered via after() so the async write (and its
    // fail-loud .then/.catch → Sentry) completes after the response is sent.
    // afterResponse() is called here (inside the awaited callLlmGateway) rather than at
    // the route call site — the async context flows from the route handler through
    // callLlmGateway, so the request scope is still active here. Outside a request scope
    // (unit tests calling callLlmGateway directly) afterResponse falls back to fire-and-forget.
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
        source: model === HAIKU_MODEL ? 'llm_tweaked' : 'llm_full',
      }),
    );

    // Attach confidence from input confidence score
    const outputWithConfidence = {
      ...output,
      directives: directives.map((d) => ({ ...d, confidence })),
    };

    return outputWithConfidence;
  } catch (err) {
    console.error('[llm-gateway] Anthropic API error:', err instanceof Error ? err.message : err);
    return null;
  }
}
