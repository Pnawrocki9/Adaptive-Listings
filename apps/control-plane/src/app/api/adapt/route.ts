/**
 * POST /api/adapt
 *
 * Decision API — returns personalized adaptation directives for the given session. POST is the
 * only method: `GET /api/adapt` was retired by FOLLOW-1287 (ADR-0004 amendment) — it had no
 * caller, and the SDK, the FOLLOW-819 harness and the FOLLOW-1022 canary all POST. A GET now gets
 * Next.js's 405.
 *
 * Implements the decision tree from Master Design E.1:
 *   1. confidence <= 0.6  → default (no adaptation)
 *   2. similarity > 0.85  → use pre-computed archetype playbook  (source: 'playbook')
 *   3. 0.6 < similarity <= 0.85 → Haiku LLM tweak  (source: 'llm_tweaked', ADP-002)
 *   4. similarity <= 0.6, conf > 0.6 → Sonnet full gen (source: 'llm_full', ADP-002)
 *
 * Sprint 7 Phase 2: LLM gateway wired for branches 3 and 4 (ADP-002). Since FOLLOW-1287 the two
 * branches share ONE gateway call; the band only picks the `source` label and the null fallback.
 * On gateway failure (null return), falls back to:
 *   - llm_tweaked: playbook directives + source 'playbook_fallback_llm_unavailable'
 *   - llm_full: empty directives + source 'playbook_fallback_llm_unavailable'
 *   - cap hit: source 'playbook_fallback_llm_capped'
 * Every fallback response also carries `fallback_reason` (FOLLOW-1056) — 'llm_unavailable' or
 * 'fact_check_refused'. The `source` above cannot separate those two, and they are opposites:
 * one is an incident, the other is the fact check working. NOTE, unchanged by that ticket and
 * verified while writing this line: no return site in this file emits
 * 'playbook_fallback_llm_capped' — the cap path returns 'playbook_fallback_llm_unavailable'
 * like the others.
 *
 * Request: a JSON body with archetype hint, confidence,
 * similarity, and session context. Accepts a real tenant API key resolved via
 * the shared ADR-0015 `resolveApiKey()` (FOLLOW-451 — closes audit F-05). Under
 * `DEMO_MODE=1` only (FOLLOW-1288), also the ops caller and a valid HS256 demo
 * JWT (FOLLOW-205), and the per-tenant archetype override applies — all in
 * `lib/demo/adapt-demo-context.ts`.
 *
 * ClickHouse logging is fire-and-forget — the response is returned immediately
 * and the analytics insert happens asynchronously.
 *
 * @module apps/control-plane/src/app/api/adapt/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { computeCosineSimilarity } from '@estalara/shared';
import type {
  AdaptationDirectives,
  TextDirective,
  ReorderDirective,
  ArchetypeId,
} from '@estalara/shared';
import { assignHoldout, thompsonSample } from '@estalara/shared';
import { getPlaybook } from '@estalara/sdk/playbooks';
import type { SlotDirective } from '@estalara/sdk/playbooks';
import { callLlmGateway } from '@/lib/llm-gateway';
import { clickhouseAuthHeaders } from '@/lib/clickhouse-http';
import { retrieveListingContext } from '@/lib/rag-retrieval';
import { hasListingFacts, withListingFacts } from '@/lib/listing-facts-context';
import {
  resolvePlaceholderDirectives,
  reportDroppedPlaceholderDirectives,
} from '@/lib/placeholder-tokens';
import {
  reportWithheldUngroundedDirectives,
  withholdUngroundedDirectives,
} from '@/lib/ungrounded-directives';
import { afterResponse } from '@/lib/after-response';
import { getTenantSchema as getTenantSchemaFromDb } from '@/lib/tenant-schema';
import { getBanditArms } from '@/lib/bandit-query';
import { isBanditEnabled } from '@/lib/bandit-flag';
import {
  fetchListingEmbeddings,
  fetchArchetypeEmbedding,
  LISTING_EMBEDDING_BATCH_LIMIT,
} from '@/lib/embedding-lookup';
import { isDemoModeEnabled } from '@/lib/demo/demo-mode';
import {
  isDemoSessionRevoked,
  resolveDemoArchetypeOverride,
  resolveDemoAuth,
  type DemoAuth,
} from '@/lib/demo/adapt-demo-context';
import { resolveApiKey } from '@/lib/api-key-auth';
import {
  HoldoutPctInvalidError,
  HoldoutSecretMissingError,
  getConfiguredHoldoutPct,
  getHoldoutAssignmentSecret,
} from '@/lib/holdout-config';
import { resolveAlEnablement } from '@/lib/al-enablement';
import { readShadowChatIntent, flattenIntentDimensions } from '@/lib/chat-intent-cache';
import { VARIANT_INDEX } from '@/lib/variant-index';
import * as Sentry from '@sentry/nextjs';

// ─── Constants ────────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.6;
const HIGH_SIMILARITY_THRESHOLD = 0.85;
const LOW_SIMILARITY_THRESHOLD = 0.6;

// ─── POST body schema ─────────────────────────────────────────────────────────

const AdaptPostBodySchema = z.object({
  tenant_id: z.string().min(1),
  session_id: z.string().min(1),
  page_type: z.enum(['listing_list', 'listing_detail', 'home', 'search']),
  archetype_hint: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  similarity: z.number().min(0).max(1).optional(),
  listing_ids: z.array(z.string().max(64)).max(100).optional(),
  /** Single listing ID for RAG context retrieval (TICKET-AGENCY-001). */
  listing_id: z.string().max(256).optional(),
  /**
   * Session intent vector (1536-dim). Passed by the intent engine for RAG similarity lookup.
   * When absent, RAG step is skipped and listingContext defaults to {}.
   */
  intent_vector: z.array(z.number()).max(2048).optional(),
  /**
   * A/B holdout assignment result from the caller (SDK; formerly also the retired Worker).
   * When provided, this value is logged to ClickHouse adaptation_decisions.
   * Populated from assignHoldout() — see TICKET-AB-001 (PR #80).
   */
  holdout_group: z.boolean().optional(),
  /**
   * Holdout percentage used at assignment time. Used with holdout_group for
   * context in ClickHouse analytics and for server-side assignHoldout().
   * [TICKET-AB-010]
   */
  holdout_pct: z.number().min(0).max(1).optional(),
  /**
   * Consent state from the session. Used for A/B holdout consent gating.
   * [TICKET-AB-010]
   */
  consent_state: z.string().optional(),
  /**
   * Whether the tenant has consent mode enabled.
   * When true, sessions with non-granted consent states are skipped for A/B assignment.
   * [TICKET-AB-010]
   */
  consent_mode_enabled: z.boolean().optional(),
  /**
   * Content locale for slot copy selection [F-09].
   * Defaults to 'en'; slot falls back to English when no override exists for the locale.
   */
  locale: z.enum(['en', 'pl', 'es']).optional(),
});

// ─── Decision logic ───────────────────────────────────────────────────────────

// VARIANT_INDEX is derived from SEED_VARIANTS in @/lib/variant-index (Rule K.1 / FOLLOW-397).
// Imported above — no inline copy needed.

/**
 * Run the adaptation decision tree per Master Design E.1.
 * Now async: branches 3 and 4 call the LLM gateway (ADP-002).
 * TICKET-AGENCY-001: accepts precomputed `listingContext` for RAG injection.
 * FOLLOW-342: accepts `variant` so the bandit selection reaches copy selection.
 *
 * @param archetypeId    - Archetype matched by the intent engine.
 * @param confidence     - Intent confidence 0–1.
 * @param similarity     - Cosine similarity to the matched archetype 0–1.
 * @param sessionId      - Session ID threaded to LLM gateway for cost attribution.
 * @param tenantId       - Tenant ID threaded to LLM gateway for cost attribution.
 * @param locale         - Content locale; slot copy falls back to 'en' when locale override absent.
 * @param listingContext - Agency FAQ answers from RAG retrieval (may be empty).
 * @param forceModel     - Optional Anthropic model ID to force (DEMO MODE, DEMO-001).
 * @param variant        - Bandit variant (one of SEED_VARIANTS in bandit-query.ts). Defaults to
 *                         'control' for backwards compat. Selects from
 *                         `SlotDirective.variants.en` when present.
 *                         HOLDOUT RULE (FOLLOW-360 / RETRO-095): callers MUST pass 'control' when
 *                         the session is in the holdout group. Bandit sampling must be bypassed
 *                         entirely for holdout sessions so the counterfactual baseline stays
 *                         control-only and is not contaminated by v1/v2 arm selections.
 * @returns Partial adaptation result (directives + source, plus `fallback_reason` on the two
 *          branches that can fall back — FOLLOW-1056).
 */
async function runDecisionTree(
  archetypeId: ArchetypeId,
  confidence: number,
  similarity: number,
  sessionId: string,
  tenantId: string,
  locale: 'en' | 'pl' | 'es' = 'en',
  listingContext: Record<string, string> = {},
  forceModel?: string,
  variant = 'control',
  /**
   * FOLLOW-1120. The caller asked to ground this generation in a specific listing and the facts
   * did not arrive, so the prompt below carries the grounding RULE with no grounding BLOCK.
   * Passed in rather than derived here because this function never sees the requested
   * `listing_id`, and "no facts" without "facts were asked for" is not a fault.
   */
  groundingMissing = false,
  /**
   * FOLLOW-1140 / ESC-074 (b). The listing whose facts fill playbook `{token}` placeholders.
   * Distinct from `listingContext`, which is prose for the model: this one is the structured
   * facts a TEMPLATE substitutes, on the two branches that serve playbook copy verbatim and
   * therefore never reach the model at all. Absent → no token resolves and every directive
   * carrying one is discarded, which is FOLLOW-1018's rule applied one layer earlier.
   */
  listingId?: string,
): Promise<{
  directives: TextDirective[];
  source: AdaptationDirectives['source'];
  /** Set only on a `playbook_fallback_*` result — see `AdaptationDirectives` [FOLLOW-1056]. */
  fallback_reason?: AdaptationDirectives['fallback_reason'];
  /**
   * FOLLOW-1163 / ESC-077 option 2. Set when this response carries NO served slot that differs
   * between bandit arms, so the sampled arm MUST NOT be credited with it.
   *
   * Note the predicate is about the SERVED set, not about the withhold: an arm earns credit when
   * something the buyer actually received could have differed because of it. Those coincide today
   * only because `headline` is the sole slot carrying `variants.en` anywhere in the shipped
   * playbooks.
   *
   * WHY THIS EXISTS AT ALL. Only `headline` carries `variants.en` — `cta` and `feature` have
   * none, across all 18 playbooks. Withhold the headline and control / v1 / v2 serve byte-identical
   * copy, while the arm is still sampled, still logged and still echoed into
   * `POST /api/adapt/feedback`, which updates the `(tenant_id, archetype, variant)` posteriors in
   * `ab_bandit_weights`. The experiment would keep accruing evidence for a difference no buyer
   * could see, and would eventually declare a winner on noise.
   *
   * This is EXACTLY the mismatch FOLLOW-362 already ruled on for non-`en` locales — "every
   * non-`en` slot carries a single locale string … a variant/copy mismatch that corrupts A/B
   * analytics" — and the remedy is the same one: record `control`. It is not a white lie: the
   * copy actually served on a withheld response IS the control copy, because `cta` has no
   * variants and therefore falls through to `s.en` for every arm.
   *
   * Reported here rather than decided at sampling time because only one of the two withholding
   * paths is predictable before the call: branch 2 is (`similarity > HIGH_SIMILARITY_THRESHOLD`),
   * but branch 3's fallback depends on whether the gateway returns null, which is not knowable
   * until it has.
   */
  variant_suppressed?: true;
}> {
  // Branch 1: confidence too low — no adaptation
  if (confidence <= CONFIDENCE_THRESHOLD) {
    return { directives: [], source: 'default' };
  }

  // Fetch playbook (real data since ADP-003)

  const playbook = getPlaybook(archetypeId);

  // FOLLOW-342 / FOLLOW-397 / FOLLOW-405: resolve the variant index once per call.
  // VARIANT_INDEX is derived from SEED_VARIANTS (Rule K.1). Unknown variant names
  // (e.g. a stray 'v3' not yet in SEED_VARIANTS) yield undefined.
  //
  // STRAY-ARM CONTRACT (FOLLOW-405 AC-3):
  //   served copy  → s.en (base English copy)
  //     The value chain is:
  //       locale-override ?? (variantIndex !== undefined ? s.variants?.en[idx] : undefined) ?? s.en
  //     When variantIndex is undefined the middle branch short-circuits to undefined,
  //     so the final ?? s.en fallback fires. No variant copy is served.
  //   logged value → the RAW sampled arm string (e.g. 'v3') is written to
  //     param_p_variant / adaptation_decisions.variant via logDecisionAsync. The
  //     logged string is intentionally NOT resolved to 'control' so analytics can
  //     distinguish "arm exists and was selected" from "arm was sampled but
  //     unrecognised" — useful for detecting a misconfigured bandit table that
  //     seeds arms not present in SEED_VARIANTS.
  //
  // The FOLLOW-405 parity test (variant-index.parity.test.ts) ensures this stray-arm
  // path is never exercised in steady-state: it reds CI if SEED_VARIANTS gains an arm
  // without a matching variants.en entry in every non-neutral playbook.
  const variantIndex: number | undefined = VARIANT_INDEX[variant];

  // Convert playbook slots → TextDirectives; prefer locale override, fall back to English [F-09].
  // FOLLOW-342: when a slot carries `variants.en`, use the bandit-selected index.
  // Falls back to `s.en` when variants are absent or the index is out of range.

  // FOLLOW-1163 / ESC-077 option 2: which slots actually DIFFER between bandit arms.
  //
  // The predicate below is deliberately about the SERVED set, not about the withhold. An arm may
  // be credited only when something the buyer received could have differed because of it. Today
  // `headline` is the only slot carrying `variants.en` in any shipped playbook, so once §E.7.0
  // withholds it nothing served differs — but a future playbook (FOLLOW-1164) could put variants
  // on a slot that survives the withhold, and then the arm HAS earned the credit. Keying on the
  // served slots rather than on "did we withhold" is what makes that work without another edit.
  const variantBearingSlots = new Set(
    playbook.slots
      .filter((s: SlotDirective) => (s.variants?.en.length ?? 0) > 1)
      .map((s) => s.slot),
  );

  const playbookDirectives: TextDirective[] = playbook.slots.map((s: SlotDirective) => ({
    type: 'text' as const,

    slot: s.slot,

    value:
      (locale === 'pl' ? s.pl : locale === 'es' ? s.es : undefined) ??
      (variantIndex !== undefined ? s.variants?.en[variantIndex] : undefined) ??
      s.en,
    archetype: archetypeId,
    confidence,
  }));

  // FOLLOW-1140 / ESC-074 (b): fill `{token}` placeholders from the listing's own facts before
  // any playbook copy leaves the route. Applied to the two branches that serve the template
  // VERBATIM — branch 2 below and branch 3's fallback — because those are the ones no model ever
  // sees. On the `llm_*` branches the generation prompt already carries the substitution
  // instruction and FOLLOW-457's fact check governs the result, so re-processing them here would
  // duplicate one contract with another. Returns the directives unchanged, and performs no
  // fetch, whenever the selected copy carries no placeholder at all.
  //
  // An object and not a bare `let` for the reason recorded on `gatewayFallback` below: eslint's
  // flow analysis over-narrows a `let` reassigned only inside a closure to its initial literal.
  const playbookTokenDrop = { dropped: false };
  const resolvePlaybook = async (): Promise<TextDirective[]> => {
    const { directives, droppedTokens } = await resolvePlaceholderDirectives(
      playbookDirectives,
      listingId,
      locale,
    );
    if (droppedTokens.length > 0) {
      reportDroppedPlaceholderDirectives(droppedTokens, {
        sessionId,
        tenantId,
        archetype: archetypeId,
        ...(listingId ? { listingId } : {}),
      });
      playbookTokenDrop.dropped = true;
    }
    return directives;
  };

  // Branch 2: high similarity — use playbook directly (no LLM)
  //
  // FOLLOW-1163 / MASTER_DESIGN §E.7.0. This branch never read the listing — `withListingFacts`
  // skips the fetch above its ceiling, deliberately, because no model runs here. `similarity` is
  // confidence about the BUYER's archetype and says nothing about the PROPERTY, so it cannot
  // license `'Golden Visa Eligible'` about THIS one. Everything that asserts a property fact is
  // therefore withheld and only the `cta` — an offer we make, true whatever the listing says —
  // is served. See `lib/ungrounded-directives.ts` for the classification and the enumeration of
  // shipped copy behind it.
  if (similarity > HIGH_SIMILARITY_THRESHOLD) {
    const { served, withheldSlots } = withholdUngroundedDirectives(await resolvePlaybook());
    if (withheldSlots.length > 0) {
      reportWithheldUngroundedDirectives(withheldSlots, {
        sessionId,
        tenantId,
        archetype: archetypeId,
        ...(listingId ? { listingId } : {}),
      });
    }
    return {
      directives: served,
      source: 'playbook',
      // ESC-077 option 2 — see `variant_suppressed` on the return type.
      ...(served.some((d) => variantBearingSlots.has(d.slot))
        ? {}
        : { variant_suppressed: true as const }),
      // The only branch where `fallback_reason` was previously always absent, so it is the only
      // one where these signals can reach the wire without displacing the LLM diagnosis the
      // FOLLOW-1022 canary reads. See the field's docblock in `@estalara/shared`.
      //
      // The withhold WINS over the token signal, and not by preference: after the withhold no
      // token-bearing directive survives to have dropped one — every shipped `{token}` is on a
      // `headline` (RETRO-315) — so `unresolved_placeholder_tokens` is unreachable here. That is
      // a real consequence of §E.7.0, recorded rather than discovered: FOLLOW-1140's server-side
      // resolution keeps running and no longer has a SERVED consumer on this path.
      ...(withheldSlots.length > 0
        ? { fallback_reason: 'ungrounded_directives_withheld' as const }
        : playbookTokenDrop.dropped
          ? { fallback_reason: 'unresolved_placeholder_tokens' as const }
          : {}),
    };
  }

  // ── ROUTE-LEVEL WALL-CLOCK BUDGET: decided NOT NOW, and here is the reason [FOLLOW-1040] ──
  //
  // The `await callLlmGateway(...)` call below is bare (one call since FOLLOW-1287; there were two
  // when this was written). That is now a DECISION rather than an omission, which is the whole
  // point of writing it here.
  //
  // What was rejected, and why:
  //   1. `export const maxDuration` — a platform kill switch, not a budget. It answers with a
  //      504 and NO body: the SDK gets no directives AND no `source`, which is strictly worse
  //      for the buyer than a slow-but-good answer, and it blinds the FOLLOW-1022 canary,
  //      whose only assertion is on `source`.
  //   2. A graceful `Promise.race` returning playbook copy — the right shape, but it must
  //      report itself, i.e. a NEW `source` value (`playbook_fallback_llm_timeout`) read by
  //      the SDK, the canary and ClickHouse `adaptation_decisions`. Rules H/AJ say a new
  //      emitted value ships with its consumers; that is a contract change with three
  //      consumers, and it belongs to Track LATENCY (FOLLOW-1037/1038/1039), not to a
  //      deadline ticket.
  //
  // What made "not now" defensible rather than lazy: the term that was UNBOUNDED — the
  // fact-check judge, up to one serial LLM round trip per directive — is bounded as of this
  // ticket (`JUDGE_DEADLINE_MS` × `judgeCallBudget(model)` in `llm-gateway.ts`; FOLLOW-1178
  // made that budget per-band — 4 s on Haiku, 6 s on Sonnet — and FOLLOW-1180 then re-derived
  // the Haiku half across locales, so the bound is 6 s on BOTH bands. The two constants are
  // still separate: they coincide by two independent derivations, not one premise). What
  // remains is the generation call, whose latency band is measured, not open-ended, and the
  // route's own tail, which [MP-013] shows is dominated by something OUTSIDE the LLM calls
  // (an outlier route round trip an order of magnitude above the model call inside it). A budget
  // set today would therefore fire mostly on that tail, and cutting a request without knowing
  // what is slow buys a worse answer, not a faster one. Diagnose first, then budget.
  //
  // FOLLOW-1061 / FOLLOW-1290: the tail is spent BEFORE this function is ever reached, in the
  // POST handler's pre-LLM dependencies ([MP-014]). The per-segment timer that reported it was
  // removed by FOLLOW-1290; a stall is now read from p95 of the `POST /api/adapt` transaction in
  // Sentry performance. The budget decision above is UNCHANGED — the remedy belongs on the
  // dependency (FOLLOW-1063), not on a ceiling that would cut a request the moment its Postgres
  // connection is slow to acquire.
  //
  // Branches 3 and 4: ONE gateway call [FOLLOW-1287]. The similarity band decides only the
  // `source` label the response and the decision row carry, and what a null falls back to; the
  // call itself, its input and its fallback-reason plumbing are the same on both bands. The model
  // is NOT chosen here — `callLlmGateway` routes on the same `similarity` (Haiku for the tweak band,
  // the global generation model below it), which is why one call with the same input reproduces
  // both former calls exactly. `route.llm-call.test.ts` pins that byte for byte.
  //
  //   - `llm_full`    — similarity <= LOW_SIMILARITY_THRESHOLD (branch 4: full generation).
  //   - `llm_tweaked` — LOW < similarity <= HIGH (branch 3: Haiku tweak of the playbook; the
  //                     band the FOLLOW-1022 canary probes).
  const llmSource: 'llm_full' | 'llm_tweaked' =
    similarity <= LOW_SIMILARITY_THRESHOLD ? 'llm_full' : 'llm_tweaked';

  // FOLLOW-1056: an object, not a bare `let`, for the reason recorded on `deadlineState` in
  // llm-gateway.ts — eslint's flow analysis over-narrows a `let` reassigned only inside a
  // closure to its initial literal, which would make the read below look like a constant.
  const gatewayFallback: { reason: NonNullable<AdaptationDirectives['fallback_reason']> } = {
    reason: 'llm_unavailable',
  };
  const gatewayResult = await callLlmGateway({
    archetypeId,
    confidence,
    similarity,

    basePlaybook: playbook,
    listingContext,
    groundingMissing,
    sessionId,
    tenantId,
    onFallback: (reason) => {
      gatewayFallback.reason = reason;
    },
    ...(forceModel ? { forceModel } : {}),
  });

  if (gatewayResult) {
    return { directives: gatewayResult.directives, source: llmSource };
  }

  // Gateway returned null. `fallback_reason` says WHICH null this was — an unavailable LLM or
  // a generation the fact check correctly refused. The `source` stays as it was: it is a
  // strict `z.enum` in the SDK's response schema, so a new value there would fail validation
  // in every deployed bundle and drop the whole response (FOLLOW-1056; see the field's
  // docblock in `@estalara/shared`).
  //
  // Branch 4 serves nothing on a null: its emptiness is about archetype FIT (the buyer is far
  // from every playbook), not about grounding, so there is no template worth falling back to.
  if (llmSource === 'llm_full') {
    return {
      directives: [],
      source: 'playbook_fallback_llm_unavailable',
      fallback_reason: gatewayFallback.reason,
    };
  }
  // Branch 3 (`llm_tweaked`), gateway returned null — fall back to playbook directives. This is
  // the branch the FOLLOW-1022 canary probes, and `fallback_reason` is what lets it stay red for an
  // unavailable LLM without going red for a correct fail-closed refusal [FOLLOW-1056].
  //
  // FOLLOW-1140: the fallback copy is the same template as branch 2's, so it gets the same
  // placeholder resolution. `fallback_reason` is NOT overwritten with the token signal here —
  // the LLM diagnosis is why this response is on the playbook path at all, and the canary reads
  // it. The drop is still reported through `reportDroppedPlaceholderDirectives`.
  // FOLLOW-1163 / §E.7.0: a model outage is not a licence to assert. This copy is the same
  // template branch 2 serves and no model read the listing on this path either, so the same
  // withhold applies. `fallback_reason` is NOT overwritten — it carries the LLM diagnosis the
  // FOLLOW-1022 canary reads, and the withhold is reported through Sentry and the log instead,
  // exactly as FOLLOW-1140's token drop is on this branch.
  const { served, withheldSlots } = withholdUngroundedDirectives(await resolvePlaybook());
  if (withheldSlots.length > 0) {
    reportWithheldUngroundedDirectives(withheldSlots, {
      sessionId,
      tenantId,
      archetype: archetypeId,
      ...(listingId ? { listingId } : {}),
    });
  }
  return {
    directives: served,
    source: 'playbook_fallback_llm_unavailable',
    fallback_reason: gatewayFallback.reason,
    // ESC-077 option 2 — see `variant_suppressed` on the return type.
    ...(served.some((d) => variantBearingSlots.has(d.slot))
      ? {}
      : { variant_suppressed: true as const }),
  };
}

// ─── ClickHouse logging (fire-and-forget) ─────────────────────────────────────

/**
 * Log an adaptation decision to ClickHouse adaptation_decisions table (fire-and-forget).
 *
 * CALLERS AND page_context_source VALUES (FOLLOW-358 / Rule K.1):
 *   POST /api/adapt is the only caller since FOLLOW-1287 retired GET:
 *      pageContext   = pageContextFromPageType(body.page_type) → 1 or 2 (internal derivation).
 *      pageContextSource = 'page_type_derived' — server derived from the page_type field.
 *      This is the canonical page-context signal per MASTER_DESIGN §E.7 / FOLLOW-357.
 *   Historical rows also carry 'caller_supplied' — written by the retired GET handler from its
 *   caller-supplied `tier` URL param — and nothing writes that value any more.
 *
 * The page_context_source column (migration 0019) makes the provenance of each
 * page_context value observable to analysts, closing the Rule K.1 divergence.
 * Rows written before migration 0019 carry the DEFAULT value 'legacy'.
 *
 * NOTE: logDecisionAsync is NOT called on profiling_opt_out or consent-skip paths —
 * those early-return gates suppress ClickHouse logging entirely (FOLLOW-372/369).
 */
function logDecisionAsync(
  sessionId: string,
  tenantId: string,
  archetype: string,
  confidence: number,
  similarity: number,
  source: string,
  pageContext: number,
  directiveCount: number,
  /**
   * A/B holdout assignment result.
   * Populated from assignHoldout() — see TICKET-AB-001 (PR #80).
   * Defaults to false when the caller did not include a holdout assignment
   * (e.g. opted-out sessions, or routes not yet wired to assignHoldout).
   */
  holdoutGroup = false,
  /**
   * Thompson sampling bandit variant selected for this request.
   * Defaults to 'control' when bandit was not consulted (e.g. confidence below
   * threshold, holdout/consent skip path). See FOLLOW-007.
   */
  variant = 'control',
  /**
   * Stable per-decision UUID (FOLLOW-105 / ADR-0006 §Decision 4C). Logged so a
   * response body's `adapt_decision_id` can be cross-correlated with this row.
   * Defaults to '' for legacy callers (matches the migration 0012 column default).
   */
  adaptDecisionId = '',
  /**
   * Whether this decision was driven by DEMO MODE operator override (DEMO-001).
   * Logged so pilot analytics can exclude demo-driven decisions from measurements.
   * Defaults to false (normal path).
   */
  demoOverride = false,
  /**
   * Conversion Label Loop (FOLLOW-170, §T): the scorer that produced this decision.
   * `rulebased-bandit-v1` today; later `lora-tenant-{id}-v*`. Stamped on every row so
   * labels from different scorers stay distinguishable and calibratable.
   */
  modelVersion = 'rulebased-bandit-v1',
  /**
   * Conversion Label Loop (FOLLOW-170, §T): durable pseudonymous lead key, distinct from
   * the anonymous `session_id`. Empty until a durable id is wired through the adapt request
   * (follow-up); the column exists from day one so the field is never lost.
   */
  leadId = '',
  /**
   * FOLLOW-358 / Rule K.1 — provenance discriminator for the page_context column.
   *
   * Makes the origin of each row's page_context value observable to analysts:
   *
   *   'page_type_derived' — POST /api/adapt: derived from page_type via pageContextFromPageType().
   *   'legacy'            — rows written before migration 0019 (source indeterminate).
   *
   * Rows from before FOLLOW-1287 may also read 'caller_supplied' (the retired GET handler's
   * caller-supplied `tier` URL param). No caller can write it any more, so the parameter no
   * longer accepts it.
   *
   * See migration 0019_adaptation_decisions_page_context_source.sql.
   */
  pageContextSource: 'page_type_derived' | 'legacy' = 'legacy',
  /**
   * Holdout percentage in force when this session was assigned. [FOLLOW-988 / ADR-0022]
   *
   * The retired A/B publisher carried this and `adaptation_decisions` did not, so it was the ONE
   * field a field-by-field comparison found missing — every other field of that event was already
   * a column here. Note it was captured NOWHERE before this: the publisher returned early on the
   * empty event-bus URL, so this is a net-new capability rather than a restoration.
   *
   * Defaults to 0 to match migration 0021's column default, so a caller that does not pass it
   * writes the same value a pre-migration row reads as.
   */
  holdoutPct = 0,
  /**
   * FOLLOW-560 (audit A3-F-09/F-10): which scoring path this decision's reorder took — see the
   * `ScoringPath` type below and migration 0022's header comment for the full value semantics.
   * Since FOLLOW-1202 only 'cosine' means a reorder was served. Defaults to 'not_applicable',
   * matching the column's DEFAULT and every call site that never attempts a reorder (the
   * A/B-holdout branch).
   */
  scoringPath: ScoringPath = 'not_applicable',
  /**
   * FOLLOW-1202 (CEO decision #3): why a reorder-capable request got no `reorder`, or null. Goes
   * into `features_snapshot` as `reorder_withheld` (absent when null), so the withholding is
   * countable on every deployment without the flag-gated `scoring_path` column, e.g.
   * `countIf(JSONExtractString(features_snapshot, 'reorder_withheld') != '')`.
   */
  reorderWithheld: ReorderWithheldReason | null = null,
): Promise<void> {
  // Returns a promise so callers can register it via after() and guarantee
  // completion after the response is sent (FOLLOW-431 / ESC-033).
  // No-op when CLICKHOUSE_URL is not configured.
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  if (!clickhouseUrl) return Promise.resolve();

  // FOLLOW-560: `scoring_path` is gated behind SCORING_PATH_COLUMN_ENABLED (default unset/false
  // everywhere, including prod Doppler) rather than always appearing in the column list.
  //
  // ESC-031 is the reason: migration 0019 (page_context_source) shipped in the SAME PR as its
  // unconditional column reference, landed unapplied in prod, and every adaptation_decisions
  // write failed SILENTLY for 80 minutes (this INSERT's .catch() below only console.error's a
  // rejected 4xx — NO_SUCH_COLUMN_IN_BLOCK never surfaces to a caller or an alert). Migration
  // 0021 avoided a repeat only by shipping its writer in a SEPARATE PR, ~8.5h after an operator
  // confirmed the DDL was live in prod (RETRO-275).
  //
  // FOLLOW-560's prod apply is explicitly DEFERRED to FOLLOW-820 (the CEO go/no-go gate), whose
  // own dependency chain (FOLLOW-819, FOLLOW-815) will not close same-day — so the 0021
  // same-day choreography isn't available here. With the flag off, this INSERT is byte-identical
  // to the pre-FOLLOW-560 statement and cannot hit NO_SUCH_COLUMN_IN_BLOCK no matter when this
  // deploys relative to the migration. An operator flips the flag in Doppler `prd` only after
  // confirming migration 0022 is live there (see that migration's header for the full note).
  const scoringPathColumnEnabled = process.env.SCORING_PATH_COLUMN_ENABLED === 'true';

  const clickhouseUser = process.env.CLICKHOUSE_USER ?? 'default';
  const clickhousePassword = process.env.CLICKHOUSE_PASSWORD ?? '';
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');

  // Conversion Label Loop (FOLLOW-170, §T): PII-free snapshot of the scorer inputs/outputs
  // the server saw at decision time, so a stored label can later be replayed against a future
  // model. Only non-PII signals — no session/lead identifiers go in the snapshot.
  // FOLLOW-358: include page_context_source so replayed labels know which derivation was used.
  const featuresSnapshot = JSON.stringify({
    archetype,
    confidence,
    similarity,
    source,
    page_context: pageContext,
    page_context_source: pageContextSource,
    holdout: holdoutGroup,
    variant,
    ...(reorderWithheld !== null ? { reorder_withheld: reorderWithheld } : {}),
  });

  // FOLLOW-261 (F-30): parameterized INSERT — {name:Type} placeholders eliminate string
  // interpolation; values passed as ?param_name= URL query params (ClickHouse HTTP interface).
  // FOLLOW-358: page_context_source column added (migration 0019).
  //
  // FOLLOW-560: `baseQuery` below is the statement as it stood before this ticket, and its column
  // list MUST stay a single parenthesised literal line directly under the INSERT-INTO line.
  // infra/clickhouse/scripts/migration-contract-test.sh greps that pair of lines and runs a sed
  // that requires a closing `)` on the second one; interpolating the flag-gated column into that
  // line makes the extraction silently unparseable and disarms the ESC-031 ordering guard. (The
  // grep is a plain substring match, which is also why no comment in this file may quote the
  // INSERT statement's first line verbatim.) So scoring_path is appended by two exact string
  // replacements instead — see the OPTIONAL_COLUMN marker below.
  const baseQuery =
    `INSERT INTO adaptation_decisions ` +
    `(session_id, tenant_id, archetype, confidence, similarity, source, page_context, page_context_source, directive_count, holdout_group, holdout_pct, variant, adapt_decision_id, demo_override, model_version, features_snapshot, lead_id, ts) ` +
    `VALUES ({p_session_id:String}, {p_tenant_id:String}, {p_archetype:String}, ` +
    `{p_confidence:Float64}, {p_similarity:Float64}, {p_source:String}, {p_page_context:UInt32}, {p_page_context_source:String}, {p_directive_count:UInt32}, ` +
    `{p_holdout_group:UInt8}, {p_holdout_pct:Float64}, {p_variant:String}, {p_adapt_decision_id:String}, ` +
    `{p_demo_override:UInt8}, {p_model_version:String}, {p_features_snapshot:String}, {p_lead_id:String}, {p_ts:String})`;

  // migration-contract-test:OPTIONAL_COLUMN scoring_path
  // ^ machine-readable marker: migration-contract-test.sh appends every column named this way to
  // the column list it exercises, so a flag-gated column is still covered by the ordering
  // contract (its migration must exist and must be the boundary) even though it is absent from
  // the default INSERT. Both replacement targets are unique in `baseQuery`.
  const query = scoringPathColumnEnabled
    ? baseQuery
        .replace('lead_id, ts) ', 'lead_id, ts, scoring_path) ')
        .replace('{p_ts:String})', '{p_ts:String}, {p_scoring_path:String})')
    : baseQuery;

  const url = new URL(clickhouseUrl);
  url.searchParams.set('param_p_session_id', sessionId);
  url.searchParams.set('param_p_tenant_id', tenantId);
  url.searchParams.set('param_p_archetype', archetype);
  url.searchParams.set('param_p_confidence', String(confidence));
  url.searchParams.set('param_p_similarity', String(similarity));
  url.searchParams.set('param_p_source', source);
  url.searchParams.set('param_p_page_context', String(pageContext));
  url.searchParams.set('param_p_page_context_source', pageContextSource);
  url.searchParams.set('param_p_directive_count', String(directiveCount));
  url.searchParams.set('param_p_holdout_group', holdoutGroup ? '1' : '0');
  url.searchParams.set('param_p_holdout_pct', String(holdoutPct));
  url.searchParams.set('param_p_variant', variant);
  url.searchParams.set('param_p_adapt_decision_id', adaptDecisionId);
  url.searchParams.set('param_p_demo_override', demoOverride ? '1' : '0');
  url.searchParams.set('param_p_model_version', modelVersion);
  url.searchParams.set('param_p_features_snapshot', featuresSnapshot);
  url.searchParams.set('param_p_lead_id', leadId);
  url.searchParams.set('param_p_ts', ts);
  if (scoringPathColumnEnabled) {
    url.searchParams.set('param_p_scoring_path', scoringPath);
  }

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
        const msg = `[adapt] ClickHouse INSERT rejected: HTTP ${String(res.status)} — ${body.slice(0, 500)}`;
        console.error(msg);
        Sentry.captureException(new Error(msg), {
          tags: { area: 'adapt', sink: 'clickhouse', kind: 'insert_rejected' },
          extra: { status: res.status },
        });
      }
    })
    .catch((err: unknown) => {
      // Network-layer failure (DNS, connection refused, malformed URL, timeout).
      // Analytics failures must not surface to callers — log + Sentry only.
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[adapt] ClickHouse log failed:', msg);
      Sentry.captureException(err instanceof Error ? err : new Error(msg), {
        tags: { area: 'adapt', sink: 'clickhouse', kind: 'network' },
      });
    });
}

// ─── ReorderDirective helpers ─────────────────────────────────────────────────
//
// This route IS the canonical implementation (ADR-0004 §1 / ADR-0006 —
// CEO-ratified 2026-05-25, the only production adapt path). It historically
// had a sibling copy in the Decision API Cloudflare Worker's `lib/reorder.ts`,
// duplicated because cross-app TypeScript imports are not supported. That
// Worker's POST /api/adapt returned 410 Gone from ADR-0006 on, the pair was
// de-registered from scripts/mirror-files.json (FOLLOW-1073), and the whole
// Worker was removed 2026-09-24 (FOLLOW-1262, discharging FOLLOW-107). This
// file is the only copy.
//
// getTenantSchema() is now provided by @/lib/tenant-schema (TICKET-AB-011):
//   - Redis cache at `schema:{tenantId}` (5-min TTL)
//   - Falls back to tenant_site_schemas DB table
//   - Demo tenant still returns hard-coded DEMO_SCHEMA for backward compat

/**
 * Minimal per-tenant schema for reorder capability.
 * Mirrors TenantSiteSchemaMin from @/lib/tenant-schema.
 */
interface TenantSchema {
  reorder_capable: boolean;
  container_selector?: string;
  item_selector?: string;
}

/**
 * Why one listing in a batch could not be scored by cosine [FOLLOW-1202]. Log-only detail behind
 * the batch-level {@link ReorderWithheldReason}.
 */
type UnscorableReason =
  | 'archetype_embedding_missing'
  | 'listing_embedding_missing'
  | 'dimension_mismatch'
  | 'cosine_failed';

/**
 * Cosine affinity for a single (archetype, listing) pair, or the reason there is none.
 *
 * The score is `computeCosineSimilarity()` as computed: a value in `[-1, 1]`, NOT clamped or
 * rescaled to `[0, 1]`. Ranking only needs the order, and every score in a served batch comes from
 * this one function, so the scale is shared by construction.
 *
 * FOLLOW-1202 (CEO decision #3): there is no hash fallback any more. Before this ticket a listing
 * without an embedding was scored with a djb2 hash (`deterministicScore()`, uniform on `[0, 1)`)
 * and sorted in the same array as cosine values, so un-embedded listings outranked embedded ones
 * more often than not (audit 2026-09-13 E-3). An un-scorable listing now makes the whole batch
 * un-rankable — see `buildReorderDirective()`.
 *
 * Historical origin: the retired Decision API Worker's `reorder.ts` affinityScore() (FOLLOW-019)
 * — that Worker was removed by FOLLOW-1262.
 */
function affinityScore(
  archetypeEmbedding: number[] | null,
  listingEmbedding: number[] | null,
): { score: number } | { unscorable: UnscorableReason } {
  if (archetypeEmbedding === null || archetypeEmbedding.length === 0) {
    return { unscorable: 'archetype_embedding_missing' };
  }
  if (listingEmbedding === null) return { unscorable: 'listing_embedding_missing' };
  if (archetypeEmbedding.length !== listingEmbedding.length) {
    return { unscorable: 'dimension_mismatch' };
  }
  try {
    return { score: computeCosineSimilarity(archetypeEmbedding, listingEmbedding) };
  } catch {
    // Zero-magnitude vector: cosine is undefined.
    return { unscorable: 'cosine_failed' };
  }
}

/**
 * FOLLOW-560 (audit A3-F-09/F-10): decision-level discriminator between a real cosine/embedding
 * ranking and a batch that could not be ranked by cosine, logged to
 * `adaptation_decisions.scoring_path` (migration 0022). This is the field FOLLOW-819's
 * differentiator E2E reads to tell the two apart — see that migration's header comment.
 *
 * THE djb2 NAMES ARE HISTORICAL (FOLLOW-1202). `djb2_fallback` and `djb2_guard` were named when
 * those batches were ranked by a djb2 hash and served. Since FOLLOW-1202 no hash is computed and
 * no `reorder` is served for either: `djb2_fallback` = embeddings fetched, but at least one listing
 * (or the archetype) had no usable cosine score; `djb2_guard` = embeddings never fetched (batch
 * size guard, or the lookup threw). Both now mean "reorder withheld" (see
 * {@link ReorderWithheldReason}). The values are kept because they are persisted in ClickHouse and
 * read by the staff rollup and the FOLLOW-819 harness.
 *
 * Exported for the staff analytics rollup (`api/admin/analytics/rollup/data.ts`), which renders
 * the split as a panel on `/admin/analytics`. Type-only export; the route's runtime shape is
 * unchanged.
 */
export type ScoringPath = 'cosine' | 'djb2_fallback' | 'djb2_guard' | 'not_applicable';

/**
 * Countable reason a reorder-capable request got NO `reorder` directive [FOLLOW-1202; CEO decision
 * #3, 2026-09-13: `reorder` fails closed, text directives stay fail-open]. Written to the decision
 * row's `features_snapshot` as `reorder_withheld`, which every deployment writes (unlike the
 * flag-gated `scoring_path` column).
 *
 *   - `embeddings_missing`       — the lookup ran, but at least one listing (or the archetype) had
 *                                  no usable embedding. Pairs with `scoring_path = djb2_fallback`.
 *   - `embeddings_not_attempted` — the lookup never ran: `listing_ids` over
 *                                  `LISTING_EMBEDDING_BATCH_LIMIT`, or the lookup threw. Pairs
 *                                  with `scoring_path = djb2_guard`.
 */
type ReorderWithheldReason = 'embeddings_missing' | 'embeddings_not_attempted';

/**
 * Build a ReorderDirective from a tenant schema + listing IDs, or withhold it.
 *
 * FOLLOW-1202 (CEO decision #3, 2026-09-13): a batch is ALL-COSINE or it gets no reorder. When the
 * embeddings were never fetched, or any listing in the batch has no usable cosine score, the
 * directive is `null`, `withheldReason` says why, and one `console.warn` names the reason code and
 * the per-listing causes. A partial ranking is not served either: ranking only the scorable
 * listings would still move the page's cards around the ones we could not place.
 *
 * Sorted descending by cosine (highest first). `directive` is also null, with no withheld reason,
 * when the schema is not reorder-capable or has no container_selector.
 *
 * Also returns the aggregated `scoringPath` for the batch (see {@link ScoringPath}).
 *
 * Historical origin: the retired Decision API Worker's `reorder.ts` buildReorderDirective() —
 * that Worker was removed by FOLLOW-1262.
 */
function buildReorderDirective(
  schema: TenantSchema,
  listingIds: string[],
  archetype: string,
  confidence: number,
  archetypeEmbedding: number[] | null = null,
  listingEmbeddings: Map<string, number[] | null> | null = null,
  embeddingsAttempted = false,
): {
  directive: ReorderDirective | null;
  scoringPath: ScoringPath;
  withheldReason: ReorderWithheldReason | null;
} {
  if (!schema.reorder_capable || !schema.container_selector) {
    return { directive: null, scoringPath: 'not_applicable', withheldReason: null };
  }
  if (!embeddingsAttempted) {
    console.warn(
      `[adapt/reorder] reorder_withheld=embeddings_not_attempted scoring_path=djb2_guard ` +
        `archetype=${archetype} listings=${String(listingIds.length)}`,
    );
    return {
      directive: null,
      scoringPath: 'djb2_guard',
      withheldReason: 'embeddings_not_attempted',
    };
  }

  const scored: { listing_id: string; score: number }[] = [];
  const unscorable: Partial<Record<UnscorableReason, number>> = {};
  for (const id of listingIds) {
    const r = affinityScore(archetypeEmbedding, listingEmbeddings?.get(id) ?? null);
    if ('score' in r) scored.push({ listing_id: id, score: r.score });
    else unscorable[r.unscorable] = (unscorable[r.unscorable] ?? 0) + 1;
  }

  if (scored.length < listingIds.length) {
    console.warn(
      `[adapt/reorder] reorder_withheld=embeddings_missing scoring_path=djb2_fallback ` +
        `archetype=${archetype} unscorable=${String(listingIds.length - scored.length)}/` +
        `${String(listingIds.length)} causes=${JSON.stringify(unscorable)}`,
    );
    return { directive: null, scoringPath: 'djb2_fallback', withheldReason: 'embeddings_missing' };
  }

  scored.sort((a, b) => b.score - a.score);
  return {
    directive: {
      type: 'reorder',
      container_selector: schema.container_selector,
      item_selector: schema.item_selector ?? '[data-estalara-listing-id]',
      score_function: 'archetype_affinity',
      scores: scored,
      archetype,
      confidence,
    },
    scoringPath: 'cosine',
    withheldReason: null,
  };
}

// ─── Page-type helpers ────────────────────────────────────────────────────────

/**
 * Derive the page context value from the page type reported by the SDK (FOLLOW-357).
 *
 * This is a page-context axis — NOT an integration Tier. The product has no Tiers
 * (CEO ruling 2026-06-05, MASTER_DESIGN §E.7). The returned value signals which page
 * type this request originates from and controls how many directive slots are sent:
 *
 * - `listing_detail` → 2: full per-listing directives (headline, cta, feature)
 * - `listing_list` / `search` / `home` → 1: lighter directives (cta, feature, reorder)
 *
 * Context 2 applies on the detail page where a single listing is in focus — per-listing
 * headline rewrites are appropriate there. On list/search/home pages many listings appear
 * simultaneously, so only higher-level slots (cta, feature badge, reorder) are sent.
 *
 * The value is stored in the `adaptation_decisions.page_context` ClickHouse column
 * (renamed from `tier` in migration 0018, FOLLOW-357).
 */
function pageContextFromPageType(
  pageType: 'listing_list' | 'listing_detail' | 'home' | 'search',
): 1 | 2 {
  return pageType === 'listing_detail' ? 2 : 1;
}

/**
 * Filter text directives by page type.
 *
 * On detail pages: all slots are returned (headline + cta + feature).
 * On list/search/home pages: `headline` slots are suppressed — a headline rewrite
 * targeting a single listing card is not meaningful across a multi-listing grid.
 * The reorder directive (type !== 'text') is always passed through unchanged by
 * the caller, so this function only needs to gate `TextDirective` slots.
 */
function filterDirectivesByPageType(
  directives: TextDirective[],
  pageType: 'listing_list' | 'listing_detail' | 'home' | 'search',
): TextDirective[] {
  if (pageType === 'listing_detail') return directives;
  return directives.filter((d) => d.slot !== 'headline');
}

// ─── POST handler ─────────────────────────────────────────────────────────────

/**
 * POST /api/adapt
 *
 * Adaptation endpoint. Accepts a JSON body and returns AdaptationDirectives.
 * Credential in the `Authorization: Bearer <token>` header:
 *
 *   - A real tenant API key resolved via the shared `resolveApiKey()`
 *     (ADR-0015, SHA-256(bearer) → `api_keys` lookup, constant-time
 *     compare). `tenant_id` is the resolved row's tenant — never taken from
 *     the body. If `body.tenant_id` is present and does not match, the
 *     request is rejected 403 (parity with `POST /api/adapt/feedback`).
 *   - Under `DEMO_MODE=1` only (FOLLOW-1288), tried first: the ops caller
 *     (`ADAPT_API_KEY`, pinned to `OPS_TENANT_ID`) and a valid HS256 demo
 *     JWT (FOLLOW-205; its `tenant_id` claim supersedes `body.tenant_id`,
 *     FOLLOW-260). See `lib/demo/adapt-demo-context.ts`. With the flag unset
 *     those bearers are ordinary unknown keys.
 *
 * The SDK always sends `Authorization: Bearer ${config.apiKey}`
 * (`packages/sdk/src/core/adapt.ts`), whichever kind of credential it holds.
 *
 * Body:
 *   tenant_id      — required, string
 *   session_id     — required, string
 *   page_type      — required, 'listing_list'|'listing_detail'|'home'|'search'
 *   archetype_hint — optional, ArchetypeId (defaults to 'neutral')
 *   confidence     — optional, float 0–1 (defaults to 0.5)
 *   similarity     — optional, float 0–1 (defaults to 0.5)
 *
 * @returns 200 AdaptationDirectives JSON.
 * @returns 400 on Zod validation failure.
 * @returns 401 if Authorization header is missing, or the token is not a
 *   valid/registered tenant API key (nor, under DEMO_MODE=1, a demo credential).
 * @returns 403 if the API-key path authenticated the request AND
 *   `body.tenant_id` names a different tenant than the resolved key.
 * @returns 500 under DEMO_MODE=1 if DEMO_MODE_JWT_SECRET (or, for the ops key,
 *   OPS_TENANT_ID) is not configured (deployment misconfiguration).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth — tenant API key; plus, under DEMO_MODE=1 only, the ops caller and the demo JWT ──
  //
  // FOLLOW-1288 (WP-2.3): the demo-mode variants (ops caller `ADAPT_API_KEY`, demo-session HS256
  // JWT, its runtime revocation) live in `lib/demo/adapt-demo-context.ts` and run only when
  // `isDemoModeEnabled()`. With the flag unset every bearer goes straight to `resolveApiKey()`
  // (ADR-0015, SHA-256(bearer) → api_keys lookup, constant-time compare — the SAME helper
  // adapt/feedback uses; audit F-05 / FOLLOW-451), and `DEMO_MODE_JWT_SECRET` is not read.
  //
  // Replay/crypto posture: API-key path — bearer confidentiality carried by TLS, revocation via
  // `api_keys.revoked_at` (ADR-0015 §Replay protection defers per-request nonces). Demo variants —
  // see the module docblock of `adapt-demo-context.ts`.
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) {
    return NextResponse.json({ error: 'invalid_demo_token' }, { status: 401 });
  }
  const demoMode = isDemoModeEnabled();
  let demoAuth: DemoAuth | null = null;
  if (demoMode) {
    const resolved = await resolveDemoAuth(token);
    if (!resolved.ok)
      return NextResponse.json({ error: resolved.error }, { status: resolved.status });
    demoAuth = resolved.auth;
  }
  // FOLLOW-1201 / FOLLOW-1102: the ONLY caller whose body `holdout_pct` is honoured.
  const opsCaller = demoAuth?.kind === 'ops';
  // tenantId is ALWAYS derived server-side — never from body.tenant_id when a key or the ops caller
  // authenticated (F-05 / FOLLOW-260 invariant).
  let apiKeyTenantId: string | null = demoAuth?.kind === 'ops' ? demoAuth.tenantId : null;
  if (demoAuth === null) {
    let keyAuth: Awaited<ReturnType<typeof resolveApiKey>>;
    try {
      keyAuth = await resolveApiKey(req);
    } catch (dbErr) {
      // Configured-but-failed DB lookup (Rule K.2) — fail loud to Sentry,
      // surface as 401 (do not fabricate a tenant / fall back silently).
      console.error('[adapt] API-key auth DB error', dbErr);
      Sentry.captureException(dbErr instanceof Error ? dbErr : new Error(String(dbErr)), {
        tags: { area: 'adapt', kind: 'api_key_auth_db_error' },
      });
      return NextResponse.json({ error: 'invalid_demo_token' }, { status: 401 });
    }
    if (!keyAuth.ok) {
      // An ORIGIN refusal keeps its 403 and its reason. [FOLLOW-943 AC(1)]
      //
      // `invalid_demo_token` on an origin verdict is the most misleading of the four collapses:
      // the caller may hold a perfectly valid API key and be refused for its DOMAIN, and the
      // answer names a JWT it never presented. The origin check inside `resolveApiKey` runs only
      // AFTER the key is found and valid, so this branch cannot leak key existence.
      if (keyAuth.status === 403) {
        return NextResponse.json({ error: keyAuth.error }, { status: 403 });
      }
      // Not a valid tenant API key (nor, under DEMO_MODE=1, a demo JWT or the ops key).
      return NextResponse.json({ error: 'invalid_demo_token' }, { status: 401 });
    }
    apiKeyTenantId = keyAuth.tenantId;
  }

  // FOLLOW-636: a revoked demo session gets the same 401 as a bad token (DEMO_MODE=1 only).
  if (demoAuth && (await isDemoSessionRevoked(demoAuth))) {
    return NextResponse.json({ error: 'invalid_demo_token' }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = AdaptPostBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const body = parsed.data;

  // FOLLOW-383 / §H.9: per-user profiling opt-out gate for POST path.
  // The SDK appends ?profiling_opt_out=1 to the URL when the user has opted out.
  // Next.js exposes this via req.nextUrl.searchParams regardless of HTTP method.
  // Return neutral directives and SUPPRESS variant logging (logDecisionAsync is NOT called on
  // this path).
  const postProfilingOptOut = req.nextUrl.searchParams.get('profiling_opt_out') === '1';
  if (postProfilingOptOut) {
    const adaptDecisionId = crypto.randomUUID();
    return NextResponse.json(
      {
        adapt_decision_id: adaptDecisionId,
        session_id: body.session_id,
        archetype: 'neutral' as const,
        confidence: body.confidence ?? 0.5,
        similarity: body.similarity ?? 0.5,
        page_context: pageContextFromPageType(body.page_type),
        directives: [],
        source: 'default' as const,
        generated_at: new Date().toISOString(),
      },
      { status: 200 },
    );
  }

  // FOLLOW-345/357: derive page_context from page_type — listing_detail gets context 2
  // (full directives); all other page types get context 1 (lighter directive set, no
  // per-listing headline). This is a page-type signal, NOT an integration Tier (§E.7).
  const pageCtx = pageContextFromPageType(body.page_type);

  // FOLLOW-260 (F-26): JWT tenant_id is authoritative — supersedes body.tenant_id.
  // Prevents cross-tenant escalation: a caller with a valid demo JWT for tenant A
  // cannot access tenant B's data by sending tenant_id: B in the body.
  // FOLLOW-451: when the API-key path authenticated the request, the resolved
  // tenant (from api_keys, never from the body) is authoritative instead.
  const jwtTenantId = demoAuth?.kind === 'demo_jwt' ? demoAuth.claims.tenant_id : undefined;
  const tenantId = apiKeyTenantId ?? jwtTenantId ?? body.tenant_id;

  // FOLLOW-451 / ADR-0015 parity: on the API-key path, a caller-supplied
  // body.tenant_id that does not match the resolved tenant is rejected — the
  // same cross-tenant enforcement adapt/feedback/route.ts applies (Step 7).
  // The demo-JWT path keeps its existing supersede-only behavior (FOLLOW-260,
  // route.demo-auth.test.ts) — it already ignores body.tenant_id entirely
  // when the JWT carries a tenant_id claim, so no additional check is added
  // there to avoid regressing that locked-in behavior.
  if (apiKeyTenantId && body.tenant_id !== apiKeyTenantId) {
    return NextResponse.json(
      {
        error: 'FORBIDDEN',
        message: 'tenant_id in body does not match the API key tenant',
      },
      { status: 403 },
    );
  }

  // ── FOLLOW-633: per-tenant Adaptive Listings ON/OFF enforcement ──────────
  // Single shared point (resolveAlEnablement). When al_enabled=false OR status IN ('suspended','canceled'), serve a
  // valid neutral / pass-through 200 (no adaptation — the tenant's page still
  // works), NEVER an error. No ClickHouse row is written (no decision made). The
  // response carries `adaptive_listings_off`/`al_off_reason` provenance. Checked
  // BEFORE the demo-override read and A/B holdout gate so an OFF tenant does no
  // further work. `pending`/`active` stay ON.
  const alState = await resolveAlEnablement(tenantId);
  if (alState.off) {
    return NextResponse.json({
      adapt_decision_id: crypto.randomUUID(),
      session_id: body.session_id,
      archetype: 'neutral' as const,
      confidence: body.confidence ?? 0.5,
      similarity: body.similarity ?? 0.5,
      page_context: pageContextFromPageType(body.page_type),
      directives: [],
      reorderDirectives: [],
      source: 'default' as const,
      adaptive_listings_off: true,
      al_off_reason: alState.reason,
      generated_at: new Date().toISOString(),
    });
  }

  // FOLLOW-105 / ADR-0006 §Decision 4C: stable per-decision UUID. Generated once
  // per request and returned in EVERY response arm (skip, holdout, treatment) and
  // logged to ClickHouse so a response body can be cross-correlated with its row.
  const adaptDecisionId = crypto.randomUUID();

  // ── DEMO MODE archetype override (DEMO-001 / AC4; DEMO_MODE=1 only, FOLLOW-1288) ──────────
  // When enabled for the tenant, the operator's archetype replaces the SDK's hint at high
  // confidence / medium similarity, and the LLM call is forced to the operator's model
  // (`resolveDemoArchetypeOverride`, which also degrades to the hint when the store throws).
  //
  // FOLLOW-452 (audit F-08): this resolution MUST happen BEFORE the A/B holdout
  // gate below — not after, as it previously did — so that a held-out session's
  // WOULD-BE archetype/confidence (what it would have received had it not been
  // held out) is available to log on the holdout adaptation_decisions row.
  // Without this, every holdout row was logged with a hardcoded 'neutral'/0.5,
  // starving the per-archetype lift query's holdout arm for every real archetype.
  // The RESPONSE BODY returned to a held-out caller is unaffected — it stays
  // hardcoded 'neutral'/empty directives (locked-in product behavior); only the
  // ClickHouse-logged row uses the resolved values below.
  const demoOverride = demoMode ? await resolveDemoArchetypeOverride(tenantId) : null;
  const demoActive = demoOverride !== null;
  const archetypeId = (demoOverride?.archetypeId ??
    body.archetype_hint ??
    'neutral') as ArchetypeId;
  const confidence = demoOverride?.confidence ?? body.confidence ?? 0.5;
  const similarity = demoOverride?.similarity ?? body.similarity ?? 0.5;

  // ── A/B holdout gate (TICKET-AB-010) ─────────────────────────────────────
  // Run before any directive building. Returns early with empty directives
  // when the session is held-out or consent-skipped.
  //
  // FOLLOW-1201 / FOLLOW-1102 (audit SEC-4): the rate is CONFIGURATION, not a body field. A
  // caller-supplied `holdout_pct` was persisted as if configured, so anyone with the public key
  // could set the assignment rate to 0 or 1; it is now honoured only for the ops caller above.
  // The arm is keyed on `HOLDOUT_ASSIGNMENT_SECRET` (never on the page-visible tenant_id). Both
  // fail LOUD when unset/invalid — there is no safe default for a key (Rule K.2).
  let effectiveHoldoutPct: number;
  let assignmentSecret: string;
  try {
    assignmentSecret = getHoldoutAssignmentSecret();
    effectiveHoldoutPct =
      opsCaller && body.holdout_pct !== undefined ? body.holdout_pct : getConfiguredHoldoutPct();
  } catch (err) {
    if (err instanceof HoldoutSecretMissingError) {
      console.error('[adapt] holdout_secret_unconfigured', err.message);
      return NextResponse.json({ error: 'holdout_secret_unconfigured' }, { status: 500 });
    }
    if (err instanceof HoldoutPctInvalidError) {
      console.error('[adapt] holdout_config_invalid', err.message);
      return NextResponse.json({ error: 'holdout_config_invalid' }, { status: 500 });
    }
    throw err;
  }
  const assignment = await assignHoldout({
    tenant_id: tenantId,
    session_id: body.session_id,
    ...(body.consent_state !== undefined ? { consent_state: body.consent_state } : {}),
    consent_mode_enabled: body.consent_mode_enabled ?? false,
    holdout_pct: effectiveHoldoutPct,
    assignment_secret: assignmentSecret,
  });

  if (assignment.skipped) {
    // AC-3: consent skip → no adaptation, no holdout_group field.
    return NextResponse.json({
      adapt_decision_id: adaptDecisionId,
      session_id: body.session_id,
      archetype: 'neutral',
      confidence: 0.5,
      similarity: body.similarity ?? 0.5,
      page_context: pageCtx,
      directives: [],
      reorderDirectives: [],
      source: 'default' as const,
      generated_at: new Date().toISOString(),
    });
  }

  if (assignment.holdout_group) {
    // AC-2: holdout → no adaptation.
    //
    // The ab.assignment publish that used to sit here is GONE — ADR-0022 (Accepted 2026-08-15),
    // FOLLOW-988 stage B. It had emitted nothing since ADR-0016: the event-bus URL was `""` in
    // every env block, so the publisher returned on its first line. Every field it carried is now
    // written directly to `adaptation_decisions` by the `logDecisionAsync` call below —
    // `holdout_pct` included, since FOLLOW-988 step 5.

    // FOLLOW-442 (AUD-04 / F-05): holdout decisions were never written to
    // adaptation_decisions, so the lift query's holdout denominator counted zero
    // sessions. Mirrors the treatment-arm call below (line ~1417) with
    // holdoutGroup=true, variant='control' (no bandit consulted on the holdout
    // path), and directiveCount=0
    // (no directives are built on this branch).
    //
    // FOLLOW-452 (audit F-08): log the WOULD-BE archetype/confidence/similarity
    // (archetypeId/confidence/similarity, resolved above BEFORE the holdout gate
    // from body.archetype_hint/body.confidence/the demo-override) instead of a
    // hardcoded 'neutral'/0.5 — otherwise the per-archetype lift query's holdout
    // arm is starved for every real archetype and lift is unmeasurable. The
    // RESPONSE returned to the caller below is unaffected — still 'neutral'.
    // FOLLOW-431 / ESC-033: registered via after() so the async write (and its
    // fail-loud .then/.catch → Sentry) completes after the response is sent
    // before instance suspension.
    afterResponse(() =>
      logDecisionAsync(
        body.session_id,
        tenantId,
        archetypeId,
        confidence,
        similarity,
        'default',
        pageCtx,
        0, // directiveCount — no directives built on the holdout path
        true, // holdoutGroup
        'control', // variant — bandit not consulted on holdout path
        adaptDecisionId,
        demoActive, // demoOverride — reflects the would-be resolution (FOLLOW-452)
        'rulebased-bandit-v1', // modelVersion
        '', // leadId — not wired via POST body yet (FOLLOW-170)
        'page_type_derived', // pageContextSource (FOLLOW-358): POST derives from page_type
        effectiveHoldoutPct, // holdoutPct (FOLLOW-988) — the EFFECTIVE rate: configured, or ops override (FOLLOW-1201)
      ),
    );

    return NextResponse.json({
      adapt_decision_id: adaptDecisionId,
      session_id: body.session_id,
      archetype: 'neutral',
      confidence: 0.5,
      similarity: body.similarity ?? 0.5,
      page_context: pageCtx,
      directives: [],
      reorderDirectives: [],
      source: 'default' as const,
      holdout_group: true,
      generated_at: new Date().toISOString(),
    });
  }

  // Treatment arm: continue building directives.
  //
  // The ab.assignment publish that used to sit here is GONE — ADR-0022 / FOLLOW-988 stage B. See
  // the holdout arm above for why: the publisher had been a no-op since ADR-0016, and
  // `logDecisionAsync` already writes every field it carried.

  // NOTE (FOLLOW-452): demoOverride/archetypeId/confidence/similarity
  // are resolved earlier, BEFORE the A/B holdout gate above — see the "DEMO MODE
  // override" block preceding `assignHoldout()` — so the holdout branch can log
  // the would-be values. Nothing to resolve here for the treatment arm.

  // TICKET-AGENCY-001: RAG retrieval — fetch top-3 FAQ answers for this listing.
  // Fail-open: retrieveListingContext never throws; returns {} on any failure.
  const ragContext = await retrieveListingContext(
    tenantId,
    body.listing_id ?? null,
    body.intent_vector ?? null,
  );

  // FOLLOW-1022: add the listing's OWN facts to the same context object.
  //
  // Until now the only thing that ever reached `listingContext` was the agency FAQ table, and
  // only for a caller that sent BOTH `listing_id` and a 1536-dim `intent_vector` — which the
  // SDK does not. So in production the LLM was asked to rewrite copy for a listing it had never
  // been shown, while the base directives it must "improve upon" are playbook templates that
  // demand figures. Every number it produced was therefore ungrounded, and FOLLOW-457's
  // post-generation check discarded the whole batch — see [MP-010] for the production
  // measurement that establishes the scale of that fallback.
  //
  // The facts flow into BOTH halves of the loop by construction, because `listingContext` is
  // already read by the prompt builders AND by `buildDirectiveGroundingText` — so what the
  // model is allowed to say and what it is checked against can no longer drift apart.
  const listingContext = await withListingFacts(
    ragContext,
    body.listing_id,
    similarity,
    body.locale ?? 'en',
  );

  // FOLLOW-1120: the caller asked to ground this generation in a specific listing and the facts
  // did not arrive. `withListingFacts` fails open on purpose, so without this flag the prompt goes
  // out carrying the grounding RULE and no grounding BLOCK, the model answers with prose instead
  // of a JSON array, and the parse failure surfaces as an undifferentiated `llm_unavailable` —
  // which reads as "the LLM is down" when the fault is an HTTP status in a different service.
  // Computed here because this is the only layer that sees both the requested id and the resolved
  // context.
  const groundingMissing = Boolean(body.listing_id) && !hasListingFacts(listingContext);

  // ── FOLLOW-007 / FOLLOW-342: Thompson sampling variant selection ─────────
  // Query bandit arms for (tenant_id, archetype) and sample a variant BEFORE
  // running the decision tree so the selected variant can reach copy selection.
  // Auto-seeds 3 arms (control, v1, v2) with Beta(1, 1) on first request.
  // When all arms are paused (or DB unavailable), defaults to 'control'.
  //
  // FOLLOW-362: suppress bandit sampling for non-`en` locales.
  // No playbook populates `variants.pl` or `variants.es` arrays — every non-`en`
  // slot carries a single locale string (identical for all bandit arms, equivalent
  // to control). If thompsonSample returns v1/v2 for a `pl` or `es` session,
  // `runDecisionTree` still serves the single `s.pl`/`s.es` string while ClickHouse
  // records v1/v2 — a variant/copy mismatch that corrupts A/B analytics. Suppress
  // sampling for non-`en` locales until `variants.pl/es` arrays are added to the
  // playbooks.
  //
  // FOLLOW-1286 (D3): the bandit is frozen. Unless BANDIT_ENABLED=true (lib/bandit-flag.ts)
  // no arm is read or drawn and the decision is 'control'; the `variant` column keeps being
  // written. The `bandit_arms` segment mark stays so the pre-LLM breakdown keeps its shape.
  const postLocale: 'en' | 'pl' | 'es' = body.locale ?? 'en';
  const banditLive = isBanditEnabled() && postLocale === 'en';
  const banditArms = banditLive ? await getBanditArms(tenantId, archetypeId) : [];
  const selectedVariant = banditLive ? (thompsonSample(banditArms) ?? 'control') : 'control';

  const {
    directives: textDirectives,
    source,
    fallback_reason: fallbackReason,
    variant_suppressed: variantSuppressed,
  } = await runDecisionTree(
    archetypeId,
    confidence,
    similarity,
    body.session_id,
    tenantId,
    postLocale,
    listingContext,
    demoOverride?.forceModel,
    selectedVariant,
    groundingMissing,
    body.listing_id,
  );

  // FOLLOW-1163 / ESC-077 option 2: the arm that gets CREDITED for this response.
  //
  // FOLLOW-359 threaded one variable through copy selection, the response body and the
  // ClickHouse log, and said so, because using the same variable is what proves the three agree.
  // That invariant is preserved here and the split is deliberate and narrow: copy selection above
  // still receives the SAMPLED arm, while the response and the log below both read this ONE
  // variable. They differ only when §E.7.0's withhold left the response carrying no
  // variant-differentiated slot — in which case the copy actually served IS the control copy
  // (`cta` has no `variants.en`, so every arm falls through to `s.en`), and recording the sampled
  // arm would credit v1/v2 for a difference the buyer never saw. Same remedy FOLLOW-362 already
  // applies to non-`en` locales, for the same reason.
  const recordedVariant = variantSuppressed ? 'control' : selectedVariant;

  // FOLLOW-345: filter text directives by page_type before building the response.
  // On list/search/home pages, suppress per-listing headline rewrites — they are
  // only meaningful on detail pages where a single listing is in focus.
  const filteredTextDirectives = filterDirectivesByPageType(textDirectives, body.page_type);

  // Append ReorderDirective for tenants with reorder_capable + listing_ids present.
  // TICKET-AB-011: getTenantSchema now does real DB lookup + Redis cache.
  // FOLLOW-019: real affinity via cosine(archetype_embedding, listing_embedding). Batched
  // lookups are skipped when listing_ids exceeds LISTING_EMBEDDING_BATCH_LIMIT (latency guard).
  // FOLLOW-1202 (CEO decision #3): `reorder` fails CLOSED — if the lookup is skipped or any
  // listing has no usable embedding, no reorder is appended and `reorderWithheld` records why.
  // Text directives above are untouched (they stay fail-open).
  // Historical origin: the retired Decision API Worker's `reorder.ts`
  // buildReorderDirective() — that Worker was removed by FOLLOW-1262.
  const allDirectives: (TextDirective | ReorderDirective)[] = [...filteredTextDirectives];
  const tenantSchema = await getTenantSchemaFromDb(tenantId);
  // FOLLOW-560: decision-level aggregate carried into logDecisionAsync below. Stays
  // 'not_applicable' unless a reorder was attempted for this request (built OR withheld).
  let scoringPath: ScoringPath = 'not_applicable';
  // FOLLOW-1202: non-null exactly when a reorder was attempted and withheld.
  let reorderWithheld: ReorderWithheldReason | null = null;
  if (tenantSchema && body.listing_ids && body.listing_ids.length > 0) {
    // Fetch embeddings in parallel. A lookup error never fails the request; it withholds the
    // reorder only (FOLLOW-1202).
    let archetypeEmbedding: number[] | null = null;
    let listingEmbeddings: Map<string, number[] | null> | null = null;
    // FOLLOW-560: true only when the embedding fetch was actually attempted AND succeeded
    // (i.e. neither the latency guard nor the catch below fired). Distinguishes 'djb2_guard'
    // (never attempted) from 'djb2_fallback' (attempted, some listing un-scorable).
    let embeddingsAttempted = false;

    if (body.listing_ids.length <= LISTING_EMBEDDING_BATCH_LIMIT) {
      try {
        const [archEmb, listEmbs] = await Promise.all([
          fetchArchetypeEmbedding(archetypeId),
          fetchListingEmbeddings(tenantId, body.listing_ids),
        ]);
        archetypeEmbedding = archEmb;
        listingEmbeddings = listEmbs;
        embeddingsAttempted = true;
      } catch (err) {
        console.error(
          '[adapt POST] embedding lookup failed — reorder will be withheld:',
          err instanceof Error ? err.message : err,
        );
      }
    } else {
      console.warn(
        `[adapt POST] listing_ids.length=${String(body.listing_ids.length)} exceeds ` +
          `LISTING_EMBEDDING_BATCH_LIMIT=${String(LISTING_EMBEDDING_BATCH_LIMIT)} — ` +
          `reorder will be withheld (latency guard).`,
      );
    }

    const reorderResult = buildReorderDirective(
      tenantSchema,
      body.listing_ids,
      archetypeId,
      confidence,
      archetypeEmbedding,
      listingEmbeddings,
      embeddingsAttempted,
    );
    scoringPath = reorderResult.scoringPath;
    reorderWithheld = reorderResult.withheldReason;
    if (reorderResult.directive !== null) {
      allDirectives.push(reorderResult.directive);
    }
  }

  // ── FOLLOW-346 / FOLLOW-101 / FOLLOW-635: chat-intent prior bridge ──────────
  // Read the Modal NLP shadow key for this (tenant, session) pair and flatten
  // intent_dimensions into a Record<string,string> for the SDK's applyChatIntentPrior.
  //
  // Failure posture: any Redis error is fail-open — we log at console.warn and set
  // chatIntentDimensions to null. The adapt response is NEVER blocked by this read.
  //
  // FOLLOW-635 (CEO ruling, option A, 2026-07-24): this is a LIVE-INFLUENCING path,
  // not shadow-only. `chat_intent_dimensions` is attached unconditionally (no
  // server-side gate) and the SDK client prior loop folds it into `intentState`
  // via `applyChatIntentPrior`; the resulting `archetype` is sent back as
  // `archetype_hint` on the NEXT adapt call, which drives `archetypeId` and
  // therefore the directives served. There is no `CHAT_NLP_LIVE` flag anymore —
  // it never gated this read/response, only a log line, and has been removed.
  // Chat only actually influences prod decisions once `apps/intent-engine`'s
  // write path is deployed (tracked as ESC-042); until then the shadow key is
  // never populated and this read is a no-op fail-open null.
  let chatIntentDimensions: Record<string, string> | null = null;
  // FOLLOW-1024: the extraction stamp travels WITH the dimensions. It is what lets the SDK
  // fold one buyer message exactly once instead of one session exactly once — see
  // `chat_intent_detected_at` in `@estalara/shared`.
  let chatIntentDetectedAt: string | null = null;
  try {
    const shadow = await readShadowChatIntent(tenantId, body.session_id);
    if (shadow !== null) {
      const flattened = flattenIntentDimensions(shadow.intent_dimensions);
      if (Object.keys(flattened).length > 0) {
        chatIntentDimensions = flattened;
        chatIntentDetectedAt =
          typeof shadow.detected_at === 'string' && shadow.detected_at.length > 0
            ? shadow.detected_at
            : null;
        console.info(
          '[adapt] chat-intent shadow read',
          JSON.stringify({
            dimension_count: Object.keys(flattened).length,
            detected_at: chatIntentDetectedAt,
            session_id: body.session_id,
            tenant_id: tenantId,
          }),
        );
      }
    }
  } catch (err: unknown) {
    // readShadowChatIntent is fail-open; this catch is a belt-and-suspenders guard.
    console.warn(
      '[adapt] chat-intent shadow read unexpected error (fail-open):',
      err instanceof Error ? err.message : err,
    );
  }

  // FOLLOW-340: include resolved slot_selectors from the tenant site schema when
  // present and non-empty. The SDK uses these to self-annotate DOM nodes BEFORE the
  // first applyDirectives() call so pages without hand-coded data-estalara-slot
  // attributes (e.g. app.estalara.com no-code) can receive visible adaptation.
  //
  // Fail-safe: tenantSchema may be null (schema lookup failed) or may not have
  // slot_selectors (tenant has no curated detail schema). In either case the field
  // is simply omitted — the adapt response is never blocked or degraded.
  const slotSelectors =
    tenantSchema?.slot_selectors && Object.keys(tenantSchema.slot_selectors).length > 0
      ? tenantSchema.slot_selectors
      : undefined;

  const response: AdaptationDirectives = {
    adapt_decision_id: adaptDecisionId,
    session_id: body.session_id,
    archetype: archetypeId,
    confidence,
    similarity,
    page_context: pageCtx,
    directives: allDirectives,
    source,
    // FOLLOW-1056: present only when the decision tree fell back. This is the field the
    // FOLLOW-1022 canary reads to stay red for an unavailable LLM without going red for a
    // correct fail-closed refusal.
    ...(fallbackReason ? { fallback_reason: fallbackReason } : {}),
    variant: recordedVariant,
    // AC6: provenance flag so the consumer / analytics can exclude demo decisions.
    ...(demoActive ? { demo_override: true } : {}),
    // FOLLOW-101: include chat-intent dimensions when present (null = absent).
    ...(chatIntentDimensions !== null ? { chat_intent_dimensions: chatIntentDimensions } : {}),
    ...(chatIntentDetectedAt !== null ? { chat_intent_detected_at: chatIntentDetectedAt } : {}),
    // FOLLOW-340: include resolved slot selectors for SDK self-annotation.
    ...(slotSelectors !== undefined ? { slot_selectors: slotSelectors } : {}),
    generated_at: new Date().toISOString(),
  };

  // FOLLOW-357: writing pageCtx into the `page_context` ClickHouse column
  // (renamed from `tier` in migration 0018).
  // FOLLOW-358 (Rule K.1): page_context_source='page_type_derived' marks the row as
  // server-derived via pageContextFromPageType (historical GET rows read 'caller_supplied').
  //
  // FOLLOW-431 / ESC-033: registered via after() so the async write (and its fail-loud
  // .then/.catch → Sentry) completes after the response is sent before instance suspension.
  afterResponse(() =>
    logDecisionAsync(
      body.session_id,
      tenantId,
      archetypeId,
      confidence,
      similarity,
      source,
      pageCtx,
      allDirectives.length,
      false, // treatment arm — not holdout
      recordedVariant,
      adaptDecisionId,
      demoActive, // AC6: tag demo-driven decisions for analytics exclusion
      'rulebased-bandit-v1', // modelVersion
      '', // leadId — not wired via POST body yet (FOLLOW-170)
      'page_type_derived', // pageContextSource (FOLLOW-358): POST derives from page_type
      effectiveHoldoutPct, // holdoutPct (FOLLOW-988) — the EFFECTIVE rate: configured, or ops override (FOLLOW-1201)
      scoringPath, // FOLLOW-560: 'not_applicable' unless a reorder was attempted above
      reorderWithheld, // FOLLOW-1202: why no reorder was appended, or null
    ),
  );

  return NextResponse.json(response, { status: 200 });
}
