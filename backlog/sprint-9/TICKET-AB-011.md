# TICKET-AB-011 — Replace getTenantSchema() hardcoded demo tenant with DB lookup

**Sprint:** 9 **Agent:** backend-engineer **Priority:** P0 **Estimated hours:** 4 **Status:** READY
**Promoted from:** FOLLOW-018 (RETRO-003 / TICKET-REORDER-001) **Depends on:** TICKET-AB-010 (do
AB-010 first — both touch the same route.ts) **Unblocks:** TICKET-NATIVE-001 (app.estalara.com Tier
3 integration)

## Context

`getTenantSchema()` in `apps/decision-api/src/lib/reorder.ts` (canonical, added in TICKET-AB-009)
checks `if (tenantId === 'est_demo_tenant')` and returns a hardcoded schema; returns `null` for
everything else. The control-plane adapt route has an inline copy with the same hardcode.

This means no real tenant ever gets a ReorderDirective — the `listing_ids` logic only fires for the
demo tenant. TICKET-NATIVE-001 (Tier 3 SvelteKit integration) is blocked until real tenants can get
their schema from the DB.

**DB column:** `tenants.auto_detected_schema` JSONB (added in TICKET-AUTO-006, PR #77). Contains
`TenantSiteSchema` JSON with `index_schema.{container_selector, item_selector, reorder_capable}`.
Verify the exact JSONB shape by reading `apps/control-plane/src/app/api/detect/route.ts` (the route
that writes this column).

**References:**

- `apps/decision-api/src/lib/reorder.ts` — `getTenantSchema()` to update (canonical)
- `apps/control-plane/src/app/api/adapt/route.ts` — inline copy to keep in sync
- `packages/db/src/schema/` — `tenants` table with `auto_detected_schema` column
- `docs/MASTER_DESIGN.md` sections B.5, B.6 — schema discovery + storage spec

## Acceptance criteria

1. `getTenantSchema(tenantId, env)` in `apps/decision-api/src/lib/reorder.ts` replaces the literal
   match with a Drizzle SELECT from `tenants.auto_detected_schema` WHERE `id = tenantId`.

2. **Redis cache**: result cached at key `schema:{tenantId}` with 5-minute TTL (Upstash Redis via
   `env.UPSTASH_REDIS_URL`). On cache hit, skip DB. On cache miss, DB → write cache → return.

3. **Graceful null** on: DB miss, `auto_detected_schema` is null, `reorder_capable: false`, or
   Redis/DB error (log + return null, never throw).

4. **Demo tenant backward compat**: `est_demo_tenant` still works. Easiest: let the DB lookup
   succeed if a real demo tenant row exists, OR keep the hardcode as a fallback ONLY when DB returns
   null (not as a primary path). Document which approach you chose.

5. **Control-plane sync**: the inline `getTenantSchema()` in
   `apps/control-plane/src/app/api/adapt/route.ts` must also be updated (or deleted and replaced
   with an import from the canonical source). No divergence allowed.

6. Integration test: seed 2 tenant rows:
   - Tenant A: `auto_detected_schema` with `reorder_capable: true` → `getTenantSchema()` returns
     schema
   - Tenant B: `auto_detected_schema` is null → returns `null`
   - Assert ReorderDirective present/absent in `POST /api/adapt` response for each

7. Cache test: call `getTenantSchema()` twice for same tenant with a DB spy → DB called once, cache
   hit on second call.

8. `TICKET-NATIVE-001`'s `depends_on` in `backlog/QUEUE.md` updated to include `TICKET-AB-011`.

## Files to touch

- `apps/decision-api/src/lib/reorder.ts` — update `getTenantSchema()` (canonical)
- `apps/decision-api/src/app/api/adapt/route.ts` — pass `env` (Redis + DB bindings) into
  `getTenantSchema()`
- `apps/control-plane/src/app/api/adapt/route.ts` — sync or replace inline copy
- `apps/decision-api/src/__tests__/adapt.test.ts` — update tests that rely on demo tenant hardcode
- `apps/control-plane/src/app/api/adapt/route.test.ts` — same

## Environment bindings

Worker (`apps/decision-api/`):

- `env.UPSTASH_REDIS_URL` — already available if other routes use Redis (check
  `apps/decision-api/src/index.ts` Env interface)
- `env.DATABASE_URL` or Drizzle client — check how other decision-api routes access Postgres

Control-plane (`apps/control-plane/`):

- Use `process.env.UPSTASH_REDIS_URL` (Next.js)
- Use existing `createAdminClient()` or `createTenantClient()` pattern for Drizzle
