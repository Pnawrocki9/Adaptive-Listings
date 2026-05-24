# FOLLOW-078 — DSR failure alerting: Sentry alert on stuck/failed mutations

**Sprint:** 12  
**Lane:** A (pilot-critical hardening — gates Lane B)  
**Agent:** compliance-engineer  
**Model:** sonnet-4.6  
**Priority:** P1  
**Estimated hours:** 1.5  
**Branch:** `compliance-engineer/FOLLOW-078-dsr-alerting`  
**Depends on:** FOLLOW-039 (merged PR #139)

---

## Context

FOLLOW-039 (PR #139) implements the ClickHouse DSR erasure flow with retry-with-backoff (3 retries,
1m→5m→30m). On permanent failure (after max retries), the code already calls
`Sentry.captureException()` with tag `dsr_erase_clickhouse_mutation_failed: 'true'`.

**But there are two gaps:**

1. **Alert routing is not configured** — `Sentry.captureException()` fires but unless Sentry has an
   alert rule for this tag, the error silently sits in the Sentry error list. A regulator reviewing
   our DSR process would expect a proactive alert to the incident owner (Piotr Nawrocki).

2. **Stuck mutations are not detected** — a `dsr_clickhouse_mutations` row in
   `pending`/`in_progress` status that doesn't advance for >1 hour is not flagged. This could happen
   if the poller crashes mid-run or the ClickHouse mutation ID is lost. Per RETRO-007, this is a
   "regulator-visible at pilot" gap.

---

## Acceptance Criteria

### AC 1 — Sentry alert rule documentation

Create `docs/ops/DSR_ALERTING.md` documenting:

- The Sentry project name and organization slug for `@estalara/control-plane` (read from
  `sentry.server.config.ts` or `.env.example`)
- The exact Sentry alert rule to create: "When `dsr_erase_clickhouse_mutation_failed` tag is `true`
  → alert immediately → notify project owners"
- Screenshot or CLI command to verify the alert exists
- Incident owner: Piotr Nawrocki (email: asi.piotr@gmail.com per project memory)

### AC 2 — Stuck mutation detection in the poller

Add a **stuck mutation check** to `apps/control-plane/src/app/api/dsr/mutation-poll/route.ts`:

- After the main polling loop, query `dsr_clickhouse_mutations` for any row where:
  - `status IN ('pending', 'in_progress')` AND
  - `updated_at < NOW() - INTERVAL '1 hour'`
- For each stuck row, call `Sentry.captureMessage()` with level `'warning'`, tag
  `dsr_mutation_stuck: 'true'`, and extra context
  `{ row_id, table_name, session_id, tenant_id, hours_since_update }`
- Return the count of stuck rows in the JSON response: `{ polled, advanced, stuck }`

### AC 3 — Unit tests

Add tests for the stuck mutation detection:

- Row updated <1 hour ago → not flagged
- Row updated >1 hour ago with status 'pending' → flagged (Sentry.captureMessage called)
- Row updated >1 hour ago with status 'done' → not flagged (terminal)
- Return value includes `stuck: N`

### AC 4 — DPIA/ROPA update

Update `docs/compliance/DPIA.md` §8 (or the DSR section) to document:

- The alerting mechanism for failed erasures
- The SLA: alert within 5 minutes of permanent failure (5-min cron cycle)
- The response procedure: incident owner receives Sentry alert → investigates
  `dsr_clickhouse_mutations` table → re-triggers or escalates

---

## Key files to read first

- `apps/control-plane/src/app/api/dsr/mutation-poll/route.ts` — current Sentry usage (lines 190-199,
  258-270); understand where to add stuck detection
- `packages/db/src/schema/dsr_clickhouse_mutations.ts` — schema; understand `updatedAt` column name
  in Drizzle
- `apps/control-plane/sentry.server.config.ts` — Sentry project config
- `docs/compliance/DPIA.md` — find the DSR section to update

---

## Implementation notes

- The stuck query uses Drizzle ORM. The `updatedAt` column in `dsr_clickhouse_mutations` is a
  Postgres timestamp — use
  `lt(dsrClickhouseMutations.updatedAt, new Date(Date.now() - 60 * 60_000))` for "older than 1 hour"
- Keep the stuck check **after** the polling loop and **before** the final return — do not let stuck
  detection errors propagate (wrap in try/catch like the per-row error handling)
- The `stuck` count is informational; never let it cause the endpoint to return non-200
- Sentry `captureMessage` with level 'warning' is intentionally lower severity than
  `captureException` for stuck mutations — stuck doesn't mean failed, just stalled

---

## Definition of Done

- [ ] `docs/ops/DSR_ALERTING.md` created with Sentry alert rule instructions and incident owner
- [ ] Stuck mutation query added to mutation-poll route
- [ ] Response body includes `stuck: number`
- [ ] Unit tests cover stuck detection (≥4 cases)
- [ ] `docs/compliance/DPIA.md` §8 updated with alerting SLA
- [ ] Standard CI green (test-node, lint, typecheck, build, format)
