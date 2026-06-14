-- Migration: 0029_intent_weight_configs
-- K.3.6 Archetype Identification Tracer: global and per-tenant weight override store (FOLLOW-266, Phase 2).
--
-- Stores the signal weight configuration that the intent engine uses when computing archetype
-- probabilities. Supports a global default row (tenant_id IS NULL) and per-tenant overrides.
-- CEO Decision D-1: immediate weight reads; D-4: global default always present.
--
-- Columns:
--   id           -- surrogate PK (UUID).
--   tenant_id    -- FK -> tenants(id) CASCADE DELETE; NULL = global default.
--   is_active    -- soft-gate; at most one active row per (tenant_id, NULL global).
--   weights      -- jsonb: { priors?: {...}, behavioral_damping?: 0.75, signal_likelihoods?: {...} }
--   created_at   -- when this config row was created.
--   created_by   -- FK -> users(id); NULL for system-seeded global defaults.
--
-- Uniqueness: at most one active config per effective scope enforced by partial unique index.
-- The COALESCE trick maps NULL tenant_id to a sentinel UUID so a NULL-safe uniqueness check
-- is expressible as a B-tree index predicate (Postgres partial indexes cannot express IS NULL alone
-- across multiple rows).
--
-- RLS: tenant isolation via current_setting('app.current_tenant_id', true). Global rows (tenant_id
-- IS NULL) are readable by any tenant (SDK-facing /api/intent/config returns global fallback).
--
-- Writer: FOLLOW-266 Phase 2 (backend-engineer) -- initial global seed.
--         FOLLOW-268 (backend-engineer) -- tenant override write API.
--
-- Forward-only migration. No down migration.

CREATE TABLE IF NOT EXISTS intent_weight_configs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid REFERENCES tenants(id) ON DELETE CASCADE,
  is_active   boolean NOT NULL DEFAULT true,
  weights     jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid REFERENCES users(id)
);

-- At most one active config per (tenant_id, NULL global).
-- COALESCE maps NULL to a stable sentinel UUID so the partial index can enforce uniqueness.
CREATE UNIQUE INDEX intent_weight_configs_one_active
  ON intent_weight_configs (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_active = true;

ALTER TABLE intent_weight_configs ENABLE ROW LEVEL SECURITY;
CREATE POLICY intent_weight_configs_tenant_isolation ON intent_weight_configs
  USING (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true)::uuid);
