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
 * This function is the control-plane twin of apps/decision-api/src/lib/reorder.ts
 * getTenantSchema(). They must remain in sync on the TenantSiteSchema shape.
 * Cross-app imports are not supported — see reorder.ts for the canonical note.
 *
 * @module apps/control-plane/src/lib/tenant-schema
 */

import { eq } from 'drizzle-orm';
import { createAdminClient, tenantSiteSchemas } from '@estalara/db';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Minimal per-tenant schema for reorder capability.
 * Mirrors apps/decision-api/src/lib/reorder.ts TenantSiteSchema exactly.
 */
export interface TenantSiteSchemaMin {
  reorder_capable: boolean;
  container_selector?: string;
  item_selector?: string;
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

  // 3. Populate cache (fire-and-forget) — cache null too so we don't hammer DB
  const cacheValue = JSON.stringify(schema);
  void redisSet(cacheKey, cacheValue, CACHE_TTL_SECONDS);

  return schema;
}
