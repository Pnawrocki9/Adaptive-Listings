# Runtime Readiness Audit — Phase 0 Deliverable

**Ticket:** TICKET-RUNTIME-AUDIT-001 **Date:** 2026-05-18 **Authors:** PM-orchestrated read-only
investigation (6 parallel research agents + synthesis) **Status:** Final — input to Phase 1 GO/NO-GO
decision **Scope:** Read-only static inspection of 8 sprints of code against vendor activation plan
from DECISIONS_2026-05-18_v2 (Council Checkpoint 2.5)

---

## Executive summary

Council 2.5 predicted **30–50% of integration seams to fail on first activation** and budgeted **2
weeks for breakage stabilization** (Phase 2, weeks 3–4 of the revised plan). This audit confirms
that prediction is correct and identifies the specific seams that will fail.

- **Total findings:** 67 (24 BLOCKERs, 17 HIGH-RISK, 17 WARNING, 9 INFO across 8 sections)
- **Deduplicated BLOCKERs after cross-section overlap:** **12**
- **Phase 1 GO/NO-GO verdict:** **CONDITIONAL GO** — the 5-vendor minimum viable activation plan
  remains feasible, but **none of the 3 deployable apps can ship today**. ~25–40 hours of pre-flight
  ticket work clears every blocker. Recommended pre-flight tickets listed in Section 8.6.
- **Top 3 surprises:**
  1. **The SDK is broken end-to-end.** Every event the SDK emits today fails ingest's Zod schema
     validation. Auth header drift (Bearer vs `X-Estalara-API-Key`), field-name mismatch
     (`depth_percent` vs `pct`), required `viewport` never sent, and 7 event types
     (`listing.viewed`, `cta.clicked`, `quiz.event`, `quiz.mismatch`, `sidebar.closed`,
     `adapt.applied`, `adapt.skipped`) emitted by the SDK but absent from `EventSchema`'s
     discriminated union. CI mocks have masked all of this. (Section 4)
  2. **Migration journal is desynchronized from disk.** `packages/db/migrations/meta/_journal.json`
     lists only 8 entries; the directory has 12 `.sql` files. Drizzle's migrator iterates the
     journal, not the directory, so migrations 0003 (tenant_site_schemas), 0004 (ab_bandit_weights),
     0005 (archetype seed), and 0007 (bandit seed) will be silently skipped on Phase 1 apply.
     Decision API + auto-onboarding + ML intent engine will crash on missing tables. (Section 3)
  3. **Single library (pino) is the only Worker-runtime breaker.** Apart from pino dragged in
     transitively via `@estalara/shared/observability`, both Worker apps are 95% Web Platform clean.
     A ~30-line swap to a `console.log(JSON.stringify(...))` logger clears the only Worker
     deploy-time incompatibility. (Section 2)

---

## Section 1 — Vendor Coupling Analysis

Phase 1 activates 5 vendors and **defers** 4: Redpanda, Modal, ClickHouse, R2. For each deferred
vendor we mapped every runtime call site.

### 1.1 Redpanda

**Summary:** 15 findings. **1 Hard (A) blocker logical surface** (3 tightly coupled files), 12 Soft
(B), 2 Test/Doc.

| #   | File:line                                                                               | What it does                                                                                                         | Classification                                       |
| --- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 1   | `apps/ingest/src/redpanda-producer.ts:62-145`                                           | `pushToRedpanda()` REST proxy with 3-attempt backoff                                                                 | **A — HARD** (effort ~2-3h)                          |
| 2   | `apps/ingest/src/handlers/events.ts:27,196-214`                                         | Every successful POST /v1/events calls pushToRedpanda; on failure returns HTTP 503 `redpanda_unavailable` to the SDK | **A — HARD (same root cause)**                       |
| 3   | `apps/ingest/src/types.ts:11,23`                                                        | `Env` extends `RedpandaProducerEnv` — type-level coupling                                                            | A — Hard (trivial — inside #1 bypass)                |
| 4   | `apps/ingest/wrangler.toml:11-13,52,57,66`                                              | `REDPANDA_REST_URL = "http://localhost:8082"` in all 3 envs                                                          | B — Soft (but defaults are unreachable from CF edge) |
| 5   | `apps/ingest/src/middleware/error-handler.ts:53`                                        | `redpanda_unavailable: 503` in error map                                                                             | D — Doc/static map                                   |
| 6   | `apps/decision-api/src/lib/redpanda-producer.ts:66-148`                                 | Identical REST producer, used only by ab-events                                                                      | B — Soft (guard at caller)                           |
| 7   | `apps/decision-api/src/lib/ab-events.ts:51-81`                                          | `publishAbAssignmentEvent()`                                                                                         | B — Soft (caller guard)                              |
| 8   | `apps/decision-api/src/app/api/adapt/route.ts:359-380`                                  | `if (!assignment.skipped && redpandaUrl) { … }` — explicit guard                                                     | B — Soft                                             |
| 9   | `apps/decision-api/src/index.ts:34-48`                                                  | `Env` declares all Redpanda vars as optional                                                                         | B — Soft                                             |
| 10  | `apps/control-plane/src/lib/ab-events.ts:33-77`                                         | `if (!redpandaUrl) return;` top-line guard                                                                           | B — Soft                                             |
| 11  | `apps/control-plane/src/app/api/adapt/description/route.ts:103-126`                     | Description-requested publisher with same guard                                                                      | B — Soft                                             |
| 12  | `apps/stream-consumer/src/main.py:25-56` + `consumers/events.py` + `redpanda_client.py` | Modal Python consumer (won't deploy in Phase 1)                                                                      | B — Soft (not deployed)                              |
| 13  | `apps/data-quality/src/crons/schema_validation.py:277-332`                              | `_emit_redpanda_event()` schema-drift emitter                                                                        | B — Soft (Modal cron not deployed)                   |
| 14  | `apps/llm-gateway/src/jobs/generate_description.py:562-668`                             | Modal cron polling estalara.descriptions                                                                             | B — Soft (not deployed)                              |
| 15  | `apps/stream-consumer/src/consumer_local.py:1-50`                                       | Local docker-compose smoke consumer                                                                                  | C — Test                                             |

**Phase 1 blocker:** `apps/ingest/src/redpanda-producer.ts` has no
`if (!env.REDPANDA_REST_URL) return` guard, unlike all its sibling producers. Every successful event
POST returns 503 to the SDK.

**Recommended bypass (3h):** Add early-exit guard to `pushToRedpanda()`:

```ts
if (!env.REDPANDA_REST_URL) return { ok: true, attempts: 0 };
```

Set `REDPANDA_REST_URL = ""` in `wrangler.toml` `[vars]` and per-env overrides. Add a Sentry
breadcrumb `events_dropped_no_bus` so traffic remains observable. Add 1–2 unit tests asserting the
no-bus path returns `{ ok: true }` and HTTP 200 with `accepted > 0`.

### 1.2 Modal

**Summary:** 4 runtime findings, **all inside Modal-deployed Python apps that won't run in
Phase 1.** 0 Hard, 4 Soft.

| #   | File:line                                                                  | What it does                                   | Classification          |
| --- | -------------------------------------------------------------------------- | ---------------------------------------------- | ----------------------- |
| 1   | `apps/stream-consumer/src/main.py:20-56`                                   | `modal.App("estalara-stream-consumer-events")` | B — Soft (not deployed) |
| 2   | `apps/data-quality/src/crons/schema_validation.py:43,56,340-345`           | Daily drift-detection cron                     | B — Soft (not deployed) |
| 3   | `apps/llm-gateway/src/jobs/generate_description.py:49,145,161-165,562-567` | LLM description generator + Redpanda consumer  | B — Soft (not deployed) |
| 4   | `apps/llm-gateway/src/conftest.py:1-65`                                    | pytest stub of `modal` module                  | C — Test                |

**No code changes required.** Don't run `modal deploy` and these apps are simply dead.

**Side effect to communicate:** Tier 2/3 AI descriptions return `template_fallback`; schema drift
detection is offline; A/B `ab.assignment` events never written to ClickHouse.

### 1.3 ClickHouse

**Summary:** 7 TypeScript call sites + 1 Python module. **0 Hard, 8 Soft.** Every TypeScript path
has explicit `if (!CLICKHOUSE_URL) return` guard.

| #   | File:line                                                                                                                                                                                                                | What it does                                                                    | Classification                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- | ------------------------------------- |
| 1   | `apps/control-plane/src/app/api/adapt/route.ts:180-230`                                                                                                                                                                  | `logDecisionAsync()` fire-and-forget INSERT                                     | B — Soft                              |
| 2   | `apps/control-plane/src/app/api/dsr/_clickhouse.ts:38-65`                                                                                                                                                                | `writeDsrAuditLog()` — used by all DSR routes                                   | B — Soft (⚠️ Phase 1 DSR audit gap)   |
| 3   | `apps/control-plane/src/app/api/dashboard/analytics/summary/route.ts:46-95`                                                                                                                                              | Analytics summary; falls back to `buildMockSummary()`                           | B — Soft                              |
| 4   | `apps/control-plane/src/app/api/dashboard/analytics/lift/route.ts:87-147`                                                                                                                                                | Lift attribution; falls back to mock                                            | B — Soft                              |
| 5   | `apps/control-plane/src/lib/llm-gateway.ts:88-118`                                                                                                                                                                       | `getRolling24hSpend()` — **fail-open returns 0 → LLM circuit breaker disabled** | B — Soft (⚠️ uncapped LLM spend risk) |
| 6   | `apps/control-plane/src/lib/llm-gateway.ts:124-170`                                                                                                                                                                      | `logLlmCallAsync()` cost-audit INSERT                                           | B — Soft                              |
| 7   | `apps/stream-consumer/src/clickhouse_client.py:1-132`                                                                                                                                                                    | Batch insert client                                                             | B — Soft (Modal not deployed)         |
| 8   | misc TODO comments in `apps/control-plane/src/app/api/analytics/route.ts:13`, `apps/control-plane/src/app/api/demo/ingest/route.ts:15`, `apps/decision-api/src/lib/consent-gate.ts:54`, `packages/sdk/src/core/dqs.ts:6` | D — Doc-only                                                                    |

**Phase 1 side effects:** Dashboard renders mock summary/lift. DSR audit trail not written
(compliance follow-up needed). LLM daily spend cap (`LLM_DAILY_CAP_USD = 1.00`) is silently disabled
— `getRolling24hSpend()` always returns 0.

### 1.4 R2 (Cloudflare Object Storage)

**Summary:** **0 runtime findings.** Notable positive result.

- No `R2Bucket` type imports, no `env.R2*` bindings, no `r2_bucket` declarations in either Worker
  `wrangler.toml`.
- `infra/terraform/cloudflare/r2.tf:1-13` declares two R2 buckets (`sdk_cdn`, `tenant_assets`) but
  they are **not bound to any Worker**.
- `infra/terragrunt.hcl:4-33` uses R2 as Terraform state backend (deploy-time only).
- SDK is npm-published, not CDN-served.

**Conclusion:** R2 is fully deferrable with zero code or config changes.

### 1.5 Cross-vendor summary

- **Hard dependencies blocking Phase 1: 1 logical surface** (`apps/ingest` Redpanda push), 3
  tightly-coupled files.
- **Estimated refactor effort: ~3 hours** (one guard + tests).
- **Top 3 risk surfaces:**
  1. Ingest `POST /v1/events` returns 503 to every SDK request.
  2. LLM daily-cap circuit breaker disabled (`apps/control-plane/src/lib/llm-gateway.ts:88-118`).
  3. Tier 2/3 AI descriptions silently dark; A/B `ab.assignment` events never emitted.

---

## Section 2 — Cloudflare Worker Compatibility Audit

Both Worker apps have `compatibility_flags = ["nodejs_compat"]` and
`compatibility_date = "2026-04-26"`. Section 7 already confirmed both apps build cleanly. This
section is static-only.

### 2.1 apps/ingest

**Top-level deps:**

- `hono ^4.6.14` — OK (Worker-native)
- `@sentry/cloudflare ^10.50.0` — OK (purpose-built for Workers, not `@sentry/node`)
- `@microlabs/otel-cf-workers 1.0.0-rc.52` — OK (purpose-built)
- `@opentelemetry/api ^1.9.1` — OK (pure interface)
- `@estalara/shared workspace:*` — **MIXED**: main export pure Zod/TS (OK); `./observability`
  subpath imports pino (NOT Worker-safe). Ingest uses both subpaths.

**Source:** 12 .ts files, 1,345 LOC.

| Severity    | File:Line                                                                                       | Issue                                                                                                                                                                                                                                                                                                           | Recommended fix                                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **BLOCKER** | `apps/ingest/src/observability/logger.ts:12` → `packages/shared/src/observability/logger.ts:10` | `import pino from 'pino'` is dragged into the ingest bundle. Pino uses Node `worker_threads`, `fs.createWriteStream`, `SonicBoom` for async fd flushing. `nodejs_compat` does NOT close this gap — Workers' worker_threads polyfill is partial; pino's transport init throws. Imported by the request hot path. | Replace pino with Worker-safe `console.log(JSON.stringify(...))` logger. Keep `createLogger(serviceName)` signature so ingest code is unchanged. |
| **BLOCKER** | `packages/shared/src/observability/logger.ts:39`                                                | `transport: { target: 'pino-pretty' }` when `NODE_ENV === 'development'`. pino-pretty spawns a worker thread; throws at logger construction.                                                                                                                                                                    | Same fix — drop pino entirely for Worker targets, or guard transport behind `typeof EdgeRuntime === 'undefined'`.                                |
| WARNING     | `apps/ingest/src/redpanda-producer.ts:103,160`                                                  | `setTimeout` for AbortController timeout + exponential backoff (worst-case ~3.1s on retry exhaustion).                                                                                                                                                                                                          | Worker-safe but eats latency budget — consider failing fast on first 5xx instead of two retries.                                                 |
| WARNING     | `apps/ingest/src/observability.ts:22`                                                           | Sentry `withSentry` wraps handler at module top → init runs on cold start. Graceful no-op when DSN absent.                                                                                                                                                                                                      | None — pattern is correct; verify Doppler injects DSN only in staging/prod.                                                                      |
| INFO        | `apps/ingest/src/index.ts:36`                                                                   | `instrument(sentryWrapped, otelConfig)` module-level side effect.                                                                                                                                                                                                                                               | None (library is designed for this).                                                                                                             |
| INFO        | `apps/ingest/src/auth.ts:113,120`                                                               | `crypto.subtle.importKey/sign` — Web Crypto, supported.                                                                                                                                                                                                                                                         | None.                                                                                                                                            |
| INFO        | Various                                                                                         | `crypto.randomUUID()`, `btoa()`, DO storage — all Worker-native.                                                                                                                                                                                                                                                | None.                                                                                                                                            |

**Explicit no-finds:** Zero hits in `apps/ingest/src/*` for `fs`, `path`, `os`, `child_process`,
`net`, `tls`, `dns`, `cluster`, `dgram`, `worker_threads`, `http`, `https`, `stream`. No `require(`.
No `__dirname`/`__filename`. No `Buffer.`/`new Buffer`. No `setInterval`. No `WebSocket(`
constructor. **`process.env` use: zero in app src** (all env access via `env`/`c.env`).

### 2.2 apps/decision-api

**Top-level deps:** Only `zod ^3.23.8`. No `@estalara/shared` dep — `lib/reorder.ts:66`
intentionally calls this out. **Frugal-by-design.**

**Source:** 9 .ts files, 1,702 LOC.

| Severity | File:Line                                                                         | Issue                                                                                                                                                                                                                                                                               | Recommended fix                                                                                                                 |
| -------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| WARNING  | `apps/decision-api/src/lib/llm-gateway.ts:33`                                     | Module-level `Map<string, number>` for daily spend tracking. Workers don't share memory across isolates; spend cap will be drastically under-enforced. Already documented in-file as Sprint 9 work.                                                                                 | Phase 1 OK as MVP; Sprint 9 must replace with Upstash Redis.                                                                    |
| WARNING  | `apps/decision-api/src/app/api/adapt/route.ts:361-391`                            | Fire-and-forget `void (async () => { ... })()` for `publishAbAssignmentEvent`. Without `ctx.waitUntil()`, pending promises may be cancelled when the isolate is reused. The handler signature already accepts `_ctx: ExecutionContext` (`index.ts:73`) but doesn't pass it through. | Pass `ctx` from `index.ts` into `handleAdaptRequest`, wrap IIFE in `ctx.waitUntil(...)`. Phase 1 follow-up, not deploy blocker. |
| WARNING  | `apps/decision-api/src/lib/redpanda-producer.ts:90,147`, `lib/llm-gateway.ts:142` | `setTimeout` for fetch abort + retry.                                                                                                                                                                                                                                               | Worker-safe.                                                                                                                    |

**Explicit no-finds:** Same comprehensive list as ingest. **Zero Node-only imports.** Zero
`process.env`. Zero `Buffer`. Zero `setInterval`. Zero `WebSocket(`. Standalone `setTimeout`: 3
occurrences, all bounded.

### 2.3 packages/shared (transitively bundled into ingest)

The main `./` subpath is 100% pure Zod schemas + types — Worker-safe. The `./observability` subpath
is the problem.

| Severity    | File:Line                                              | Issue                                                                                                                                                                                                                                  | Recommended fix                                                                                                                   |
| ----------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **BLOCKER** | `packages/shared/src/observability/logger.ts:10,30,39` | `import pino from 'pino'` at module top; `createLogger()` constructs real pino instance. Drags pino into ingest Worker bundle.                                                                                                         | Replace with Worker-safe `console.log(JSON.stringify(...))` (recommended) OR split subpath into `/node` and `/edge`.              |
| WARNING     | `packages/shared/src/observability/logger.ts:34,38,39` | `process.env.GIT_SHA`, `LOG_LEVEL`, `NODE_ENV` read at construction time. Under `nodejs_compat`, Workers polyfill `process.env` but ONLY from `[vars]` declared in `wrangler.toml` — these three are not declared. Silently undefined. | Either declare in `wrangler.toml` `[vars]` or thread values explicitly through `createLogger(serviceName, { gitSha, logLevel })`. |
| INFO        | `packages/shared/src/observability/tracer.ts:12,37`    | `@opentelemetry/api` (pure interface); `process.env.GIT_SHA` same caveat.                                                                                                                                                              | Same as above.                                                                                                                    |
| INFO        | `packages/shared/package.json:21-24`                   | Declared deps `@opentelemetry/sdk-trace-base`, `-node`, `-web` are **never imported anywhere** in `packages/shared/src` — dead deps.                                                                                                   | Prune. Doesn't affect runtime (tree-shaken) but reduces audit surface.                                                            |

### 2.4 Cross-app summary

- **Total BLOCKERS:** **2** (both in `packages/shared/src/observability/logger.ts` — single root
  cause: pino).
- **Total WARNINGs:** 5.
- **Total INFOs:** 11.
- **nodejs_compat reliance:** BLOCKERs CANNOT be fixed by the flag alone — pino needs real
  `worker_threads` and `fs` write streams. The `process.env` WARNINGs DO depend on `nodejs_compat`;
  keep the flag but be aware vars are silently undefined.
- **Bottom line:** Both Workers are 95% Worker-native by design. A ~30-line swap to console-JSON in
  `packages/shared/src/observability/logger.ts` clears the deploy gate.

---

## Section 3 — Database Migration Audit

Supabase project was created today (2026-05-18) with zero migrations applied.

### 3.1 Migration inventory

- **Total migration files on disk:** 12 (`0000` through `0011`)
- **Path:** `packages/db/migrations`
- **Migration runner:** `packages/db/scripts/migrate.ts` invokes `drizzle-orm/postgres-js/migrator`
  against `DATABASE_URL_ADMIN ?? DATABASE_URL_DIRECT`.
- **Naming convention:** Sequential 4-digit prefix + slug. Mixed Drizzle auto-generated and
  human-named.
- **CRITICAL ORDER ISSUE:** `meta/_journal.json` lists only **8** entries (idx `0,1,2,6,8,9,10,11`);
  disk has **12** SQL files. Drizzle's migrator iterates `journal.entries`, NOT the directory. **The
  following migrations will be SILENTLY SKIPPED on Phase 1 apply:**
  - `0003_tenant_site_schemas.sql` — creates `tenant_site_schemas` table
  - `0004_ab_bandit_weights.sql` — creates `ab_bandit_weights` table + RLS
  - `0005_seed_archetype_embeddings.sql` — seeds 18 canonical archetypes
  - `0007_seed_ab_bandit_weights.sql` — seeds bandit weights per tenant
- **Journal `when` timestamp anomaly:** Entries 0000/0001/0002 and 0011 use 2026 timestamps;
  0006/0008/0009/0010 use 2025 timestamps (~1 year prior). On a fresh DB Drizzle iterates entries in
  array order so this is irrelevant for the first apply — but the inversion is a corruption hazard
  once the migration history is not fresh (incremental migrations could be skipped if
  `lastDbMigration.created_at > migration.folderMillis`).

### 3.2 Per-migration findings

| #   | File                               | Will run in Phase 1?    | Idempotent on re-run?                                                                     | RLS?                                                                         | FK refs satisfied?             | Dangerous? |
| --- | ---------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------ | ---------- |
| 0   | 0000_soft_secret_warriors.sql      | **YES**                 | NO (6 tables + 16 indexes lack `IF NOT EXISTS`)                                           | none                                                                         | OK                             | none       |
| 1   | 0001_tidy_quasar.sql               | **YES**                 | NO                                                                                        | none                                                                         | OK                             | none       |
| 2   | 0002_goofy_spencer_smythe.sql      | **YES**                 | PARTIAL (`CREATE EXTENSION IF NOT EXISTS vector` OK; tables/indexes lack `IF NOT EXISTS`) | none                                                                         | OK                             | none       |
| 3   | 0003_tenant_site_schemas.sql       | **NO — NOT IN JOURNAL** | yes                                                                                       | **MISSING** (table has no RLS policy anywhere)                               | OK                             | none       |
| 4   | 0004_ab_bandit_weights.sql         | **NO — NOT IN JOURNAL** | partial (CREATE POLICY not idempotent)                                                    | yes (`auth.jwt()` pattern)                                                   | OK                             | none       |
| 5   | 0005_seed_archetype_embeddings.sql | **NO — NOT IN JOURNAL** | yes (`ON CONFLICT DO NOTHING`)                                                            | N/A                                                                          | depends on 0002 (OK)           | none       |
| 6   | 0006_answers.sql                   | **YES**                 | partial (CREATE POLICY not idempotent)                                                    | yes (`auth.jwt()` pattern)                                                   | OK                             | none       |
| 7   | 0007_seed_ab_bandit_weights.sql    | **NO — NOT IN JOURNAL** | yes (`ON CONFLICT`)                                                                       | N/A                                                                          | depends on 0004 (also skipped) | none       |
| 8   | 0008_schema_validation_history.sql | **YES**                 | partial (POLICY not idempotent)                                                           | yes (SELECT-only policy)                                                     | OK                             | none       |
| 9   | 0009_tenant_compliance_records.sql | **YES**                 | partial (POLICY not idempotent)                                                           | yes (SELECT-only policy)                                                     | OK                             | none       |
| 10  | 0010_tenant_consent_required.sql   | **YES**                 | yes (`ADD COLUMN IF NOT EXISTS`)                                                          | N/A                                                                          | OK                             | none       |
| 11  | 0011_aromatic_triton.sql           | **YES**                 | partial (ADD CONSTRAINT + POLICY not idempotent)                                          | yes (`current_setting('request.jwt.claims', true)` — correct modern pattern) | OK                             | none       |

### 3.3 RLS coverage

- **Tables in TS schema:** 15
- **Tables that WILL have ENABLE RLS after Phase 1 (journal-applied):** 4 — `answers`,
  `schema_validation_history`, `tenant_compliance_records`, `dsr_verifications`.
- **Tables MISSING RLS entirely after Phase 1 migration:**
  - `tenants`, `api_keys`, `consent_records`, `users` — policy exists only in unapplied
    `packages/db/src/schema/rls-policies.sql` (manual-apply, never wired into migrations).
  - `demo_sessions`, `session_embeddings` — policy nowhere in repo.
  - `tenant_site_schemas`, `ab_bandit_weights` — would have RLS via 0003/0004 but those are not in
    journal.
- **Intentionally without RLS:** `tenant_registrations`, `staff_audit_log`, `archetype_embeddings`
  (CAT-B global table per RLS_DISCOVERY).
- **Mixed RLS pattern:** Migrations 0004/0006 use legacy `auth.jwt() ->> 'tenant_id'`; 0011 uses
  modern `current_setting('request.jwt.claims', true)::json ->> 'tenant_id'`. CLAUDE.md/RLS audit
  specifies the latter.

### 3.4 Drizzle TS schema vs SQL migration drift

After Phase 1 (only journal entries applied):

| Entity                                                                                       | TS schema | In Phase 1 DB? | Notes                                                     |
| -------------------------------------------------------------------------------------------- | --------- | -------------- | --------------------------------------------------------- |
| `tenants`, `tenant_registrations`, `users`, `api_keys`, `staff_audit_log`, `consent_records` | yes       | yes (0000)     | OK                                                        |
| `demo_sessions`                                                                              | yes       | yes (0001)     | OK                                                        |
| `archetype_embeddings`                                                                       | yes       | yes (0002)     | **EMPTY — seed 0005 not in journal**                      |
| `session_embeddings`                                                                         | yes       | yes (0002)     | OK                                                        |
| `tenant_site_schemas`                                                                        | yes       | **NO**         | App crashes on `POST /api/detect`, `lib/tenant-schema.ts` |
| `ab_bandit_weights`                                                                          | yes       | **NO**         | Decision API + bandit CRUD crashes                        |
| `answers`                                                                                    | yes       | yes (0006)     | OK                                                        |
| `schema_validation_history`, `tenant_compliance_records`, `dsr_verifications`                | yes       | yes            | OK                                                        |

**No column/type mismatches found in spot-check** for tables that do migrate.

### 3.5 Seed data

- `0005_seed_archetype_embeddings.sql` — 18 rows, idempotent, **not in journal → not applied.**
- `0007_seed_ab_bandit_weights.sql` — depends on `ab_bandit_weights` (also not in journal).
- `packages/db/scripts/seed.ts` — placeholder ("nothing to seed yet").
- `packages/db/src/seed/archetype-seeds.ts` — TS constant with **different confidence thresholds**
  than 0005 SQL (TS: 0.500–0.620; SQL: uniform 0.600). Drift between seed sources.

### 3.6 Dangerous statements

None of consequence. Empty Supabase makes `0010 ADD COLUMN NOT NULL DEFAULT true` a no-op.

### 3.7 Extensions used

- `vector` (pgvector) — declared with `IF NOT EXISTS` in 0002 and 0006. Supabase managed Postgres
  pre-installs pgvector. Safe.
- `pgcrypto`/`uuid-ossp` — not declared. All `DEFAULT gen_random_uuid()` uses PG-built-in. Safe on
  Supabase PG 15/16.

### 3.8 Phase 1 migration risk

**BLOCKERS: 4**

1. **BLOCKER-DB-1 — Journal/disk desync.** 4 migrations silently skipped.
2. **BLOCKER-DB-2 — Decision API + onboarding crash.** Missing `tenant_site_schemas` /
   `ab_bandit_weights` tables.
3. **BLOCKER-DB-3 — Archetype space empty.** Intent engine returns zero archetypes.
4. **BLOCKER-DB-4 — `rls-policies.sql` never applied.** Phase 2A RLS work assumes these exist.

**HIGH-RISK: 5**

1. `CREATE TABLE`/`CREATE INDEX` lack `IF NOT EXISTS` in 0000, 0001, 0002 — re-runs via psql fail
   (Drizzle history protects, but `psql` does not).
2. `CREATE POLICY` not idempotent in 0004, 0006, 0008, 0009, 0011.
3. `0011 ADD CONSTRAINT` not idempotent (PG doesn't support `IF NOT EXISTS` on ADD CONSTRAINT).
4. Mixed `auth.jwt()` vs `current_setting(...)` RLS JWT-claim patterns.
5. Journal timestamp inversion (corruption hazard once history isn't fresh).

**Recommended pre-flight (priority order):**

1. **Rewrite `_journal.json`** to include all 12 entries with monotonic `when` timestamps. Restore
   missing snapshot files or accept Drizzle hygiene loss.
2. **Add new migration `0012_rls_remaining_tables.sql`** that applies `rls-policies.sql` plus
   missing policies for `demo_sessions`, `session_embeddings`, `tenant_site_schemas`. Wrap every
   `CREATE POLICY` in `DROP POLICY IF EXISTS … ; CREATE POLICY …` for idempotency.
3. **Normalize `auth.jwt() → current_setting(...)`** in 0004 and 0006.
4. **Decide seed strategy** — keep `0005`/`0007` as journal migrations (once journal is fixed) OR
   move to `scripts/seed.ts`. Pick one source of truth between SQL seed and `archetype-seeds.ts`.
5. **Update `README.md`** — table count says "Six core tables" (stale, now 15); remove "RLS policies
   … must be applied manually" once migration-based RLS is in place.
6. **Apply against a Supabase preview branch** before Phase 1 (use `mcp__claude_ai_Supabase__`
   `create_branch` + `apply_migration`). Non-negotiable for fresh `vector` + journal-fix
   combination.

---

## Section 4 — Event Schema Contract Audit

### 4.1 Schema source locations

- **SDK producer (TypeScript):** No Zod-validated outgoing schema. Plain object literals at emission
  sites: `packages/sdk/src/core/events.ts`, `core/observer.ts`, `core/adapt.ts`, `index.ts`. SDK
  does NOT import `EventSchema` from `@estalara/shared`.
- **Ingest validator (TypeScript):** `apps/ingest/src/handlers/events.ts` imports `EventSchema` from
  `@estalara/shared` and `safeParse`s each event.
- **Stream consumer (Python):** `apps/stream-consumer/src/models/event.py` — `EventEnvelope`
  Pydantic model. Envelope-only; `payload: dict[str, Any]` (no per-type validation). Manually
  mirrored from TS with comment: _"Kept in sync manually for MVP; TICKET-future: codegen from JSON
  Schema via quicktype."_
- **Shared/contract package:** `packages/shared/src/schemas/` — TS centralized. `EventSchema` is a
  `z.discriminatedUnion('type', [...])` with 37 registered event types across 13 per-type files.
  Python side is hand-mirrored.

### 4.2 Event type inventory — SDK ↔ Ingest mismatch

Events emitted by SDK that are **NOT** in `EventSchema` discriminated union (will be **rejected** by
ingest with "Invalid discriminator value"):

| SDK-emitted type | Emission site                                          | In ingest schema? |
| ---------------- | ------------------------------------------------------ | ----------------- |
| `listing.viewed` | `observer.ts:71`, `intent.ts:241`, `embedding.ts:111`  | **NO — REJECTED** |
| `cta.clicked`    | `observer.ts:107`, `intent.ts:246`, `embedding.ts:120` | **NO — REJECTED** |
| `quiz.event`     | `index.ts:309`                                         | **NO — REJECTED** |
| `quiz.mismatch`  | `index.ts:329`                                         | **NO — REJECTED** |
| `sidebar.closed` | `index.ts:250`                                         | **NO — REJECTED** |
| `adapt.applied`  | `adapt.ts:128,166,232`                                 | **NO — REJECTED** |
| `adapt.skipped`  | `adapt.ts:95,110,146,188,198`                          | **NO — REJECTED** |

Schema-registered but never emitted by SDK: `page.exit`, `tab.visible/hidden`,
`mouse.dwell/ rage_click/exit_intent`, all
photo/floorplan/price/feature/search/filter/inquiry/chat/cross-listing types, `session.started`.
(Test fixtures `tests/e2e/fixtures/sample-events.json` use them; runtime SDK does not.)

### 4.3 Per-event drift — page.view, scroll.depth, envelope

| Event                      | Field                                              | SDK value                                                              | Ingest expectation                                                                                          | Drift?                                                                                                                               |
| -------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| envelope                   | `consent_state`                                    | `config.consentState === 'opted_out' ? 'none' : 'legitimate-interest'` | enum incl. `'consented'`                                                                                    | **BUG: SDK NEVER sends `'consented'`** even when user grants explicit consent. GDPR audit-trail risk. (`events.ts:54`)               |
| envelope                   | `region`                                           | hard-coded `'eu'`                                                      | enum (4 regions)                                                                                            | Brittle but valid; ingest overwrites post-validation via `CF-IPCountry`.                                                             |
| envelope                   | `event_id`                                         | `crypto.randomUUID()` (v4)                                             | `z.string().uuid()` accepts v4                                                                              | OK today; ADR-0003 specifies v7 (drift from intent).                                                                                 |
| envelope                   | `listing_id` (top-level)                           | NOT set; some events embed in `payload` only                           | optional top-level string                                                                                   | DRIFT: events downgraded to non-listing-scoped.                                                                                      |
| (auth)                     | `Authorization: Bearer ${apiKey}` (`events.ts:65`) | reads `X-Estalara-API-Key` only (`handlers/events.ts:61`)              | **BLOCKER: every SDK request returns 401 `missing_key`.** Smoke test masks bug (uses `X-Estalara-API-Key`). |
| `page.view`                | `payload.url`                                      | `location.href` (or `''`)                                              | `z.string().url()`                                                                                          | **BLOCKER: `''` fails URL parse → rejected.**                                                                                        |
| `page.view`                | `payload.referrer`                                 | `document.referrer` (often `''`)                                       | `.url().optional()`                                                                                         | **BLOCKER: empty string fails URL parse.**                                                                                           |
| `page.view`                | `payload.viewport`                                 | **NOT SET** by SDK                                                     | **REQUIRED** by schema                                                                                      | **BLOCKER: every page.view rejected.**                                                                                               |
| `page.view`                | `device_class`                                     | `'mobile' \| 'desktop'`                                                | `'mobile' \| 'tablet' \| 'desktop'`                                                                         | OK (subset).                                                                                                                         |
| `scroll.depth`             | depth field                                        | `depth_percent: number` (`events.ts:97`)                               | `pct: z.number().min(0).max(100)` (`mouse-scroll.ts:19`)                                                    | **BLOCKER: field-name mismatch → every scroll.depth rejected.** Fixture `sample-events.json` uses `pct`, inconsistent with real SDK. |
| `consent.granted`/`denied` | `language`, `method`                               | `'en'\|'pl'`, `'banner'`                                               | matches                                                                                                     | OK.                                                                                                                                  |
| `session.quality.snapshot` | `payload`                                          | `dqsTracker.snapshot()` cast `as unknown as Record<string, unknown>`   | typed schema                                                                                                | Type-cast bypasses TS check; drift not statically guaranteed.                                                                        |

### 4.4 Contract tests

- `tests/e2e/smoke-ingest.test.ts` — posts hand-crafted `sample-events.json` (schema-compliant
  shape) through ingest → Redpanda → consumer → ClickHouse. **Does NOT exercise the real SDK
  producer** — fixtures use the shape the schema expects, not the shape the SDK emits.
- `packages/shared/src/schemas/event.test.ts` — envelope-only Zod tests.
- `apps/stream-consumer/src/tests/test_consumer.py` — Python validator tests in isolation.
- `packages/sdk/src/__tests__/events.test.ts` — **green tests that ENCODE the drift**: assert SDK
  sends `Authorization: Bearer` and `payload.depth_percent === 50`.
- **No true cross-cutting contract test exists.** A test that pipes actual SDK output through
  ingest's `EventSchema.safeParse` would have caught every blocker below.

### 4.5 Versioning

- SDK sends version: URL path `POST /v1/events` (hardcoded `config.ts:35`), envelope
  `schema_version: 1 as const`.
- Ingest checks version: URL match (404 for other paths); envelope validated via `z.literal(1)`.
- No version-negotiation handshake. No `X-Estalara-Schema-Version` response header.

### 4.6 Phase 1 schema risk

**BLOCKERS (Phase 1 — SDK ↔ Ingest disagree): 8**

1. **Auth header drift** — Bearer vs `X-Estalara-API-Key` → every SDK request 401.
2. **`scroll.depth.payload.depth_percent` vs `pct`** → every scroll event rejected.
3. **`page.view.payload.viewport` never set; required** → every page-view rejected.
4. **`page.view.payload.url` empty-string fallback** fails `.url()`.
5. **`page.view.payload.referrer` empty-string fallback** fails `.url()`.
6. **`listing.viewed` not in `EventSchema` union** → rejected.
7. **`cta.clicked` not in union** → rejected.
8. **`consent.granted` flow doesn't bubble through `dispatchEvents`** — `'consented'` never reaches
   ClickHouse; only `'legitimate-interest'` or `'none'` emitted post-grant.

Additional rejected-but-feature-still-works events: `quiz.event`, `quiz.mismatch`, `sidebar.closed`,
`adapt.applied`, `adapt.skipped` (used for SDK observability).

**DEFERRED-vendor risk (Modal/Python):** 2 — Python envelope has no per-type validation; manual
TS↔Python mirror has no CI gate. Currently dominated by SDK↔ingest mismatch.

**Recommended action:**

1. **Immediate (Phase 1):** Fix SDK producer to match the centralized shared schema:
   - `packages/sdk/src/core/events.ts`: rename `depth_percent` → `pct`; add `viewport` to page-view
     payload; switch auth to `X-Estalara-API-Key`; map `'consented'` correctly.
   - Either register `listing.viewed`, `cta.clicked`, `quiz.event`, `quiz.mismatch`,
     `sidebar.closed`, `adapt.applied`, `adapt.skipped` as proper schemas in
     `packages/shared/src/schemas/events/` (add to discriminated union), OR rename SDK call sites to
     existing schema names. Adding new schemas is cleaner — semantics differ from existing types.
   - Make SDK `EventSchema.safeParse()` each outgoing event in debug mode, or generate typed builder
     functions so wrong payloads are TypeScript errors.
2. **Centralize codegen for Python.** Generate Pydantic from `EventSchema` via
   `zod-to-json-schema` + `datamodel-code-generator`. Wire into CI.
3. **Add a true contract test** in `tests/contract/` that drives every SDK `collect*()` / queue push
   through `EventSchema.safeParse()`. Fail CI on any rejection.
4. **Version-negotiation header** — `X-Estalara-Schema-Version` from `/health` so SDK can detect
   server mismatch and degrade. Not blocking for Phase 1.

---

## Section 5 — Fixture Loading Audit

### 5.1 Inventory

- 49 files (24 platforms × 2 JSONs + 1 README) in `packages/sdk/src/auto-detect/__fixtures__/`
- Total bytes: **~52 KB**
- File types: `.json` (48) + `.md` (1)

### 5.2 Load mechanisms

| File using fixtures                                          | Load method                                                    | Classification | Worker-safe? |
| ------------------------------------------------------------ | -------------------------------------------------------------- | -------------- | ------------ |
| `packages/sdk/src/auto-detect/test-utils.ts` (16, 89-98)     | Node `fs.readFileSync` + `fs.readdirSync` via `readFixtures()` | **TEST-ONLY**  | n/a          |
| `packages/sdk/src/auto-detect/__tests__/corpus.test.ts` (28) | Calls `readFixtures('__fixtures__')`                           | **TEST-ONLY**  | n/a          |

No other importer found anywhere in `packages/`, `apps/`, or `infra/`.

### 5.3 Bundle impact

- Fixtures in production bundle: **no**.
- `packages/sdk/tsup.config.ts` entry points are `src/index.ts`, `src/core/playbooks/index.ts`,
  `src/auto-detect/pipeline.ts`, `src/auto-detect/techniques/ai-vision.ts`. None import
  `test-utils.ts` or any `__fixtures__` path.
- `packages/sdk/dist/` contains zero `test-utils*`/`__fixtures__*`/`ground-truth*` artifacts.

### 5.4 Verdict

**SAFE.** Fixtures and `test-utils.ts` are pure test artifacts. They never enter Cloudflare Worker
bundles, the SDK npm bundle, or the control-plane Next.js bundle. tsup + exports map prevents
leakage. 52 KB is trivial vs 1 MB Worker limit even if accidentally bundled.

---

## Section 6 — Secrets and Env Var Audit

### 6.1 App → secrets matrix

| App                    | Required env vars                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/ingest`          | `ENVIRONMENT`, `KV_API_KEYS`, `KV_IDEMPOTENCY`, `RATE_LIMITER` (DO), `RATE_LIMIT_PER_MIN?`, `REDPANDA_REST_URL`, `REDPANDA_TOPIC_EVENTS`, `REDPANDA_REST_USERNAME?`, `REDPANDA_REST_PASSWORD?`, `SENTRY_DSN_INGEST?`, `GIT_SHA?`, `OTEL_EXPORTER_URL?`, `OTEL_EXPORTER_HEADERS?`                                                                                                                                                                                                                                                                                                                                                          |
| `apps/decision-api`    | `ENVIRONMENT`, `ADAPT_API_KEY?`, `LLM_DAILY_CAP_USD?`, `REDPANDA_REST_*?`, `UPSTASH_REDIS_URL?`, `UPSTASH_REDIS_TOKEN?`, `SCHEMA_API_URL?`, `SCHEMA_API_TOKEN?`                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/control-plane`   | `ADAPT_API_KEY`, `ADMIN_API_SECRET`, `ANTHROPIC_API_KEY`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_URL`, `DATABASE_URL`, `DATABASE_URL_ADMIN`, `DATABASE_URL_DIRECT`, `DEMO_MODE_JWT_SECRET`, `LISTING_UPDATED_WEBHOOK_SECRET`, `OPENAI_API_KEY`, `REDPANDA_REST_PASSWORD/URL/USERNAME`, `REDPANDA_TOPIC_DESCRIPTIONS/EVENTS`, `RESEND_API_KEY`, `SCHEMA_API_TOKEN`, `STRIPE_PRICE_AUGMENT/NATIVE/OBSERVER`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `UPSTASH_REDIS_TOKEN/URL`, `JWT_SECRET`, `SUPABASE_JWT_SECRET`, `API_KEY_HMAC_SECRET`, `NEXT_PUBLIC_*` (5 vars), `SENTRY_DSN_CONTROL_PLANE/ORG/PROJECT`, `SUPABASE_SERVICE_ROLE_KEY` |
| `apps/intent-engine`   | (placeholder — `main.py` is a stub)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `apps/llm-gateway`     | `ANTHROPIC_API_KEY`, `UPSTASH_REDIS_URL/TOKEN`, `REDPANDA_BROKERS`, `REDPANDA_SASL_USERNAME/PASSWORD`, `REDPANDA_SASL_MECHANISM?`, `REDPANDA_TLS?`, `REDPANDA_DESCRIPTIONS_TOPIC?`, `REDPANDA_DESCRIPTIONS_GROUP?`                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `apps/data-quality`    | `DATABASE_URL`, `REDPANDA_BROKERS`, **`REDPANDA_USERNAME`/`REDPANDA_PASSWORD`** (no `SASL_` prefix — inconsistent), `SENTRY_DSN?`, `ENV?`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `apps/stream-consumer` | `REDPANDA_BROKERS`, `REDPANDA_SASL_USERNAME/PASSWORD`, `REDPANDA_SASL_MECHANISM?`, `REDPANDA_TLS?`, `REDPANDA_TOPIC?`, `REDPANDA_DLQ_TOPIC?`, `CONSUMER_GROUP_ID?`, `CLICKHOUSE_HOST/PORT?/USER/PASSWORD/DATABASE?/SECURE?`, `CLICKHOUSE_URL` (local), `BATCH_SIZE?`                                                                                                                                                                                                                                                                                                                                                                      |

**Inconsistency:** `apps/data-quality` uses `REDPANDA_USERNAME`/`PASSWORD` while every other app
uses `REDPANDA_SASL_USERNAME`/`PASSWORD`.

### 6.2 Doppler coverage

- `doppler.yaml` declares project `estalara-adaptive-listings`, default config `dev`. **No
  per-secret enumeration in-repo** — Doppler dashboard is presumed authoritative.
- Modal Python apps reference `modal.Secret.from_name("estalara-secrets")` — separate Modal-side
  bundle that must mirror Python-side env vars.
- **Gaps:** `CLICKHOUSE_URL`, `ADMIN_API_SECRET`, `DEMO_MODE_JWT_SECRET`,
  `LISTING_UPDATED_WEBHOOK_SECRET`, `SCHEMA_API_URL/TOKEN`, `REDPANDA_REST_*`, `REDPANDA_TOPIC_*`,
  `DATABASE_URL_ADMIN/DIRECT`, Stripe pricing IDs, `NEXT_PUBLIC_APP_URL`,
  `NEXT_PUBLIC_SENTRY_DSN_CONTROL_PLANE`, `RESEND_API_KEY`, `SENTRY_DSN_INGEST`,
  `SENTRY_DSN_CONTROL_PLANE`, `RATE_LIMIT_PER_MIN`, `LLM_DAILY_CAP_USD`.

### 6.3 .env.example coverage

- Root `.env.example`: 33 keys (Turbo, Cloudflare, Supabase, ClickHouse, Redpanda SASL, Upstash,
  Modal, LLM keys, LiteLLM, Sentry generic, Grafana, OTel, Doppler).
- `apps/control-plane/.env.example`: +17 keys.
- `apps/decision-api/.env.example`: +2 keys.
- **Vars used in code but missing from any `.env.example`** (~20): `CLICKHOUSE_URL`,
  `ADMIN_API_SECRET`, `DEMO_MODE_JWT_SECRET`, `LISTING_UPDATED_WEBHOOK_SECRET`, `SCHEMA_API_*`,
  `REDPANDA_REST_*`, `REDPANDA_TOPIC_EVENTS/DESCRIPTIONS`, `REDPANDA_USERNAME`/`PASSWORD` variant
  (data-quality), `REDPANDA_DESCRIPTIONS_TOPIC/GROUP`, `REDPANDA_SASL_MECHANISM`,
  `REDPANDA_DLQ_TOPIC`, `REDPANDA_TOPIC`, `CONSUMER_GROUP_ID`, `DATABASE_URL_ADMIN/DIRECT`,
  `SENTRY_DSN_INGEST/CONTROL_PLANE`, `NEXT_PUBLIC_SENTRY_DSN_CONTROL_PLANE`, `NEXT_PUBLIC_APP_URL`,
  `NEXT_PUBLIC_GIT_SHA`, `GIT_SHA`, `RATE_LIMIT_PER_MIN`, `LLM_DAILY_CAP_USD`, `BATCH_SIZE`,
  `CLICKHOUSE_SECURE`, `ENV`.

### 6.4 Committed credentials hunt

- **No tracked `.env*` files except the three `.env.example` files** (all sanitised placeholders).
- `apps/control-plane/.env.local` exists on disk but is gitignored (verified — `git ls-files` empty,
  `git check-ignore` confirms). `.gitignore` lines 26–33 cover `.env`, `.env.local`, `.env.*` with
  `!.env.example` whitelist.
- **Zero suspicious tokens in source** (`sk-…`, `eyJ…`, `AKIA…`, `ghp_…`, `xoxp-…`, `dp.st./pt.`,
  `eyJ…\.`) outside `node_modules/`, `.git/`, `.next/`, `.venv/`, `.claude/worktrees/`. Only hit:
  `postgresql://user:pass@localhost…` test strings in `packages/db/src/index.test.ts` (placeholders,
  no leak).
- **gitleaks active** — comprehensive `.gitleaks.toml` covers Anthropic/OpenAI/Stripe/Doppler/
  AWS/GitHub/Cloudflare/JWT/GCP/Supabase service_role/DB strings/private keys.

### 6.5 Default/dev fallbacks (silent-default risk in prod)

| File:line                                                                                                                                             | Pattern                                                     | Risk                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------- |
| `apps/control-plane/src/app/api/demo/sessions/route.ts:42`                                                                                            | `process.env.DEMO_MODE_JWT_SECRET ?? 'demo_jwt_secret_dev'` | **HIGH — demo JWTs signed with literal default in prod**            |
| `apps/control-plane/src/lib/llm-gateway.ts:92,138`, `app/api/adapt/route.ts:202`, `app/api/dashboard/analytics/*.ts`, `app/api/dsr/_clickhouse.ts:55` | `CLICKHOUSE_PASSWORD ?? ''`                                 | MEDIUM — anonymous insert if URL set but password empty             |
| `apps/control-plane/src/lib/stripe.ts:52-54`                                                                                                          | `STRIPE_PRICE_* ?? ''`                                      | LOW — obscures misconfig                                            |
| `apps/ingest/src/observability.ts:80`                                                                                                                 | `env.ENVIRONMENT ?? 'development'`                          | **MEDIUM — prod errors mis-tagged as dev in Sentry if var missing** |
| `apps/stream-consumer/src/redpanda_client.py:23-27`                                                                                                   | empty SASL creds → localhost broker                         | MEDIUM — anonymous-default in prod                                  |
| `apps/stream-consumer/src/clickhouse_client.py:86-91`                                                                                                 | `CLICKHOUSE_PASSWORD → ""`                                  | MEDIUM — anonymous-default in prod                                  |
| `apps/data-quality/src/crons/schema_validation.py:207,290-292`                                                                                        | `DATABASE_URL/REDPANDA_* → ""`                              | LOW — silent no-op cron                                             |

### 6.6 Phase 1 minimum secret set

For the 5-vendor minimum (Cloudflare Worker, Supabase, Vercel, Doppler, DNS):

| Secret                                                                                           | Needed by                   | Why blocking                                       |
| ------------------------------------------------------------------------------------------------ | --------------------------- | -------------------------------------------------- |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | control-plane               | Auth + browser bootstrap                           |
| `SUPABASE_SERVICE_ROLE_KEY`                                                                      | control-plane               | RLS bypass for admin ops                           |
| `SUPABASE_JWT_SECRET`                                                                            | control-plane               | JWT verification                                   |
| `DATABASE_URL`, `DATABASE_URL_DIRECT`, `DATABASE_URL_ADMIN`                                      | control-plane, migrations   | Drizzle + admin/migrator roles                     |
| `JWT_SECRET`, `API_KEY_HMAC_SECRET`                                                              | control-plane               | Tenant API signing / key issuance                  |
| `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`                            | deploy time                 | Wrangler + DNS                                     |
| `TURBO_TOKEN`, `TURBO_TEAM`                                                                      | CI build cache              | (optional but recommended)                         |
| `DOPPLER_TOKEN`                                                                                  | CI service token            | Inject Doppler into CI                             |
| `ENVIRONMENT`                                                                                    | ingest, decision-api        | Worker `[vars]` — already in wrangler.toml per-env |
| `NEXT_PUBLIC_APP_URL`                                                                            | control-plane               | OAuth redirect / canonical URLs                    |
| `ADAPT_API_KEY`                                                                                  | decision-api, control-plane | Bearer auth between Next.js → Worker               |
| `ADMIN_API_SECRET`                                                                               | control-plane               | Admin endpoint guard                               |
| `DEMO_MODE_JWT_SECRET`                                                                           | control-plane               | **Must override `'demo_jwt_secret_dev'` fallback** |

**Deferrable past Phase 1** (Worker degrades gracefully if absent): `SENTRY_DSN_*`, `OTEL_*`,
`GRAFANA_*`, all `REDPANDA_*`, all `CLICKHOUSE_*`, `UPSTASH_REDIS_*`, `ANTHROPIC_API_KEY`/
`OPENAI_API_KEY`/`LITELLM_*`, `STRIPE_*`, `RESEND_API_KEY`, `MODAL_*`, `SCHEMA_API_*`,
`LISTING_UPDATED_WEBHOOK_SECRET`.

**Deploy-blocker config:** `apps/ingest/wrangler.toml` KV namespace IDs are literal
`PLACEHOLDER_KV_API_KEYS_ID`/`PLACEHOLDER_KV_IDEMPOTENCY_ID` strings. Not a Doppler secret but a
Phase 1 deploy blocker.

### 6.7 Phase 1 secrets risk

**BLOCKERS: 3**

1. `DEMO_MODE_JWT_SECRET ?? 'demo_jwt_secret_dev'` fallback — demo JWTs signed with a known string
   if env missing.
2. KV namespace IDs are literal `PLACEHOLDER_*` strings — `wrangler deploy` will fail.
3. `.env.example` ↔ code drift (~20 vars) — operators following docs will not provision them in
   Doppler; several have silent-default fallbacks that mask misconfig.

**WARNINGS: 5**

1. `data-quality` uses `REDPANDA_USERNAME`/`PASSWORD` vs everyone else's `REDPANDA_SASL_*`.
2. `CLICKHOUSE_URL` used by control-plane/consumer_local but only `CLICKHOUSE_HOST/PORT` in root
   `.env.example`.
3. Per-service Sentry DSNs (`SENTRY_DSN_INGEST`, `SENTRY_DSN_CONTROL_PLANE`) not in any
   `.env.example` — root has generic `SENTRY_DSN` only.
4. `apps/ingest/src/observability.ts:80` defaults `ENVIRONMENT` to `'development'` — prod errors
   silently tagged dev if var missing.
5. `apps/control-plane/.env.local` exists on disk (correctly gitignored — confirm not bundled in any
   container/builder images).

---

## Section 7 — Build and Deployment Readiness

All three apps build cleanly today. Deployment plumbing is the gap.

### 7.1 apps/ingest

- **Build:** `tsc --noEmit` PASS (~5s). Wrangler bundles at deploy time.
- **Wrangler:** `compatibility_date = 2026-04-26` (22 days stale),
  `compatibility_flags = ["nodejs_compat"]`. Bindings: KV `KV_API_KEYS` (placeholder ID), KV
  `KV_IDEMPOTENCY` (placeholder ID), DO `RATE_LIMITER` (class `RateLimiter`, migration tag `v1`).
  Routes: `ingest-staging.estalara.io/*`, `ingest.estalara.io/*`.

| Severity | Issue                                                                                                                                                                    | Recommendation                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| BLOCKER  | KV namespace IDs are `PLACEHOLDER_*` for all envs — wrangler will refuse to deploy.                                                                                      | `wrangler kv namespace create` per env or `terraform apply`, substitute real IDs.                    |
| BLOCKER  | Domain mismatch: wrangler uses `estalara.io`; SDK `core/config.ts:35` hardcodes `https://ingest.estalara.com/v1/events`; DECISIONS_2026-05-18_v2 says ".com subdomains". | Architect+CEO decision on canonical domain. Update SDK + wrangler + terraform + runbook in lockstep. |
| BLOCKER  | Cloudflare zone for the canonical domain not verified active (no Terraform apply per Council 2.5).                                                                       | Verify zone in Cloudflare account; if missing follow `docs/runbooks/cloudflare.md` §Account Setup.   |
| HIGH     | Worker secrets (`SENTRY_DSN_INGEST`, `OTEL_EXPORTER_HEADERS`) commented as Doppler-injected but `deploy-staging.yml` doesn't invoke Doppler or `wrangler secret put`.    | Add `wrangler secret put` step (or `doppler run -- wrangler deploy`) to deploy workflow.             |
| HIGH     | `compatibility_date` 22 days stale.                                                                                                                                      | Bump in the same PR as Phase-1 activation.                                                           |
| MEDIUM   | `deploy-staging.yml` pins Node 20; rest of repo Node 22 (`.nvmrc`, engines).                                                                                             | Align workflow to Node 22.                                                                           |
| MEDIUM   | No production deploy workflow — only manual `wrangler deploy --env production`.                                                                                          | Add guarded `deploy-production.yml` (manual trigger + required reviewer).                            |

### 7.2 apps/decision-api

- **Build:** `tsc --noEmit` PASS (~5s).
- **Wrangler:** Same `compatibility_date`/`compatibility_flags`. **No bindings** (relies on Upstash
  REST + Redpanda REST + control-plane HTTP). `[vars]`: `LLM_DAILY_CAP_USD = "1.00"`. Routes:
  `api-staging.estalara.io/*`, `api.estalara.io/*`.

| Severity | Issue                                                                                                                             | Recommendation                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| BLOCKER  | Same `.io` vs `.com` mismatch.                                                                                                    | Same fix as 7.1.                                                                                                     |
| BLOCKER  | DNS zone must exist.                                                                                                              | Same as 7.1.                                                                                                         |
| HIGH     | `ADAPT_API_KEY` required but never provisioned by deploy workflow.                                                                | Same secret-step fix.                                                                                                |
| HIGH     | No `@sentry/cloudflare`/`@microlabs/otel-cf-workers` deps. Observability parity gap vs ingest.                                    | Either accept gap explicitly or add parity.                                                                          |
| HIGH     | If `decision-api` reads from Supabase/Upstash/LLM providers (likely), those bindings/secrets are not declared in `wrangler.toml`. | Audit `apps/decision-api/src/lib/**` env reads; reconcile with wrangler.toml (out of scope of this audit — flagged). |
| MEDIUM   | Stale `compatibility_date`.                                                                                                       | Bump.                                                                                                                |
| MEDIUM   | No production deploy job.                                                                                                         | Add guarded `deploy-production.yml`.                                                                                 |

### 7.3 apps/control-plane

- **Build:** `next build` PASS (~30s; 47 routes; 13 static + 32 dynamic + 2 SSG). `.next/server` 5.9
  MB, `.next/static` 1.4 MB.
- **Next config:** `reactStrictMode: true`, ESLint/TS errors fail build,
  `transpilePackages: ['@estalara/shared', '@estalara/auth', '@estalara/db']`. **No
  `withSentryConfig` wrapper.** No `output: 'standalone'`. No `vercel.json`. No `.vercel/` link.

| Severity | Issue                                                                                                                                                                                        | Recommendation                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| BLOCKER  | No Vercel project linked (no `.vercel/`, no `vercel.json`, no Vercel-side workflow).                                                                                                         | Create Vercel project; `vercel link` in `apps/control-plane`; configure root directory + monorepo build command.           |
| BLOCKER  | Control-plane domain undocumented (`app.estalara.com`? `dashboard.estalara.com`? `control-plane.estalara.com`?).                                                                             | Architect decision; DNS + Vercel domain attachment.                                                                        |
| BLOCKER  | ~20 env vars referenced in source not in `.env.example`. Static pages will deploy; API routes will 500 on first call.                                                                        | Update `.env.example`; map to Vercel Project Env (Production/Preview/Development). Document in `docs/runbooks/secrets.md`. |
| BLOCKER  | Phase 1 defers ClickHouse/Redpanda/Upstash/Modal, but control-plane routes hard-require them (`/api/dashboard/analytics/*`, `/api/demo/ingest`, `/api/audit`, etc.). No feature flag exists. | Decide which routes are Phase-1-required; provide stubs OR feature-flag the routes off until Phase 2.                      |
| HIGH     | No Vercel deploy workflow in `.github/workflows/`.                                                                                                                                           | Pick Vercel Git integration (zero workflow) OR `vercel-action` GH workflow. Document.                                      |
| HIGH     | `@sentry/nextjs ^10.50.0` installed + config files exist, but `next.config.mjs` does NOT wrap export with `withSentryConfig` — source maps + tunnel route not configured.                    | Add `withSentryConfig` wrapper.                                                                                            |
| HIGH     | `transpilePackages` includes `@estalara/db` and `@estalara/auth` but not `@estalara/sdk`. If consumed from any route, Vercel may fail at runtime.                                            | Confirm `@estalara/sdk` is consumed; if yes, add to `transpilePackages`.                                                   |

### 7.4 Deploy scripts

- Root `package.json`: `dev:secrets` (`doppler run -- pnpm dev`); **no `deploy:*` scripts.**
- Per-app: ingest + decision-api have `"deploy": "wrangler deploy"`. control-plane has none.
- Wrangler is dev dep in both Worker apps (`^3.0.0` → resolved 3.114.17).
- Doppler used only in `dev:secrets` — **not in any deploy workflow.**

### 7.5 CI/CD

| Workflow             | Trigger                           | Purpose                                                                                                                                                        |
| -------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ci.yml`             | push (main/agent) + PR to main    | Lint, typecheck, Rule I, Node tests, Python tests (7 apps), build, control-plane build, format check, gitleaks, ClickHouse smoke, corpus gate, Rule H, SDK E2E |
| `deploy-staging.yml` | `workflow_dispatch` only (manual) | Deploys ingest + decision-api to Cloudflare staging via `cloudflare/wrangler-action@v3`. Sequential.                                                           |
| `e2e-smoke.yml`      | nightly cron + manual             | Local docker stack + wrangler dev + ClickHouse smoke                                                                                                           |
| `load-test.yml`      | (not inspected)                   | Load testing                                                                                                                                                   |
| `release.yml`        | push to main                      | Changesets release flow                                                                                                                                        |

- **Deploy workflow for Cloudflare:** Yes (staging only, manual trigger only).
- **Deploy workflow for Vercel/control-plane:** **NO.**
- **Secret injection:** GitHub Secrets only. Doppler is configured in repo but **NOT injected into
  deploy workflows**. Worker secrets never provisioned by any workflow step.
- **CI gates before deploy:** `deploy-staging.yml` has **no dependency on `ci.yml`** — can be
  triggered with red CI. No test/lint/typecheck gate.

### 7.6 Deployment runbook

- `docs/runbooks/cloudflare.md` — Excellent (438 lines: account setup, API tokens, Terraform,
  deploy, rollback, troubleshooting, monitoring, cost).
- `docs/runbooks/vendor-accounts.md` — Account creation guidance.
- `docs/runbooks/secrets.md` — Doppler.
- **No Vercel runbook.** No control-plane deploy runbook. Vercel mentioned only in
  `MASTER_DESIGN.md` (one rollback row) and `DECISIONS_2026-05-18_v2.md` (one mention).

**Missing:** Vercel project creation walkthrough; monorepo root-directory + build command;
env-var-to-Vercel-env mapping; Vercel↔Doppler integration choice; custom domain attachment + DNS;
preview-deploy strategy; rollback procedure; domain canonical decision (`.io` vs `.com`); KV
namespace provisioning order; production deploy workflow; secret provisioning order.

### 7.7 Domain configuration

- **Cloudflare side (wrangler.toml + `infra/terraform/cloudflare/dns.tf`):**
  `ingest{,-staging}.estalara.io`, `api{,-staging}.estalara.io`, `cdn{,-staging}.estalara.io`.
- **Source / decisions side:** `app.estalara.com` (MASTER_DESIGN + DECISIONS v2 + auto-detect
  fixture), `ingest.estalara.com` (SDK `core/config.ts:35` default), mixed emails (
  `dpo@estalara.io`, `infra@estalara.io`, `admin@estalara.io`, `noreply@contact.estalara.com`).
- **DNS doc:** Yes for Cloudflare Workers; **none for control-plane / Vercel / `app.estalara.com`.**

**Canonical-domain decision is unresolved.** Every wrangler.toml route, terraform `dns.tf`, runbook,
SDK default URL needs reconciliation. Pick one before any deploy.

### 7.8 Phase 1 deploy readiness verdict

**BLOCKERS (cannot deploy at all): 6** — domain decision, KV placeholders, CF zone unverified,
Vercel project missing, control-plane env-var drift, deferred-vendor coupling in control-plane
routes.

**HIGH-RISK: 7** — Worker secrets never provisioned, Doppler not in deploy workflows, deploy-staging
has no CI gate, no production workflows, missing `withSentryConfig`, stale `compatibility_date`,
Node 20 vs 22 mismatch.

**All three apps build clean today**, but **none can deploy to its target environment** without
resolving the 6 blockers. The two Workers are closer to ready (config skeleton exists). The
control-plane is furthest (no Vercel project, env-var gaps, deferred-vendor coupling).

---

## Section 8 — Risk Matrix & Phase 1 GO/NO-GO

### 8.1 BLOCKERs (must be resolved before Phase 1 starts)

Deduplicated across sections. 12 total.

| #   | Blocker                                                                                                                                                                                                                                                                                      | Sections                    | Why blocking                                                                                                                                                                                            | Est. fix                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| B1  | **Canonical domain decision unresolved.** `estalara.io` (wrangler/terraform/runbook) vs `estalara.com` (decision-doc/SDK source).                                                                                                                                                            | S7 #1, S7 §7.7              | Any deploy leaves SDK pointing at a domain CF doesn't route.                                                                                                                                            | 1h decision + 2h propagation across SDK/wrangler/terraform/runbook                                   |
| B2  | **`packages/db/migrations/meta/_journal.json` is desynchronized from disk.** 4 migrations (0003, 0004, 0005, 0007) silently skipped.                                                                                                                                                         | S3 §3.1, §3.2, §3.8         | Tables `tenant_site_schemas`, `ab_bandit_weights` never created; archetype + bandit seeds never run. Decision API + auto-onboarding + ML intent crash on missing tables.                                | 2h (rewrite journal, restore snapshots, add migration test against Supabase branch)                  |
| B3  | **SDK ↔ Ingest schema contract broken across 8 points.** Auth header (`Bearer` vs `X-Estalara-API-Key`), `scroll.depth.depth_percent` vs `pct`, `page.view.viewport` required+missing, URL fallback empty strings, 7 event types not in `EventSchema` union, `consent.granted` path skipped. | S4 §4.6                     | Every SDK request returns 401 today. After auth fix, every event still rejected by Zod. End-to-end signal "1 session → 1 event → 1 decision → visible in logs" (Phase 1 success criterion) cannot pass. | 6–8h (SDK fixes + register 7 new schemas in shared + 1 contract test)                                |
| B4  | **pino logger in `packages/shared/src/observability/logger.ts` is dragged into ingest Worker bundle.** Pino's worker_threads + fs.createWriteStream + SonicBoom incompatible with V8 isolates even under `nodejs_compat`.                                                                    | S2 BLOCKERs ×2              | Ingest Worker will throw at logger construction on cold start.                                                                                                                                          | 1–2h (swap to `console.log(JSON.stringify(...))` shim, keep API)                                     |
| B5  | **`apps/ingest/src/redpanda-producer.ts` lacks `if (!REDPANDA_REST_URL) return` guard.** Unlike sibling producers in decision-api/control-plane.                                                                                                                                             | S1 §1.1 findings 1+2+3      | Every successful POST /v1/events returns HTTP 503 to the SDK. Pipeline unusable.                                                                                                                        | 2–3h (early-exit guard + tests + Sentry breadcrumb)                                                  |
| B6  | **Cloudflare KV namespace IDs are literal `PLACEHOLDER_*` strings** in `apps/ingest/wrangler.toml` for staging and production.                                                                                                                                                               | S6 §6.7 #2, S7 §7.1         | `wrangler deploy` refuses to deploy.                                                                                                                                                                    | 1h (create KV namespaces or `terraform apply`, substitute IDs)                                       |
| B7  | **No Vercel project linked.** No `vercel.json`, no `.vercel/`, no Vercel-side workflow or runbook for control-plane.                                                                                                                                                                         | S7 §7.3, §7.6               | Phase 1 cannot deploy control-plane.                                                                                                                                                                    | 3–4h (create project + write `docs/runbooks/vercel.md` + monorepo build config)                      |
| B8  | **~20 env vars referenced in `apps/control-plane/src` not in any `.env.example`.** Many have silent-default fallbacks (`CLICKHOUSE_PASSWORD ?? ''`, `DEMO_MODE_JWT_SECRET ?? 'demo_jwt_secret_dev'`).                                                                                        | S6 §6.3, §6.7 #1+3, S7 §7.3 | Static pages deploy; API routes 500 on first call. Demo JWTs signed with literal default.                                                                                                               | 2h (update `.env.example` + remove dangerous fallbacks + map to Vercel env vars)                     |
| B9  | **`rls-policies.sql` never applied** — manual-apply file labeled "applied manually in Supabase Dashboard or via migration"; not wired into any migration or CI step.                                                                                                                         | S3 §3.3, §3.8 #4            | 5 CAT-A tables (`tenants`, `users`, `api_keys`, `consent_records`, plus `demo_sessions` w/ no policy anywhere) end Phase 1 with no RLS. Phase 3 trust-floor depends on these existing.                  | 2h (add `0012_rls_remaining_tables.sql` with idempotent `DROP POLICY IF EXISTS … ; CREATE POLICY …`) |
| B10 | **Cloudflare zone for the canonical domain not verified active.** Terraform never applied per Council 2.5 "zero services running"; no production CNAME/proxy records.                                                                                                                        | S7 §7.1 BLOCKER, §7.7       | Workers have nowhere to route requests from.                                                                                                                                                            | 1h (verify zone exists; if not, follow `cloudflare.md` §Account Setup)                               |
| B11 | **Phase 1 deferred vendors (ClickHouse, Redpanda, Upstash, Modal) are hard-required by multiple control-plane API routes.** No feature flag exists.                                                                                                                                          | S7 §7.3 BLOCKER             | `/api/dashboard/analytics/*`, `/api/demo/ingest`, `/api/audit`, `/api/adapt/description` will degrade silently or fail. Phase 1 demo surface limited.                                                   | 3–5h (decide which routes are Phase-1-required; stub or feature-flag the rest)                       |
| B12 | **DEMO_MODE_JWT_SECRET fallback** `?? 'demo_jwt_secret_dev'` at `apps/control-plane/src/app/api/demo/sessions/route.ts:42`.                                                                                                                                                                  | S6 §6.5, §6.7 #1            | If env missing in prod, demo JWTs are signed with a known literal string. (Also covered by B8.)                                                                                                         | 30min (remove fallback or hard-throw on missing)                                                     |

**Total estimated BLOCKER fix budget:** **~25–35 hours of focused work.**

### 8.2 HIGH-RISK areas (focus the 2-week failure budget here)

| #   | Area                                                                                                                          | Sections                            | Why high-risk                                                                                              |
| --- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| H1  | Worker secrets (`SENTRY_DSN_INGEST`, `OTEL_EXPORTER_HEADERS`, `ADAPT_API_KEY`) never provisioned by any deploy workflow step. | S7 §7.1 HIGH, §7.2 HIGH, §7.4, §7.5 | Workers boot but auth + observability are broken.                                                          |
| H2  | Doppler not piped into deploy workflows; raw GitHub Secrets used everywhere.                                                  | S7 §7.5                             | Documented Doppler strategy is aspirational; secret drift between repo .env.example and Doppler dashboard. |
| H3  | `deploy-staging.yml` has no dependency on `ci.yml` — can be triggered with red CI.                                            | S7 §7.5                             | First Phase 1 deploy could go out from a broken main.                                                      |
| H4  | LLM daily-cap circuit breaker silently disabled (`apps/control-plane/src/lib/llm-gateway.ts:88-118` fail-open).               | S1 §1.3 #5                          | Uncapped Anthropic spend if `/api/adapt/description` Tier 2/3 traffic happens.                             |
| H5  | DSR audit log writes to ClickHouse — ClickHouse deferred, so audit trail absent for any real DSR request during Phase 1.      | S1 §1.3 #2                          | Compliance risk if any DSR comes in pre-Phase 3.                                                           |
| H6  | `archetype_embeddings` table empty (seed 0005 skipped).                                                                       | S3 §3.5, §3.8 #3                    | Intent engine returns zero archetypes. (Covered by B2 but lives on after journal fix until seed runs.)     |
| H7  | Mixed RLS JWT-claim patterns (`auth.jwt()` in 0004/0006 vs `current_setting(...)` in 0011).                                   | S3 §3.3, §3.8 #4                    | Pattern confusion; maintenance debt; Phase 3 work assumes one pattern.                                     |
| H8  | `CREATE POLICY` not idempotent in 0004/0006/0008/0009/0011; `0011 ADD CONSTRAINT` not idempotent.                             | S3 §3.2, §3.8 #2+3                  | Re-run via psql fails. Drizzle history protects only if Drizzle is the only path that ever touches the DB. |
| H9  | Journal `when` timestamp inversion (2025 entries after 2026 entries).                                                         | S3 §3.1, §3.8 #5                    | Corruption hazard once history isn't fresh — incremental migrations could be skipped.                      |
| H10 | Per-event-type Python schema validation missing (`EventEnvelope` accepts `dict[str, Any]` payload).                           | S4 §4.6 deferred-vendor risk        | Once Modal activates (Phase 2+), malformed payloads silently land in ClickHouse.                           |
| H11 | No cross-cutting contract test between SDK producer and `EventSchema`.                                                        | S4 §4.4                             | Re-introduces drift the moment B3 is fixed.                                                                |
| H12 | `next.config.mjs` missing `withSentryConfig` wrapper despite `@sentry/nextjs` installed.                                      | S7 §7.3 HIGH                        | Source maps + tunnel route not configured; prod errors hard to diagnose.                                   |
| H13 | `apps/data-quality` `REDPANDA_USERNAME` vs everyone else's `REDPANDA_SASL_USERNAME`.                                          | S6 §6.1 inconsistency, §6.7 W1      | Cron silently sends empty creds when Modal activates.                                                      |
| H14 | `apps/decision-api` fire-and-forget `void (async () => {})()` for ab-event publish without `ctx.waitUntil()`.                 | S2 §2.2 INFO                        | Isolate recycle may cancel pending promises; Redpanda emits silently dropped.                              |
| H15 | No production deploy workflow for Workers or Vercel.                                                                          | S7 §7.1, §7.2 MEDIUM                | Phase 1 production cut becomes a manual ceremony with no required-reviewer gate.                           |
| H16 | `compatibility_date = 2026-04-26` (22 days stale) on both Workers.                                                            | S7 §7.1, §7.2 HIGH                  | Not breaking, but should bump in the activation PR.                                                        |
| H17 | Single-isolate in-memory LLM spend tracker (`apps/decision-api/src/lib/llm-gateway.ts:33`).                                   | S2 §2.2 WARNING                     | Drastically under-enforced spend cap until Sprint 9 moves to Upstash.                                      |

### 8.3 MEDIUM-RISK areas (quick fixes during 2-week stabilization)

- `compatibility_date` bump on both wrangler.toml (covered above)
- `deploy-staging.yml` Node 20 → Node 22 alignment
- Per-app deploy job for production (require manual trigger + reviewer)
- `transpilePackages` may need `@estalara/sdk` if consumed from control-plane routes
- Prune unused `@opentelemetry/sdk-trace-base/-node/-web` deps from `packages/shared/package.json`
- Wire `GIT_SHA`/`LOG_LEVEL` into both `wrangler.toml` `[vars]` so `process.env` polyfill surfaces
  them
- Trim 3-retry exponential backoff in `redpanda-producer.ts` (eats latency budget)
- Reconcile seed sources: SQL `0005_seed_archetype_embeddings.sql` confidence values vs TS
  `archetype-seeds.ts` confidence values (different thresholds today)
- `apps/ingest/src/observability.ts:80` defaulting `ENVIRONMENT` to `'development'` masks misconfig
- `apps/control-plane/.env.local` exists on disk (gitignored) — confirm not bundled in any container
  image

### 8.4 LOW-RISK areas (code looks compatible — no action needed)

- Both Worker apps' core code is 95% Web Platform clean (zero Node imports outside the pino chain).
- R2 — zero runtime coupling; fully deferrable.
- Modal — zero hard deps in TypeScript runtime; deferring = not deploying.
- ClickHouse — all TS call sites guarded.
- Auth crypto in ingest uses Web Crypto correctly (`crypto.subtle.importKey/sign`,
  `crypto.randomUUID`, `btoa`).
- DO `RATE_LIMITER` uses first-class Workers Storage API.
- Fixture loading: pure test artifacts; never enter production bundles.
- `.gitignore` + `.gitleaks.toml` are comprehensive; no committed credentials.
- `packages/shared/src/schemas/` is centralized and rigorous (37 event types in discriminated
  union).
- Drizzle TS schema and SQL migrations match for all 10 tables that DO migrate via the journal.

### 8.5 Phase 1 GO/NO-GO recommendation

**Verdict: CONDITIONAL GO.**

The 5-vendor minimum-viable activation plan (Cloudflare Worker + Supabase + Vercel + Doppler + DNS;
defer Redpanda/Modal/ClickHouse/R2) **remains feasible**. None of the 12 blockers requires a
strategic re-scope or vendor swap. All 12 are tractable code/config/doc fixes totaling **~25–35
hours of focused work**.

However, **Phase 1 cannot start today.** Attempting activation in the current state will:

- Crash on cold start (B4 pino).
- Return 401 to every SDK request (B3 auth header), and then 503 to every request that survives (B5
  Redpanda).
- Crash on database queries to missing tables (B2 journal).
- Lack a deploy target for the control-plane (B7 Vercel).
- Have nowhere to route requests (B1 domain + B10 zone).

**Recommendation:** Insert a **Phase 0.5 — Activation Pre-Flight** between this audit and Phase 1
activation. Time-box to **1 week (5 working days × 5–8 hours)** to clear the 12 blockers. After that
the Phase 1 minimum-viable activation can begin per DECISIONS_2026-05-18_v2 plan.

This is fully consistent with Council 2.5's "2-week failure budget" guidance — that budget was sized
for runtime breakage _during_ Phase 2 (weeks 3–4). Phase 0.5 is preventive: 1 week pre-flight spent
here is 1–2 weeks not spent firefighting in Phase 2.

### 8.6 Recommended first 5 implementation tickets (post-audit)

In strict dependency order. Each ticket is sized to a single working day or less.

1. **TICKET-RUNTIME-FIX-001 — Domain canonical decision + propagation** (B1, B10)
   - Architect+CEO ADR locking `.io` or `.com` as the canonical hostname.
   - Update `packages/sdk/src/core/config.ts:35`, both `wrangler.toml` files (staging + production
     routes), `infra/terraform/cloudflare/dns.tf`, `docs/runbooks/cloudflare.md`, control-plane
     `.env.example`.
   - Verify CF zone exists; if not, set it up per `cloudflare.md` §Account Setup.
   - Acceptance: single grep across repo finds zero references to the non-canonical domain in
     runtime config/code.

2. **TICKET-RUNTIME-FIX-002 — Migration journal repair + RLS gap closure** (B2, B9)
   - Rewrite `packages/db/migrations/meta/_journal.json` to include all 12 entries with monotonic
     `when` timestamps.
   - Restore missing snapshot files (0003, 0004, 0005, 0006, 0007, 0008, 0009, 0010) or document
     acceptance of Drizzle hygiene loss.
   - Author `0012_rls_remaining_tables.sql` applying contents of
     `packages/db/src/schema/rls-policies.sql` plus policies for `demo_sessions`,
     `session_embeddings`, `tenant_site_schemas`. Wrap every `CREATE POLICY` with
     `DROP POLICY IF EXISTS …; CREATE POLICY …`.
   - Apply migration set against a Supabase preview branch via MCP tools to validate end-to-end.
   - Acceptance: fresh Supabase branch reaches expected schema state; all 15 tables present; all 15
     minus the 3 intentional exceptions have RLS policies.

3. **TICKET-RUNTIME-FIX-003 — SDK ↔ Ingest schema reconciliation + contract test** (B3, H11)
   - Fix `packages/sdk/src/core/events.ts`: header → `X-Estalara-API-Key`; payload field
     `depth_percent` → `pct`; add required `viewport` to `page.view` payload; replace empty-string
     URL fallbacks with `undefined`; map `'consented'` correctly through `dispatchEvents`.
   - Add per-type Zod schemas for `listing.viewed`, `cta.clicked`, `quiz.event`, `quiz.mismatch`,
     `sidebar.closed`, `adapt.applied`, `adapt.skipped` in `packages/shared/src/schemas/events/` and
     add to `EventSchema` discriminated union.
   - Add `tests/contract/sdk-emits-valid.test.ts` that pipes every SDK emission site through
     `EventSchema.safeParse()` and fails CI on any rejection.
   - Acceptance: contract test passes; existing SDK unit tests updated (currently encode the drift);
     smoke test `tests/e2e/smoke-ingest.test.ts` exercises a real SDK call path.

4. **TICKET-RUNTIME-FIX-004 — Worker-safe logger + ingest no-bus guard** (B4, B5)
   - Replace pino in `packages/shared/src/observability/logger.ts` with a Worker-safe
     `console.log(JSON.stringify(...))` shim. Keep `createLogger(serviceName)` signature so
     consumers unchanged.
   - Add `if (!env.REDPANDA_REST_URL) return { ok: true, attempts: 0 };` to top of
     `apps/ingest/src/redpanda-producer.ts:pushToRedpanda`. Set `REDPANDA_REST_URL = ""` in
     `apps/ingest/wrangler.toml` `[vars]`. Add Sentry breadcrumb `events_dropped_no_bus`.
   - Add unit tests: logger constructs in Worker-like env (no pino); ingest no-bus path returns
     `{ ok: true }` and HTTP 200.
   - Acceptance: Worker bundle no longer contains pino; ingest serves 200s when no Redpanda URL
     configured.

5. **TICKET-RUNTIME-FIX-005 — Vercel project + control-plane env discipline + Phase 1 route gating**
   (B7, B8, B11, B12, H1, H2)
   - Create Vercel project, `vercel link` in `apps/control-plane`, set monorepo root directory +
     build command, map every `process.env.*` consumed in source to Vercel Project Env.
   - Author `docs/runbooks/vercel.md` (project setup, env-var matrix, domain attachment, rollback).
   - Update `apps/control-plane/.env.example` and root `.env.example` to list every var grep'd in
     source.
   - Remove `?? 'demo_jwt_secret_dev'` fallback (hard-throw if missing); fix `data-quality`
     `REDPANDA_USERNAME/PASSWORD` to use `REDPANDA_SASL_*` everywhere.
   - Add a feature-flag middleware (or env-gated 503 responder) for the deferred-vendor routes
     (`/api/dashboard/analytics/*`, `/api/demo/ingest`, `/api/audit`, `/api/adapt/description`) that
     short-circuits to a documented "Phase 1 unavailable" response when the relevant vendor env vars
     are empty.
   - Wire Doppler into both Worker deploy workflows (`doppler-cli` action +
     `doppler run -- wrangler deploy`) and into the Vercel project via the native Vercel↔Doppler
     integration.
   - Acceptance: control-plane deploys to Vercel preview; deferred-vendor routes return documented
     503 with metric; Doppler is the single source of truth for every secret.

After these 5 tickets, the remaining HIGH-RISK + MEDIUM items can be promoted into the Phase 2
"breakage stabilization" sprint (Council 2.5 weeks 3–4). Phase 1 activation can proceed.

---

## Appendix A — Files referenced (absolute paths)

**Section 1:**

- `apps/ingest/src/redpanda-producer.ts`
- `apps/ingest/src/handlers/events.ts`
- `apps/ingest/src/types.ts`
- `apps/ingest/wrangler.toml`
- `apps/ingest/src/middleware/error-handler.ts`
- `apps/decision-api/src/lib/redpanda-producer.ts`
- `apps/decision-api/src/lib/ab-events.ts`
- `apps/decision-api/src/app/api/adapt/route.ts`
- `apps/decision-api/src/index.ts`
- `apps/control-plane/src/lib/ab-events.ts`
- `apps/control-plane/src/app/api/adapt/description/route.ts`
- `apps/control-plane/src/app/api/adapt/route.ts`
- `apps/control-plane/src/app/api/dsr/_clickhouse.ts`
- `apps/control-plane/src/app/api/dashboard/analytics/summary/route.ts`
- `apps/control-plane/src/app/api/dashboard/analytics/lift/route.ts`
- `apps/control-plane/src/lib/llm-gateway.ts`
- `apps/stream-consumer/src/main.py`
- `apps/stream-consumer/src/consumers/events.py`
- `apps/stream-consumer/src/redpanda_client.py`
- `apps/stream-consumer/src/clickhouse_client.py`
- `apps/data-quality/src/crons/schema_validation.py`
- `apps/llm-gateway/src/jobs/generate_description.py`
- `infra/terraform/cloudflare/r2.tf`
- `infra/terragrunt.hcl`

**Section 2:**

- `apps/ingest/src/observability/logger.ts`
- `apps/ingest/src/observability.ts`
- `apps/ingest/src/auth.ts`
- `apps/ingest/src/index.ts`
- `apps/ingest/src/rate-limiter.ts`
- `apps/decision-api/src/lib/llm-gateway.ts`
- `apps/decision-api/src/lib/bandit.ts`
- `apps/decision-api/src/lib/ab-assignment.ts`
- `packages/shared/src/observability/logger.ts`
- `packages/shared/src/observability/tracer.ts`
- `packages/shared/src/observability/error.ts`
- `packages/shared/package.json`

**Section 3:**

- `packages/db/migrations/meta/_journal.json`
- `packages/db/migrations/0000_soft_secret_warriors.sql`
- `packages/db/migrations/0001_tidy_quasar.sql`
- `packages/db/migrations/0002_goofy_spencer_smythe.sql`
- `packages/db/migrations/0003_tenant_site_schemas.sql`
- `packages/db/migrations/0004_ab_bandit_weights.sql`
- `packages/db/migrations/0005_seed_archetype_embeddings.sql`
- `packages/db/migrations/0006_answers.sql`
- `packages/db/migrations/0007_seed_ab_bandit_weights.sql`
- `packages/db/migrations/0008_schema_validation_history.sql`
- `packages/db/migrations/0009_tenant_compliance_records.sql`
- `packages/db/migrations/0010_tenant_consent_required.sql`
- `packages/db/migrations/0011_aromatic_triton.sql`
- `packages/db/src/schema/rls-policies.sql`
- `packages/db/scripts/migrate.ts`
- `packages/db/src/seed/archetype-seeds.ts`
- `packages/db/drizzle.config.ts`

**Section 4:**

- `packages/sdk/src/core/events.ts`
- `packages/sdk/src/core/observer.ts`
- `packages/sdk/src/core/adapt.ts`
- `packages/sdk/src/index.ts`
- `packages/sdk/src/core/config.ts`
- `apps/ingest/src/handlers/events.ts`
- `packages/shared/src/schemas/event.ts`
- `packages/shared/src/schemas/events/index.ts`
- `packages/shared/src/schemas/events/*.ts` (13 per-type files)
- `apps/stream-consumer/src/models/event.py`
- `tests/e2e/smoke-ingest.test.ts`
- `tests/e2e/fixtures/sample-events.json`
- `docs/adr/0003-event-schema-and-versioning.md`

**Section 5:**

- `packages/sdk/src/auto-detect/__fixtures__/` (49 files)
- `packages/sdk/src/auto-detect/test-utils.ts`
- `packages/sdk/src/auto-detect/__tests__/corpus.test.ts`
- `packages/sdk/tsup.config.ts`

**Section 6:**

- `doppler.yaml`
- `.env.example`
- `apps/control-plane/.env.example`
- `apps/decision-api/.env.example`
- `apps/ingest/wrangler.toml`
- `apps/decision-api/wrangler.toml`
- `apps/control-plane/src/app/api/demo/sessions/route.ts:42`
- `apps/ingest/src/observability.ts:80`
- `apps/stream-consumer/src/redpanda_client.py`
- `apps/stream-consumer/src/clickhouse_client.py`
- `.gitignore`
- `.gitleaks.toml`

**Section 7:**

- `apps/ingest/wrangler.toml`
- `apps/ingest/package.json`
- `apps/decision-api/wrangler.toml`
- `apps/decision-api/package.json`
- `apps/control-plane/package.json`
- `apps/control-plane/next.config.mjs`
- `apps/control-plane/.env.example`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-staging.yml`
- `.github/workflows/release.yml`
- `docs/runbooks/cloudflare.md`
- `docs/runbooks/vendor-accounts.md`
- `docs/runbooks/secrets.md`
- `infra/terraform/cloudflare/dns.tf`

## Appendix B — Investigation method

This audit was produced by 6 parallel read-only research agents dispatched from a single
PM-orchestrated session:

- Section 1 — vendor coupling (4 deferred vendors × every call site)
- Section 2 — Worker compatibility (static analysis of both Worker apps + transitive shared)
- Section 3 — DB migrations (every SQL file + journal + Drizzle drift)
- Section 4 — event schema contract (SDK ↔ Ingest ↔ Python consumer)
- Sections 5 + 6 — fixtures + secrets (combined agent)
- Section 7 — build + deploy readiness (ran `pnpm install` + each app's build, non-destructive)
- Section 8 — synthesis (this section, written by the PM)

No code, schema, or deploy state was modified. The audit is reproducible by re-running the same six
investigations against the same commit.
