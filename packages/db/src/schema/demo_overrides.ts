/**
 * demo_overrides — per-tenant DEMO MODE archetype + model override.
 *
 * One row per tenant (upserted). When `enabled = true`, the adapt endpoint
 * ignores the SDK's archetype_hint and forces the chosen archetype at high
 * confidence so the full playbook + LLM path runs. The chosen model overrides
 * the gateway routing policy for that tenant.
 *
 * This is the server-side persistence for DEMO-001 (Archetype Simulator).
 * The dev/local equivalent is scripts/dev/mock-decision-server.mjs.
 *
 * @module @estalara/db/schema/demo_overrides
 */

import { boolean, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

export const demoOverrides = pgTable(
  'demo_overrides',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Foreign key → tenants.id (one row per tenant) */
    tenantId: uuid('tenant_id').notNull().unique(),

    /** When true, adapt endpoint uses overrideArchetype + overrideModel. */
    enabled: boolean('enabled').notNull().default(false),

    /**
     * The archetype to force when enabled.
     * One of the 13 reachable archetypes (or null when not yet set).
     * NULL when enabled=false is safe — the endpoint checks enabled first.
     */
    overrideArchetype: text('override_archetype'),

    /**
     * The LLM model to use for generation when enabled.
     * Defaults to 'claude-sonnet-4-6'. Must be in the allow-list validated
     * by the API endpoint.
     */
    overrideModel: text('override_model').notNull().default('claude-sonnet-4-6'),

    /** User who last toggled / updated the override. */
    updatedBy: uuid('updated_by'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('demo_overrides_tenant_id_idx').on(t.tenantId),
    index('demo_overrides_enabled_idx').on(t.enabled),
  ],
);

export type DemoOverrideRow = typeof demoOverrides.$inferSelect;
export type NewDemoOverride = typeof demoOverrides.$inferInsert;
