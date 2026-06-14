/**
 * intent_weight_configs — K.3.6 Archetype Identification Tracer: global + per-tenant weight
 * override store.
 *
 * Stores the signal weight configuration used by the intent engine to compute archetype
 * probabilities. Supports a global default row (tenant_id IS NULL per CEO D-4) and per-tenant
 * overrides. The SDK-facing `/api/intent/config` route (FOLLOW-267) reads from this table,
 * preferring a tenant-specific active row over the global default.
 *
 * At most one active config per effective scope. The read path in
 * `GET /api/intent/config` queries WHERE (tenant_id = :tenantId OR tenant_id IS NULL)
 * AND is_active = true, returning at most 2 rows and preferring the tenant-specific row.
 *
 * RLS: global rows (tenant_id IS NULL) are readable by any tenant; per-tenant rows are isolated
 * to the owning tenant via current_setting('app.current_tenant_id', true).
 *
 * Writer: FOLLOW-268 (backend-engineer) — tenant override write API.
 *         Initial global seed: managed via DB migration or admin seeder.
 *
 * @module @estalara/db/schema/intent-weight-configs
 */

import { boolean, jsonb, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';
import { users } from './users.js';

export const intentWeightConfigs = pgTable('intent_weight_configs', {
  id: uuid('id').primaryKey().defaultRandom(),

  /**
   * FK → tenants.id. Cascade delete when the tenant is removed.
   * NULL = global default config (readable by all tenants per CEO D-4).
   */
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),

  /**
   * Soft-gate: when false this config is inactive (superseded by a newer row).
   * At most one active row per effective tenant scope (enforced by DB partial index).
   */
  isActive: boolean('is_active').notNull().default(true),

  /**
   * Signal weight configuration in JSONB.
   * Canonical shape: `{ priors?, behavioral_damping?, signal_likelihoods? }` —
   * defined by IntentWeightsSchema in @estalara/shared/schemas/intent-weights.
   * All three sub-fields are optional; an empty `{}` is valid (identity / Option A seed,
   * migration 0030). FOLLOW-302: migration 0029 line 12 previously showed the stale
   * `signal_weights` key; corrected to `signal_likelihoods` in this PR (journal-safe —
   * the monotonicity gate does not hash SQL content).
   * Validated by the write API (FOLLOW-268-write); stored opaque here so migrations
   * don't need to track weight schema evolution.
   */
  weights: jsonb('weights').notNull(),

  /** When this config row was created. */
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),

  /**
   * FK → users.id. NULL for system-seeded global defaults (no owning user).
   */
  createdBy: uuid('created_by').references(() => users.id),
});

export type IntentWeightConfig = typeof intentWeightConfigs.$inferSelect;
export type NewIntentWeightConfig = typeof intentWeightConfigs.$inferInsert;
