# FOLLOW-316 — Live-ClickHouse CI guard: submit the tracer query builders for analysis so a Code-386-class error fails CI

**Sprint:** 18 **Priority:** P1 **Status:** READY_FOR_REVIEW **Agent:** devops-engineer (CI, lead) +
backend-engineer (spec) **Branch:** `devops-engineer/FOLLOW-316-tracer-ci-guard` **PR:** #305
**Estimated hours:** 6 **Source retro:** RETRO-078 (§4c TG-1/TG-2) **Source ticket:** FOLLOW-315 /
PR #302 **Depends on:** none (FOLLOW-315 merged, PR #302) **Promoted:** 2026-06-14 (CEO-directed)

---

## Summary

Add a CI gate that runs the K.3.6 tracer ClickHouse query builders against a **real** ClickHouse
engine, so a query-analysis error (the `Code 386 NO_COMMON_TYPE` class that FOLLOW-315 fixed) fails
CI instead of slipping through to local/manual verification. Today no CI job exercises the tracer
queries against a live ClickHouse, which is exactly why the FOLLOW-315 bug shipped.

## Context

FOLLOW-315 (PR #302) fixed a latent `Code 386` in the tracer queries: every builder projects
`toString(event_at) AS event_at`, shadowing the `DateTime64` column with a `String` alias of the
same name, so a bare `event_at` in a WHERE/ORDER-BY date predicate bound to the String alias →
`String >= DateTime` → `NO_COMMON_TYPE`, raised by ClickHouse at **query-analysis time** (it fails
even on an empty table).

Why CI didn't catch it:

- The tracer unit suite (`apps/control-plane/src/lib/clickhouse-tracer.test.ts`, CH-1..CH-21 + the
  new CH-315a–d) mocks `fetch`. It asserts the SQL **sent on the wire** but never submits it to a
  ClickHouse engine — so it cannot raise a query-analysis error. The CH-315a–d regression tests
  added by PR #302 guard the specific alias-shadow shape but are **mock-only** and would not have
  caught the original bug.
- The only live-ClickHouse tests
  (`apps/control-plane/src/__tests__/integration/clickhouse-dsr.integration.test.ts`) gate every
  spec behind `test.skipIf(!process.env.CLICKHOUSE_URL)`. `CLICKHOUSE_URL` is unset in CI, so they
  **self-skip silently** — green CI, zero live coverage.
- `.github/workflows/ci.yml` already runs a `clickhouse-smoke` job that boots
  `clickhouse/clickhouse-server` and applies migrations, but it does not exercise the tracer query
  builders.

This is the standing gap to close: a real-engine guard on the tracer query path.

## Scope

### In scope

- A live-ClickHouse integration spec that calls each of the 4 tracer builders against an
  `intent_events` table on a real CI container and fails on a `Code 386` / `NO_COMMON_TYPE` (or any
  non-2xx):
  - `fetchIntentEventsForExport` (tenant + from/to)
  - `fetchIntentEventsHistory` (with from/to + paging)
  - `fetchNewIntentEvents` (stream-poll cursor)
  - `fetchIntentEventsForSession` (per-session)
- A **negative control**: a deliberately unqualified bare-`event_at` date predicate is shown to FAIL
  against the same container (proves the guard actually catches the Code-386 class, not just that
  the happy path passes).
- Wiring the spec into CI in a job where ClickHouse is up — preferably by extending the existing
  `clickhouse-smoke` job (cheapest: container + migrations already there) with `CLICKHOUSE_URL` +
  the minimal `intent_events` DDL/seed; or a dedicated `tracer-query-smoke` job.
- Making container-absence a **hard error** in that job (no silent `skipIf` where the container is
  expected to exist).

### Out of scope

- Fixing the latent DSR-path sibling (`clickhouse-dsr.ts` lexicographic String `ORDER BY` +
  wrong-row `LIMIT 1`) — tracked by **FOLLOW-317** (this ticket may opportunistically un-self-skip
  the existing DSR integration spec in the same job for free coverage; see Notes).
- Any change to the tracer query logic itself (already fixed by FOLLOW-315).

## Acceptance criteria

The ticket is DONE when ALL of these are true:

- [ ] **AC1** — A live-CH integration spec submits all 4 tracer builders (export + history with
      from/to + stream-poll cursor + per-session) against a real ClickHouse and asserts they return
      200 / no error against a seeded `intent_events` table.
- [ ] **AC2** — A negative control in the same spec shows that a deliberately unqualified
      bare-`event_at` date predicate FAILS against the same container (proves the guard catches the
      Code-386 / `NO_COMMON_TYPE` class).
- [ ] **AC3** — The spec runs in CI in a job where ClickHouse is up and does NOT `skipIf` silently
      in that job: absence of the container is a hard failure there, not a skip.
- [ ] **AC4** — `intent_events` (or the minimal columns the builders touch) is created and minimally
      seeded on the CI container before the spec runs.
- [ ] **AC5** — Prettier + control-plane vitest green; the new/extended job is green on a clean
      checkout (verify with `gh pr checks --watch`).

## Implementation guidance

- Cheapest path: extend `clickhouse-smoke` in `.github/workflows/ci.yml` (the container + migration
  apply already exist there) to export `CLICKHOUSE_URL` and run the new vitest integration spec.
  Note: the local stack uses a passwordless `default` user via `CLICKHOUSE_SKIP_USER_SETUP=1`
  (FOLLOW-315 verification); the control-plane CH client sends `Basic base64(":<password>")` with an
  empty username and CH rejects an empty username in the Authorization header, so the CI container
  must accept the client's auth mode (no password → no header) or the spec must set
  `CLICKHOUSE_PASSWORD` consistently with how the client builds auth (`clickhouse-tracer.ts`
  `authHeaders`).
- The spec should construct `ClickHouseTracerConfig` from env and call the exported builders
  directly (they already `throw` on non-2xx per Rule K.2 — a Code 386 surfaces as a thrown
  `ClickHouse tracer query failed: HTTP 500`).
- For the negative control, issue the unqualified variant via `chTracerQuery` with a hand-written
  SQL string (or a temporary copy of the export SQL with `intent_events.event_at` → `event_at`) and
  assert it rejects.

## Test plan

- Integration tests: new live-CH spec (the 4 builders happy path + the Code-386 negative control),
  run only in the job where the container exists.
- Unit tests: unchanged (CH-1..CH-21, CH-315a–d remain as the fast mock-fetch guard).
- CI: new/extended job green on a clean checkout; absence-of-container fails the job (AC3).

## Notes

Consider also un-self-skipping the existing `clickhouse-dsr.integration.test.ts` in the same job for
free coverage of the DSR path (overlaps the latent sibling that FOLLOW-317 will fix). If done,
ensure those specs also hard-fail rather than skip when the container is up.
