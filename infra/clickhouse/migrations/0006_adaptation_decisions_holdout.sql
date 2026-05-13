-- Migration: 0006_adaptation_decisions_holdout
-- TICKET-AB-001 — Add holdout_group column to adaptation_decisions.
--
-- All rows written by the Decision API populate this field:
--   true  = session was in the holdout (control) group — served default experience.
--   false = session was in the treatment group — served adapted experience.
--
-- ClickHouse ALTER TABLE ADD COLUMN is non-blocking for MergeTree tables.
-- The default value (false) backfills all existing rows.

ALTER TABLE adaptation_decisions
  ADD COLUMN IF NOT EXISTS holdout_group Boolean DEFAULT false;
