# TICKET-AB-008 — Replace mock /api/ab/weights with real Drizzle reads

**Sprint:** 9 **Agent:** backend-engineer **Priority:** P0 **Estimated hours:** 3 **Status:** READY
**Promoted from:** FOLLOW-014 (RETRO-002 / TICKET-AB-001) **Depends on:** TICKET-AB-006 (seed rows
now in place — confirmed merged PR #107)

## Context

`apps/control-plane/src/app/api/ab/weights/route.ts` is a deterministic mock: `buildMockWeights()`
generates fabricated data. The route's own header comment says "Real Drizzle DB queries will replace
this in TICKET-AB-004" — but TICKET-AB-004 (PR #99) merged without touching this file. The analytics
dashboard's Anomaly Feed (Panel 5) and any holdout-derived metric renders fabricated data.

`ab_bandit_weights` now has real seed rows (18 per tenant) from TICKET-AB-006 (PR #107). The mock
can be replaced.

**References:**

- `apps/control-plane/src/app/api/ab/weights/route.ts` — the mock to replace
- `apps/control-plane/src/app/api/tenants/[id]/bandit/weights/[archetype]/route.ts` — sibling route
  that already uses JWT auth pattern (copy this pattern for auth)
- `packages/db/src/schema/` — `abBanditWeights` Drizzle table
- `backlog/HANDOFFS.md` — TICKET-AB-006/007 handoff note (explains what was seeded)

## Acceptance criteria

1. `GET /api/ab/weights` uses `createTenantClient(jwt).rls(...)` Drizzle SELECT against
   `abBanditWeights`, scoped to `tenant_id` from the JWT claim (NOT from a header).
2. Auth: Bearer JWT required. `tenant_id` extracted from verified JWT — same pattern as the sibling
   PATCH route.
3. Optional `?archetype=` query filter preserved (pass-through to WHERE clause).
4. Mock helpers `buildMockWeights`, `seededRandom`, `hash` deleted entirely.
5. Integration test seeds 3 rows (2 active, 1 paused) and asserts:
   - Response includes all 3 rows
   - `?archetype=yield_hunter` filter returns only matching row
   - Missing JWT → 401
6. When `ab_bandit_weights` is empty (new tenant with no seed yet), returns `[]` gracefully.
7. No regression in existing `route.test.ts` (rewrite tests to match the new shape).
8. Rule H: `buildMockWeights` must disappear from all non-test files.

## Files to change

- `apps/control-plane/src/app/api/ab/weights/route.ts` — replace mock with Drizzle SELECT
- `apps/control-plane/src/app/api/ab/weights/route.test.ts` — rewrite tests
