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

## CI contract test (FOLLOW-394 / FOLLOW-402 / FOLLOW-415)

The `clickhouse-smoke` CI job now runs `infra/clickhouse/scripts/migration-contract-test.sh`
**before** the full `migrate.sh + smoke-test.sh` sequence on every PR. The test is self-maintaining:
it extracts the INSERT column list from `logDecisionAsync` in `route.ts` at runtime and determines
the migration boundary automatically. No manual update to the script is needed when a new column is
added.

Test steps (fully automated):

1. Extracts the INSERT column list from `logDecisionAsync` in `route.ts` at runtime.
2. Asserts the extracted column count is at least 17 (floor sanity check — fires loudly if the
   single-line extraction is truncated or the INSERT format changes to span multiple lines).
3. Walks all `infra/clickhouse/migrations/*.sql` in **reverse lexicographic order**; the first file
   that contains `ADD COLUMN` for any column in the INSERT list is the boundary migration.
4. If no boundary migration is found (e.g. all recent migrations are non-column changes such as
   index additions), the ordering assertion is **skipped** with exit 0 — no false failures.
5. Applies all migrations **except** the boundary (including any newer non-column migrations).
6. Attempts an INSERT into `adaptation_decisions` using the extracted column list.
7. Asserts the INSERT is **rejected** (HTTP non-200) — the boundary column is absent.
8. Applies the boundary migration.
9. Repeats the INSERT and asserts it **succeeds** (HTTP 200).

**Boundary detection guarantee (FOLLOW-415 / RETRO-129 LG-1):** the boundary is the newest migration
that actually adds an `adaptation_decisions` INSERT column, not blindly the lexically-last file.
Adding a non-column migration (e.g. an `intent_events` index) after the newest
`adaptation_decisions` column migration will not cause a false failure.

**Column-list extraction guarantee (FOLLOW-415 / RETRO-129 LG-2):** the extraction assumes the
INSERT column list is on a single line in `logDecisionAsync`. If it spans multiple lines, the
column-count floor assertion (step 2, floor = 17) fires immediately with a clear error message
instead of silently passing with a partial list.

**Self-maintaining guarantee:** if a future PR adds a new column to `logDecisionAsync`'s INSERT
without a corresponding `*.sql` migration file, the extracted column list includes the new column,
the INSERT still fails after applying all existing migrations, and CI exits non-zero — catching the
same class of silent data-loss incident as ESC-031.

---

## Checklist: deploying a ClickHouse migration that touches an INSERT column list

- [ ] Identify every `INSERT INTO <table> (col1, col2, ...)` statement in `apps/` that names the new
      column.
- [ ] Apply the migration to the production ClickHouse instance (via FOLLOW-308 checklist)
      **before** merging the code change.
- [ ] Verify the column is present in production (DESCRIBE TABLE, see above).
- [ ] Verify `migration-contract-test.sh` passes in CI — it derives the column list from
      `logDecisionAsync` automatically (FOLLOW-402/415) and finds the boundary migration via smart
      reverse-walk (not the lexically-last file), so no manual update is needed.
- [ ] Merge the code change.

The order is: **migrate → verify → merge code**. Reversing steps 1 and 3 reproduces ESC-031.
