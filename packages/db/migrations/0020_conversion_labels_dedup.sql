-- Migration: 0020_conversion_labels_dedup
-- Conversion Label Loop — deduplication constraint (MASTER_DESIGN §T.2, FOLLOW-179).
--
-- FOLLOW-171 (0019_conversion_labels.sql) created the `conversion_labels` table with a
-- non-unique index on `prediction_id`. RETRO-029 LG-1 identified the gap: without a UNIQUE
-- constraint on (tenant_id, prediction_id) the feedback route's plain INSERT can create
-- duplicate rows for the same (tenant, prediction) pair, corrupting the training corpus.
--
-- §T.2 specifies "one row per labeled outcome" joined to its prediction. This migration
-- enforces that invariant at the DB layer so no application bug can violate it.
--
-- Safe to apply: the table was created in the immediately preceding migration (0019) and
-- has never been seeded in any environment (no data exists in prod at migration time).
-- Forward-only (no down migration — this is a hardening constraint, not a schema pivot).
--
-- The application layer enforces this via INSERT … ON CONFLICT DO UPDATE (upsertConversionLabel
-- in packages/db/src/upsert-conversion-label.ts), which applies the class-precedence policy
-- defined in packages/shared/src/schemas/conversion-label.ts conversionLabelRank().

ALTER TABLE conversion_labels
  ADD CONSTRAINT conversion_labels_tenant_prediction_unique
  UNIQUE (tenant_id, prediction_id);
