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
 * Returns null on: missing API key, cap hit, an unusable reply, a fact-check rejection, or any
 * Anthropic API error. Which of those it was is reported through `input.onFallback` and booked
 * on the call's own `llm_calls` row (`GenerationOutcome`) — FOLLOW-1056.
 *
 * @module apps/control-plane/src/lib/llm-gateway
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import type { AdaptationDirectives, ArchetypeId, TextDirective } from '@estalara/shared';
import type { PlaybookEntry } from '@estalara/sdk/playbooks';
import { getGlobalGenerationModel } from '@/lib/global-config-store';
import { clickhouseAuthHeaders } from '@/lib/clickhouse-http';
// FOLLOW-1061: the `llm_calls` INSERT moved to its own module so the `/api/adapt` route can book
// its pre-LLM segment on the SAME register instead of standing up a competing one.
import { logLlmCallAsync } from '@/lib/llm-calls-register';
import { isNonAssertiveSlot } from '@/lib/ungrounded-directives';
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
  /**
   * Why this call is about to return `null`, reported to the caller before it does
   * [FOLLOW-1056].
   *
   * WHY A CALLBACK AND NOT A RICHER RETURN TYPE. `null` is this function's failure contract and
   * 23 assertions across four other tickets' test blocks encode it (`expect(result).toBeNull()`
   * on the fact-check path is FOLLOW-457's, FOLLOW-1034's, FOLLOW-1041's and FOLLOW-1042's
   * statement about rejection semantics). Widening the return to a union would rewrite tests
   * this ticket does not own, for a value only one caller reads. The callback adds the missing
   * channel without touching the existing one.
   *
   * WHY IT IS NEEDED AT ALL. Two opposite conditions — the LLM was unavailable (an incident)
   * and the model wrote ungrounded copy that the pipeline correctly refused (the system
   * working) — both make the route answer `playbook_fallback_llm_unavailable`. The route cannot
   * tell them apart from `null`, so neither can the FOLLOW-1022 canary, which went red for each
   * of them on 2026-08-20 (runs `32370637849`, `32372181392`).
   *
   * Fires exactly once per call, on every `null` exit, and never on success. The cap-hit exit
   * reports `llm_unavailable` because that is what the route's `source` already says on that
   * path; `playbook_fallback_llm_capped` exists in the response union and is written by no
   * route return site — pre-existing, deliberately not changed here.
   */
  onFallback?: (reason: NonNullable<AdaptationDirectives['fallback_reason']>) => void;
  /**
   * FOLLOW-1120. True when the caller asked for a listing's facts and none reached
   * `listingContext` — i.e. the prompt below carries the grounding RULE with no grounding BLOCK
   * for it to refer to. The route computes it (it is the only layer that sees both the requested
   * `listing_id` and the resolved context); this module only reports it, by narrowing the
   * `llm_unavailable` fallback to `listing_context_unavailable`.
   */
  groundingMissing?: boolean;
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
 *
 * **This number was sized against a flag rate FOLLOW-1162 has since raised, and it is
 * UNMEASURED at the new rate [FOLLOW-1165].** Narrowing the grounding corpus to the listing
 * moved every Title-Cased common noun the playbook used to cover — "Income", "Pack", "Rental"
 * — from "grounded by construction" to "flagged, then judged". The reasoning above still
 * holds for the ISOLATED false positive it was written for, but its premise (a batch where
 * every slot trips the scan is systemic failure) is weaker now that a benign batch can trip
 * the scan on vocabulary alone. The cap fails CLOSED, so the failure mode is a rejected batch,
 * not a leak — and it is the same direction as the ESC-063 outage. Do not raise it on
 * intuition: FOLLOW-1165 measures `overrides ÷ flags` from the `fact_check_judge*` rows first.
 *
 * FOLLOW-1173 — the paragraph above still described the flag as something that happens to a
 * batch occasionally. Between FOLLOW-1162 and this ticket it was DETERMINISTIC: the `cta` slot
 * carries the same fixed label on every request, that label trips the scan on a single token
 * ("Pack"), and #873's live run measured a judge round trip on 12 of 12 requests in BOTH arms.
 * One of the two budgeted calls was therefore spoken for before any genuinely ambiguous slot
 * was reached. Removing the `cta` from the flag population (see the fact-check loop below)
 * restores the ISOLATED-false-positive premise this number was sized against; it does not by
 * itself justify the number, which is still what FOLLOW-1165 must measure.
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

/**
 * What happened to the GENERATION call, as recorded on its own `llm_calls` row [FOLLOW-1056].
 *
 * Rule AJ, same adjudication as `JUDGE_VERDICT_SOURCE` above: `source` is
 * `LowCardinality(String)` (`infra/clickhouse/migrations/0004_create_llm_calls.sql:17`), so new
 * values need no DDL, and the consumer of record is `docs/ops/MEASURED_PREMISES.md` MP-010 /
 * MP-012, whose saved queries are updated in the same PR.
 *
 * TWO defects this closes, both MEASURED on production before the change (RETRO-290 §9/§9b):
 *
 *   1. Four of this function's six exits wrote NOTHING. The `catch` that produces the
 *      `playbook_fallback_llm_unavailable` the FOLLOW-1022 canary asserts on, and the three
 *      in-`try` early returns for an unusable reply, were all outside the two `logLlmCallAsync`
 *      call sites. So the one failure mode [MP-010] names and [MP-012] watches for was
 *      answerable only from a CI canary that happened to fire in the same minute or a Vercel
 *      log line inside a retention window — never from the register, never after the fact.
 *   2. Both exits that DID write used the same value, so a batch that was GENERATED AND SERVED
 *      and one that was GENERATED AND REFUSED by the fact check were indistinguishable.
 *
 * SEMANTICS CHANGE, stated rather than made silently — RETRO-290's own finding is that
 * `llm_calls.source` was redefined once with no value change. `llm_tweaked` / `llm_full` are
 * NARROWED here to mean "served" only; rejections move to a NEW value rather than the reverse,
 * so `WHERE source = 'llm_tweaked'` keeps meaning something true and merely stops over-counting.
 * Rows written before this deploys keep the old ambiguity and no backfill can resolve them —
 * date the cut-over from the first production row carrying any `_fact_check_rejected` or
 * `_unavailable_*` suffix.
 *
 * The model band stays in the value (`llm_tweaked_*` / `llm_full_*`) because per-band cost
 * attribution is what the $100/day breaker reads, and a failed call's spend belongs to the band
 * that made it.
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

/**
 * The single place a generation `source` is picked, so it can never be chosen in one place and
 * applied in another — the same containment `logVerdict` gives the judge (FOLLOW-1041).
 */
function generationSource(model: string, outcome: GenerationOutcome): string {
  const band = model === HAIKU_MODEL ? 'llm_tweaked' : 'llm_full';
  return outcome === 'served' ? band : `${band}_${outcome}`;
}

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
 * The grounding rule that `checkDirectiveFacts` (FOLLOW-457) enforces, stated TO the model —
 * and, since FOLLOW-1166, stated over the SAME sources the checker actually grounds against.
 *
 * FOLLOW-1022: the guardrail was enforced but never communicated, and in production every
 * generated directive was discarded for `hallucinated_number` or `hallucinated_proper_name`
 * — the measurement is registered as [MP-010]. The model was doing exactly what it was asked:
 * the base directives it is told to "improve upon" are playbook templates that DEMAND figures
 * (`"Rental Yield: {yield}% | Gross Income: {income}/yr"`), while nothing in the prompt said
 * those figures must come from the listing. Stating the rule costs a few tokens; leaving it
 * unstated cost 100% of the LLM path.
 *
 * FOLLOW-1166 — the sentence above had stopped being true, and in MP-010's own direction with
 * the polarity flipped. FOLLOW-1162 (#869) removed the playbook from `buildDirectiveGroundingText`
 * under MASTER_DESIGN §E.7.0 — a template cannot know a property, so template text is not
 * evidence about one — and left this rule saying "Reuse the wording of the context AND THE
 * CURRENT DIRECTIVES". The prompt therefore ordered the model to reuse the exact vocabulary the
 * checker had just stopped accepting. Measured, not reasoned (RETRO-316 §4a):
 * `yield_hunter`'s own shipped headline is flagged `hallucinated_proper_name` — `Rental`,
 * `Yield` and `Profile` are in neither `FACT_CHECK_STOP_CAPS` nor any listing — so AL's own copy
 * did not survive AL's own fact check while the prompt was asking for it. That costs a judge
 * round trip when a judge is available and the whole batch when one is not.
 *
 * The second source is therefore cut, and the base directives are labelled in
 * {@link buildHaikuPrompt} as framing rather than evidence. The playbook stays IN the prompt:
 * it is where the archetype's angle comes from, and removing it is FOLLOW-1164's decision, not
 * this one's. Note also that only the Haiku builder ever supplied a `Current directives` block,
 * so on the Sonnet path the cut clause named something the prompt did not contain.
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
  // FOLLOW-1166: the context, and ONLY the context. This sentence used to read "the context and
  // the current directives", which named a source `buildDirectiveGroundingText` stopped carrying
  // at FOLLOW-1162 — so the prompt was inducing the exact token the checker would then reject.
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
    // FOLLOW-1166: the block keeps its place — it is where the archetype's angle comes from —
    // but it is named for what it is, so `GROUNDING_RULE`'s "any directives shown above" has an
    // unambiguous referent and the model is not left inferring which half of the prompt is
    // evidence.
    `Current directives — the archetype's existing framing (JSON): ${baseDirectivesJson}\n` +
    `Buyer's recent actions: ${recentEvents}\n` +
    contextBlock +
    GROUNDING_RULE +
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
// here (LlmGatewayInput has none), so the whitelist is built from the inputs
// that are evidence ABOUT THIS PROPERTY, which is not the same set as the
// inputs the prompt builders pass to the model:
//   - listingContext — agency-provided per-listing facts (RAG retrieval).
//   - sessionContext.recentEvents — behavioural event labels; evidence of what
//     the buyer asked, never of the property.
// Any number or capitalised word in a returned directive value that cannot be
// traced to one of these is treated as a hallucination. The whole gateway
// call is failed (returns null) so the caller falls back to playbook copy —
// same fail-safe contract runDecisionTree already applies on any null return.
//
// FOLLOW-1162 / MASTER_DESIGN §E.7.0 removed `basePlaybook.description`,
// `.signals`, `slots[].en`, every `variants.en[]` and `copy_template.en` from
// that list. This paragraph still described them as "curated seed copy, safe by
// construction" for two merges afterwards (RETRO-316 §4b CI-1), which is the
// documentation half of the same asymmetry FOLLOW-1166 fixed in the prompt.
// They are author-approved, and that is exactly why they are not evidence: an
// author approving a sentence about properties in general says nothing about
// THIS one. The corpus is deliberately narrower than the prompt, and the prompt
// now says so — see `GROUNDING_RULE`.

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
  const { listingContext, sessionContext } = input;
  // FOLLOW-1162 / MASTER_DESIGN §E.7.0. This list used to also carry
  // `basePlaybook.description`, `.signals`, `slots[].en`, every `variants.en[]` and
  // `copy_template.en` — added by FOLLOW-1034 on the reasoning that authored copy is
  // authored text and must therefore ground. Under the ESC-076 ruling that is inverted: a
  // template cannot know a property, so template text is not evidence about one, and
  // leaving it here let a claim authorise itself ("Triple Net Lease" passed because the
  // template said it, not because the listing did).
  //
  // What remains is the listing's own facts, plus the session's recent events — the
  // buyer's own words, which are evidence of what the buyer asked, never of the property.
  const parts = [
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
 * python sibling carries both corrections as of FOLLOW-1036 (`dc580fdf`) —
 * `_canon_number` / `_stem_loose` in `apps/llm-gateway/src/jobs/generate_description.py`
 * (`:1674`, `:1690`); the divergence this sentence used to record is closed
 * [FOLLOW-1056 AC(9)]. What has NOT been ported, and is deliberately not implied
 * closed here, is the `FACT_CHECK_STOP_CAPS` word-list difference — FOLLOW-1057.
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
    // FOLLOW-1054: the candidate selector tests `\p{Lu}`, not the ASCII range `[A-Z]`.
    //
    // What is guaranteed: a word whose first character is an upper-case letter in ANY
    // cased script is now compared against the grounding. `É`/`Á`/`Ł`/`Ö` are upper-case
    // letters; `[A-Z]` is a 26-codepoint range, so every one of them failed the test and
    // the word was `continue`d BEFORE any grounding comparison ran — not "checked and
    // passed", never checked. That failed OPEN in a safety check, and the judge tier
    // cannot recover it because `judgeNameGrounding` only ever adjudicates values the scan
    // REJECTS. This is the value side of the comparison whose GROUNDING side FOLLOW-1042
    // moved to Unicode word semantics; both sides now use the same character model.
    //
    // What is NOT guaranteed, stated rather than implied:
    //   1. Case-LESS scripts still contribute no candidates. `\p{Lu}` is empty for Arabic,
    //      Hebrew, Chinese, Japanese and Korean, so in those languages the proper-name half
    //      of this check is inert. That is a property of the design — a capital IS the
    //      proper-name signal here — not of this change, and widening to `\p{L}` would make
    //      every word of such a listing a candidate. The number half still applies.
    //   2. Title-case digraphs (`\p{Lt}`: `ǅ`, `ǈ`, `ǋ`, `ǲ`) are not candidates. They are
    //      31 codepoints that no Latin-script listing writes in practice — the digraph is
    //      normally spelled as two characters, whose first IS `\p{Lu}`.
    //   3. `FACT_CHECK_STOP_CAPS` is an ASCII English/marketing list, so a generic accented
    //      adjective (`Élégant`, `Único`, `Świetny`) is now flaggable mid-segment where it
    //      used to be skipped. Measured on the pilot's French listing [FOLLOW-1054 AC(3)]:
    //      the set is NOT grown for it. Growing it would start an unbounded per-language
    //      word list, which [MP-012] `falsified_means` rules out by name ("a designed
    //      ticket, not a bigger word list"), and the two controls that already cover the
    //      class are the segment-initial exemption above (an adjective opening a segment is
    //      exempt) and the judge tier below (register vocabulary is exactly what it
    //      adjudicates).
    if (
      startsSegment ||
      clean.length < 2 ||
      !/^\p{Lu}/u.test(clean) ||
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
 * an unusable reply, a FOLLOW-457 fact-check rejection, or any Anthropic API error.
 *
 * The caller is responsible for falling back to playbook directives on null. `null` alone does
 * not say WHICH of those happened, and two of them are opposites — pass `input.onFallback` to
 * receive the reason (FOLLOW-1056). Every exit also writes its own `llm_calls` row: before that
 * ticket only two of six did, and they shared one `source`.
 */
export async function callLlmGateway(input: LlmGatewayInput): Promise<LlmGatewayOutput | null> {
  // FOLLOW-1056: every `null` exit below goes through here, so the reason cannot be reported at
  // one exit and forgotten at the next five. Returns `null` so each call site stays a one-liner
  // and no exit can report a reason without also returning.
  const fallback = (
    reason: NonNullable<AdaptationDirectives['fallback_reason']>,
  ): LlmGatewayOutput | null => {
    // FOLLOW-1120: an ungroundable prompt is not an LLM outage, and collapsing the two is what
    // sent a session's diagnosis at the Anthropic key while the key was healthy — the production
    // signature that established it is [MP-017]. Narrow ONLY the
    // `llm_unavailable` arm: `fact_check_refused` means the model produced parseable directives
    // that the grounding check then rejected, which is the pipeline working and is a different
    // fact about a different failure.
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
    // No Anthropic call was made, so there is no spend to book and no `llm_calls` row to
    // write. `llm_unavailable` mirrors the `source` the route already returns on this path
    // (see `onFallback`'s docblock on the unwired `playbook_fallback_llm_capped`).
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

    // FOLLOW-1056: one shared logging point for every outcome reachable from here, the same
    // containment `logVerdict` gives the judge. Before this, two of the five exits below wrote a
    // row and three wrote nothing at all, while the model had been called and billed on all five.
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

    // Extract text from response
    const textBlock = message.content.find((b) => b.type === 'text');
    if (!textBlock) {
      console.warn('[llm-gateway] No text block in Anthropic response');
      // Billed and unusable. The tokens here are REAL (the usage block arrived), unlike the
      // `catch` below — that distinction is the whole of FOLLOW-1049 and it applies to this
      // path too: record what is known, say UNKNOWN only where it is not.
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
      // FOLLOW-1173 — a slot that asserts nothing about the property cannot assert a hallucinated
      // proper name about it. `isNonAssertiveSlot` is `ungrounded-directives.ts`'s own predicate,
      // the one #871's withhold rule uses to serve a `cta` ungrounded on the template paths; the
      // two controls used to disagree about that slot in opposite directions and the disagreement
      // cost a judge round trip on EVERY request. Deliberately NOT a `FACT_CHECK_STOP_CAPS` entry:
      // [MP-012] rules out treating an open class as a word list, and `Pack` would not survive the
      // next playbook re-authoring. Numbers are untouched for every slot — `Get 6.2% Yield Report`
      // is a CTA that DOES assert a property fact, and the canonical-digit check keeps it.
      if (violation === 'hallucinated_proper_name' && isNonAssertiveSlot(directive.slot)) {
        violation = null;
      } else if (
        violation === 'hallucinated_proper_name' &&
        judgeCalls >= MAX_JUDGE_CALLS_PER_REQUEST
      ) {
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

        // FOLLOW-1056: its OWN source. This row and the served row below carried the same
        // value until now, which is why a fact-check rejection rate could not be queried and
        // [MP-012]'s `measure_with` had to read `vercel logs` for the line above instead.
        logGeneration('fact_check_rejected');

        return fallback('fact_check_refused');
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
    logGeneration('served');

    // Attach confidence from input confidence score
    const outputWithConfidence = {
      ...output,
      directives: directives.map((d) => ({ ...d, confidence })),
    };

    return outputWithConfidence;
  } catch (err) {
    console.error('[llm-gateway] Anthropic API error:', err instanceof Error ? err.message : err);

    // FOLLOW-1056: the exit that produced `playbook_fallback_llm_unavailable` and wrote NOTHING,
    // so the failure mode [MP-010] names could be seen only by a CI canary firing in the same
    // minute or a Vercel log line inside a retention window. The production counterfactual that
    // established this is [MP-010]'s 2026-08-20 addendum — it is not restated here.
    //
    // `logGeneration` is not in scope here — it closes over a usage block this path never
    // received — so the row is written directly, and the argument for the zeros is FOLLOW-1049's
    // verbatim: **`0, 0` means UNKNOWN, not zero.** No usage block arrived, so this client cannot
    // know what was billed, and on a request the API had already started answering it probably
    // was billed something. Reading these rows as free under-counts the rolling-24h $100 breaker
    // (`getRolling24hSpend`) by exactly that amount. Left at zero rather than estimated because
    // an invented number is worse than a known-absent one; if this error rate ever becomes
    // material the fix is to bound the estimate from the prompt size, not to guess. The LATENCY
    // is known and is recorded — a failed call still consumed the buyer's wait.
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
