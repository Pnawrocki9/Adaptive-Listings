# TICKET-AB-005 — Emit ab.assignment event from decision-api on every assignment

**Sprint:** 9 **Agent:** backend-engineer **Priority:** P0 **Estimated hours:** 3 **Status:** READY
**Promoted from:** FOLLOW-006 (RETRO-002 / TICKET-AB-001) **Unblocks:** TICKET-AB-007 (FOLLOW-017
holdout gating)

## Context

`AbAssignmentEventSchema` is fully wired into the shared event registry and the adapt route returns
`holdout_group` in the HTTP response — but no producer ever pushes the `ab.assignment` event into
the ingest pipeline. The analytics pipeline (TICKET-AB-004 dashboard, FOLLOW-009 regression job)
cannot observe assignment events, so holdout fractions are invisible to the system.

The `assignHoldout()` call already happens in `apps/decision-api/src/app/api/adapt/route.ts`. This
ticket adds the producer call after it.

**References:**

- `packages/shared/src/schemas/events/` — `AbAssignmentEventSchema` and `AbAssignmentPayloadSchema`
- `apps/ingest/src/redpanda-producer.ts` — canonical producer pattern (HTTP REST proxy, 3-attempt
  exponential backoff 100ms/500ms/2500ms)
- `apps/decision-api/src/app/api/adapt/route.ts` — where `assignHoldout()` is called
- `apps/decision-api/src/lib/ab-assignment.ts` — `assignHoldout()` return type
- `packages/shared/src/schemas/event.ts` — `EventEnvelopeBaseSchema` defaults

## Acceptance criteria

1. `apps/decision-api/src/app/api/adapt/route.ts` emits an `ab.assignment` event immediately after
   `assignHoldout()` returns `skipped === false`.
2. Event payload validates against `AbAssignmentPayloadSchema` — must include `session_id`,
   `tenant_id`, `holdout_group: boolean`, `holdout_pct: number`, `assigned_at: ISO timestamp`.
3. Emission is **non-blocking**: wrapped in `void promise` or background task with `try/catch` +
   `Sentry.captureException()`. Does NOT delay the 200 response.
4. Skipped assignments (consent opted-out / `skipped === true`) do NOT emit — per TICKET-AB-001
   AC-3.
5. Sentry tag added on producer error path: tag key `ab_assignment_emit_failed`.
6. Integration test: mounts the adapt route, asserts the producer (mocked) was called exactly once
   per successful non-skipped assignment; asserts zero calls when `skipped === true`.
7. No regression in existing TICKET-AB-001 tests.

## Files to touch

- `apps/decision-api/src/app/api/adapt/route.ts` — add producer call after `assignHoldout()`
- `apps/decision-api/src/app/api/adapt/route.test.ts` — add integration test assertions
- Possibly extract a shared `buildAbAssignmentEvent()` helper if the envelope construction is >5
  lines — keep it co-located in the route file or in `apps/decision-api/src/lib/ab-events.ts`

## Rule H compliance

New `buildAbAssignmentEvent()` helper (if created) must have a non-test caller in `route.ts`. Run
before PR:

```bash
grep -rn 'buildAbAssignmentEvent' apps/ --include='*.ts' | grep -v __tests__ | grep -v node_modules
# Must return ≥1 result
bash scripts/check-rule-h.sh origin/main
```
