# TICKET-AB-010 — Add holdout gating + consent skip to control-plane POST /api/adapt

**Sprint:** 9 **Agent:** backend-engineer **Priority:** P0 **Estimated hours:** 2 **Status:** READY
**Promoted from:** FOLLOW-017 (RETRO-003 / TICKET-REORDER-001 + TICKET-AB-001) **Depends on:**
TICKET-AB-005 (publishAbAssignmentEvent in decision-api — confirm location before importing)

## Context

`apps/control-plane/src/app/api/adapt/route.ts` (the POST handler used by the demo) has NO holdout
assignment and NO consent gating. The Worker decision-api route enforces both (from TICKET-AB-001).
With the demo POST now emitting ReorderDirectives (TICKET-AB-009), the demo experience bypasses the
entire A/B framework — any session routed through the control-plane POST receives reorders
regardless of holdout-arm assignment or consent state.

**What was done in related tickets:**

- TICKET-AB-001: `assignHoldout()` lives in `apps/decision-api/src/lib/ab-assignment.ts`
- TICKET-AB-005: `publishAbAssignmentEvent()` lives in `apps/decision-api/src/lib/ab-events.ts`
- TICKET-AB-009: `buildReorderDirective()` lives in `apps/decision-api/src/lib/reorder.ts`

**Cross-app import strategy (decide before implementing):**

- Check if `apps/control-plane/tsconfig.json` has path aliases that allow importing from
  `apps/decision-api/src/lib/`
- If yes: import directly
- If no: extract the minimal shared logic (`assignHoldout()`, `SKIP_CONSENT_STATES`,
  `AbAssignmentResult`) to `packages/shared/src/ab-holdout.ts` — this is acceptable since
  `packages/shared` is the existing shared utilities package. Do NOT duplicate logic silently.

## Acceptance criteria

1. The control-plane POST calls `assignHoldout()` with:
   - `(tenant_id, session_id, consent_state, consent_mode_enabled, holdout_pct)`
   - Values from request body (already accepted by the route schema)

2. **Holdout arm** (`holdout_group === true`):
   - Response: `directives: []`, `reorderDirectives: []`, `source: 'default'`, `holdout_group: true`
   - `ab.assignment` event emitted (call `publishAbAssignmentEvent()` from TICKET-AB-005)

3. **Consent skipped** (`skipped === true`, i.e. consent_state in SKIP_CONSENT_STATES):
   - Response: `directives: []`, `reorderDirectives: []`, `source: 'default'`
   - `holdout_group` field ABSENT from response (per AB-001 AC-3)
   - NO `ab.assignment` event emitted

4. **Active treatment** (non-holdout, non-skipped):
   - Response includes TextDirectives + ReorderDirective (if reorder_capable) as before

5. Integration test: 100 requests with `holdout_pct: 0.1` → statistically ~10 return empty
   `directives` (test with fixed session_ids that hash into holdout to make deterministic).

6. No regression in existing control-plane adapt route tests (TICKET-AB-009 added 17 new tests —
   verify they still pass).

## Files to touch

- `apps/control-plane/src/app/api/adapt/route.ts` — add `assignHoldout()` call at top of handler
- `packages/shared/src/ab-holdout.ts` (if cross-app imports don't work) — extract `assignHoldout()`
- `apps/control-plane/src/app/api/adapt/route.test.ts` — add holdout gating test cases

## Rule H note

If you create `ab-holdout.ts` in `packages/shared/`, it must have ≥1 non-test consumer in `apps/`.
Run `bash scripts/check-rule-h.sh origin/main` before pushing.
