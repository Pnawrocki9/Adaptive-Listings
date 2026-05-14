# TICKET-AB-006 — Seed ab_bandit_weights with 18 archetype rows per tenant

**Sprint:** 9 **Agent:** data-engineer **Priority:** P0 **Estimated hours:** 2 **Status:** READY
**Promoted from:** FOLLOW-008 (RETRO-002 / TICKET-AB-001) **Unblocks:** TICKET-AB-007 (FOLLOW-014
real Drizzle reads need rows), FOLLOW-007 (Thompson sampling needs arms)

## Context

The `ab_bandit_weights` table was created in TICKET-AB-001 (PR #80) with the correct schema, but has
**zero rows** for every tenant. Without seed data, the Thompson sampling layer has no arms to sample
from, and the analytics dashboard `/api/ab/weights` endpoint returns an empty array even after
FOLLOW-014 replaces the mock with real Drizzle reads.

This ticket establishes the seeding mechanism: a backfill migration for existing tenants, and a hook
that seeds new tenants on creation.

**References:**

- `packages/db/src/schema/` — `abBanditWeights` Drizzle table definition (added in TICKET-AB-001)
- `packages/db/migrations/` — migration files, follow the numbering of existing files
- `packages/shared/src/archetypes.ts` (or wherever the canonical 18-archetype list lives — check
  `packages/sdk/src/core/playbooks/archetypes/` and the `ArchetypeId` type in
  `packages/shared/src/directives.ts`)
- `apps/control-plane/src/app/api/tenants/` — tenant creation flow where the on-create hook goes

## Acceptance criteria

1. Migration file `packages/db/migrations/000N_seed_ab_bandit_weights.sql` (use next available N)
   inserts 18 rows for every existing tenant with:
   - `variant = 'default'`
   - `alpha = 1.0, beta_param = 1.0` (uniform Beta(1,1) prior)
   - `paused = false`
   - `tenant_id` from the `tenants` table
   - Idempotent: uses `ON CONFLICT (tenant_id, archetype, variant) DO NOTHING`
2. Archetype list is pulled from the canonical source in `packages/shared/` or
   `packages/sdk/src/core/playbooks/` — **not hardcoded as a string literal twice**.
3. On-tenant-create hook: after a new `tenants` row is inserted (in the signup flow or the Drizzle
   `afterInsert` equivalent), seeds 18 `ab_bandit_weights` rows for the new tenant. Idempotent.
4. Test: after `createTenant()` fixture call,
   `SELECT COUNT(*) FROM ab_bandit_weights WHERE tenant_id = <new_id>` returns exactly 18.
5. Test: re-running the migration on a tenant that already has rows does not duplicate rows
   (idempotency check).
6. No regression in existing TICKET-AB-001 tests.

## Files to touch

- `packages/db/migrations/000N_seed_ab_bandit_weights.sql` — new migration
- Tenant creation handler (check `apps/control-plane/src/app/api/tenants/route.ts` or the Drizzle
  seed script) — add on-create hook
- Relevant test file (integration test, likely `packages/db/` or `apps/control-plane/`)

## Note on FOLLOW-007 expansion

This ticket seeds only `variant = 'default'`. FOLLOW-007 (Thompson sampling full wiring) will later
expand to `variant_0`, `variant_1`, `variant_2`. Design the migration to be additive so FOLLOW-007
can insert additional variant rows without conflict.
