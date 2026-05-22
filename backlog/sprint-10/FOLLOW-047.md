# FOLLOW-047 — Reject null tenant_id with 403 (STAFF_TENANT_CONTEXT_MISSING)

**Sprint:** 10 **Agent:** backend-engineer **Priority:** P1 **Estimated hours:** 1 **Status:**
IN_PROGRESS **Model:** sonnet-4.6 **Branch:** `backend-engineer/FOLLOW-047-reject-staff-tenant`

## Context

Two routes fall back to the string literal `'estalara_staff'` when `claims.tenant_id` is null:

- `apps/control-plane/src/app/api/detect/route.ts:214`:
  ```ts
  const tenantId: string = claims.tenant_id ?? 'estalara_staff';
  ```
- `apps/control-plane/src/app/api/schema/activate/route.ts:102`:
  ```ts
  const tenantId: string = claims.tenant_id ?? 'estalara_staff';
  ```

`tenant_site_schemas.tenant_id` is typed as `uuid` with a FK to `tenants.id`. When an Estalara staff
member (whose JWT has `tenant_id: null`) calls either endpoint, the downstream Drizzle write fails
with `invalid input syntax for type uuid` and returns:

- **detect** — silently swallows the error ("DB failure must not block the response") → no UX
  signal, burns AI Vision quota on re-runs
- **activate** — returns 500 `INTERNAL_ERROR` with the raw Postgres error message → info disclosure

The fix is a single early-return guard in each route: check `claims.tenant_id` immediately after JWT
validation and return `403` with a structured error code.

## Acceptance criteria

1. **`apps/control-plane/src/app/api/detect/route.ts`** — immediately after the JWT validation block
   (where `claims` is first available), add:

   ```ts
   if (!claims.tenant_id) {
     return NextResponse.json(
       errorBody({
         code: ErrorCode.STAFF_TENANT_CONTEXT_MISSING,
         message: 'Staff callers cannot use the tenant detect API',
         requestId,
       }),
       { status: 403 },
     );
   }
   const tenantId = claims.tenant_id; // no more `?? 'estalara_staff'`
   ```

2. **`apps/control-plane/src/app/api/schema/activate/route.ts`** — same pattern at the same
   position.

3. **`ErrorCode.STAFF_TENANT_CONTEXT_MISSING`** added to the `ErrorCode` enum in
   `packages/shared/src/errors.ts` (or wherever `ErrorCode` is defined — grep first).

4. **Tests — detect route.** Add a test case: JWT with `tenant_id: null` → 403
   `STAFF_TENANT_CONTEXT_MISSING`. (Existing test file:
   `apps/control-plane/src/app/api/detect/route.test.ts`)

5. **Tests — activate route.** Same pattern in
   `apps/control-plane/src/app/api/schema/activate/route.test.ts`.

6. **No regression** in existing tests. `pnpm test`, `pnpm typecheck`, `pnpm lint` pass.

## Files to touch

| File                                                           | Action                                            |
| -------------------------------------------------------------- | ------------------------------------------------- |
| `apps/control-plane/src/app/api/detect/route.ts:214`           | Replace sentinel fallback with early 403          |
| `apps/control-plane/src/app/api/schema/activate/route.ts:102`  | Same                                              |
| `packages/shared/src/errors.ts` (or equivalent)                | Add `STAFF_TENANT_CONTEXT_MISSING` to `ErrorCode` |
| `apps/control-plane/src/app/api/detect/route.test.ts`          | Add null-tenant_id → 403 test                     |
| `apps/control-plane/src/app/api/schema/activate/route.test.ts` | Same                                              |

## Key files to read before starting

- `apps/control-plane/src/app/api/detect/route.ts` — find the JWT validation block and the
  `tenantId` declaration
- `apps/control-plane/src/app/api/schema/activate/route.ts` — same

## Definition of done

- PR opened on `backend-engineer/FOLLOW-047-reject-staff-tenant`
- All CI checks green (ignore: Doppler, Rule I, Python tests)
- PM-orchestrator validates AC items and comments: `PM-validated. CI green. Ready for human review.`
- QUEUE.md: FOLLOW-047 → `READY_FOR_REVIEW`
