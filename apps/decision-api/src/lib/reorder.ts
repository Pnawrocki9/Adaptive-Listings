/**
 * ReorderDirective builder helpers — DEPRECATED, dead code (FOLLOW-1073).
 *
 * Historical note: this file predates ADR-0004 and was, at the time it was
 * written, the canonical implementation, with control-plane's
 * `apps/control-plane/src/app/api/adapt/route.ts` maintaining a parallel copy
 * (cross-app TS imports are not supported by the tsconfig path setup here).
 * ADR-0004 §1 / ADR-0006 (CEO-ratified 2026-05-25) made the control-plane
 * route THE canonical production adapt path and this Worker's POST
 * /api/adapt handler now unconditionally returns 410 Gone
 * (`apps/decision-api/src/app/api/adapt/route.ts`) — this file has had no
 * live (non-test) caller since that change. It is slated for removal
 * alongside the rest of decision-api's orphaned lib layer by FOLLOW-107.
 *
 * `scripts/mirror-files.json` no longer registers this file against the
 * control-plane route (FOLLOW-1073, 2026-08-24): PR #825 changed the
 * control-plane's `affinityScore()`/`buildReorderDirective()` signatures to
 * add `scoring_path` instrumentation (FOLLOW-560) and this file was never
 * updated to match, because propagating that change into code already
 * scheduled for deletion is wasted effort. Do not "fix" the signatures below
 * to match the control-plane route — either delete this file (FOLLOW-107) or,
 * if it is ever revived as a live path, re-register the pair and bring both
 * sides current at that time.
 *
 * TICKET-AB-011: getTenantSchema() (below) performs a real lookup:
 *   1. Upstash Redis cache at `schema:{tenantId}` (5-min TTL)
 *   2. SCHEMA_API_URL (control-plane internal API) on cache miss
 *   3. null on any error (never throws — fail-open)
 *   Demo tenant always returns DEMO_SCHEMA for backward compat.
 *
 * @module apps/decision-api/src/lib/reorder
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Minimal per-tenant schema for reorder capability.
 * Mirrors the fields consumed from TenantSiteSchema.IndexSchema in packages/shared.
 */
export interface TenantSiteSchema {
  reorder_capable: boolean;
  container_selector?: string;
  item_selector?: string;
}

/**
 * Environment bindings consumed by getTenantSchema().
 * Added to Cloudflare Worker Env in TICKET-AB-011.
 */
export interface TenantSchemaEnv {
  /**
   * Upstash Redis REST URL.
   * Example: 'https://us1-xxxx.upstash.io'
   * When absent, cache layer is skipped and every request hits the schema API.
   */
  UPSTASH_REDIS_URL?: string;
  /**
   * Upstash Redis REST token (Bearer).
   * Required when UPSTASH_REDIS_URL is set and the database is password-protected.
   */
  UPSTASH_REDIS_TOKEN?: string;
  /**
   * Control-plane internal schema lookup URL.
   * Example: 'https://admin.estalara.com/api/internal/schema'
   * GET request with `?tenant_id=<id>` returns TenantSiteSchema | null as JSON.
   * When absent, DB fallback is skipped (demo tenant still works).
   */
  SCHEMA_API_URL?: string;
  /**
   * Shared secret for authenticating internal schema API calls.
   * Sent as `Authorization: Bearer <token>` header.
   */
  SCHEMA_API_TOKEN?: string;
}

/**
 * ReorderDirective — instructs the SDK to reorder listing cards in the DOM.
 *
 * Mirrors packages/shared/src/directives.ts ReorderDirective exactly.
 * Duplicated here because decision-api does not depend on @estalara/shared
 * (Cloudflare Worker bundle constraint — no workspace packages at runtime).
 */
export interface ReorderDirective {
  type: 'reorder';
  /** CSS selector for the grid/list container. */
  container_selector: string;
  /** CSS selector for individual listing card elements within the container. */
  item_selector: string;
  /** Scoring algorithm used to rank cards. */
  score_function: 'archetype_affinity';
  /** Ordered list of listing IDs with their affinity scores (descending). */
  scores: {
    listing_id: string;
    score: number;
  }[];
  /** Archetype ID that produced these scores. */
  archetype: string;
  /** Confidence score 0–1 from the intent engine. */
  confidence: number;
}

// ─── DEMO schema ──────────────────────────────────────────────────────────────

const DEMO_SCHEMA: TenantSiteSchema = {
  reorder_capable: true,
  container_selector: '[data-estalara-listings-grid]',
  item_selector: '[data-estalara-listing-id]',
};

// ─── Cache TTL ────────────────────────────────────────────────────────────────

const CACHE_TTL_SECONDS = 300; // 5 minutes

// ─── Upstash Redis helpers ────────────────────────────────────────────────────

async function redisGet(key: string, env: TenantSchemaEnv): Promise<string | null> {
  const url = env.UPSTASH_REDIS_URL;
  if (!url) return null;
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/get/${encodeURIComponent(key)}`, {
      headers: env.UPSTASH_REDIS_TOKEN
        ? { Authorization: `Bearer ${env.UPSTASH_REDIS_TOKEN}` }
        : {},
    });
    if (!res.ok) return null;
    const json: { result?: string | null } = await res.json();
    return json.result ?? null;
  } catch {
    return null;
  }
}

async function redisSet(
  key: string,
  value: string,
  ttlSeconds: number,
  env: TenantSchemaEnv,
): Promise<void> {
  const url = env.UPSTASH_REDIS_URL;
  if (!url) return;
  try {
    await fetch(
      `${url.replace(/\/$/, '')}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?EX=${String(ttlSeconds)}`,
      {
        method: 'GET',
        headers: env.UPSTASH_REDIS_TOKEN
          ? { Authorization: `Bearer ${env.UPSTASH_REDIS_TOKEN}` }
          : {},
      },
    );
  } catch {
    // Fire-and-forget — cache write failures must not surface to callers.
  }
}

// ─── Schema API fallback ──────────────────────────────────────────────────────

async function fetchSchemaFromApi(
  tenantId: string,
  env: TenantSchemaEnv,
): Promise<TenantSiteSchema | null> {
  const apiUrl = env.SCHEMA_API_URL;
  if (!apiUrl) return null;
  try {
    const url = `${apiUrl.replace(/\/$/, '')}?tenant_id=${encodeURIComponent(tenantId)}`;
    const res = await fetch(url, {
      headers: env.SCHEMA_API_TOKEN ? { Authorization: `Bearer ${env.SCHEMA_API_TOKEN}` } : {},
    });
    if (!res.ok) return null;
    const data: TenantSiteSchema | null = await res.json();
    return data;
  } catch {
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return the tenant's site schema for reorder capability.
 *
 * Resolution order (TICKET-AB-011):
 *   1. 'est_demo_tenant' → DEMO_SCHEMA (no cache/API — backward compat)
 *   2. Upstash Redis cache at `schema:{tenantId}` (5-min TTL)
 *   3. SCHEMA_API_URL fallback (control-plane internal endpoint)
 *   4. null on any error (never throws — log + return null)
 *
 * @param tenantId - The tenant UUID (or 'est_demo_tenant' for the demo).
 * @param env      - Worker environment bindings with optional Redis/API config.
 * @returns TenantSiteSchema if the tenant is reorder-capable, null otherwise.
 */
export async function getTenantSchema(
  tenantId: string,
  env: TenantSchemaEnv = {},
): Promise<TenantSiteSchema | null> {
  // Backward compat: demo tenant always returns the hard-coded demo schema.
  if (tenantId === 'est_demo_tenant') {
    return DEMO_SCHEMA;
  }

  const cacheKey = `schema:${tenantId}`;

  // 1. Check Redis cache
  try {
    const cached = await redisGet(cacheKey, env);
    if (cached !== null) {
      const parsed = JSON.parse(cached) as TenantSiteSchema | null;
      return parsed;
    }
  } catch {
    // Cache read failure — fall through to API
  }

  // 2. API fallback
  const schema = await fetchSchemaFromApi(tenantId, env);

  // 3. Populate cache (fire-and-forget)
  void redisSet(cacheKey, JSON.stringify(schema), CACHE_TTL_SECONDS, env);

  return schema;
}

/**
 * Produce a stable 0–1 affinity score for a listing + archetype pair via djb2-style hash.
 *
 * Used as the fallback when archetype or listing embeddings are unavailable
 * (FOLLOW-019). The key is `archetype:listingId` to ensure different
 * archetypes produce different orderings for the same set of listings.
 *
 * Not exported — an internal implementation detail of {@link buildReorderDirective}.
 * Test coverage is provided via buildReorderDirective integration tests.
 *
 * @param archetype  - Archetype identifier string (e.g. 'investor').
 * @param listingId  - Opaque listing ID string (max 64 chars per Zod schema).
 * @returns          A deterministic float in [0, 1).
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
 * Cosine similarity between two equal-length numeric vectors.
 *
 * Mirror of {@link computeCosineSimilarity} in `@estalara/shared/embeddings`.
 * Duplicated here because the decision-api Cloudflare Worker bundle does not
 * include workspace packages at runtime (see top-of-file note). Keep both
 * implementations in sync (FOLLOW-019).
 *
 * Returns a float in [-1, 1]. Throws RangeError on length mismatch or
 * zero-magnitude input — callers must guard for these cases.
 *
 * @internal
 */
function computeCosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new RangeError(
      `[reorder] Vectors must have equal length (got ${String(a.length)} and ${String(b.length)})`,
    );
  }
  if (a.length === 0) {
    throw new RangeError('[reorder] Vectors must be non-empty');
  }
  let dot = 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    sumA += ai * ai;
    sumB += bi * bi;
  }
  const magA = Math.sqrt(sumA);
  const magB = Math.sqrt(sumB);
  if (magA === 0 || magB === 0) {
    throw new RangeError('[reorder] Zero-magnitude vector — cosine similarity is undefined');
  }
  return dot / (magA * magB);
}

/**
 * Compute the affinity score for a single (archetype, listing) pair.
 *
 * Resolution order (FOLLOW-019):
 *   1. If both `archetypeEmbedding` and `listingEmbedding` are non-null and
 *      have matching dimensions → cosine similarity.
 *   2. Otherwise → djb2 fallback. Logs at debug level for observability.
 *
 * Cosine similarity is in [-1, 1] — sort still works because we sort
 * descending. The score field on the wire is documented as a float; consumers
 * should not assume [0, 1] anymore.
 *
 * @internal
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
      // Zero-magnitude or other math edge case — fall through to djb2.
      console.debug(
        `[reorder] cosine similarity failed for (${archetype}, ${listingId}) — falling back to djb2:`,
        err instanceof Error ? err.message : err,
      );
    }
  } else {
    console.debug(
      `[reorder] embedding missing for (${archetype}, ${listingId}) — falling back to djb2`,
    );
  }
  return deterministicScore(archetype, listingId);
}

/**
 * Build a ReorderDirective from a tenant schema + listing IDs.
 *
 * Scoring (FOLLOW-019):
 *   - When `archetypeEmbedding` and `listingEmbeddings[id]` are both non-null
 *     → cosine similarity (true archetype-listing affinity).
 *   - When either is null → falls back to djb2 hash (graceful degradation).
 *     This is per-listing — a partially populated `listingEmbeddings` map
 *     will mix cosine and djb2 scores across the same directive.
 *
 * Scores are sorted descending (highest first).
 *
 * Returns null when the tenant schema is not reorder-capable or the
 * container_selector is missing.
 *
 * @param schema             - The tenant site schema (from {@link getTenantSchema}).
 * @param listingIds         - Array of listing ID strings to score and sort.
 * @param archetype          - The detected archetype for this session.
 * @param confidence         - Intent confidence 0–1 (passed through to the directive).
 * @param archetypeEmbedding - Optional 1024-dim archetype embedding. When omitted
 *                             or null, every score falls back to djb2.
 * @param listingEmbeddings  - Optional map of listing_id → embedding vector.
 *                             Missing entries (or null values) trigger djb2 fallback
 *                             for that specific listing.
 * @returns                  A ReorderDirective, or null if schema is not capable.
 */
export function buildReorderDirective(
  schema: TenantSiteSchema,
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
