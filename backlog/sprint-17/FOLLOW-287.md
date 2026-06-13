# FOLLOW-287 — Fix ClickHouse intent_events write path silent data loss

**Sprint:** 17 **Priority:** P1 **Agent:** backend-engineer (lead) + data-engineer (ClickHouse DDL
arm) **Estimated hours:** 5 **Depends on:** FOLLOW-266 (all phases), FOLLOW-286 (merged — provides
session_id column rename in migration 0015) **Source retro:** RETRO-066 (intent.snapshot Phase 3 PR
#280 analysis) **Branch:** `backend-engineer/FOLLOW-279-k36-ch-write-fix` **Filed by:**
pm-orchestrator 2026-06-13

---

## Context

RETRO-066 identified that the ClickHouse write path in `apps/ingest/src/handlers/intent-snapshot.ts`
(introduced in PR #278, FOLLOW-266 Phase 2) silently drops **100% of rows** due to two type
mismatches in the JSONEachRow INSERT body. These defects are invisible under green CI because all 18
existing tests mock `fetchImpl` at the HTTP level — no row ever reaches a real ClickHouse instance.

FOLLOW-286 (PR #279, READY_FOR_REVIEW) fixed related PostgREST `on_conflict` and column-naming
issues on the Supabase side; this ticket fixes the ClickHouse write path. Both must merge before the
K.3.6 tracer is production-ready.

**Important:** FOLLOW-286 renamed the ClickHouse column `intent_session_id → session_id` via
migration 0015 (in its PR #279 diff). The `intent-snapshot.ts` handler must be updated to use
`session_id` (not `intent_session_id`) in the ClickHouse INSERT body to match. Confirm migration
0015 is merged before coding CB-1 fix.

---

## Defects to fix

### CB-1 — UUID type mismatch: session_id written as 64-char SHA-256, column is UUID NOT NULL

**File:** `apps/ingest/src/handlers/intent-snapshot.ts`

**Root cause:** The handler derives `intent_session_id` via `deriveSessionUuid()` which returns a
64-character SHA-256 hex digest. ClickHouse's `UUID` column type requires a hyphenated UUID string
(e.g. `550e8400-e29b-41d4-a716-446655440000`). A 64-char hex string is silently rejected by
JSONEachRow, dropping the entire row.

**Fix options (choose one):**

- (a) Preferred: use the raw `session_id` string from the event envelope as-is. The ClickHouse
  column was renamed from `intent_session_id` to `session_id` (FOLLOW-286 migration 0015) and the
  column type should be `String` not `UUID` to match session_id semantics. Confirm the DDL in
  migration 0014 and migration 0015 — if the column is truly `UUID`, fix the DDL to `String`. If it
  is already `String`, just use `session_id` directly.
- (b) If UUID type is intentional and canonical: generate a proper UUIDv5 from the session_id
  (namespace + session_id bytes → deterministic UUID). Do not use SHA-256 hex.

**Retire dead export:** `deriveSessionUuid` from `apps/ingest/src/handlers/intent-snapshot.ts` is
orphaned by this fix. Remove the export and its import from `crypto` if no other caller uses it.
Grep first: `grep -rn 'deriveSessionUuid' apps/ packages/ --include='*.ts' | grep -v '.test.'`

### CB-2 — Null Float32: confidence_before is null, column is Float32 NOT NULL

**File:** `apps/ingest/src/handlers/intent-snapshot.ts`

**Root cause:** The handler writes `confidence_before: state.confidence_before` where
`state.confidence_before` may be `null` (first snapshot in a session has no prior confidence).
ClickHouse `Float32 NOT NULL` rejects null values in JSONEachRow, dropping the row.

**Fix:** `confidence_before: state.confidence_before ?? 0.0`

---

## Retirement of dead exports (LG)

### LG-A — Column naming: intent_session_id vs session_id

The handler currently uses `intent_session_id` in the ClickHouse INSERT body. FOLLOW-286 migration
0015 renamed the ClickHouse column to `session_id`. Update the handler to use `session_id` in the
INSERT body to match the DDL after migration 0015 is applied.

### LG-B — Retire INTENT_EVENTS_VOCABULARY and IntentEventType (if test-only)

Verify:
`grep -rn 'INTENT_EVENTS_VOCABULARY\|IntentEventType' apps/ packages/ --include='*.ts' | grep -v '.test.' | grep -v node_modules`

If these exports have zero non-test consumers, remove them or mark with a `// @internal test-only`
annotation. Do not remove if they have non-test callers.

---

## DG-1 — Surface swallowed errors to Sentry warn log

**File:** `apps/ingest/src/handlers/intent-snapshot.ts`

The handler uses `Promise.allSettled([clickhouseWrite, supabaseUpsert])`. Currently, settled
rejections are silently dropped — no Sentry capture, no structured log. This makes production
debugging impossible.

**Fix:** After `await Promise.allSettled(...)`, iterate the results array and for any
`status === 'rejected'` entry, call `Sentry.captureMessage` (warn level) or use the existing
`createLogger` from `packages/shared/src/observability` with a structured log entry including
`error.message` and which write failed (CH vs Supabase).

---

## TG-1 — Real ClickHouse round-trip integration test

Add an integration test (soft-skip when `CLICKHOUSE_URL` is unset, matching the pattern in other
ClickHouse test files). The test must:

1. Construct a realistic `intent.snapshot` event payload with a valid session_id and
   `confidence_before: 0.5` (non-null Float32).
2. Call the handler or the ClickHouse write helper directly with a real (or test-container)
   ClickHouse connection.
3. Assert the INSERT does not throw and the row count increases.
4. At minimum: assert the JSONEachRow body sent to ClickHouse contains no null Float32 fields and
   that `session_id` is a string (not a 64-char SHA-256 hex).

If a live ClickHouse connection is not available in CI, the test MUST at minimum mock `fetchImpl` at
the JSONEachRow body level and assert the body shape is valid (no null fields, correct types). A
body-shape assertion test is not a 200-mock; it is a contract test.

---

## Acceptance criteria

- [ ] AC1 (CB-1): ClickHouse INSERT no longer rejects rows due to session_id type mismatch.
      `session_id` field in the JSONEachRow body is either a valid UUID string or a plain `String`
      column (verify DDL after FOLLOW-286 migration 0015).
- [ ] AC2 (CB-2): `confidence_before` is always a Float32-compatible value (0.0 fallback when null).
      No `null` in the JSONEachRow body for Float32 NOT NULL columns.
- [ ] AC3 (TG-1): At minimum one integration or body-shape test asserts the JSONEachRow INSERT body
      has no null Float32 fields and `session_id` is the correct type.
- [ ] AC4 (DG-1): Sentry warn log (or structured logger) fires on `Promise.allSettled` rejections —
      grep-verifiable in non-test code.
- [ ] AC5 (LG-A): Handler uses `session_id` (not `intent_session_id`) in the ClickHouse INSERT body
      to match the DDL after FOLLOW-286 migration 0015.
- [ ] AC6 (LG-B): `deriveSessionUuid` export is retired if no non-test caller exists after CB-1 fix.
      `INTENT_EVENTS_VOCABULARY` / `IntentEventType` retired or annotated `@internal` if test-only.

---

## Files to touch

**Primary (backend-engineer):**

- `apps/ingest/src/handlers/intent-snapshot.ts` — CB-1, CB-2, DG-1, LG-A, LG-B
- `apps/ingest/src/handlers/intent-snapshot.test.ts` — TG-1 body-shape integration test

**Secondary (data-engineer — only if ClickHouse DDL needs to change):**

- `infra/clickhouse/migrations/` — if session_id column type must change from UUID to String
  (coordinate with FOLLOW-286 migration 0015 which already renamed the column)

---

## Handoff context

Read these before starting:

- `apps/ingest/src/handlers/intent-snapshot.ts` — current handler with defects
- `infra/clickhouse/migrations/0014_intent_events.sql` — original DDL (column types)
- FOLLOW-286 PR #279 diff — confirms migration 0015 renames `intent_session_id → session_id` and
  fixes PostgREST `on_conflict`; confirm 0015 is merged before coding CB-1
- `packages/shared/src/schemas/events/intent.ts` — `IntentSnapshotEventSchema` (AC4 from FOLLOW-266
  Phase 3) — payload shape the handler receives
- `apps/ingest/src/clickhouse-producer.ts` — existing ClickHouse write pattern
