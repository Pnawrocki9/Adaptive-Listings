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
 * Revision fence (FOLLOW-1291, Codex F-03/F-17, migration 0041):
 *   - Revision source: `listing_revisions.revision`, a LOCAL per-(tenant, listing) counter that
 *     `invalidatePgDescriptionCache` (the listing.updated webhook) advances. The listing-details
 *     backend exposes no updated_at/version, so the webhook is the only change signal. Under
 *     upstream lag (the backend sends the webhook before it serves the new text) a job can ground
 *     on the old text and carry the new revision — the fence cannot see that case.
 *   - Every row carries the revision its text was grounded at (`listing_revision`) and the model
 *     that wrote it (`model`, part of the active-row unique key since 0041).
 *   - Reads serve a row only when its revision is >= the listing's current revision.
 *   - Writes go through {@link publishPgCachedDescription}: ONE conditional UPSERT that inserts
 *     only at a revision >= the current one and replaces an active row only of the SAME model at
 *     an older-or-equal revision. A stale callback can never replace a newer valid row, and a
 *     callback of another model never touches it.
 *
 * @module apps/control-plane/src/lib/description-pg-cache
 */

import {
  createTenantClient,
  descriptionCachePersistent,
  listingRevisions,
  type DescriptionCachePersistent,
} from '@estalara/db';
import { and, eq, gte, isNull, desc, sql } from 'drizzle-orm';

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
  /**
   * Archetype-fit verdict (ADR-0010 / FOLLOW-465). Always normalised to a concrete
   * value here — a NULL `verdict` column (every row written before FOLLOW-465) is
   * normalised to `'FIT'`, the implicit verdict for pre-existing rows.
   */
  verdict: 'FIT' | 'NEUTRAL';
  /**
   * FOLLOW-1305: the claim-check version the row's text passed before it was written, or
   * `null` on a row written before the check existed (legacy — served as a miss by the route).
   */
  claimsValidation: string | null;
  /** FOLLOW-1291: the listing revision the row's text was grounded at (>= the current one). */
  listingRevision: number;
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

/**
 * The listing's current revision as a SQL scalar: `listing_revisions.revision`, or 0 when the
 * listing has never received a listing.updated webhook (FOLLOW-1291).
 */
function currentRevisionSql(tenantId: string, listingId: string) {
  return sql`coalesce((select ${listingRevisions.revision} from ${listingRevisions} where ${listingRevisions.tenantId} = ${tenantId} and ${listingRevisions.listingId} = ${listingId}), 0)`;
}

/**
 * Rows of a raw `db.execute()` result: postgres-js (production) returns the row array itself,
 * PGlite (the route-driven tests) returns `{ rows }`.
 */
function executedRows(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? rows : [];
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
 * Returns the most recent non-invalidated row for (tenant, listing, archetype, locale,
 * model), or null when:
 *   - No valid row exists (expected on cold start, or when a row exists for a
 *     DIFFERENT model — a model switch must yield a miss, not a stale-model hit)
 *   - DATABASE_URL is not configured (dev/CI)
 *   - A configured DB threw — logs and returns null (route falls through to Redis)
 *
 * The `model` filter (F-15 / FOLLOW-464) is required so this Step-1 read stays in sync
 * with the model-scoped Redis Step-2 key (`route.ts` cacheKey `:{model}` /
 * `:demo:{model}`). Without it, this Step-1 read — which runs BEFORE Redis and
 * short-circuits on both a FIT hit and a NEUTRAL negative-cache marker (FOLLOW-465,
 * ADR-0010) — could serve a stale-model FIT description or, worse, let a NEUTRAL
 * verdict recorded under one model permanently suppress generation under a different
 * model (including the DEMO `override_model` preview), since a NEUTRAL row would never
 * be superseded until `listing.updated` invalidation (RETRO-162 LG-1).
 *
 * FOLLOW-1291 (F-03): the row must also carry a `listing_revision` >= the listing's current
 * revision — the read half of the revision fence. A row grounded before the last listing.updated
 * is never served, even if a late writer slipped it in after the invalidation.
 *
 * @param tenantId  - Tenant UUID string.
 * @param listingId - Listing external identifier.
 * @param archetype - Archetype ID (e.g. 'yield_hunter').
 * @param locale    - Locale code (e.g. 'en').
 * @param model     - The effective generation model for this request (demo
 *                    `override_model` when DEMO MODE is active, else the global
 *                    `generation_model`) — must match the model the row was written
 *                    under, or this call must miss.
 */
export async function getPgCachedDescription(
  tenantId: string,
  listingId: string,
  archetype: string,
  locale: string,
  model: string,
): Promise<PgDescriptionCacheHit | null> {
  const db = getDb();
  if (!db) return null; // DATABASE_URL not configured — dev/CI fallthrough OK

  try {
    const rows: Pick<
      DescriptionCachePersistent,
      | 'description'
      | 'headline'
      | 'generatedAt'
      | 'model'
      | 'verdict'
      | 'claimsValidation'
      | 'listingRevision'
    >[] = await db
      .select({
        description: descriptionCachePersistent.description,
        headline: descriptionCachePersistent.headline,
        generatedAt: descriptionCachePersistent.generatedAt,
        model: descriptionCachePersistent.model,
        verdict: descriptionCachePersistent.verdict,
        claimsValidation: descriptionCachePersistent.claimsValidation,
        listingRevision: descriptionCachePersistent.listingRevision,
      })
      .from(descriptionCachePersistent)
      .where(
        and(
          eq(descriptionCachePersistent.tenantId, tenantId),
          eq(descriptionCachePersistent.listingId, listingId),
          eq(descriptionCachePersistent.archetype, archetype),
          eq(descriptionCachePersistent.locale, locale),
          eq(descriptionCachePersistent.model, model),
          isNull(descriptionCachePersistent.invalidatedAt),
          gte(descriptionCachePersistent.listingRevision, currentRevisionSql(tenantId, listingId)),
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
      // FOLLOW-465: NULL (every pre-existing row) normalises to the implicit 'FIT'.
      verdict: row.verdict === 'NEUTRAL' ? 'NEUTRAL' : 'FIT',
      claimsValidation: row.claimsValidation ?? null,
      listingRevision: row.listingRevision,
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

// ─── Revision: the listing's current revision ───────────────────────────────

/**
 * Read the listing's current revision (FOLLOW-1291) — the value the description route stamps on
 * the Redis key and on the generation job BEFORE it fetches the grounding source, so a
 * listing.updated that lands while the job runs makes the job's write stale.
 *
 * @returns The revision (0 when the listing was never updated, or when DATABASE_URL is not
 *          configured — dev/CI), or `null` when a configured DB threw: the caller cannot fence a
 *          write it cannot stamp, so it must not serve Redis or generate (fail closed).
 */
export async function getListingRevision(
  tenantId: string,
  listingId: string,
): Promise<number | null> {
  const db = getDb();
  if (!db) return 0; // DATABASE_URL not configured — dev/CI: no fence state, revision 0

  try {
    const rows: { revision: number }[] = await db
      .select({ revision: listingRevisions.revision })
      .from(listingRevisions)
      .where(
        and(eq(listingRevisions.tenantId, tenantId), eq(listingRevisions.listingId, listingId)),
      )
      .limit(1);
    return rows[0]?.revision ?? 0;
  } catch (err: unknown) {
    console.error(
      '[description-pg-cache] getListingRevision failed — cannot fence a generation:',
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

// ─── Write: atomic, revision-fenced publish ──────────────────────────────────

/**
 * Publish a description row — the one writer of description_cache_persistent (FOLLOW-1291).
 *
 * A single conditional UPSERT, so the fence and the write are one atomic statement (never
 * compare-then-separate-write):
 *   - INSERT only when `listingRevision` >= the listing's current revision. An older revision
 *     means a listing.updated landed after the job read the revision, so its text may assert a
 *     withdrawn fact (F-03).
 *   - ON CONFLICT with the active row of the SAME (tenant, listing, archetype, locale, model) —
 *     the read key — replace it only when the existing row's revision is <= the incoming one. A
 *     callback of a different model has a different key and never touches the row (F-17); a
 *     same-model callback at an older revision leaves the newer row in place. Equal revision and
 *     model replaces: a regeneration of the same grounding (e.g. a FOLLOW-1305 legacy row
 *     regenerated under the claim check).
 *
 * The insert-side check reads the revision in the statement's snapshot; a webhook that commits
 * after that snapshot but before this commit is covered by the READ fence in
 * {@link getPgCachedDescription}, which never serves a row below the current revision.
 *
 * Throws on a configured-DB error (the callback route turns that into a 500); fire-and-forget
 * callers use {@link insertPgCachedDescription}, which catches.
 *
 * @returns `'published'` when the row was inserted or replaced, `'stale'` when the fence refused
 *          it, `'not_configured'` when DATABASE_URL is unset (dev/CI no-op).
 */
export async function publishPgCachedDescription(row: {
  tenantId: string;
  listingId: string;
  archetype: string;
  locale: string;
  description: string;
  headline: string | null;
  model: string;
  /** FOLLOW-465: NULL is the implicit 'FIT'. */
  verdict: 'FIT' | 'NEUTRAL' | null;
  /** FOLLOW-1305: NULL = legacy (written without a claim check) → served as a miss. */
  claimsValidation: string | null;
  /** The listing revision the text was grounded at. */
  listingRevision: number;
}): Promise<'published' | 'stale' | 'not_configured'> {
  const db = getDb();
  if (!db) return 'not_configured'; // DATABASE_URL not configured — dev/CI no-op OK

  const result: unknown = await db.execute(sql`
    insert into description_cache_persistent
      (tenant_id, listing_id, archetype, locale, description, headline, model, verdict,
       claims_validation, listing_revision)
    select ${row.tenantId}::uuid, ${row.listingId}::text, ${row.archetype}::text,
           ${row.locale}::text, ${row.description}::text, ${row.headline}::text,
           ${row.model}::text, ${row.verdict}::text, ${row.claimsValidation}::text,
           ${row.listingRevision}::bigint
    where ${row.listingRevision}::bigint >= ${currentRevisionSql(row.tenantId, row.listingId)}
    on conflict (tenant_id, listing_id, archetype, locale, model) where invalidated_at is null
    do update set
      description       = excluded.description,
      headline          = excluded.headline,
      verdict           = excluded.verdict,
      claims_validation = excluded.claims_validation,
      listing_revision  = excluded.listing_revision,
      generated_at      = now()
    where description_cache_persistent.listing_revision <= excluded.listing_revision
    returning id
  `);
  return executedRows(result).length > 0 ? 'published' : 'stale';
}

/**
 * Fail-open wrapper of {@link publishPgCachedDescription} for the route's Redis → Postgres
 * backfill (§E.7.2 step 2): logs and swallows a configured-DB error, since the response has
 * already been served from Redis.
 *
 * @param tenantId    - Tenant UUID string.
 * @param listingId   - Listing external identifier.
 * @param archetype   - Archetype ID.
 * @param locale      - Locale code.
 * @param description - AI-generated description text.
 * @param headline    - AI-generated headline, or null.
 * @param model       - Anthropic model id that generated this entry.
 * @param claimsValidation - FOLLOW-1305: the claim-check version the text passed (copied from
 *                      the Redis entry being backfilled), or `null` when it carries none.
 * @param listingRevision - FOLLOW-1291: the revision of the Redis key the entry was read from.
 */
export async function insertPgCachedDescription(
  tenantId: string,
  listingId: string,
  archetype: string,
  locale: string,
  description: string,
  headline: string | null,
  model: string,
  claimsValidation: string | null,
  listingRevision: number,
): Promise<void> {
  try {
    const outcome = await publishPgCachedDescription({
      tenantId,
      listingId,
      archetype,
      locale,
      description,
      headline,
      model,
      verdict: null,
      claimsValidation,
      listingRevision,
    });
    if (outcome === 'stale') {
      console.warn(
        `[description-pg-cache] backfill refused by the revision fence tenant=${tenantId} ` +
          `listing=${listingId} revision=${String(listingRevision)}`,
      );
    }
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
 * listing.updated: advance the listing's revision, then invalidate all active
 * description_cache_persistent rows for the (tenant, listing) pair (invalidated_at = NOW()).
 *
 * FOLLOW-1291 (F-03): the revision bump is the fence. Every job already running for this
 * listing carries the OLD revision, so its callback is refused by
 * {@link publishPgCachedDescription}, a row that slips in anyway is never served by
 * {@link getPgCachedDescription}, and its Redis key (revision-suffixed) is never read again.
 * Both statements run in one transaction: the listing moves to a new revision AND its rows are
 * retired, or neither.
 *
 * NOT fail-open: throws on configured-DB error so the webhook handler can surface to
 * Sentry. The webhook is responsible for deciding whether to 500 or absorb.
 *
 * Every call advances the revision: a duplicate delivery only makes in-flight jobs for this
 * listing regenerate once more.
 *
 * @param tenantId  - Tenant UUID string.
 * @param listingId - Listing external identifier.
 * @throws {Error} when DATABASE_URL is configured but the transaction fails.
 */
export async function invalidatePgDescriptionCache(
  tenantId: string,
  listingId: string,
): Promise<void> {
  const db = getDb();
  if (!db) return; // DATABASE_URL not configured — dev/CI no-op OK (not a configured-but-failed case)

  // Throws on failure — caller captures to Sentry.
  await db.transaction(async (tx) => {
    await tx
      .insert(listingRevisions)
      .values({ tenantId, listingId, revision: 1 })
      .onConflictDoUpdate({
        target: [listingRevisions.tenantId, listingRevisions.listingId],
        set: { revision: sql`${listingRevisions.revision} + 1`, updatedAt: new Date() },
      });
    await tx
      .update(descriptionCachePersistent)
      .set({ invalidatedAt: new Date() })
      .where(
        and(
          eq(descriptionCachePersistent.tenantId, tenantId),
          eq(descriptionCachePersistent.listingId, listingId),
          isNull(descriptionCachePersistent.invalidatedAt),
        ),
      );
  });
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
