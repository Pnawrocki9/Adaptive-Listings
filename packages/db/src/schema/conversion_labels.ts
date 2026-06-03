/**
 * conversion_labels — durable (prediction → outcome) training pairs for the
 * Conversion Label Loop (MASTER_DESIGN §T, FOLLOW-171).
 *
 * One row per labeled lead-outcome, joined back to its prediction by `prediction_id`
 * (= `adaptation_decisions.adapt_decision_id` in ClickHouse). Today the bandit feedback
 * ping collapses outcomes into Beta counters and discards the per-event tuple; this table
 * persists it so a per-tenant classifier can be fine-tuned later (TALLRec/LoRA, §D.5.7).
 *
 * Outcomes are durable, mutable (admins reclassify), tenant-scoped business records, so they
 * live in Postgres rather than append-only ClickHouse. The cross-store join key is the
 * `adapt_decision_id` minted on `/api/adapt` (migration 0012) and stamped on the prediction.
 *
 * The outcome taxonomy + label-source enums are defined ONCE in
 * `@estalara/shared/schemas/conversion-label` (ConversionOutcomeClass / ConversionLabelSource)
 * and validated at the API layer. Stored here as `text` (the repo does not use pgEnum;
 * archetype etc. are likewise plain text), keeping the taxonomy editable without a DB migration.
 *
 * RLS: tenant can read/write only its own rows — `tenant_id` isolation policy created in the
 * migration SQL (0019_conversion_labels.sql), mirroring demo_overrides / ab_bandit_weights.
 *
 * @module @estalara/db/schema/conversion_labels
 */

import { index, jsonb, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { tenants } from './tenants.js';

export const conversionLabels = pgTable(
  'conversion_labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Foreign key → tenants.id. Cascade delete when the tenant is removed. */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /**
     * Join key to the prediction: the stable per-decision UUID minted on `/api/adapt`
     * (`adaptation_decisions.adapt_decision_id`, migration 0012). NOT NULL — a label with
     * no prediction is not training fuel.
     */
    predictionId: text('prediction_id').notNull(),

    /**
     * Durable pseudonymous lead key (§T.6), distinct from the anonymous session_id.
     * Empty until a durable id is wired through the adapt/feedback flow (follow-up).
     */
    leadId: text('lead_id').notNull().default(''),

    /**
     * Outcome class — one of ConversionOutcomeClass
     * (`@estalara/shared/schemas/conversion-label`). Validated at the API layer.
     */
    outcomeClass: text('outcome_class').notNull(),

    /** Raw inbound payload (feedback ping body, or CRM webhook body) before mapping. */
    outcomeRaw: jsonb('outcome_raw'),

    labeledAt: timestamp('labeled_at', { withTimezone: true }).notNull().defaultNow(),

    /**
     * How the label was produced — one of ConversionLabelSource (`system` | `manual_admin`).
     * Validated at the API layer.
     */
    labelSource: text('label_source').notNull(),

    /** Labeler confidence: 1.0 for hard CRM facts, lower for inferred. Nullable. */
    confidence: real('confidence'),

    /** Free text for manual reclassification rationale. Nullable. */
    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('conversion_labels_tenant_id_idx').on(t.tenantId),
    index('conversion_labels_prediction_id_idx').on(t.predictionId),
    index('conversion_labels_tenant_outcome_idx').on(t.tenantId, t.outcomeClass),
  ],
);

export type ConversionLabel = typeof conversionLabels.$inferSelect;
export type NewConversionLabel = typeof conversionLabels.$inferInsert;
