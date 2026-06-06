-- Migration: 0021_engagement_scores
-- Engagement Score table (ROPA Activity 13, DPIA §8 line 773, FOLLOW-193).
--
-- Stores a normalised engagement intensity score (0–1) per (tenant_id, session_id),
-- computed by the Modal intent engine from behavioral signals (dwell, interaction, scroll).
-- Surfaced in the tenant analytics dashboard for visitor-quality assessment.
--
-- GDPR Art. 17 / DSR cascade: rows are deleted inside the Drizzle erasure transaction
-- in apps/control-plane/src/app/api/dsr/erase/route.ts (same PR -- FOLLOW-193 AC2).
--
-- Retention: 90 days from last active event, enforced by the DSR mutation-poll cron
-- (restored by FOLLOW-193 AC1 -- requires Vercel Pro, gated on CEO Q3 confirmation).
--
-- RLS: tenant isolation on tenant_id, mirroring session_embeddings and demo_overrides.
-- Forward-only migration.

CREATE TABLE IF NOT EXISTS engagement_scores (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id       text        NOT NULL,
  -- Normalised engagement score in [0, 1] (ROPA Activity 13 data categories).
  engagement_score numeric(6, 5),
  dwell_score      numeric(6, 5),
  interaction_score numeric(6, 5),
  scroll_score     numeric(6, 5),
  computed_at      timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint: one score row per (tenant, session).
CREATE UNIQUE INDEX IF NOT EXISTS engagement_scores_tenant_session_idx
  ON engagement_scores (tenant_id, session_id);

CREATE INDEX IF NOT EXISTS engagement_scores_tenant_id_idx
  ON engagement_scores (tenant_id);

CREATE INDEX IF NOT EXISTS engagement_scores_computed_at_idx
  ON engagement_scores (computed_at);

-- RLS: enable row-level security and create the tenant-isolation policy.
ALTER TABLE engagement_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY engagement_scores_tenant_isolation
  ON engagement_scores
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
