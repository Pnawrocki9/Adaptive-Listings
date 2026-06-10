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
 *
 * POST /api/adapt
 *
 * Demo-mode adaptation endpoint. Accepts a JSON body with archetype hint,
 * confidence, similarity, and session context. Requires a valid HS256 JWT
 * signed by DEMO_MODE_JWT_SECRET (FOLLOW-205 — presence-only check removed).
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
import { assignHoldout, DEFAULT_HOLDOUT_PCT, thompsonSample } from '@estalara/shared';
import { getPlaybook } from '@estalara/sdk/playbooks';
import type { SlotDirective } from '@estalara/sdk/playbooks';
import { callLlmGateway } from '@/lib/llm-gateway';
import { getAuthClaims } from '@estalara/auth';
import { retrieveListingContext } from '@/lib/rag-retrieval';
import { publishAbAssignmentEvent } from '@/lib/ab-events';
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
} from '@/lib/demo-jwt-verify';

// ─── Constants ────────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 0.6;
const HIGH_SIMILARITY_THRESHOLD = 0.85;
const LOW_SIMILARITY_THRESHOLD = 0.6;

// ─── Pilot freeze guard (FOLLOW-106) ─────────────────────────────────────────

/**
 * Lane C feature flags that must not be silently active while the pilot tenant
 * is in the measurement window (`pilot_frozen = true`).
 *
 * Each flag key maps to a path inside the `quizConfig` JSONB column. New Lane C
 * flags (e.g. `tenants.quiz_enabled` from FOLLOW-102, intent-engine toggles from
 * FOLLOW-087/100/101) should be added here as they land. The check is intentionally
 * conservative — unknown/undefined values are treated as inactive (flag absent = safe).
 *
 * Per PILOT_FREEZE_RULE.md §Decision 3 and Master Design v3.0: this warning is
 * NON-BLOCKING. It never changes the response or throws; it is purely observability.
 */
const LANE_C_FLAG_KEYS = [
  'lane_c_active', // generic escape-hatch flag — any explicitly set sentinel
  'intent_engine_enabled', // FOLLOW-087/100/101 — chat NLP intent bridge
  'enabled', // FOLLOW-102 — quiz widget ON/OFF toggle (QuizConfig writes cfg.enabled, not cfg.quiz_enabled)
  'shadow_mode_override', // explicit shadow-mode bypass flag
] as const;

/**
 * Reads the tenant record from Postgres and emits a structured warning (via
 * `console.warn`) when `pilot_frozen = true` AND any Lane C feature flag is
 * active in `quizConfig`.
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

  // Fire-and-forget — never awaited, never surfaces to callers.
  void (async () => {
    try {
      const db = createAdminClient();
      const rows = await db
        .select({
          pilotFrozen: tenants.pilotFrozen,
          quizConfig: tenants.quizConfig,
        })
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);

      const row = rows[0];
      if (!row?.pilotFrozen) return;

      // pilot_frozen = true — check for any active Lane C flag.
      const cfg = (row.quizConfig ?? {}) as Record<string, unknown>;
      const activeFlags = LANE_C_FLAG_KEYS.filter((key) => cfg[key] === true);

      if (activeFlags.length > 0) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            event: 'pilot_frozen_lane_c_active',
            tenant_id: tenantId,
            request_id: requestId,
            active_lane_c_flags: activeFlags,
            message:
              'Tenant has pilot_frozen=true but Lane C feature flags are active. ' +
              'This may contaminate the CTA-lift measurement window. ' +
              'Per PILOT_FREEZE_RULE.md, Lane C features must be gated OFF while ' +
              'the measurement window is open. This warning is non-blocking.',
          }),
        );
      }
    } catch (err: unknown) {
      // Analytics/observability failures must never surface to callers.
      console.error('[adapt] pilot_frozen check failed:', err instanceof Error ? err.message : err);
    }
  })();
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

/**
 * Run the adaptation decision tree per Master Design E.1.
 * Now async: branches 3 and 4 call the LLM gateway (ADP-002).
 * TICKET-AGENCY-001: accepts precomputed `listingContext` for RAG injection.
 *
 * @param archetypeId    - Archetype matched by the intent engine.
 * @param confidence     - Intent confidence 0–1.
 * @param similarity     - Cosine similarity to the matched archetype 0–1.
 * @param sessionId      - Session ID threaded to LLM gateway for cost attribution.
 * @param tenantId       - Tenant ID threaded to LLM gateway for cost attribution.
 * @param locale         - Content locale; slot copy falls back to 'en' when locale override absent.
 * @param listingContext - Agency FAQ answers from RAG retrieval (may be empty).
 * @param forceModel     - Optional Anthropic model ID to force (DEMO MODE, DEMO-001).
 * @returns Partial adaptation result (directives + source).
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
): Promise<{
  directives: TextDirective[];
  source: AdaptationDirectives['source'];
}> {
  // Branch 1: confidence too low — no adaptation
  if (confidence <= CONFIDENCE_THRESHOLD) {
    return { directives: [], source: 'default' };
  }

  // Fetch playbook (real data since ADP-003)

  const playbook = getPlaybook(archetypeId);

  // Convert playbook slots → TextDirectives; prefer locale override, fall back to English [F-09].

  const playbookDirectives: TextDirective[] = playbook.slots.map((s: SlotDirective) => ({
    type: 'text' as const,

    slot: s.slot,

    value: (locale === 'pl' ? s.pl : locale === 'es' ? s.es : undefined) ?? s.en,
    archetype: archetypeId,
    confidence,
  }));

  // Branch 2: high similarity — use playbook directly (no LLM)
  if (similarity > HIGH_SIMILARITY_THRESHOLD) {
    return { directives: playbookDirectives, source: 'playbook' };
  }

  // Branch 4: similarity too low — full LLM generation
  if (similarity <= LOW_SIMILARITY_THRESHOLD) {
    const gatewayResult = await callLlmGateway({
      archetypeId,
      confidence,
      similarity,

      basePlaybook: playbook,
      listingContext,
      sessionId,
      tenantId,
      ...(forceModel ? { forceModel } : {}),
    });

    if (gatewayResult) {
      return { directives: gatewayResult.directives, source: 'llm_full' };
    }

    // Gateway returned null — check if it was a cap issue (logged in gateway)
    return { directives: [], source: 'playbook_fallback_llm_unavailable' };
  }

  // Branch 3: medium similarity — Haiku LLM tweak of playbook
  const gatewayResult = await callLlmGateway({
    archetypeId,
    confidence,
    similarity,

    basePlaybook: playbook,
    listingContext,
    sessionId,
    tenantId,
    ...(forceModel ? { forceModel } : {}),
  });

  if (gatewayResult) {
    return { directives: gatewayResult.directives, source: 'llm_tweaked' };
  }

  // Gateway returned null — fall back to playbook directives
  return { directives: playbookDirectives, source: 'playbook_fallback_llm_unavailable' };
}

// ─── ClickHouse logging (fire-and-forget) ─────────────────────────────────────

function logDecisionAsync(
  sessionId: string,
  tenantId: string,
  archetype: string,
  confidence: number,
  similarity: number,
  source: string,
  tier: number,
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
): void {
  // Fire-and-forget — never awaited, never blocks the response.
  // No-op when CLICKHOUSE_URL is not configured.
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  if (!clickhouseUrl) return;

  const clickhousePassword = process.env.CLICKHOUSE_PASSWORD ?? '';
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');

  // Conversion Label Loop (FOLLOW-170, §T): PII-free snapshot of the scorer inputs/outputs
  // the server saw at decision time, so a stored label can later be replayed against a future
  // model. Only non-PII signals — no session/lead identifiers go in the snapshot.
  const featuresSnapshot = JSON.stringify({
    archetype,
    confidence,
    similarity,
    source,
    tier,
    holdout: holdoutGroup,
    variant,
  });

  // FOLLOW-261 (F-30): parameterized INSERT — {name:Type} placeholders eliminate string
  // interpolation; values passed as ?param_name= URL query params (ClickHouse HTTP interface).
  const query =
    `INSERT INTO adaptation_decisions ` +
    `(session_id, tenant_id, archetype, confidence, similarity, source, tier, directive_count, holdout_group, variant, adapt_decision_id, demo_override, model_version, features_snapshot, lead_id, ts) ` +
    `VALUES ({p_session_id:String}, {p_tenant_id:String}, {p_archetype:String}, ` +
    `{p_confidence:Float64}, {p_similarity:Float64}, {p_source:String}, {p_tier:UInt32}, {p_directive_count:UInt32}, ` +
    `{p_holdout_group:UInt8}, {p_variant:String}, {p_adapt_decision_id:String}, ` +
    `{p_demo_override:UInt8}, {p_model_version:String}, {p_features_snapshot:String}, {p_lead_id:String}, {p_ts:String})`;

  const url = new URL(clickhouseUrl);
  url.searchParams.set('param_p_session_id', sessionId);
  url.searchParams.set('param_p_tenant_id', tenantId);
  url.searchParams.set('param_p_archetype', archetype);
  url.searchParams.set('param_p_confidence', String(confidence));
  url.searchParams.set('param_p_similarity', String(similarity));
  url.searchParams.set('param_p_source', source);
  url.searchParams.set('param_p_tier', String(tier));
  url.searchParams.set('param_p_directive_count', String(directiveCount));
  url.searchParams.set('param_p_holdout_group', holdoutGroup ? '1' : '0');
  url.searchParams.set('param_p_variant', variant);
  url.searchParams.set('param_p_adapt_decision_id', adaptDecisionId);
  url.searchParams.set('param_p_demo_override', demoOverride ? '1' : '0');
  url.searchParams.set('param_p_model_version', modelVersion);
  url.searchParams.set('param_p_features_snapshot', featuresSnapshot);
  url.searchParams.set('param_p_lead_id', leadId);
  url.searchParams.set('param_p_ts', ts);

  fetch(url.toString(), {
    method: 'POST',
    body: query,
    headers: {
      'Content-Type': 'text/plain',
      ...(clickhousePassword
        ? {
            Authorization: `Basic ${Buffer.from(`:${clickhousePassword}`).toString('base64')}`,
          }
        : {}),
    },
  }).catch((err: unknown) => {
    // Analytics failures must not surface to callers
    console.error('[adapt] ClickHouse log failed:', err instanceof Error ? err.message : err);
  });
}

// ─── ReorderDirective helpers ─────────────────────────────────────────────────
//
// Canonical implementation: apps/decision-api/src/lib/reorder.ts
// Duplicated here because cross-app TypeScript imports are not supported by the
// tsconfig path setup (decision-api has no @estalara/* workspace packages and
// control-plane cannot import from apps/decision-api directly).
// Keep in sync with the canonical version in reorder.ts.
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
 * Key order is `archetype:listingId` — matches canonical implementation exactly.
 *
 * Canonical: apps/decision-api/src/lib/reorder.ts deterministicScore()
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
 * Compute the affinity score for a single (archetype, listing) pair.
 *
 * Mirror of the canonical implementation in apps/decision-api/src/lib/reorder.ts
 * (FOLLOW-019). Uses cosine similarity when both embeddings are present and
 * dimension-matched; falls back to djb2 hash otherwise.
 */
function affinityScore(
  archetype: string,
  listingId: string,
  archetypeEmbedding: number[] | null,
  listingEmbedding: number[] | null,
): number {
  if (
    archetypeEmbedding !== null &&
    listingEmbedding !== null &&
    archetypeEmbedding.length > 0 &&
    archetypeEmbedding.length === listingEmbedding.length
  ) {
    try {
      return computeCosineSimilarity(archetypeEmbedding, listingEmbedding);
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
  return deterministicScore(archetype, listingId);
}

/**
 * Build a ReorderDirective from a tenant schema + listing IDs.
 *
 * Scoring (FOLLOW-019):
 *   - Cosine similarity when archetype + listing embeddings are present and
 *     dimension-matched.
 *   - djb2 fallback per-listing when either is missing.
 *
 * Sorted descending (highest first). Returns null when schema is not
 * reorder-capable or container_selector is missing.
 *
 * Canonical: apps/decision-api/src/lib/reorder.ts buildReorderDirective()
 */
function buildReorderDirective(
  schema: TenantSchema,
  listingIds: string[],
  archetype: string,
  confidence: number,
  archetypeEmbedding: number[] | null = null,
  listingEmbeddings: Map<string, number[] | null> | null = null,
): ReorderDirective | null {
  if (!schema.reorder_capable || !schema.container_selector) {
    return null;
  }
  const scores = listingIds.map((id) => ({
    listing_id: id,
    score: affinityScore(archetype, id, archetypeEmbedding, listingEmbeddings?.get(id) ?? null),
  }));
  scores.sort((a, b) => b.score - a.score);
  return {
    type: 'reorder',
    container_selector: schema.container_selector,
    item_selector: schema.item_selector ?? '[data-estalara-listing-id]',
    score_function: 'archetype_affinity',
    scores,
    archetype,
    confidence,
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
 *   tier        — required, 1 | 2 | 3
 *
 * @returns 200 AdaptationDirectives JSON on valid params, even when source is 'default'.
 * @returns 400 ErrorResponseBody on invalid or missing params.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID();

  // ── Auth gate — same pattern as decision-api Worker ───────────────────────
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
  const adaptApiKey = process.env.ADAPT_API_KEY;
  if (adaptApiKey && token !== adaptApiKey) {
    return NextResponse.json(
      errorBody({
        code: ErrorCode.FORBIDDEN,
        message: 'Invalid API key',
        requestId,
      }),
      { status: 401 },
    );
  }
  // When ADAPT_API_KEY is unset: presence-only auth (non-empty token is sufficient — backward compat with dev)

  const params = req.nextUrl.searchParams;

  // ── Tenant + locale resolution (before decision tree for attribution) ─────
  // Prefer JWT-verified tenant_id; fall back to x-tenant-id for SDK calls without JWT.
  const tenantId: string =
    (await getAuthClaims(req))?.tenant_id ?? req.headers.get('x-tenant-id') ?? 'unknown';
  const rawLocale = params.get('locale');
  const locale: 'en' | 'pl' | 'es' = rawLocale === 'pl' ? 'pl' : rawLocale === 'es' ? 'es' : 'en';

  // ── Parameter validation ──────────────────────────────────────────────────
  const sessionId = params.get('session_id');
  const archetypeRaw = params.get('archetype');
  const confidenceRaw = params.get('confidence');
  const similarityRaw = params.get('similarity');
  const tierRaw = params.get('tier');
  // Optional: holdout assignment passed by the caller (decision-api Worker).
  // Populated from assignHoldout() — see TICKET-AB-001 (PR #80).
  const holdoutGroupRaw = params.get('holdout_group');
  const holdoutGroup =
    holdoutGroupRaw === 'true' ? true : holdoutGroupRaw === 'false' ? false : false;

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

  // ── Decision tree ─────────────────────────────────────────────────────────
  const archetypeId = archetypeRaw as ArchetypeId;
  const { directives, source } = await runDecisionTree(
    archetypeId,
    confidence,
    similarity,
    sessionId,
    tenantId,
    locale,
  );

  // FOLLOW-105 / ADR-0006 §Decision 4C: stable per-decision UUID, returned in the
  // body and logged to ClickHouse for cross-correlation.
  const adaptDecisionId = crypto.randomUUID();

  const response: AdaptationDirectives = {
    adapt_decision_id: adaptDecisionId,
    session_id: sessionId,
    archetype: archetypeId,
    confidence,
    similarity,
    tier,
    directives,
    source,
    generated_at: new Date().toISOString(),
  };

  // ── Pilot freeze guard (FOLLOW-106) — non-blocking, fire-and-forget ────────
  checkPilotFrozenAsync(tenantId, requestId);

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
    'control',
    adaptDecisionId,
  );

  return NextResponse.json(response, { status: 200 });
}

// ─── POST handler ─────────────────────────────────────────────────────────────

/**
 * POST /api/adapt
 *
 * Demo-mode adaptation endpoint. Accepts a JSON body and returns AdaptationDirectives.
 * Requires a valid HS256 JWT signed by DEMO_MODE_JWT_SECRET in the Authorization:
 * Bearer header. Presence-only check replaced by cryptographic verification (FOLLOW-205).
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
 * @returns 401 if Authorization header is missing, token is not a valid JWT, or JWT is expired.
 * @returns 500 if DEMO_MODE_JWT_SECRET is not configured (deployment misconfiguration).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // JWT auth — demo mode requires a validly-signed HS256 JWT (FOLLOW-205).
  // The token is verified cryptographically using DEMO_MODE_JWT_SECRET via
  // crypto.subtle (Web Crypto, no new dependency). Presence-only check removed.
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) {
    return NextResponse.json({ error: 'invalid_demo_token' }, { status: 401 });
  }
  try {
    await verifyDemoJwt(token);
  } catch (err) {
    if (err instanceof DemoJwtSecretMissingError) {
      // Config error — secret not set. Surface as 500 so ops are alerted.
      // This is NOT a normal auth path; it means the deployment is misconfigured.
      return NextResponse.json({ error: 'demo_auth_misconfigured' }, { status: 500 });
    }
    if (err instanceof DemoJwtInvalidError) {
      return NextResponse.json({ error: 'invalid_demo_token' }, { status: 401 });
    }
    // Unexpected error — rethrow to surface as 500 via Next.js error handler.
    throw err;
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

  // ── Pilot freeze guard (FOLLOW-106) — non-blocking, fire-and-forget ────────
  // Emits a structured warning if pilot_frozen=true AND any Lane C feature flag
  // is active. Must run as early as possible so the warning precedes any response.
  checkPilotFrozenAsync(body.tenant_id, crypto.randomUUID());

  // FOLLOW-105 / ADR-0006 §Decision 4C: stable per-decision UUID. Generated once
  // per request and returned in EVERY response arm (skip, holdout, treatment) and
  // logged to ClickHouse so a response body can be cross-correlated with its row.
  const adaptDecisionId = crypto.randomUUID();

  // ── A/B holdout gate (TICKET-AB-010) ─────────────────────────────────────
  // Run before any directive building. Returns early with empty directives
  // when the session is held-out or consent-skipped.
  const assignment = await assignHoldout({
    tenant_id: body.tenant_id,
    session_id: body.session_id,
    ...(body.consent_state !== undefined ? { consent_state: body.consent_state } : {}),
    consent_mode_enabled: body.consent_mode_enabled ?? false,
    holdout_pct: body.holdout_pct ?? DEFAULT_HOLDOUT_PCT,
  });

  if (assignment.skipped) {
    // AC-3: consent skip → no adaptation, no holdout_group field.
    return NextResponse.json({
      adapt_decision_id: adaptDecisionId,
      session_id: body.session_id,
      archetype: 'neutral',
      confidence: 0.5,
      similarity: body.similarity ?? 0.5,
      tier: 1,
      directives: [],
      reorderDirectives: [],
      source: 'default' as const,
      generated_at: new Date().toISOString(),
    });
  }

  if (assignment.holdout_group) {
    // AC-2: holdout → no adaptation, emit ab.assignment event fire-and-forget.
    void publishAbAssignmentEvent({
      session_id: body.session_id,
      tenant_id: body.tenant_id,
      holdout_group: true,
      holdout_pct: body.holdout_pct ?? DEFAULT_HOLDOUT_PCT,
      assigned_at: assignment.assigned_at,
    }).catch((e: unknown) => {
      console.error('[adapt POST] ab.assignment emit failed', e instanceof Error ? e.message : e);
    });

    return NextResponse.json({
      adapt_decision_id: adaptDecisionId,
      session_id: body.session_id,
      archetype: 'neutral',
      confidence: 0.5,
      similarity: body.similarity ?? 0.5,
      tier: 1,
      directives: [],
      reorderDirectives: [],
      source: 'default' as const,
      holdout_group: true,
      generated_at: new Date().toISOString(),
    });
  }

  // Treatment arm: emit ab.assignment event and continue building directives.
  void publishAbAssignmentEvent({
    session_id: body.session_id,
    tenant_id: body.tenant_id,
    holdout_group: false,
    holdout_pct: body.holdout_pct ?? DEFAULT_HOLDOUT_PCT,
    assigned_at: assignment.assigned_at,
  }).catch((e: unknown) => {
    console.error('[adapt POST] ab.assignment emit failed', e instanceof Error ? e.message : e);
  });

  // ── DEMO MODE override (DEMO-001 / AC4) ─────────────────────────────────────
  // Load the per-tenant demo override. When enabled, ignore the SDK's
  // archetype_hint/confidence/similarity and substitute the operator-chosen values
  // so the full playbook + LLM path runs, generating with the chosen model.
  // Fail behaviour: if the DB throws (configured-but-failed), log a Sentry-style
  // error, set demoActive=false, and continue with the normal SDK hint. This avoids
  // silently serving wrong copy while not blocking the response.
  let demoActive = false;
  let demoForceModel: string | undefined;
  // F-16 (FOLLOW-194): store the single getDemoOverride() result and reuse it below.
  // The original code called getDemoOverride() a second time inside the demoActive branch,
  // causing a duplicate DB/Redis round-trip on every adapt request in demo mode.
  let demoOverrideArchetype: string | null = null;

  try {
    const demoOverrideState = await getDemoOverride(body.tenant_id);
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

  // TICKET-AGENCY-001: RAG retrieval — fetch top-3 FAQ answers for this listing.
  // Fail-open: retrieveListingContext never throws; returns {} on any failure.
  const listingContext = await retrieveListingContext(
    body.tenant_id,
    body.listing_id ?? null,
    body.intent_vector ?? null,
  );

  const { directives: textDirectives, source } = await runDecisionTree(
    archetypeId,
    confidence,
    similarity,
    body.session_id,
    body.tenant_id,
    body.locale ?? 'en',
    listingContext,
    demoActive ? demoForceModel : undefined,
  );

  // ── FOLLOW-007: Thompson sampling variant selection ───────────────────────
  // Query bandit arms for (tenant_id, archetype) and sample a variant.
  // Auto-seeds 3 arms (control, v1, v2) with Beta(1, 1) on first request.
  // When all arms are paused (or DB unavailable), defaults to 'control'.
  const banditArms = await getBanditArms(body.tenant_id, archetypeId);
  const selectedVariant = thompsonSample(banditArms) ?? 'control';

  // Append ReorderDirective for tenants with reorder_capable + listing_ids present.
  // TICKET-AB-011: getTenantSchema now does real DB lookup + Redis cache.
  // FOLLOW-019: real affinity via cosine(archetype_embedding, listing_embedding) with
  // djb2 fallback per-listing when an embedding is missing. Batched lookups are
  // skipped when listing_ids exceeds LISTING_EMBEDDING_BATCH_LIMIT (latency guard).
  // Canonical decision-api helper: apps/decision-api/src/lib/reorder.ts buildReorderDirective()
  const allDirectives: (TextDirective | ReorderDirective)[] = [...textDirectives];
  const tenantSchema = await getTenantSchemaFromDb(body.tenant_id);
  if (tenantSchema && body.listing_ids && body.listing_ids.length > 0) {
    // Fetch embeddings in parallel — fail-open: any error → null → djb2 fallback.
    let archetypeEmbedding: number[] | null = null;
    let listingEmbeddings: Map<string, number[] | null> | null = null;

    if (body.listing_ids.length <= LISTING_EMBEDDING_BATCH_LIMIT) {
      try {
        const [archEmb, listEmbs] = await Promise.all([
          fetchArchetypeEmbedding(archetypeId),
          fetchListingEmbeddings(body.tenant_id, body.listing_ids),
        ]);
        archetypeEmbedding = archEmb;
        listingEmbeddings = listEmbs;
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

    const reorderDirective = buildReorderDirective(
      tenantSchema,
      body.listing_ids,
      archetypeId,
      confidence,
      archetypeEmbedding,
      listingEmbeddings,
    );
    if (reorderDirective !== null) {
      allDirectives.push(reorderDirective);
    }
  }

  const response: AdaptationDirectives = {
    adapt_decision_id: adaptDecisionId,
    session_id: body.session_id,
    archetype: archetypeId,
    confidence,
    similarity,
    tier: 1,
    directives: allDirectives,
    source,
    variant: selectedVariant,
    // AC6: provenance flag so the consumer / analytics can exclude demo decisions.
    ...(demoActive ? { demo_override: true } : {}),
    generated_at: new Date().toISOString(),
  };

  // Fire-and-forget ClickHouse log using tenant_id from body.
  logDecisionAsync(
    body.session_id,
    body.tenant_id,
    archetypeId,
    confidence,
    similarity,
    source,
    1,
    allDirectives.length,
    false, // treatment arm — not holdout
    selectedVariant,
    adaptDecisionId,
    demoActive, // AC6: tag demo-driven decisions for analytics exclusion
  );

  return NextResponse.json(response, { status: 200 });
}
