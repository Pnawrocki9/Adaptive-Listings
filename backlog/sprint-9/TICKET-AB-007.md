# TICKET-AB-007 — Wire holdout_group into ClickHouse adaptation_decisions insert path

**Sprint:** 9 **Agent:** data-engineer **Priority:** P0 **Estimated hours:** 3 **Status:** READY
**Promoted from:** FOLLOW-010 (RETRO-002 / TICKET-AB-001) **Depends on:** TICKET-AB-006 (seed must
land first so smoke test has real data; acceptable to land concurrently with empty-row guard)
**Unblocks:** TICKET-AB-004 dashboard Panel 1 + Panel 3 showing real holdout data

## Context

The ClickHouse migration from TICKET-AB-001 (PR #80) adds `holdout_group Boolean` column to the
`adaptation_decisions` table — but the writer that populates `adaptation_decisions` was never
updated to include this field. Every row has `holdout_group = false` (column default), regardless of
actual holdout assignment.

The analytics dashboard `Panel 1` (Adapted vs Holdout impressions) and `Panel 3` (Conversion lift vs
holdout) both read this column. Until this ticket lands, those panels always show 0 for holdout.

**Step 1 of this ticket is to audit and identify the exact writer code path.**

**References:**

- `apps/stream-consumer/` — Redpanda → ClickHouse ETL (check for `adaptation_decisions` INSERT)
- `apps/decision-api/src/` — may have inline ClickHouse insert on the adapt hot path
- `infra/clickhouse/migrations/` — `0003_create_adaptation_decisions.sql` (from TICKET-ADP-001)
  shows the table schema including the `holdout_group Boolean` column
- `apps/decision-api/src/app/api/adapt/route.ts` — source of `holdout_group` value
- `packages/shared/src/schemas/events/` — `AdaptationDecisionEventSchema` if it exists

## Acceptance criteria

1. **Audit**: identify all files that INSERT into `adaptation_decisions`. Document them in a comment
   in the PR description.
2. Every INSERT statement for `adaptation_decisions` includes `holdout_group` populated from the
   assignment result (`true` for holdout arm, `false` for treatment arm).
3. Smoke test: send an adapt request with `consent_state = 'granted'` and `holdout_pct = 1.0`
   (forces every session into holdout); assert the resulting ClickHouse row has
   `holdout_group = true`. Send another with `holdout_pct = 0.0`; assert `holdout_group = false`.
4. Smoke test uses a real ClickHouse connection (not mocked) — or the existing ClickHouse test
   harness from TICKET-014/015 if one exists.
5. Add a code comment next to the INSERT pointing to TICKET-AB-001 (explains why the field exists).
6. No regression in existing adaptation_decisions write path tests.

## Files to touch

- Whichever file(s) the audit in AC-1 identifies as the writer(s) — likely one of:
  - `apps/stream-consumer/src/main.py` (Python ETL)
  - `apps/decision-api/src/lib/clickhouse-writer.ts` (if it exists)
  - `apps/decision-api/src/app/api/adapt/route.ts` (if inline)
- Corresponding test file

## Dependency note

TICKET-AB-006 seeds `ab_bandit_weights`. This ticket doesn't need TICKET-AB-006 to compile, but the
smoke test is more meaningful after seeding (the assignment function needs bandit rows to not
short-circuit). Run TICKET-AB-006 first if possible; otherwise add a guard in the smoke test for
empty-bandit case.
