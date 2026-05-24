-- Migration 0011: dsr_audit_log — ClickHouse mutation tracking columns
-- FOLLOW-039 — ClickHouse DSR hard-delete (RODO Art. 17 erasure)
--
-- Extends the dsr_audit_log table (migration 0009) with three columns that
-- record the ClickHouse-side erasure mutation for each DSR-erase request:
--
--   clickhouse_mutation_id          — the ClickHouse mutation_id captured from
--                                     system.mutations after issuing ALTER TABLE
--                                     ... DELETE WHERE session_id IN (...). One
--                                     row in dsr_audit_log can be associated
--                                     with multiple mutations (one per table —
--                                     events, adaptation_decisions, llm_calls,
--                                     session_quality) — this column stores a
--                                     comma-separated list of mutation_ids for
--                                     visibility in audit. Per-mutation status
--                                     detail is tracked in the Postgres
--                                     dsr_clickhouse_mutations operational
--                                     table (Drizzle migration 0014).
--
--   clickhouse_mutation_status      — coarse aggregate status enum:
--                                     'pending'      — issued, not yet polled
--                                     'in_progress'  — at least one mutation
--                                                       still executing
--                                     'done'         — all per-table mutations
--                                                       returned is_done = 1
--                                     'failed'       — any per-table mutation
--                                                       failed all 3 retries
--                                     'no_data'      — session had no rows in
--                                                       any ClickHouse PII table
--                                                       (idempotency edge case)
--
--   clickhouse_mutation_completed_at — set to UTC now() when status flips to
--                                     'done' or 'failed'. NULL otherwise.
--
-- ClickHouse ALTER TABLE ADD COLUMN is non-blocking for MergeTree tables.
-- The defaults backfill existing audit rows safely; pre-existing erase rows
-- are treated as legacy (no ClickHouse mutation issued) and remain unaffected.
--
-- See: docs/MASTER_DESIGN.md §H.1 + §W.7.3 for the erasure flow.

ALTER TABLE dsr_audit_log
    ADD COLUMN IF NOT EXISTS clickhouse_mutation_id String DEFAULT ''
    AFTER completed_at;

ALTER TABLE dsr_audit_log
    ADD COLUMN IF NOT EXISTS clickhouse_mutation_status LowCardinality(String) DEFAULT ''
    AFTER clickhouse_mutation_id;

ALTER TABLE dsr_audit_log
    ADD COLUMN IF NOT EXISTS clickhouse_mutation_completed_at Nullable(DateTime64(3, 'UTC'))
    AFTER clickhouse_mutation_status;
