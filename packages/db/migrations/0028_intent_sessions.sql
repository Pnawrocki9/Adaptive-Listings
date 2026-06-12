-- Migration: 0028_intent_sessions
-- K.3.6 Archetype Identification Tracer: session-level accumulator (FOLLOW-266, Phase 1).
--
-- Tracks the lifecycle of a single buyer session's archetype inference state in Postgres.
-- This table is the mutable, session-level "head" for the tracer -- it accumulates signals
-- and resolves to a final archetype when enough confidence is gathered. The granular,
-- append-only event trail lives in ClickHouse `intent_events` (0014_intent_events.sql).
--
-- Columns:
--   id                -- surrogate PK (UUID).
--   tenant_id         -- FK -> tenants(id) CASCADE DELETE; enforces RLS isolation.
--   session_id        -- SDK anonymous session fingerprint (SHA-256 hex, text).
--   cross_session_id  -- optional durable cross-session identifier (localStorage 90d TTL).
--   started_at        -- when the first signal arrived for this session.
--   last_event_at     -- updated on every signal; used for recency sorting.
--   finalized_at      -- set when confidence crosses the resolution threshold.
--   final_archetype   -- the resolved archetype label (null until finalized).
--   final_confidence  -- numeric(4,3): resolved confidence in [0.000, 1.000].
--   signal_count      -- running count of signals processed.
--   quiz_completed    -- true when the quiz widget reached a leaf node.
--   quiz_leaf         -- the leaf archetype from the quiz (null until quiz_completed).
--   chat_turns        -- count of buyer chat turns observed this session.
--   intent_state      -- JSONB envelope holding the full archetype weight distribution
--                        (mirrors the SDK-side IntentState; updated on every signal).
--
-- Uniqueness: one row per (tenant_id, session_id) pair -- UNIQUE constraint enforces this.
--
-- RLS: tenant isolation on tenant_id via current_setting('app.current_tenant_id', true)
-- (canonical pattern -- matches 0019_conversion_labels, 0021_engagement_scores, etc.).
--
-- Writer: FOLLOW-266 Phase 2 (backend-engineer) -- POST /api/intent/event CF Worker
-- and the SDK intent-engine -> control-plane sync path.
--
-- Retention: active sessions are long-lived business records; no short TTL.
-- ClickHouse intent_events has a 90-day TTL (see 0014_intent_events.sql note).
--
-- Forward-only migration. No down migration.

CREATE TABLE IF NOT EXISTS intent_sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id       text NOT NULL,
  cross_session_id text,
  started_at       timestamptz NOT NULL DEFAULT now(),
  last_event_at    timestamptz NOT NULL DEFAULT now(),
  finalized_at     timestamptz,
  final_archetype  text,
  final_confidence numeric(4,3),
  signal_count     int NOT NULL DEFAULT 0,
  quiz_completed   boolean NOT NULL DEFAULT false,
  quiz_leaf        text,
  chat_turns       int NOT NULL DEFAULT 0,
  intent_state     jsonb,
  CONSTRAINT intent_sessions_tenant_session_unique UNIQUE (tenant_id, session_id)
);

ALTER TABLE intent_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY intent_sessions_tenant_isolation ON intent_sessions
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

CREATE INDEX idx_intent_sessions_tenant_last_event
  ON intent_sessions (tenant_id, last_event_at DESC);
CREATE INDEX idx_intent_sessions_tenant_finalized
  ON intent_sessions (tenant_id, finalized_at DESC NULLS FIRST);
