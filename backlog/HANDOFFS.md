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

## TICKET-DESC-001 (ML) → backend integration

**From:** ml-engineer **To:** backend-engineer **Date:** 2026-05-15T00:00:00Z

**Summary:** Modal async job at `apps/llm-gateway/src/jobs/generate_description.py`. Subscribes
to `estalara.descriptions` Redpanda topic via `consume_description_requests()` (30s poll). Calls
Anthropic Sonnet 4.6 in Python directly (NOT via `callLlmGateway()` TypeScript). Writes JSON
`{"text": "...", "generated_at": "<ISO>"}` to Upstash Redis at key
`desc:{tenant_id}:{listing_id}:{archetype}:{locale}`. TTL: 259200s (Tier 2), 172800s (Tier 3).
On Sonnet error or empty response, Redis is not written — next HTTP request retries. Idempotent.

**Action required:** `GET /api/adapt/description` endpoint should:

1. Read from Redis at `desc:{tenant_id}:{listing_id}:{archetype}:{locale}`.
2. Cache hit: parse JSON, return `source: "ai_cached"`, `description: value.text`,
   `generated_at: value.generated_at`.
3. Cache miss (Tier 2/3): return `copy_template.en` as `source: "template_fallback"`, then
   fire-and-forget publish to `estalara.descriptions` with fields from AC item 4.
4. `source: "ai_generated"` is NOT valid — use only `"template_fallback"` and `"ai_cached"`.

**Files:**

- `apps/llm-gateway/src/jobs/generate_description.py` — Modal job (PR #112)
- `apps/llm-gateway/src/jobs/test_generate_description.py` — pytest tests (14 cases)
- `apps/llm-gateway/pyproject.toml` — deps: anthropic, httpx, modal, confluent-kafka, sentry-sdk

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

## TICKET-020 → TICKET-021, TICKET-022, TICKET-023, TICKET-029

**From:** backend-engineer **To:** backend-engineer **Date:** 2026-05-03T00:00:00Z

**Summary:** Drizzle ORM set up in `packages/db`. `createClient()` exported from
`packages/db/src/client.ts`, supporting both direct (transaction mode, port 5432) and pooled
(session mode, port 6543) connections. `drizzle.config.ts` ready for `drizzle-kit` commands.
`migrations/` folder exists (`.gitkeep`). Root `package.json` wired with `db:generate`,
`db:migrate`, `db:studio`, `db:push:dev` scripts. All downstream tickets (021/022/023/029) can now
add schema files to `packages/db/src/schema/`, re-export from the barrel `index.ts`, and run
`pnpm db:generate` + `pnpm db:migrate`.

**Action required:**

For TICKET-021 and downstream:

1. Add a schema file at `packages/db/src/schema/<table-name>.ts` using `pgTable` from
   `drizzle-orm/pg-core`.
2. Re-export from `packages/db/src/schema/index.ts`.
3. Run `pnpm db:generate` to generate the SQL migration file.
4. Add RLS policies to the generated migration file before applying.
5. Run `pnpm db:migrate` to apply (requires `DATABASE_URL_DIRECT` env var).

**Files:**

- `packages/db/src/client.ts`
- `packages/db/src/index.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle.config.ts`
- `packages/db/scripts/migrate.ts`
- `packages/db/scripts/seed.ts`
- `packages/db/migrations/.gitkeep`
- `packages/db/README.md`

---

## Sprint 7 Phase 1 — Architect review

**From:** pm-orchestrator (architect role) **To:** backend-engineer (TICKET-ADP-001), sdk-engineer
(TICKET-ADP-003) **Date:** 2026-05-11T00:00:00Z **Summary:** Pre-implementation findings for Sprint
7 Phase 1. No blockers found.

### Finding 1 — Canonical ArchetypeId source

`Archetype` type is defined in `packages/sdk/src/core/intent.ts` (18 values + 'neutral' fallback).
In `packages/shared/src/directives.ts`, the `ArchetypeId` type MUST be declared as an inline union
(copy the 18 + 1 values verbatim). Do NOT import from `packages/sdk` — that would create a circular
workspace dependency (`shared` → `sdk` while `sdk` already depends on `shared` implicitly through
the event types). Keeping `ArchetypeId` inline in `directives.ts` is the correct pattern.

### Finding 2 — ClickHouse migration location

Confirmed: `infra/clickhouse/migrations/`. Existing files are `0001_create_events.sql` and
`0002_create_session_summary_mv.sql`. New file must be `0003_create_adaptation_decisions.sql`. The
migration runner substitutes `MergeTree` for `ReplicatedMergeTree` in CI (see comment in
0001_create_events.sql). Use `MergeTree()` in the new migration.

### Finding 3 — errorBody canonical helper

Confirmed: `errorBody()` in `packages/shared/src/errors.ts` is the canonical helper. Import it as:
`import { errorBody, ErrorCode } from '@estalara/shared'`.

### Finding 4 — GET /api/adapt does not exist yet

The route at `apps/control-plane/src/app/api/adapt/route.ts` does NOT exist. TICKET-042 wired the
SDK to call `/api/adapt` but the route was never created (the stub referenced in the briefing was
from PR #42 which created a different stub). Backend-engineer must create the directory and file
from scratch.

### Finding 5 — control-plane cannot import @estalara/sdk currently

`apps/control-plane/package.json` does NOT include `@estalara/sdk` as a dependency. The playbooks
module (to be built in ADP-003) lives in `packages/sdk/src/core/playbooks/`. Resolution:

- For ADP-001: backend-engineer creates a minimal LOCAL stub for `getPlaybook()` inside
  `apps/control-plane/` (co-located with the route file). This avoids the dependency issue entirely.
- For ADP-003: sdk-engineer builds the real playbooks in `packages/sdk/src/core/playbooks/` AND adds
  `@estalara/sdk` as a workspace dependency to `apps/control-plane/package.json`, then updates the
  control-plane route to import from `@estalara/sdk` using a deep import path
  `@estalara/sdk/playbooks` (add this to SDK `exports` in `package.json`), OR the sdk-engineer moves
  the stub replacement inline. The preferred approach: add the `playbooks` subpath export to
  `packages/sdk/package.json` so control-plane can do
  `import { getPlaybook } from '@estalara/sdk/playbooks'`.

### Finding 6 — No conflicts with existing code

- `packages/shared/src/directives.ts` is a new file — no conflicts.
- `infra/clickhouse/migrations/0003_*` is new — no conflicts.
- `apps/control-plane/src/app/api/adapt/route.ts` is new (directory does not exist) — no conflicts.
- `packages/sdk/src/core/playbooks/` is new — no conflicts (adapt.ts uses
  `fetchDirectives`/`applyDirectives` which remain untouched).

### No blockers. Backend-engineer may proceed with TICKET-ADP-001.

---

## TICKET-ADP-001 → TICKET-ADP-003

**From:** backend-engineer **To:** sdk-engineer **Date:** 2026-05-11T20:36:18Z **Summary:** ADP-001
merged via PR #67. Decision API is live at `GET /api/adapt` with the full 4-branch decision tree.
New types are in `packages/shared/src/directives.ts` (exported from `@estalara/shared`). A stub
`getPlaybook()` exists in `packages/sdk/src/core/playbooks/index.ts` that returns empty playbooks —
ADP-003 replaces this with the real 18-archetype registry. The control-plane route imports from a
local `playbook-stub.ts` co-located in the adapt directory — ADP-003 replaces that import with the
real SDK playbooks.

**Action required for sdk-engineer (ADP-003):**

1. Build all 18 playbook files in `packages/sdk/src/core/playbooks/archetypes/` per the spec in
   `backlog/sprint-7/TICKET-ADP-003.md`.
2. Replace `packages/sdk/src/core/playbooks/index.ts` stub with the real `PlaybookRegistry`
   exporting `getPlaybook()` and `getAllPlaybooks()`.
3. Replace `packages/sdk/src/core/playbooks/types.ts` (does not exist yet — create it) with the
   `PlaybookEntry`, `SlotDirective`, `ListingClassRule` types.
4. For the control-plane integration:
   - Add `"@estalara/sdk": "workspace:*"` to `apps/control-plane/package.json` dependencies.
   - Add a `"./playbooks"` subpath export to `packages/sdk/package.json` exports pointing to the
     built playbooks index:
     `"./playbooks": { "import": "./dist/core/playbooks/index.js", "types": "./dist/core/playbooks/index.d.ts" }`.
   - Ensure `packages/sdk/tsup.config.ts` (or tsup configuration) includes
     `src/core/playbooks/index.ts` as a separate entry so it gets compiled.
   - Update `apps/control-plane/src/app/api/adapt/route.ts` to replace:
     `import { getPlaybook } from './playbook-stub';` with:
     `import { getPlaybook } from '@estalara/sdk/playbooks';`
   - Delete `apps/control-plane/src/app/api/adapt/playbook-stub.ts` (it's a stub).
5. Run `pnpm install` after adding the workspace dependency.
6. Write integration tests verifying the Decision API + real playbooks produce correct directives
   for yield_hunter (confidence=0.75, similarity=0.90), family_buyer (confidence=0.80,
   similarity=0.88), lifestyle_expat (confidence=0.70, similarity=0.95).

**Files produced by ADP-001:**

- `packages/shared/src/directives.ts` — `ArchetypeId`, `TextDirective`, `ClassDirective`,
  `AdaptationDirectives` interfaces
- `packages/shared/src/index.ts` — added `directives.js` re-export
- `packages/sdk/src/core/playbooks/index.ts` — STUB to be replaced by ADP-003
- `apps/control-plane/src/app/api/adapt/route.ts` — real GET /api/adapt handler
- `apps/control-plane/src/app/api/adapt/playbook-stub.ts` — temporary stub, DELETE in ADP-003
- `apps/control-plane/src/app/api/adapt/route.test.ts` — 25 tests
- `infra/clickhouse/migrations/0003_create_adaptation_decisions.sql` — analytics table DDL

---

## Sprint 7 Phase 2 — Architect review

**From:** pm-orchestrator (architect role) **To:** sdk-engineer (ADP-004), backend-engineer
(ADP-002), data-engineer (DQS-001) **Date:** 2026-05-11T06:00:00Z **Summary:** Pre-implementation
findings for Sprint 7 Phase 2.

### Finding A1 — adapt.ts local Directive type is misaligned with shared directives.ts

`packages/sdk/src/core/adapt.ts` defines a LOCAL `Directive` interface (lines 13-18) with:

- `slot: string`
- `type: 'text' | 'order' | 'visibility' | 'class'`
- `value: string | string[]`

`packages/shared/src/directives.ts` defines `TextDirective` and `ClassDirective` which are
structurally different:

- `TextDirective` has `slot`, `value` (string), `archetype`, `confidence`
- `ClassDirective` has `selector` (NOT `slot`), `add[]`, `remove[]`, `archetype`, `confidence`

The current `applyDirectives()` in adapt.ts operates on local `Directive[]` and handles
ClassDirective via `directive.slot` (wrong) and `directive.value as string[]` (wrong). ADP-004 must
replace the function signature to accept `(TextDirective | ClassDirective)[]` (imported from
`@estalara/shared`) and implement correct logic per each type. The local `Directive` interface
should be removed or kept only for legacy internal use with a deprecation comment.

### Finding A2 — AdaptResponse in adapt.ts uses local Directive, not AdaptationDirectives from shared

`fetchDirectives()` returns `AdaptResponse` which has `directives: Directive[]`. After ADP-004's
work, `fetchDirectives()` should return the shared `AdaptationDirectives` type (or the response
should be unwrapped to pass `directives: (TextDirective | ClassDirective)[]` to
`applyDirectives()`). The safest path: keep `fetchDirectives()` returning a local response type with
the correct directive union, and have `applyDirectives()` accept
`(TextDirective | ClassDirective)[]`. This avoids renaming the entire response type. Confirm the
Decision API now returns `AdaptationDirectives` shape per ADP-001 — the SDK `fetchDirectives()` must
accept that response shape.

### Finding A3 — Event queue for adapt.applied/adapt.skipped events

`packages/sdk/src/core/events.ts` exposes `CollectedEvent` type and `dispatchEvents()` function. The
module-level event collection works via a queue flushed on 5s interval in
`packages/sdk/src/index.ts`. ADP-004 needs to push `adapt.applied` and `adapt.skipped` events into
this same queue. sdk-engineer must import the event queue from `packages/sdk/src/index.ts` (or
expose a `queueEvent()` helper in events.ts) to push into the flush cycle. Do NOT create a separate
flush timer.

### Finding A4 — Idempotency Set must survive session resets

The idempotency `Set<string>` used to track applied directive fingerprints must be reset when
`getOrCreateSession()` returns a fresh session (i.e., `sessionStorage` has no stored session or a
new tab is opened). sdk-engineer should either: (a) tie the Set lifetime to the session by exporting
a `resetAdaptState()` function from adapt.ts that clears the Set, called from session initialization
in `src/index.ts`, OR (b) key the fingerprint Set on session_id so it auto-invalidates across
sessions.

### Finding A5 — DOM ready guard interacts with DOMContentLoaded listener leak

The DOM-ready guard (queue directives if `document.readyState === 'loading'`) must use a one-time
event listener (`{ once: true }` option on addEventListener) to avoid accumulating listeners across
multiple `applyDirectives()` calls before DOM is ready.

### Finding A6 — DQS-001 session integration point

`packages/sdk/src/index.ts` wires the session, event queue, and observer together. DqsTracker from
DQS-001 should be instantiated once in `src/index.ts` (not in dqs.ts itself). The 5th-event trigger
should hook into the event dispatch path — data-engineer should add a counter in the existing event
queue flush logic rather than adding a second observer. Concrete integration: add
`onEventDispatched?: (count: number) => void` callback to the `SdkConfig` or expose a module-level
counter in events.ts.

### Finding A7 — commitlint DQS- prefix missing

`commitlint.config.cjs` at line 104 has regex:
`/\[TICKET-(?:FIX-|INFRA-|DEMO-|ADM-|QUIZ-|DB-|EMB-|ARCH-|ADP-)?\d+\]|\[ESCALATION\]/` DQS- prefix
is NOT present. DQS-001 FIRST commit must add `DQS-` to this regex. If this is not done first, ALL
DQS-001 commits will fail CI commitlint check.

### Finding A8 — ADP-002 ClickHouse cost-cap query

ADP-002 needs to query ClickHouse rolling 24h `cost_usd` sum for the circuit breaker. The existing
ClickHouse client pattern is in `apps/ingest/` or `infra/clickhouse/`. Check how TICKET-014/015
wired the ClickHouse HTTP client — backend-engineer should reuse the same pattern rather than
introducing a new HTTP client library.

### No blockers. sdk-engineer may proceed with ADP-004. ADP-002 and DQS-001 wait for ADP-004 merge.

---

## TICKET-ADP-003 → TICKET-ADP-004, TICKET-ADP-002, TICKET-DQS-001

**From:** sdk-engineer (ADP-003) **To:** sdk-engineer (ADP-004), backend-engineer (ADP-002),
data-engineer (DQS-001) **Date:** 2026-05-11T22:00:00Z **Summary:** ADP-003 merged via PR #68
(commit ecf5d4b). 18 archetype playbooks are live in `packages/sdk/src/core/playbooks/archetypes/`.
The `./playbooks` subpath export is wired in `packages/sdk/package.json` and tsup.config.ts. The
control-plane Decision API now imports from `@estalara/sdk/playbooks` (stub deleted).

**Action required for ADP-004 (sdk-engineer):**

- `applyDirectives()` at `packages/sdk/src/core/adapt.ts:70` has incomplete implementation with
  wrong ClassDirective handling (see Architect Finding A1). Full spec in ticket brief.
- Archetype playbook slot values are in e.g. `yield-hunter.ts` under `slots[]` — use these as the
  expected test values in E2E assertions.

**Action required for ADP-002 (backend-engineer):**

- `PlaybookEntry` type is exported from `@estalara/sdk/playbooks`. Import it for the
  `LlmGatewayInput.basePlaybook` type.
- The Decision API route at `apps/control-plane/src/app/api/adapt/route.ts` is the wiring point.

**Action required for DQS-001 (data-engineer):**

- Read `packages/sdk/src/core/events.ts` for the event queue integration point.
- The ArchetypeId type lives in `packages/shared/src/directives.ts` — import from there, not sdk.

**Files produced by ADP-003:**

- `packages/sdk/src/core/playbooks/archetypes/*.ts` — 18 archetype playbook files
- `packages/sdk/src/core/playbooks/index.ts` — PlaybookRegistry with getPlaybook(),
  getAllPlaybooks()
- `packages/sdk/src/core/playbooks/types.ts` — PlaybookEntry, SlotDirective, ListingClassRule types
- `packages/sdk/tsup.config.ts` — playbooks subpath entry added
- `packages/sdk/package.json` — ./playbooks subpath export added
- `apps/control-plane/src/app/api/adapt/route.ts` — updated to import from @estalara/sdk/playbooks

---

## TICKET-AB-006, TICKET-AB-007 → FOLLOW-009, FOLLOW-014, TICKET-AB-004 (panels 1+3)

**From:** data-engineer **To:** backend-engineer (FOLLOW-014), data-engineer (FOLLOW-009) **Date:**
2026-05-14T21:00:00Z **PR:** #107

**Summary:**

TICKET-AB-006 seeds `ab_bandit_weights` with 18 rows × `variant='default'` × `Beta(1,1)` per tenant.
Migration `0007_seed_ab_bandit_weights.sql` backfills existing tenants. New `POST /api/tenants`
route seeds new tenants at creation time via `seedBanditWeightsForTenant()` in
`apps/control-plane/src/lib/bandit-seed.ts`.

TICKET-AB-007 wires `holdout_group` into every `adaptation_decisions` ClickHouse INSERT.
`logDecisionAsync()` in `apps/control-plane/src/app/api/adapt/route.ts` now accepts a `holdoutGroup`
parameter (default `false`). GET accepts `?holdout_group=true|false`; POST body accepts
`holdout_group: boolean`. The column was added by TICKET-AB-001 migration
`0006_adaptation_decisions_holdout.sql` but was never populated — this PR fixes that.

**Action required:**

- **FOLLOW-014** (backend-engineer): Replace mock `GET /api/ab/weights` with real Drizzle SELECT
  from `abBanditWeights`. The seed rows are now present so the query will return data. See
  `apps/control-plane/src/app/api/ab/weights/route.ts`.

- **FOLLOW-009** (data-engineer): Build the regression-detection cron
  `apps/data-quality/src/crons/ab_regression_detection.py`. Can now query
  `SELECT holdout_group, COUNT(*) FROM adaptation_decisions` and get meaningful results.

- **AB-004 dashboard** (backend-engineer): Panel 1 (Adapted vs Holdout) and Panel 3 (Conversion lift
  vs holdout) will now read real data once live traffic flows. Verify in staging.

**Files produced:**

- `packages/db/migrations/0007_seed_ab_bandit_weights.sql`
- `apps/control-plane/src/lib/bandit-seed.ts` — `seedBanditWeightsForTenant(tenantId)`
- `apps/control-plane/src/app/api/tenants/route.ts` — `POST /api/tenants` with seed hook
- `apps/control-plane/src/app/api/adapt/route.ts` — `logDecisionAsync()` + GET/POST changes

---

## TICKET-AB-005 → TICKET-AB-012 (FOLLOW-017)

**From:** backend-engineer **To:** backend-engineer **Date:** 2026-05-14T20:45:00Z

**Summary:** ab.assignment event emission wired into the decision-api adapt route. The producer
helper lives at `apps/decision-api/src/lib/ab-events.ts` (`publishAbAssignmentEvent`), which
delegates to the new `apps/decision-api/src/lib/redpanda-producer.ts` (mirrors the ingest worker
producer). The call in `route.ts` is fire-and-forget (void IIFE + try/catch + Sentry tag
`ab_assignment_emit_failed`). Guarded by `env.REDPANDA_REST_URL` presence. Skipped assignments
(opted_out / unknown / none consent with consent_mode_enabled=true) never emit an event. 9 new
integration tests verify call-count per scenario and payload schema conformance.

**Action required for FOLLOW-017 (holdout gating on control-plane POST /api/adapt):**

Import and reuse `publishAbAssignmentEvent` from `apps/decision-api/src/lib/ab-events.ts`. Do NOT
duplicate the envelope construction logic. The function accepts `AbAssignmentEventArgs` which
includes the Redpanda env bindings and optional `PushOptions` for test mocking.

**Files:**

- `apps/decision-api/src/app/api/adapt/route.ts` — emission wired at step 4b
- `apps/decision-api/src/lib/ab-events.ts` — `publishAbAssignmentEvent` helper (new file)
- `apps/decision-api/src/lib/redpanda-producer.ts` — edge-compatible producer (new file)
- `apps/decision-api/src/index.ts` — Env interface extended with Redpanda bindings
- `apps/decision-api/src/__tests__/adapt.test.ts` — 9 new TICKET-AB-005 integration tests

---

## TICKET-AB-008, TICKET-AB-009 → FOLLOW-017 (holdout gating on control-plane POST)

**From:** backend-engineer **To:** backend-engineer **Date:** 2026-05-14T23:10:00Z

**Summary:** AB-008 replaced mock `/api/ab/weights` with real Drizzle SELECT from
`ab_bandit_weights`. Auth via `getAuthClaims()` JWT — `tenant_id` from verified claim
(TICKET-FIX-014 compliant). Optional `?archetype=` filter supported. Mock helpers deleted. AB-009
wired `ReorderDirective` into the `decision-api` Worker adapt route. Canonical helpers live at
`apps/decision-api/src/lib/reorder.ts` (`getTenantSchema`, `buildReorderDirective`). The
control-plane adapt route duplicates the helpers with a comment pointing to the canonical source
(cross-app TS imports not supported). `listing_ids` Zod schema is now identical in both routes:
`z.array(z.string().max(64)).max(100).optional()`. Holdout sessions always receive
`reorderDirectives: []`. Demo tenant (`est_demo_tenant`) backward compat preserved. 17 new tests in
`adapt.test.ts`.

**Action for FOLLOW-017:** Import `assignHoldout()` + `publishAbAssignmentEvent()` into
`apps/control-plane/src/app/api/adapt/route.ts` POST handler to add holdout gating (currently only
present in decision-api Worker). `reorder.ts` helpers are already importable from
`apps/decision-api/src/lib/reorder.ts`.

**Files:**

- `apps/decision-api/src/lib/reorder.ts` — NEW canonical module: `getTenantSchema`,
  `buildReorderDirective`
- `apps/decision-api/src/app/api/adapt/route.ts` — imports reorder.ts, emits ReorderDirective
- `apps/decision-api/src/__tests__/adapt.test.ts` — 17 new TICKET-AB-009 integration tests
- `apps/control-plane/src/app/api/ab/weights/route.ts` — real Drizzle reads, JWT auth
- `apps/control-plane/src/app/api/ab/weights/route.test.ts` — full rewrite with mocked DB
- `apps/control-plane/src/app/api/adapt/route.ts` — duplicate reorder helpers, eslint-disable banner

---

## TICKET-AB-010, TICKET-AB-011 → TICKET-NATIVE-001

**From:** backend-engineer **To:** sdk-engineer (NATIVE-001) **Date:** 2026-05-14T23:45:00Z

**Summary:** AB-010 added holdout gating to the control-plane `POST /api/adapt` handler.
`assignHoldout()` now runs at handler entry — consent-skipped sessions return empty directives
without `holdout_group`; holdout sessions return empty directives with `holdout_group: true`;
treatment sessions build directives as before. AB-011 replaced the `est_demo_tenant` hardcode in
`getTenantSchema()` with real DB lookup (`tenant_site_schemas` via Drizzle) + 5-min Upstash Redis
cache (`schema:{tenantId}`). Decision-api uses Redis HTTP + new internal endpoint
`GET /api/internal/schema?tenant_id=<id>` as DB fallback. Control-plane and decision-api are now in
sync. TICKET-NATIVE-001 is unblocked.

**Files:**

- `packages/shared/src/ab-holdout.ts` — new: assignHoldout() for cross-app use
- `apps/control-plane/src/app/api/adapt/route.ts` — holdout gate at POST entry
- `apps/control-plane/src/lib/tenant-schema.ts` — new: getTenantSchema() with DB + Redis
- `apps/control-plane/src/lib/ab-events.ts` — new: publishAbAssignmentEvent() for control-plane
- `apps/control-plane/src/app/api/internal/schema/route.ts` — new: internal schema endpoint
- `apps/decision-api/src/lib/reorder.ts` — getTenantSchema() now async, Redis + API fallback
- `apps/decision-api/src/index.ts` — added UPSTASH_REDIS_URL, SCHEMA_API_URL, SCHEMA_API_TOKEN

---
