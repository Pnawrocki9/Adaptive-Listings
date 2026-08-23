# ClickHouse `date_time_input_format` — the setting every JSONEachRow writer depends on

**Owner:** data-engineer · **Ticket:** FOLLOW-853 AC(4) · **Created:** 2026-08-23

This runbook exists because the correctness of every `INSERT … FORMAT JSONEachRow` in this repo
depends on a **vendor default that is pinned nowhere and asserted by nothing**, and that default is
the _opposite_ in production from what it is in the container CI and localhost run against.

---

## 1. The recorded production value

| field                   | value                                                         |
| ----------------------- | ------------------------------------------------------------- |
| Setting                 | `date_time_input_format`                                      |
| **Value in production** | **`best_effort`**                                             |
| Server version          | ClickHouse **26.4.1.2029** (ClickHouse Cloud)                 |
| Date read               | **2026-08-07**                                                |
| Read during             | FOLLOW-845 / session 103, read-only probe                     |
| Value in CI + localhost | **`basic`** — `clickhouse/clickhouse-server:25.8` OSS default |

The probe that produced it:

```sql
SELECT value FROM system.settings WHERE name = 'date_time_input_format'
-- → best_effort
```

### What this record does NOT establish (read before relying on it)

Stated explicitly rather than left implicit, per FOLLOW-880 item 3:

1. **The user the probe ran as was not captured.** `currentUser()` was not part of the query.
   `date_time_input_format` is a **per-user-profile** setting in ClickHouse, so a value read as one
   user is not automatically the value the `ingest_worker` user gets. The probe most likely ran as
   the Doppler `prd` `CLICKHOUSE_USER`, but "most likely" is not a measurement.
2. **It is a point-in-time read, not a pin.** Nothing in Terraform, Doppler or a migration asserts
   this value. ClickHouse Cloud can change a default on an upgrade, and no alert would fire.
3. **Row counts were not checked.** The `ingest_worker` user has no `SELECT` grant on
   `default.events` (ESC-056, OPEN), so "prod parses the format" was inferred from the setting, not
   confirmed from arriving rows.

**Because of (1)–(3), no writer in this repo may depend on this value.** That is the whole point of
the FOLLOW-853 fix below — the record is here so nobody re-derives it or opens a false prod
incident, not so anyone can build on it.

### Re-reading it

Requires `doppler` (absent from agent sandboxes — this is an operator action):

```bash
doppler run -p estalara-adaptive-listings -c prd -- bash -c \
  'echo "SELECT currentUser(), value FROM system.settings WHERE name = '"'"'date_time_input_format'"'"'" |
   curl -s -u "$CLICKHOUSE_USER:$CLICKHOUSE_PASSWORD" "$CLICKHOUSE_URL/" --data-binary @-'
```

Note the added `currentUser()` — do not drop it, it is the column the 2026-08-07 read was missing.

---

## 2. Why the setting matters

`date_time_input_format` governs how the JSONEachRow parser reads a **string** into a `DateTime` /
`DateTime64` column:

| value                 | accepts `2026-08-07 10:58:05.822` | accepts `2026-08-07T10:58:05.822Z` |
| --------------------- | --------------------------------- | ---------------------------------- |
| `basic` (OSS default) | yes                               | **no** — Code 27                   |
| `best_effort` (prod)  | yes                               | yes                                |

Under `basic` the parser stops at the `T`/`Z` and rejects with:

```
Code: 27. DB::Exception: Cannot parse input: expected '"' before:
'Z","ingest_received_at":"2026-08-07T10:58:05.822Z",…' (while reading the value of key ts)
(CANNOT_PARSE_INPUT_ASSERTION_FAILED)
```

**The rejection is whole-batch and post-ACK.** The ingest Worker has already returned HTTP 200 to
the SDK by the time it writes, so a total write loss is invisible to the browser, to the SDK and to
any user-facing surface. That is what made this survive undetected: `events` simply stayed empty on
localhost, and FOLLOW-819's AC(5) lift query (`events WHERE type = 'cta.clicked'`) had nothing to
read.

---

## 3. The standing rule for writers (FOLLOW-853)

> **Emit `YYYY-MM-DD hh:mm:ss.mmm` — space-separated, UTC, no zone suffix — for every ClickHouse
> `DateTime`/`DateTime64` column. Never `.toISOString()`.**

That literal is the **intersection** of what `basic` and `best_effort` accept, so a writer using it
is independent of the setting, of the server version and of the user profile it connects as. It is
also ClickHouse's own canonical text output format for these types, so values round-trip.

**Canonical encoder:** `toClickHouseDateTime64` in `apps/ingest/src/clickhouse-producer.ts`. Its
shell mirror is `_ch_datetime64` in `infra/clickhouse/scripts/smoke-test.sh` — change both or
neither.

### Why not just set `date_time_input_format=best_effort` on the insert URL

It was the obvious alternative and it was rejected:

- It trades a dependency on the server **default** for a dependency on the user profile's
  **permission** to override that setting per request. A `readonly` constraint on the profile
  answers Code 452 `SETTING_CONSTRAINT_VIOLATION`, and per §1 item 1 we do not actually know the
  `ingest_worker` profile's constraints.
- It leaves two byte shapes in the repo for one logical column — the exact vocabulary divergence
  Rule K.1 exists to prevent.
- `best_effort` is a permissive parser applied to _every_ DateTime column in the request, widening
  what an unrelated malformed value would silently be coerced into.

### Conforming writers

| writer                                                               | column(s)                                         | status              |
| -------------------------------------------------------------------- | ------------------------------------------------- | ------------------- |
| `apps/ingest/src/clickhouse-producer.ts`                             | `events.ts`, `events.ingest_received_at`          | fixed by FOLLOW-853 |
| `apps/ingest/src/handlers/intent-snapshot.ts`                        | `intent_events.event_at`                          | fixed by FOLLOW-853 |
| `apps/control-plane/src/app/api/adapt/route.ts`                      | `adaptation_decisions.ts`                         | already conforming  |
| `apps/control-plane/src/app/api/dsr/_clickhouse.ts`                  | `dsr_audit_log.requested_at/completed_at`         | already conforming  |
| `apps/control-plane/src/app/api/internal/description-cache/route.ts` | `description_generations.generated_at/created_at` | already conforming  |
| `apps/control-plane/src/lib/llm-calls-register.ts`                   | `llm_calls.ts`                                    | already conforming  |

**Deliberate non-conformer:** `upsertIntentSessionToSupabase` in
`apps/ingest/src/handlers/intent-snapshot.ts` keeps `.toISOString()`. It writes to **Postgres via
PostgREST**, not ClickHouse, and `timestamptz` wants the trailing `Z`. Applying the ClickHouse
encoder there would be a regression. (The FOLLOW-853 dispatch brief listed those two lines as a
third ClickHouse writer with the same defect — that anchor was wrong; see FOLLOW-880.)

`apps/stream-consumer` is unaffected: it inserts native Python `datetime` objects over the native
protocol, which never goes through this parser.

---

## 4. What is asserted, and where

| assertion                                                      | where                                                                                 | substrate                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------- |
| Encoder emits the canonical shape; stale `T`/`Z` tokens absent | `apps/ingest/src/clickhouse-producer.test.ts`                                         | unit, offline                   |
| `intent_events.event_at` byte shape                            | `apps/ingest/src/handlers/__tests__/intent-snapshot.test.ts`                          | unit, offline                   |
| Real producer lands rows under `basic`                         | `apps/ingest/src/__tests__/integration/clickhouse-producer.integration.test.ts` AC2-A | CI `clickhouse-smoke` container |
| Old trailing-`Z` shape still rejected with Code 27             | same file, AC2-B (negative control)                                                   | CI `clickhouse-smoke` container |
| New shape also accepted under prod's `best_effort`             | same file, AC2-C                                                                      | CI `clickhouse-smoke` container |
| Smoke fixture sends the writer's real bytes, ms round-trips    | `infra/clickhouse/scripts/smoke-test.sh`                                              | CI `clickhouse-smoke` container |

**Not asserted anywhere:** that production's value is still `best_effort`. There is no cron, no
alert and no gate on it. This is forgone coverage, stated rather than silent (Rule AS) — and after
FOLLOW-853 it is no longer load-bearing, because the writers no longer depend on it. It becomes
load-bearing again the moment anyone reintroduces an ISO-8601 timestamp into a ClickHouse insert.

---

## Cross-references

- `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md` §8 — the original discovery, with the reproducing curl.
- FOLLOW-853 — this defect. FOLLOW-822 owns ClickHouse drift **detection**, a different concern; the
  two have been mislabeled for each other at least three times (RETRO-259 §4d DG-5, PR #828).
- FOLLOW-880 — the stale-citation corrections to FOLLOW-853's own record.
- ESC-056 — the `SELECT` grant on `default.events` that would make "are rows arriving?" answerable.
