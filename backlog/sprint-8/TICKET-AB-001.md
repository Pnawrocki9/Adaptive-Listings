# TICKET-AB-001 — A/B Holdout Framework

**Sprint:** 8 **Agent:** backend-engineer **Priority:** P0 **Estimated hours:** 10 **Status:**
IN_PROGRESS **Started:** 2026-05-13T12:00:00Z **Depends on:** TICKET-DQS-001, TICKET-ADP-002
**Unblocks:** TICKET-AB-004, TICKET-CAUSAL-001

## Context

Master Design sections E.3, E.3.1, E.3.2 specify an A/B holdout framework with Thompson sampling
bandit to measure and optimize adaptation lift. This ticket implements the core infrastructure:
session-to-group assignment, event emission, and bandit weight storage. The analytics dashboard
(TICKET-AB-004) and causal inference layer (TICKET-CAUSAL-001) both depend on the data this ticket
produces.

**References:**

- `docs/MASTER_DESIGN.md` sections E.3, E.3.1, E.3.2
- ADR-0003 (`docs/adr/ADR-0003-event-schema.md`) — event schema versioning; the new `ab_assignment`
  event type must follow the envelope schema from this ADR.
- `packages/shared/src/schemas/events/index.ts` — where the new event Zod schema is registered.

**Fair-housing note (binding):** Assignment MUST be uniformly random, keyed solely on
`(tenant_id, session_id)` hash. No segmentation by protected characteristic or any proxy (location
cluster, price tier, archetype label). This constraint was reviewed and approved by Piotr Nawrocki
on 2026-05-13 (see `backlog/ESCALATIONS.md` resolution for TICKET-AB-001).

## Acceptance criteria

All of the following must be met before the PR may be merged:

1. **Uniform random assignment.** Given a stream of unique `(tenant_id, session_id)` pairs, the
   fraction assigned to holdout converges to the configured `holdout_pct` (default `0.10`) within ±1
   pp at N=10,000. Assignment is deterministic: the same `(tenant_id, session_id)` always returns
   the same group across process restarts (hash-based, not stateful RNG).

2. **Idempotent assignment per (tenant, session).** Calling the assignment function twice with the
   same `(tenant_id, session_id)` returns the same `holdout_group` boolean both times. No row is
   double-inserted; upsert semantics apply to any Postgres record.

3. **Consent-aware skip.** When a session's `consent_state` field on the inbound event is
   `"opted_out"` or `"unknown"` and the tenant has consent mode enabled, the assignment step is
   skipped entirely: the session is served the default (non-personalized) experience, no
   `ab_assignment` event is emitted, no row is written to the DB. When `consent_state` is
   `"granted"`, assignment proceeds normally.

4. **Event emission on assignment.** When a new assignment is made, an `ab_assignment` event is
   emitted to the ingest pipeline (Redpanda topic `estalara.events`) using the standard envelope
   schema from ADR-0003. The event payload must include at minimum:
   - `session_id`
   - `tenant_id`
   - `holdout_group: boolean`
   - `holdout_pct: number` (the configured rate at time of assignment)
   - `assigned_at: ISO timestamp`

5. **`holdout_group` column on `adaptation_decisions`.** The ClickHouse `adaptation_decisions` table
   gains a `holdout_group Boolean` column. All rows written by the Decision API populate this field.
   A migration file is provided under `packages/data/migrations/` (or wherever existing ClickHouse
   DDL migrations live — check TICKET-014 output).

6. **Thompson sampling bandit weights.** A new Postgres table `ab_bandit_weights` stores
   per-`(tenant_id, archetype, variant)` Beta distribution parameters `(alpha, beta)` updated after
   each observed conversion signal. The Decision API reads the current best variant for each
   archetype by sampling from the Beta posteriors at request time. Schema:

   ```
   tenant_id uuid NOT NULL
   archetype  text NOT NULL
   variant    text NOT NULL
   alpha      double precision NOT NULL DEFAULT 1.0
   beta       double precision NOT NULL DEFAULT 1.0
   updated_at timestamptz NOT NULL DEFAULT now()
   PRIMARY KEY (tenant_id, archetype, variant)
   ```

   RLS policy: tenant can read/write only its own rows.

7. **Regression detection.** If any archetype's holdout-vs-treatment delta on a conversion metric
   (e.g., `cta_clicked` rate) crosses a statistically significant negative threshold (p < 0.05,
   two-proportion z-test, minimum 200 sessions per arm) over a rolling 7-day window, the Decision
   API auto-pauses adaptation for that archetype (serves default) and emits a Sentry alert with
   severity `warning`. Auto-pause state is stored in `ab_bandit_weights` as a `paused boolean`
   column. This can be a scheduled job or an inline check on the Decision API hot path — choose
   based on latency budget (<100ms p95 must not regress).

8. **Test coverage ≥70% for all new code in `apps/decision-api` and `apps/control-plane`.** Coverage
   for `packages/shared` (new Zod schema) must meet the ≥80% library bar.

9. **No TypeScript `any` without inline `// eslint-disable` + reason.**

10. **`pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` all pass locally before PR is
    opened.**

## Files to touch (expected)

The engineer should read each of these before editing:

| File                                                  | Action                                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `apps/decision-api/src/app/api/`                      | Add assignment logic to the adapt route                                                       |
| `apps/decision-api/src/index.ts`                      | Wire bandit weight reader if needed                                                           |
| `packages/shared/src/schemas/events/index.ts`         | Export new `AbAssignmentEventSchema`                                                          |
| `packages/shared/src/schemas/events/ab-assignment.ts` | New file — Zod schema for ab_assignment event                                                 |
| `packages/db/src/schema/`                             | New file `ab_bandit_weights.ts` — Drizzle table definition                                    |
| `packages/db/src/schema/index.ts`                     | Export new table                                                                              |
| `packages/db/migrations/`                             | New Drizzle migration for `ab_bandit_weights` table                                           |
| `apps/control-plane/src/app/`                         | Optional: expose `/api/ab/weights` endpoint for dashboard visibility                          |
| ClickHouse DDL migration                              | Add `holdout_group Boolean` to `adaptation_decisions`; check where TICKET-014 migrations live |

If `apps/decision-api` does not yet have an adapt route that calls the Decision API logic
(introduced in TICKET-ADP-001), read `backlog/sprint-7/TICKET-ADP-001.md` for context before
starting.

## Test expectations

### Unit tests (required)

1. **Hash-based assignment is deterministic.** Given a fixed `(tenant_id, session_id)`, the
   assignment function returns the same `holdout_group` boolean on 1,000 repeated calls.

2. **Fraction test.** Generate 10,000 unique random `session_id` values with a fixed `tenant_id`.
   Assert that the fraction assigned `holdout_group = true` is within
   `[holdout_pct - 0.01, holdout_pct + 0.01]` for `holdout_pct` values of 0.05, 0.10, 0.20.

3. **Opt-out skip.** Call the assignment function with `consent_state = "opted_out"`. Assert: (a)
   return value signals "skipped", (b) no event is queued, (c) no DB write is attempted.

4. **Idempotency.** Insert an `ab_bandit_weights` row. Call the upsert function again with identical
   parameters. Assert the row count remains 1 and the values are unchanged.

### Integration test (required)

5. **Opted-out session receives default response.** Send a mock adapt request with
   `consent_state: "opted_out"` to the Decision API handler. Assert the response contains no
   adaptation directives and no `holdout_group` field.

6. **Opted-in session receives holdout or treatment assignment.** Send a mock adapt request with
   `consent_state: "granted"`. Assert the response contains a `holdout_group` boolean and that the
   emitted event payload matches the `AbAssignmentEventSchema`.

### Corpus CI gate

Run `pnpm test:corpus` (introduced in TICKET-AUTO-005). The auto-detection corpus tests must stay
green — the A/B changes must not break any corpus fixture.

## Branch naming

`backend-engineer/TICKET-AB-001-ab-holdout-framework`

## PR title format

`feat(decision-api,shared,db): A/B holdout framework — consent-aware assignment + Thompson sampling bandit [TICKET-AB-001]`

## Definition of done

- PR opened, all local checks green.
- `gh pr checks <pr-number> --watch` returns all SUCCESS.
- PM-orchestrator validates AC items above.
- PM-orchestrator comments `PM-validated. CI green. Ready for human review and merge.`
- Ticket moved to `READY_FOR_REVIEW` in QUEUE.md.
