# ClickHouse `ingest_worker` Grant Narrowing Runbook (ESC-032 / FOLLOW-424)

**Owner:** data-engineer **Last updated:** 2026-06-28 **References:** ESC-032, FOLLOW-424,
RETRO-133, RETRO-135, ESC-031, FOLLOW-308

---

## Purpose

Narrow the prod ClickHouse `ingest_worker` credential from the broad
`GRANT SELECT, INSERT ON default.*` wildcard to a least-privilege, explicit per-table grant — and
simultaneously **add three pre-existing missing privileges** (DSR `ALTER DELETE`/`ALTER UPDATE`
mutations and `system.mutations` SELECT) that the wildcard never covered.

This is a **correctness + narrowing** operation, not a pure narrowing:

- The wildcard is removed (least-privilege; closes blast-radius of a compromised `ingest_worker`
  credential).
- The DSR (GDPR right-to-erasure) pipeline's `ALTER TABLE ... DELETE/UPDATE` mutations and its
  `system.mutations` status poll were **never** covered by `INSERT, SELECT ON default.*` — they are
  added here. Until this runs, prod DSR erasure fails on the next request.
- Tables with no real writer (`description_generations`, `session_quality` INSERT) intentionally
  lose access.

## Preconditions (all must be true before running)

1. **Fail-loud gate closed.** All five ClickHouse write paths must surface HTTP rejections to
   Sentry, so a mis-scoped grant (HTTP 403) can never fail silently again (the ESC-031 failure
   mode). Status as of 2026-06-28:
   - `events` INSERT (ingest Worker + stream-consumer) — hardened ✅
   - `intent_events` INSERT (ingest Worker) — hardened ✅
   - `adaptation_decisions` INSERT (`logDecisionAsync`) — hardened ✅ (FOLLOW-425, PR #374)
   - `llm_calls` INSERT (`logLlmCallAsync`) — hardened ✅ (FOLLOW-427, PR #377)
   - `dsr_audit_log` INSERT (`writeDsrAuditLog`) — hardened ✅ (FOLLOW-428, PR #377)
2. **Run as the ClickHouse Cloud admin account** (e.g. `default`) via the ClickHouse Cloud web SQL
   console. `ingest_worker` has **no `GRANT OPTION`** and cannot REVOKE/GRANT on its own account
   (confirmed RETRO-133 / FOLLOW-308). There is no Doppler-stored admin credential — admin access is
   via the ClickHouse Cloud login only.
3. For the smoke tests you need `CLICKHOUSE_URL` and the `ingest_worker` password
   (`CLICKHOUSE_PASSWORD` in Doppler `prd`). Note: `CLICKHOUSE_URL` is currently in Vercel only,
   **not** Doppler — recommend adding it to Doppler `prd` so a single `doppler run --config prd`
   covers the full set.

## Confirmed table access (ESC-032 Phase 1 enumeration)

| Table                             | Need                           | Driven by                                                                                |
| --------------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------- |
| `default.events`                  | INSERT + ALTER DELETE          | ingest Worker / stream-consumer; DSR erase                                               |
| `default.intent_events`           | INSERT + SELECT                | ingest Worker; tracer K.3.6                                                              |
| `default.adaptation_decisions`    | INSERT + SELECT + ALTER DELETE | `logDecisionAsync`; pilot/analytics; DSR erase                                           |
| `default.llm_calls`               | INSERT + SELECT + ALTER DELETE | `logLlmCallAsync`; circuit breaker; DSR erase                                            |
| `default.dsr_audit_log`           | INSERT + ALTER UPDATE          | DSR audit writer + status updater                                                        |
| `default.session_quality`         | ALTER DELETE only              | DSR erase (no INSERT path in code)                                                       |
| `system.mutations`                | SELECT                         | DSR mutation status poll                                                                 |
| `default.description_generations` | INSERT (no SELECT)             | `writeDescriptionGenerationAudit` (FOLLOW-463 writer, granted + CLI-verified 2026-07-09) |

---

## Step 1 — REVOKE + GRANT (admin, ClickHouse Cloud SQL console)

Run in one session, in order.

```sql
-- 1) Drop the wildcard
REVOKE SELECT, INSERT ON default.* FROM ingest_worker;

-- 2) INSERT on the confirmed 5 write tables
GRANT INSERT ON default.events                TO ingest_worker;
GRANT INSERT ON default.intent_events         TO ingest_worker;
GRANT INSERT ON default.adaptation_decisions  TO ingest_worker;
GRANT INSERT ON default.llm_calls             TO ingest_worker;
GRANT INSERT ON default.dsr_audit_log         TO ingest_worker;

-- 3) SELECT only where a real query exists
GRANT SELECT ON default.llm_calls             TO ingest_worker;  -- circuit breaker (sum cost 24h)
GRANT SELECT ON default.intent_events         TO ingest_worker;  -- tracer K.3.6
GRANT SELECT ON default.adaptation_decisions  TO ingest_worker;  -- pilot/analytics dashboard

-- 4) DSR (GDPR erasure) mutations — NOT covered by INSERT/SELECT; missing today
GRANT ALTER DELETE ON default.events                TO ingest_worker;
GRANT ALTER DELETE ON default.adaptation_decisions  TO ingest_worker;
GRANT ALTER DELETE ON default.llm_calls             TO ingest_worker;
GRANT ALTER DELETE ON default.session_quality       TO ingest_worker;
GRANT ALTER UPDATE ON default.dsr_audit_log         TO ingest_worker;

-- 5) DSR mutation status poll (different database — system, not default)
GRANT SELECT ON system.mutations TO ingest_worker;
```

## Step 2 — Verify grants (admin)

```sql
SHOW GRANTS FOR ingest_worker;
```

Expect 14 GRANT rows matching the above. **No `default.*` wildcard row may remain.**

## Step 3 — Smoke tests (as `ingest_worker`)

```bash
# events — INSERT
curl -sS --fail-with-body "${CLICKHOUSE_URL}/?database=default&query=INSERT+INTO+events+FORMAT+JSONEachRow" \
  -u "ingest_worker:${CLICKHOUSE_PASSWORD}" -H "Content-Type: application/x-ndjson" \
  --data-binary '{"event_id":"smoke-esc032","tenant_id":"test","session_id":"s1","ts":"2026-06-28 12:00:00.000","ingest_received_at":"2026-06-28 12:00:00.000","region":"eu","type":"smoke.test","schema_version":1,"consent_state":"granted","listing_id":"","archetype_hint":"","payload":"{}"}'

# SELECTs the app actually issues
curl -sS --fail-with-body "${CLICKHOUSE_URL}" -u "ingest_worker:${CLICKHOUSE_PASSWORD}" --data-binary "SELECT count() FROM adaptation_decisions FORMAT JSON"
curl -sS --fail-with-body "${CLICKHOUSE_URL}" -u "ingest_worker:${CLICKHOUSE_PASSWORD}" --data-binary "SELECT sum(cost_usd) FROM llm_calls WHERE ts >= now() - INTERVAL 1 DAY FORMAT JSON"
curl -sS --fail-with-body "${CLICKHOUSE_URL}" -u "ingest_worker:${CLICKHOUSE_PASSWORD}" --data-binary "SELECT count() FROM intent_events FORMAT JSON"
curl -sS --fail-with-body "${CLICKHOUSE_URL}" -u "ingest_worker:${CLICKHOUSE_PASSWORD}" --data-binary "SELECT count() FROM system.mutations FORMAT JSON"
curl -sS --fail-with-body "${CLICKHOUSE_URL}" -u "ingest_worker:${CLICKHOUSE_PASSWORD}" --data-binary "SELECT count() FROM dsr_audit_log FORMAT JSON"

# negative control — MUST fail (no grant; expect 403/497 access denied)
curl -sS "${CLICKHOUSE_URL}" -u "ingest_worker:${CLICKHOUSE_PASSWORD}" --data-binary "SELECT count() FROM description_generations FORMAT JSON"
```

All positive tests must return 200; the negative control must return access-denied.

## Step 4 — Clean up the smoke row (admin)

```sql
ALTER TABLE events DELETE WHERE event_id = 'smoke-esc032';
```

## Step 5 — Post-execution (data-engineer, in a PR)

1. Update `docs/MASTER_DESIGN.md` §44 to document the exact minimal grant (replace the stale
   `INSERT + SELECT on default.events` line). Draft replacement:

   > ClickHouse user `ingest_worker` — minimal least-privilege grant (applied ESC-032 Phase 2 /
   > FOLLOW-424): INSERT on
   > `default.{events, intent_events, adaptation_decisions, llm_calls, dsr_audit_log}`; SELECT on
   > `default.{llm_calls, intent_events, adaptation_decisions}` and `system.mutations`; ALTER DELETE
   > on `default.{events, adaptation_decisions, llm_calls, session_quality}`; ALTER UPDATE on
   > `default.dsr_audit_log`.

2. Append the `SHOW GRANTS FOR ingest_worker` output + smoke-test results to this runbook as an
   attestation (date, operator, verdict).
3. Mark ESC-032 RESOLVED in `backlog/ESCALATIONS.md` and FOLLOW-424 DONE in `backlog/QUEUE.md`.

## Rollback

If a positive smoke test fails (a needed table returns access-denied), re-grant the broad wildcard
to restore service immediately, then debug:

```sql
GRANT SELECT, INSERT ON default.* TO ingest_worker;
```

Then re-run the enumeration to find the missing table before retrying the narrowed grant.

---

## Prod Attestation

**Date:** 2026-06-29 **Operator:** Piotr (CEO) — REVOKE/GRANT via ClickHouse Cloud SQL console
(admin) **Service:** `hl0kc83gt4.eu-west-1.aws.clickhouse.cloud:8443`

**`SHOW GRANTS FOR ingest_worker` after execution** (14 privileges, NO `default.*` wildcard):

```
GRANT SELECT, INSERT, ALTER DELETE ON default.adaptation_decisions TO ingest_worker
GRANT INSERT, ALTER UPDATE ON default.dsr_audit_log TO ingest_worker
GRANT INSERT, ALTER DELETE ON default.events TO ingest_worker
GRANT SELECT, INSERT ON default.intent_events TO ingest_worker
GRANT SELECT, INSERT, ALTER DELETE ON default.llm_calls TO ingest_worker
GRANT ALTER DELETE ON default.session_quality TO ingest_worker
GRANT SELECT ON system.mutations TO ingest_worker
```

**Validation (direct `ingest_worker` tests against prod, post-narrowing):**

| Check                                                                     | Result                                                                           |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Auth (`SELECT 1`)                                                         | ✅ HTTP 200                                                                      |
| SELECT `adaptation_decisions`                                             | ✅ HTTP 200                                                                      |
| INSERT `adaptation_decisions` (test row, then cleaned via `ALTER DELETE`) | ✅ row landed                                                                    |
| ALTER DELETE `adaptation_decisions` (DSR mutation grant)                  | ✅ HTTP 200                                                                      |
| Negative control: SELECT `default.description_generations`                | ✅ DENIED — `Code: 497 … ingest_worker: Not enough privileges … (ACCESS_DENIED)` |

**Verdict:** Grant narrowing is **correct and complete**. Least-privilege enforced (wildcard gone;
ungranted table denied). The grant does **not** break writes — `ingest_worker` retains full
INSERT/SELECT/ALTER on its required set.

**Caveat — not attested here:** end-to-end writes via the control-plane `/api/adapt` app path are
**NOT** confirmed flowing. Two end-to-end smokes during this attestation returned HTTP 200 but did
not persist a row, while direct `ingest_worker` INSERT succeeded — a **separate, grant-independent
prod regression** tracked as **ESC-033 (P1)**. This runbook attests the grant only.

---

## Addendum — `description_generations` INSERT added (FOLLOW-463 writer)

**Date:** 2026-07-09 **Operator:** Piotr (CEO) — GRANT via ClickHouse Cloud SQL console (admin
`default`) **Service:** `hl0kc83gt4.eu-west-1.aws.clickhouse.cloud:8443`

**Why:** ESC-032 (2026-06-29) narrowed the grant to _exclude_ `description_generations` because it
had no writer. FOLLOW-463 later added the first writer (`writeDescriptionGenerationAudit`, the
§E.7.5 anti-hallucination audit sink), so the negative-control table above became a real write
target. Escalation resolved 2026-07-09 (`backlog/ESCALATIONS.md`).

**Intended grant (INSERT only — `ingest_worker` deliberately retains NO SELECT; write-only audit
sink, reader is the still-open FOLLOW-536):**

```sql
GRANT INSERT ON default.description_generations TO ingest_worker;
```

**Near-miss (RETRO-167 verify discipline):** the first admin pass granted a **misspelled** table
(`descriptions_generations`, extra "s"). A CLI check caught it — the real `description_generations`
still returned `Code: 497 ACCESS_DENIED`. Corrected in a second pass:

```sql
REVOKE INSERT ON default.descriptions_generations FROM ingest_worker;
GRANT  INSERT ON default.description_generations  TO ingest_worker;
```

**Verdict: effective — CLI-verified 2026-07-09.** `SHOW GRANTS` (as `ingest_worker`, Doppler `prd`
creds) after correction — typo table gone (0 occurrences), correct grant present:

```
GRANT SELECT, INSERT, ALTER DELETE ON default.adaptation_decisions TO ingest_worker
GRANT INSERT ON default.description_generations TO ingest_worker
GRANT INSERT, ALTER UPDATE ON default.dsr_audit_log TO ingest_worker
GRANT INSERT, ALTER DELETE ON default.events TO ingest_worker
GRANT SELECT, INSERT ON default.intent_events TO ingest_worker
GRANT SELECT, INSERT, ALTER DELETE ON default.llm_calls TO ingest_worker
GRANT ALTER DELETE ON default.session_quality TO ingest_worker
GRANT SELECT ON system.mutations TO ingest_worker
```

The grant is INSERT only (no SELECT — write-only audit sink; reader is the still-open FOLLOW-536).
Cross-ref: RETRO-167, FOLLOW-542 (durable order-safe, copy-safe runbook — the two operator typos
this session, `descriptions_` and `INTERNAL`, are fresh evidence for it).
