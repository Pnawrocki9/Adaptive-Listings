# FOLLOW-081 — ClickHouse mutation-poll integration test against system.mutations

**Sprint:** 12  
**Lane:** A (pilot-critical hardening — gates Lane B)  
**Agent:** data-engineer  
**Model:** opus-4.7-xhigh  
**Priority:** P1  
**Estimated hours:** 3  
**Branch:** `data-engineer/FOLLOW-081-clickhouse-integration-test`  
**Depends on:** FOLLOW-039 (merged PR #139)

---

## Context

FOLLOW-039 (PR #139) shipped the ClickHouse DSR hard-delete flow:

- `apps/control-plane/src/lib/clickhouse-dsr.ts` — `issueEraseMutation()`, `pollMutationStatus()`,
  `resolveMutationIdByMarker()`, `buildEraseMutationSql()`
- `apps/control-plane/src/app/api/dsr/mutation-poll/route.ts` — Vercel Cron poller
- `apps/control-plane/src/app/api/dsr/mutation-poll/_finalise.ts` — audit log finalisation

The implementation is unit-tested with mocks but **no integration test exercises the real ClickHouse
`system.mutations` contract**. The gap: `pollMutationStatus()` queries `system.mutations` with a
specific column set (`is_done`, `latest_failed_reason`). If those column names or types differ from
production ClickHouse Cloud, the erasure flow silently fails with a schema mismatch that tests never
catch.

This is **EU pilot-blocker FOLLOW-081** per RETRO-007: EU pilot confidence in Art. 17 compliance
depends on code inspection alone until a real-instance integration test exists.

---

## Acceptance Criteria

1. **Integration test file** at
   `apps/control-plane/src/__tests__/integration/clickhouse-dsr.integration.test.ts` (or
   `tests/integration/clickhouse-dsr.integration.test.ts` — match the existing test directory
   structure).

2. **Test uses a real ClickHouse instance** — either:
   - `clickhouse/clickhouse-server` Docker image spun up via Vitest global setup, OR
   - The `@clickhouse/client` pointed at `CLICKHOUSE_URL` env var (skip if unset)

3. **Test scenario 1 — happy path:**
   - Create a test table:
     `CREATE TABLE IF NOT EXISTS test_dsr_events (session_id String, ts DateTime DEFAULT now()) ENGINE = MergeTree() ORDER BY session_id`
   - Insert 2 rows with a known `session_id` value
   - Call
     `issueEraseMutation(cfg, { table: 'test_dsr_events', column: 'session_id', sessionIds: [knownId] })`
   - Poll `pollMutationStatus(cfg, 'test_dsr_events', mutationId)` in a loop (max 30s) until
     `is_done = 1`
   - Assert: `SELECT count() FROM test_dsr_events WHERE session_id = knownId` → 0
   - Assert: `pollMutationStatus` returned a row with `is_done` field equal to `1` or `'1'` (both
     handled in route.ts:223)

4. **Test scenario 2 — `resolveMutationIdByMarker()` contract:**
   - Issue a mutation with a known markerToken embedded in the SQL comment
     (`/* DSR:TEST-MARKER-XYZ */`)
   - Call `resolveMutationIdByMarker(cfg, 'test_dsr_events', 'TEST-MARKER-XYZ')`
   - Assert it returns a non-null string (the mutation_id)

5. **Test scenario 3 — `system.mutations` column shape:**
   - Query `system.mutations` directly via the ClickHouse client
   - Assert the result row has `is_done` (numeric or string `'0'/'1'`) and `latest_failed_reason`
     (string) columns
   - This test acts as a canary: if ClickHouse Cloud ever changes `system.mutations` schema, this
     assertion fires before production does

6. **CI guard:** The integration test file must be placed in a directory that is **not** included in
   the standard `pnpm test` vitest run (to keep unit tests fast). Use a separate vitest config or
   `*.integration.test.ts` glob exclusion. Add a `test:integration:clickhouse` script in
   `apps/control-plane/package.json` that runs only these tests.

7. **Soft-skip when ClickHouse unavailable:** If `CLICKHOUSE_URL` env var is not set, skip all tests
   with `test.skipIf(!process.env.CLICKHOUSE_URL)`. This allows CI to pass without a ClickHouse
   instance (FOLLOW-079 will wire the real instance when ESC-009 tokens are available).

8. **Cleanup:** Drop the test table in an `afterAll` block to leave the instance clean.

---

## Key files to read first

- `apps/control-plane/src/lib/clickhouse-dsr.ts` — all exported functions; understand the
  `pollMutationStatus` query against `system.mutations`
- `apps/control-plane/src/app/api/dsr/mutation-poll/route.ts` — how `is_done` is consumed (line 223:
  `status.is_done === 1 || status.is_done === '1'`)
- `apps/control-plane/src/app/api/dsr/mutation-poll/_finalise.ts` — audit log finalisation
- `infra/clickhouse/migrations/` — understand the real tables (events, adaptation_decisions, etc.)
- `packages/db/src/schema/dsr_clickhouse_mutations.ts` — Postgres operational state schema

---

## Implementation notes

- Use `@clickhouse/client` (already in package.json as a dependency of clickhouse-dsr.ts)
- The `readClickHouseConfig()` function in clickhouse-dsr.ts reads `CLICKHOUSE_URL`,
  `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD` from env — use the same env vars in tests
- For Docker CI: consider using `testcontainers` or a Docker Compose service in a dedicated
  integration test workflow
- **Do NOT use the production ClickHouse tables** (`events`, `adaptation_decisions`) — create
  isolated test tables with `_integration_test` suffix in afterAll cleanup
- Opus 4.7 xhigh is required for this ticket: the `system.mutations` schema is underdocumented and
  requires careful reasoning about async mutation timing + idempotency edge cases

---

## Definition of Done

- [ ] Integration test file exists with 3 scenarios (happy path, marker resolution, column shape)
- [ ] Tests skip cleanly when `CLICKHOUSE_URL` is unset
- [ ] `pnpm test:integration:clickhouse` script added to control-plane package.json
- [ ] Standard `pnpm test` does NOT run integration tests (glob exclusion confirmed)
- [ ] PR description references FOLLOW-081 and includes a screenshot or log output of tests passing
      against a real ClickHouse instance
- [ ] CI: standard test-node job still passes (no new unit test failures)
