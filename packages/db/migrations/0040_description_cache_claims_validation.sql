-- Migration: 0040_description_cache_claims_validation
-- FOLLOW-1305 (Codex WP01, FOLLOW-820 condition 1c; CEO ruling 2026-10-11, ESC-083).
--
-- Adds a nullable `claims_validation` column to description_cache_persistent: the version of
-- the unsupported-claim check (`CLAIMS_VALIDATION_VERSION`, 'claims-v1') that a row's text
-- passed before the Modal job wrote it.
--
-- Compatibility design (legacy admission):
--   * NULL, the value on every pre-existing row, means "written before the check existed".
--     GET /api/adapt/description treats such a FIT row as a MISS: it falls through to Redis,
--     then to the cache-miss path, which enqueues one regeneration under the check. The
--     regenerated row's insert invalidates the old one, so each legacy row costs at most one
--     generation, once. No backfill: a backfill could only copy NULL or assert a check that
--     never ran.
--   * NEUTRAL rows carry no buyer-visible text and are served regardless of this column.
--   * While the control plane reads this column before the Modal job writes it (deploy order),
--     reads see only misses (template_fallback, the seller's copy), never unchecked AI copy:
--     the window fails closed.
--   * Bumping the version later re-validates every cached row the same way.
--
-- Additive and forward-only: one nullable column, no default, no rewrite of existing rows.

ALTER TABLE description_cache_persistent
  ADD COLUMN IF NOT EXISTS claims_validation text;
