-- Migration: 0023_description_cache_persistent
-- Permanent Postgres cache for AI-generated listing descriptions (FOLLOW-204,
-- Master Design §E.7.3 v4.0, CEO decision 2026-06-05).
--
-- Stores one row per (tenant_id, listing_id, archetype, locale) combination.
-- Descriptions persist indefinitely; they are invalidated (not deleted) by setting
-- invalidated_at when a listing.updated webhook fires. The next HTTP request then
-- triggers a fresh Modal generation, which writes a new valid row.
--
-- Lookup order (§E.7.2):
--   1. description_cache_persistent WHERE invalidated_at IS NULL  → immediate return
--   2. Upstash Redis (hot-path fast cache)
--   3. template_fallback + fire-and-forget Modal enqueue
--
-- RLS: tenant isolation on tenant_id (mirrors engagement_scores, demo_overrides).
-- Forward-only migration.

CREATE TABLE IF NOT EXISTS description_cache_persistent (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       uuid        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  listing_id      text        NOT NULL,
  archetype       text        NOT NULL,
  locale          text        NOT NULL DEFAULT 'pl',
  description     text        NOT NULL,
  headline        text,
  model           text        NOT NULL,
  generated_at    timestamptz NOT NULL DEFAULT now(),
  invalidated_at  timestamptz
);

-- Unique constraint: one valid (non-invalidated) row per combination.
-- This is a partial unique index on NULLs so duplicate invalidated rows are allowed
-- (history is preserved; only one active row per combination).
CREATE UNIQUE INDEX IF NOT EXISTS description_cache_persistent_active_uniq
  ON description_cache_persistent (tenant_id, listing_id, archetype, locale)
  WHERE invalidated_at IS NULL;

-- Covering index for the hot read path (Postgres lookup step 1).
CREATE INDEX IF NOT EXISTS description_cache_persistent_lookup_idx
  ON description_cache_persistent (tenant_id, listing_id, archetype, locale, generated_at DESC)
  WHERE invalidated_at IS NULL;

-- Index for the listing.updated invalidation query (UPDATE ... WHERE listing_id = $1 AND tenant_id = $2).
CREATE INDEX IF NOT EXISTS description_cache_persistent_invalidate_idx
  ON description_cache_persistent (tenant_id, listing_id)
  WHERE invalidated_at IS NULL;

-- RLS: enable row-level security and create the tenant-isolation policy.
ALTER TABLE description_cache_persistent ENABLE ROW LEVEL SECURITY;

CREATE POLICY description_cache_persistent_tenant_isolation
  ON description_cache_persistent
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
