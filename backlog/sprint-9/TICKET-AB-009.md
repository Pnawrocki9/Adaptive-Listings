# TICKET-AB-009 — Wire ReorderDirective into production decision-api Worker route

**Sprint:** 9 **Agent:** backend-engineer **Priority:** P0 **Estimated hours:** 4 **Status:** READY
**Promoted from:** FOLLOW-015 (RETRO-003 / TICKET-REORDER-001) **Depends on:** none (independent of
AB-008)

## Context

`apps/decision-api/src/app/api/adapt/route.ts:39` accepts
`listing_ids: z.array(z.string()).optional()` but **never consumes it** — no ReorderDirective is
ever built. The control-plane mock POST at `apps/control-plane/src/app/api/adapt/route.ts` does
produce ReorderDirectives, but only for the hardcoded `est_demo_tenant`. In any production wiring
where the SDK points `decisionApiUrl` at the Worker, reorder silently never happens.

**References:**

- `apps/decision-api/src/app/api/adapt/route.ts` — add ReorderDirective emission here
- `apps/control-plane/src/app/api/adapt/route.ts` — `buildReorderDirective()` +
  `deterministicScore()` + `getTenantSchema()` helpers to port/share
- `packages/shared/src/directives.ts` — `ReorderDirective` type
- `backlog/HANDOFFS.md` — Sprint 7 Phase 2 architect review (Finding A1–A8) for context
- FOLLOW-015 in `backlog/FOLLOW_UPS.md` for full scope

## Acceptance criteria

1. **Shared helper module**: extract `getTenantSchema()`, `buildReorderDirective()`, and
   `deterministicScore()` from the control-plane route into a new shared location —
   `apps/decision-api/src/lib/reorder.ts` (Worker side) is the canonical source; the control-plane
   route imports from it (or from `packages/shared/` if architect approves cross-app import). **No
   code duplication** — the same logic must not exist in two places.

2. The Worker adapt route consumes `listing_ids` and emits a `ReorderDirective` when:
   - The tenant's `TenantSiteSchema` has `reorder_capable: true`
   - The session is NOT in the holdout arm (holdout sessions receive no ReorderDirective)

3. `listing_ids` Zod schema is **identical** between the Worker route and control-plane route:
   `z.array(z.string().max(64)).max(100).optional()`

4. Holdout sessions (from `assignHoldout()`) receive an empty `reorderDirectives: []` in response.
   Integration test asserts this.

5. Integration test: POST with 5 `listing_ids`, non-holdout session → response includes
   `ReorderDirective` with sorted `listing_ids` by score.

6. Latency budget: p95 < 100ms on the decision-api hot path. Add a vitest benchmark or note in PR if
   the `getTenantSchema()` lookup adds >5ms. A DB lookup is fine; an unindexed full-table scan is
   not.

7. Rule H: every new exported symbol in `reorder.ts` has ≥1 non-test caller. Run:

   ```bash
   bash scripts/check-rule-h.sh origin/main
   ```

8. Temporary guard: `getTenantSchema()` still returns the demo tenant schema for `est_demo_tenant`
   (backward compat). The full DB lookup per FOLLOW-018 is a separate ticket.

## Architecture note (read before implementing)

The Sprint 7 Phase 2 architect review (HANDOFFS.md) found that the control-plane POST and the Worker
decision-api route must share the reorder building logic. The shared module location needs a quick
decision:

- **Option A (preferred):** `apps/decision-api/src/lib/reorder.ts` — Worker-owned, control-plane
  imports via a Cloudflare-compatible import path. Works if control-plane doesn't run on the edge.
- **Option B:** `packages/shared/src/reorder-builder.ts` — true monorepo shared, adds to bundle.

Default to Option A unless you discover a blocker (e.g., edge-only API used in reorder.ts). Document
your choice in a code comment.

## Files to touch

- `apps/decision-api/src/lib/reorder.ts` — new shared reorder builder (extract from control-plane)
- `apps/decision-api/src/app/api/adapt/route.ts` — wire ReorderDirective after holdout check
- `apps/control-plane/src/app/api/adapt/route.ts` — replace inline helpers with import from
  decision-api lib (or shared package)
- `apps/decision-api/src/__tests__/adapt.test.ts` — add ReorderDirective integration tests
