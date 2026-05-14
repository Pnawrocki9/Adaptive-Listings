/**
 * ReorderDirective builder helpers — canonical implementation.
 *
 * Canonical location: apps/decision-api/src/lib/reorder.ts
 *
 * The control-plane adapt POST route has a parallel implementation in
 * apps/control-plane/src/lib/tenant-schema.ts (TICKET-AB-011).
 * Cross-app TS imports are not supported by the tsconfig path setup, so
 * control-plane maintains its own copy pointing back here.
 *
 * TICKET-AB-011: getTenantSchema() now performs a real lookup:
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
   * Example: 'https://app.estalara.com/api/internal/schema'
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
 * Produce a stable 0–1 affinity score for a listing + archetype pair.
 *
 * Uses a multiplicative hash (djb2-style) so the ordering is deterministic
 * across reloads and workers. The key is `archetype:listingId` to ensure
 * different archetypes produce different orderings for the same set of listings.
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
 * Build a ReorderDirective from a tenant schema + listing IDs.
 *
 * Scores are computed deterministically via {@link deterministicScore} and
 * sorted descending (highest first).
 *
 * Returns null when the tenant schema is not reorder-capable or the
 * container_selector is missing.
 *
 * @param schema      - The tenant site schema (from {@link getTenantSchema}).
 * @param listingIds  - Array of listing ID strings to score and sort.
 * @param archetype   - The detected archetype for this session.
 * @param confidence  - Intent confidence 0–1 (passed through to the directive).
 * @returns           A ReorderDirective, or null if schema is not capable.
 */
export function buildReorderDirective(
  schema: TenantSiteSchema,
  listingIds: string[],
  archetype: string,
  confidence: number,
): ReorderDirective | null {
  if (!schema.reorder_capable || !schema.container_selector) {
    return null;
  }

  const scores = listingIds.map((id) => ({
    listing_id: id,
    score: deterministicScore(archetype, id),
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
