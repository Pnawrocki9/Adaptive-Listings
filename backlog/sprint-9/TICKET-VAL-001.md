# TICKET-VAL-001 — Continuous Schema Validation Cron

**Sprint:** 9 (canonical) **Agent:** data-engineer **Priority:** P1 **Estimated hours:** 8
**Status:** BACKLOG **Depends on:** TICKET-AUTO-006 (DONE — `tenant_site_schemas` table exists with
`schema` JSONB, `domain`, and `detection_confidence` columns), TICKET-034 (Sprint 2.5 — schema
discovery pipeline; check QUEUE.md for status before starting) **Unblocks:** (none — this is a
monitoring layer; downstream follow-up is the `/dashboard/site-health` panel, Sprint 10)

**Note on TICKET-035 (Sprint 2.5):** QUEUE.md lists TICKET-035 as "Continuous schema validation
cron" (BLOCKED, depends on TICKET-034). That ticket is now superseded by this one. TICKET-VAL-001 is
the canonical implementation. After this ticket merges, mark TICKET-035 as SUPERSEDED by
TICKET-VAL-001 in QUEUE.md.

## Context

Master Design section B.6 defines the Continuous Schema Validation & Self-Healing system. The
problem it solves: tenant websites change (redesigns, A/B tests, theme updates). When CSS selectors
stored in `tenant_site_schemas` break, the SDK stops augmenting listings and the tenant experiences
silent degradation — they see no errors but adaptation stops working. Without automation this
becomes churn.

Section B.6.1 specifies a daily cron job that: (1) samples listings from each tenant's site, (2)
re-runs deterministic selector validation against the live page, (3) compares results against the
stored schema, (4) emits alerts and writes a validation history row if drift is detected.

This ticket implements that cron as a Modal scheduled function. It does NOT implement auto-recovery
(section B.6.3 — that is a future ticket). It does NOT implement the real-time SDK drift telemetry
path (section B.6.2 — the SDK already emits `schema.drift_detected` events but those are consumed
separately by the ingest pipeline). This ticket is the daily batch validation layer only.

The cron runs at `02:00 UTC` daily. Modal's `@app.cron("0 2 * * *")` decorator handles scheduling.

**References:**

- `docs/MASTER_DESIGN.md` section B.6 — Continuous Schema Validation & Self-Healing
- `docs/MASTER_DESIGN.md` section B.6.1 — Health check pipeline (the cron flow)
- `docs/MASTER_DESIGN.md` section B.4.3 — AI Vision Auto-Detection (same detection functions reused
  here for re-detection on drift)
- `packages/db/src/schema/tenant_site_schemas.ts` — source of stored schema + domain + tenant
- `packages/sdk/src/auto-detect` — deterministic detection logic (TypeScript); the Python cron must
  replicate the CSS selector validation step (not the full Vision detection — only the
  `validateSelectors` step from B.4.3)
- TICKET-AUTO-006 (DONE, PR #77) — `tenant_site_schemas` table and schema shape

## Acceptance criteria

All of the following must be met before the PR may be merged:

1. **`apps/data-quality/src/crons/schema_validation.py` exists and is a valid Modal app.** The file
   must define a Modal `App` and a cron function decorated with
   `@app.function(schedule=modal.Cron("0 2 * * *"))`. Running
   `modal deploy apps/data-quality/src/crons/schema_validation.py` must not error.

2. **Cron iterates over all active tenants.** The job fetches all rows from the Postgres `tenants`
   table where `status = 'active'`. Uses the existing Supabase connection string (from environment
   variable `DATABASE_URL`). For each tenant, fetches the corresponding row from
   `tenant_site_schemas` (one row per tenant for MVP — if multiple domains exist, process each).
   Skips tenants with no `tenant_site_schemas` row (logs a warning, does not fail the batch).

3. **Cron fetches a sample listing URL for each tenant.** The `tenant_site_schemas` row stores the
   tenant's `domain` field. Construct a sample listing URL by: (a) if the `schema` JSONB contains a
   `sample_listing_url` field (check if TICKET-AUTO-006 stored this — read the schema before
   assuming), use it; (b) otherwise, fall back to `https://{domain}` (the root URL, which may not be
   a listing page — log a warning if this fallback is used). Fetch the page HTML using `httpx`
   (async, 10-second timeout, `User-Agent: Estalara-SchemaValidator/1.0`).

4. **Cron re-runs deterministic selector validation.** For each tenant, after fetching the live page
   HTML:
   - Extract the CSS selectors from the stored `schema` JSONB (`schema.elements` or equivalent field
     — read `tenant_site_schemas.ts` and the TICKET-AUTO-006 output to confirm exact field path).
   - For each stored selector, check whether it matches at least one element in the fetched HTML
     (using `BeautifulSoup` or `lxml` CSS selector support).
   - Record which selectors pass and which fail.
   - Compute a `coverage_score = matched_selectors / total_selectors` (float 0.0–1.0).

5. **Drift is detected when coverage drops below threshold or a required selector fails.** Drift
   condition:
   - `coverage_score < 0.8` (less than 80% of stored selectors still match), OR
   - Any selector marked `required` in the stored schema fails to match. When drift is detected:
   - Emit a `schema_drift_detected` event to Redpanda topic `estalara.schema` with payload:
     ```json
     {
       "tenant_id": "uuid",
       "domain": "string",
       "coverage_score": 0.72,
       "failed_selectors": ["h1.property-title", "span.price-value"],
       "detected_at": "ISO 8601",
       "schema_version": "stored schema detection_confidence"
     }
     ```
   - Send a Sentry alert via `sentry_sdk.capture_message()` with severity `warning` and the same
     payload as tags.
   - Write a row to the `schema_validation_history` Postgres table (AC item 6).

6. **`schema_validation_history` Postgres table exists.** A new Drizzle table with:
   - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
   - `tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`
   - `domain text NOT NULL`
   - `coverage_score real NOT NULL` — 0.0–1.0
   - `failed_selectors text[] NOT NULL DEFAULT '{}'`
   - `total_selectors integer NOT NULL`
   - `matched_selectors integer NOT NULL`
   - `drift_detected boolean NOT NULL`
   - `run_at timestamptz NOT NULL DEFAULT now()`
   - `error text` — null if run succeeded, error message if the page fetch failed
   - Index:
     `idx_schema_validation_history_tenant_run_at ON schema_validation_history(tenant_id, run_at DESC)`
   - RLS: tenant can read only its own rows; data-engineer service role can insert.
   - Migration generated via `pnpm --filter @estalara/db drizzle-kit generate`.

7. **Cron handles page fetch failures gracefully.** If `httpx` times out or returns a non-200 status
   for a tenant's sample URL: log the error, write a `schema_validation_history` row with
   `drift_detected = false`, `error = "fetch_failed: <status>"`, and `coverage_score = 0`. Do not
   emit a Sentry drift alert for fetch failures (these are network errors, not schema drift). Move
   on to the next tenant. The batch must process all tenants even if individual fetches fail.

8. **Cron is idempotent.** Running the cron twice in the same calendar day for the same tenant
   writes two rows to `schema_validation_history` (each run is recorded). This is correct behavior —
   both rows are retained and the dashboard shows the most recent. Idempotency applies to the Sentry
   alert: if drift was already alerted within the last 24 hours, do not re-alert (check the most
   recent `schema_validation_history` row for `drift_detected = true` before emitting to Sentry).

9. **Unit tests for selector validation logic.** The selector matching function
   (`check_selectors(html: str, selectors: list[str]) -> dict`) must be tested independently.

10. **`apps/data-quality/` Python package is properly structured.** The directory must include:
    - `pyproject.toml` with `build-backend = "setuptools.build_meta"` (not legacy backend — see
      CONVENTIONS_PATCH.md lesson from Paczka 1)
    - `src/__init__.py` (even if empty)
    - `requirements.txt` or `pyproject.toml` dependencies: `modal`, `anthropic`, `httpx`,
      `beautifulsoup4`, `lxml`, `sentry-sdk`, `psycopg2-binary`
    - Modal app defined at module level so `modal deploy` works without import errors

## Files to touch

| File                                                    | Action                                                |
| ------------------------------------------------------- | ----------------------------------------------------- |
| `apps/data-quality/src/crons/schema_validation.py`      | NEW — Modal cron function                             |
| `apps/data-quality/src/crons/__init__.py`               | NEW — empty                                           |
| `apps/data-quality/src/__init__.py`                     | NEW — empty (required, see Paczka 1 lessons)          |
| `apps/data-quality/pyproject.toml`                      | NEW — Python package definition                       |
| `apps/data-quality/src/crons/test_schema_validation.py` | NEW — pytest tests                                    |
| `packages/db/src/schema/schema_validation_history.ts`   | NEW — Drizzle table definition                        |
| `packages/db/src/schema/index.ts`                       | Export new table                                      |
| `packages/db/migrations/`                               | New Drizzle migration for `schema_validation_history` |

Before starting: read `packages/db/src/schema/tenant_site_schemas.ts` to understand the exact
`schema` JSONB structure. Read `apps/auto-detect/` (if it exists) for the selector validation logic
to replicate in Python. Read `CONVENTIONS_PATCH.md` for the `pyproject.toml` build-backend rule.

## Implementation notes

**Selector validation in Python (replaces TypeScript `validateSelectors()`).** Use `BeautifulSoup`
with `lxml` parser:

```python
from bs4 import BeautifulSoup

def check_selectors(html: str, selectors: list[str]) -> dict:
    soup = BeautifulSoup(html, "lxml")
    results = {}
    for selector in selectors:
        try:
            match = soup.select(selector)
            results[selector] = len(match) > 0
        except Exception as e:
            results[selector] = False  # malformed selector
    return results
```

**Redpanda producer.** Check if a Redpanda/Kafka producer helper already exists in the codebase
(grep for `KafkaProducer` or `confluent_kafka`). If one exists, reuse it. If not, use
`confluent-kafka` Python package with SASL_SSL auth (credentials from `REDPANDA_BROKERS`,
`REDPANDA_USERNAME`, `REDPANDA_PASSWORD` env vars).

**Sentry deduplication.** Before sending the Sentry alert, query the last row in
`schema_validation_history` for the tenant where `drift_detected = true`. If `run_at` is within the
last 24 hours, skip the Sentry emit but still write the new history row.

**Dashboard follow-up.** The `/dashboard/site-health` panel reading from `schema_validation_history`
is explicitly out of scope for this ticket. Add a follow-up stub to `backlog/FOLLOW_UPS.md` before
opening the PR: "TICKET-VAL-002: Site health dashboard panel reading schema_validation_history."

## Test expectations

### Python tests (required)

1. **`check_selectors` returns true for matching selector.** Create minimal HTML
   `<h1 class="property-title">House</h1>`. Assert `check_selectors(html, ["h1.property-title"])`
   returns `{"h1.property-title": True}`.

2. **`check_selectors` returns false for non-matching selector.** Same HTML. Assert
   `check_selectors(html, ["span.price"])` returns `{"span.price": False}`.

3. **`check_selectors` handles malformed selector without crashing.** Pass `["!invalid$$"]`. Assert
   result is `{"!invalid$$": False}` (no exception raised).

4. **Drift detected when coverage < 0.8.** Mock `check_selectors` to return 3 matches out of 5
   selectors (coverage = 0.6). Assert `drift_detected = True`, Sentry called once, Redpanda emit
   called once.

5. **No drift when coverage ≥ 0.8.** Mock 4 matches out of 5 (coverage = 0.8). Assert
   `drift_detected = False`, Sentry NOT called, Redpanda NOT emitted.

6. **Page fetch failure writes error row without Sentry drift alert.** Mock `httpx.get()` to raise
   `httpx.TimeoutException`. Assert `schema_validation_history` row written with
   `error = "fetch_failed: timeout"` and `drift_detected = False`. Assert Sentry capture_message NOT
   called.

7. **Sentry deduplication.** Insert a `schema_validation_history` row with `drift_detected = true`
   and `run_at = now() - 12h`. Run the cron for the same tenant with drift detected again. Assert
   Sentry NOT called a second time (deduplication within 24h window).

## Branch naming

`data-engineer/TICKET-VAL-001-continuous-schema-validation`

## PR title format

`feat(data-quality,db): continuous schema validation cron — drift detection + history table [TICKET-VAL-001]`

## Definition of done

- PR opened, all local checks green.
- `gh pr checks <pr-number> --watch` returns all SUCCESS.
- `modal deploy apps/data-quality/src/crons/schema_validation.py` succeeds in CI (or is verified
  manually and noted in the PR description if Modal deploy is not wired into CI for Sprint 9).
- `backlog/FOLLOW_UPS.md` updated with TICKET-VAL-002 stub.
- TICKET-035 in QUEUE.md marked as SUPERSEDED by TICKET-VAL-001.
- PM-orchestrator validates AC items 1–10 above.
- PM-orchestrator comments `PM-validated. CI green. Ready for human review and merge.`
- Ticket moved to `READY_FOR_REVIEW` in QUEUE.md.
