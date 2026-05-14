-- Migration: 0007_seed_ab_bandit_weights
-- TICKET-AB-006 — Seed ab_bandit_weights with 18 canonical archetype rows per existing tenant.
--
-- Archetype list sourced from packages/shared/src/directives.ts ArchetypeId type.
-- 18 archetypes × variant='default' × Beta(1,1) uniform prior (alpha=1, beta=1).
--
-- Idempotent: ON CONFLICT (tenant_id, archetype, variant) DO NOTHING.
-- On-tenant-create hook in apps/control-plane also seeds these rows for new tenants.
--
-- Forward-only migration. TICKET-AB-006.

INSERT INTO ab_bandit_weights (tenant_id, archetype, variant, alpha, beta, paused)
SELECT
  t.id,
  arch.archetype,
  'default',
  1.0,
  1.0,
  false
FROM tenants t
CROSS JOIN (VALUES
  ('yield_hunter'),
  ('vacation_rental_investor'),
  ('flip_investor'),
  ('portfolio_builder'),
  ('golden_visa_buyer'),
  ('commercial_investor'),
  ('family_buyer'),
  ('first_time_buyer'),
  ('upsizer'),
  ('downsizer'),
  ('luxury_buyer'),
  ('remote_worker'),
  ('lifestyle_expat'),
  ('retiree_relocator'),
  ('diaspora_buyer'),
  ('second_home_buyer'),
  ('student_parent'),
  ('neutral')
) AS arch(archetype)
ON CONFLICT (tenant_id, archetype, variant) DO NOTHING;
