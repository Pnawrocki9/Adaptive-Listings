/**
 * description-pg-cache — Postgres-backed permanent cache helpers for the long-form
 * listing description pipeline (FOLLOW-204, Master Design §E.7.3 v4.0).
 *
 * Lookup order per §E.7.2:
 *   1. description_cache_persistent (this module) — if found and not invalidated → return
 *   2. Upstash Redis (hot-path fast cache) — if found → return + async backfill here
 *   3. template_fallback immediately + fire-and-forget Modal enqueue
 *
 * Read paths are fail-open: on a configured-but-throwing DB, functions log and return
 * null / [] so the route falls through gracefully (K.2: observable via console.error).
 * The invalidation path is NOT fail-open — it throws so the webhook handler can capture
 * to Sentry.
 *
 * @module apps/control-plane/src/lib/description-pg-cache
 */

import {
  createTenantClient,
  descriptionCachePersistent,
  type DescriptionCachePersistent,
} from '@estalara/db';
import { and, eq, isNull, desc } from 'drizzle-orm';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * The subset of a description_cache_persistent row returned to callers.
 * Mirrors DescriptionCacheValue from @estalara/shared for downstream compatibility.
 */
export interface PgDescriptionCacheHit {
  description: string;
  headline: string | null;
  generatedAt: string; // ISO 8601 UTC
  model: string;
}

// ─── Internal DB factory ──────────────────────────────────────────────────────

/**
 * Returns a tenant-scoped Drizzle client, or null when DATABASE_URL is not configured.
 * Null is the "not configured" signal (dev/CI fallthrough OK per guardrail K.2).
 */
function getDb() {
  if (!process.env.DATABASE_URL) return null;
  try {
    return createTenantClient();
  } catch {
    return null;
  }
}

/** Normalise a Date | string | null to ISO string or null. */
function toIso(v: Date | string | null | undefined): string | null {
  if (!v) return null;
  return v instanceof Date ? v.toISOString() : v;
}

// ─── Lookup: Postgres → first valid (non-invalidated) row ────────────────────

/**
 * Look up a description from description_cache_persistent.
 *
 * Returns the most recent non-invalidated row for (tenant, listing, archetype, locale),
 * or null when:
 *   - No valid row exists (expected on cold start)
 *   - DATABASE_URL is not configured (dev/CI)
 *   - A configured DB threw — logs and returns null (route falls through to Redis)
 *
 * @param tenantId  - Tenant UUID string.
 * @param listingId - Listing external identifier.
 * @param archetype - Archetype ID (e.g. 'yield_hunter').
 * @param locale    - Locale code (e.g. 'en').
 */
export async function getPgCachedDescription(
  tenantId: string,
  listingId: string,
  archetype: string,
  locale: string,
): Promise<PgDescriptionCacheHit | null> {
  const db = getDb();
  if (!db) return null; // DATABASE_URL not configured — dev/CI fallthrough OK

  try {
    const rows: Pick<
      DescriptionCachePersistent,
      'description' | 'headline' | 'generatedAt' | 'model'
    >[] = await db
      .select({
        description: descriptionCachePersistent.description,
        headline: descriptionCachePersistent.headline,
        generatedAt: descriptionCachePersistent.generatedAt,
        model: descriptionCachePersistent.model,
      })
      .from(descriptionCachePersistent)
      .where(
        and(
          eq(descriptionCachePersistent.tenantId, tenantId),
          eq(descriptionCachePersistent.listingId, listingId),
          eq(descriptionCachePersistent.archetype, archetype),
          eq(descriptionCachePersistent.locale, locale),
          isNull(descriptionCachePersistent.invalidatedAt),
        ),
      )
      .orderBy(desc(descriptionCachePersistent.generatedAt))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      description: row.description,
      headline: row.headline ?? null,
      generatedAt: toIso(row.generatedAt) ?? new Date().toISOString(),
      model: row.model,
    };
  } catch (err: unknown) {
    // Configured DB threw — log (observable) and fall through (K.2).
    console.error(
      '[description-pg-cache] getPgCachedDescription failed — falling through to Redis:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ─── Write: insert a new valid row after Modal generation ────────────────────

/**
 * Insert a new description_cache_persistent row after Modal generation completes.
 *
 * Fail-open: logs on error but does not throw, so the Modal job callback does not
 * fail due to a DB write error (the Redis entry is still the hot-path source of truth).
 *
 * @param tenantId    - Tenant UUID string.
 * @param listingId   - Listing external identifier.
 * @param archetype   - Archetype ID.
 * @param locale      - Locale code.
 * @param description - AI-generated description text.
 * @param headline    - AI-generated headline, or null.
 * @param model       - Anthropic model id that generated this entry.
 */
export async function insertPgCachedDescription(
  tenantId: string,
  listingId: string,
  archetype: string,
  locale: string,
  description: string,
  headline: string | null,
  model: string,
): Promise<void> {
  const db = getDb();
  if (!db) return; // DATABASE_URL not configured — dev/CI no-op OK

  try {
    await db.insert(descriptionCachePersistent).values({
      tenantId,
      listingId,
      archetype,
      locale,
      description,
      headline: headline ?? null,
      model,
    });
  } catch (err: unknown) {
    // Configured DB threw — log (observable) but do not throw (fail-open write path).
    // Redis entry is already written; this is the durable backup layer.
    console.error(
      '[description-pg-cache] insertPgCachedDescription failed — Redis entry still valid:',
      err instanceof Error ? err.message : err,
    );
  }
}

// ─── Invalidation: called by listing.updated webhook ────────────────────────

/**
 * Invalidate all active description_cache_persistent rows for a (tenant, listing) pair
 * by setting invalidated_at = NOW().
 *
 * NOT fail-open: throws on configured-DB error so the webhook handler can surface to
 * Sentry. The webhook is responsible for deciding whether to 500 or absorb.
 *
 * Idempotent: calling twice for the same listing is safe — the WHERE clause filters
 * to only non-invalidated rows.
 *
 * @param tenantId  - Tenant UUID string.
 * @param listingId - Listing external identifier.
 * @throws {Error} when DATABASE_URL is configured but the UPDATE fails.
 */
export async function invalidatePgDescriptionCache(
  tenantId: string,
  listingId: string,
): Promise<void> {
  const db = getDb();
  if (!db) return; // DATABASE_URL not configured — dev/CI no-op OK (not a configured-but-failed case)

  // Throws on failure — caller captures to Sentry.
  await db
    .update(descriptionCachePersistent)
    .set({ invalidatedAt: new Date() })
    .where(
      and(
        eq(descriptionCachePersistent.tenantId, tenantId),
        eq(descriptionCachePersistent.listingId, listingId),
        isNull(descriptionCachePersistent.invalidatedAt),
      ),
    );
}

// ─── Admin: read all rows for a (tenant, listing) pair (dashboard AC5) ──────

/**
 * Fetch all description_cache_persistent rows for a (tenant, listing) pair,
 * ordered by generated_at DESC. Includes invalidated rows for history view.
 *
 * Used by the dashboard /dashboard/listings/[id]/descriptions page (AC5 / FOLLOW-204).
 *
 * Fail-open: returns [] when DB unavailable.
 *
 * @param tenantId  - Tenant UUID string.
 * @param listingId - Listing external identifier.
 */
export async function listPgDescriptionCache(
  tenantId: string,
  listingId: string,
): Promise<
  {
    id: string;
    archetype: string;
    locale: string;
    description: string;
    headline: string | null;
    model: string;
    generatedAt: string;
    invalidatedAt: string | null;
  }[]
> {
  const db = getDb();
  if (!db) return [];

  try {
    const rows: Pick<
      DescriptionCachePersistent,
      | 'id'
      | 'archetype'
      | 'locale'
      | 'description'
      | 'headline'
      | 'model'
      | 'generatedAt'
      | 'invalidatedAt'
    >[] = await db
      .select({
        id: descriptionCachePersistent.id,
        archetype: descriptionCachePersistent.archetype,
        locale: descriptionCachePersistent.locale,
        description: descriptionCachePersistent.description,
        headline: descriptionCachePersistent.headline,
        model: descriptionCachePersistent.model,
        generatedAt: descriptionCachePersistent.generatedAt,
        invalidatedAt: descriptionCachePersistent.invalidatedAt,
      })
      .from(descriptionCachePersistent)
      .where(
        and(
          eq(descriptionCachePersistent.tenantId, tenantId),
          eq(descriptionCachePersistent.listingId, listingId),
        ),
      )
      .orderBy(desc(descriptionCachePersistent.generatedAt));

    return rows.map((r) => ({
      id: r.id,
      archetype: r.archetype,
      locale: r.locale,
      description: r.description,
      headline: r.headline ?? null,
      model: r.model,
      generatedAt: toIso(r.generatedAt) ?? new Date().toISOString(),
      invalidatedAt: toIso(r.invalidatedAt),
    }));
  } catch (err: unknown) {
    console.error(
      '[description-pg-cache] listPgDescriptionCache failed:',
      err instanceof Error ? err.message : err,
    );
    return [];
  }
}
