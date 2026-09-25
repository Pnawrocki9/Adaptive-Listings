/**
 * getTenantSchema() — canonical control-plane implementation.
 *
 * Reads the tenant's site schema from:
 *   1. Upstash Redis cache (key: `schema:{tenantId}`, TTL 5 min)
 *   2. Postgres via Drizzle (tenant_site_schemas table) on cache miss
 *
 * Returns null on any error — never throws. Callers should treat null as
 * "no reorder capability for this tenant" and fall back gracefully.
 *
 * The demo tenant always returns the DEMO_SCHEMA regardless of DB state so
 * that existing tests and demo sessions are unaffected.
 *
 * This function began as the control-plane twin of the Decision API Worker's
 * `reorder.ts` getTenantSchema(); that Worker was removed 2026-09-24 (FOLLOW-1262),
 * so this is now the only copy.
 *
 * @module apps/control-plane/src/lib/tenant-schema
 */

import { eq } from 'drizzle-orm';
import { createAdminClient, tenantSiteSchemas } from '@estalara/db';
import { afterResponse } from '@/lib/after-response';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Minimal per-tenant schema for reorder capability and slot annotation.
 * Originally mirrored the retired Worker's TenantSiteSchema (removed by FOLLOW-1262),
 * extended with slot_selectors (FOLLOW-340).
 */
export interface TenantSiteSchemaMin {
  reorder_capable: boolean;
  container_selector?: string;
  item_selector?: string;
  /**
   * Resolved flat slot selector map from detail_schema.slot_selectors (FOLLOW-340).
   *
   * Keyed by slot name (e.g. "headline", "description", "cta_primary"), value is the
   * primary CSS selector string extracted from the SlotSelectors.primary field of
   * the detail_schema. Absent when the tenant schema has no detail slot selectors.
   *
   * The SDK reads this from the /api/adapt response and calls annotateSlots() BEFORE
   * the first applyDirectives() so pages without hand-coded data-estalara-slot
   * attributes can receive adaptation mutations.
   */
  slot_selectors?: Record<string, string>;
}

// ─── Demo schema ──────────────────────────────────────────────────────────────

export const DEMO_SCHEMA: TenantSiteSchemaMin = {
  reorder_capable: true,
  container_selector: '[data-estalara-listings-grid]',
  item_selector: '[data-estalara-listing-id]',
};

/** Cache TTL in seconds (5 minutes). */
const CACHE_TTL_SECONDS = 300;

// ─── Upstash Redis HTTP helper ────────────────────────────────────────────────

/**
 * Read a value from Upstash Redis via the REST API.
 * Returns null when the key does not exist or when UPSTASH_REDIS_URL is not set.
 */
async function redisGet(key: string): Promise<string | null> {
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url) return null;

  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/get/${encodeURIComponent(key)}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { result?: string | null };
    return data.result ?? null;
  } catch {
    return null;
  }
}

/**
 * Write a value to Upstash Redis with EX TTL (seconds).
 * Fire-and-forget — errors are swallowed.
 */
async function redisSet(key: string, value: string, ttlSeconds: number): Promise<void> {
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url) return;

  try {
    await fetch(
      `${url.replace(/\/$/, '')}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}?EX=${String(ttlSeconds)}`,
      {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      },
    );
  } catch {
    // Fire-and-forget — cache write failures must not surface to callers.
  }
}

/**
 * Delete a key from Upstash Redis via the REST API.
 * Uses the DEL command. No-op when UPSTASH_REDIS_URL is not set.
 * Errors are propagated to the caller.
 */
async function redisDelete(key: string): Promise<void> {
  const url = process.env.UPSTASH_REDIS_URL;
  const token = process.env.UPSTASH_REDIS_TOKEN;
  if (!url) return;

  await fetch(`${url.replace(/\/$/, '')}/del/${encodeURIComponent(key)}`, {
    method: 'GET',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

// ─── DB lookup ────────────────────────────────────────────────────────────────

/**
 * Query the tenant_site_schemas table for the most recently updated schema row
 * for the given tenantId, and extract reorder fields from the JSONB schema blob.
 */
async function lookupSchemaFromDb(tenantId: string): Promise<TenantSiteSchemaMin | null> {
  try {
    const db = createAdminClient();
    const rows = await db
      .select({ schema: tenantSiteSchemas.schema })
      .from(tenantSiteSchemas)
      .where(eq(tenantSiteSchemas.tenantId, tenantId))
      .orderBy(tenantSiteSchemas.updatedAt)
      .limit(1);

    if (rows.length === 0) return null;

    // The schema JSONB contains the full TenantSiteSchema. We need index_schema fields.
    const raw = rows[0]?.schema as Record<string, unknown> | null;
    if (!raw) return null;

    // Extract index_schema from the full TenantSiteSchema blob
    const indexSchema = raw.index_schema as Record<string, unknown> | undefined;
    if (!indexSchema) return null;

    const containerSelector =
      typeof indexSchema.container_selector === 'string'
        ? indexSchema.container_selector
        : undefined;
    const itemSelector =
      typeof indexSchema.listing_card_selector === 'string'
        ? indexSchema.listing_card_selector
        : undefined;

    const schema: TenantSiteSchemaMin = {
      reorder_capable: Boolean(indexSchema.reorder_capable),
    };
    if (containerSelector !== undefined) schema.container_selector = containerSelector;
    if (itemSelector !== undefined) schema.item_selector = itemSelector;

    // FOLLOW-340: Extract flat slot selector map from detail_schema.slot_selectors.
    // SlotSelectors values are SelectorStrategy objects — we use only the `primary`
    // CSS selector string. Absent/null entries are skipped. Fail-safe: any error in
    // this extraction block leaves slot_selectors absent on the returned schema.
    try {
      const detailSchema = raw.detail_schema as Record<string, unknown> | undefined;
      const slotSelectorsRaw = detailSchema?.slot_selectors as Record<string, unknown> | undefined;
      if (slotSelectorsRaw && typeof slotSelectorsRaw === 'object') {
        const resolved: Record<string, string> = {};
        for (const [name, strategy] of Object.entries(slotSelectorsRaw)) {
          if (strategy && typeof strategy === 'object') {
            const primary = (strategy as Record<string, unknown>).primary;
            if (typeof primary === 'string' && primary.length > 0) {
              resolved[name] = primary;
            }
          }
        }
        if (Object.keys(resolved).length > 0) {
          schema.slot_selectors = resolved;
        }
      }
    } catch {
      // Fail-safe: slot_selectors extraction failure must never block schema lookup.
    }

    return schema;
  } catch (err) {
    console.error('[tenant-schema] DB lookup failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Return the tenant's minimal site schema for reorder capability.
 *
 * Resolution order:
 *   1. Demo tenant → DEMO_SCHEMA (no cache/DB)
 *   2. Redis cache at `schema:{tenantId}` (5-min TTL)
 *   3. DB lookup (tenant_site_schemas table) → populate cache
 *   4. null on any error
 *
 * Never throws. Always returns TenantSiteSchemaMin | null.
 *
 * @param tenantId - The tenant UUID (or 'est_demo_tenant' for demo).
 * @returns TenantSiteSchemaMin when a reorder-capable schema is found, null otherwise.
 */
export async function getTenantSchema(tenantId: string): Promise<TenantSiteSchemaMin | null> {
  // Backward compat: demo tenant always uses the hard-coded demo schema.
  if (tenantId === 'est_demo_tenant') {
    return DEMO_SCHEMA;
  }

  const cacheKey = `schema:${tenantId}`;

  // 1. Check Redis cache
  try {
    const cached = await redisGet(cacheKey);
    if (cached !== null) {
      const parsed = JSON.parse(cached) as TenantSiteSchemaMin | null;
      return parsed;
    }
  } catch {
    // Cache read failure — fall through to DB
  }

  // 2. DB lookup
  const schema = await lookupSchemaFromDb(tenantId);

  // 3. Populate cache (fire-and-forget) — cache null too so we don't hammer DB.
  // FOLLOW-432 / Rule K.2: wrapped in afterResponse() so the Upstash write completes
  // after the response is sent rather than being dropped on Vercel instance suspension.
  const cacheValue = JSON.stringify(schema);
  afterResponse(() => redisSet(cacheKey, cacheValue, CACHE_TTL_SECONDS));

  return schema;
}

// ─── Cache invalidation ───────────────────────────────────────────────────────

/**
 * Delete the Upstash Redis cache entry for a tenant's schema.
 *
 * Fires a DEL command against key `schema:{tenantId}`. Should be called
 * after a tenant's schema is activated so that the next adapt request
 * re-queries the DB and gets the freshly activated schema.
 *
 * This function never throws — it swallows all errors and emits a
 * `console.warn` on failure, so the caller's success path is never
 * interrupted by a cache invalidation error.
 *
 * @param tenantId - The tenant UUID whose cached schema should be evicted.
 */
export async function invalidateTenantSchemaCache(tenantId: string): Promise<void> {
  try {
    await redisDelete(`schema:${tenantId}`);
  } catch (err) {
    console.warn('[tenant-schema] cache invalidation failed for', tenantId, err);
  }
}
