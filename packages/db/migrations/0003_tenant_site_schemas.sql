CREATE TABLE IF NOT EXISTS tenant_site_schemas (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain                TEXT NOT NULL,
  schema                JSONB NOT NULL,
  detection_source      TEXT NOT NULL,
  detection_confidence  FLOAT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_tenant_site_schemas_tenant_id
  ON tenant_site_schemas(tenant_id);
