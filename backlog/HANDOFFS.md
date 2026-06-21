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

## FOLLOW-102 → any downstream quiz/tenant ticket

**From:** sdk-engineer **To:** backend-engineer / data-engineer / qa-engineer **Date:**
2026-06-10T00:00:00Z

**Summary:** FOLLOW-102 ships `tenants.quiz_enabled boolean NOT NULL DEFAULT true` (migration 0025),
`PATCH /api/tenants/:id` (tenant-scoped JWT, Zod validation), the SDK gate in `showQuizTrigger()`,
and `data-quiz-enabled="false"` emission from `buildSnippet()`. The `GET /api/quiz/config` route now
also returns `quiz_enabled` and `tenant_id` so the dashboard can call PATCH without a separate
lookup.

**Action required:** Any ticket that reads or mutates quiz enablement should use
`tenants.quiz_enabled` (the dedicated boolean column) — NOT `tenants.quiz_config.enabled` (the JSONB
field which is for widget configuration only). PATCH `/api/tenants/:id` is the write path; the SDK
`data-quiz-enabled` attribute is the propagation mechanism.

**Files:**

- `packages/db/migrations/0025_tenants_quiz_enabled.sql`
- `packages/db/src/schema/tenants.ts` (`quizEnabled` field)
- `apps/control-plane/src/app/api/tenants/[id]/route.ts`
- `apps/control-plane/src/app/api/quiz/config/route.ts` (now returns `quiz_enabled` + `tenant_id`)
- `apps/control-plane/src/components/onboarding/DetectionPreview.tsx` (`buildSnippet`)
- `packages/sdk/src/core/config.ts` (`SdkConfig.quiz`, `readConfig`)
- `packages/sdk/src/index.ts` (`showQuizTrigger` gate)

---

## TICKET-041 → TICKET-GDPR-004

**From:** sdk-engineer **To:** backend-engineer **Date:** 2026-05-15T08:00:00Z

**Summary:** Consent banner ships in `packages/sdk`. `consent.granted` / `consent.denied` events are
emitted to the event queue and flushed to ingest even when consent is denied (compliance audit
trail). `getConsentState()` and `setConsentState()` are exported from `session.ts`. The consent
state key is `estalara_consent` in `localStorage`. The `ConsentGrantedEventSchema` and
`ConsentDeniedEventSchema` are registered in the shared `EventSchema` discriminated union.
TICKET-GDPR-004 (server-side consent gate) can now rely on these events flowing through ingest to
ClickHouse.

**Action required:** TICKET-GDPR-004 should gate server-side processing on `consent_state` field in
the event envelope. No SDK changes needed for that gate.

**Files:** `packages/sdk/src/ui/consent-banner.ts`, `packages/sdk/src/core/session.ts`,
`packages/shared/src/schemas/events/consent.ts`

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

## TICKET-GDPR-001 → TICKET-GDPR-002, TICKET-GDPR-003, TICKET-GDPR-004

**From:** compliance-engineer **To:** backend-engineer (GDPR-002, GDPR-004) + compliance-engineer
(GDPR-003 docs portion) **Date:** 2026-05-15T00:00:00Z

**Summary:** DPIA v1.0 produced at `docs/compliance/dpia.md`; ROPA v1.0 produced at
`docs/compliance/ropa.md`. Both cover all four operational jurisdictions (EU GDPR, UK GDPR + PECR,
CCPA/CPRA, UAE PDPL + DIFC). The authoritative retention schedule table is at the top of `ropa.md`
and uses exact Postgres and ClickHouse table names (`session_embeddings`, `consent_records`,
`adaptation_decisions`, `llm_calls`, `ab_bandit_weights`, `archetype_embeddings`, `staff_audit_log`,
`answers`). Compliance README at `docs/compliance/README.md`. Cross-module interface registry at
`docs/INTERFACES.md`. CI gate script at `scripts/check-compliance-docs.sh`. IMPORTANT: This PR
requires Piotr Nawrocki sign-off before merge; GDPR-002/003/004 must not merge before GDPR-001 is
approved by Piotr.

**Action required:**

GDPR-002 (backend-engineer — DSR endpoints):

- Use retention periods from `ropa.md` retention table (top of file) as the authoritative source for
  deletion cascade TTLs.
- The DSR endpoint spec: `POST /api/v1/dsr/:tenant_id` with `type`, `identifier`, `requester_proof`,
  `jurisdiction`.
- Deletion cascade must cover: `session_embeddings` (Postgres), `consent_records` (Postgres — retain
  record, mark as revoked), `adaptation_decisions` (ClickHouse — delete rows by session_id),
  `llm_calls` (ClickHouse), Upstash Redis (delete session key), Modal caches.
- DSR token table is `dsr_tokens`; tokens expire 30 days after resolution.
- Audit every DSR action in `staff_audit_log`.

GDPR-003 (compliance-engineer — LIA template docs):

- Produce `docs/compliance/lia-template.md` using the LI analysis framework documented in DPIA
  Section 3 (Necessity and Proportionality) and Section 3.4 (CNIL June 2025 guidance).
- The template must cover the three-part LI balancing test per ICO guidance: (1) legitimate interest
  identified, (2) necessity test, (3) balancing test.

GDPR-004 (backend-engineer — consent state propagation):

- Use the mode definitions from DPIA Section 7 (Consent Strategy) for the consent decision tree.
- Mode A = session_only (ePrivacy 5(3)(b) strictly necessary); Mode B = consented (explicit CMP
  record); Mode C = legitimate_interest (narrow use cases only).
- Add `consent_required` boolean to `tenants` table (default `true` for EU/UK/UAE regions).
- Decision API must return default non-personalized directives if `consent_state !== 'consented'`
  for tenants that have set `consent_required = true`.

**Files:**

- `docs/compliance/dpia.md` — DPIA v1.0 (10 sections, 5 risks, 4 jurisdictions)
- `docs/compliance/ropa.md` — ROPA v1.0 (12 processing activities, 11 sub-processors, authoritative
  retention table)
- `docs/compliance/README.md` — Compliance document index
- `docs/INTERFACES.md` — Cross-module interface registry (new)
- `scripts/check-compliance-docs.sh` — CI gate script (jurisdiction grep checks, retention table
  completeness, sub-processor completeness)

---

## FOLLOW-171 → sdk-engineer (and FOLLOW-172)

**From:** backend-engineer **To:** sdk-engineer **Date:** 2026-06-03T00:00:00Z

**Summary:** The feedback endpoint `POST /api/adapt/feedback` now accepts two OPTIONAL fields —
`prediction_id` and `lead_id` — in addition to the existing
`{session_id, tenant_id, archetype, variant, converted}`. When `prediction_id` is present it
persists a durable `conversion_labels` row (Postgres, RLS) joining the prediction to its outcome
(Conversion Label Loop, MASTER_DESIGN §T). The `prediction_id` MUST be the `adapt_decision_id` the
SDK received in the `/api/adapt` response body (`AdaptationDirectives.adapt_decision_id`). Omitting
it is backward-compatible: the bandit still updates; only the durable label is skipped. The coarse
`converted` boolean maps to `viewing_booked` (true) / `no_response` (false); deeper outcome classes
come from CRM ingest (FOLLOW-172), not the SDK.

**Action required:** sdk-engineer — thread the `adapt_decision_id` from the adapt response into the
feedback ping body as `prediction_id` so warm conversions produce labeled training pairs. (Until
then the column exists and the route works, but `conversion_labels` stays empty in production.)
FOLLOW-172 — the CRM webhook writes the same `conversion_labels` table with `label_source='system'`
and deep `outcome_class` values, keyed by `prediction_id`/`lead_id`.

**Files:** `apps/control-plane/src/app/api/adapt/feedback/route.ts`,
`packages/db/src/schema/conversion_labels.ts`, `packages/shared/src/schemas/conversion-label.ts`,
`packages/db/migrations/0019_conversion_labels.sql`

---

## FOLLOW-172 compliance → backend-engineer

**From:** compliance-engineer **To:** backend-engineer **Date:** 2026-06-03T00:00:00Z

**Summary:** PII-boundary contract for `POST /api/crm/outcome` (CRM deep-outcome ingest). This is
the AC2 deliverable for FOLLOW-172. The contract covers the exact permitted/denied field set, the
lead_id resolution model, authentication, retention/lawful basis, DSR cascade extension, and the
dedup/idempotency recommendation. It also records required ROPA/DPIA updates that must be completed
before this endpoint goes live with a pilot tenant.

---

### A. PII-Boundary Contract

#### A.1 Permitted request body fields (ALLOW-LIST)

The webhook body schema MUST be restricted to exactly these fields. Any field not listed is DENIED
at the Zod schema layer (use `.strict()` on the Zod object so unknown keys are rejected, not
silently stripped).

| Field           | Type                           | Notes                                                                                                                                                                                                                                                                                                                                          |
| --------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prediction_id` | string, NOT NULL, max 256      | = `adapt_decision_id` issued by Estalara. The primary join key. Non-PII by design: it is a server-minted UUID that refers to an adaptation decision, not to a person.                                                                                                                                                                          |
| `lead_id`       | string, NOT NULL, max 256      | Opaque Estalara-issued token (see §A.3). Non-reversible to a natural person from Estalara's side. NOT a CRM contact ID.                                                                                                                                                                                                                        |
| `outcome_class` | `ConversionOutcomeClass` enum  | Must validate against the canonical `ConversionOutcomeClassSchema` from `@estalara/shared`. Accepted values: `offer_made`, `contract_signed`, `purchased`, `lost`. (`viewing_booked` and `no_response` are produced by the SDK feedback ping, not by CRM ingest; the schema SHOULD reject them on this path to enforce the taxonomy boundary.) |
| `outcome_raw`   | object (jsonb-bound), optional | See §A.2.                                                                                                                                                                                                                                                                                                                                      |
| `confidence`    | number (0–1), optional         | 1.0 for hard CRM facts; lower for inferred. Defaults to 1.0 if omitted.                                                                                                                                                                                                                                                                        |
| `labeled_at`    | ISO 8601 string, optional      | CRM event timestamp; defaults to server `now()` if omitted.                                                                                                                                                                                                                                                                                    |

#### A.2 outcome_raw — safety decision

`outcome_raw` stores the normalized inbound payload (after allow-list enforcement) in the
`conversion_labels.outcome_raw jsonb` column. The schema MUST apply allow-list enforcement BEFORE
persisting: only the permitted fields above are written into `outcome_raw`. The raw HTTP request
body is NEVER persisted as-is.

Rationale: if the tenant CRM sends a richer payload (e.g. contact name, email, address alongside the
outcome), and the server persists `JSON.parse(rawBody)` directly into `outcome_raw`, PII enters the
store. The mitigation is structural: parse the body with the strict Zod schema (`.strict()`), then
persist only `parsed.data` (the validated output) in `outcome_raw`. Unknown keys are rejected at 400
before the DB write, so `outcome_raw` can only ever contain fields in §A.1.

No server-side scrubbing pass is required as a secondary step PROVIDED the schema is strictly
enforced on every code path that writes `outcome_raw`. The backend-engineer must ensure there is no
"raw body passthrough" branch.

#### A.3 lead_id resolution model — CHOSEN MODEL: Option (i) Tenant resolves tenant-side

From §T.6, two options exist:

- (i) Tenant resolves the CRM record to the Estalara `lead_id` on their side, sends only the opaque
  token.
- (ii) Tenant-supplied opaque correlation token that Estalara issued earlier.

**Compliance selects Option (i) as the required default.** Justification:

1. Estalara never holds the mapping between `lead_id` and any CRM contact record. Without that
   mapping Estalara cannot perform re-identification; the link lives exclusively in the tenant's
   system.
2. Option (ii) requires Estalara to issue and store a correlation token, which introduces a new
   processing activity (issuing and logging per-lead tokens) without a proportionate benefit over
   (i). That activity would require ROPA/DPIA extension before it could launch.
3. Option (i) is consistent with the precedent set by `inquiry.completed` (§
   `packages/shared/src/ schemas/events/inquiry.ts`): that schema never carries PII; the CRM
   integration at the tenant side is responsible for bridging from the Estalara session context to
   the CRM record.

What makes `lead_id` non-reversible from Estalara's side: Estalara stores only the opaque string
value. The tenant is the only party that holds the mapping from that value to a named person. This
is structurally the same guarantee as the HMAC session fingerprint: Estalara cannot re-identify
without the tenant's private key / CRM mapping. The tenant's DPA and onboarding compliance gate are
the enforcement mechanism for ensuring `lead_id` values sent to Estalara are truly opaque.

The tenant onboarding compliance gate (§U) MUST include a new checkbox: "lead_id values sent to POST
/api/crm/outcome are Estalara-assigned pseudonymous tokens; we do not send CRM contact IDs, email
addresses, phone numbers, or any directly identifying value in this field." This is a contractual
commitment enforced in the DPA, not a technical guarantee Estalara can verify at the boundary.

#### A.4 Explicit DENY-LIST

The following fields, if present in the request body, MUST cause a 400 rejection (via `.strict()`
Zod validation):

- Names: `name`, `full_name`, `first_name`, `last_name`, `contact_name`, `client_name`, `buyer_name`
  and any variant (snake_case, camelCase, kebab-case).
- Email addresses: `email`, `email_address`, `contact_email`, and variants.
- Phone numbers: `phone`, `phone_number`, `mobile`, `tel`, `contact_phone`, and variants.
- Physical addresses: `address`, `street`, `city`, `postcode`, `postal_code`, `zip`, `country` and
  variants.
- CRM-native contact/lead identifiers that are reversible to a person on the CRM side:
  `crm_contact_id`, `crm_lead_id`, `crm_person_id`, `hubspot_contact_id`, `salesforce_lead_id`,
  `salesforce_contact_id`, and equivalents for any named CRM vendor.
- Free-text fields likely to contain PII: `notes`, `description`, `comments`, `message`, `memo`,
  `summary` (any open-ended string field not in the allow-list above).

Note: the `notes` column in the `conversion_labels` DB schema (migration 0019) is an INTERNAL field
populated by `manual_admin` reclassification via the admin UI, not by the CRM webhook. The webhook
MUST NOT accept a `notes` field in its body.

#### A.5 prediction_id handling

`prediction_id` is non-PII. It is a server-minted UUID (`adapt_decision_id`) that refers to an
`adaptation_decisions` row. It has no meaning outside Estalara's internal join. It is safe to store
without restriction. It is the primary key for attribution and must be NOT NULL on this endpoint
(unlike the feedback ping where it is optional for backward-compat). Reject with 400 if absent.

#### A.6 Authentication

HMAC-SHA256 tenant-scoped signature, mirroring `POST /api/adapt/feedback` (FOLLOW-051 threat model,
`apps/control-plane/src/app/api/adapt/feedback/route.ts`):

- Header: `Authorization: Bearer {rawApiKey}` + `X-Estalara-Signature: {hmacSha256OfBodyHex}`
- The HMAC key is the tenant's raw API key; the HMAC data is the raw request body text.
- Constant-time comparison required (copy `constantTimeEqual` from the feedback route).
- The `ADAPT_API_KEY` env-var ops fallback is acceptable for integration testing but MUST be
  documented as ops-only in code comments.
- `tenant_id` is derived from the authenticated API key lookup, NOT from the request body. The
  request body MUST NOT include a `tenant_id` field; the server pins `tenant_id` from auth context.
  This prevents a tenant from writing labels scoped to another tenant's `tenant_id`.

#### A.7 RLS

The `conversion_labels` insert MUST use the admin Supabase client with `app.current_tenant_id` set
to the authenticated tenant's UUID before the insert, so the RLS policy
`conversion_labels_tenant_isolation` (migration 0019) enforces tenant scope at the DB layer in
addition to the application layer.

---

### B. Retention and Lawful Basis

**Lawful basis:** Art. 6(1)(f) Legitimate Interest (model improvement — per-tenant conversion
classifier training corpus, §T.1). The LIA at `docs/compliance/lia-template.md` covers listing
personalization and model improvement. The CRM ingest processing is a direct extension of that
purpose (it adds the deep-outcome dimension to the prediction↔outcome pair). No new lawful basis
assessment is required, but the LIA must be updated to reference deep-outcome labels explicitly (see
§B.2 below).

CCPA: service provider operational necessity (Cal. Civ. Code § 1798.140(ag)); no "sale."

UAE PDPL: Art. 5(1)(c) legitimate interest.

**Retention posture:** `conversion_labels` rows contain `lead_id` (pseudonymous) + `prediction_id`
(non-PII) + `outcome_class` (non-PII) + `outcome_raw` (non-PII post allow-list enforcement). These
are training labels, not behavioral event data. Proposed retention: same 13-month window as
`adaptation_decisions` (the prediction side of the join), to keep the corpus usable for the Y2
fine-tuning cycle and consistent with the AI Act audit trail period already established for
`adaptation_decisions` in ROPA Activity 4.

RETENTION PROMISE IMPLEMENTATION DEPENDENCY: A 13-month TTL on `conversion_labels` does not yet
exist in the codebase. The nightly TTL cron that enforces retention on `session_embeddings` and
`engagement_scores` (ROPA retention table) does not cover `conversion_labels`. Before compliance can
sign off on a ROPA entry asserting "13-month retention enforced," a data-engineer TTL ticket MUST be
filed and merged (Rule N + K.2 join from guardrails). The backend-engineer MUST NOT document a
concrete retention period in any user-facing or tenant-facing disclosure without that TTL ticket
existing. Internal ROPA/DPIA references to "13 months" are permissible as design intent with the TTL
ticket as a prerequisite gate.

**DSR cascade extension:** `lead_id` erasure requests MUST cascade to `conversion_labels` rows
matching that `lead_id` within the same tenant. This extends the existing erasure semantics
documented in DPIA §8 and ROPA Activity 8. The DSR worker (`apps/control-plane/src/dsr/`) MUST be
updated to include `conversion_labels` in its Postgres cascade. This is a required AC for this
ticket to be considered compliant. The absence of this cascade would mean a data subject's erasure
right under GDPR Art. 17 is not honored for their conversion label rows.

---

### C. Required ROPA and DPIA Updates

Both updates are documentation-only deliverables that must be completed before this endpoint is
activated for any pilot tenant. They are NOT blockers for merging the implementation PR (CI/tests
can pass without them), but they ARE blockers for the tenant-facing go-live gate.

**C.1 ROPA — New Activity (Activity 14)**

Add to `docs/compliance/ropa.md` as Activity 14 — CRM Deep-Outcome Ingest:

- Activity name: CRM deep-outcome label ingest
- Controller: Tenant (controller for outcome data on their website) — Time2Show acts as Processor
- Purpose: Ingest deep conversion outcomes from tenant CRM webhooks (offer_made / contract_signed /
  purchased / lost) to build a durable prediction↔outcome training corpus for per-tenant fine-tuning
  (§T.1, §D.5.7)
- Lawful basis: Art. 6(1)(f) LI (model improvement); CCPA service provider; UAE PDPL Art. 5(1)(c)
- Data categories: prediction_id (non-PII), lead_id (pseudonymous), outcome_class (enum), confidence
  (real), labeled_at (timestamp). No names, no emails, no phone numbers, no CRM contact IDs.
- Retention: 13 months (same as adaptation_decisions) — CONDITIONAL on TTL ticket (see §B above)
- DSR cascade: lead_id erasure → conversion_labels rows deleted synchronously in Postgres
  transaction
- Security: HMAC-SHA256 tenant-scoped auth; RLS on tenant_id; allow-list Zod schema; outcome_raw
  contains only allow-listed fields

**C.2 DPIA — Processing Description Update (§2.3 / §2.5)**

Add `conversion_labels` to the System Components table (§2.3) and the Data Types and Retention table
(§2.5) in `docs/compliance/dpia.md`:

- §2.3: New row — "CRM Outcome Ingest | Supabase (Postgres) | Deep-outcome label persistence for
  per-tenant classifier training | prediction_id, lead_id (pseudonymous), outcome_class, confidence"
- §2.5: New row — "`conversion_labels` | Postgres (Supabase, per-region) | 13 months (PENDING TTL
  ticket) | LI (model improvement; AI Act audit trail consistency)"

Neither of these ROPA/DPIA updates requires external DPO sign-off before merge (no new category of
personal data; no new sub-processor; no new lawful basis — this is an extension of Activity 4). They
are required before go-live with a tenant per Appendix C trigger #3 ("new purpose of processing not
covered by existing activity record").

---

### D. Dedup / Idempotency Recommendation (Privacy Lens)

**Context:** Migration 0019 has no UNIQUE constraint on `(tenant_id, prediction_id)`. The feedback
ping (FOLLOW-171) and the CRM webhook (FOLLOW-172) can both write rows for the same `prediction_id`.
Multiple CRM webhook calls for the same outcome (CRM retry logic, at-least-once delivery) could
write duplicate rows.

**Data-minimization analysis:** From a GDPR Art. 5(1)(c) data minimization standpoint, storing
multiple rows for the same `(tenant_id, prediction_id)` with the same `outcome_class` is redundant
personal data. Redundant pseudonymous rows are not a high-risk issue (the data is already
pseudonymous and allow-listed), but they inflate the corpus, complicate DSR erasure (more rows per
`lead_id` to cascade-delete), and increase the attack surface for re-identification through
statistical analysis of label counts.

**Recommendation: upsert on `(tenant_id, prediction_id)` for same-source CRM retries, but allow
append for different `label_source` values.**

Specifically: add a partial unique index
`UNIQUE (tenant_id, prediction_id) WHERE label_source = 'system'` so that CRM webhook retries are
idempotent (upsert using
`ON CONFLICT DO UPDATE SET outcome_class = EXCLUDED.outcome_class, outcome_raw = EXCLUDED.outcome_raw, updated_at = now()`),
while `manual_admin` corrections can still create a new row with an updated outcome (or update
in-place — the backend+architect team should decide the admin UX). This keeps the corpus clean
without losing the manual override audit trail.

This recommendation has a privacy-positive rationale (minimization) but the final decision on the
constraint shape and the admin UX is a backend+architect call. File as a follow-up to the migration
if the constraint is not added in this PR.

---

### E. AC2 Sign-Off Statement

**Compliance signs off on FOLLOW-172 implementation IF AND ONLY IF the following conditions are
satisfied at code review and before go-live with any pilot tenant:**

1. **Schema boundary (MUST):** The Zod request body schema uses `.strict()`. No field outside §A.1
   is accepted. Unknown keys result in a 400, not silent strip.

2. **outcome_raw safety (MUST):** `outcome_raw` is populated exclusively from `parsed.data` (the
   Zod-validated output), never from `JSON.parse(rawBody)` or any partial raw body reference. There
   is no code path that writes unvalidated content to `outcome_raw`.

3. **lead_id semantics (MUST):** `prediction_id` is NOT NULL on this endpoint. `lead_id` is NOT NULL
   and does not accept any of the deny-listed CRM-native identifier patterns from §A.4 at the
   application layer. (Full enforcement relies on tenant DPA; the schema must at least reject empty
   strings — min length 1 — so "no lead_id" is a hard error, not a silently accepted blank.)

4. **tenant_id from auth context (MUST):** `tenant_id` written to `conversion_labels` is extracted
   from the authenticated API key, not from the request body. No `tenant_id` field is present in or
   accepted from the request body.

5. **Authentication (MUST):** HMAC-SHA256 verification mirrors the feedback route exactly:
   `constantTimeEqual`, 64-hex-char enforcement, raw body used as HMAC data, Bearer token as HMAC
   key.

6. **RLS (MUST):** The admin DB client sets `app.current_tenant_id` before the insert so the DB-
   layer RLS policy fires in addition to the application-layer tenant_id pin.

7. **DSR cascade (MUST):** The DSR worker's Postgres erasure transaction includes
   `DELETE FROM conversion_labels WHERE lead_id = $1 AND tenant_id = $2`. Absence of this is a P0
   compliance gap — the `lead_id` erasure right would be unhonored.

8. **ROPA Activity 14 and DPIA §2.3/§2.5 updates (MUST before go-live):** Both documentation updates
   in §C above are merged to main before any tenant is pointed at this endpoint.

9. **TTL ticket for conversion_labels retention (MUST before any tenant-facing retention
   disclosure): ** No documentation, banner, or API response may state a concrete retention period
   for `conversion_labels` rows until a data-engineer TTL enforcement ticket (cron or partition TTL)
   is filed, merged, and the TTL is verified in CI. Interim state: ROPA/DPIA may say "13 months (TTL
   enforcement pending FOLLOW-NNN)."

10. **Tenant onboarding gate update (MUST before first CRM-integrated tenant goes live):** The
    onboarding compliance gate must include the checkbox from §A.3: tenant contractually affirms
    that `lead_id` values are Estalara-assigned pseudonymous tokens, not CRM contact IDs or PII.

Conditions 1–7 are verifiable at code review of the implementation PR. Conditions 8–10 are go-live
gates, not PR-merge gates — but they must be tracked as open items in backlog/FOLLOW_UPS.md if not
satisfied at time of merge.

**Files produced:** This handoff entry in `backlog/HANDOFFS.md`. ROPA and DPIA updates are deferred
to a follow-up compliance PR (conditions 8 above) to be filed as a FOLLOW-NNN by
compliance-engineer.

**Action required (backend-engineer):** Implement
`apps/control-plane/src/app/api/crm/outcome/route.ts` satisfying AC2 conditions 1–7 above. File the
DSR cascade update in the same PR or as a parallel PR against `apps/control-plane/src/dsr/`. Confirm
in the PR description: (a) grep evidence of `.strict()` on the Zod schema, (b) grep evidence that
`outcome_raw` is assigned from `parsed.data` not `rawBody`, (c) grep evidence of
`app.current_tenant_id` set before insert, (d) grep evidence of
`DELETE FROM conversion_labels WHERE lead_id` in the DSR worker.

**Related tickets:** FOLLOW-170 (prediction enrichment, done), FOLLOW-171 (conversion_labels table,
done), FOLLOW-172 (this ticket), FOLLOW-173..175 (aggregation, admin UI, export — downstream
consumers of this corpus).

---

## FOLLOW-196 → FOLLOW-197

**From:** sdk-engineer **To:** sdk-engineer **Date:** 2026-06-06T00:00:00Z

**Summary:** Both CustomEvent payloads in Estalara-app have been extended with `user_uuid` and
`is_agent` identity fields. Changes are committed locally at
`/home/asipi/Projects/Estalara-app/web-master` (no public GitHub for this repo).

### What changed

**ChatBot.svelte** (`src/lib/ui/chatbot/ChatBot.svelte`):

- Added `userUuid: string | null = null` local variable.
- Updated `authStore.subscribe` callback to also capture `state.userUuid`.
- Extended `estalara:chat:message-sent` CustomEvent detail with:
  ```ts
  user_uuid: userUuid ?? null,   // Keycloak UUID — null when not authenticated
  is_agent: isAgent ?? false,    // true for agent-role users
  ```

**LiveSessions.svelte** (`src/lib/ui/listing/LiveSessions.svelte`):

- Added `isAgent: boolean = false` and `userUuid: string | null = null` local variables.
- Updated `authStore.subscribe` callback to also capture `state.isAgent` and `state.userUuid`.
- **Fixed event type**: corrected `'estalara:live:signup'` → `'live.signup'` (dot-separated). This
  matches `registerFeedbackListener` in `packages/sdk/src/core/adapt.ts` which listens for
  `event.type === 'live.signup'`. The previous `'estalara:live:signup'` type was a dead wire — the
  SDK adapter would never have fired the feedback ping even with FOLLOW-195 merged.
- Extended `live.signup` CustomEvent detail with:
  ```ts
  user_uuid: userUuid ?? null,
  is_agent: isAgent ?? false,
  ```

### Action required for FOLLOW-197 (sdk-engineer — SDK listeners)

When implementing the SDK listeners for `estalara:chat:message-sent` and `live.signup`:

1. The `estalara:chat:message-sent` listener receives
   `{ message, listing_id, char_count, locale, timestamp, user_uuid, is_agent }` in `event.detail`.
   Use `user_uuid` as the basis for `lead_id` derivation (hash with session salt, NEVER store raw).
   Filter signals where `is_agent === true` — do not send agent chat interactions to the bandit as
   conversion signals.

2. The `live.signup` listener is already registered by `registerFeedbackListener` in `adapt.ts`
   (lines ~237–283) via `document.addEventListener('live.signup', handleOutcome)`. The feedback ping
   fires automatically. FOLLOW-197 needs to additionally route the `user_uuid` from the event detail
   into the ingest batch as `lead_id` so the Conversion Label Loop can correlate.

3. Both events must be consent-gated — only dispatch to ingest when
   `getConsentState() === 'granted'` (or `'unknown'` with conservative behavior per tenant config).

**Files in Estalara-app (local only):**

- `/home/asipi/Projects/Estalara-app/web-master/src/lib/ui/chatbot/ChatBot.svelte`
- `/home/asipi/Projects/Estalara-app/web-master/src/lib/ui/listing/LiveSessions.svelte`

**SDK files (Adaptive-Listings repo, no changes needed for FOLLOW-196 scope):**

- `packages/sdk/src/core/adapt.ts` — `registerFeedbackListener` already wired for `'live.signup'`

---

## FOLLOW-275 (architect) → backend-engineer

**From:** architect **To:** backend-engineer **Date:** 2026-06-11T00:00:00Z

**Summary:** ADR-0011 (PROPOSED) decides option (b) — SDK runtime GET — as the transport for
post-activation-mutable quiz/widget config fields (`quiz_enabled`, `micro_polls_enabled`,
`language`, `accent_color`). The static embed snippet continues to carry only the immutable tenant
binding (API key, tenant ID, decision URL). The existing `GET /api/quiz/config` route already
returns the right shape; the gap is that the route requires a tenant JWT and the SDK runs in an
anonymous buyer context.

**Action required (backend-engineer):**

1. **New route `GET /api/quiz/public-config`** (preferred per ADR-0011) — API-key-authenticated,
   read-only, CORS-open, returning `{ quiz_enabled, micro_polls_enabled, language, accent_color }`.
   Auth: `Authorization: Bearer <tenant-api-key>` (the `data-api-key` from the embed snippet),
   verified against `tenants.api_key` with a constant-time compare. No `tenant_id` in the response.
   `Cache-Control: max-age=300, stale-while-revalidate=60`. Returns 401 on invalid key, 404 on
   tenant not found, 200 on success. CORS must allow `*` origins (buyer-facing sites, read-only).

2. **Auth model note:** because this is a new mutation-free route with a new auth mechanism
   (API-key-only, no JWT), it needs a Rule H reviewer sign-off on the auth model. The ADR (docs/adr/
   PROPOSED-FOLLOW-275-quiz-config-transport.md) covers the threat model for this surface. Review it
   before implementation. If you choose the alternative auth path (i) — adding an API-key auth
   branch to the existing `GET /api/quiz/config` — document the choice in the PR.

3. **Remove `data-quiz-enabled` and `data-micro-polls-enabled` emission from `buildSnippet()`.** The
   `quizEnabled` and `microPollsEnabled` params should be removed (or nulled) so the retired
   attributes are never emitted. Also remove the dataset reads for these two attributes from
   `readConfig()` in `packages/sdk/src/core/config.ts` — or mark them as DEPRECATED_FALLBACK so they
   serve as the error-path fallback until the SDK fetch succeeds.

4. **Correct over-asserting docstrings** in
   `apps/control-plane/src/components/onboarding/ DetectionPreview.tsx:135/208` and
   `apps/control-plane/src/components/onboarding/ DetectWizard.tsx:259` — update them to reflect
   that quiz/micro-poll config is fetched at SDK runtime, not threaded through the snippet.

5. **Producer test (AC5 / Rule L):** add a test that mocks the new `GET /api/quiz/public-config`
   route, calls the SDK init path that invokes it, and asserts the resulting `SdkConfig` carries
   `quiz.enabled` and `microPollsEnabled` sourced from the server response. Injection into
   `readConfig` directly does NOT satisfy Rule L.

**Nullability constraint (ADR-0011 wire contract):** all five fields in the 200 response
(`quiz_enabled`, `micro_polls_enabled`, `language`, `accent_color`, `tenant_id`) are non-nullable.
The SDK must not treat absence as an error; fall through to local defaults for any missing field. No
field is `string | null` on one side and `string | undefined` on the other — align both sides
explicitly.

**Files to touch:**

- `apps/control-plane/src/app/api/quiz/public-config/route.ts` (NEW)
- `apps/control-plane/src/app/api/quiz/config/route.ts` (no change required unless using path (i))
- `apps/control-plane/src/components/onboarding/DetectionPreview.tsx` (remove retired params from
  buildSnippet; update docstrings)
- `packages/shared/src/schemas/quiz-config.ts` (add `QuizPublicConfigResponseSchema` Zod schema if
  new route is added)

**ADR:** `docs/adr/PROPOSED-FOLLOW-275-quiz-config-transport.md`

---

## FOLLOW-275 (architect) → sdk-engineer

**From:** architect **To:** sdk-engineer **Date:** 2026-06-11T00:00:00Z

**Summary:** ADR-0011 (PROPOSED) decides that the SDK fetches quiz/widget config at runtime via a
new `GET /api/quiz/public-config` endpoint (API-key-authenticated, CORS-open). This replaces the
`data-quiz-enabled` and `data-micro-polls-enabled` snippet attributes as the config transport for
these post-activation-mutable fields.

**Action required (sdk-engineer):**

1. **`fetchQuizConfig()` in `packages/sdk/src/core/`** — new async function that:
   - GETs `${config.decisionApiUrl}/quiz/public-config` (or a dedicated config URL derived from the
     existing `decisionApiUrl`) with `Authorization: Bearer ${config.apiKey}`.
   - 1000 ms timeout; on error/timeout falls back to any snippet-attribute values present, then to
     hardcoded defaults (`quiz.enabled = true`, `microPollsEnabled = false`).
   - Returns
     `{ quizEnabled: boolean, microPollsEnabled: boolean, language: QuizLanguage, accentColor: string }`.

2. **Thread into init sequence** — wire `fetchQuizConfig()` into `init()` in
   `packages/sdk/src/ index.ts` BEFORE `scheduleQuizTrigger()` and the micro-poll 90 s timer. The
   quiz/micro-poll schedulers must `await` this fetch (or its fallback). Do NOT block DOM
   augmentation or archetype detection on the fetch; only the quiz/micro-poll scheduling is
   sequenced after it.

3. **Retire dataset reads** — once the runtime fetch is wired, remove or deprecate
   `dataset.quizEnabled` and `dataset.microPollsEnabled` from `readConfig()` in `config.ts`. Keep
   them as DEPRECATED_FALLBACK for the error path (backward-compat for legacy snippets with these
   attributes present) with a comment explaining they are fallback-only.

4. **Rule R check** — the resolved `microPollsEnabled` and `quizEnabled` values must NOT be
   re-fetched on cross-listing navigation if the SDK is rehydrating an existing session. Gate the
   fetch behind `!intentStateRehydrated` OR ensure the fetch result is persisted in the session
   envelope and restored on rehydrate (so it does not re-fetch needlessly on every page).

5. **Test (AC5 / Rule L):** add a test that mocks `GET /api/quiz/public-config`, drives the full
   `init()` path (via `_initForTest()` seam), and asserts `config.quiz.enabled` and
   `config.microPollsEnabled` reflect the mocked server values — NOT the snippet-attribute defaults.
   This is the Rule L producer test: injection directly into `readConfig` does not satisfy it.

6. **Nullability alignment:** the server response fields are all non-nullable in the 200 case. Model
   them as
   `{ quizEnabled: boolean; microPollsEnabled: boolean; language: string; accentColor: string }` —
   no `| null` fields. The Zod schema for the response (in `packages/shared`) must match; add
   `QuizPublicConfigResponseSchema` to `packages/shared/src/ schemas/quiz-config.ts` (or a sibling
   file) if it does not exist.

**Sequencing:** the backend-engineer must land the new `GET /api/quiz/public-config` route first (or
in a parallel PR) before this SDK change can be integration-tested end-to-end.

**ADR:** `docs/adr/PROPOSED-FOLLOW-275-quiz-config-transport.md`

---

## FOLLOW-173 → FOLLOW-174

**From:** data-engineer **To:** backend-engineer **Date:** 2026-06-07T00:00:00Z

**Summary:** FOLLOW-173 ships the calibration endpoint at `GET /api/pilot/calibration`. It performs
a query-time join between ClickHouse `adaptation_decisions` (adapt_decision_id, confidence,
model_version) and Postgres `conversion_labels` (prediction_id, outcome_class), buckets model
confidence into deciles, and returns a score-vs-actual reliability curve plus per-outcome-class
conversion aggregates, both grouped by `model_version`. The endpoint uses the same Rule K.2
fail-loud pattern as `cta-lift` and `inquiry-starts`: returns `data_source: 'mock'` when
CLICKHOUSE_URL is unset (dev / CI); returns HTTP 500 + Sentry when a configured store fails; never
silently falls back to mock in production.

Sync approach is documented in both route.ts and route-helpers.ts: "query-time join (MVP — fine for
pilot scale <10k decisions/tenant). FOLLOW-175 will migrate to ClickHouse-materialized path for
scale."

**Action required:** FOLLOW-174 (backend-engineer) should render this calibration data in the pilot
dashboard. The response shape is:

```typescript
CalibrationResponse {
  window_days: number;           // 7 | 14 | 30
  tenant_id: string;
  calibration: CalibrationRow[]; // reliability curve per (model_version, confidence_decile)
  conversion_aggregates: ConversionAggRow[]; // conversion rate per (outcome_class, model_version)
  generated_at: string;          // ISO
  data_source: 'clickhouse' | 'mock';
}
```

Import types from `./route-helpers` (same pattern as cta-lift). The endpoint is already auth-gated
(Bearer JWT + tenant_id claim) and returns `window_days=7` by default; accepts
`?window_days=7|14|30`.

**Files:**

- `apps/control-plane/src/app/api/pilot/calibration/route.ts` — GET handler
- `apps/control-plane/src/app/api/pilot/calibration/route-helpers.ts` — types + bucketing + join
  logic
- `apps/control-plane/src/app/api/pilot/calibration/route.test.ts` — 28 tests (all passing)

---

## FOLLOW-221 → FOLLOW-175

**From:** data-engineer **To:** ml-engineer / backend-engineer **Date:** 2026-06-08T00:00:00Z
**Corrected by:** FOLLOW-237 (data-engineer, 2026-06-08)

**CORRECTION (FOLLOW-237 AC5 — LG-1):** The original handoff incorrectly stated that this export
feeds the FOLLOW-175 §D.5.7 LoRA fine-tuning corpus. **This is WRONG.** This export is a calibration
**SUMMARY** (aggregate counts per `outcome_class × model_version × tenant × window`). It contains NO
per-decision features, scores, or prediction IDs. FOLLOW-175 needs a SEPARATE **row-level**
`(features_snapshot, model_version, score) → outcome_class` export with one row per decision.
FOLLOW-175 **CANNOT use this summary shape** for corpus construction. The original claim "FOLLOW-175
may add fields but MUST NOT remove or rename existing ones" was also premature — the shapes are
incompatible and FOLLOW-175 must design its own schema from scratch.

**Summary (corrected):** FOLLOW-221 adds `?format=json` export to `GET /api/pilot/calibration`.
FOLLOW-237 adds: (a) `data_source` provenance to the envelope and every row (Rule K.2), (b) HTTP 400
rejection for unknown `?format=` values, (c) renames `avg_confidence` to `mean_model_predicted_rate`
to clarify it is per-model_version not per-class, (d) corrects this handoff entry. The existing
chart-data response (no `?format=json`) is completely unaffected.

**Export response shape (as of FOLLOW-237):**

```typescript
// Top-level envelope
type CalibrationExportResponse = {
  data_source: 'clickhouse' | 'mock'; // Rule K.2 provenance — MUST be read before corpus ingestion
  rows: CalibrationExportRow[]; // one per (outcome_class × model_version)
};

// Per-row shape (Zod-validated — CalibrationExportRowSchema in route-helpers.ts)
type CalibrationExportRow = {
  outcome_class: string; // e.g. 'offer_made', 'no_response', 'purchased', 'lost'
  model_version: string; // e.g. 'rulebased-bandit-v1', 'lora-tenant-abc-v2'
  tenant: string; // tenant_id from JWT claim
  window: number; // window_days (7 | 14 | 30)
  count: number; // labeled decisions with this (outcome_class, model_version)
  mean_model_predicted_rate: number | null; // mean predicted_rate across all reliability-curve
  //   buckets for this model_version (per-model, NOT per-class).
  //   Rides on raw confidence pending FOLLOW-230 dwell cap (commit b62faae).
  //   null when no calibration rows exist for the model version.
  data_source: 'clickhouse' | 'mock'; // per-row copy of the envelope provenance field
};
```

**Rule K.2 provenance (FOLLOW-237 AC1):** Both the envelope `data_source` and each row's
`data_source` carry the provenance. A consumer MUST reject any file where `data_source === 'mock'`
before using it for model training or go/no-go evaluation — mock fixtures must not contaminate a
training corpus.

**What FOLLOW-175 still needs (separate ticket):** A row-level export with one row per labeled
decision, containing `(prediction_id, features_snapshot, model_version, score, outcome_class, ts)`.
Design that schema in FOLLOW-175; do not extend this summary endpoint.

**Files changed in FOLLOW-221 + FOLLOW-237:**

- `apps/control-plane/src/app/api/pilot/calibration/route.ts`
- `apps/control-plane/src/app/api/pilot/calibration/route-helpers.ts`
- `apps/control-plane/src/app/api/pilot/calibration/route.test.ts`

---

## FOLLOW-266 Phase 1 (data-engineer) → FOLLOW-266 Phase 2 (backend-engineer) → FOLLOW-266 Phase 3 (sdk-engineer)

**From:** pm-orchestrator **To:** backend-engineer + sdk-engineer **Date:** 2026-06-12T12:00:00Z
**Phase 1 DONE:** PR #277 merged 2026-06-12T18:23:36Z (commit 61be83a). RETRO-064 pending.

**Summary:** FOLLOW-266 is a 3-agent co-assigned ticket for the K.3.6 Archetype Identification
Tracer foundation. Work is sequenced to avoid merge conflicts:

- **Phase 1 (data-engineer) — DONE (PR #277):** ClickHouse `intent_events` DDL migration 0014 +
  Supabase `intent_sessions` migration 0028 + Drizzle schema
  `packages/db/src/schema/intent-sessions.ts`. Both on main as of 2026-06-12T18:23:36Z.
- **Phase 2 (backend-engineer) — IN_PROGRESS:** Supabase `intent_weight_configs` migration 0029
  (AC2) + CF Worker ingest dual-write handler for `intent.snapshot` events (AC5). Branch:
  `backend-engineer/FOLLOW-266-k36-ingest-handler`.
- **Phase 3 (sdk-engineer) — BACKLOG (depends on Phase 2):** New `intent.snapshot` Zod event type +
  SDK emission logic in `packages/sdk/src/core/intent.ts` (AC4). Branch:
  `sdk-engineer/FOLLOW-266-k36-intent-snapshot-event`.

**Phase 1 artifacts now on main (read these first):**

- `packages/db/migrations/0028_intent_sessions.sql` — intent_sessions table DDL (RLS, indexes,
  UNIQUE)
- `packages/db/src/schema/intent-sessions.ts` — Drizzle schema definition (all column types)
- `infra/clickhouse/migrations/0014_intent_events.sql` — intent_events ClickHouse MergeTree DDL
- `packages/db/migrations/meta/_journal.json` — idx=28 added (next migration must be idx=29)

**Action required (backend-engineer — Phase 2):** Phase 1 is on main. Implement:

1. Migration `0029_intent_weight_configs.sql`: table with `id uuid PK`,
   `tenant_id uuid NULL REFERENCES tenants(id)`, `is_active bool DEFAULT true`, `weights jsonb`,
   `created_at timestamptz`, `created_by uuid REFERENCES users(id)`. RLS policy:
   `tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true)::uuid` (match
   existing RLS pattern from intent_sessions). UNIQUE(tenant_id, is_active) WHERE is_active = true.
   Journal entry idx=29 (check \_journal.json — current last is idx=28, when=1781287352000; set new
   when to current epoch ms).
2. In `apps/ingest/src/handlers/events.ts` (or a new `apps/ingest/src/handlers/intent-snapshot.ts`):
   add a handler branch for `event.type === 'intent.snapshot'`. On match: (a) INSERT into ClickHouse
   `intent_events` via existing `clickhouse-producer.ts` pattern, using columns: intent_session_id,
   tenant_id, event_at, event_type, archetype_deltas, confidence_before, confidence_after,
   top_archetype, event_payload; (b) UPSERT into Supabase `intent_sessions` via Drizzle DB client —
   use `intentSessions` export from `packages/db/src/schema/index.ts`.
3. Vitest integration test: mock ClickHouse producer + DB client; assert both writes fire on
   `intent.snapshot` input; assert skipped for other event types; assert `intent_sessions` upsert
   increments `signal_count` and updates `last_event_at`.

**Action required (sdk-engineer — Phase 3 — do NOT start until Phase 2 PR is open):** After Phase 2
PR is open (backend-engineer has confirmed the intent.snapshot event payload shape in the handler),
implement:

1. Add `IntentSnapshotEventSchema` to `packages/shared/src/schemas/events/intent.ts` (new file or
   existing). Schema fields:
   `archetype, confidence, signal_count, probabilities: record<string, number>, quiz_completed: boolean, quiz_leaf: string | null, chat_turns: number, last_signal_delta: { archetype_deltas: record<string, number>, event_type: string }`.
   Add to `EventSchema` discriminated union.
2. In `packages/sdk/src/core/intent.ts`: after every 5th `processSignal()` call AND on
   `window.beforeunload`, emit `intent.snapshot` via the existing `queueEvent()` mechanism.
3. Unit test: 5-signal cycle → snapshot emitted; `beforeunload` → snapshot emitted; re-hydrated
   session → counter resets correctly.

**Files to read before starting (Phase 2):**

- `backlog/FOLLOW_UPS.md` §FOLLOW-266 (full AC spec)
- `docs/MASTER_DESIGN.md` §K.3.6 (schema DDL + design rationale)
- `packages/db/migrations/0028_intent_sessions.sql` (Phase 1 intent_sessions DDL — read columns
  carefully)
- `packages/db/src/schema/intent-sessions.ts` (Drizzle column definitions — use `intentSessions`
  import)
- `infra/clickhouse/migrations/0014_intent_events.sql` (Phase 1 intent_events DDL — use these exact
  column names)
- `packages/db/migrations/meta/_journal.json` (idx=28 is last; your migration must be idx=29)
- `apps/ingest/src/clickhouse-producer.ts` (CH write pattern)
- `apps/ingest/src/handlers/events.ts` (event handler pattern)
- `packages/shared/src/schemas/events/` (event schema pattern)
- `packages/sdk/src/core/intent.ts` (intent engine — add emit here, Phase 3 only)

---

## FOLLOW-374 → Rafał Palak (CTO) — Invoke /api/v1/consent/platform-registration at investor "I agree" click

**From:** backend-engineer (FOLLOW-374, 2026-06-21) **To:** Rafał Palak (CTO / app.estalara.com)
**Priority:** P0 — go-live gate for the mandatory registration consent

### What backend-engineer delivered

`POST /api/v1/consent/platform-registration` is implemented and live on the control-plane
(`admin.estalara.com`). This endpoint writes the `consent_records` row with
`consent_type = 'platform_registration'` that satisfies the compliance go-live gate in
`docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §5.

The endpoint is in `apps/control-plane/src/app/api/v1/consent/platform-registration/route.ts`.

### What Rafał needs to do

**At the "I agree" registration click on app.estalara.com:**

Call `POST https://admin.estalara.com/api/v1/consent/platform-registration` with the following:

**Headers:**

```
Content-Type: application/json
X-Consent-Signature: <HMAC-SHA256(PLATFORM_REGISTRATION_CONSENT_SECRET, body_json_utf8)>
```

where `body_json_utf8` is the exact UTF-8 bytes of the POST body (as a string).

**Body:**

```json
{
  "tenant_id": "<Estalara_tenant_UUID_for_app_estalara>",
  "session_id": "<stable_investor_account_reference_no_PII>",
  "nonce": "<random_UUID_or_32+_char_random_string_per_request>",
  "tos_version": "platform-v1.3-2026-06-21",
  "user_agent": "<investor_browser_user_agent>"
}
```

- `tenant_id` — the Estalara UUID of the app.estalara.com tenant (get from Piotr / Doppler).
- `session_id` — a stable pseudonymous investor reference (e.g. SHA-256 of their Supabase user ID).
  Must be consistent for the investor's lifetime. No raw email / name / phone.
- `nonce` — a fresh UUID per request (prevents accidental double-submit on retry).
- `tos_version` — use `"platform-v1.3-2026-06-21"` to match the DPO-reviewed disclosure text. Update
  when consent text changes and a new DPO-reviewed version is published.
- `consent_text_hash` — optional; omit to use the canonical EN §6.1 SHA-256 hash. Provide a custom
  hash ONLY if you display a translated version of the text.

**Auth secret:** `PLATFORM_REGISTRATION_CONSENT_SECRET` — request from Piotr (to be provisioned in
Doppler). The secret is HMAC-SHA256 shared between app.estalara.com and the control-plane.

**Compute the signature (Node.js example):**

```typescript
import { createHmac } from 'crypto';
const body = JSON.stringify({ tenant_id, session_id, nonce, tos_version, user_agent });
const sig = createHmac('sha256', PLATFORM_REGISTRATION_CONSENT_SECRET)
  .update(body, 'utf8')
  .digest('hex');
```

**Expected response:**

```json
{ "consent_record_id": "uuid" } // 201 Created
```

On 409, the record already exists — this is safe (idempotent); no re-insert needed.

**Critical timing:** Call this endpoint BEFORE creating the investor's account. If the endpoint
returns non-2xx (excluding 409), do NOT proceed with account creation — surface an error to the
investor.

**What NOT to suppress:** The DOM opt-out toggle (`profiling_opt_out` in the SDK) only suspends AL
DOM adaptation. It does NOT affect buying-intent identification, lead ranking, or agent-facing chat
summaries. Those are covered by this registration consent and must continue regardless of the DOM
opt-out state.

### Go-live gate

The compliance DPO gate (`docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §5 item: "§6 registration
consent text reviewed by DPO before go-live on app.estalara.com") requires:

1. This API integration is live on app.estalara.com (verified by Rafał).
2. QA manual verification: real browser investor registration → DB row written (check via Supabase
   dashboard → `consent_records` table, filter `consent_type = 'platform_registration'`).
3. DPO sign-off on the §6.1 disclosure text (PENDING — Compliance Engineering).

Update `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §5 gate item to DONE after steps 1–3 are
complete.

---
