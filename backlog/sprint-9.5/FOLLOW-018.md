# FOLLOW-018 — Replace est_demo_tenant hardcode with real tenant schema lookup in adapt route

**Sprint:** 9.5 **Agent:** backend-engineer **Priority:** P0 **Estimated hours:** 3 **Status:**
BLOCKED (on TICKET-033, TICKET-AUTO-006-POLISH) **Depends on:** TICKET-033, TICKET-AUTO-006-POLISH
**Unblocks:** —

## Context

After a tenant goes through the Magic Link wizard (TICKET-030) and activates their schema
(TICKET-AUTO-006-POLISH), the adapt route must serve that tenant's schema — not just the demo
tenant's schema. Without this fix, a newly onboarded tenant will generate an SDK snippet but the
`GET /api/adapt` route will return reorder directives based on the demo schema selectors (or null),
breaking the end-to-end demo.

**Current state of `tenant-schema.ts`:**

`apps/control-plane/src/lib/tenant-schema.ts` has a hardcoded bypass at line ~182:

```typescript
if (tenantId === 'est_demo_tenant') {
  return DEMO_SCHEMA;
}
```

For real tenants the function then does Redis cache lookup → DB lookup. This part already works for
tenants who have a row in `tenant_site_schemas`. **The missing piece is cache invalidation:** when
TICKET-AUTO-006-POLISH activates a schema, the Redis cache key `schema:{tenant_id}` may hold a stale
null (from an earlier failed detection or cold start) for up to 5 minutes. A newly activated tenant
will be silently served null by the cached path.

**Parallel concern — `apps/decision-api` Worker:**

`apps/decision-api/src/lib/reorder.ts` uses `SCHEMA_API_URL` to call back to the control-plane
`GET /api/internal/schema?tenant_id=<id>`. Verifying that this internal endpoint returns the correct
activated schema for real tenants is part of this ticket's acceptance criteria.

**References:**

- `apps/control-plane/src/lib/tenant-schema.ts` — `getTenantSchema()`, `DEMO_SCHEMA`, Redis helpers
- `apps/control-plane/src/app/api/schema/activate/route.ts` — the activation endpoint
  (TICKET-AUTO-006-POLISH) — add cache bust here
- `apps/control-plane/src/app/api/internal/schema/route.ts` — internal schema endpoint for
  decision-api Worker
- `packages/db/src/schema/tenant_site_schemas.ts` — canonical schema store
- `docs/MASTER_DESIGN.md` §B.4, §E.1 (adapt decision tree uses tenant schema for reorder)

## Acceptance criteria

All of the following must be met before the PR may be merged:

1. **Cache invalidation on activation.** The `POST /api/schema/activate` endpoint
   (TICKET-AUTO-006-POLISH) calls `invalidateTenantSchemaCache(tenantId)` synchronously before
   returning its `200` response. `invalidateTenantSchemaCache` deletes the Upstash Redis key
   `schema:{tenantId}` via a `DEL` command. This ensures the very next adapt request after
   activation hits the DB and gets fresh data.

2. **`invalidateTenantSchemaCache` exported from `tenant-schema.ts`.** The function accepts a
   `tenantId: string` argument and fires a Redis `DEL` against the Upstash REST API. It must be
   fire-and-forget compatible (the caller `awaits` it but it must not throw — swallow errors and log
   a `console.warn`). Cache invalidation failure must never cause the activation endpoint to return
   an error.

3. **`est_demo_tenant` bypass preserved.** `getTenantSchema('est_demo_tenant')` still returns
   `DEMO_SCHEMA` without any Redis or DB access. All existing tests that use the demo tenant ID must
   remain green.

4. **Internal schema endpoint correctness.** `GET /api/internal/schema?tenant_id=<uuid>` returns the
   tenant's `TenantSiteSchemaMin` for any tenant that has an activated row in `tenant_site_schemas`.
   Read the existing implementation of this route; if it is already correct, add a test that
   confirms it. If it is not present or incorrect, implement/fix it.

5. **Cache TTL unchanged.** The Redis TTL for tenant schemas remains 300 seconds (5 minutes). Only
   the explicit invalidation path (on activation) flushes early.

6. **No regression on existing adapt responses.** `est_demo_tenant` requests still succeed with the
   hardcoded demo schema. Real tenants with existing rows in `tenant_site_schemas` (inserted before
   this ticket) still receive correct schemas after a cache miss.

7. **Integration test — invalidation on activation.** A test confirms: (a) call `getTenantSchema`
   for a real tenant → DB lookup, result cached in Redis; (b) call `invalidateTenantSchemaCache` for
   that tenant; (c) call `getTenantSchema` again → DB lookup again (cache miss), not the old cached
   value.

8. **`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass locally before PR is
   opened.**

## Files to touch (expected)

| File                                                      | Action                                                  |
| --------------------------------------------------------- | ------------------------------------------------------- |
| `apps/control-plane/src/lib/tenant-schema.ts`             | Export `invalidateTenantSchemaCache(tenantId)` function |
| `apps/control-plane/src/app/api/schema/activate/route.ts` | Call `invalidateTenantSchemaCache` before returning 200 |
| `apps/control-plane/src/app/api/internal/schema/route.ts` | Verify returns correct schema; add test if missing      |
| `apps/control-plane/src/lib/tenant-schema.test.ts`        | Add cache-invalidation integration test                 |

## Test expectations

### Unit tests (required)

1. **`invalidateTenantSchemaCache` calls Redis DEL.** Mock the Upstash fetch. Call
   `invalidateTenantSchemaCache('test-tenant-uuid')`. Assert the DEL request was issued to the
   correct key `schema:test-tenant-uuid`.

2. **`invalidateTenantSchemaCache` swallows errors.** Mock the Upstash fetch to reject. Assert the
   function resolves (does not throw) and `console.warn` was called.

3. **Demo tenant bypass unchanged.** Call `getTenantSchema('est_demo_tenant')`. Assert `DEMO_SCHEMA`
   is returned, and no Redis or DB calls are made.

### Integration test (required)

4. **Cache invalidation round-trip.** Seed a `tenant_site_schemas` row. Call `getTenantSchema` twice
   — assert second call hits cache (only one DB call). Call `invalidateTenantSchemaCache`. Call
   `getTenantSchema` again — assert DB is queried again (cache was busted).

## Branch naming

`backend-engineer/FOLLOW-018-real-tenant-schema-lookup`

## PR title format

`fix(control-plane): real tenant schema lookup in adapt path — cache invalidation on activation [FOLLOW-018]`

## Definition of done

- PR opened, all local checks green.
- `gh pr checks <pr-number> --watch` returns all SUCCESS.
- PM-orchestrator validates AC items above.
- PM-orchestrator comments `PM-validated. CI green. Ready for human review and merge.`
- Ticket moved to `READY_FOR_REVIEW` in QUEUE.md.
