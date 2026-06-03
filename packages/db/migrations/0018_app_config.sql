-- Migration: 0018_app_config
-- FOLLOW-161 — global key-value config table for Estalara admin settings.
--
-- Creates the app_config table (key PK, value, updated_by, updated_at).
-- Seeds the `generation_model` key with the default `claude-sonnet-4-6`.
--
-- No RLS: this is a global (non-per-tenant) table. Service role access only.
--
-- Forward-only migration. [FOLLOW-161]

CREATE TABLE IF NOT EXISTS app_config (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  updated_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed the global default generation model.
-- ON CONFLICT DO NOTHING so re-running the migration is idempotent.
INSERT INTO app_config (key, value, updated_at)
VALUES ('generation_model', 'claude-sonnet-4-6', now())
ON CONFLICT (key) DO NOTHING;
