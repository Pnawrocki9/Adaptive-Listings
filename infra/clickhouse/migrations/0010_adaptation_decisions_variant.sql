-- Migration: 0010_adaptation_decisions_variant
-- FOLLOW-007 — Add `variant` column to `adaptation_decisions`.
--
-- Captures the Thompson sampling bandit variant selected per request
-- (one of: 'control', 'v1', 'v2', ...). The adapt route at
-- `apps/control-plane/src/app/api/adapt/route.ts` writes this column
-- via the `logDecisionAsync` ClickHouse INSERT.
--
-- ClickHouse ALTER TABLE ADD COLUMN is non-blocking for MergeTree tables.
-- The default value ('control') backfills all existing rows so any
-- analytics aggregation that joins on `variant` continues to work for
-- pre-FOLLOW-007 data.
--
-- `LowCardinality(String)` is correct here: the variant space is small
-- and bounded (3 arms today; we expect ≤16 in the long run).

ALTER TABLE adaptation_decisions
    ADD COLUMN IF NOT EXISTS variant LowCardinality(String) DEFAULT 'control'
    AFTER gate_reason;
