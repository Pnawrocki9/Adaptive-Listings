-- Migration: 0008_schema_validation_history
-- TICKET-VAL-001 — Continuous Schema Validation Cron
--
-- Creates the `schema_validation_history` table that records every daily cron
-- validation run per tenant. Written by apps/data-quality/src/crons/schema_validation.py.
-- Read by the /dashboard/site-health panel (TICKET-VAL-002, Sprint 10).
--
-- RLS: tenant can SELECT own rows; service role can INSERT (cron runs as service role).
-- Forward-only migration. TICKET-VAL-001.

CREATE TABLE IF NOT EXISTS schema_validation_history (
  id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain            TEXT          NOT NULL,
  coverage_score    REAL          NOT NULL,
  failed_selectors  TEXT[]        NOT NULL DEFAULT '{}',
  total_selectors   INTEGER       NOT NULL,
  matched_selectors INTEGER       NOT NULL,
  drift_detected    BOOLEAN       NOT NULL,
  run_at            TIMESTAMPTZ   NOT NULL DEFAULT now(),
  error             TEXT
);

CREATE INDEX IF NOT EXISTS idx_schema_validation_history_tenant_run_at
  ON schema_validation_history(tenant_id, run_at DESC);

-- RLS: tenants can read only their own validation history rows.
ALTER TABLE schema_validation_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schema_validation_history: tenant read isolation"
  ON schema_validation_history FOR SELECT
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Service role bypass: the cron job uses the service role and is exempt from RLS.
-- Supabase service_role key bypasses RLS by default — no explicit policy needed for INSERT.
