-- Migration: 0010_tenant_consent_required
-- TICKET-GDPR-004 — Consent State Gate for Decision API
--
-- Adds `consent_required` boolean to the tenants table.
-- Default is true (conservative: require consent by default for all tenants).
--
-- Data migration intent:
--   The tenants table does not have a standalone region column (region is
--   tracked in ingest/ClickHouse events, not in the tenants Postgres table).
--   All existing tenants receive consent_required = true as the safe default.
--   Operators can flip to false via the dashboard for confirmed non-GDPR regions.
--
-- RLS: Column inherits the existing tenant_isolation policy on the tenants table.
-- Forward-only migration. TICKET-GDPR-004.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS consent_required boolean NOT NULL DEFAULT true;
