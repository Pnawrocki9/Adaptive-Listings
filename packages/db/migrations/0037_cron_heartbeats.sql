-- Migration: 0037_cron_heartbeats
-- FOLLOW-893: dead-man's-switch sink for scheduled jobs (absence-of-signal detection).
--
-- Background:
--   `apps/data-quality/src/crons/schema_validation.py` is scheduled
--   `modal.Cron("0 2 * * *")` and fires for the first time in the project's history on
--   2026-08-08. A FAILED run is visible only to whoever opens the Modal dashboard; a run
--   that NEVER STARTS — the highest-prior failure mode for a first-ever schedule — emitted
--   nothing anywhere. This table is the sink an external checker asserts against
--   (`scripts/check-cron-heartbeat.sh`, run daily by `.github/workflows/cron-heartbeat.yml`).
--
-- Why a dedicated table and not `schema_validation_history`:
--   `_run_validation()` returns EARLY, writing ZERO rows, when no active tenant has a
--   `tenant_site_schemas` row (schema_validation.py:411-413). A perfectly healthy run can
--   therefore leave no trace in that table, so "newest history row < 26h old" cannot
--   distinguish "ran and had nothing to do" from "never ran". `cron_heartbeats` is written
--   UNCONDITIONALLY at the end of a successful run and carries the pair count in
--   `run_detail`, so both facts survive separately.
--
-- Generic on purpose (job_name PK, not one column per job): the next scheduled job gets a
--   row, not a migration. This is deliberately the cheapest thing that works — no new
--   third-party service, no recurring cost (FOLLOW-893 AC2).
--
-- Forward-only, purely additive (CREATE TABLE IF NOT EXISTS only) — safe under
-- db-migrate.yml's auto-apply-to-prod-on-merge (RETRO-076 / FOLLOW-308).

CREATE TABLE IF NOT EXISTS cron_heartbeats (
  -- Stable identifier of the scheduled job, e.g. 'validate_schemas'. One row per job;
  -- every successful run UPSERTs the same row (this is a liveness marker, not a log).
  job_name text PRIMARY KEY,
  -- Wall-clock UTC time the job last COMPLETED SUCCESSFULLY. A run that raises never
  -- reaches the write, so this timestamp only ever moves on success.
  last_success_at timestamptz NOT NULL DEFAULT NOW(),
  -- Free-form per-job detail (e.g. {"tenant_domain_pairs": 0}). Lets the checker report
  -- "ran, validated 0 pairs" instead of guessing from an empty history table.
  run_detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

-- RLS: enabled with NO policies — deny-all for anon/authenticated roles. This table holds
-- no tenant-scoped data (job names and timestamps only) and has exactly two legitimate
-- accessors, both service-role: the Modal cron that writes it and the CI checker that
-- reads it. A tenant-isolation policy would be meaningless here (there is no tenant_id),
-- so the documented exception to the "every table has an RLS policy" bar is: service-role
-- only, deny-all otherwise.
ALTER TABLE cron_heartbeats ENABLE ROW LEVEL SECURITY;
