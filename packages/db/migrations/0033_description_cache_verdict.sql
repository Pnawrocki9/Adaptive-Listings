-- Migration: 0033_description_cache_verdict
-- FOLLOW-465 / audit F-18: negative-cache NEUTRAL archetype-fit verdicts (ADR-0010)
-- to stop perpetual Sonnet re-spend.
--
-- Adds a nullable `verdict` column to description_cache_persistent. NULL (the value
-- on every pre-existing row) is treated as the implicit 'FIT' verdict by every
-- reader — full backward compatibility, no backfill required.
--
-- A 'NEUTRAL' row is a negative-cache marker written by the Modal job
-- (generate_description.py) when the archetype-fit gate (ADR-0010) declines to
-- adapt a (listing, archetype) pair: `description` is '' and `headline` is NULL.
-- The read path (GET /api/adapt/description) recognizes a NEUTRAL row and
-- short-circuits to template_fallback WITHOUT re-enqueuing a new Sonnet
-- generation — closing the perpetual-re-spend gap where a NEUTRAL verdict was
-- previously indistinguishable from a genuine generation failure (both wrote
-- nothing, so every repeat request re-ran the cache-miss path forever).
--
-- Same (tenant_id, listing_id, archetype, locale) row shape as every other entry,
-- so the EXISTING invalidation infra (Postgres `invalidatePgDescriptionCache`
-- tenant+listing WHERE, Redis SCAN desc:{tenant}:{listing}:* wildcard delete)
-- covers NEUTRAL markers for free on listing.updated.
--
-- Forward-only migration.

ALTER TABLE description_cache_persistent
  ADD COLUMN IF NOT EXISTS verdict text
    CHECK (verdict IS NULL OR verdict IN ('FIT', 'NEUTRAL'));
