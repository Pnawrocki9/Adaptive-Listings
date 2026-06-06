# CHK-C — FOLLOW-039 ClickHouse DSR Hard-Delete Verification

**Date:** 2026-05-30 **Author:** compliance-engineer **Purpose:** Discovery Day check for Adaptive
Listings v3 plan — verify FOLLOW-039 is real before EU pilot launch (FIX-028 DSR canary).
**Verdict:** YELLOW — hard-delete works end-to-end but the mutation-poll Vercel Cron is currently
disabled (Hobby plan constraint, commit `8e04752`). FIX-028 = write the canary test AND restore the
cron on Vercel Pro before EU pilot traffic.

---

## 1. PR #139 Reality Check

Merge commit: `7af88dd7eabf681ad3408fe360b61f641d81a99b` Date: 2026-05-24 Author: Pnawrocki9

Files changed (16, 1839 net insertions):

| File                                                                | Role                                                                     |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `apps/control-plane/src/lib/clickhouse-dsr.ts`                      | Core helper library (SQL builder, HTTP transport, mutation issue + poll) |
| `apps/control-plane/src/app/api/dsr/erase/route.ts`                 | Erase endpoint — ClickHouse mutations wired                              |
| `apps/control-plane/src/app/api/dsr/mutation-poll/route.ts`         | Vercel Cron GET handler                                                  |
| `apps/control-plane/src/app/api/dsr/mutation-poll/_finalise.ts`     | Audit-log finalisation helper                                            |
| `apps/control-plane/src/app/api/dsr/erase/route.test.ts`            | 4 route-level integration tests (mocked)                                 |
| `apps/control-plane/src/lib/__tests__/clickhouse-dsr.test.ts`       | 21 unit tests                                                            |
| `apps/control-plane/src/app/api/dsr/dsr-routes.test.ts`             | Updated existing happy-path suite                                        |
| `packages/db/src/schema/dsr_clickhouse_mutations.ts`                | Drizzle schema — new operational state table                             |
| `packages/db/migrations/0014_dsr_clickhouse_mutations.sql`          | Postgres migration                                                       |
| `packages/db/migrations/0011_dsr_audit_log_clickhouse_mutation.sql` | ClickHouse migration — new columns on dsr_audit_log                      |
| `apps/control-plane/vercel.json`                                    | Added `crons` block (later removed — see Gap 1)                          |
| `docs/MASTER_DESIGN.md`                                             | §H.1 updated + §H.1.1 added                                              |
| `docs/compliance/dpia.md`                                           | v2.0 → v2.1; §8 erasure flow rewritten                                   |

The commit is genuine: 16 real files, 1839 net lines of implementation. Not a docs-only or
status-bump commit.

---

## 2. ClickHouse Erasure Mechanism

**File:** `apps/control-plane/src/lib/clickhouse-dsr.ts`

The mechanism is `ALTER TABLE ... DELETE WHERE`, not synchronous `DELETE`. This is correct for
ClickHouse — `DELETE` is not a first-class DML on MergeTree tables.

SQL builder at line 102:

```
ALTER TABLE ${table} DELETE WHERE ${column} IN (${escaped}) /* DSR:${markerToken} */
```

The `/* DSR:<markerToken> */` comment is preserved verbatim in `system.mutations.command`, giving
the poller a unique handle to retrieve `mutation_id` even if the initial race between ALTER and
`system.mutations` SELECT returns null.

**Mutation tracking:** Each issued mutation writes one row to `dsr_clickhouse_mutations` Postgres
table (Drizzle migration 0014). The poller at `/api/dsr/mutation-poll/route.ts` reads non-terminal
rows, polls `system.mutations`, and advances: `pending` → `in_progress` → `done`. Failed mutations
retry up to `MAX_MUTATION_RETRIES = 3` with exponential backoff (1m → 5m → 30m). Permanent failure
fires `Sentry.captureException` tagged `dsr_erase_clickhouse_mutation_failed`.

**Mutation-poll route:** EXISTS at `apps/control-plane/src/app/api/dsr/mutation-poll/route.ts` —
fully implemented with:

- CRON_SECRET header auth
- stuck-mutation detection (>1h with no advancement → Sentry warning `dsr_mutation_stuck`)
- `maybeFinaliseAuditLog()` updating the ClickHouse `dsr_audit_log` row when all mutations for a
  verification reach terminal state

**Data inventory covered (4 tables):**

- `events`
- `adaptation_decisions`
- `llm_calls`
- `session_quality`

Tables correctly excluded: `dsr_audit_log` (Art. 17(3)(b) legal-claims retention) and
`description_generations` (listing-scoped, no `session_id`).

---

## 3. Postgres Cascade

`erase/route.ts` lines 312–323 run a Drizzle transaction deleting:

- `session_embeddings WHERE session_id AND tenant_id`
- `consent_records WHERE session_id`

Redis DEL is fire-and-forget (SCAN + pipeline DEL on `session:{sessionId}:*` pattern).

**Gap — engagement_scores:** `docs/compliance/dpia.md` line 773 states the `engagement_scores` table
"is included in the erasure cascade." Inspection of `erase/route.ts` shows it is NOT deleted in the
Postgres transaction. The `clickhouse-dsr.ts` `DSR_CLICKHOUSE_TABLES` inventory also does not
include it (confirmed: the `dsr_clickhouse_mutations` schema has a comment at line 65 noting
`engagement_scores` as a future addition, implying it was not added). This is a compliance gap:
`engagement_scores` is per-session pseudonymous personal data under sole controllership, and the
DPIA says it must be erased. This gap must be tracked as a new ticket.

---

## 4. Redpanda Strategy

There is no active tombstone or compaction-trigger strategy for Redpanda in the erase path. The DPIA
classifies Redpanda data as "transient — purged after Intent Engine consumption" (`dpia.md` line
194). The rationale is that by the time a DSR request arrives, the relevant events have already been
consumed by the Intent Engine and are no longer resident in Redpanda topic partitions. This is an
architectural assertion, not a confirmed flush. It is documented but not verified by a test.

**Finding:** Redpanda has no active erasure step and no test that confirms topic-level absence after
a DSR. The "transient" characterisation is plausible given the pipeline architecture but is an
undocumented assumption. For EU pilot confidence this should either be confirmed with a retention
period assertion in the DPIA or flagged as an explicit residual risk with a stated mitigation.

---

## 5. End-to-End Test Status

### Unit tests (21 tests) — EXIST

`apps/control-plane/src/lib/__tests__/clickhouse-dsr.test.ts` Covers: SQL builder (7 cases including
injection-guard and quote-escaping), `aggregateMutationStatus` (5 cases), `computeNextRetryAt` (4
cases), `DSR_CLICKHOUSE_TABLES` inventory (4 assertions). All deterministic, no ClickHouse instance
required.

### Route-level tests (4 tests) — EXIST

`apps/control-plane/src/app/api/dsr/erase/route.test.ts` Covers: ALTER issued for all 4 tables,
no-op path when `CLICKHOUSE_URL` unset, idempotency replay, ALTER failure produces `failed` rows
without failing the endpoint. External deps fully mocked.

### Integration test (3 specs) — EXIST but conditionally skipped

`apps/control-plane/src/__tests__/integration/clickhouse-dsr.integration.test.ts` (FOLLOW-081, PR
#143)

Covers:

1. Happy path: `ALTER TABLE ... DELETE WHERE` mutation completes (`is_done=1`), targeted rows
   deleted, adjacent rows untouched.
2. `resolveMutationIdByMarker` can locate a mutation row by the embedded DSR comment.
3. Column-shape canary: `system.mutations` exposes `is_done`, `latest_failed_reason`, `mutation_id`,
   `command`, `create_time`.

Uses `test.skipIf(!process.env.CLICKHOUSE_URL)` — skipped in standard CI (no live ClickHouse
instance). This is the correct pattern for an integration test, but it means the canary is NOT
running in CI today.

### What is MISSING

There is no end-to-end test that:

1. Creates a session with events in the DB
2. Fires the full `/api/dsr/initiate` → `/api/dsr/erase` flow
3. Then asserts ClickHouse rows are gone AND Postgres rows are deleted AND Redis is clean

The route tests mock all dependencies. FIX-028 (Sprint 5 DSR canary) must build this test before EU
pilot.

---

## 6. Gap Summary

| #   | Gap                                                                                                                                                                                                                                                                                                                                                                                          | Severity | Blocks Pilot?                                                  |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------- |
| G-1 | **Vercel Cron for mutation-poll is disabled** — commit `8e04752` (2026-05-29) removed the `crons` block from `vercel.json` because the deployment was on Vercel Hobby plan. The `/api/dsr/mutation-poll` route exists and is correct, but it is not being invoked automatically. Any ClickHouse mutation issued today will never advance from `pending` to `done` without manual invocation. | CRITICAL | YES — must restore cron (requires Vercel Pro) before EU pilot. |
| G-2 | **engagement_scores not erased** — DPIA §8 says it must be; `erase/route.ts` Postgres transaction does not delete it.                                                                                                                                                                                                                                                                        | HIGH     | YES — GDPR Art. 17 gap.                                        |
| G-3 | **No full e2e DSR test** — route tests mock ClickHouse; integration test skips without live ClickHouse. No test exercises the complete session-create → erase → assert-clean path.                                                                                                                                                                                                           | MEDIUM   | FIX-028 must build before pilot.                               |
| G-4 | **Redpanda transient assumption unverified** — "purged after Intent Engine consumption" is stated but not tested or time-bounded.                                                                                                                                                                                                                                                            | LOW      | Document as explicit residual risk in DPIA §8.                 |
| G-5 | **No DSR ops runbook for the mutation-poll flow** — `docs/ops/DSR_ALERTING.md` exists and covers Sentry alert response, but no runbook covers the operational scenario where the cron has been disabled and mutations are stuck from before re-enablement.                                                                                                                                   | LOW      | Pre-pilot ops checklist item.                                  |

---

## 7. Verdict

**YELLOW.**

The ClickHouse hard-delete implementation in FOLLOW-039 is real and technically correct:

- `ALTER TABLE ... DELETE WHERE` is used correctly (async mutation, not synchronous DELETE)
- Mutation tracking via `dsr_clickhouse_mutations` Postgres table is in place
- 3-retry exponential backoff + Sentry alerting is implemented
- A mutation-poll route exists with stuck-mutation detection
- 25 tests cover the implementation (21 unit + 4 route)
- An integration test exists that confirms live ClickHouse semantics (skipped without live instance)

However, the mutation-poll cron was removed from `vercel.json` on 2026-05-29 due to Vercel Hobby
plan constraints. Any DSR erasure request processed today will issue the ClickHouse mutations but
they will never be polled to completion. This is a CRITICAL operational gap for EU pilot.

Additionally the `engagement_scores` Postgres table is missing from the erasure cascade despite the
DPIA explicitly requiring it.

**FIX-028 scope:**

1. Restore `/api/dsr/mutation-poll` cron in `vercel.json` once on Vercel Pro (prerequisite: confirm
   plan upgrade before pilot).
2. Add `engagement_scores` DELETE to the Postgres transaction in `erase/route.ts`.
3. Build a full e2e DSR canary test (seed session → initiate → erase → assert ClickHouse + Postgres
   - Redis clean) and wire to nightly CI.
4. Document Redpanda transient assumption as explicit residual risk with retention period in DPIA
   §8.

---

## 8. Key File References

- Merge commit: `7af88dd` (2026-05-24)
- Cron removal commit: `8e04752` (2026-05-29)
- `apps/control-plane/src/lib/clickhouse-dsr.ts` — core helper (lines 80–103: SQL builder; 202–218:
  mutation issue)
- `apps/control-plane/src/app/api/dsr/erase/route.ts` — erase endpoint (lines 180–228: ClickHouse
  loop; 312–323: Postgres transaction)
- `apps/control-plane/src/app/api/dsr/mutation-poll/route.ts` — cron poller (fully implemented, not
  scheduled)
- `apps/control-plane/src/__tests__/integration/clickhouse-dsr.integration.test.ts` — integration
  canary (skips without CLICKHOUSE_URL)
- `apps/control-plane/vercel.json` — crons block absent (was: `*/5 * * * *` → `0 * * * *` → removed)
- `docs/compliance/dpia.md` line 773 — engagement_scores erasure requirement
- `docs/ops/DSR_ALERTING.md` — Sentry alert runbook (exists)
