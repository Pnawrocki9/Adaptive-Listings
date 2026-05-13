-- Migration: 0004_ab_bandit_weights
-- TICKET-AB-001 — A/B holdout framework: Thompson sampling bandit weights table.
--
-- Stores per-(tenant_id, archetype, variant) Beta distribution parameters (alpha, beta)
-- updated after each observed conversion signal.
--
-- The Decision API reads this table at request time to sample from Beta posteriors
-- and select the best adaptation variant per archetype.
--
-- `paused` flag: set by the regression-detection scheduled job when a statistically
-- significant negative delta is observed (p < 0.05, two-proportion z-test,
-- minimum 200 sessions per arm, rolling 7-day window). When true, the Decision API
-- serves the default experience for that archetype and emits a Sentry warning.
--
-- Forward-only migration. TICKET-AB-001.

CREATE TABLE IF NOT EXISTS ab_bandit_weights (
  tenant_id   UUID              NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  archetype   TEXT              NOT NULL,
  variant     TEXT              NOT NULL,
  alpha       DOUBLE PRECISION  NOT NULL DEFAULT 1.0,
  beta        DOUBLE PRECISION  NOT NULL DEFAULT 1.0,
  paused      BOOLEAN           NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, archetype, variant)
);

CREATE INDEX IF NOT EXISTS ab_bandit_weights_tenant_id_idx
  ON ab_bandit_weights (tenant_id);

CREATE INDEX IF NOT EXISTS ab_bandit_weights_tenant_archetype_idx
  ON ab_bandit_weights (tenant_id, archetype);

-- RLS: tenants can read/write only their own rows.
ALTER TABLE ab_bandit_weights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ab_bandit_weights: tenant isolation"
  ON ab_bandit_weights FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid)
  WITH CHECK (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
