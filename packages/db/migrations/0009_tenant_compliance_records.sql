-- Migration: 0009_tenant_compliance_records
-- TICKET-GDPR-003 — LIA (Legitimate Interest Assessment) CRUD API
--
-- Creates the `tenant_compliance_records` table that stores executed compliance
-- documents per tenant. Initially used for LIAs (GDPR Art. 6(1)(f)).
-- The table is intentionally extensible via the `record_type` column.
--
-- Soft-delete only: `metadata.deleted = true` — physical DELETE is never permitted
-- because compliance records must be retained for audit trail purposes.
--
-- RLS:
--   - Tenant users can SELECT only their own rows.
--   - Only the backend service role can INSERT/UPDATE (service_role bypasses RLS in Supabase).
--
-- Forward-only migration. TICKET-GDPR-003.

CREATE TABLE IF NOT EXISTS tenant_compliance_records (
  id                      UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id               UUID          NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  record_type             TEXT          NOT NULL,
  version                 TEXT          NOT NULL,
  purpose_statement       TEXT          NOT NULL,
  necessity_justification TEXT          NOT NULL,
  balancing_conclusion    TEXT          NOT NULL,
  optout_mechanism        TEXT          NOT NULL,
  signed_by_name          TEXT          NOT NULL,
  signed_by_email         TEXT          NOT NULL,
  signed_at               TIMESTAMPTZ   NOT NULL,
  metadata                JSONB         NOT NULL DEFAULT '{}',
  created_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tenant_compliance_records_tenant_type
  ON tenant_compliance_records(tenant_id, record_type);

-- RLS: tenant can read only their own compliance records.
ALTER TABLE tenant_compliance_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_compliance_records: tenant read isolation"
  ON tenant_compliance_records FOR SELECT
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- Service role bypass: the backend API uses the service role and is exempt from RLS.
-- Supabase service_role key bypasses RLS by default — no explicit policy needed for INSERT/UPDATE.
