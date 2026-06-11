-- Migration: 0026_strip_quiz_config_enabled
-- FOLLOW-271 (2026-06-11): Backfill — strip orphaned `enabled` key from quiz_config JSONB.
--
-- Background (Rule U / RETRO-052 §4a LG-1):
--   tenants.quiz_enabled (boolean column, added in FOLLOW-102 / migration 0025) is the
--   sole source-of-truth for quiz ON/OFF. The `enabled` key inside the quiz_config JSONB
--   blob was orphaned: its freeze-guard consumer was removed in FOLLOW-263 but the write
--   path still persisted it. FOLLOW-271 strips it on write (QuizConfigSchema.omit) and
--   removes it from all existing rows here (Rule U: strip-on-write + backfill).
--
-- Safe to run on a live table: the `WHERE quiz_config ? 'enabled'` predicate limits
-- the scan to rows that actually carry the key. The JSONB `-` operator is atomic and
-- does not affect any other key in the blob.
--
-- Forward-only migration.

UPDATE tenants
  SET quiz_config = quiz_config - 'enabled'
  WHERE quiz_config ? 'enabled';
