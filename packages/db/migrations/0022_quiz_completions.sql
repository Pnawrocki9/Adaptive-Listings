-- Migration: 0022_quiz_completions
-- MOAT training table for quiz completion events (MASTER_DESIGN §E.4.8, FOLLOW-200).
--
-- Every quiz completion links (session signals → quiz path → resolved archetype →
-- adaptation → conversion) into a durable training row. Without this table the full
-- label chain is permanently lost. This table is the foundation for per-tenant
-- fine-tuning of the archetype classifier (TALLRec/LoRA, §D.5.7).
--
-- Design notes:
--   - tenant_id is UUID FK → tenants(id) with CASCADE DELETE (mirrors engagement_scores).
--   - session_id is the SDK's anonymous session fingerprint (SHA-256 hex, text).
--   - resolved_archetype is one of the 17 leaf archetypes or 'neutral' (plain text —
--     the repo does not use pgEnum; taxonomy is validated at the API layer).
--   - branch is the Q1 decision tree path: INWESTOR | OWN_USE | CROSS_BORDER | null
--     (null for 'neutral' Q1-D skip).
--   - q1_answer / q2_answer / q3_answer are 0-based option indices (nullable for Q2/Q3
--     when not reached in the decision tree).
--   - language tracks the quiz locale at completion time.
--   - created_at is the canonical timestamp column (TIMESTAMPTZ NOT NULL DEFAULT now()).
--     Note: the FOLLOW-200 ticket spec uses 'created_at'; Master_Design §E.4.8 uses
--     'completed_at'. We use 'created_at' to match the convention used by all other
--     tables in this codebase.
--
-- RLS: tenant isolation on tenant_id via current_setting('app.current_tenant_id'),
-- mirroring engagement_scores (0021) and conversion_labels (0019).
-- Forward-only migration. No down migration.

CREATE TABLE IF NOT EXISTS quiz_completions (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id          text        NOT NULL,
  resolved_archetype  text        NOT NULL,
  branch              text,
  q1_answer           integer,
  q2_answer           integer,
  q3_answer           integer,
  language            text        NOT NULL DEFAULT 'en',
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- Index: per-tenant look-ups (analytics, fine-tuning queries)
CREATE INDEX IF NOT EXISTS quiz_completions_tenant_id_idx
  ON quiz_completions (tenant_id);

-- Index: per-session look-ups (dedup, session timeline)
CREATE INDEX IF NOT EXISTS quiz_completions_session_id_idx
  ON quiz_completions (session_id);

-- Index: archetype distribution analytics
CREATE INDEX IF NOT EXISTS quiz_completions_tenant_archetype_idx
  ON quiz_completions (tenant_id, resolved_archetype);

-- RLS: enable row-level security and create the tenant-isolation policy.
ALTER TABLE quiz_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY quiz_completions_tenant_isolation
  ON quiz_completions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
