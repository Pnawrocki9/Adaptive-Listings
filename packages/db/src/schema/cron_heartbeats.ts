/**
 * cron_heartbeats — one row per scheduled job, UPSERTed on every SUCCESSFUL run.
 *
 * This is a dead-man's switch sink (FOLLOW-893), not a log. It answers exactly one
 * question — "did job X complete successfully recently?" — for an external checker that
 * runs OUTSIDE the job, so that a run which never starts is detectable at all.
 *
 * Written by: `apps/data-quality/src/crons/schema_validation.py` (`_write_heartbeat`,
 * job_name `validate_schemas`).
 * Read by: `scripts/check-cron-heartbeat.sh`, invoked daily at 05:00 UTC by
 * `.github/workflows/cron-heartbeat.yml`, which exits non-zero — a red GitHub Actions
 * run, i.e. a structured sink with notifications — when the heartbeat is missing or
 * older than the allowed window.
 *
 * Why not derive liveness from `schema_validation_history`: that table gets zero rows
 * when a healthy run finds no active tenant with a site schema, so its emptiness is
 * ambiguous. See `packages/db/migrations/0037_cron_heartbeats.sql`.
 *
 * RLS: enabled with no policies (deny-all). Service-role only; the table holds no
 * tenant-scoped data. Documented exception to the per-table RLS-policy bar.
 *
 * @module @estalara/db/schema/cron_heartbeats
 */

import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

export const cronHeartbeats = pgTable('cron_heartbeats', {
  /** Stable job identifier, e.g. `validate_schemas`. Primary key — one row per job. */
  jobName: text('job_name').primaryKey(),
  /** UTC time the job last completed successfully. Only ever moves forward, on success. */
  lastSuccessAt: timestamp('last_success_at', { withTimezone: true }).notNull().defaultNow(),
  /** Per-job detail, e.g. `{ "tenant_domain_pairs": 0 }`. Never null; defaults to `{}`. */
  runDetail: jsonb('run_detail').notNull().default({}),
});

/** Row shape as selected from `cron_heartbeats`. */
export type CronHeartbeat = typeof cronHeartbeats.$inferSelect;
