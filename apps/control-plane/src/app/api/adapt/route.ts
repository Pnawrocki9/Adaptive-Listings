/**
 * POST /api/adapt — the Decision API (Master Design E.1); decision history in ADR-0024.
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
import { getPlaybook } from '@estalara/shared/playbooks';
import type { SlotDirective } from '@estalara/shared/playbooks';
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
  /** Session intent vector (1536-dim) for RAG lookup; absent → RAG skipped. */
  intent_vector: z.array(z.number()).max(2048).optional(),
  /** Caller's A/B holdout assignment, logged to ClickHouse [TICKET-AB-001]. */
  holdout_group: z.boolean().optional(),
  /** Holdout rate; honoured only for the ops caller [TICKET-AB-010, FOLLOW-1201]. */
  holdout_pct: z.number().min(0).max(1).optional(),
  /** Session consent state, for holdout consent gating [TICKET-AB-010]. */
  consent_state: z.string().optional(),
  /** When true, non-granted consent skips A/B assignment [TICKET-AB-010]. */
  consent_mode_enabled: z.boolean().optional(),
  /** Content locale for slot copy; falls back to English per slot [F-09]. */
  locale: z.enum(['en', 'pl', 'es']).optional(),
});

// ─── Decision logic ───────────────────────────────────────────────────────────

// VARIANT_INDEX is derived from SEED_VARIANTS in @/lib/variant-index (Rule K.1 / FOLLOW-397).
// Imported above — no inline copy needed.

/**
 * Run the adaptation decision tree (Master Design E.1); branches 3 and 4 call the LLM gateway.
 *
 * @param archetypeId    - Archetype matched by the intent engine.
 * @param confidence     - Intent confidence 0–1.
 * @param similarity     - Cosine similarity to the matched archetype 0–1.
 * @param sessionId      - Session ID threaded to the LLM gateway for cost attribution.
 * @param tenantId       - Tenant ID threaded to the LLM gateway for cost attribution.
 * @param locale         - Content locale; slot copy falls back to 'en'.
 * @param listingContext - Listing facts + agency FAQ answers (may be empty).
 * @param forceModel     - Optional Anthropic model ID to force (DEMO MODE, DEMO-001).
 * @param variant        - Bandit variant; MUST be 'control' for holdout sessions [FOLLOW-360].
 * @returns Directives + source, plus `fallback_reason` on a fallback [FOLLOW-1056].
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
  /** Listing facts were requested but did not arrive [FOLLOW-1120]. */
  groundingMissing = false,
  /** Facts for playbook `{token}`s on the no-model branches [FOLLOW-1140, ESC-074]. */
  listingId?: string,
): Promise<{
  directives: TextDirective[];
  source: AdaptationDirectives['source'];
  /** Set only on a `playbook_fallback_*` result — see `AdaptationDirectives` [FOLLOW-1056]. */
  fallback_reason?: AdaptationDirectives['fallback_reason'];
  /** No served slot differs between arms, so the arm gets no credit [FOLLOW-1163]. */
  variant_suppressed?: true;
}> {
  // Branch 1: confidence too low — no adaptation
  if (confidence <= CONFIDENCE_THRESHOLD) {
    return { directives: [], source: 'default' };
  }

  // Fetch playbook (real data since ADP-003)

  const playbook = getPlaybook(archetypeId);

  // A stray variant is served `s.en` but logged raw, so a bad bandit table stays visible
  // [FOLLOW-405].
  const variantIndex: number | undefined = VARIANT_INDEX[variant];

  // Playbook slots → TextDirectives: locale override, then bandit variant, then `s.en` [F-09].

  // Keyed on SERVED slots, so variants on a surviving slot still earn credit [FOLLOW-1163].
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

  // Token fill on the verbatim-template branches only; an object for eslint narrowing
  // [FOLLOW-1140].
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

  // Branch 2: playbook, no LLM; property-fact slots withheld per §E.7.0 (ESC-076) [FOLLOW-1163].
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
      // Withhold beats the token signal: no token-bearing slot survives §E.7.0 here [FOLLOW-1163].
      ...(withheldSlots.length > 0
        ? { fallback_reason: 'ungrounded_directives_withheld' as const }
        : playbookTokenDrop.dropped
          ? { fallback_reason: 'unresolved_placeholder_tokens' as const }
          : {}),
    };
  }

  // Branches 3 and 4: ONE gateway call, the band picks `source` only [FOLLOW-1287]; no route budget
  // [FOLLOW-1040, MP-013, MP-014].
  const llmSource: 'llm_full' | 'llm_tweaked' =
    similarity <= LOW_SIMILARITY_THRESHOLD ? 'llm_full' : 'llm_tweaked';

  // An object, not a `let`: eslint over-narrows closure-reassigned lets [FOLLOW-1056].
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

  // `fallback_reason` names the null; `source` stays (SDK strict enum); branch 4 serves nothing
  // [FOLLOW-1056].
  if (llmSource === 'llm_full') {
    return {
      directives: [],
      source: 'playbook_fallback_llm_unavailable',
      fallback_reason: gatewayFallback.reason,
    };
  }
  // Branch 3 null → playbook with branch 2's token fill and §E.7.0 withhold [FOLLOW-1056,
  // FOLLOW-1163].
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
 * Log a decision to `adaptation_decisions` (fire-and-forget); never on opt-out/consent-skip
 * [FOLLOW-358].
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
  /** A/B holdout assignment; false when the caller sent none [TICKET-AB-001]. */
  holdoutGroup = false,
  /** Bandit variant; 'control' when the bandit was not consulted [FOLLOW-007]. */
  variant = 'control',
  /** Per-decision UUID = the response's `adapt_decision_id` [FOLLOW-105, ADR-0006]. */
  adaptDecisionId = '',
  /** DEMO MODE override, so analytics can exclude demo decisions [DEMO-001]. */
  demoOverride = false,
  /** Scorer that made this decision, so labels stay calibratable [FOLLOW-170]. */
  modelVersion = 'rulebased-bandit-v1',
  /** Durable pseudonymous lead key; empty until wired through [FOLLOW-170]. */
  leadId = '',
  /** `page_context` provenance; 'caller_supplied' is pre-FOLLOW-1287 only [FOLLOW-358]. */
  pageContextSource: 'page_type_derived' | 'legacy' = 'legacy',
  /** Holdout rate at assignment; 0 = migration 0021's default [FOLLOW-988, ADR-0022]. */
  holdoutPct = 0,
  /** Reorder scoring path; only 'cosine' means a reorder was served [FOLLOW-560, FOLLOW-1202]. */
  scoringPath: ScoringPath = 'not_applicable',
  /** Why a reorder-capable request got no `reorder`, or null [FOLLOW-1202]. */
  reorderWithheld: ReorderWithheldReason | null = null,
): Promise<void> {
  // Returns a promise for `after()`; no-op without CLICKHOUSE_URL [FOLLOW-431].
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  if (!clickhouseUrl) return Promise.resolve();

  // Column written only once migration 0022 is live (flag), or every INSERT fails silently
  // [ESC-031].
  const scoringPathColumnEnabled = process.env.SCORING_PATH_COLUMN_ENABLED === 'true';

  const clickhouseUser = process.env.CLICKHOUSE_USER ?? 'default';
  const clickhousePassword = process.env.CLICKHOUSE_PASSWORD ?? '';
  const ts = new Date().toISOString().replace('T', ' ').replace('Z', '');

  // PII-free scorer snapshot for later label replay [FOLLOW-170, FOLLOW-358].
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

  // Invariant: the column list stays one literal line and is never quoted in a comment here —
  // migration-contract-test.sh greps it [FOLLOW-560, FOLLOW-261].
  const baseQuery =
    `INSERT INTO adaptation_decisions ` +
    `(session_id, tenant_id, archetype, confidence, similarity, source, page_context, page_context_source, directive_count, holdout_group, holdout_pct, variant, adapt_decision_id, demo_override, model_version, features_snapshot, lead_id, ts) ` +
    `VALUES ({p_session_id:String}, {p_tenant_id:String}, {p_archetype:String}, ` +
    `{p_confidence:Float64}, {p_similarity:Float64}, {p_source:String}, {p_page_context:UInt32}, {p_page_context_source:String}, {p_directive_count:UInt32}, ` +
    `{p_holdout_group:UInt8}, {p_holdout_pct:Float64}, {p_variant:String}, {p_adapt_decision_id:String}, ` +
    `{p_demo_override:UInt8}, {p_model_version:String}, {p_features_snapshot:String}, {p_lead_id:String}, {p_ts:String})`;

  // migration-contract-test:OPTIONAL_COLUMN scoring_path
  // ^ machine-readable marker read by migration-contract-test.sh; both targets are unique.
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

// ── ReorderDirective helpers (this route is the only copy, FOLLOW-1262) ──

/** Minimal per-tenant reorder schema; mirrors TenantSiteSchemaMin. */
interface TenantSchema {
  reorder_capable: boolean;
  container_selector?: string;
  item_selector?: string;
}

/** Why one listing has no cosine score [FOLLOW-1202]. */
type UnscorableReason =
  | 'archetype_embedding_missing'
  | 'listing_embedding_missing'
  | 'dimension_mismatch'
  | 'cosine_failed';

/** Raw cosine in [-1, 1] for (archetype, listing), or why there is none [FOLLOW-1202]. */
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
 * `adaptation_decisions.scoring_path`; djb2 names are historical, both mean withheld [FOLLOW-1202].
 */
export type ScoringPath = 'cosine' | 'djb2_fallback' | 'djb2_guard' | 'not_applicable';

/** Countable reason a reorder-capable request got no `reorder` [FOLLOW-1202]. */
type ReorderWithheldReason = 'embeddings_missing' | 'embeddings_not_attempted';

/** Cosine-sorted reorder, or none: a partial ranking still moves cards [FOLLOW-1202]. */
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

/** Page context from page type (not a Tier, §E.7): detail → 2, else 1 [FOLLOW-357]. */
function pageContextFromPageType(
  pageType: 'listing_list' | 'listing_detail' | 'home' | 'search',
): 1 | 2 {
  return pageType === 'listing_detail' ? 2 : 1;
}

/** Drop `headline` directives off detail pages [FOLLOW-345]. */
function filterDirectivesByPageType(
  directives: TextDirective[],
  pageType: 'listing_list' | 'listing_detail' | 'home' | 'search',
): TextDirective[] {
  if (pageType === 'listing_detail') return directives;
  return directives.filter((d) => d.slot !== 'headline');
}

// ─── POST handler ─────────────────────────────────────────────────────────────

/**
 * POST /api/adapt: tenant API key via `resolveApiKey()` (ADR-0015); demo credentials only under
 * DEMO_MODE=1 [FOLLOW-451, FOLLOW-1288].
 *
 * @returns 200 AdaptationDirectives JSON.
 * @returns 400 on Zod validation failure.
 * @returns 401 on a missing or unknown credential.
 * @returns 403 when `body.tenant_id` names a different tenant than the resolved key.
 * @returns 500 under DEMO_MODE=1 when the demo secrets are not configured.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // Auth: API key always, demo variants only under DEMO_MODE=1 [FOLLOW-1288, ADR-0015].
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
      // Origin refusal keeps its 403; runs only after the key is valid [FOLLOW-943].
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

  // Profiling opt-out: neutral directives, no decision log [FOLLOW-383, §H.9].
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

  // page_context from page_type, not a Tier [FOLLOW-357].
  const pageCtx = pageContextFromPageType(body.page_type);

  // Demo JWT tenant supersedes the body; API-key tenant is authoritative [FOLLOW-260, FOLLOW-451].
  const jwtTenantId = demoAuth?.kind === 'demo_jwt' ? demoAuth.claims.tenant_id : undefined;
  const tenantId = apiKeyTenantId ?? jwtTenantId ?? body.tenant_id;

  // API key path: a mismatching body.tenant_id → 403, parity with feedback [FOLLOW-451].
  if (apiKeyTenantId && body.tenant_id !== apiKeyTenantId) {
    return NextResponse.json(
      {
        error: 'FORBIDDEN',
        message: 'tenant_id in body does not match the API key tenant',
      },
      { status: 403 },
    );
  }

  // Tenant AL OFF: neutral 200 with provenance, no decision row [FOLLOW-633].
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

  // One UUID per decision, in every response arm and the log [FOLLOW-105].
  const adaptDecisionId = crypto.randomUUID();

  // Demo override (DEMO_MODE=1) before the holdout gate, to log would-be values [FOLLOW-452].
  const demoOverride = demoMode ? await resolveDemoArchetypeOverride(tenantId) : null;
  const demoActive = demoOverride !== null;
  const archetypeId = (demoOverride?.archetypeId ??
    body.archetype_hint ??
    'neutral') as ArchetypeId;
  const confidence = demoOverride?.confidence ?? body.confidence ?? 0.5;
  const similarity = demoOverride?.similarity ?? body.similarity ?? 0.5;

  // Holdout gate: rate and arm key are configuration, fail loud when unset [FOLLOW-1201].
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
    // Holdout → no adaptation; the old ab.assignment fields live in the decision row [ADR-0022].

    // Holdout rows log the would-be archetype, or the lift holdout arm starves [FOLLOW-452].
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

  // Treatment arm: continue building directives [ADR-0022].

  // RAG: top-3 FAQ answers for this listing [TICKET-AGENCY-001].

  // TICKET-AGENCY-001: RAG retrieval — fetch top-3 FAQ answers for this listing.
  // Fail-open: retrieveListingContext never throws; returns {} on any failure.
  const ragContext = await retrieveListingContext(
    tenantId,
    body.listing_id ?? null,
    body.intent_vector ?? null,
  );

  // The listing's facts join the context: prompt and fact check share one source [FOLLOW-1022,
  // MP-010].
  const listingContext = await withListingFacts(
    ragContext,
    body.listing_id,
    similarity,
    body.locale ?? 'en',
  );

  // Facts requested but missing: say so, don't read as "LLM down" [FOLLOW-1120].
  const groundingMissing = Boolean(body.listing_id) && !hasListingFacts(listingContext);

  // Bandit variant: `en` only, frozen unless BANDIT_ENABLED=true [FOLLOW-362, FOLLOW-1286].
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

  // Credited arm: 'control' when the §E.7.0 withhold left nothing variant-bearing [FOLLOW-1163].
  const recordedVariant = variantSuppressed ? 'control' : selectedVariant;

  // No per-listing headline off detail pages [FOLLOW-345].
  const filteredTextDirectives = filterDirectivesByPageType(textDirectives, body.page_type);

  // Reorder fails CLOSED (`reorderWithheld` says why); text stays fail-open [FOLLOW-1202].
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
    // True only when the embedding fetch ran: djb2_guard vs djb2_fallback [FOLLOW-560].
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

  // Chat-intent prior bridge: live-influencing, fail-open on Redis errors [FOLLOW-346, FOLLOW-635].
  let chatIntentDimensions: Record<string, string> | null = null;
  // Stamp travels with the dimensions: one fold per message [FOLLOW-1024].
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

  // Curated slot_selectors for no-code pages; omitted when absent [FOLLOW-340].
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
    // Only on a fallback: tells an LLM outage from a refusal [FOLLOW-1056].
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

  // page_context_source='page_type_derived'; registered via after() [FOLLOW-358, FOLLOW-431].
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
