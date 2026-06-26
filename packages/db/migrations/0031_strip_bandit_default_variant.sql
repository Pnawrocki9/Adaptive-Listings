-- Migration: 0031_strip_bandit_default_variant
-- FOLLOW-361 — Reconcile bandit seed convention ('default' → control/v1/v2).
--
-- Background:
--   bandit-seed.ts historically seeded variant='default' (one row per archetype)
--   while bandit-query.ts lazy-seeds variant='control'/'v1'/'v2' (three rows per
--   archetype) on first request.  Both conventions could coexist in the same table
--   for the same (tenant_id, archetype), diluting the Beta(α,β) posteriors for the
--   arms that thompsonSample() actually samples.
--
-- This migration deletes all rows where variant = 'default'.
-- After this migration the only variants in ab_bandit_weights are control, v1, v2.
--
-- Idempotent: DELETE WHERE variant = 'default' is a no-op when no such rows exist.
-- Forward-only migration. FOLLOW-361.

DELETE FROM ab_bandit_weights
WHERE variant = 'default';
