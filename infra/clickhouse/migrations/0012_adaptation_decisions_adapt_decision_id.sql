-- Migration: 0012_adaptation_decisions_adapt_decision_id
-- FOLLOW-105 (ADR-0006 §Decision 4C) — Add `adapt_decision_id` column to
-- `adaptation_decisions`.
--
-- Captures the stable per-decision UUID generated server-side on the canonical
-- `/api/adapt` route. The same UUID is returned to the SDK in the response body
-- (`AdaptationDirectives.adapt_decision_id`), so a response can be cross-correlated
-- with its analytics row for the pilot's audit/debugging trail.
--
-- The adapt route at `apps/control-plane/src/app/api/adapt/route.ts` writes this
-- column via the `logDecisionAsync` ClickHouse INSERT.
--
-- ClickHouse ALTER TABLE ADD COLUMN is non-blocking for MergeTree tables.
-- The empty-string default backfills pre-FOLLOW-105 rows (which never carried a
-- decision UUID) so analytics joining on `adapt_decision_id` keep working.
--
-- NOT LowCardinality: UUIDs are high-cardinality (one per request); a plain String
-- column is the correct choice.

ALTER TABLE adaptation_decisions
    ADD COLUMN IF NOT EXISTS adapt_decision_id String DEFAULT ''
    AFTER variant;
