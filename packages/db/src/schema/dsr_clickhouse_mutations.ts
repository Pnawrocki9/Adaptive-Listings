/**
 * dsr_clickhouse_mutations — operational state for ClickHouse erasure mutations.
 *
 * FOLLOW-039: RODO Art. 17 hard-delete in ClickHouse. ClickHouse mutations are
 * asynchronous; this Postgres table tracks the state of each `ALTER TABLE ...
 * DELETE WHERE` operation we issue per (DSR request, ClickHouse table) tuple.
 *
 * Schema mirrors `packages/db/migrations/0014_dsr_clickhouse_mutations.sql`.
 *
 * Lifecycle:
 *   1. POST /api/dsr/erase issues 1 ALTER TABLE per PII table — one row inserted
 *      per table with status = 'pending'.
 *   2. The Vercel Cron poller (/api/dsr/mutation-poll, every 5 minutes) reads
 *      ClickHouse `system.mutations` and updates each row to 'in_progress' /
 *      'done' / 'failed'.
 *   3. On `failed`, the poller increments `retry_count` and reissues up to 3
 *      times with exponential backoff. After the third failure the row stays
 *      `failed`, the parent dsr_audit_log ClickHouse row is updated to
 *      clickhouse_mutation_status='failed', and a Sentry alert fires.
 *   4. When every row for a `dsr_verification_id` reaches a terminal state
 *      ('done' or 'failed'), the parent dsr_audit_log ClickHouse row is
 *      finalised with clickhouse_mutation_completed_at and the aggregate
 *      status.
 *
 * Idempotency: re-running POST /api/dsr/erase for the same (tenant_id,
 * session_id) inspects this table first. If any non-terminal rows exist, the
 * endpoint returns the current status without issuing new mutations.
 *
 * Retention: rows are kept for 7 years per GDPR Art. 17(3)(b) (legal claims).
 * They are NOT themselves subject to erasure — they are the audit trail of
 * the erasure performed.
 *
 * @module @estalara/db/schema/dsr_clickhouse_mutations
 */

import { index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { dsrVerifications } from './dsr_verifications.js';
import { tenants } from './tenants.js';

export const dsrClickhouseMutations = pgTable(
  'dsr_clickhouse_mutations',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    /** Foreign key → dsr_verifications.id. Cascade delete when the row is removed. */
    dsrVerificationId: uuid('dsr_verification_id')
      .notNull()
      .references(() => dsrVerifications.id, { onDelete: 'cascade' }),

    /** Foreign key → tenants.id. Replicated for fast lookups. */
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),

    /** The anonymous session fingerprint hash. */
    sessionId: text('session_id').notNull(),

    /**
     * ClickHouse table the mutation targets. One of:
     *   - 'events'
     *   - 'adaptation_decisions'
     *   - 'llm_calls'
     *   - 'session_quality'
     *
     * Free-text so adding new PII-bearing tables (e.g. `engagement_scores`)
     * doesn't require an enum migration.
     */
    tableName: text('table_name').notNull(),

    /**
     * mutation_id captured from ClickHouse `system.mutations` after the
     * ALTER TABLE was issued. Empty string until the poller resolves it on
     * the first run.
     */
    mutationId: text('mutation_id').notNull().default(''),

    /**
     * Status enum (enforced by SQL CHECK constraint):
     *   - 'pending'      — mutation issued, not yet polled
     *   - 'in_progress'  — polled at least once, ClickHouse still executing
     *   - 'done'         — ClickHouse system.mutations.is_done = 1
     *   - 'failed'       — final state after 3 retries
     */
    status: text('status').notNull().default('pending'),

    /** Number of mutation retries attempted (0..3). */
    retryCount: integer('retry_count').notNull().default(0),

    /**
     * Last value of system.mutations.latest_failed_reason. NULL when the
     * mutation has not failed.
     */
    lastFailedReason: text('last_failed_reason'),

    /**
     * Earliest time the poller may retry this row. Used for exponential
     * backoff. NULL when no retry is scheduled (terminal state, or first
     * run).
     */
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),

    /**
     * The exact ALTER TABLE SQL that was issued — kept for replay and audit.
     * Stored without password/credentials.
     */
    alterSql: text('alter_sql').notNull(),

    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('dsr_clickhouse_mutations_tenant_session_idx').on(t.tenantId, t.sessionId),
    index('dsr_clickhouse_mutations_status_idx').on(t.status),
    index('dsr_clickhouse_mutations_verification_idx').on(t.dsrVerificationId),
  ],
);

export type DsrClickhouseMutation = typeof dsrClickhouseMutations.$inferSelect;
export type NewDsrClickhouseMutation = typeof dsrClickhouseMutations.$inferInsert;
