# FOLLOW-007 — Wire Thompson sampling bandit into live adapt path per (tenant, archetype, variant)

**Sprint:** 9.5 **Agent:** ml-engineer **Priority:** P0 **Estimated hours:** 4 **Status:** READY
**Depends on:** — **Unblocks:** — **Model:** opus-4.7-xhigh

## Context

The Thompson sampling bandit infrastructure from Sprint 8 (TICKET-AB-001, PR #80) is complete but
disconnected from the live adapt path:

- `thompsonSample(arms: BanditArm[])` and `updateBanditArm(alpha, beta, converted)` are fully
  implemented and tested in `apps/decision-api/src/lib/bandit.ts`
- `ab_bandit_weights` Postgres table exists with the correct schema
  (`packages/db/src/schema/ab_bandit_weights.ts`): `(tenant_id, archetype, variant)` PK, `alpha`,
  `beta`, `paused` columns
- A Rule I check confirmed `thompsonSample()` has **zero non-test callers** in the production code
  path as of HEAD `main`

**Current adapt path (canonical endpoint):** `apps/control-plane/src/app/api/adapt/route.ts`. Per
ADR-0004, all Sprint 9.5 work targets this route, not `apps/decision-api` Worker. The adapt route
currently calls `getPlaybook(archetypeId)` and returns playbook directives — there is no variant
selection step.

**What "variant" means here:** a variant is a named adaptation configuration stored as a row in
`ab_bandit_weights`. For example: `control` (baseline playbook), `v1` (alternate headline copy),
`v2` (alternate photo order). Thompson sampling selects which variant a given session sees, enabling
the bandit to learn which variant converts best for each archetype.

**Master Design reference:** §E.3.0 Phase 2 — "variant selection per request via Thompson sampling
on Beta posteriors stored in `ab_bandit_weights`."

**References:**

- `apps/decision-api/src/lib/bandit.ts` — `thompsonSample()`, `updateBanditArm()`, `BanditArm`
- `packages/db/src/schema/ab_bandit_weights.ts` — `abBanditWeights` table, `AbBanditWeight` type
- `apps/control-plane/src/app/api/adapt/route.ts` — canonical adapt endpoint to extend
- `docs/MASTER_DESIGN.md` §E.3, §E.3.0, §E.3.1

## Acceptance criteria

All of the following must be met before the PR may be merged:

1. **Variant selection wired.** In `apps/control-plane/src/app/api/adapt/route.ts`, after the
   decision tree produces an archetype, a new helper `getBanditArms(tenantId, archetype)` is called.
   It queries `ab_bandit_weights` for all rows matching `(tenant_id, archetype)`. The rows are
   converted to `BanditArm[]` and `thompsonSample(arms)` is called. The returned variant name is
   attached to the adapt response.

2. **Auto-seed on first request.** When `getBanditArms` finds no rows for `(tenant_id, archetype)`,
   it inserts three seed rows with Beta(1,1) prior (uniform): `('control', 1.0, 1.0)`,
   `('v1', 1.0, 1.0)`, `('v2', 1.0, 1.0)`. Uses upsert semantics. Then calls `thompsonSample` on the
   freshly inserted arms. This ensures every tenant starts experimenting immediately.

3. **All-paused fallback.** If all arms for `(tenant_id, archetype)` have `paused = true`,
   `thompsonSample` returns `null`. In this case the adapt route serves the `control` playbook
   directives and sets `variant: 'control'` in the response.

4. **Response includes `variant`.** The adapt response body gains a `variant: string` field at the
   top level. Existing fields (`directives`, `source`, `reorder`, etc.) are unchanged:

   ```json
   {
     "directives": [...],
     "reorder": { ... },
     "source": "playbook",
     "variant": "v1"
   }
   ```

   The `variant` field allows the SDK to pass it back in the feedback loop.

5. **ClickHouse logging updated.** The `logDecisionAsync` call in the adapt route passes the
   selected `variant` as a new parameter. Add a `variant text` column to the ClickHouse
   `adaptation_decisions` table via a DDL migration in `packages/data/migrations/` (check where
   TICKET-014 ClickHouse migrations live — use the same location). Column should default to
   `'control'` for rows that predate this ticket.

6. **Feedback endpoint.** A new route `POST /api/adapt/feedback` accepts:

   ```json
   {
     "session_id": "string",
     "tenant_id": "string",
     "archetype": "string",
     "variant": "string",
     "converted": true
   }
   ```

   Requires JWT auth. On receipt, reads the `(tenant_id, archetype, variant)` row from
   `ab_bandit_weights`, calls `updateBanditArm(alpha, beta, converted)`, and upserts the updated
   parameters. Returns `202 Accepted`. This is fire-and-forget from the SDK perspective — the
   feedback route must never block the adapt flow.

7. **Latency budget.** The `getBanditArms` DB query must complete in ≤5ms p95. It uses the existing
   `ab_bandit_weights_tenant_archetype_idx` index. If the query plan is suboptimal, add a comment
   with the `EXPLAIN` output and any index hint.

8. **Test coverage ≥70%** for all new code in `apps/control-plane` (adapt route extension, new
   helper, feedback route).

9. **Existing `apps/decision-api/src/lib/__tests__/bandit.test.ts` must remain green.** This ticket
   does not touch `decision-api` — the Thompson sampling math is imported from there (or duplicated
   per the cross-app import constraint — check whether `@estalara/shared` or a new internal package
   is the right home).

10. **`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass locally before PR is
    opened.**

## Files to touch (expected)

| File                                                          | Action                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/control-plane/src/app/api/adapt/route.ts`               | Add `getBanditArms()` call + `variant` in response + `logDecisionAsync` update |
| `apps/control-plane/src/lib/bandit-query.ts`                  | New helper: `getBanditArms(tenantId, archetype)` — DB query + auto-seed        |
| `apps/control-plane/src/app/api/adapt/feedback/route.ts`      | New feedback endpoint                                                          |
| `apps/control-plane/src/app/api/adapt/feedback/route.test.ts` | Tests for feedback endpoint                                                    |
| `apps/control-plane/src/lib/bandit-query.test.ts`             | Unit tests for `getBanditArms` including auto-seed                             |
| ClickHouse DDL migration                                      | Add `variant text DEFAULT 'control'` to `adaptation_decisions`                 |

**Import note:** `thompsonSample` and `updateBanditArm` live in
`apps/decision-api/src/lib/bandit.ts`. Cross-app imports are not supported. Move these functions to
`packages/shared/src/bandit.ts` (or a new `packages/bandit` package) so both `decision-api` and
`control-plane` can import them. Update `apps/decision-api/src/lib/bandit.ts` to re-export from the
shared location.

## Test expectations

### Unit tests (required)

1. **`getBanditArms` — returns arms from DB.** Mock the DB to return two rows. Assert
   `getBanditArms` returns a `BanditArm[]` with `variant`, `alpha`, `beta`, `paused` mapped
   correctly.

2. **`getBanditArms` — auto-seeds on empty.** Mock the DB to return zero rows on SELECT, then
   confirm the upsert is called with the three seed rows. Assert the returned arms have
   `alpha: 1, beta: 1`.

3. **All-paused path → `variant: 'control'`.** Pass all arms with `paused: true` to the wiring
   logic. Assert the adapt response includes `variant: 'control'`.

4. **Feedback endpoint — updates Beta.** POST to `/api/adapt/feedback` with `converted: true`. Mock
   the DB select returning `alpha: 3, beta: 2`. Assert the upsert is called with `alpha: 4, beta: 2`
   (`updateBanditArm(3, 2, true)` = `{alpha: 4, beta: 2}`).

5. **Feedback endpoint — 202 Accepted.** Assert the endpoint returns `202` and does not wait for
   downstream DB writes to settle before responding.

### Integration test (required)

6. **Adapt request → variant in response.** Send a full adapt POST with a valid JWT and archetype
   hint. Assert the response body includes a non-empty `variant` string.

## Branch naming

`ml-engineer/FOLLOW-007-thompson-sampling-bandit-wire`

## PR title format

`feat(control-plane): wire Thompson sampling bandit into live adapt path — variant selection + feedback loop [FOLLOW-007]`

## Definition of done

- PR opened, all local checks green.
- `gh pr checks <pr-number> --watch` returns all SUCCESS.
- PM-orchestrator validates AC items above.
- PM-orchestrator comments `PM-validated. CI green. Ready for human review and merge.`
- Ticket moved to `READY_FOR_REVIEW` in QUEUE.md.
