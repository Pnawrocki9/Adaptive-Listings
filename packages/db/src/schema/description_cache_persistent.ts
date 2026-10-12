/**
 * description_cache_persistent — permanent Postgres cache for AI-generated listing descriptions.
 *
 * One row per (tenant_id, listing_id, archetype, locale) combination. Descriptions persist
 * indefinitely; they are invalidated (not deleted) via `invalidated_at` when a
 * listing.updated webhook fires. The lookup step in the description route reads only
 * rows WHERE invalidated_at IS NULL.
 *
 * Lookup order per Master Design §E.7.2 (FOLLOW-204, CEO decision 2026-06-05):
 *   1. description_cache_persistent (this table) → if found and not invalidated → return
 *   2. Upstash Redis (hot-path fast cache) → if found → return + async backfill here
 *   3. template_fallback immediately + fire-and-forget Modal enqueue
 *
 * RLS: tenant isolation on tenant_id (mirrors engagement_scores, demo_overrides).
 *
 * @module @estalara/db/schema/description_cache_persistent
 */

import { bigint, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const descriptionCachePersistent = pgTable(
  'description_cache_persistent',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Foreign key → tenants.id (RLS scope). */
    tenantId: uuid('tenant_id').notNull(),

    /** The tenant's listing identifier (external, not a PK in our DB). */
    listingId: text('listing_id').notNull(),

    /** Buyer archetype ID, e.g. 'yield_hunter'. */
    archetype: text('archetype').notNull(),

    /**
     * Locale code, e.g. 'en', 'pl', 'es'.
     * Defaults to 'pl' to match the spec; the route uses 'en' as its param default.
     */
    locale: text('locale').notNull().default('pl'),

    /** AI-generated listing description body. */
    description: text('description').notNull(),

    /**
     * AI-generated per-listing headline (ADR-0009).
     * Null when headline generation failed or was skipped.
     */
    headline: text('headline'),

    /** Anthropic model id that generated this entry, e.g. 'claude-sonnet-4-6'. */
    model: text('model').notNull(),

    /**
     * Archetype-fit gate verdict (ADR-0010 / FOLLOW-465). NULL on every row written
     * before this column existed — readers treat NULL as the implicit 'FIT' verdict.
     * 'NEUTRAL' marks a negative-cache row: the archetype-fit gate declined to adapt
     * this (listing, archetype) pair, so `description` is '' and `headline` is NULL.
     * The read path (GET /api/adapt/description) short-circuits a NEUTRAL row by
     * serving template_fallback and skipping the Modal re-enqueue, instead of
     * treating it as a genuine ai_cached row — this is what stops the perpetual
     * Sonnet re-spend a NEUTRAL verdict previously caused (it was indistinguishable
     * from a genuine generation failure, and both wrote nothing).
     */
    verdict: text('verdict'),

    /**
     * FOLLOW-1305 (FOLLOW-820 condition 1c): the claim-check version this row's text passed
     * before it was written (`CLAIMS_VALIDATION_VERSION`, stamped by the Modal job). NULL on
     * every row written before the check existed. The read path serves a FIT row ONLY when this
     * equals the current version; any other FIT row is legacy and is treated as a miss, so it is
     * regenerated once under the check. NEUTRAL rows carry no text and are trusted regardless.
     */
    claimsValidation: text('claims_validation'),

    /**
     * FOLLOW-1291 (Codex F-03): the listing revision this row's text was grounded at - the
     * `listing_revisions.revision` the description route read BEFORE it fetched the grounding
     * source for the job that produced the row (0 for every row written before the fence). The
     * read path serves a row only when this is >= the listing's current revision, and the
     * callback publishes only a revision >= the current one (migration 0041).
     */
    listingRevision: bigint('listing_revision', { mode: 'number' }).notNull().default(0),

    /** When the AI generation completed. */
    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * Set to NOW() when the listing.updated webhook fires.
     * NULL means the row is valid and should be served.
     * Non-null means the row is invalidated; the next request triggers fresh generation.
     */
    invalidatedAt: timestamp('invalidated_at', { withTimezone: true }),
  },
  (t) => [
    // Partial unique index: only one active (non-invalidated) row per
    // (tenant, listing, archetype, locale, model) — model added by FOLLOW-1291 (F-17, migration
    // 0041). Drizzle does not natively generate partial indexes — the SQL migration handles this.
    // We declare a non-unique index here for the Drizzle schema introspection layer.
    index('description_cache_persistent_lookup_idx').on(
      t.tenantId,
      t.listingId,
      t.archetype,
      t.locale,
      t.generatedAt,
    ),
    index('description_cache_persistent_invalidate_idx').on(t.tenantId, t.listingId),
    index('description_cache_persistent_tenant_id_idx').on(t.tenantId),
  ],
);

export type DescriptionCachePersistent = typeof descriptionCachePersistent.$inferSelect;
export type NewDescriptionCachePersistent = typeof descriptionCachePersistent.$inferInsert;

/**
 * listing_revisions — the description cache's revision fence (FOLLOW-1291, Codex F-03,
 * migration 0041).
 *
 * One row per (tenant, listing) that has ever received a listing.updated webhook; `revision` is
 * advanced by +1 on each. A listing without a row is at revision 0. This is a LOCAL revision:
 * the listing-details backend exposes no updated_at/version, so the webhook is the only change
 * signal — the fence is exactly as fresh as that webhook (see the migration header for the
 * upstream-lag case).
 *
 * RLS: tenant isolation on tenant_id (same policy shape as description_cache_persistent).
 */
export const listingRevisions = pgTable(
  'listing_revisions',
  {
    /** Foreign key → tenants.id (RLS scope). */
    tenantId: uuid('tenant_id').notNull(),

    /** The tenant's listing identifier. */
    listingId: text('listing_id').notNull(),

    /** Advanced by +1 on every listing.updated webhook. */
    revision: bigint('revision', { mode: 'number' }).notNull().default(0),

    /** When the revision last advanced. */
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.listingId] })],
);
