-- RLS POLICIES — applied manually in Supabase Dashboard or via migration
-- These policies enforce tenant isolation at the database level.
-- Run AFTER creating tables and enabling RLS on each table.
--
-- Enable RLS (run once per table):
-- ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE tenant_registrations ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE consent_records ENABLE ROW LEVEL SECURITY;
-- NOTE: staff_audit_log — RLS NOT enabled (admin-only table, accessed via service role only)

-- TENANTS: agency users see only their own tenant
CREATE POLICY "tenants: tenant isolation"
  ON tenants FOR ALL
  USING (id = (auth.jwt() ->> 'tenant_id')::uuid);

-- TENANT_REGISTRATIONS: no RLS — accessed via service role only (admin approval flow)

-- USERS: agency users see only users in their tenant; staff see all
CREATE POLICY "users: tenant isolation for agency"
  ON users FOR ALL
  USING (
    tenant_id = (auth.jwt() ->> 'tenant_id')::uuid
    OR (auth.jwt() ->> 'estalara_staff')::boolean = true
  );

-- API_KEYS: agency users see only their tenant's keys
CREATE POLICY "api_keys: tenant isolation"
  ON api_keys FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- CONSENT_RECORDS: agency users see only their tenant's records
CREATE POLICY "consent_records: tenant isolation"
  ON consent_records FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
