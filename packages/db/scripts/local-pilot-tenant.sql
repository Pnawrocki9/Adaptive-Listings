-- local-pilot-tenant.sql — the one DATA row the migration chain itself requires.
--
-- FOLLOW-818. Migration `0016_pilot_inquiry_selector` is data-dependent: it looks up the pilot
-- tenant by slug and aborts the whole chain if the row is absent —
--   "Migration 0016 aborted: tenant with slug \"000-app-estalara\" not found … seed the tenant row
--    before applying. (FOLLOW-141 / FOLLOW-147)"
-- On hosted Supabase that row predates the migration. On a fresh LOCAL container it does not, so a
-- clean-room `pnpm db:migrate` stops at 0016 with 15 migrations applied.
--
-- Apply this to a LOCAL database when the migrator stops there, then re-run `pnpm db:migrate`:
--
--   docker exec -i al_pg_local psql -U supabase_admin -d postgres -v ON_ERROR_STOP=1 \
--     < packages/db/scripts/local-pilot-tenant.sql
--
-- ⚠️ LOCAL only. Never run against Supabase — prod already has this tenant, under its own id.
-- Idempotent: ON CONFLICT DO NOTHING, so re-running it after the chain completes changes nothing.
--
-- The fixed id is a local convention, NOT prod's id for this slug. Only the SLUG is load-bearing:
-- it is what 0016 looks up. `al_enabled` is not set here — the column does not exist yet at 0016;
-- migration 0034 adds it with DEFAULT true, so this row comes out AL-enabled on its own.

INSERT INTO tenants (id, name, slug, status)
VALUES (
  '00000000-0000-0000-0000-000000000816',
  'Local Pilot Bootstrap',
  '000-app-estalara',
  'active'
)
ON CONFLICT (slug) DO NOTHING;
