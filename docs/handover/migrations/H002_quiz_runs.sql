-- Handover migration: H002_quiz_runs
-- FOLLOW-1358 (plan Faza Q package Q3, ESC-086 items 2 and 6, MASTER_DESIGN §E.4.8 v3.0): one row
-- per quiz shown to a buyer, the data the pre-registered >= 90 % accuracy analysis counts.
--
-- WHY THIS FILE IS NOT UNDER packages/db/migrations/
--   `.github/workflows/db-migrate.yml` applies every file under `packages/db/migrations/**` to the
--   LIVE production Supabase on each push to `main`. CEO ruling 2026-10-18 ("Tylko localhost, prod
--   dla CTO"): this table exists only on localhost until the CTO applies it. Localhost:
--   `scripts/dev/localhost-up.sh` applies every docs/handover/migrations/*.sql file to
--   `al_pg_local` (step 4). Production: docs/handover/CTO_HANDOVER.md section 4 (the quiz_runs row)
--   (row 18) - apply it ONLY together with the deployed retention job FOLLOW-1364 (13 months,
--   CEO ruling 2026-10-20), and before any SDK build that sends the pings is served. The control
--   plane deploys on every merge to main; until this file is applied `POST /api/quiz/run` answers
--   503 `quiz_runs_table_missing` (one Sentry event per ping) and the SDK, which sends the ping
--   fire-and-forget, drops it - no buyer-visible effect. The DSR routes treat the missing table as
--   holding no rows (a table that does not exist holds no personal data).
--   (H002: a handover number, deliberately outside the drizzle 00NN sequence; no drizzle schema
--   file either - the control plane reads and writes it through `lib/quiz-runs.ts`.)
--
-- WHAT IT HOLDS
--   Written by `POST /api/quiz/run` (apps/control-plane/src/app/api/quiz/run/route.ts) through
--   `recordQuizRunEvent` in apps/control-plane/src/lib/quiz-runs.ts: a forward-only state machine
--   (shown -> dismissed; shown -> completed -> confirmed | corrected | unconfirmed; the first
--   terminal status wins; a replay or a backward step changes nothing). `id` is the run UUID the
--   SDK draws when the quiz card renders. Read by the DSR access/portability routes, erased by DSR
--   erase on (tenant_id, session_id), and by the quiz-accuracy report (FOLLOW-1363).
--   Pseudonymous only: `session_id` = the random per-tab session UUID v4 (Activity 2, ESC-070;
--   the same key as
--   quiz_completions), answer INDEXES, closed-list archetype and trait ids, timings rounded to
--   100 ms and capped at 600000 ms. No IP address, no user agent, no free text.
--
-- IDEMPOTENT: safe to apply any number of times (CREATE ... IF NOT EXISTS; the policy is dropped and
--   recreated because CREATE POLICY has no IF NOT EXISTS).
-- ROLLBACK:  DROP TABLE quiz_runs;   (nothing else references it)

CREATE TABLE IF NOT EXISTS quiz_runs (
  -- quiz_run_id: the random UUID the SDK draws when the card renders (not generated here).
  id                  uuid        PRIMARY KEY,
  tenant_id           uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Random per-tab session UUID v4 (Activity 2, ESC-070); same key as quiz_completions (DSR key).
  session_id          text        NOT NULL,
  language            text,
  -- sha-256 hex of the served definition (lib computeQuizDefinitionHash) or an SDK fallback label.
  definition_hash     text,
  -- quiz_definitions.version of the served row; NULL for the built-in default.
  definition_version  integer,
  sdk_version         text,
  status              text        NOT NULL
    CHECK (status IN ('shown', 'dismissed', 'completed', 'confirmed', 'corrected', 'unconfirmed')),
  -- The step the buyer was on when the card closed (dismissed) or the last ping was sent.
  last_step           integer     CHECK (last_step IS NULL OR last_step >= 0),
  -- The quiz leaf; NULL until completed.
  resolved_archetype  text,
  -- [{question_id, answer_index} | {question_id, answer_indexes: [...]}] in walk order.
  answer_path         jsonb,
  -- Canonical trait ids (packages/shared/src/traits.ts).
  traits              jsonb,
  -- Milliseconds per question, rounded to 100 ms, each capped at 600000.
  step_ms             integer[]
    CHECK (step_ms IS NULL OR (cardinality(step_ms) <= 40
           AND 0 <= ALL (step_ms) AND 600000 >= ALL (step_ms))),
  -- Milliseconds on the confirmation screen, rounded to 100 ms, capped at 600000.
  result_ms           integer     CHECK (result_ms IS NULL OR result_ms BETWEEN 0 AND 600000),
  -- Archetype ids offered after "Not quite", in display order.
  offered             jsonb,
  -- = the leaf (confirmed) | the correction target or 'none_of_these' (corrected).
  confirmed_archetype text,
  shown_at            timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quiz_runs_confirmed_archetype_check
    CHECK (confirmed_archetype IS NULL OR status IN ('confirmed', 'corrected'))
);

-- The accuracy report (FOLLOW-1363) groups one definition's runs by status.
CREATE INDEX IF NOT EXISTS quiz_runs_tenant_hash_status_idx
  ON quiz_runs (tenant_id, definition_hash, status);
-- Date-window reads (monthly rows of the report). Also serves the tenant_id foreign key.
CREATE INDEX IF NOT EXISTS quiz_runs_tenant_shown_at_idx
  ON quiz_runs (tenant_id, shown_at);
-- DSR erase / access / portability look a subject up by (tenant_id, session_id).
CREATE INDEX IF NOT EXISTS quiz_runs_tenant_session_idx
  ON quiz_runs (tenant_id, session_id);

-- RLS: tenant isolation on tenant_id, mirroring quiz_completions (0022) and lift_daily_snapshots
-- (H001). The only accessors are the control plane's service-role (admin) client, which bypasses
-- RLS and fences every query with WHERE tenant_id = <the API key's tenant>; the policy denies every
-- other role any row whose tenant is not the one set in app.current_tenant_id.
ALTER TABLE quiz_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quiz_runs_tenant_isolation ON quiz_runs;
CREATE POLICY quiz_runs_tenant_isolation
  ON quiz_runs
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);

-- The table is reachable only through the service-role client; take the API roles' default grants
-- away so RLS is not the only barrier. Guarded: a plain Postgres (CI, PGlite) has no such roles.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON quiz_runs FROM %I', r);
    END IF;
  END LOOP;
END
$$;
