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

import { index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

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
    // Partial unique index: only one active (non-invalidated) row per combination.
    // Drizzle does not natively generate partial indexes — the SQL migration handles this.
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
