-- Migration: 0025_tenants_quiz_enabled
-- FOLLOW-102: Add quiz_enabled boolean column to tenants table.
--
-- Background (§B.1 / §E.4 / §D.6):
--   Tenants with high-quality chat coverage (e.g. app.estalara.com) may want to
--   disable the quiz UX, relying on behavioral + chat NLP signals only. Tenants
--   without chat need the quiz as a primary archetype signal source (3 archetypes
--   formerly unreachable are only reachable via the quiz CROSS-BORDER branch).
--
-- Default true: pilot tenant behavior is not changed. Every existing tenant
--   inherits quiz_enabled = true (the Sprint 13b freeze rule is satisfied).
--
-- Forward-only migration. The column is NOT NULL with a DEFAULT so it is safe
-- to add to a populated table without backfilling first.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS quiz_enabled boolean NOT NULL DEFAULT true;
