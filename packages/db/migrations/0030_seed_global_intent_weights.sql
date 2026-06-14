-- Migration: 0030_seed_global_intent_weights
-- K.3.6 Archetype Identification Tracer: global-default weight seed (FOLLOW-266, Phase 2).
-- CEO Decision D-1 (immediate weights) + D-4 (global default always present).
--
-- Option A (approved): empty/identity seed — weights = '{}' (all sub-fields absent).
-- An empty weights object is valid per IntentWeightsSchema (all sub-fields optional).
-- The SDK receives `data_source: 'live'` with `weights: {}` and falls back entirely to
-- its internal SDK defaults (BASE_PRIOR, BEHAVIORAL_DAMPING, SIGNAL_LIKELIHOODS).
-- Behavior is identical to the prior no-row mock path, but `data_source` now reads 'live'
-- confirming the DB is configured and reachable. FOLLOW-268-write enables non-empty seeds.
--
-- FOLLOW-302: migration 0029 (line 12) had a stale comment showing
-- `{ signal_weights: {...} }`. The canonical JSONB shape is `signal_likelihoods` (not
-- `signal_weights`). The 0029 SQL comment has been corrected in this PR. The journal
-- monotonicity check does NOT hash SQL file content — only `when` timestamps, entry count,
-- and file existence — so editing the 0029 comment is journal-safe. The canonical
-- schema docstring is packages/db/src/schema/intent-weight-configs.ts and the Zod schema
-- is packages/shared/src/schemas/intent-weights.ts (IntentWeightsSchema).
--
-- Idempotency guard: INSERT ... SELECT WHERE NOT EXISTS (...) — prevents violating the
-- intent_weight_configs_one_active partial unique index when the migration is re-run
-- (e.g. staging DB resets, CI ephemeral DB). The guard checks for ANY active global row
-- (tenant_id IS NULL AND is_active = true). If one already exists (even from a previous
-- run of this migration), the INSERT is a no-op. ON CONFLICT against a COALESCE partial
-- index requires exact predicate matching which is fragile; the WHERE NOT EXISTS approach
-- is unambiguous and engine-portable.
--
-- Columns:
--   id          -- gen_random_uuid() default (UUID PK).
--   tenant_id   -- NULL = global default (no owning tenant, readable by all).
--   is_active   -- true (the active global config).
--   weights     -- '{}' (empty JSONB = identity / Option A seed).
--   created_at  -- now() (system timestamp).
--   created_by  -- NULL (system-seeded, no owning user).
--
-- Forward-only migration. No down migration.

INSERT INTO intent_weight_configs (tenant_id, is_active, weights, created_by)
SELECT
  NULL::uuid,   -- global default
  true,         -- is_active
  '{}'::jsonb,  -- Option A: empty identity seed
  NULL::uuid    -- system-seeded, no owning user
WHERE NOT EXISTS (
  SELECT 1
  FROM intent_weight_configs
  WHERE tenant_id IS NULL
    AND is_active = true
);
