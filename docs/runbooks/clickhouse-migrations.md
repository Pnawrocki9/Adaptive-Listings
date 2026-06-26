# ClickHouse Migrations Runbook

**Owner:** data-engineer **Last updated:** 2026-06-26 **References:** ESC-031, RETRO-118,
FOLLOW-394, FOLLOW-308

---

## The migration-before-code invariant

ClickHouse does **not** coerce unknown columns to NULL on INSERT. If a column named in an INSERT's
column list does not exist in the table, ClickHouse returns HTTP 400 immediately and the entire
INSERT is rejected — no row is written.

This differs from Postgres, which rejects at parse time with a loud error. ClickHouse's HTTP
interface behaves the same way: the INSERT body fails cleanly.

The dangerous part is the application layer. The adapt route's fire-and-forget path in
`apps/control-plane/src/app/api/adapt/route.ts` calls `logDecisionAsync()`, which issues the
ClickHouse INSERT and swallows any rejection in a `.catch()`:

```ts
fetch(url.toString(), { method: 'POST', body: query, ... })
  .catch((err: unknown) => {
    console.error('[adapt] ClickHouse log failed:', err instanceof Error ? err.message : err);
  });
```

The error is logged to the console but never surfaced to the caller or to an alert channel. As a
result, **a missing migration causes every adaptation decision write to fail silently** with no HTTP
error, no metric spike, and no alerting. The only observable symptom is a flat count on
`adaptation_decisions`.

**Invariant:** apply any ClickHouse migration that adds a column to a table BEFORE deploying code
that names that column in an INSERT.

---

## ESC-031 incident summary (2026-06-26)

Migration `0019_adaptation_decisions_page_context_source.sql` adds the `page_context_source` column
to `adaptation_decisions`. PR #357 deployed `logDecisionAsync` code that named `page_context_source`
in the INSERT column list, but migration 0019 had not been applied to the production ClickHouse
instance.

**Impact:** all `adaptation_decisions` writes failed silently from approximately 10:40Z to ~12:00Z
(about 80 minutes). Zero rows were written during that window.

**Resolution (RETRO-118):** migration 0019 was applied manually to the production instance. The CI
contract test added by FOLLOW-394 catches this class of incident in future.

---

## Manual apply pattern (curl HTTP API)

The `clickhouse-client` binary may not be available on the operator machine. Use the HTTP API
directly. This is the same mechanism `migrate.sh` uses.

```bash
# Apply a single migration file directly:
# Required environment (load via Doppler in production):
#   CLICKHOUSE_URL      e.g. https://<host>:8443
#   CLICKHOUSE_USER     e.g. default
#   CLICKHOUSE_PASSWORD <from Doppler prd>

MIGRATION_FILE="infra/clickhouse/migrations/0019_adaptation_decisions_page_context_source.sql"

curl -sS --fail-with-body "${CLICKHOUSE_URL}" \
  -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
  --data-binary @"${MIGRATION_FILE}"
```

For files containing multiple statements (separated by `;`), use `migrate.sh`'s `_apply_file()`
helper which handles the statement-splitting automatically:

```bash
# Apply ALL pending migrations idempotently (safe to re-run):
CLICKHOUSE_URL="..." CLICKHOUSE_PASSWORD="..." \
  bash infra/clickhouse/scripts/migrate.sh
# migrate.sh is idempotent: migrations use IF NOT EXISTS / IF EXISTS guards.
```

To apply only one specific migration without re-running all of them, source the helper functions
from `migrate.sh` and call `_apply_file` directly, or use the curl pattern above for
single-statement migrations.

### Verify the column was added

After applying the migration, confirm the column is present:

```bash
curl -sS "${CLICKHOUSE_URL}" \
  -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
  --data-binary "DESCRIBE TABLE adaptation_decisions FORMAT TSV" \
  | grep page_context_source
# Expected output: page_context_source   LowCardinality(String)   ...
```

---

## Standing prod-apply gate

**Do NOT build a parallel migration-tracking mechanism.** The standing gate for production
ClickHouse migration deployment is FOLLOW-308 (Option A, the same mechanism used for Postgres
migrations). Cross-reference FOLLOW-308 for the canonical operator checklist and any automation
layered on top.

This runbook documents the manual recovery path for incidents; FOLLOW-308 owns the prevention
mechanism.

---

## CI contract test (FOLLOW-394)

The `clickhouse-smoke` CI job now runs `infra/clickhouse/scripts/migration-contract-test.sh`
**before** the full `migrate.sh + smoke-test.sh` sequence on every PR. The test:

1. Applies migrations `0001`–`0018` only (no `page_context_source` column).
2. Attempts an INSERT into `adaptation_decisions` that names `page_context_source`.
3. Asserts the INSERT is **rejected** (HTTP non-200).
4. Applies migration `0019`.
5. Repeats the INSERT and asserts it **succeeds** (HTTP 200).

This catches **regression of the 0019 / `page_context_source` boundary specifically** — it asserts
the column is absent before migration 0019 and present after. It does NOT generically detect any
future column added to `logDecisionAsync`; the test is hardcoded to this one boundary. For any new
column you add to `logDecisionAsync`, follow the 'Extending the contract test' section below to add
the assertion manually (or wait for FOLLOW-402, which will generalize the check).

**Extending the contract test:** when a future migration adds a new column to an explicit INSERT in
`logDecisionAsync` (or any other fire-and-forget ClickHouse writer), add a corresponding contract
test case to `infra/clickhouse/scripts/migration-contract-test.sh` following the same four-step
pattern. Once FOLLOW-402 lands, the column list will be derived automatically — see that ticket for
the generalized parity check.

---

## Checklist: deploying a ClickHouse migration that touches an INSERT column list

- [ ] Identify every `INSERT INTO <table> (col1, col2, ...)` statement in `apps/` that names the new
      column.
- [ ] Apply the migration to the production ClickHouse instance (via FOLLOW-308 checklist)
      **before** merging the code change.
- [ ] Verify the column is present in production (DESCRIBE TABLE, see above).
- [ ] Add a contract test case to `migration-contract-test.sh` for the new column.
- [ ] Merge the code change.

The order is: **migrate → verify → merge code**. Reversing steps 1 and 3 reproduces ESC-031.
