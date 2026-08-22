# ClickHouse Migrations Runbook

**Owner:** data-engineer **Last updated:** 2026-07-01 **References:** ESC-031, RETRO-118,
FOLLOW-394, FOLLOW-308, FOLLOW-449 (audit finding F-02)

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

## CI contract test (FOLLOW-394 / FOLLOW-402 / FOLLOW-415 / FOLLOW-449)

The `clickhouse-smoke` CI job now runs `infra/clickhouse/scripts/migration-contract-test.sh`
**before** the full `migrate.sh + smoke-test.sh` sequence on every PR. The test is self-maintaining:
it extracts the INSERT column list from `logDecisionAsync` in `route.ts` at runtime and determines
the migration boundary automatically. No manual update to the script is needed when a new column is
added.

**Two independent tables, two independent boundary walks (FOLLOW-449):** the script runs the
reject-then-accept assertion twice, against two isolated databases so neither run's "apply all
migrations except the boundary" step can interfere with the other:

- **Part A — `adaptation_decisions`.** Column list extracted from `logDecisionAsync` in
  `apps/control-plane/src/app/api/adapt/route.ts` (unchanged from FOLLOW-394/402/415).
- **Part B — `intent_events` (FOLLOW-449 / audit finding F-02).** Column list extracted from the
  `const row = { ... }` object literal inside `insertIntentEventToClickHouse` in
  `apps/ingest/src/handlers/intent-snapshot.ts`. The current boundary migration is `0015`
  (`ADD COLUMN IF NOT EXISTS session_id`) — this is the exact migration this ticket is about. If a
  future PR adds a new column to that `row` object without a corresponding migration, Part B fails
  CI the same way Part A already does for `adaptation_decisions`.

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

**Column-list extraction guarantee (FOLLOW-415 / RETRO-129 LG-2, corrected by FOLLOW-560):** the
extraction assumes the INSERT column list is on a single line in `logDecisionAsync`. The
column-count floor assertion (step 2, floor = 17) was documented as the guard for that assumption,
but it is not sufficient on its own: when FOLLOW-560 first split the list across lines to append a
conditional column, `sed` found no closing `)`, passed the raw source line through backticks and
all, and the floor still counted 18 comma-separated tokens — so the script built syntactically
invalid SQL, "passed" step 7 for the wrong reason (a 4xx that was a parse error, not a missing
column) and would have failed step 9 with a misleading message. FOLLOW-560 therefore adds an
explicit assertion that the extracted list contains no backtick; that is the check which actually
fails loud, and it fires before the floor.

**Flag-gated columns (FOLLOW-560):** a column that is only appended to the INSERT when an env flag
is set (`SCORING_PATH_COLUMN_ENABLED` for `scoring_path`, so the writer stays deployable while the
prod apply of migration 0022 waits on FOLLOW-820) is invisible to the static extraction. Declare it
in `route.ts` with the marker comment

```ts
// migration-contract-test:OPTIONAL_COLUMN scoring_path
```

and the script appends it to the exercised column list, so the ordering contract still covers it —
its migration must exist and becomes the boundary. Keep the base column list a single parenthesised
literal line and append the flag-gated column by exact string replacement (see `logDecisionAsync`);
interpolating it into the literal line re-breaks the extraction.

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

**Variant for a flag-gated column (FOLLOW-560):** when the prod apply cannot be same-day (0022's is
deferred to FOLLOW-820), the writer ships behind an env flag that defaults off, and the order
becomes **merge code (flag off) → migrate → verify DESCRIBE → flip the flag in Doppler `prd` →
redeploy → verify rows carry the new value**. The flag-off INSERT is byte-identical to the previous
one, so the merge itself can never reproduce ESC-031; the flag flip is the step that must not
precede the DDL.

---

## Prod Attestation — migration 0019

**Date:** 2026-06-26 **Attested by:** FOLLOW-404 (devops-engineer)

**DESCRIBE TABLE result (relevant rows):**

```
page_context_source	LowCardinality(String)	DEFAULT	'legacy'
```

Full `DESCRIBE TABLE adaptation_decisions FORMAT TSV` output (18 columns confirmed):

```
session_id	String
tenant_id	String
archetype	LowCardinality(String)
confidence	Float32
similarity	Float32
source	LowCardinality(String)
page_context	UInt8
directive_count	UInt16
ts	DateTime64(3, 'UTC')
holdout_group	Bool	DEFAULT	false
gate_reason	LowCardinality(String)	DEFAULT	''
variant	LowCardinality(String)	DEFAULT	'control'
adapt_decision_id	String	DEFAULT	''
demo_override	UInt8	DEFAULT	0
model_version	LowCardinality(String)	DEFAULT	''
features_snapshot	String	DEFAULT	''
lead_id	String	DEFAULT	''
page_context_source	LowCardinality(String)	DEFAULT	'legacy'
```

**SELECT DISTINCT page_context_source:**

Table had zero rows at time of attestation (consistent with the ~80-minute silent-write-failure
window described in ESC-031; migration 0019 was applied manually after the incident). Column
existence confirmed via DESCRIBE TABLE above.

**Writer grant (ingest_worker):**

`SHOW GRANTS FOR ingest_worker` returned:

```
GRANT SELECT, INSERT ON default.* TO ingest_worker
```

INSERT on `default.adaptation_decisions` is confirmed present (covered by `default.*`).

**Cross-reference:** This is the one-time 0019 attestation per RETRO-121 §7. FOLLOW-308 is the
standing prod-apply mechanism (different scope). ESC-031 root-cause incident documented in the
ESC-031 section of this runbook above.

---

## Prod Attestation — writes confirmed flowing (FOLLOW-425 fix verified)

**Date:** 2026-06-28 **Attested by:** FOLLOW-422 (data-engineer)

**Background:** FOLLOW-404 (2026-06-26) confirmed migration 0019 was applied and the column existed,
but the table had zero rows at that time. The zero-row state was consistent with the ~80-minute
ESC-031 silent-write-failure window. FOLLOW-425 (PR #374, merged 2026-06-26T22:53Z) fixed
`logDecisionAsync` to check `response.ok` and capture to Sentry on HTTP-level ClickHouse rejections.
This attestation verifies that writes are now actually flowing after the fix.

**AC-1 — Smoke adapt request:**

```
GET https://admin.estalara.com/api/adapt
  ?session_id=smoke-follow422-1782651660
  &archetype=neutral
  &confidence=0.5
  &similarity=0.5
  &tier=1
Authorization: Bearer <ADAPT_API_KEY from Doppler prd>
```

Response: HTTP 200, `adapt_decision_id: 05e5bc1e-980d-428c-bd89-e9a577c70ec0`

**AC-2 — ClickHouse queries (run ~30s after the adapt request):**

```sql
SELECT count() FROM adaptation_decisions;
-- Result: 1

SELECT DISTINCT page_context_source FROM adaptation_decisions;
-- Result: caller_supplied

SELECT min(ts), max(ts) FROM adaptation_decisions;
-- Result: 2026-06-28 13:01:00.906    2026-06-28 13:01:00.906
```

**Row detail (full SELECT for the confirmed row):**

```
session_id:          smoke-follow422-1782651660
archetype:           neutral
confidence:          0.5
similarity:          0.5
source:              default
page_context:        1
page_context_source: caller_supplied
variant:             control
adapt_decision_id:   05e5bc1e-980d-428c-bd89-e9a577c70ec0
ts:                  2026-06-28 13:01:00.906
```

**Verdict:** Writes confirmed flowing after FOLLOW-425 fix. The `page_context_source` column is
populated correctly (`caller_supplied` for a GET request with an explicit `tier` param). ESC-031
root cause is resolved end-to-end: migration applied (FOLLOW-404), fail-loud fix deployed
(FOLLOW-425), writes verified (FOLLOW-422).

---

## Prod Attestation — migration 0015 (`intent_events.session_id`) — STUB, OPERATOR MUST COMPLETE

**Ticket:** FOLLOW-449 (P0) **Audit finding:** F-02 — `intent_events` count = 0 in prod. **Status:**
OPEN — this section is a stub. `data-engineer` cannot hold Doppler `prd` ClickHouse credentials
(ESC-022/ESC-031 precedent: applying to prod is a privileged operator action). Piotr or Rafał must
run the commands below against Doppler `prd` and paste the REAL output in place of the
`<<< OPERATOR MUST RUN AND PASTE >>>` markers before this ticket can close AC1/AC2.

### Background

Migration `0015_intent_events_session_id_fix.sql` adds the `session_id` column (the FOLLOW-269/K.3.6
tracer join key) to `intent_events` via
`ALTER TABLE intent_events ADD COLUMN IF NOT EXISTS session_id String DEFAULT ''`. The ingest
handler (`apps/ingest/src/handlers/intent-snapshot.ts:insertIntentEventToClickHouse`) has named
`session_id` in its INSERT column list since FOLLOW-286/287 (merged 2026-06-12). If migration 0015
(and its successors up to the current HEAD migration) were never attested-applied to the production
ClickHouse instance, **every fire-and-forget `intent.snapshot` INSERT has been silently rejected by
ClickHouse (HTTP 4xx, unknown column) since that PR merged** — the exact ESC-031 failure class, on a
different table. This is consistent with the audit finding that `intent_events` has count = 0 in
prod and the Archetype Identification Tracer (K.3.6) has never shown live data.

**Local verification already completed (data-engineer, this ticket, non-prod):**

- Migration 0015 is idempotent: `ADD COLUMN IF NOT EXISTS` — confirmed by running `migrate.sh` twice
  in a row against a clean local ClickHouse container; migration 0015 applied cleanly both times
  with no error (the container's second run failed later, at migration 0018's pre-existing
  non-idempotent `RENAME COLUMN tier` — a separate, already-documented issue, not introduced by or
  in scope for this ticket).
- A synthetic `intent.snapshot` event, inserted via the REAL `insertIntentEventToClickHouse`
  function against a local ClickHouse instance with migrations 0001-0019 applied, produced
  `count() = 1` and was queryable via the tracer's exact SELECT shape (`fetchIntentEventsForSession`
  in `apps/control-plane/src/lib/clickhouse-tracer.ts`). See the FOLLOW-449 PR description for the
  full command transcript.

None of the above substitutes for the prod attestation below — a clean local container has no
bearing on whether migration 0015 was ever applied to the actual production ClickHouse Cloud
instance.

### Exact command sequence (operator: Piotr or Rafał, Doppler `prd`)

```bash
# 1. Load prod ClickHouse credentials from Doppler (do NOT paste raw secrets into any file/chat):
export CLICKHOUSE_URL="$(doppler secrets get CLICKHOUSE_URL --config prd --plain)"
export CLICKHOUSE_USER="$(doppler secrets get CLICKHOUSE_USER --config prd --plain)"
export CLICKHOUSE_PASSWORD="$(doppler secrets get CLICKHOUSE_PASSWORD --config prd --plain)"

# 2. Check current column state BEFORE applying anything (safe, read-only):
curl -sS "${CLICKHOUSE_URL}" -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
  --data-binary "DESCRIBE TABLE intent_events FORMAT TSV"

# 3. If `session_id` is ABSENT from the output above, apply migration 0015 (idempotent —
#    safe even if it turns out to already be partially applied):
MIGRATION_FILE="infra/clickhouse/migrations/0015_intent_events_session_id_fix.sql"
curl -sS --fail-with-body "${CLICKHOUSE_URL}" \
  -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
  --data-binary @"${MIGRATION_FILE}"

# 4. Also confirm every migration 0016-0019 (and any newer HEAD migration) is applied —
#    same drift class as ESC-022/ESC-031. Easiest: run the full idempotent migrate.sh,
#    which is safe to re-run (each migration uses IF NOT EXISTS / IF EXISTS guards, with the
#    sole known exception of 0018's RENAME COLUMN — already applied to prod per the 0019
#    attestation above, so re-running migrate.sh in prod should be a no-op past that point):
doppler run --config prd -- bash infra/clickhouse/scripts/migrate.sh

# 5. Re-run DESCRIBE TABLE and confirm session_id is now present:
curl -sS "${CLICKHOUSE_URL}" -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
  --data-binary "DESCRIBE TABLE intent_events FORMAT TSV"

# 6. Row-level attestation — confirm writes are actually flowing post-fix (mirrors the
#    FOLLOW-422 pattern above): trigger a real intent.snapshot from a live SDK session (or the
#    mock decision harness), then:
curl -sS "${CLICKHOUSE_URL}" -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
  --data-binary "SELECT count() FROM intent_events FORMAT TSV"
curl -sS "${CLICKHOUSE_URL}" -u "${CLICKHOUSE_USER}:${CLICKHOUSE_PASSWORD}" \
  --data-binary "SELECT session_id, tenant_id, toString(event_at) AS event_at, event_type, top_archetype FROM intent_events ORDER BY event_at DESC LIMIT 5 FORMAT TSV"
```

### Expected `DESCRIBE TABLE intent_events` shape (post-migration)

Column order/types confirmed against a clean local ClickHouse container with all 19 migrations
applied (data-engineer, this ticket — NOT prod data, shown here only as the expected shape):

```
intent_session_id      UUID
tenant_id              UUID
event_at               DateTime64(3, 'UTC')
event_type             LowCardinality(String)
archetype_deltas       String   DEFAULT '{}'
confidence_before      Float32  DEFAULT 0
confidence_after       Float32  DEFAULT 0
top_archetype          LowCardinality(String)  DEFAULT ''
event_payload          String   DEFAULT '{}'
session_id             String   DEFAULT ''
```

**The load-bearing row is the last one: `session_id String DEFAULT ''` must be present.** Column
order in prod may differ slightly depending on prior ALTER history — what matters is that
`session_id` exists at all (the F-02 gap) and is type `String` (not `UUID` — migration 0016 was a
documented no-op, see that file's header).

### `<<< OPERATOR MUST RUN AND PASTE >>>` — real prod output goes here

**Date:** _(operator fills in)_ **Attested by:** _(Piotr / Rafał)_

**Step 2 — `DESCRIBE TABLE intent_events` BEFORE:**

```
<<< OPERATOR MUST RUN AND PASTE >>>
```

**Step 3/4 — migration apply output:**

```
<<< OPERATOR MUST RUN AND PASTE >>>
```

**Step 5 — `DESCRIBE TABLE intent_events` AFTER (must show `session_id`):**

```
<<< OPERATOR MUST RUN AND PASTE >>>
```

**Step 6 — row-level attestation (`count()` and the 5 most recent rows):**

```
<<< OPERATOR MUST RUN AND PASTE >>>
```

**Verdict:** _(operator fills in — PASS only once `session_id` is confirmed present in prod AND at
least one real row is confirmed queryable)._

**Cross-reference:** FOLLOW-449 (this ticket) is data/code-complete without prod access per the
ESC-022/ESC-031 privileged-operator-action precedent; this stub is the handoff artifact. FOLLOW-308
is the standing prod-apply mechanism (different scope, still open per the Sprint 22b backlog note).

---

## Prod Attestation — migration 0020 (`description_generations` TTL) [FOLLOW-535]

**Date:** 2026-07-09 **Operator:** Piotr (CEO) — `ALTER … MODIFY TTL` via ClickHouse Cloud SQL
console (admin `default`; `ingest_worker` has no `ALTER` privilege) **Service:**
`hl0kc83gt4.eu-west-1.aws.clickhouse.cloud:8443`

**Background:** Migration 0007 created `description_generations` with
`PARTITION BY toYYYYMM(created_at)` but **no TTL**. Inert while the table had zero writers;
FOLLOW-463 added the first writer, so rows began accumulating with no expiry (amplified by the
RETRO-163/FOLLOW-528 model-toggle re-dispatch — one row per toggle). Migration 0020 adds a 13-month
TTL matching the `events` audit table. ClickHouse does **not** auto-apply migrations (RETRO-076 /
Rule M), so this required a manual privileged apply.

**Order (RETRO-167 LG-1):** applied the TTL **before** the FOLLOW-463 `GRANT INSERT` in the same
admin session, so no live write window opened against an un-TTL'd table. Pre-flight confirmed the
0007 table exists (RETRO-167 LG-2 — `EXISTS TABLE` guard against Code 60 UNKNOWN_TABLE).

**Applied:**

```sql
ALTER TABLE default.description_generations
    MODIFY TTL toDateTime(created_at) + INTERVAL 13 MONTH;
```

**Verdict: PASS — verbatim-verified 2026-07-09.** The operator ran the `ALTER` on the
correctly-named table (after correcting an initial `INTERNAL` → `INTERVAL` keyword typo — the
`INTERNAL` mis-token parsed as an identifier and threw `Code: 62 SYNTAX_ERROR`; the correct
`INTERVAL 13 MONTH` form then applied cleanly, matching the CI golden-DDL test). The admin
`SHOW CREATE TABLE default.description_generations` confirms the TTL clause is present on the
correct table:

```sql
CREATE TABLE default.description_generations
(
    `tenant_id` String,
    `listing_id` String,
    `archetype` LowCardinality(String),
    `locale` LowCardinality(String),
    `tier` UInt8,
    `model` LowCardinality(String),
    `source` LowCardinality(String),
    `description_chars` UInt32,
    `verified_facts_used` Array(String),
    `generated_at` DateTime64(3, 'UTC'),
    `created_at` DateTime64(3, 'UTC')
)
ENGINE = SharedMergeTree('/clickhouse/tables/{uuid}/{shard}', '{replica}')
PARTITION BY toYYYYMM(created_at)
ORDER BY (tenant_id, listing_id, archetype, locale, created_at)
TTL toDateTime(created_at) + toIntervalMonth(13)
SETTINGS index_granularity = 8192
```

(`SharedMergeTree` is the ClickHouse Cloud engine substituted for the migration's `MergeTree` — TTL
semantics are identical.) The sibling FOLLOW-463 grant from the same session is also CLI-verified
correct (see the grant-narrowing runbook addendum).

**Cross-reference:** FOLLOW-535 (this migration), FOLLOW-463 grant (bundled, see the grant-narrowing
runbook addendum), RETRO-167 (§ order-safety + follow-ups FOLLOW-541/542), FOLLOW-536 (the
still-open reader — table remains write-only). The golden-DDL CI regression test added by FOLLOW-535
(`ci.yml`) enforces the TTL clause is present in `dist`/migration source going forward.

---

## Prod Attestation — migration 0022 (`adaptation_decisions.scoring_path`) [FOLLOW-560] — STUB, DEFERRED TO FOLLOW-820

**Status: NOT APPLIED TO PROD. Deliberately deferred** — FOLLOW-560 ships the migration file, the
writer (flag-gated off), and a LOCAL apply only. The prod apply is a FOLLOW-820 (CEO go/no-go)
checklist item, per the localhost-first ruling in `CLAUDE.md`.

**Local apply already performed under FOLLOW-560** (same image and `LOCAL=1` path CI uses,
`clickhouse/clickhouse-server:25.8`):

```bash
LOCAL=1 CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_PASSWORD=clickhouse \
  ./infra/clickhouse/scripts/migrate.sh
curl -sS "http://localhost:8123" -u default:clickhouse \
  --data-binary "DESCRIBE TABLE adaptation_decisions FORMAT TSV" | grep scoring_path
# scoring_path	LowCardinality(String)	DEFAULT	\'not_applicable\'
# (TSV escapes the quotes around the default — the column literal is 'not_applicable'.)
```

**Why this one is flag-gated where 0021 was not:** 0021's writer landed in a separate PR ~8.5h after
an operator confirmed its DDL was live (RETRO-275). That choreography needs a same-day prod apply,
which FOLLOW-560 cannot have. So `logDecisionAsync` omits `scoring_path` from the INSERT unless
`SCORING_PATH_COLUMN_ENABLED=true`; with the flag unset the statement is byte-identical to the
pre-FOLLOW-560 one and cannot hit `NO_SUCH_COLUMN_IN_BLOCK`, whose rejection this code path only
`console.error`s (ESC-031: 80 minutes of silent write loss).

### Operator sequence when FOLLOW-820 authorises it (order is load-bearing)

```sql
-- 1. Pre-flight: table exists, column does not yet.
DESCRIBE TABLE default.adaptation_decisions;

-- 2. Apply (admin `default` user — `ingest_worker` has no ALTER privilege).
ALTER TABLE default.adaptation_decisions
    ADD COLUMN IF NOT EXISTS scoring_path LowCardinality(String) DEFAULT 'not_applicable';

-- 3. Verify.
DESCRIBE TABLE default.adaptation_decisions;
```

4. Only then set `SCORING_PATH_COLUMN_ENABLED=true` in Doppler `prd` and redeploy the control plane.
5. Row-level attestation after the redeploy — the split FOLLOW-819 is the consumer of:

```sql
SELECT scoring_path, count() FROM default.adaptation_decisions
WHERE ts > now() - INTERVAL 1 HOUR GROUP BY scoring_path ORDER BY count() DESC;
```

Expect `djb2_guard`/`djb2_fallback` to dominate until `archetype_embeddings` is seeded in prod
(FOLLOW-392) — that is the finding this column exists to make visible, not a failure of the apply.

The same split is rendered for operators on `/admin/analytics` (Scoring Path panel). It reads the
identical flag, so before step 4 that panel says why it has no numbers rather than showing zeros;
after step 4 it is the quickest confirmation that rows are carrying the new value.

**`<<< OPERATOR MUST RUN AND PASTE >>>`** — real prod output goes here, with date, operator, and
verdict, matching the 0019/0020 attestation format above.
