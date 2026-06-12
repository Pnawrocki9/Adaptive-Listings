-- Migration: 0016_intent_events_session_id_type_fix
-- FOLLOW-287 (CB-1): Attempted to change intent_session_id from UUID to String.
--
-- OUTCOME: No DDL change applied. ClickHouse 26.5.1 rejects MODIFY COLUMN on ORDER BY key
-- columns (error 524: ALTER_OF_COLUMN_IS_FORBIDDEN). The ORDER BY key
-- (tenant_id, intent_session_id, event_at) cannot have its column type changed via ALTER.
--
-- Resolution: the ingest handler (apps/ingest/src/handlers/intent-snapshot.ts) omits
-- intent_session_id from the INSERT body, letting ClickHouse use the zero-UUID default
-- (00000000-0000-0000-0000-000000000000). The authoritative session join key is:
--   intent_events.session_id = intent_sessions.session_id (+ tenant_id)
-- using the String column added by migration 0015.
--
-- This migration is a no-op placeholder so the migration journal sequence is unbroken.
-- The migrate.sh idempotency guard tracks it to prevent re-application.

SELECT 1;
