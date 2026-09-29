-- Migration: 0023_drop_session_quality_and_summary
-- FOLLOW-1268 (WP-0.6b of docs/PLAN-AUDIT-REMEDIATION-2026-09-24.md; CEO decision D6):
-- drop two ClickHouse objects that nothing in the product reads or writes.
--
--   session_summary + session_summary_mv (migration 0002): the MV fired on every INSERT into
--     `events` and filled `session_summary`, but no route, cron, dashboard or model ever
--     queried it. Only the CI smoke test and the e2e smoke test read it. Both now assert
--     against `events` directly (same PR). The MV is dropped FIRST: it writes TO
--     session_summary, and dropping the target first would make every INSERT INTO events
--     fail while the MV still points at a missing table.
--   session_quality (migration 0005): no writer was ever built. `session.quality.snapshot`
--     events land in `events` like every other type (apps/ingest/src/consent-gate.ts called
--     this table a "phantom write-path"). The DSR erase/disclosure list stopped naming it in
--     the same PR (apps/control-plane/src/lib/clickhouse-dsr.ts).
--
-- Deliberate exception to the ADR-0003 "additive only" rule in infra/clickhouse/README.md,
-- ruled by the CEO (D6). OPERATOR STEP (CONVENTIONS_PATCH Rule AA): ClickHouse migrations do
-- not auto-apply. Apply to prod ONLY AFTER the control-plane deploy that removes
-- `session_quality` from DSR_CLICKHOUSE_TABLES is live. Otherwise every DSR erase issues
-- ALTER TABLE session_quality DELETE against a missing table.
--
-- Idempotent (IF EXISTS). migrate.sh re-runs 0002/0005 on every invocation (CREATE ... IF NOT
-- EXISTS), and this file drops the objects again straight after, so the end state of a full
-- run is always "absent".

DROP VIEW IF EXISTS session_summary_mv;

DROP TABLE IF EXISTS session_summary;

DROP TABLE IF EXISTS session_quality;
