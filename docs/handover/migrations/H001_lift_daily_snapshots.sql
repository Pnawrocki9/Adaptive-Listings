-- Handover migration: H001_lift_daily_snapshots
-- FOLLOW-1338 (plan Phase 3 M5, ruling D-K): the daily history of the pilot lift.
--
-- WHY THIS FILE IS NOT UNDER packages/db/migrations/
--   `.github/workflows/db-migrate.yml` applies every file under `packages/db/migrations/**` to the
--   LIVE production Supabase on each push to `main`. CEO ruling 2026-10-19: this table exists only
--   on localhost until the CTO applies it. Localhost: `scripts/dev/localhost-up.sh` applies this
--   file to `al_pg_local` (step 4). Production: docs/handover/CTO_HANDOVER.md section 4 (the
--   lift_daily_snapshots row) - apply it BEFORE, or together with, row 4's flip of
--   `CALLER_SIGNED_COLUMN_ENABLED`. The control plane deploys on every merge to main; until that
--   flip the cron `api/cron/lift-snapshot` answers 200 `conversion_source: 'disabled'` and does not
--   touch Postgres. After the flip and before this file is applied it answers 500
--   `lift_snapshot_table_missing` (one Sentry event per run) and the Pilot tab's History table shows
--   an error banner; nothing else depends on the table.
--   (H001: a handover number, deliberately outside the drizzle 00NN sequence.)
--
-- WHAT IT HOLDS
--   One row per (tenant, UTC day, arm) written by `api/cron/lift-snapshot` (UPSERT on the unique key,
--   so a re-run overwrites the figures and moves computed_at) and read by
--   `api/dashboard/analytics/lift/history` (via `lib/lift-snapshots.ts`). The figures are the output
--   of `lib/pilot-stats.ts` `computeArmLift` over the day's cohort; the adapted-vs-holdout lift is
--   stored on BOTH arm rows so a row is self-describing. History independent of the ClickHouse
--   `events` 13-month TTL and of the rolling window of the live reader.
--
-- IDEMPOTENT: safe to apply any number of times (CREATE ... IF NOT EXISTS; the policy is dropped and
--   recreated because CREATE POLICY has no IF NOT EXISTS).
-- ROLLBACK:  DROP TABLE lift_daily_snapshots;   (nothing else references it)

CREATE TABLE IF NOT EXISTS lift_daily_snapshots (
  id                uuid             PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         uuid             NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- The UTC calendar day the cohort's first decision falls on.
  day               date             NOT NULL,
  arm               text             NOT NULL CHECK (arm IN ('adapted', 'holdout')),
  -- Distinct sessions of the arm with an adaptation decision that day (the lift denominator).
  sessions          integer          NOT NULL CHECK (sessions >= 0),
  -- Sessions with a server-confirmed live.signup OR inquiry.completed (a session with both = 1).
  conversions       integer          NOT NULL CHECK (conversions >= 0),
  live_signups      integer          NOT NULL CHECK (live_signups >= 0),
  agent_contacts    integer          NOT NULL CHECK (agent_contacts >= 0),
  -- (p_adapted - p_holdout) / p_holdout * 100; NULL when the holdout rate is 0 (undefined).
  relative_lift_pct double precision,
  p_value           double precision NOT NULL,
  -- '95%' | '90%' | 'not_significant' (lib/pilot-stats.ts PilotConfidence; <30 sessions per arm
  -- is always 'not_significant').
  confidence        text             NOT NULL CHECK (confidence IN ('95%', '90%', 'not_significant')),
  computed_at       timestamptz      NOT NULL DEFAULT now(),
  -- Also the index for the tenant_id foreign key and for "newest days of a tenant".
  CONSTRAINT lift_daily_snapshots_tenant_day_arm_key UNIQUE (tenant_id, day, arm)
);

-- RLS: tenant isolation on tenant_id, mirroring conversion_labels (0019) and quiz_completions
-- (0022). The only accessors are the control plane's service-role (admin) client, which bypasses
-- RLS and fences every query with WHERE tenant_id = <validated id>; the policy denies every other
-- role any row whose tenant is not the one set in app.current_tenant_id.
ALTER TABLE lift_daily_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lift_daily_snapshots_tenant_isolation ON lift_daily_snapshots;
CREATE POLICY lift_daily_snapshots_tenant_isolation
  ON lift_daily_snapshots
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- The table is reachable only through the service-role client; take the API roles' default grants
-- away so RLS is not the only barrier. Guarded: a plain Postgres (CI, PGlite) has no such roles.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON lift_daily_snapshots FROM %I', r);
    END IF;
  END LOOP;
END
$$;
