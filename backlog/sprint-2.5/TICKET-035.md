# TICKET-035 — Continuous Schema Validation Cron (Drift Detection)

**Sprint:** 2.5 **Agent:** data-engineer **Priority:** P1 **Estimated hours:** 8 **Status:** BLOCKED
**Depends on:** TICKET-034 (platform templates must exist for deterministic re-detection)
**Unblocks:** (none in Sprint 2.5)

> **DUPLICATE WARNING — READ BEFORE STARTING.** This ticket has identical scope to
> **TICKET-VAL-001** which appears in the Sprint 9 QUEUE.md plan. One implementation serves both.
> The canonical implementation lives here (Sprint 2.5, whichever sprint executes first). When Sprint
> 9 reaches TICKET-VAL-001, the PM-orchestrator must mark it `CANCELLED` with note
> `"Implemented in TICKET-035 (Sprint 2.5)"` and update QUEUE.md accordingly. If Sprint 9 runs first
> for any reason, TICKET-035 becomes the stub. Do not implement the same cron job twice. Confirm
> with PM before starting if status is unclear.

## Context

Master Design section B.6 describes a continuous schema validation system to prevent tenant churn
from silent selector breakage. When an agency redesigns their site, the CSS selectors stored in
`tenant_site_schemas` become stale. Without drift detection, the SDK silently fails to extract
listing data and adaptation stops — the agency sees "no results" with no explanation.

The fix: a daily Modal cron job that re-fetches each active tenant's site, re-runs the deterministic
detector from `packages/sdk/src/auto-detect/`, compares the result to the stored schema, and alerts
on any significant divergence. This is the reactive layer (B.6.1 health check pipeline). The
predictive layer (B.5.4, DOM embedding fingerprints) is deferred to Sprint 9+.

The cron lives in `apps/data-quality/src/crons/schema_validation.py`. The `apps/data-quality/` Modal
app already has a placeholder `main.py` (status: placeholder from Sprint 0).

**References:**

- `docs/MASTER_DESIGN.md` section B.6.1 — daily health check pipeline diagram
- `apps/data-quality/src/main.py` — existing placeholder; do not break existing structure
- `packages/db/src/schema/tenant_site_schemas.ts` — source of stored schemas per tenant
- `packages/sdk/src/auto-detect/pipeline.ts` — deterministic detection entry point (TypeScript)
- TICKET-033 — `POST /api/detect` Next.js route is the most reliable way to invoke the TypeScript
  detector from Python; reuse that pattern

## Acceptance criteria

All of the following must be met before the PR may be merged:

1. **Modal cron function.** `apps/data-quality/src/crons/schema_validation.py` defines a Modal cron
   decorated with `@app.function(schedule=modal.Period(hours=24))`. The function is named
   `run_schema_validation`. The Modal app name is `estalara-data-quality` (matches existing
   `pyproject.toml` app name — do not rename).

2. **Tenant enumeration.** The cron queries Postgres (via `asyncpg` or `psycopg2`) for all tenants
   with `status = 'active'`. Read the `SUPABASE_DATABASE_URL` secret (already in `estalara-secrets`
   Modal Secret from TICKET-009). For each tenant, it reads the latest `tenant_site_schemas` row.
   Skip tenants with no schema row.

3. **Re-detection.** For each active tenant with a schema row, the cron: a. Fetches
   `schema.primary_url` (or the stored `domain`, constructing `https://<domain>`) with a 15-second
   `httpx` timeout. b. Passes the fetched HTML to the Next.js `POST /api/detect` endpoint (same
   pattern as TICKET-032 Step 3) to run the deterministic detector. c. Compares the returned
   selectors to the stored `schema` JSONB. A field is considered "drifted" if its `css_selector`
   value differs OR its new `confidence` drops below `0.60`.

4. **`schema_drift_detected` event emission.** If any field is drifted, publish a
   `schema_drift_detected` event to the Redpanda topic `estalara.events` using the standard event
   envelope from ADR-0003. Event payload:

   ```json
   {
     "event_type": "schema_drift_detected",
     "tenant_id": "<uuid>",
     "domain": "<string>",
     "drifted_fields": ["title", "price"],
     "stored_confidence": 0.95,
     "new_confidence": 0.42,
     "detected_at": "<ISO timestamp>"
   }
   ```

   Use the `kafka-python` or `confluent-kafka` client. Reuse the Redpanda connection config from
   `apps/data-quality/` (check existing `main.py` or `pyproject.toml` for the Redpanda client
   already present — add if missing).

5. **Sentry alert on drift.** If drift is detected, call `sentry_sdk.capture_message(...)` with
   level `warning` and the tenant_id, domain, and drifted_fields. Tag the Sentry event with
   `tenant_id` and `drift_type: "selector_mismatch"`.

6. **`schema_validation_history` table write.** Regardless of drift, upsert a row in
   `schema_validation_history` (create this table if it does not exist — new Drizzle migration
   required). Schema:

   ```
   id              uuid PRIMARY KEY DEFAULT gen_random_uuid()
   tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
   domain          text NOT NULL
   run_at          timestamptz NOT NULL DEFAULT now()
   health_score    real NOT NULL        -- fraction of fields that passed (0.0–1.0)
   drifted_fields  text[] NOT NULL DEFAULT '{}'
   drift_detected  boolean NOT NULL DEFAULT false
   ```

   RLS: tenant can read only its own rows.

7. **Graceful per-tenant error handling.** If fetching a tenant's site fails (DNS error, timeout,
   non-200 response), log the error to Sentry with level `info` (not `error` — transient outages are
   normal) and skip to the next tenant. The entire cron job must not fail if a single tenant's site
   is unreachable.

8. **Parallelism.** Process tenants concurrently using `asyncio.gather` with a semaphore capped at
   10 concurrent tenant checks to avoid overwhelming the control-plane detect endpoint or network.

9. **Python test coverage >= 70%.** Tests in `apps/data-quality/tests/test_schema_validation.py`
   using `pytest` and `unittest.mock`.

10. **`pyproject.toml` updated.** Confirm `asyncpg` (or `psycopg2-binary`), `httpx`, `sentry-sdk`,
    `kafka-python` (or `confluent-kafka`) are in the dependencies. Confirm
    `build-backend = "setuptools.build_meta"`.

11. **New Drizzle migration.** `packages/db/migrations/` must contain a new migration file for the
    `schema_validation_history` table. Generate with
    `pnpm --filter @estalara/db drizzle-kit generate`. The migration runs in CI.

## Files to touch

| File                                                  | Action                                                    |
| ----------------------------------------------------- | --------------------------------------------------------- |
| `apps/data-quality/src/crons/schema_validation.py`    | NEW — daily Modal cron function                           |
| `apps/data-quality/src/crons/__init__.py`             | NEW — package marker                                      |
| `apps/data-quality/src/main.py`                       | EXTEND — import and register the cron app                 |
| `apps/data-quality/src/__init__.py`                   | VERIFY — must exist                                       |
| `apps/data-quality/pyproject.toml`                    | ADD — missing dependencies                                |
| `apps/data-quality/tests/test_schema_validation.py`   | NEW — pytest test suite                                   |
| `packages/db/src/schema/schema_validation_history.ts` | NEW — Drizzle table definition                            |
| `packages/db/src/schema/index.ts`                     | EXPORT — new table                                        |
| `packages/db/migrations/`                             | NEW — generated migration for `schema_validation_history` |

## Test expectations

### Unit tests (required)

1. **No drift detected.** Mock `httpx` returning fresh HTML and mock control-plane returning the
   same selectors as stored. Assert: no Sentry alert is raised, `schema_drift_detected` event is not
   published, `schema_validation_history` row is written with `drift_detected = false` and
   `health_score = 1.0`.

2. **Drift detected on one field.** Mock control-plane returning a different `price` selector.
   Assert: `drifted_fields = ["price"]`, Sentry capture called with level `warning`,
   `schema_drift_detected` event published to Redpanda with correct payload shape.

3. **Site unreachable.** Mock `httpx.get` raising `httpx.ConnectError`. Assert:
   `sentry_sdk. capture_message` called with level `info`, no event published, cron continues to the
   next tenant.

4. **Tenant with no schema row.** Tenant exists in DB with `status = 'active'` but no
   `tenant_site_schemas` row. Assert: tenant is skipped silently (no error, no event).

5. **Semaphore cap.** Mock 20 tenants. Assert that no more than 10 concurrent `httpx` calls are in
   flight at any moment (use `asyncio.Semaphore` mock or inspect `asyncio.gather` batch size).

## Branch naming

`data-engineer/TICKET-035-continuous-schema-validation-cron`

## PR title format

`feat(data-quality): daily schema validation cron — drift detection + Sentry alerts + history table [TICKET-035]`

## Definition of done

- PR opened, all local checks green.
- `gh pr checks <pr-number> --watch` returns all SUCCESS.
- PM-orchestrator validates AC items above.
- PM-orchestrator comments `PM-validated. CI green. Ready for human review and merge.`
- PM-orchestrator confirms TICKET-VAL-001 in QUEUE.md is marked `CANCELLED` with cross-reference.
- Ticket moved to `READY_FOR_REVIEW` in QUEUE.md.
