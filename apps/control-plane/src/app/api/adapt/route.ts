/**
 * GET /api/adapt
 *
 * Decision API — returns personalized adaptation directives for the given session.
 *
 * Implements the decision tree from Master Design E.1:
 *   1. confidence <= 0.6  → default (no adaptation)
 *   2. similarity > 0.85  → use pre-computed archetype playbook  (source: 'playbook')
 *   3. 0.6 < similarity <= 0.85 → Haiku LLM tweak  (source: 'llm_tweaked', ADP-002)
 *   4. similarity <= 0.6, conf > 0.6 → Sonnet full gen (source: 'llm_full', ADP-002)
 *
 * Sprint 7 Phase 2: LLM gateway wired for branches 3 and 4 (ADP-002).
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
 * POST /api/adapt
 *
 * Adaptation endpoint. Accepts a JSON body with archetype hint, confidence,
 * similarity, and session context. Accepts EITHER a valid HS256 demo JWT
 * signed by DEMO_MODE_JWT_SECRET (FOLLOW-205 — presence-only check removed)
 * OR a real tenant API key resolved via the shared ADR-0015 `resolveApiKey()`
 * (FOLLOW-451 — closes audit F-05: real tenant keys previously 401'd here
 * with no fallback, causing the SDK to silently fail open to no-adaptation).
 *
 * ClickHouse logging is fire-and-forget — the response is returned immediately
 * and the analytics insert happens asynchronously.
 *
 * @module apps/control-plane/src/app/api/adapt/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { errorBody, ErrorCode, computeCosineSimilarity } from '@estalara/shared';
import type {
  AdaptationDirectives,
  TextDirective,
  ReorderDirective,
  ArchetypeId,
} from '@estalara/shared';
import {
  assignHoldout,
  DEFAULT_HOLDOUT_PCT,
  thompsonSample,
  SKIP_CONSENT_STATES,
} from '@estalara/shared';
import { getPlaybook } from '@estalara/sdk/playbooks';
import type { SlotDirective } from '@estalara/sdk/playbooks';
import { callLlmGateway } from '@/lib/llm-gateway';
import { logLlmCallAsync } from '@/lib/llm-calls-register';
import {
  createSegmentTimer,
  summarizePreLlmSegment,
  PRE_LLM_SEGMENT_SOURCE,
} from '@/lib/adapt-segment-timing';
import { clickhouseAuthHeaders } from '@/lib/clickhouse-http';
import { retrieveListingContext } from '@/lib/rag-retrieval';
import { withListingFacts } from '@/lib/listing-facts-context';
import { afterResponse } from '@/lib/after-response';
import { getTenantSchema as getTenantSchemaFromDb } from '@/lib/tenant-schema';
import { getBanditArms } from '@/lib/bandit-query';
import {
  fetchListingEmbeddings,
  fetchArchetypeEmbedding,
  LISTING_EMBEDDING_BATCH_LIMIT,
} from '@/lib/embedding-lookup';
import { createAdminClient, tenants } from '@estalara/db';
import { eq } from 'drizzle-orm';
import {
  getDemoOverride,
  DEMO_OVERRIDE_CONFIDENCE,
  DEMO_OVERRIDE_SIMILARITY,
} from '@/lib/demo-override-store';
import {
  verifyDemoJwt,
  DemoJwtSecretMissingError,
  DemoJwtInvalidError,
  type DemoJwtClaims,
} from '@/lib/demo-jwt-verify';
import { resolveApiKey } from '@/lib/api-key-auth';
import { resolveAdaptGetAuth, type AdaptGetAuthResult } from '@/lib/adapt-get-auth';
import { resolveAlEnablement } from '@/lib/al-enablement';
import { resolveDemoSessionRevocation } from '@/lib/demo-session-revocation';
import { readShadowChatIntent, flattenIntentDimensions } from '@/lib/chat-intent-cache';
import { VARIANT_INDEX } from '@/lib/variant-index';
import * as Sentry from '@sentry/nextjs';

// ─── Constants ────────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.6;
const HIGH_SIMILARITY_THRESHOLD = 0.85;
const LOW_SIMILARITY_THRESHOLD = 0.6;

// ─── Pilot freeze guard (FOLLOW-117 / RETRO-012 / FOLLOW-263) ────────────────
//
// FOLLOW-263 (RETRO-049): repointed from JSONB `quizConfig.enabled` to the typed
// boolean column `tenants.quiz_enabled` (Drizzle field: `quizEnabled`), which is
// the sole source-of-truth per FOLLOW-102 / migration 0025.
//
// The old pattern read `quizConfig` (JSONB) and searched LANE_C_FLAG_KEYS for any
// key set to true. That became silently blind once FOLLOW-102 moved the SoT to
// `quiz_enabled`. The new pattern reads `quizEnabled` directly — a typed boolean
// column — and fires when pilotFrozen=true AND quizEnabled=true.
//
// If `quiz_enabled = false` the guard does NOT fire: quiz is already off, so no
// contamination risk to the CTA-lift measurement window exists.
//
// Legacy note: `quizConfig` JSONB column still exists on the tenants table as a
// historical configuration store. It is NOT the SoT for quiz enabled/disabled
// state. Do NOT read quizConfig.enabled for freeze-guard decisions — use
// tenants.quizEnabled only. (RETRO-012/FOLLOW-117 SoT-alignment)
//
// Per PILOT_FREEZE_RULE.md §Decision 3 and Master Design v3.0: this warning is
// NON-BLOCKING. It never changes the response or throws; it is purely observability.

/**
 * Reads the tenant record from Postgres and emits a structured warning (via
 * `console.warn`) when `pilot_frozen = true` AND `quiz_enabled = true`.
 *
 * Uses `tenants.quizEnabled` (the typed boolean column added by FOLLOW-102 /
 * migration 0025) as the sole source-of-truth — NOT the JSONB `quizConfig.enabled`
 * path that was used before FOLLOW-263.
 *
 * RETRO-012 / FOLLOW-117: guard introduced.
 * FOLLOW-263 / RETRO-049: repointed at tenants.quiz_enabled (SoT per FOLLOW-102).
 *
 * Failure modes:
 *   - DB unavailable / query error → silently no-ops (warning omitted, never throws).
 *   - `tenantId` is `'unknown'` or empty → skipped (no query issued).
 *
 * This function is fire-and-forget: callers do NOT await it. It must never
 * block or alter the HTTP response.
 *
 * @param tenantId  - Tenant UUID resolved from JWT or request header.
 * @param requestId - Per-request UUID for log correlation.
 */
function checkPilotFrozenAsync(tenantId: string, requestId: string): void {
  if (!tenantId || tenantId === 'unknown') return;

  // FOLLOW-432 / Rule K.2: wrapped in afterResponse() so the DB read and console.warn
  // complete after the response is sent rather than being dropped on Vercel suspension.
  // The function is still non-blocking and never surfaces errors to callers.
  afterResponse(async () => {
    try {
      const db = createAdminClient();
      const rows = await db
        .select({
          pilotFrozen: tenants.pilotFrozen,
          // FOLLOW-263: read the typed boolean column (SoT per FOLLOW-102 / migration 0025).
          // Do NOT use tenants.quizConfig (JSONB) — that path is legacy and was the root
          // cause of the silent blind-spot reported in RETRO-049.
          quizEnabled: tenants.quizEnabled,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);

      const row = rows[0];
      if (!row?.pilotFrozen) return;

      // pilot_frozen = true — check whether quiz is ON (the Lane C flag that matters).
      // quizEnabled=false means quiz is already off → no contamination risk, no warning.
      if (!row.quizEnabled) return;

      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'pilot_frozen_lane_c_active',
          tenant_id: tenantId,
          request_id: requestId,
          // FOLLOW-263: surface the typed column value rather than a list of JSONB keys.
          // quiz_enabled=true is the single Lane C state that contaminates the measurement
          // window. RETRO-012 / FOLLOW-117 precedent; repointed per FOLLOW-263 / RETRO-049.
          quiz_enabled: true,
          message:
            'Tenant has pilot_frozen=true but quiz_enabled=true. ' +
            'This may contaminate the CTA-lift measurement window. ' +
            'Per PILOT_FREEZE_RULE.md, Lane C features must be gated OFF while ' +
            'the measurement window is open. This warning is non-blocking.',
        }),
      );
    } catch (err: unknown) {
      // Analytics/observability failures must never surface to callers.
      console.error('[adapt] pilot_frozen check failed:', err instanceof Error ? err.message : err);
    }
  });
}

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
   * A/B holdout assignment result from the caller (decision-api Worker or SDK).
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
): Promise<{
  directives: TextDirective[];
  source: AdaptationDirectives['source'];
  /** Set only on a `playbook_fallback_*` result — see `AdaptationDirectives` [FOLLOW-1056]. */
  fallback_reason?: AdaptationDirectives['fallback_reason'];
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

  // Branch 2: high similarity — use playbook directly (no LLM)
  if (similarity > HIGH_SIMILARITY_THRESHOLD) {
    return { directives: playbookDirectives, source: 'playbook' };
  }

  // ── ROUTE-LEVEL WALL-CLOCK BUDGET: decided NOT NOW, and here is the reason [FOLLOW-1040] ──
  //
  // Both `await callLlmGateway(...)` calls below are bare. That is now a DECISION rather than
  // an omission, which is the whole point of writing it here.
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
  // ticket (`JUDGE_DEADLINE_MS` × `MAX_JUDGE_CALLS_PER_REQUEST` in `llm-gateway.ts`). What
  // remains is the generation call, whose latency band is measured, not open-ended, and the
  // route's own tail, which [MP-013] shows is dominated by something OUTSIDE the LLM calls
  // (an outlier route round trip an order of magnitude above the model call inside it). A budget
  // set today would therefore fire mostly on that tail, and cutting a request without knowing
  // what is slow buys a worse answer, not a faster one. Diagnose first, then budget.
  //
  // FOLLOW-1061 UPDATE (2026-08-21): the diagnosis half is DONE and the pointer it carried was
  // wrong. This comment used to read "Diagnose first (FOLLOW-1039)"; FOLLOW-1039 is speculative
  // adapt, which routes AROUND a server-side stall and never diagnoses one (Rule AW — re-homed
  // by name, in the same edit as [MP-013]'s `watch_status`). The tail is now measured: it is
  // spent BEFORE this function is ever reached, in the POST handler's pre-LLM dependency
  // segment, and it is instrumented there (`adapt-segment-timing.ts`, [MP-014]). The budget
  // decision above is UNCHANGED — the remedy belongs on the dependency (FOLLOW-1063), not on a
  // ceiling that would cut a request the moment its Postgres connection is slow to acquire.
  //
  // Branch 4: similarity too low — full LLM generation
  if (similarity <= LOW_SIMILARITY_THRESHOLD) {
    // FOLLOW-1056: an object, not a bare `let`, for the reason recorded on `deadlineState` in
    // llm-gateway.ts — eslint's flow analysis over-narrows a `let` reassigned only inside a
    // closure to its initial literal, which would make the read below look like a constant.
    const fullFallback: { reason: NonNullable<AdaptationDirectives['fallback_reason']> } = {
      reason: 'llm_unavailable',
    };
    const gatewayResult = await callLlmGateway({
      archetypeId,
      confidence,
      similarity,

      basePlaybook: playbook,
      listingContext,
      sessionId,
      tenantId,
      onFallback: (reason) => {
        fullFallback.reason = reason;
      },
      ...(forceModel ? { forceModel } : {}),
    });

    if (gatewayResult) {
      return { directives: gatewayResult.directives, source: 'llm_full' };
    }

    // Gateway returned null. `fallback_reason` says WHICH null this was — an unavailable LLM or
    // a generation the fact check correctly refused. The `source` stays as it was: it is a
    // strict `z.enum` in the SDK's response schema, so a new value there would fail validation
    // in every deployed bundle and drop the whole response (FOLLOW-1056; see the field's
    // docblock in `@estalara/shared`).
    return {
      directives: [],
      source: 'playbook_fallback_llm_unavailable',
      fallback_reason: fullFallback.reason,
    };
  }

  // Branch 3: medium similarity — Haiku LLM tweak of playbook.
  // Also bare by decision, not omission — see the ROUTE-LEVEL WALL-CLOCK BUDGET note above
  // [FOLLOW-1040]. This is the branch the FOLLOW-1022 canary probes.
  // FOLLOW-1056 — see the branch-4 note above for why this is an object and not a `let`.
  const tweakFallback: { reason: NonNullable<AdaptationDirectives['fallback_reason']> } = {
    reason: 'llm_unavailable',
  };
  const gatewayResult = await callLlmGateway({
    archetypeId,
    confidence,
    similarity,

    basePlaybook: playbook,
    listingContext,
    sessionId,
    tenantId,
    onFallback: (reason) => {
      tweakFallback.reason = reason;
    },
    ...(forceModel ? { forceModel } : {}),
  });

  if (gatewayResult) {
    return { directives: gatewayResult.directives, source: 'llm_tweaked' };
  }

  // Gateway returned null — fall back to playbook directives. This is the branch the
  // FOLLOW-1022 canary probes, and `fallback_reason` is what lets it stay red for an
  // unavailable LLM without going red for a correct fail-closed refusal [FOLLOW-1056].
  return {
    directives: playbookDirectives,
    source: 'playbook_fallback_llm_unavailable',
    fallback_reason: tweakFallback.reason,
  };
}

// ─── ClickHouse logging (fire-and-forget) ─────────────────────────────────────

/**
 * Log an adaptation decision to ClickHouse adaptation_decisions table (fire-and-forget).
 *
 * CALLERS AND page_context_source VALUES (FOLLOW-358 / Rule K.1):
 *   1. GET /api/adapt handler (line ~848):
 *      pageContext   = caller-supplied `tier` URL param (1|2|3 as integer).
 *      pageContextSource = 'caller_supplied' — the caller chose the numeric value.
 *      This reflects the old integration-Tier framing (CEO-removed 2026-06-05).
 *
 *   2. POST /api/adapt handler (line ~1283):
 *      pageContext   = pageContextFromPageType(body.page_type) → 1 or 2 (internal derivation).
 *      pageContextSource = 'page_type_derived' — server derived from the page_type field.
 *      This is the canonical page-context signal per MASTER_DESIGN §E.7 / FOLLOW-357.
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
   * Two handlers write page_context with different derivation semantics; this field
   * makes the origin of each row's page_context value observable to analysts:
   *
   *   'caller_supplied'   — GET /api/adapt: caller-supplied `tier` URL param.
   *   'page_type_derived' — POST /api/adapt: derived from page_type via pageContextFromPageType().
   *   'legacy'            — rows written before migration 0019 (source indeterminate).
   *
   * See migration 0019_adaptation_decisions_page_context_source.sql.
   */
  pageContextSource: 'caller_supplied' | 'page_type_derived' | 'legacy' = 'legacy',
  /**
   * Holdout percentage in force when this session was assigned. [FOLLOW-988 / ADR-0022]
   *
   * The retired A/B publisher carried this and `adaptation_decisions` did not, so it was the ONE
   * field a field-by-field comparison found missing — every other field of that event was already
   * a column here. Note it was captured NOWHERE before this: the publisher returned early on the
   * empty `REDPANDA_REST_URL`, so this is a net-new capability rather than a restoration.
   *
   * Defaults to 0 to match migration 0021's column default, so a caller that does not pass it
   * writes the same value a pre-migration row reads as.
   */
  holdoutPct = 0,
  /**
   * FOLLOW-560 (audit A3-F-09/F-10): which scoring path produced this decision's reorder
   * ranking — see the `ScoringPath` type above and migration 0022's header comment for the
   * full value semantics. Defaults to 'not_applicable', matching the column's DEFAULT and
   * every call site that never builds a ReorderDirective (GET, the A/B-holdout branch).
   */
  scoringPath: ScoringPath = 'not_applicable',
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
  });

  // FOLLOW-261 (F-30): parameterized INSERT — {name:Type} placeholders eliminate string
  // interpolation; values passed as ?param_name= URL query params (ClickHouse HTTP interface).
  // FOLLOW-358: page_context_source column added (migration 0019); discriminates GET vs POST.
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
// had a sibling copy at apps/decision-api/src/lib/reorder.ts, duplicated
// because cross-app TypeScript imports are not supported by the tsconfig path
// setup (decision-api has no @estalara/* workspace packages and control-plane
// cannot import from apps/decision-api directly). That sibling's own POST
// /api/adapt handler now unconditionally returns 410 Gone, so reorder.ts has
// had no live caller since; scripts/mirror-files.json no longer registers it
// against this file (FOLLOW-1073, 2026-08-24) and it is slated for removal by
// FOLLOW-107. Do not add "keep in sync with reorder.ts" obligations back
// without re-registering the pair.
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
 * Produce a stable 0–1 affinity score for a listing + archetype pair via djb2.
 *
 * Fallback used when archetype or listing embeddings are unavailable (FOLLOW-019).
 * Key order is `archetype:listingId`.
 *
 * Historical origin: apps/decision-api/src/lib/reorder.ts deterministicScore()
 * — that file is dead code (FOLLOW-1073, FOLLOW-107), no longer sync-tracked.
 */
function deterministicScore(archetype: string, listingId: string): number {
  const key = `${archetype}:${listingId}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0; // unsigned 32-bit
  }
  return (hash % 10000) / 10000;
}

/**
 * FOLLOW-560: which per-listing scoring mechanism produced a ReorderDirective's ranking.
 * See `ScoringPath` below for the decision-level aggregate this feeds.
 */
interface AffinityResult {
  score: number;
  usedCosine: boolean;
}

/**
 * Compute the affinity score for a single (archetype, listing) pair.
 *
 * Historical origin: apps/decision-api/src/lib/reorder.ts affinityScore()
 * (FOLLOW-019) — that file is dead code (FOLLOW-1073, FOLLOW-107), no longer
 * sync-tracked. Uses cosine similarity when both embeddings are present and
 * dimension-matched; falls back to djb2 hash otherwise.
 *
 * FOLLOW-560: also reports which path was used (`usedCosine`) so the caller can
 * aggregate a decision-level `scoring_path` for ClickHouse telemetry.
 */
function affinityScore(
  archetype: string,
  listingId: string,
  archetypeEmbedding: number[] | null,
  listingEmbedding: number[] | null,
): AffinityResult {
  if (
    archetypeEmbedding !== null &&
    listingEmbedding !== null &&
    archetypeEmbedding.length > 0 &&
    archetypeEmbedding.length === listingEmbedding.length
  ) {
    try {
      return {
        score: computeCosineSimilarity(archetypeEmbedding, listingEmbedding),
        usedCosine: true,
      };
    } catch (err) {
      console.debug(
        `[adapt/reorder] cosine similarity failed for (${archetype}, ${listingId}) — falling back to djb2:`,
        err instanceof Error ? err.message : err,
      );
    }
  } else {
    console.debug(
      `[adapt/reorder] embedding missing for (${archetype}, ${listingId}) — falling back to djb2`,
    );
  }
  return { score: deterministicScore(archetype, listingId), usedCosine: false };
}

/**
 * FOLLOW-560 (audit A3-F-09/F-10): decision-level discriminator between real cosine/embedding
 * ranking and the djb2 stable-hash fallback, logged to `adaptation_decisions.scoring_path`
 * (migration 0022). This is the field FOLLOW-819's differentiator E2E reads to tell the two
 * apart — see that migration's header comment for the full value semantics.
 *
 * Exported for the staff analytics rollup (`api/admin/analytics/rollup/data.ts`), which renders
 * the cosine-vs-djb2 split as a panel on `/admin/analytics` — the human-readable half of this
 * ticket's telemetry. Type-only export; the route's runtime shape is unchanged.
 */
export type ScoringPath = 'cosine' | 'djb2_fallback' | 'djb2_guard' | 'not_applicable';

/**
 * Build a ReorderDirective from a tenant schema + listing IDs.
 *
 * Scoring (FOLLOW-019):
 *   - Cosine similarity when archetype + listing embeddings are present and
 *     dimension-matched.
 *   - djb2 fallback per-listing when either is missing.
 *
 * Sorted descending (highest first). `directive` is null when schema is not
 * reorder-capable or container_selector is missing.
 *
 * FOLLOW-560: also returns the aggregated `scoringPath` for this batch —
 * 'djb2_guard' when embeddings were never attempted (caller passed
 * `embeddingsAttempted=false`, e.g. the latency guard or a fetch error),
 * 'cosine' when every listing scored via cosine, 'djb2_fallback' when
 * embeddings were attempted but at least one listing fell back to djb2, and
 * 'not_applicable' when no ReorderDirective was built at all.
 *
 * Historical origin: apps/decision-api/src/lib/reorder.ts
 * buildReorderDirective() — that file is dead code (FOLLOW-1073, FOLLOW-107),
 * no longer sync-tracked; its signature (6 params, `ReorderDirective | null`
 * return) predates FOLLOW-560 and was deliberately not propagated there.
 */
function buildReorderDirective(
  schema: TenantSchema,
  listingIds: string[],
  archetype: string,
  confidence: number,
  archetypeEmbedding: number[] | null = null,
  listingEmbeddings: Map<string, number[] | null> | null = null,
  embeddingsAttempted = false,
): { directive: ReorderDirective | null; scoringPath: ScoringPath } {
  if (!schema.reorder_capable || !schema.container_selector) {
    return { directive: null, scoringPath: 'not_applicable' };
  }
  const scored = listingIds.map((id) => {
    const { score, usedCosine } = affinityScore(
      archetype,
      id,
      archetypeEmbedding,
      listingEmbeddings?.get(id) ?? null,
    );
    return { listing_id: id, score, usedCosine };
  });
  scored.sort((a, b) => b.score - a.score);
  const scoringPath: ScoringPath = !embeddingsAttempted
    ? 'djb2_guard'
    : scored.every((s) => s.usedCosine)
      ? 'cosine'
      : 'djb2_fallback';
  return {
    directive: {
      type: 'reorder',
      container_selector: schema.container_selector,
      item_selector: schema.item_selector ?? '[data-estalara-listing-id]',
      score_function: 'archetype_affinity',
      scores: scored.map(({ listing_id, score }) => ({ listing_id, score })),
      archetype,
      confidence,
    },
    scoringPath,
  };
}

// ─── GET handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/adapt
 *
 * Query params:
 *   session_id  — required, string
 *   archetype   — required, ArchetypeId string
 *   confidence  — required, float 0–1
 *   similarity  — required, float 0–1
 *   tier        — required, 1 | 2 | 3 (caller-supplied; echoed back in response)
 *
 * NOTE: the GET handler echoes the caller-supplied `tier` param (1|2|3) in the response
 * and logs it as `page_context` to ClickHouse with source `'caller_supplied'`. The POST
 * handler derives `page_context` from `page_type` via `pageContextFromPageType()` and logs
 * source `'page_type_derived'`. The `page_context_source` column (migration 0019, FOLLOW-358)
 * makes the two derivations distinguishable to analysts. Rule K.1 CLOSED.
 *
 * @returns 200 AdaptationDirectives JSON on valid params, even when source is 'default'.
 * @returns 400 ErrorResponseBody on invalid or missing params.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID();

  // ── Auth gate — FOLLOW-473 (RETRO-158 / FOLLOW-510): fail-closed, tenant
  // derived server-side. Two-step resolver (resolveAdaptGetAuth): ADAPT_API_KEY
  // ops-bypass scoped to OPS_TENANT_ID (Step 1) OR resolveApiKey() SHA-256
  // bearer → api_keys → real tenant (Step 2). Replaces the prior presence-only
  // ADAPT_API_KEY check (which failed OPEN — "any non-empty bearer" — when the
  // env var was unset) and the spoofable x-tenant-id header trust. Mirrors
  // POST /api/adapt/feedback (ADR-0015). x-tenant-id is NO LONGER an authority.
  const auth = req.headers.get('Authorization') ?? req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.AUTH_REQUIRED,
        message: 'Authorization: Bearer <key> header is required',
        requestId,
      }),
      { status: 401 },
    );
  }

  // FOLLOW-532: resolveAdaptGetAuth no longer throws on a configured-but-failed
  // DB lookup — it catches internally and returns a `dbError: true` disposition
  // (Sentry-captured inside the helper), so this call site no longer needs its
  // own try/catch. This pins parity with the sibling route in ./description —
  // both now share the exact same fail-loud branch instead of duplicating it.
  const authResult: AdaptGetAuthResult = await resolveAdaptGetAuth(req, token, 'adapt');
  if (!authResult.ok) {
    return NextResponse.json(
      errorBody({
        code: authResult.status === 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.FORBIDDEN,
        message: authResult.message,
        requestId,
      }),
      { status: authResult.status },
    );
  }
  // Tenant is ALWAYS the server-derived value (ops secret → OPS_TENANT_ID, or the
  // authenticated api_keys row) — never a caller-supplied header (F-05 invariant).
  const tenantId: string = authResult.tenantId;

  const params = req.nextUrl.searchParams;

  // ── Locale resolution (before decision tree for attribution) ──────────────
  const rawLocale = params.get('locale');
  const locale: 'en' | 'pl' | 'es' = rawLocale === 'pl' ? 'pl' : rawLocale === 'es' ? 'es' : 'en';

  // ── Parameter validation ──────────────────────────────────────────────────
  const sessionId = params.get('session_id');
  const archetypeRaw = params.get('archetype');
  const confidenceRaw = params.get('confidence');
  const similarityRaw = params.get('similarity');
  const tierRaw = params.get('tier');

  // ── FOLLOW-369: consent-skip parity with POST handler ────────────────────
  // Optional consent params passed by the decision-api Worker (mirrors POST
  // body fields consent_state / consent_mode_enabled [TICKET-AB-010]).
  const consentState = params.get('consent_state') ?? undefined;
  const consentModeEnabled = params.get('consent_mode_enabled') === 'true';

  // ── FOLLOW-372: per-user DOM adaptation opt-out (§H.9) ───────────────────
  // The SDK sends profiling_opt_out=1 when the investor has toggled off AL DOM
  // adaptation. This gate returns neutral directives and SUPPRESSES variant
  // logging entirely (no ClickHouse row written for opted-out sessions).
  //
  // SCOPE — this flag affects AL DOM adaptation ONLY. It does NOT suppress:
  //   - app.estalara.com buying-intent identification
  //   - lead ranking by buying-intent strength
  //   - agent-facing chat-question summaries
  // Those processing purposes ride the mandatory registration consent (§H.8) and
  // are outside the scope of this flag. (See consentGate comment in
  // apps/decision-api/src/lib/consent-gate.ts for the canonical boundary spec.)
  const profilingOptOut = params.get('profiling_opt_out') === '1';

  if (!sessionId || !archetypeRaw || confidenceRaw === null || similarityRaw === null || !tierRaw) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Missing required parameters: session_id, archetype, confidence, similarity, tier',
        requestId,
        details: {
          required: ['session_id', 'archetype', 'confidence', 'similarity', 'tier'],
          received: Object.fromEntries(params.entries()),
        },
      }),
      { status: 400 },
    );
  }

  const confidence = parseFloat(confidenceRaw);
  const similarity = parseFloat(similarityRaw);
  const tier = parseInt(tierRaw, 10);

  if (isNaN(confidence) || confidence < 0 || confidence > 1) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Parameter "confidence" must be a float between 0 and 1',
        requestId,
        details: { received: confidenceRaw },
      }),
      { status: 400 },
    );
  }

  if (isNaN(similarity) || similarity < 0 || similarity > 1) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Parameter "similarity" must be a float between 0 and 1',
        requestId,
        details: { received: similarityRaw },
      }),
      { status: 400 },
    );
  }

  if (tier !== 1 && tier !== 2 && tier !== 3) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'Parameter "tier" must be 1, 2, or 3',
        requestId,
        details: { received: tierRaw },
      }),
      { status: 400 },
    );
  }

  // ── FOLLOW-633: per-tenant Adaptive Listings ON/OFF enforcement ──────────
  // Single shared point (resolveAlEnablement) so GET and POST cannot diverge.
  // When al_enabled=false OR status IN ('suspended','canceled'), serve a valid
  // neutral / pass-through 200 (no adaptation — the tenant's page still works),
  // NEVER an error that breaks the site. No ClickHouse row is written (no
  // decision was made — mirrors the profiling-opt-out gate below). The response
  // carries `adaptive_listings_off`/`al_off_reason` so the consumer can read the
  // provenance of the neutral result. `pending`/`active` stay ON.
  const alState = await resolveAlEnablement(tenantId);
  if (alState.off) {
    return NextResponse.json(
      {
        adapt_decision_id: crypto.randomUUID(),
        session_id: sessionId,
        archetype: 'neutral' as const,
        confidence,
        similarity,
        tier,
        directives: [],
        source: 'default' as const,
        adaptive_listings_off: true,
        al_off_reason: alState.reason,
        generated_at: new Date().toISOString(),
      } satisfies AdaptationDirectives & {
        tier: number;
        adaptive_listings_off: boolean;
        al_off_reason: string | null;
      },
      { status: 200 },
    );
  }

  // ── FOLLOW-372: profiling opt-out gate ──────────────────────────────────
  // Early-return BEFORE bandit sampling so no variant is sampled or logged.
  // Variant logging is suppressed entirely: logDecisionAsync is NOT called on
  // this path — a 'profiling_opt_out' row must never appear in adaptation_decisions.
  //
  // The adapt_decision_id is still generated and returned so the caller can
  // correlate this response with client-side observability if needed.
  if (profilingOptOut) {
    const adaptDecisionId = crypto.randomUUID();
    // Pilot freeze guard fires even on the opt-out path (observability only).
    checkPilotFrozenAsync(tenantId, requestId);
    // GET handler echoes caller-supplied `tier` in the response (GET contract).
    // logDecisionAsync is suppressed on opt-out paths — no ClickHouse row is written.
    return NextResponse.json(
      {
        adapt_decision_id: adaptDecisionId,
        session_id: sessionId,
        archetype: 'neutral' as const,
        confidence,
        similarity,
        tier,
        directives: [],
        source: 'default' as const,
        generated_at: new Date().toISOString(),
      } satisfies AdaptationDirectives & { tier: number },
      { status: 200 },
    );
  }

  // ── FOLLOW-369: consent-skip gate — mirrors POST's assignHoldout(skipped) path ──
  // When consent_mode_enabled=true AND consent_state is a skip state
  // ('opted_out' | 'unknown' | 'none'), serve empty directives and suppress all
  // variant logging (logDecisionAsync is NOT called). This mirrors the POST handler's
  // assignment.skipped branch (route.ts:965-979) exactly.
  //
  // NOTE: this is distinct from profiling_opt_out (§H.9). Consent-skip is an A/B
  // holdout consent gate — it prevents A/B assignment for non-granted sessions.
  // profiling_opt_out is a per-user DOM adaptation toggle (§H.9).
  if (
    consentModeEnabled &&
    consentState !== undefined &&
    SKIP_CONSENT_STATES.has(consentState as 'opted_out' | 'unknown' | 'none')
  ) {
    // GET handler echoes caller-supplied `tier` in the response (consent-skip: no ClickHouse row).
    return NextResponse.json(
      {
        adapt_decision_id: crypto.randomUUID(),
        session_id: sessionId,
        archetype: 'neutral' as const,
        confidence,
        similarity,
        tier,
        directives: [],
        source: 'default' as const,
        generated_at: new Date().toISOString(),
      } satisfies AdaptationDirectives & { tier: number },
      { status: 200 },
    );
  }

  // ── FOLLOW-452 (audit F-08): compute holdout server-side via the shared
  // assignHoldout() helper — the SAME algorithm POST uses (HMAC-SHA-256 keyed
  // on tenant_id, deterministic per session_id) — instead of trusting a
  // caller-supplied `holdout_group` query param. That param had no real
  // producer (the only caller that ever populated it, the decision-api
  // Worker's POST /api/adapt path, was retired to 410 Gone by ADR-0006) and
  // silently defaulted to `false` whenever absent, meaning every GET session
  // was treated as treatment — the holdout arm was permanently empty and
  // lift was unmeasurable via this path.
  //
  // Consent-based skip is already handled by the FOLLOW-369 gate above (which
  // returns early), so `assignment.skipped` is not expected here; it is
  // handled defensively by falling back to non-holdout.
  const holdoutAssignment = await assignHoldout({
    tenant_id: tenantId,
    session_id: sessionId,
    ...(consentState !== undefined ? { consent_state: consentState } : {}),
    consent_mode_enabled: consentModeEnabled,
  });
  const holdoutGroup = holdoutAssignment.skipped ? false : holdoutAssignment.holdout_group;

  // ── FOLLOW-360: holdout gate — mirrors POST's early-return ordering ──────
  // A holdout session MUST be served control copy and logged with variant='control'.
  // Bandit sampling is skipped entirely for holdout sessions so the holdout
  // counterfactual baseline stays control-only and is not contaminated by v1/v2
  // arm selections. (RETRO-095 / ESC-026)
  const archetypeId = archetypeRaw as ArchetypeId;

  // ── FOLLOW-007 / FOLLOW-342: Thompson sampling variant selection ─────────
  // Sample variant BEFORE decision tree so copy selection uses the result.
  // Holdout sessions bypass sampling and receive 'control' directly.
  //
  // FOLLOW-362: suppress bandit sampling for non-`en` locales.
  // No playbook populates `variants.pl` or `variants.es` arrays — every non-`en`
  // slot carries a single locale string (identical for all bandit arms, equivalent
  // to control). If thompsonSample returns v1/v2 for a `pl` or `es` session,
  // `runDecisionTree` still serves the single `s.pl`/`s.es` string while ClickHouse
  // records v1/v2 — a variant/copy mismatch that corrupts A/B analytics. Suppress
  // sampling for non-`en` locales until `variants.pl/es` arrays are added to the
  // playbooks.
  const getHandlerVariant: string =
    holdoutGroup || locale !== 'en'
      ? 'control'
      : (thompsonSample(await getBanditArms(tenantId, archetypeId)) ?? 'control');

  // ── Decision tree ─────────────────────────────────────────────────────────
  const {
    directives,
    source,
    fallback_reason: fallbackReason,
  } = await runDecisionTree(
    archetypeId,
    confidence,
    similarity,
    sessionId,
    tenantId,
    locale,
    {},
    undefined,
    getHandlerVariant,
  );

  // FOLLOW-105 / ADR-0006 §Decision 4C: stable per-decision UUID, returned in the
  // body and logged to ClickHouse for cross-correlation.
  const adaptDecisionId = crypto.randomUUID();

  // FOLLOW-359: `getHandlerVariant` is the single variable threaded through
  // bandit sampling (or holdout override) → runDecisionTree copy selection →
  // logDecisionAsync ClickHouse log → and now the response body.
  // Using the same variable in all three places proves the response field,
  // the copy selection, and the ClickHouse log all reflect the same value.
  // GET handler echoes caller-supplied `tier` (1|2|3 URL param) in the response body.
  // `tier` is not in `AdaptationDirectives` after FOLLOW-357 rename; the extra field is
  // intentional here (GET contract). POST uses `page_context` instead.
  // FOLLOW-358 CLOSED: page_context_source discriminator ('caller_supplied') is logged
  // to ClickHouse so analysts can distinguish GET rows from POST rows.
  const response = {
    adapt_decision_id: adaptDecisionId,
    session_id: sessionId,
    archetype: archetypeId,
    confidence,
    similarity,
    tier,
    directives,
    source,
    // FOLLOW-1056: present only when the decision tree fell back; distinguishes an
    // unavailable LLM from a generation the fact check correctly refused.
    ...(fallbackReason ? { fallback_reason: fallbackReason } : {}),
    variant: getHandlerVariant,
    generated_at: new Date().toISOString(),
  } satisfies AdaptationDirectives & { tier: number };

  // ── Pilot freeze guard (FOLLOW-106) — non-blocking, fire-and-forget ────────
  checkPilotFrozenAsync(tenantId, requestId);

  // FOLLOW-358 (Rule K.1): the GET handler passes the caller-supplied `tier` URL param
  // (1|2|3) as `pageContext`. The page_context_source discriminator 'caller_supplied'
  // is logged so analysts can distinguish these rows from POST's derived values.
  // The schema divergence is now observable (Rule K.1 closed); both handlers write
  // to the same column but the source column identifies which path produced each row.
  //
  // FOLLOW-431 / ESC-033: registered via after() so the async write (and its fail-loud
  // .then/.catch → Sentry) completes after the response is sent before instance suspension.
  afterResponse(() =>
    logDecisionAsync(
      sessionId,
      tenantId,
      archetypeId,
      confidence,
      similarity,
      source,
      tier,
      directives.length,
      holdoutGroup,
      getHandlerVariant,
      adaptDecisionId,
      false, // demoOverride — GET path has no demo-mode
      'rulebased-bandit-v1', // modelVersion
      '', // leadId — not wired on GET path
      'caller_supplied', // pageContextSource (FOLLOW-358): GET echoes caller-supplied tier
      DEFAULT_HOLDOUT_PCT, // holdoutPct (FOLLOW-988): GET has no body, so the default is the regime
    ),
  );

  return NextResponse.json(response, { status: 200 });
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
 * Accepts EITHER credential in the `Authorization: Bearer <token>` header
 * (FOLLOW-451, CEO Q1 2026-07-02 — both paths mandated; closes audit F-05):
 *
 *   1. A valid HS256 JWT signed by DEMO_MODE_JWT_SECRET (demo mode,
 *      FOLLOW-205). `tenant_id` is taken from the JWT's `tenant_id` claim
 *      when present, else falls back to `body.tenant_id` (FOLLOW-260 —
 *      unchanged).
 *   2. A real tenant API key resolved via the shared `resolveApiKey()`
 *      (ADR-0015, SHA-256(bearer) → `api_keys` lookup, constant-time
 *      compare). `tenant_id` is the resolved row's tenant — never taken from
 *      the body. If `body.tenant_id` is present and does not match, the
 *      request is rejected 403 (parity with `POST /api/adapt/feedback`).
 *
 * The demo-JWT path is tried first; if the token is not a valid demo JWT,
 * the API-key path is attempted as a fallback. Neither valid → 401.
 *
 * Pilot snippet credential: the SDK snippet may ship EITHER a demo JWT
 * (`config.apiKey` = demo session token, used during onboarding/demo
 * sandboxes) OR a real tenant `pk_live_`/`sk_live_` API key (used once a
 * tenant is fully onboarded) — both work against this same endpoint with no
 * SDK-side branching required (`packages/sdk/src/core/adapt.ts` always sends
 * `Authorization: Bearer ${config.apiKey}` regardless of which kind of
 * credential it holds).
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
 * @returns 401 if Authorization header is missing, or the token is neither a
 *   valid demo JWT nor a valid/registered tenant API key.
 * @returns 403 if the API-key path authenticated the request AND
 *   `body.tenant_id` names a different tenant than the resolved key.
 * @returns 500 if DEMO_MODE_JWT_SECRET is not configured (deployment misconfiguration).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── FOLLOW-1061: pre-LLM segment timer ───────────────────────────────────
  // Started before ANY awaited work so the first mark includes auth. Nothing is aborted on
  // this clock — see `PRE_LLM_STALL_WARN_MS` and FOLLOW-1040's recorded no-budget decision.
  // Scope, stated rather than implied (Rule AU): only the treatment path that reaches
  // `runDecisionTree` books a row. The early returns above it (401/403, `adaptive_listings_off`,
  // consent skip, A/B holdout) do not, because the segment they would report is a prefix of a
  // different code path; their wall clock is still on the Vercel invocation record ([MP-014]).
  const segments = createSegmentTimer();

  // ── Auth — demo JWT OR tenant API key (FOLLOW-451, CEO Q1 2026-07-02: both
  // paths mandated) ─────────────────────────────────────────────────────────
  //
  // Try the demo-mode HS256 JWT (DEMO_MODE_JWT_SECRET) first — this preserves
  // the exact pre-existing behavior and test coverage for demo sessions
  // (FOLLOW-205, FOLLOW-260, route.demo-auth.test.ts, all unchanged below).
  //
  // If the token is not a valid demo JWT, fall back to the tenant API-key
  // path: resolveApiKey() (ADR-0015, SHA-256(bearer) → api_keys lookup,
  // constant-time compare) — the SAME shared helper used by
  // adapt/feedback/route.ts. This is the fix for audit F-05: the SDK sends
  // `Authorization: Bearer ${config.apiKey}` (a real tenant key), which
  // previously 401'd against verifyDemoJwt with no fallback, causing the SDK
  // to fail open to `{ adaptResponse: null }` (silent no-adaptation) for
  // every non-demo tenant.
  //
  // Neither path valid → 401. DEMO_MODE_JWT_SECRET missing is still a hard
  // config-error 500 (unchanged) — it never falls through to the API-key
  // path, matching the pre-existing `demo_auth_misconfigured` contract.
  //
  // Replay/crypto posture: demo path — JWT `exp` claim (replay-resistant,
  // FOLLOW-205). API-key path — SHA-256 bearer→row resolution +
  // constant-time compare, identical trust model already accepted for
  // POST /api/adapt/feedback under ADR-0015 (bearer-token confidentiality is
  // carried by TLS in transit; revocation via `api_keys.revoked_at` is the
  // mitigation for a leaked key — ADR-0015 §Replay protection explicitly
  // defers per-request nonces for this same reason).
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) {
    return NextResponse.json({ error: 'invalid_demo_token' }, { status: 401 });
  }
  // ── The demo-JWT path is NOT origin-gated, and that is a decision, not an oversight ──
  //
  // [FOLLOW-943 AC(3)] Stated in place, in the form `quiz/completion/route.ts:127-134` uses,
  // because #714's "wired at BOTH auth paths, not one" counted the two paths that call the shared
  // helper and this is the third. `verifyDemoJwt` below returns a tenant WITHOUT reaching
  // `resolveApiKey`, so no `resolveOriginDecision` runs on this branch.
  //
  // Why that is acceptable today: a demo JWT is minted by Estalara for a demo session, is short-
  // lived (`exp`), is revocable at runtime (the `demo_sessions.revoked_at` check below), and is
  // never issued to a brand's own domain — the demo runs on Estalara's origins, which are exactly
  // the platform allow-list the gate would grant anyway. An origin check would therefore refuse
  // nothing it does not already refuse.
  //
  // FALSIFICATION — the condition that turns this into a hole: **the day a demo JWT is issued for,
  // or usable from, a tenant's own domain**, this path grants an adaptation with no per-tenant
  // origin check at all, and the tenant's `allowed_origins` stops being load-bearing for it. If
  // demo sessions ever become embeddable on brand sites, gate this path before shipping that.
  let jwtClaims: DemoJwtClaims = {};
  // Set when the API-key fallback path (not the demo-JWT path) authenticates
  // the request. tenantId is ALWAYS derived server-side from one of these two
  // paths — never from body.tenant_id (F-05 / FOLLOW-260 invariant).
  let apiKeyTenantId: string | null = null;
  try {
    jwtClaims = await verifyDemoJwt(token);
  } catch (err) {
    if (err instanceof DemoJwtSecretMissingError) {
      // Config error — secret not set. Surface as 500 so ops are alerted.
      // This is NOT a normal auth path; it means the deployment is misconfigured.
      // Unchanged by FOLLOW-451: a missing demo secret never falls through to
      // the API-key path — it is always a deployment misconfiguration signal.
      return NextResponse.json({ error: 'demo_auth_misconfigured' }, { status: 500 });
    }
    if (err instanceof DemoJwtInvalidError) {
      // Not a valid demo JWT — fall back to the tenant API-key path (FOLLOW-451).
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
        // Neither a valid demo JWT nor a valid tenant API key.
        return NextResponse.json({ error: 'invalid_demo_token' }, { status: 401 });
      }
      apiKeyTenantId = keyAuth.tenantId;
    } else {
      // Unexpected error — rethrow to surface as 500 via Next.js error handler.
      throw err;
    }
  }

  segments.mark('auth');

  // ── FOLLOW-636: enforce demo-session revocation at runtime ────────────────
  // verifyDemoJwt above only proves signature + `exp`; it CANNOT see that the
  // session was revoked (revoke writes demo_sessions.revoked_at, which the
  // already-issued token cannot reflect). Without this, revoking a demo session
  // has zero runtime effect — the token keeps serving up to its 7-day exp.
  // Applies ONLY to the demo-JWT path (apiKeyTenantId === null): the API-key
  // fallback has its own api_keys.revoked_at revocation (ADR-0015). A revoked
  // session returns the SAME 401 invalid_demo_token the path already uses for a
  // bad token. Fail-OPEN on a lookup problem (a DB blip must not break a legit
  // demo — Sentry-captured inside the helper); signature + exp stay fail-closed.
  if (apiKeyTenantId === null && jwtClaims.session_id) {
    const { revoked } = await resolveDemoSessionRevocation(jwtClaims.session_id);
    if (revoked) {
      return NextResponse.json({ error: 'invalid_demo_token' }, { status: 401 });
    }
  }
  segments.mark('session_revocation');

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  segments.mark('parse_body');

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
  // Mirror the same early-return logic as the GET handler: return neutral directives
  // and SUPPRESS variant logging (logDecisionAsync is NOT called on this path).
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
  const tenantId = apiKeyTenantId ?? jwtClaims.tenant_id ?? body.tenant_id;

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
  // Same shared point as the GET handler (resolveAlEnablement) so the two cannot
  // diverge. When al_enabled=false OR status IN ('suspended','canceled'), serve a
  // valid neutral / pass-through 200 (no adaptation — the tenant's page still
  // works), NEVER an error. No ClickHouse row is written (no decision made). The
  // response carries `adaptive_listings_off`/`al_off_reason` provenance. Checked
  // BEFORE the demo-override read and A/B holdout gate so an OFF tenant does no
  // further work. `pending`/`active` stay ON.
  const alState = await resolveAlEnablement(tenantId);
  segments.mark('al_enablement');
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

  // ── Pilot freeze guard (FOLLOW-106) — non-blocking, fire-and-forget ────────
  // Emits a structured warning if pilot_frozen=true AND any Lane C feature flag
  // is active. Must run as early as possible so the warning precedes any response.
  checkPilotFrozenAsync(tenantId, crypto.randomUUID());

  // FOLLOW-105 / ADR-0006 §Decision 4C: stable per-decision UUID. Generated once
  // per request and returned in EVERY response arm (skip, holdout, treatment) and
  // logged to ClickHouse so a response body can be cross-correlated with its row.
  const adaptDecisionId = crypto.randomUUID();

  // ── DEMO MODE override (DEMO-001 / AC4) ─────────────────────────────────────
  // Load the per-tenant demo override. When enabled, ignore the SDK's
  // archetype_hint/confidence/similarity and substitute the operator-chosen values
  // so the full playbook + LLM path runs, generating with the chosen model.
  // Fail behaviour: if the DB throws (configured-but-failed), log a Sentry-style
  // error, set demoActive=false, and continue with the normal SDK hint. This avoids
  // silently serving wrong copy while not blocking the response.
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
  let demoActive = false;
  let demoForceModel: string | undefined;
  // F-16 (FOLLOW-194): store the single getDemoOverride() result and reuse it below.
  // The original code called getDemoOverride() a second time inside the demoActive branch,
  // causing a duplicate DB/Redis round-trip on every adapt request in demo mode.
  let demoOverrideArchetype: string | null = null;

  try {
    const demoOverrideState = await getDemoOverride(tenantId);
    if (demoOverrideState.enabled && demoOverrideState.overrideArchetype) {
      demoActive = true;
      demoOverrideArchetype = demoOverrideState.overrideArchetype;
      demoForceModel = demoOverrideState.overrideModel;
    }
  } catch (err: unknown) {
    // Configured DB threw — fail loud in logs, degrade to normal path (Rule K.2).
    console.error(
      '[adapt POST] demo override DB read failed — falling back to SDK hint:',
      err instanceof Error ? err.message : err,
    );
  }
  segments.mark('demo_override');

  // Resolve effective archetype + confidence + similarity.
  // When DEMO MODE is active we always use the override archetype at high confidence
  // and medium similarity (0.75) so Branch 3 (LLM tweak) runs with chosen model.
  let archetypeId: ArchetypeId;
  let confidence: number;
  let similarity: number;

  if (demoActive && demoOverrideArchetype) {
    // Reuse the result from the single getDemoOverride() call above (F-16).
    archetypeId = demoOverrideArchetype as ArchetypeId;
    confidence = DEMO_OVERRIDE_CONFIDENCE;
    similarity = DEMO_OVERRIDE_SIMILARITY;
  } else {
    archetypeId = (body.archetype_hint ?? 'neutral') as ArchetypeId;
    confidence = body.confidence ?? 0.5;
    similarity = body.similarity ?? 0.5;
    demoActive = false;
  }

  // ── A/B holdout gate (TICKET-AB-010) ─────────────────────────────────────
  // Run before any directive building. Returns early with empty directives
  // when the session is held-out or consent-skipped.
  const assignment = await assignHoldout({
    tenant_id: tenantId,
    session_id: body.session_id,
    ...(body.consent_state !== undefined ? { consent_state: body.consent_state } : {}),
    consent_mode_enabled: body.consent_mode_enabled ?? false,
    holdout_pct: body.holdout_pct ?? DEFAULT_HOLDOUT_PCT,
  });
  segments.mark('holdout');

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
    // FOLLOW-988 stage B. It had emitted nothing since ADR-0016: `REDPANDA_REST_URL` is `""` in
    // every env block, so the publisher returned on its first line. Every field it carried is now
    // written directly to `adaptation_decisions` by the `logDecisionAsync` call below —
    // `holdout_pct` included, since FOLLOW-988 step 5.

    // FOLLOW-442 (AUD-04 / F-05): holdout decisions were never written to
    // adaptation_decisions, so the lift query's holdout denominator counted zero
    // sessions. Mirrors the treatment-arm call below (line ~1417) with
    // holdoutGroup=true, variant='control' (no bandit consulted on the holdout
    // path — matches GET's holdout logging convention), and directiveCount=0
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
        body.holdout_pct ?? DEFAULT_HOLDOUT_PCT, // holdoutPct (FOLLOW-988)
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

  // NOTE (FOLLOW-452): demoActive/demoForceModel/archetypeId/confidence/similarity
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
  segments.mark('rag_retrieval');

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
  segments.mark('listing_facts');

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
  const postLocale: 'en' | 'pl' | 'es' = body.locale ?? 'en';
  const banditArms = postLocale === 'en' ? await getBanditArms(tenantId, archetypeId) : [];
  segments.mark('bandit_arms');
  const selectedVariant =
    postLocale === 'en' ? (thompsonSample(banditArms) ?? 'control') : 'control';

  // ── FOLLOW-1061: the pre-LLM segment closes here ─────────────────────────
  // Everything above is what the 2026-08-20 12:45:51 UTC production invocation spent 101 470
  // of its 103 551 ms inside, while the model call it then made took 1962 ms. [MP-014]
  const preLlm = summarizePreLlmSegment(segments.marks());
  if (preLlm.stalled) {
    // The step name is the finding. The total alone is already on the Vercel invocation
    // record; only this line says WHICH dependency held the request.
    const detail = {
      total_ms: preLlm.totalMs,
      slowest_step: preLlm.slowestStep,
      slowest_ms: preLlm.slowestMs,
      breakdown: preLlm.breakdown,
      session_id: body.session_id,
      tenant_id: tenantId,
    };
    console.warn('[adapt] pre-LLM segment stall', JSON.stringify(detail));
    Sentry.captureMessage('adapt pre-LLM segment stall', {
      level: 'warning',
      tags: { area: 'adapt', kind: 'pre_llm_stall', step: preLlm.slowestStep },
      extra: detail,
    });
  }

  const {
    directives: textDirectives,
    source,
    fallback_reason: fallbackReason,
  } = await runDecisionTree(
    archetypeId,
    confidence,
    similarity,
    body.session_id,
    tenantId,
    postLocale,
    listingContext,
    demoActive ? demoForceModel : undefined,
    selectedVariant,
  );

  // FOLLOW-345: filter text directives by page_type before building the response.
  // On list/search/home pages, suppress per-listing headline rewrites — they are
  // only meaningful on detail pages where a single listing is in focus.
  const filteredTextDirectives = filterDirectivesByPageType(textDirectives, body.page_type);

  // Append ReorderDirective for tenants with reorder_capable + listing_ids present.
  // TICKET-AB-011: getTenantSchema now does real DB lookup + Redis cache.
  // FOLLOW-019: real affinity via cosine(archetype_embedding, listing_embedding) with
  // djb2 fallback per-listing when an embedding is missing. Batched lookups are
  // skipped when listing_ids exceeds LISTING_EMBEDDING_BATCH_LIMIT (latency guard).
  // Historical origin: apps/decision-api/src/lib/reorder.ts buildReorderDirective()
  // — dead code, no longer sync-tracked (FOLLOW-1073, FOLLOW-107).
  const allDirectives: (TextDirective | ReorderDirective)[] = [...filteredTextDirectives];
  const tenantSchema = await getTenantSchemaFromDb(tenantId);
  // FOLLOW-560: decision-level aggregate carried into logDecisionAsync below. Stays
  // 'not_applicable' unless a ReorderDirective is actually built for this request.
  let scoringPath: ScoringPath = 'not_applicable';
  if (tenantSchema && body.listing_ids && body.listing_ids.length > 0) {
    // Fetch embeddings in parallel — fail-open: any error → null → djb2 fallback.
    let archetypeEmbedding: number[] | null = null;
    let listingEmbeddings: Map<string, number[] | null> | null = null;
    // FOLLOW-560: true only when the embedding fetch was actually attempted AND succeeded
    // (i.e. neither the latency guard nor the catch below fired). Distinguishes 'djb2_guard'
    // (never attempted) from 'djb2_fallback' (attempted, degraded per-listing).
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
          '[adapt POST] embedding lookup failed — falling back to djb2 for all:',
          err instanceof Error ? err.message : err,
        );
      }
    } else {
      console.warn(
        `[adapt POST] listing_ids.length=${String(body.listing_ids.length)} exceeds ` +
          `LISTING_EMBEDDING_BATCH_LIMIT=${String(LISTING_EMBEDDING_BATCH_LIMIT)} — ` +
          `falling back to djb2 for whole batch (latency guard).`,
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
    variant: selectedVariant,
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
  // FOLLOW-358 (Rule K.1): page_context_source='page_type_derived' discriminates POST
  // rows (server-derived via pageContextFromPageType) from GET rows ('caller_supplied').
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
      selectedVariant,
      adaptDecisionId,
      demoActive, // AC6: tag demo-driven decisions for analytics exclusion
      'rulebased-bandit-v1', // modelVersion
      '', // leadId — not wired via POST body yet (FOLLOW-170)
      'page_type_derived', // pageContextSource (FOLLOW-358): POST derives from page_type
      body.holdout_pct ?? DEFAULT_HOLDOUT_PCT, // holdoutPct (FOLLOW-988)
      scoringPath, // FOLLOW-560: 'not_applicable' unless a ReorderDirective was built above
    ),
  );

  // FOLLOW-1061: the pre-LLM segment, on the SAME register FOLLOW-1056 books generations to.
  // Registered AFTER logDecisionAsync so the decision row keeps its position as the first
  // ClickHouse write of the request. Zero tokens and zero cost: the $100/day breaker sums
  // `cost_usd`, and a timing row must not move it.
  afterResponse(() =>
    logLlmCallAsync({
      sessionId: body.session_id,
      tenantId,
      archetypeId,
      model: 'none',
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      latencyMs: preLlm.totalMs,
      source: PRE_LLM_SEGMENT_SOURCE,
    }),
  );

  return NextResponse.json(response, { status: 200 });
}
