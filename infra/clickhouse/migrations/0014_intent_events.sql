-- Migration: 0014_intent_events
-- K.3.6 Archetype Identification Tracer: granular intent event trail (FOLLOW-266, Phase 1).
--
-- Stores the append-only per-signal event log for the K.3.6 tracer. Every signal that
-- updates the archetype weight distribution for a buyer session is recorded here.
-- The mutable session-level aggregate (final archetype, confidence, signal count) lives
-- in Postgres `intent_sessions` (packages/db/migrations/0028_intent_sessions.sql).
--
-- This table is the audit trail and offline-training source — it is never updated,
-- only appended to. Analytics and fine-tuning queries join it to Postgres via
-- intent_session_id (maps to intent_sessions.id).
--
-- Columns:
--   intent_session_id  -- FK reference to Postgres intent_sessions.id (UUID).
--   tenant_id          -- tenant isolation; partition key.
--   event_at           -- UTC timestamp with millisecond precision.
--   event_type         -- low-cardinality signal type:
--                         'quiz_answer' | 'chat_turn' | 'behavioral' | 'dwell' |
--                         'pageview' | 'referrer' | 'finalized'
--   archetype_deltas   -- JSON: { archetype -> delta } showing how weights changed.
--   confidence_before  -- confidence score BEFORE this signal was applied.
--   confidence_after   -- confidence score AFTER this signal was applied.
--   top_archetype      -- the leading archetype after applying this signal.
--   event_payload      -- JSON: PII-free snapshot of the raw signal inputs (no email,
--                         no name, no cross-device id). Content varies by event_type.
--
-- ENGINE: MergeTree (local dev + production ClickHouse Cloud).
--   ReplicatedMergeTree is not specified here because ClickHouse Cloud auto-wraps
--   MergeTree in its replicated equivalent (see 0001_create_events.sql pattern).
--
-- ORDER BY: (tenant_id, intent_session_id, event_at) — supports per-session replay
--   and per-tenant analytics scans with optimal sort-key alignment.
--
-- Retention: 90 days enforced via TTL cron (FOLLOW-266 scope note).
--   The 90-day window covers the cross-session localStorage TTL (§13.2) so all events
--   for a durable cross-session identity expire together. A TTL ALTER TABLE will be
--   added in a follow-up migration once the TTL enforcement cron is wired (out of
--   FOLLOW-266 scope per spec).
--
-- Idempotent: CREATE TABLE IF NOT EXISTS (migrate.sh re-applies all files).

-- ENGINE: MergeTree (local dev + production ClickHouse Cloud)
-- Retention: 90 days (enforced by TTL cron -- FOLLOW-266 scope note)
CREATE TABLE IF NOT EXISTS intent_events (
  intent_session_id  UUID                    NOT NULL,
  tenant_id          UUID                    NOT NULL,
  event_at           DateTime64(3, 'UTC')    NOT NULL,
  event_type         LowCardinality(String)  NOT NULL,
  archetype_deltas   String                  NOT NULL DEFAULT '{}',
  confidence_before  Float32                 NOT NULL DEFAULT 0,
  confidence_after   Float32                 NOT NULL DEFAULT 0,
  top_archetype      LowCardinality(String)  NOT NULL DEFAULT '',
  event_payload      String                  NOT NULL DEFAULT '{}'
) ENGINE = MergeTree()
  ORDER BY (tenant_id, intent_session_id, event_at)
  SETTINGS index_granularity = 8192;
