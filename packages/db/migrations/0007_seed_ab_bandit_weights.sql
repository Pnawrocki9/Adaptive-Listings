-- Migration: 0007_seed_ab_bandit_weights
-- TICKET-AB-006 — Seed ab_bandit_weights with 18 canonical archetype rows per existing tenant.
--
-- Archetype list sourced from packages/shared/src/archetypes.ts CANONICAL_ARCHETYPE_IDS
-- (FOLLOW-584 consolidated this onto one shared TS constant; SQL cannot import TS, so this
-- migration intentionally stays an explicit hand-maintained literal below — do not attempt to
-- template it. Keep in sync with CANONICAL_ARCHETYPE_IDS by hand; the runtime seed path
-- (apps/control-plane/src/lib/bandit-seed.ts, used for new tenants) imports the TS constant
-- directly and is guarded against drift by
-- packages/shared/src/__tests__/archetype-canonical-parity.test.ts. This migration only ran
-- once, historically, against tenants that pre-dated that seed path.
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
