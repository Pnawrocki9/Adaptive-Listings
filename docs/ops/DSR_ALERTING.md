# DSR Alerting Runbook

**Document ID:** ESTALARA-OPS-DSR-ALERTING-001 **Version:** 1.0 **Date:** 2026-05-24 **Owner:**
Piotr Nawrocki (asi.piotr@gmail.com) **Classification:** Internal — Restricted

---

## Purpose

This runbook documents Sentry alert rules for the DSR ClickHouse erasure pipeline and the incident
response procedure when those alerts fire. It covers two alert types:

1. Permanent erasure failure — a ClickHouse `ALTER TABLE ... DELETE WHERE` mutation failed all retry
   attempts.
2. Stuck mutation — a mutation row has not advanced from `pending` or `in_progress` for more than
   one hour.

---

## Sentry Project

- **Project:** `control-plane` (configured via `SENTRY_DSN_CONTROL_PLANE` environment variable in
  Doppler; see `apps/control-plane/sentry.server.config.ts`)
- **Organization slug:** identified in your Sentry dashboard under Settings > General > Organization
  Slug (typically `estalara` or `time2show`; verify in Sentry UI)

---

## Alert 1 — Permanent Erasure Failure

### Tag

```
dsr_erase_clickhouse_mutation_failed: 'true'
```

### When it fires

This tag is applied by `Sentry.captureException()` in
`apps/control-plane/src/app/api/dsr/mutation-poll/route.ts` when a ClickHouse mutation row reaches
its final retry attempt (retry count >= `MAX_MUTATION_RETRIES`, currently 3) and has no further
scheduled retry. The cron runs every 5 minutes, so the alert fires within 5 minutes of permanent
failure.

### Severity

Error

### Creating the Sentry alert rule (UI steps)

1. In Sentry, navigate to **Alerts** > **Create Alert**.
2. Choose **Issues** as the alert type.
3. Set **Filter** to: Tag `dsr_erase_clickhouse_mutation_failed` equals `true`.
4. Set **Threshold**: trigger when the issue is seen **1 or more** times in a **5-minute** window.
5. Set **Action**: notify **Piotr Nawrocki** (asi.piotr@gmail.com) via email and/or Slack channel
   `#compliance-ops`.
6. Set **Alert name**: `DSR ClickHouse permanent erasure failure`.
7. Save.

### SLA

The on-call compliance engineer must respond within **5 minutes** of the alert firing, matching the
cron interval. Failure to respond within 30 minutes must be escalated to the CTO (Rafał Palak PhD).

### Response procedure

1. Open the Sentry issue. Inspect `extra.tenant_id`, `extra.table`, `extra.retry_count`, and
   `extra.latest_failed_reason`.
2. Connect to the Postgres control plane database (Supabase) and inspect the relevant row in
   `dsr_clickhouse_mutations`:

   ```sql
   SELECT *
   FROM dsr_clickhouse_mutations
   WHERE tenant_id = '<tenant_id_from_sentry>'
     AND table_name = '<table_from_sentry>'
     AND status = 'failed'
   ORDER BY updated_at DESC
   LIMIT 10;
   ```

3. Identify the root cause from `last_failed_reason`. Common causes:
   - ClickHouse Cloud quota or concurrency limit — wait and re-trigger.
   - Schema mismatch (column renamed or dropped) — escalate to data-engineer.
   - Network partition between Vercel and ClickHouse Cloud — check Cloudflare status and ClickHouse
     Cloud status page.

4. To re-trigger a failed mutation, reset the row to a retryable state:

   ```sql
   UPDATE dsr_clickhouse_mutations
   SET status     = 'pending',
       retry_count = 0,
       last_failed_reason = NULL,
       next_retry_at = NULL,
       updated_at  = NOW()
   WHERE id = '<row_id>';
   ```

   The next cron invocation (within 5 minutes) will re-issue the `ALTER TABLE ... DELETE WHERE`.

5. If the mutation cannot be completed automatically (e.g., the ClickHouse table has been dropped),
   escalate to data-engineer and document the manual resolution path in the incident log. The DSR
   audit log entry must be updated manually to reflect the final status.

6. Document the incident in `backlog/ESCALATIONS.md` with the row ID, tenant ID, resolution action,
   and timestamp.

---

## Alert 2 — Stuck Mutation

### Tag

```
dsr_mutation_stuck: 'true'
```

### When it fires

This tag is applied by `Sentry.captureMessage()` (level: `warning`) in
`apps/control-plane/src/app/api/dsr/mutation-poll/route.ts` when a row with status `pending` or
`in_progress` has a `updated_at` timestamp more than one hour in the past. The check runs on every
cron invocation (every 5 minutes). One warning is emitted per stuck row per cron run.

### Severity

Warning

### Creating the Sentry alert rule (UI steps)

1. In Sentry, navigate to **Alerts** > **Create Alert**.
2. Choose **Issues** as the alert type.
3. Set **Filter** to: Tag `dsr_mutation_stuck` equals `true`.
4. Set **Threshold**: trigger when the issue is seen **1 or more** times in a **10-minute** window
   (allows two cron runs to produce the warning before alerting, to reduce noise from transient
   delays).
5. Set **Action**: notify **Piotr Nawrocki** (asi.piotr@gmail.com) via email and/or Slack channel
   `#compliance-ops`.
6. Set **Alert name**: `DSR ClickHouse mutation stuck (>1h no progress)`.
7. Save.

### SLA

The on-call compliance engineer must acknowledge and investigate within **30 minutes** of the alert
firing. A stuck mutation is a warning, not an immediate GDPR breach, but it becomes a breach risk if
it prevents timely erasure under the Art. 17 GDPR right-to-erasure SLA (30 days).

### Response procedure

1. Open the Sentry warning. Inspect `extra.row_id`, `extra.table_name`, `extra.session_id`,
   `extra.tenant_id`, and `extra.hours_since_update`.
2. Connect to the Postgres control plane database and inspect the row:

   ```sql
   SELECT *
   FROM dsr_clickhouse_mutations
   WHERE id = '<row_id_from_sentry>';
   ```

3. Check `last_failed_reason` and `mutation_id`. If `mutation_id` is empty, the cron has not yet
   resolved the mutation ID from ClickHouse `system.mutations` — this is expected within the first
   few minutes but not after one hour.
4. Query ClickHouse directly to check mutation status:

   ```sql
   SELECT *
   FROM system.mutations
   WHERE mutation_id = '<mutation_id>'
   LIMIT 1;
   ```

5. If ClickHouse shows the mutation as complete (`is_done = 1`) but the cron has not updated the
   Postgres row, the cron poller may have an error. Check Sentry for `dsr_erase_poll_row_error`
   tagged events for the same row ID.
6. If the mutation is genuinely stuck in ClickHouse (e.g., due to a large table or resource
   contention), monitor its progress and allow it to complete before intervening.
7. If the mutation has been stuck for more than 4 hours, reset it to `pending` with
   `retry_count = 0` (same SQL as Alert 1 step 4) so the cron can re-issue it.

---

## Stuck-check error (secondary alert)

If the stuck-check DB query itself fails, `Sentry.captureException()` fires with tag:

```
dsr_stuck_check_error: 'true'
```

This indicates a Postgres connectivity issue in the cron handler. Investigate Supabase status and
cron logs in Vercel.

---

## Incident owner

**Primary:** Piotr Nawrocki — asi.piotr@gmail.com

**Escalation:** Rafał Palak PhD (CTO) — for unresolvable ClickHouse issues or breach scenarios.

---

## Related documents

- `docs/compliance/dpia.md` — Section 8 (Data Subject Rights), erasure flow and alerting
- `apps/control-plane/src/app/api/dsr/mutation-poll/route.ts` — polling handler source
- `packages/db/src/schema/dsr_clickhouse_mutations.ts` — Drizzle schema for the mutation tracking
  table
- `apps/control-plane/sentry.server.config.ts` — Sentry initialization
