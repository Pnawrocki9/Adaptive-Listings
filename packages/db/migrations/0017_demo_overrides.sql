-- Migration: 0017_demo_overrides
-- DEMO-001 — per-tenant archetype + model override for DEMO MODE
--
-- Creates the demo_overrides table. One row per tenant; upserted by the
-- /api/demo/override endpoint when an admin enables/configures DEMO MODE.
--
-- When enabled = true, the POST /api/adapt handler ignores the SDK's
-- archetype_hint and forces override_archetype at high confidence so the full
-- playbook + LLM path runs, generating with override_model.
--
-- RLS: inherits tenant isolation via the tenant_id column. The existing
-- tenant_isolation policy covers this table (applied via the RLS migration
-- 0012_rls_policies.sql pattern — no new policy required for the row-level
-- isolation itself; the API layer also enforces tenant scoping).
--
-- Forward-only migration. [DEMO-001]

CREATE TABLE IF NOT EXISTS demo_overrides (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL UNIQUE,
  enabled        boolean NOT NULL DEFAULT false,
  override_archetype text,
  override_model text NOT NULL DEFAULT 'claude-sonnet-4-6',
  updated_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS demo_overrides_tenant_id_idx ON demo_overrides (tenant_id);
CREATE INDEX IF NOT EXISTS demo_overrides_enabled_idx   ON demo_overrides (enabled);

-- RLS: enable row-level security and create tenant-isolation policy
ALTER TABLE demo_overrides ENABLE ROW LEVEL SECURITY;

CREATE POLICY demo_overrides_tenant_isolation
  ON demo_overrides
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
