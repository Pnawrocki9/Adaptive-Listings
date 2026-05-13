/**
 * ab_bandit_weights — per-(tenant, archetype, variant) Beta distribution parameters
 * for Thompson sampling bandit. TICKET-AB-001.
 *
 * The Decision API reads this table at request time to sample from Beta posteriors
 * and select the best adaptation variant per archetype.
 *
 * After each observed conversion signal the alpha/beta parameters are updated:
 *   - conversion observed  → alpha += 1
 *   - no conversion        → beta  += 1
 *
 * Uniform Beta(1, 1) prior (alpha=1, beta=1) means equal probability for all variants
 * at experiment start — no warm-start bias.
 *
 * `paused` flag: set by the regression-detection job when a statistically significant
 * negative delta is observed (p < 0.05, ≥200 sessions per arm, 7-day rolling window).
 * When true, the Decision API serves the default (non-personalized) experience for that
 * archetype and emits a Sentry warning.
 *
 * RLS: tenant can read/write only its own rows (see migration SQL).
 *
 * @module @estalara/db/schema/ab_bandit_weights
 */

import {
  boolean,
  doublePrecision,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';

export const abBanditWeights = pgTable(
  'ab_bandit_weights',
  {
    /** Foreign key → tenants.id. */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /**
     * Archetype label (e.g. 'family_buyer', 'yield_hunter').
     * Matches the archetype space defined in packages/shared intent ontology.
     */
    archetype: text('archetype').notNull(),

    /**
     * Adaptation variant identifier (e.g. 'headline_v1', 'photo_order_v2').
     * 'control' is the default / holdout variant.
     */
    variant: text('variant').notNull(),

    /**
     * Beta distribution alpha parameter (successes + 1 for the uniform prior).
     * Incremented on each observed conversion for this (archetype, variant) pair.
     */
    alpha: doublePrecision('alpha').notNull().default(1.0),

    /**
     * Beta distribution beta parameter (failures + 1 for the uniform prior).
     * Incremented on each non-conversion for this (archetype, variant) pair.
     */
    beta: doublePrecision('beta').notNull().default(1.0),

    /**
     * Auto-pause flag. When true, the Decision API serves the default experience for
     * this archetype and emits a Sentry warning.
     *
     * Set by the regression-detection scheduled job when:
     *   - holdout vs treatment delta on conversion metric is statistically significant
     *     (two-proportion z-test, p < 0.05)
     *   - minimum 200 sessions per arm in the rolling 7-day window
     */
    paused: boolean('paused').notNull().default(false),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.tenantId, t.archetype, t.variant] }),
    index('ab_bandit_weights_tenant_id_idx').on(t.tenantId),
    index('ab_bandit_weights_tenant_archetype_idx').on(t.tenantId, t.archetype),
  ],
);

export type AbBanditWeight = typeof abBanditWeights.$inferSelect;
export type NewAbBanditWeight = typeof abBanditWeights.$inferInsert;
