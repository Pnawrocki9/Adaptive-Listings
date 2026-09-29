-- Migration: 0039_drop_engagement_scores
-- FOLLOW-1268 (WP-0.6b of docs/PLAN-AUDIT-REMEDIATION-2026-09-24.md; CEO decision D6,
-- narrowed 2026-09-29): drop the phantom `engagement_scores` table.
--
-- Why:
--   0021_engagement_scores created the table "computed by the Modal intent engine". That
--   producer was never built (DPIA §2 "planned; no producer built", FOLLOW-582). The only
--   code that ever touched the table was the DSR erase/access/portability routes, which
--   deleted or disclosed rows that could not exist. Those branches are removed in the same
--   PR, together with the Drizzle definition (packages/db/src/schema/engagement_scores.ts).
--
-- Scope (CEO ruling 2026-09-29): ONLY engagement_scores. `tenant_compliance_records` (LIA
-- API) and `session_embeddings` (read by /api/dsr/initiate) are KEPT.
--
-- NOT additive: this migration auto-applies to prod on merge (db-migrate.yml). The PM
-- pastes `SELECT count(*) FROM engagement_scores` = 0 from prod into the PR before merge.
-- The guard below is the second line of defence: if the table holds ANY row when the
-- migration runs, it raises and the migrator's transaction rolls back, so nothing is
-- dropped. EXECUTE keeps the check valid when the table is already gone.
--
-- DROP TABLE removes the table's indexes (engagement_scores_tenant_session_idx,
-- _tenant_id_idx, _computed_at_idx) and its RLS policy
-- (engagement_scores_tenant_isolation) with it. No other table has a foreign key to it.

DO $$
DECLARE
  has_rows boolean;
BEGIN
  IF to_regclass('public.engagement_scores') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.engagement_scores)' INTO has_rows;
    IF has_rows THEN
      RAISE EXCEPTION 'FOLLOW-1268: engagement_scores is not empty; refusing to drop it';
    END IF;
  END IF;
END
$$;

DROP TABLE IF EXISTS engagement_scores;
