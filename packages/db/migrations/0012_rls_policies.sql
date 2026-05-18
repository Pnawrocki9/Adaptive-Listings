-- Migration: 0012_rls_policies
-- TICKET-RUNTIME-FIX-002 — RLS gap closure.
--
-- Enables Row Level Security on all CAT-A tables identified in RLS_DISCOVERY_2026-05-18.md
-- and creates tenant-isolation policies using the modern
-- current_setting('request.jwt.claims', true) pattern per CLAUDE.md spec.
--
-- Tables with RLS already applied in prior migrations (no-ops here):
--   ab_bandit_weights (0004), answers (0006), schema_validation_history (0008),
--   tenant_compliance_records (0009), dsr_verifications (0011)
-- The ALTER TABLE ... ENABLE ROW LEVEL SECURITY statements below are idempotent.
--
-- Tables intentionally without RLS (service-role-only access):
--   tenant_registrations — admin approval workflow, service role only (CAT-C)
--   staff_audit_log     — admin-only audit trail, no tenant context (CAT-C)
--   archetype_embeddings — global cross-tenant reference data, no tenant_id (CAT-B)
--
-- service_role bypasses RLS by Supabase design — no explicit bypass policies needed.
-- All application admin ops use createAdminClient() (DATABASE_URL_ADMIN) which is the
-- Supabase service role and inherently bypasses all policies below.
--
-- All policies use DO $$ EXCEPTION WHEN duplicate_object pattern for idempotency —
-- safe to re-run if the migration is applied to a DB that already has some policies.
--
-- Forward-only migration. [TICKET-RUNTIME-FIX-002]

-- ── Enable RLS on all CAT-A tables (idempotent — no-op if already enabled) ─────────────

ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE demo_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_site_schemas ENABLE ROW LEVEL SECURITY;
ALTER TABLE ab_bandit_weights ENABLE ROW LEVEL SECURITY;
ALTER TABLE answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE schema_validation_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_compliance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE dsr_verifications ENABLE ROW LEVEL SECURITY;

-- ── Enable RLS on CAT-D table (tenant-scoped writes, service_role for ML reads) ─────────

ALTER TABLE session_embeddings ENABLE ROW LEVEL SECURITY;

-- ── Tenant-isolation policies for tables without existing policies ───────────────────────
-- Uses current_setting('request.jwt.claims', true) pattern — canonical per CLAUDE.md.
-- Prior migrations 0004/0006 used auth.jwt(); new policies use current_setting().
-- Both patterns are functionally equivalent in Supabase but current_setting is recommended.

-- TENANTS: agency users see only their own tenant row.
-- This IS the tenant root — the policy key is id, not tenant_id.
DO $$ BEGIN
  CREATE POLICY "tenants: tenant isolation"
    ON tenants FOR ALL TO authenticated
    USING (id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid)
    WITH CHECK (id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- API_KEYS: agency users see only their tenant's keys.
DO $$ BEGIN
  CREATE POLICY "api_keys: tenant isolation"
    ON api_keys FOR ALL TO authenticated
    USING (tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid)
    WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CONSENT_RECORDS: agency users see only their tenant's records.
DO $$ BEGIN
  CREATE POLICY "consent_records: tenant isolation"
    ON consent_records FOR ALL TO authenticated
    USING (tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid)
    WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- DEMO_SESSIONS: agency users see only their own tenant's sessions.
-- All current app access uses createAdminClient() (service role bypass).
-- This policy protects the authenticated role path for future dashboard use.
DO $$ BEGIN
  CREATE POLICY "demo_sessions: tenant isolation"
    ON demo_sessions FOR ALL TO authenticated
    USING (tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid)
    WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- USERS: agency users see only their tenant's users; Estalara staff see all rows.
-- estalara_staff claim is a boolean in the JWT set during Estalara employee login.
DO $$ BEGIN
  CREATE POLICY "users: tenant isolation for agency"
    ON users FOR ALL TO authenticated
    USING (
      tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid
      OR (current_setting('request.jwt.claims', true)::json ->> 'estalara_staff')::boolean = true
    )
    WITH CHECK (
      tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid
      OR (current_setting('request.jwt.claims', true)::json ->> 'estalara_staff')::boolean = true
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- TENANT_SITE_SCHEMAS: tenants see only their own auto-detected schemas.
-- Migration 0003 creates the table but contains no RLS — this closes the gap.
DO $$ BEGIN
  CREATE POLICY "tenant_site_schemas: tenant isolation"
    ON tenant_site_schemas FOR ALL TO authenticated
    USING (tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid)
    WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- SESSION_EMBEDDINGS (CAT-D): tenant-scoped writes for the authenticated role.
-- service_role (ML aggregation, Phase 2 shared classifier) bypasses this automatically.
-- Cross-tenant reads for ML use createAdminClient() / DATABASE_URL_ADMIN.
DO $$ BEGIN
  CREATE POLICY "session_embeddings: tenant isolation"
    ON session_embeddings FOR ALL TO authenticated
    USING (tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid)
    WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::json ->> 'tenant_id')::uuid);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
