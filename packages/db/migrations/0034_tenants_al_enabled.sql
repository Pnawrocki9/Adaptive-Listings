-- Migration: 0034_tenants_al_enabled
-- FOLLOW-633: Add the al_enabled master ON/OFF switch to the tenants table.
--
-- Background:
--   Until now `tenants.status` (pending|active|suspended|canceled) had ZERO
--   runtime consumers — a suspended tenant kept being served adaptations. This
--   column gives Adaptive Listings a REAL per-tenant on/off that a staff/superadmin
--   operator controls (audited write via /api/admin/tenants/al-state) and that the
--   adapt runtime actually enforces (api/adapt/route.ts GET + POST):
--     al_enabled = false OR status IN ('suspended','canceled')  → serve neutral (OFF)
--     al_enabled = true  AND status IN ('pending','active')      → normal adaptation (ON)
--
-- Default TRUE: the migration auto-applies to prod on merge (db-migrate.yml). The
--   single live tenant (Estalara itself) — and every existing tenant — inherits
--   al_enabled = true and stays ON. DEFAULT true is why this additive migration is
--   safe on a populated table.
--
-- Forward-only, purely additive. The column is NOT NULL with a DEFAULT so it is
-- safe to add to a populated table without a separate backfill step.

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS al_enabled boolean NOT NULL DEFAULT true;
