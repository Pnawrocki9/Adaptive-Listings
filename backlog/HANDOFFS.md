# Handoffs

When one agent's ticket produces output another agent needs, the producing agent appends a handoff
note here. The PM reads this file before delegating downstream tickets.

## Format

```markdown
## TICKET-XXX → TICKET-YYY

**From:** <producing agent> **To:** <consuming agent> **Date:** <ISO timestamp> **Summary:** One
paragraph: what was produced, where it lives, key details. **Action required:** What the consuming
agent needs to do with it. **Files:** <list of relevant files / artifacts>
```

---

## TICKET-011 → TICKET-012, TICKET-014

**From:** architect  
**To:** backend-engineer (TICKET-012), data-engineer (TICKET-014)  
**Date:** 2026-04-30T22:00:00Z

**Summary:**

Event schemas v1 implemented in `@estalara/shared` per ADR-0003 and Master Design C.1. Common
envelope (`EventEnvelopeSchema`) plus 33 per-type event schemas across all 10 categories, assembled
into a discriminated union (`EventSchema`). 74 vitest cases covering parse success, missing-required
failures, enum / range / length boundaries, and discriminator routing. zod ^3.23.8 added as a
runtime dep on `@estalara/shared`. Re-exported from the package root, so any consumer can
`import { EventSchema, EVENT_TYPES } from '@estalara/shared'`.

**Action required:**

For TICKET-012 (backend-engineer, Cloudflare Worker ingest):

1. `import { EventSchema } from '@estalara/shared'` in the worker
2. Validate every incoming POST body with `EventSchema.safeParse(...)` before publishing to Redpanda
3. Strict envelope: reject on parse failure with HTTP 400 + zod issue list
4. Lenient payload: don't add per-type guard rails beyond what `EventSchema` enforces (additive
   evolution per ADR-0003)
5. Tag failed parses with structured logs (use `packages/shared/observability` logger) so we can
   detect SDK-side regressions

For TICKET-014 (data-engineer, ClickHouse table DDL):

1. The canonical `events` table stores `payload` as ZSTD-compressed JSON String per ADR-0003
2. Mirror the envelope columns 1:1 (event_id UUID, tenant_id UUID, session_id String, ts DateTime64,
   region LowCardinality(String), consent_state LowCardinality(String), schema_version UInt8, type
   LowCardinality(String), payload String, listing_id Nullable(String), archetype_hint
   Nullable(String))
3. Build per-type materialized views projecting payload JSON keys into typed columns (one view per
   high-traffic event type — start with `page.view`, `chat.message.sent`, `inquiry.completed`)
4. Use `EVENT_TYPES` from `@estalara/shared` as the source of truth when generating DDL or fixtures

**Files:**

- `packages/shared/src/schemas/event.ts` (envelope)
- `packages/shared/src/schemas/events/*.ts` (10 category files)
- `packages/shared/src/schemas/events/index.ts` (`EventSchema` discriminated union, `EVENT_TYPES`
  tuple)
- `packages/shared/src/schemas/index.ts` (public re-export)
- `packages/shared/src/index.ts` (top-level re-export)
- `docs/adr/0003-event-schema-and-versioning.md` (spec)
- `docs/MASTER_DESIGN.md` (section C.1 — event taxonomy)

---

## TICKET-012 → TICKET-013, TICKET-015, TICKET-016, TICKET-018, TICKET-019

**From:** backend-engineer  
**To:** backend-engineer (TICKET-013), data-engineer (TICKET-015), qa-engineer (TICKET-016),
devops-engineer (TICKET-018), backend-engineer (TICKET-019)  
**Date:** 2026-05-01T00:00:00Z

**Summary:**

Cloudflare Worker ingest MVP shipped in `apps/ingest/`. Hono-based, p95 < 50 ms target.
`POST /v1/events` validates batches against `EventSchema` from `@estalara/shared`, authenticates via
`X-Estalara-API-Key` (KV lookup of `api_key:<token>` → `{tenant_id, scopes, hmac_secret?}`) with
optional `X-Estalara-Signature: hmac-sha256:<hex>` for server-side adapters, enriches each event
with server-side `tenant_id`, `region` (from `CF-IPCountry`), `ingest_received_at`, and pushes to
Redpanda via the HTTP REST proxy (Pandaproxy) with 3-attempt exponential backoff (100ms, 500ms,
2500ms). 47 vitest cases covering auth (missing/unknown/kv-error/HMAC paths), body shape (400/413),
happy path with rejection reporting, and Redpanda 5xx/4xx/network failure.

**Action required:**

For TICKET-013 (backend-engineer, Durable Object rate limiting):

1. Add a `RateLimiter` Durable Object. The DO binding `RATE_LIMITER` is already declared in
   `apps/ingest/wrangler.toml` (placeholder — `class_name` matches).
2. Wire the limiter into `events.post('/')` after auth, before parse — ID by `tenant_id` to keep the
   buckets per-tenant. Suggested: 100 req/min per tenant on Tier 1, configurable later.
3. On rate-limit hit, return 429 with `Retry-After`. Don't read body; rate-limit decisions must
   happen before JSON.parse to keep abusive-traffic cost low.

For TICKET-015 (data-engineer, Modal stream consumer):

1. Subscribe to topic `events` (or `events-staging`) on Redpanda. Records are JSON-encoded events
   with the envelope plus server-side fields (`tenant_id`, `region`, `ingest_received_at`).
2. Validate each record again with `EventSchema` (defense-in-depth — should be a no-op in steady
   state), then batch-insert to ClickHouse.

For TICKET-016 (qa-engineer, ingest smoke test):

1. End-to-end smoke: `wrangler dev` + curl with a real test API key seeded into KV. Verify 200 shape
   (`accepted`, `rejected`, `batch_id`).
2. Negative path: missing key → 401, malformed event → 200 with rejection reported.

For TICKET-018 (devops-engineer, observability):

1. The Worker already wraps with `withSentry` (`apps/ingest/src/observability.ts`). Add structured
   span instrumentation around: auth lookup, Zod parse, Redpanda push (3 separate spans).
2. Tag spans with `tenant_id` (after auth), batch size, accepted/rejected counts.

For TICKET-019 (backend-engineer, idempotency):

1. Use `event.event_id` (UUIDv7) as idempotency key. Suggested: 24h Redis TTL via Upstash binding.
2. Dedup decisions happen post-validate, pre-push. Skip duplicates silently from `accepted` count.

**Files:**

- `apps/ingest/src/index.ts` (Hono entry-point + `withSentry` wrapping)
- `apps/ingest/src/router.ts` (Hono routes: `/health`, `/v1/events`, 404, 500)
- `apps/ingest/src/handlers/events.ts` (`POST /v1/events` logic)
- `apps/ingest/src/auth.ts` (`authenticateRequest`, `computeHmacSha256Hex` helper)
- `apps/ingest/src/redpanda-producer.ts` (REST proxy producer with retry + abort)
- `apps/ingest/src/region.ts` (CF-IPCountry → region mapper)
- `apps/ingest/src/types.ts` (`Env` shared bindings)
- `apps/ingest/wrangler.toml` (`KV_API_KEYS` binding placeholder, REDPANDA env vars per env)
- ADR-0003 (`docs/adr/0003-event-schema-and-versioning.md`)
- Master Design C.2 (ingestion strategy), I.2 (backend stack)

---

## TICKET-009 → TICKET-014 (ClickHouse)

**From:** devops-engineer  
**To:** data-engineer  
**Date:** 2026-04-27T14:00:00Z

**Summary:**

ClickHouse Cloud Terraform module skeleton created at `infra/terraform/clickhouse/`. The module
includes provider configuration, variables for organization ID and API credentials, and
commented-out resource definitions for ClickHouse service and password. The README documents cost
estimation (~$750-$1,000/month for EU region at MVP scale), architecture decisions (columnar storage
for append-only events), and performance budgets (<50ms write latency, <500ms query latency).

**Action required:**

1. Wait for human to create ClickHouse Cloud account and store credentials in Doppler (see
   ESCALATIONS.md)
2. Uncomment `resource "clickhouse_service"` and `resource "clickhouse_service_password"` in
   `main.tf`
3. Run `terraform apply` to provision EU region service
4. Use service endpoint and password to create first ClickHouse table (events table, partitioned by
   `tenant_id` + `date`)
5. Document table DDL and migration strategy in TICKET-014

**Files:**

- `infra/terraform/clickhouse/main.tf`
- `infra/terraform/clickhouse/variables.tf`
- `infra/terraform/clickhouse/README.md`
- `docs/runbooks/vendor-accounts.md` (section 2: ClickHouse Cloud)

---

## TICKET-009 → TICKET-015 (Modal)

**From:** devops-engineer  
**To:** data-engineer  
**Date:** 2026-04-27T14:00:00Z

**Summary:**

Modal does NOT have a Terraform provider (code-as-config via Python decorators instead). Created
`infra/terraform/modal/modal-config/` with `modal.toml` skeleton, `modal_setup.py` verification
script, and comprehensive README documenting Modal architecture, cost estimation (~$765/month for
MVP), and deployment strategy (`modal deploy` per-app in CI). Modal is used for stream consumer
(Redpanda → ClickHouse ETL), intent engine, adaptation engine, and auto-detection service.

**Action required:**

1. Wait for human to create Modal account, generate token (ID + secret), and store in Doppler
2. Authenticate Modal CLI locally:
   `modal token set --token-id $MODAL_TOKEN_ID --token-secret $MODAL_TOKEN_SECRET`
3. Create Modal secrets for third-party credentials (Anthropic API, Supabase, ClickHouse) via
   `modal secret create` (documented in runbook)
4. Implement stream consumer app in `apps/<stream-consumer>/src/main.py` (subscribe to Redpanda
   `events` topic, batch insert to ClickHouse)
5. Deploy via `modal deploy apps/<app>/src/main.py`

**Files:**

- `infra/terraform/modal/modal-config/modal.toml`
- `infra/terraform/modal/modal-config/modal_setup.py`
- `infra/terraform/modal/README.md`
- `docs/runbooks/vendor-accounts.md` (section 3: Modal)

---

## TICKET-009 → TICKET-020 (Supabase + Drizzle)

**From:** devops-engineer  
**To:** backend-engineer  
**Date:** 2026-04-27T14:00:00Z

**Summary:**

Supabase Terraform module skeleton created at `infra/terraform/supabase/`. The module includes
provider configuration, variables for Personal Access Token (PAT), organization ID, and database
password, and commented-out resource definitions for Supabase project. The README documents
multi-region architecture (EU/US/UK/UAE), cost estimation (~$100/month base for 4 regions), and
security notes (RLS policies required per-tenant, pgBouncer for connection pooling with 25
connections per region per service).

**Action required:**

1. Wait for human to create Supabase account, generate PAT, find org ID, and store all in Doppler
2. Uncomment `resource "supabase_project"` in `main.tf`
3. Run `terraform apply` to provision EU region project (Pro tier, $25/month)
4. Set up Drizzle ORM (`packages/db` or `apps/control-plane/db/`) with connection to Supabase
   Postgres
5. Create first migration: `tenants` table with RLS policies (see TICKET-021)
6. Document migration workflow (Drizzle vs. Supabase migrations UI vs. raw SQL)

**Files:**

- `infra/terraform/supabase/main.tf`
- `infra/terraform/supabase/variables.tf`
- `infra/terraform/supabase/README.md`
- `docs/runbooks/vendor-accounts.md` (section 1: Supabase)

---

## TICKET-003 → TICKET-018

**From:** devops-engineer  
**To:** devops-engineer  
**Date:** 2026-04-27  
**Summary:** Sentry + OTel baseline in packages/shared/src/observability/. Ingest wrapper at
apps/ingest/src/observability.ts. DSN env vars: SENTRY_DSN_INGEST (ingest), SENTRY_DSN_CONTROL_PLANE
(control-plane). OTel collector skeleton at infra/observability/otel-collector.yaml.  
**Action required:** TICKET-018 should add real span instrumentation to the ingest handler using
createTracer() and createLogger() from packages/shared/src/observability.  
**Files:**

- `packages/shared/src/observability/logger.ts`
- `packages/shared/src/observability/tracer.ts`
- `packages/shared/src/observability/error.ts`
- `packages/shared/src/observability/index.ts`
- `apps/ingest/src/observability.ts`
- `apps/control-plane/sentry.client.config.ts`
- `apps/control-plane/sentry.server.config.ts`
- `apps/control-plane/sentry.edge.config.ts`
- `infra/observability/otel-collector.yaml`
- `docs/runbooks/observability.md`

---

## TICKET-005 → TICKET-007, TICKET-033

**From:** devops-engineer  
**To:** backend-engineer (TICKET-007), ml-engineer (TICKET-033)  
**Date:** 2026-04-29

**Summary:**

`apps/auto-detect/` Python placeholder app created following the same pattern as
`apps/intent-engine/`. The app includes pyproject.toml with setuptools.build_meta build backend,
src/main.py with `is_ready()` function, tests/test_smoke.py with passing pytest tests, and README.md
referencing Master Design sections B.4-B.7 (Auto-Onboarding, Schema Discovery, Continuous
Validation, Pre-Built Templates). CI workflow updated to include auto-detect in Python test matrix.

**Action required:**

For TICKET-007 (backend-engineer):

1. Add `auto_detected_schema` field to TenantConfig schema in `packages/db/src/schema.ts`
2. Field should store JSON mapping:
   `{ selectors: {...}, confidence: number, detected_at: timestamp }`
3. Document field purpose and update migration script

For TICKET-033 (ml-engineer):

1. Implement real auto-detection logic in `apps/auto-detect/src/main.py`
2. Add dependencies: puppeteer (or playwright), anthropic SDK, modal SDK
3. Implement Puppeteer screenshot capture + Claude Vision analysis
4. Add Modal serverless deployment decorator (@stub.function)
5. Create tests beyond smoke tests (mock Vision API, test selector extraction)

**Files:**

- `apps/auto-detect/README.md`
- `apps/auto-detect/pyproject.toml`
- `apps/auto-detect/src/main.py`
- `apps/auto-detect/src/__init__.py`
- `apps/auto-detect/tests/test_smoke.py`
- `.github/workflows/ci.yml` (auto-detect added to Python test matrix)

---
