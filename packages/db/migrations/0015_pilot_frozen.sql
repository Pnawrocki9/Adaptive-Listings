-- Migration: 0015_pilot_frozen
-- FOLLOW-106 — Pilot freeze runtime guard
--
-- Adds `pilot_frozen` boolean to the tenants table.
-- Default is false (normal operating state).
--
-- When TICKET-PILOT-001 flips the pilot tenant from shadow mode to live,
-- the operator sets pilot_frozen = true. The adapt route at
-- apps/control-plane/src/app/api/adapt/route.ts logs a non-blocking
-- structured warning whenever pilot_frozen = true AND a Lane C feature flag
-- is active, so measurement-window contamination is immediately observable.
--
-- Column inherits the existing tenant_isolation RLS policy on the tenants
-- table — no new policy required.
-- Forward-only migration. [FOLLOW-106]

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS pilot_frozen boolean NOT NULL DEFAULT false;
