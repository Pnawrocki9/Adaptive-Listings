-- FOLLOW-1310 (Codex F-07): repair legacy intent_sessions.intent_state rows in place.
--
-- WHAT. Before FOLLOW-1310 the ingest writer (apps/ingest/src/handlers/intent-snapshot.ts) sent
-- intent_state as JSON.stringify(probabilities), so the JSONB value is a STRING holding the bare
-- probability map. Every reader expects the envelope object
-- { weights, topArchetype, confidence } (packages/shared/src/intent-state-envelope.ts).
-- This script turns each such string into { "weights": <the map> }.
--
-- WHAT IT DOES NOT DO, on purpose:
--   * It does not invent topArchetype / confidence. The SDK's archetype is not the argmax of the
--     weights (hysteresis, neutral threshold), so deriving one would fabricate it. The next
--     intent.snapshot of a live session writes the full envelope; old sessions keep null.
--   * It does not touch started_at. Legacy started_at was overwritten by every snapshot, so it
--     holds the ts of the LAST snapshot written before the fix: an upper bound on the real start,
--     not the start. No Postgres column records the original value. The only real source is
--     ClickHouse intent_events (90-day TTL): an operator who needs the true start for a session
--     can read SELECT min(event_at) FROM intent_events WHERE tenant_id = ? AND session_id = ?
--     and LOWER started_at to it (never raise it). Not automated here: it crosses two stores.
--   * It skips (leaves for a human) any string that is not a JSON object.
--
-- SAFETY. Data-only, no DDL, idempotent (a second run finds no string rows), one transaction.
-- Not a migration on purpose: packages/db/migrations auto-applies to production on push
-- (db-migrate.yml), and this is an operator step to run once per database after the
-- FOLLOW-1310 ingest Worker is deployed (so no new legacy rows appear behind it):
--
--   psql "$DATABASE_URL_DIRECT" -v ON_ERROR_STOP=1 -f packages/db/scripts/repair-intent-state-follow1310.sql
--
-- Verify before and after:
--   SELECT jsonb_typeof(intent_state) AS kind, count(*) FROM intent_sessions GROUP BY 1;
--
-- Exercised against PGlite by packages/db/src/__tests__/repair-intent-state-follow1310.test.ts.

BEGIN;

DO $$
DECLARE
  r record;
  parsed jsonb;
BEGIN
  FOR r IN
    SELECT id, intent_state #>> '{}' AS raw
    FROM intent_sessions
    WHERE jsonb_typeof(intent_state) = 'string'
  LOOP
    BEGIN
      parsed := r.raw::jsonb;
    EXCEPTION WHEN others THEN
      CONTINUE; -- not JSON: leave the row as it is
    END;
    IF jsonb_typeof(parsed) = 'object' THEN
      UPDATE intent_sessions
      SET intent_state = CASE
        WHEN parsed ? 'weights' THEN parsed
        ELSE jsonb_build_object('weights', parsed)
      END
      WHERE id = r.id;
    END IF;
  END LOOP;
END
$$;

COMMIT;
