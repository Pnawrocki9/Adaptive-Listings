# Runbook — `validate_schemas` daily cron (§B.6 continuous schema validation)

**Owner of the first-run verification: Piotr Nawrocki (CEO).** **Verification date: 2026-08-08,
after the 05:00 UTC `Cron Heartbeat (FOLLOW-893)` run.**

Created by FOLLOW-893. Covers the Modal cron `apps/data-quality/src/crons/schema_validation.py` and
its absence-of-signal detector.

---

## 1. What runs, when

| Thing                                   | Where                                  | When            |
| --------------------------------------- | -------------------------------------- | --------------- |
| `validate_schemas`                      | Modal app `estalara-schema-validation` | 02:00 UTC daily |
| `Cron Heartbeat (FOLLOW-893)` assertion | GitHub Actions `cron-heartbeat.yml`    | 05:00 UTC daily |

The cron was first deployed to Modal on **2026-08-07 19:43:43 UTC** (Modal Deploy run `31212639962`,
job `Deploy data-quality (estalara-schema-validation)`, `✓ App deployed`,
`Created function validate_schemas`). Its **first-ever firing is 2026-08-08 02:00 UTC.**

## 2. The first-run verification (FOLLOW-893 AC1)

§Snapshot.1 row B.6 flips 🟡 → ✅ only on **both** of:

1. a green scheduled `validate_schemas` run, and
2. at least one `schema_validation_history` row in prod Postgres.

**Do not flip it on this runbook.** The owner above performs the check on the date above and records
the result. Two outcomes are both legitimate and must be distinguished:

- **Heartbeat fresh + ≥1 history row** → both conditions met, B.6 flips.
- **Heartbeat fresh + 0 history rows** → the run executed and found **no active tenant with a
  `tenant_site_schemas` row**. That is a healthy no-op, and condition (2) is **not** met — B.6 stays
  🟡 with the reason recorded as "no tenant has a stored site schema", not as "cron broken". These
  are different problems with different fixes and must never be merged into one 🟡.

Check both in one command (needs prod DB access via Doppler):

```bash
doppler run --config prd -- bash scripts/check-cron-heartbeat.sh \
  --job validate_schemas --max-age-hours 26
```

The script prints the heartbeat age **and** a `schema_validation_history` digest for the same
window, which is exactly the two facts B.6 asks for. The digest prints **whatever the heartbeat
verdict is** — the one night the history digest matters most is the night the heartbeat cannot exist
yet, so the reader is deliberately not gated behind the liveness check. Or run the workflow on
demand: `gh workflow run cron-heartbeat.yml`.

## 3. The absence-of-signal detector (FOLLOW-893 AC2)

`cron_heartbeats` (migration `0037_cron_heartbeats.sql`) holds one row per scheduled job.
`validate_schemas` UPSERTs it as the **last** action on the **success** path only.
`scripts/check-cron-heartbeat.sh` asserts, from outside the cron, that the row is younger than 26h,
and exits non-zero otherwise — a red GitHub Actions run, i.e. a notified, structured sink.

**Window arithmetic — do not move the check earlier.** The cron fires 02:00 UTC and the check runs
05:00 UTC. With a 26h window, a run that happened is ~3h old (pass) and a single missed run leaves
yesterday's heartbeat ~27h old (fail). A check at, say, 03:30 UTC would see a missed run as only
25.5h old and pass — the alarm would stop alarming while staying green.

**Why not just query `schema_validation_history`.** `_run_validation()` returns early and writes
**zero** rows when no active tenant has a site schema, so an empty history table is ambiguous
between "ran, nothing to do" and "never ran". The heartbeat is unconditional on success and carries
`run_detail.tenant_domain_pairs`, so both facts survive separately.

The detector has observed its own failure: `cron-heartbeat.yml`'s `detector-negative-control` job
runs the real script against a throwaway Postgres in five states (no table / no row / 27h stale / 3h
fresh / no connection string) and asserts the exit code of each, on every push and PR.

### When the alarm fires

1. **`table public.cron_heartbeats does not exist`** — migration 0037 has not been applied to that
   database. Postgres migrations auto-apply on merge (`db-migrate.yml`); check that workflow's last
   run.
2. **`no heartbeat has EVER been recorded`** — the job has never once completed against this
   database. In order of likelihood: the Modal app is not deployed (check `modal-deploy.yml`'s
   `Deploy data-quality` job), the schedule did not register, `DATABASE_URL` is absent from the
   `estalara-secrets` Modal secret (the deploy's runtime-key gate asserts that key, so a green
   deploy rules it out), or — **the cause actually observed on 2026-08-08, and none of the above** —
   the container cannot import its own module. See §6. Do not stop at "the app says `deployed`":
   that is exactly what it said while every container was dying at line 58.
3. **`has not completed successfully in Nh`** — the job ran before but not now. Open
   `https://modal.com/apps/estalara/main/deployed/estalara-schema-validation` and read the last
   run's logs. A raised exception never reaches the heartbeat write, by design.
4. **Expected red window:** between merging FOLLOW-893 and the first 02:00 UTC run of the
   **redeployed** cron, case 2 is the correct verdict and the check is correctly red. That red is
   the detector working, not a defect. It clears on the first successful run.

## 4. Who reads `schema_validation_history` (FOLLOW-893 AC3)

Before FOLLOW-893 the table was written, self-queried for Sentry dedup, typed in Drizzle — and
consumed by nothing. Its consumers now are:

1. **The cron's own 24h dedup query** (`_was_drift_alerted_recently`) — suppresses repeat Sentry
   alerts for the same tenant.
2. **The daily digest** in `scripts/check-cron-heartbeat.sh` — rows written, tenants covered, drift
   rows, fetch-error rows, newest `run_at` — printed into the workflow's job summary on every
   scheduled run. This is reporting, not gating: drift itself already alarms via Sentry
   (`schema_validation.py:510`), and double-alarming the same event is how alarms get muted.
3. **No tenant-facing surface yet.** The Drizzle docstring previously claimed a
   `/dashboard/site-health` panel (TICKET-VAL-002) reads it; that panel does not exist in this repo.
   The claim is corrected in the same PR. A real admin surface is a separate ticket — it is
   deliberately **not** required for the table to be legitimate, because consumer (1) is a genuine
   control-flow read and consumer (2) is a genuine reported read.

## 6. Failure mode: the app is `deployed` and every container dies at import (FOLLOW-900)

This is the state the cron was in for its entire life until 2026-08-08, and it is the reason §3's
alarm exists at all. It is worth reading before diagnosing anything else, because every surface a
human would normally check said the job was fine:

- `modal app list` → `estalara-schema-validation`, state **`deployed`**.
- The `Deploy data-quality` job in `modal-deploy.yml` → **green**, including its runtime-key gate.
- The `modal.Cron("0 2 * * *")` schedule → **registered**.
- Sentry → **nothing**, because the import that fails IS `crons.observability.init_sentry`.

The only surface that told the truth was the container log:

```
File "/root/schema_validation.py", line 58, in <module>
    from crons.observability import flush_sentry, init_sentry
ModuleNotFoundError: No module named 'crons'
```

**Why.** Modal removed automounting of local Python source in 1.0 (this repo runs 1.4.x). What is
left is an _implicit entrypoint mount_ whose shape is decided in
`modal/_utils/function_utils.py::FunctionInfo.__init__` by one thing: whether the module defining
the `@app.function` has a truthy `__package__`.

| entrypoint loaded as                        | modal branch | what reaches the container                    |
| ------------------------------------------- | ------------ | --------------------------------------------- |
| part of a package (`jobs.foo`)              | `PACKAGE`    | the whole top-level package (`jobs/`)         |
| a bare file path (`modal deploy` on a file) | `FILE`       | that ONE file, flattened to `/root/<stem>.py` |

`modal deploy apps/data-quality/src/crons/schema_validation.py` imports the entrypoint by path, so
`__package__` is empty → `FILE` → `/root/schema_validation.py` alone, with no `crons/` beside it.
`PYTHONPATH=apps/data-quality/src` in the deploy job fixes the _runner-side_ import during
registration; it puts nothing into the image. Those are two different machines.

**The fix, and the gate that keeps it fixed.** Local modules must be declared on the image:

```python
image = modal.Image.debian_slim(python_version="3.12").pip_install(...).add_local_python_source("crons")
```

`scripts/check-modal-local-imports.py` enforces this for every deployed Modal app — it walks each
entrypoint's imports at any nesting depth (function-body imports included, which is how the same
defect hid in `apps/intent-engine`), resolves which are local, and fails when one is not declared.
It runs as a hard gate in `ci.yml` and as a step in every `modal-deploy.yml` deploy job. Run it
locally with `python3 scripts/check-modal-local-imports.py`, and `--self-test` to check the gate
itself.

**How to prove a fix, since a green deploy cannot.** `modal deploy` only registers functions; it
never starts a container. Invoke the function and read the sink:

```bash
PYTHONPATH=apps/data-quality/src modal run \
  apps/data-quality/src/crons/schema_validation.py::validate_schemas
doppler run --config prd -- bash scripts/check-cron-heartbeat.sh --job validate_schemas --max-age-hours 26
```

A successful invocation prints `Created mount PythonPackage:crons` while creating objects — that
line is the direct evidence the local package is in the image. Note that a manual `modal run` mounts
source from your working tree, so it proves the code path, **not** the deployed artefact; only a
scheduled run does that.

## 5. Related

- `apps/data-quality/src/crons/schema_validation.py` — the cron
- `packages/db/migrations/0037_cron_heartbeats.sql` — the heartbeat sink
- `scripts/check-cron-heartbeat.sh` — the assertion
- `.github/workflows/cron-heartbeat.yml` — the schedule + negative control
- `.github/workflows/modal-deploy.yml` — how the cron reaches prod
- `scripts/check-modal-local-imports.py` — the local-source gate (FOLLOW-900)
- `docs/MASTER_DESIGN.md` §Snapshot.1 row B.6 — the flip condition
