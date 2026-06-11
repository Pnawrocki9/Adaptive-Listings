-- Migration: 0027_strip_quiz_config_sticky_widget
-- FOLLOW-274 (2026-06-11): Backfill — strip orphaned `sticky_widget` key from quiz_config JSONB.
--
-- Background (Rule U / RETRO-052 §4a LG-1):
--   The `sticky_widget` key inside the quiz_config JSONB blob had zero SDK consumer
--   (grep `sticky_widget|stickyWidget` in packages/sdk/src = empty). It was a write-only
--   orphan: the dashboard toggle wrote it, nothing ever read it at runtime. FOLLOW-274
--   removes the write path (QuizConfigSchema.omit({ sticky_widget: true })) and strips
--   all existing rows here (Rule U: strip-on-write + backfill).
--
-- Safe to run on a live table: the `WHERE quiz_config ? 'sticky_widget'` predicate limits
-- the scan to rows that actually carry the key. The JSONB `-` operator is atomic and
-- does not affect any other key in the blob.
--
-- Forward-only migration.

UPDATE tenants
  SET quiz_config = quiz_config - 'sticky_widget'
  WHERE quiz_config ? 'sticky_widget';
