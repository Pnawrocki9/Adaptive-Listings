/**
 * schema_validation_history — one row per daily cron validation run per tenant.
 *
 * Written by the continuous schema validation cron
 * (`apps/data-quality/src/crons/schema_validation.py`).
 *
 * Read by (FOLLOW-893 AC3 — this list used to claim a `/dashboard/site-health` panel from
 * TICKET-VAL-002 that does not exist in this repo):
 *   1. the cron's own 24h Sentry-dedup query (`_was_drift_alerted_recently`), and
 *   2. the daily digest in `scripts/check-cron-heartbeat.sh`, reported into the
 *      `cron-heartbeat.yml` job summary.
 * There is no tenant-facing surface yet; see docs/runbooks/SCHEMA_VALIDATION_CRON.md §4.
 *
 * A row is written on every cron run, whether or not drift was detected.
 * `drift_detected = true` means the stored CSS selectors no longer match
 * the live page (coverage_score < 0.8 or a required selector failed).
 * `error` is non-null only when the page fetch itself failed.
 *
 * RLS: tenant can SELECT their own rows; service role can INSERT.
 *
 * @module @estalara/db/schema/schema_validation_history
 */

import { boolean, index, integer, pgTable, real, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { tenants } from './tenants.js';

export const schemaValidationHistory = pgTable(
  'schema_validation_history',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Foreign key → tenants.id. Cascade delete when the tenant is removed. */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** Bare domain that was validated (mirrors tenant_site_schemas.domain). */
    domain: text('domain').notNull(),
    /**
     * Fraction of stored selectors that matched the live page HTML.
     * Range 0.0 – 1.0. Below 0.8 triggers drift detection.
     */
    coverageScore: real('coverage_score').notNull(),
    /**
     * CSS selectors from the stored schema that no longer match the live page.
     * Empty array when all selectors matched.
     */
    failedSelectors: text('failed_selectors').array().notNull().default([]),
    /** Total number of selectors checked during this run. */
    totalSelectors: integer('total_selectors').notNull(),
    /** Number of selectors that successfully matched an element on the live page. */
    matchedSelectors: integer('matched_selectors').notNull(),
    /**
     * True when coverage_score < 0.8 or any required selector failed.
     * False on successful validation AND on page fetch failure (see `error`).
     */
    driftDetected: boolean('drift_detected').notNull(),
    /** Timestamp of this validation run (UTC). */
    runAt: timestamp('run_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Null when the run completed normally (whether or not drift was detected).
     * Non-null when the page fetch failed — value is "fetch_failed: <detail>".
     */
    error: text('error'),
  },
  (t) => [index('idx_schema_validation_history_tenant_run_at').on(t.tenantId, t.runAt)],
);

export type SchemaValidationHistoryRow = typeof schemaValidationHistory.$inferSelect;
export type NewSchemaValidationHistoryRow = typeof schemaValidationHistory.$inferInsert;
