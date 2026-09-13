# Audit report A — production flow hop-by-hop (Area 1) + responsibility split (Area 2)

Repo `/home/asipi/Projects/Adaptive-Listings`, branch `main` @ `f510f749`. Read-only. All
`path:line` anchors are at that HEAD.

---

## AREA 1 — The hop table

Transport/auth column: **the credential actually checked in code**, not the documented one. "Tested
by" names the highest-fidelity harness that exercises the hop; a mock-backed test is labelled as
such.

| #   | Hop                                                   | Implementing files                                                                                                                                                                                           | Invoked by                                                                                                         | Transport + auth                                                                                                                                                                              | Tested by                                                                                                                           | Status                                                                                                                       |
| --- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 1   | SDK boot / config / consent                           | `packages/sdk/src/index.ts:337` `init()`, `core/config.ts`, `ui/consent-banner.ts`, `core/consent-text.ts`                                                                                                   | `<script src=".../sdk.js">` from `buildSnippet()` (`components/onboarding/DetectionPreview.tsx:183-185`)           | static asset over HTTPS; no auth                                                                                                                                                              | `packages/sdk/e2e/consent.spec.ts`, `sdk.spec.ts` (Playwright, local fixture)                                                       | **CONFIRMED**                                                                                                                |
| 1b  | SDK bundle delivery                                   | `apps/control-plane/scripts/copy-sdk-bundle.mjs` → `public/sdk.js`; URL pinned at `packages/shared/src/domains.ts:57`                                                                                        | Vercel build (`apps/control-plane/package.json:7`)                                                                 | static; hard-fails build if `packages/sdk/dist` missing (`copy-sdk-bundle.mjs:45-56`)                                                                                                         | required check `Served SDK bundles build-generated (ESC-047)`                                                                       | **CONFIRMED** (was the FOLLOW-808 hole; closed)                                                                              |
| 1c  | Dev-only SDK route                                    | `apps/control-plane/src/app/api/sdk/route.ts`                                                                                                                                                                | nothing in prod (snippet points at `/sdk.js`)                                                                      | none                                                                                                                                                                                          | none                                                                                                                                | **PARTIAL** — returns HTTP 200 + `// SDK not built yet` on read failure (`route.ts:22-25`); fail-open, but off the prod path |
| 2   | SDK → ingest events                                   | `packages/sdk/src/core/events.ts:60-104` `dispatchEvents()`; `apps/ingest/src/handlers/events.ts`, `router.ts`, `index.ts`                                                                                   | `setInterval(flush, BATCH_INTERVAL_MS)` `index.ts:2006`; `visibilitychange`/`beforeunload` `index.ts:2019-2030`    | `POST {ingestUrl}` JSON, header `X-Estalara-API-Key` (`events.ts:90`), optional `hmac-sha256:` body signature; key looked up in Cloudflare KV `api_key:<raw>` (`apps/ingest/src/auth.ts:75`)  | `tests/e2e/smoke-ingest.test.ts` via `.github/workflows/e2e-smoke.yml` (real wrangler + real ClickHouse) — **NOT a required check** | **PARTIAL** → see A1-2                                                                                                       |
| 3   | ingest → ClickHouse `events`                          | `apps/ingest/src/clickhouse-producer.ts:159-233`, `handlers/events.ts:600-640`                                                                                                                               | post-ACK `ctx.waitUntil` (`wait-until.ts`, `events.ts:~607`)                                                       | ClickHouse HTTP `INSERT … FORMAT JSONEachRow`, basic auth; DateTime64 emitted zone-less space-separated (`clickhouse-producer.ts:160`)                                                        | `e2e-smoke` (real), `clickhouse-producer.test.ts`                                                                                   | **CONFIRMED**                                                                                                                |
| 3b  | terminal-failure durability (ADR-0017)                | `apps/ingest/src/events-retry-queue.ts`, `handlers/events-retry-consumer.ts`, `index.ts` `queue()`; bindings `apps/ingest/wrangler.toml:74-88,159`                                                           | `pushToClickHouse` terminal failure                                                                                | Cloudflare Queues `estalara-events-retry` → DLQ `estalara-events-retry-dlq`                                                                                                                   | `events-retry-queue.test.ts`, `events-retry-consumer.test.ts` (unit)                                                                | **CONFIRMED in code**; queue provisioning is an operator step (FOLLOW-512)                                                   |
| 4   | ingest → `intent_events` + Supabase `intent_sessions` | `apps/ingest/src/handlers/intent-snapshot.ts:171-180, 300-302`                                                                                                                                               | `intent.snapshot` event in the same batch                                                                          | CH HTTP insert; Supabase PostgREST upsert                                                                                                                                                     | unit tests in `apps/ingest/src/handlers/__tests__`                                                                                  | **CONFIRMED**                                                                                                                |
| 5   | ingest → Modal intent-engine (chat NLP)               | `apps/ingest/src/handlers/chat-nlp-dispatch.ts:105-130`; `apps/intent-engine/src/main.py:121-181` `chat_nlp_endpoint`, `nlp.py`, `redis_writer.py`                                                           | `chat.message.sent` in a batch, inside `waitUntil` (`events.ts:531-556`)                                           | `POST $MODAL_CHAT_NLP_URL`, `Authorization: Bearer $INTERNAL_API_SECRET`; no-op when URL unset (`chat-nlp-dispatch.ts:105`)                                                                   | `tests/integration/redis-shadow-round-trip.smoke.test.ts` (required check); Python unit tests                                       | **PARTIAL** — prod `MODAL_CHAT_NLP_URL` + traffic proof still open (FOLLOW-820 cond. 3, FOLLOW-892)                          |
| 6   | Redpanda → stream-consumer → ClickHouse               | `apps/stream-consumer/src/**` (consumer, redpanda_client, models)                                                                                                                                            | **NOTHING** — the ingest mirror was deleted (`apps/ingest/src/handlers/events.ts:560-566`), `ab-events.ts` deleted | n/a                                                                                                                                                                                           | `Test (Python) (3.12, stream-consumer)` = required check `.github/required-checks.txt:97`                                           | **DEAD** → A1-3                                                                                                              |
| 7   | decision-api Worker "edge holdout gate"               | `apps/decision-api/src/index.ts:69`, `src/app/api/adapt/route.ts` (410 Gone); dead libs `lib/{ab-assignment,bandit,consent-gate,llm-gateway,reorder}.ts` (1,090 LOC)                                         | nothing; SDK points at control-plane                                                                               | `POST /api/adapt` → **410**; `GET /api/health`                                                                                                                                                | `src/__tests__/adapt.test.ts` asserts the 410                                                                                       | **RETIRED-IN-PLACE / DEAD** → A1-4                                                                                           |
| 8   | SDK → canonical adapt (POST)                          | `packages/sdk/src/core/adapt.ts:1216-1290` `fetchDirectives()`; `apps/control-plane/src/app/api/adapt/route.ts:1486` `POST`                                                                                  | `refreshDirectives()` `packages/sdk/src/index.ts:862`                                                              | `POST {decisionApiUrl}/adapt`, `Authorization: Bearer <apiKey>`; server accepts demo HS256 JWT **or** SHA-256(bearer)→Postgres `api_keys` (`lib/api-key-auth.ts`)                             | FOLLOW-819 harness (real); `packages/sdk/e2e/adapt-dom-mutations.spec.ts` uses a **mocked** decision API                            | **CONFIRMED**                                                                                                                |
| 8b  | canonical adapt (GET)                                 | `route.ts:1036-1416`                                                                                                                                                                                         | **NOTHING** in prod (only a liveness ping, `tests/e2e/sprint-9-5-demo.spec.ts:211`)                                | `GET /api/adapt`, `resolveAdaptGetAuth` (ops key or tenant key)                                                                                                                               | `route.*.test.ts` units                                                                                                             | **DEAD + DUPLICATED + DIVERGENT** → A1-1                                                                                     |
| 9   | playbook selection                                    | `packages/sdk/src/core/playbooks/` (18 archetype files) via `getPlaybook()` (`route.ts:55,347`)                                                                                                              | `runDecisionTree()` `route.ts:281`                                                                                 | in-process import                                                                                                                                                                             | many unit tests; `Archetype seeds completeness check`                                                                               | **CONFIRMED**                                                                                                                |
| 9b  | RAG (agency FAQ, pgvector)                            | `apps/control-plane/src/lib/rag-retrieval.ts`; call site `route.ts:1883-1887`                                                                                                                                | POST only, and only when `body.intent_vector` is a non-empty array                                                 | Postgres `answers.question_embedding vector(1536)`, cosine `<=>`                                                                                                                              | unit tests only                                                                                                                     | **DEAD from the SDK path** → A1-5                                                                                            |
| 9c  | grounding (listing facts)                             | `lib/listing-facts-context.ts` (`withListingFacts`, `hasListingFacts`), `lib/ungrounded-directives.ts`, `lib/placeholder-tokens.ts`; `route.ts:1904-1919, 414-450, 592-600`                                  | POST only (`withListingFacts` has a single call site, `route.ts:1904`)                                             | internal HTTP listing-details fetch + in-process withhold                                                                                                                                     | `Adapt LLM-source canary` (required check), `tests/integration/adapt-llm-source-live.smoke.test.ts`                                 | **CONFIRMED for POST**, absent on GET (A1-1)                                                                                 |
| 9d  | LLM rewrite                                           | `apps/control-plane/src/lib/llm-gateway.ts:32` `import Anthropic` — **direct Anthropic SDK**, Haiku tweak / global-model full-gen; cap via ClickHouse `llm_calls`                                            | `callLlmGateway()` `route.ts:520,559`                                                                              | HTTPS to Anthropic, `ANTHROPIC_API_KEY`                                                                                                                                                       | 23 suites under `src/app/api/adapt/`; live canary                                                                                   | **CONFIRMED** (but not via LiteLLM and not via `apps/llm-gateway` — A2-2)                                                    |
| 9e  | affinity / reorder ranking                            | `route.ts:879-1035` (`deterministicScore`, `affinityScore`, `buildReorderDirective`), `lib/embedding-lookup.ts` (1024-dim)                                                                                   | POST only, needs `tenant_site_schemas` row + `listing_ids`                                                         | Postgres `listing_embeddings`/`archetype_embeddings` `vector(1024)`                                                                                                                           | `Archetype embeddings not-NULL check`                                                                                               | **PARTIAL** — `scoring_path='cosine'` has zero observations anywhere (FOLLOW-1071)                                           |
| 10  | adapt → ClickHouse `adaptation_decisions`             | `route.ts:635-830` `logDecisionAsync()`                                                                                                                                                                      | POST `route.ts:1836,2156`; GET `route.ts:1375`                                                                     | CH HTTP parameterised INSERT; `scoring_path` appended only when `SCORING_PATH_COLUMN_ENABLED === 'true'` (`route.ts:736`)                                                                     | FOLLOW-819 AC(3); `Tracer query-builders live ClickHouse guard`; `/api/canary/adaptation-writes`                                    | **PARTIAL** → A1-6                                                                                                           |
| 11  | directives → DOM                                      | `packages/sdk/src/core/adapt.ts:1446` `applyDirectives()`, `:816` text, `:1019` reorder; `core/annotate-slots.ts`; floor gate `core/adapt-floor.ts` + `index.ts:1060-1064`                                   | `refreshDirectives()`                                                                                              | in-page DOM writes, MutationObserver re-assert                                                                                                                                                | `packages/sdk/e2e/adapt-dom-mutations.spec.ts` (**mock** decision API, required check `SDK E2E tests`); FOLLOW-819 AC(2) (real)     | **CONFIRMED**                                                                                                                |
| 11b | description axis                                      | `apps/control-plane/src/app/api/adapt/description/route.ts`; `packages/sdk/src/core/adapt-description.ts`; Modal `apps/llm-gateway/src/jobs/generate_description.py`                                         | SDK when `signal_count >= 5` or `confidence >= 0.5`                                                                | `GET /api/adapt/description`; dispatch `POST $MODAL_DESCRIPTION_URL` Bearer `INTERNAL_API_SECRET` (ADR-0016)                                                                                  | unit + `description-floor.spec.ts`                                                                                                  | **PARTIAL** — known P1 prompt-text disclosure on the public GET (FOLLOW-1169)                                                |
| 12  | outcome → feedback → bandit                           | `packages/sdk/src/core/adapt.ts:50-190` feedback ping; `apps/control-plane/src/app/api/adapt/feedback/route.ts`                                                                                              | `registerFeedbackListener()` `adapt.ts:1316` on outcome event                                                      | `POST /api/adapt/feedback`, `Authorization: Bearer <apiKey>` + `X-Estalara-Signature` HMAC + Redis nonce replay guard (ADR-0015); **gated by `FEEDBACK_ENDPOINT_ENABLED==='true'`, else 503** | FOLLOW-819 AC(4) (real, needs `DATABASE_URL_ADMIN`); unit tests                                                                     | **PARTIAL** → A1-7                                                                                                           |
| 13  | analytics rollup + dashboards                         | `apps/control-plane/src/app/api/admin/analytics/rollup/{route,data}.ts`; `/api/dashboard/analytics/{lift,summary}`, `/api/pilot/{cta-lift,inquiry-starts,calibration}`; pages `src/app/{admin,dashboard}/**` | admin UI + FOLLOW-819 AC(5)                                                                                        | CH HTTP reads; staff auth `verifyTracerAdminAuth` (Bearer `ADMIN_API_SECRET`)                                                                                                                 | FOLLOW-819 AC(5); `data.test.ts`, `route.test.ts`                                                                                   | **PARTIAL** → A1-8                                                                                                           |
| 14  | embed seeding                                         | `apps/control-plane/src/lib/listing-embed-seed-publisher.ts` → Modal `consume_embed_seed_requests.py` → `POST /api/listings/embed` (OpenAI `text-embedding-3-small` @1024, `route.ts:7,51,184`)              | `webhooks/listing-updated`, seed scripts                                                                           | `POST $MODAL_EMBED_SEED_URL` Bearer; then `INTERNAL_API_SECRET` back to control-plane                                                                                                         | Python + TS unit tests, `modal-embed-seed-consumer-golive.md` runbook                                                               | **CONFIRMED in code**, operator-gated in prod                                                                                |
| 15  | schema-drift cron                                     | `apps/data-quality/src/crons/schema_validation.py` (874 LOC), deployed as `estalara-schema-validation` (`modal-deploy.yml:85`)                                                                               | Modal cron                                                                                                         | Postgres + HTTP fetch                                                                                                                                                                         | `Test (Python) (3.12, data-quality)`; `any-state Assert validate_schemas ran in the last 26h (prod)`                                | **CONFIRMED**                                                                                                                |

### Hops that are stubs / dead / duplicated, summarised

- **Stub:** hop 1c (`/api/sdk` fail-open), `apps/data-quality/src/main.py` (A2-3),
  `packages/{sdk-loader,sdk-react,sdk-vue,compliance,intent-ontology}` and
  `packages/platform-templates` L3 (A2-1).
- **Dead (no caller):** hop 6 (stream-consumer), hop 7 (decision-api + its 5 libs), hop 8b
  (`GET /api/adapt`), hop 9b (RAG), `intent-engine/src/jobs/batch_enrich.py`, the two Redpanda
  pollers in `apps/llm-gateway`, ClickHouse `session_quality` (no producer) and `session_summary`
  (no reader).
- **Duplicated:** two adapt handlers in one file (POST/GET, A1-1); two tenant-API-key registries (KV
  vs Postgres, A1-2); two bandit implementations (`packages/shared/src/bandit.ts` live vs
  `apps/decision-api/src/lib/bandit.ts` dead — FOLLOW-045); two consent gates; two reorder builders;
  two things named "llm-gateway" (A2-2).

---

## AREA 1 findings

### A1-1 — `GET /api/adapt` is a second, uncalled adapt implementation that writes real `adaptation_decisions` rows without the grounding and page-type guards POST has

- **Claim.** `apps/control-plane/src/app/api/adapt/route.ts` exports two full decision handlers.
  `POST` (`:1486`) is the only one the SDK calls (`packages/sdk/src/core/adapt.ts:1280`
  `method: 'POST'`). `GET` (`:1036-1416`) has no production caller, yet it runs `runDecisionTree`,
  `assignHoldout`, `thompsonSample` and `logDecisionAsync` — and it passes `{}` for
  `listingContext`, omits `groundingMissing`, omits `listingId`, and never calls
  `filterDirectivesByPageType`.
- **Status.** CONFIRMED (dead + duplicated + divergent).
- **Evidence.**
  - `route.ts:1305-1320` —
    `await runDecisionTree(archetypeId, confidence, similarity, sessionId, tenantId, locale, {}, undefined, getHandlerVariant)`:
    positional arg 7 is `{}`, and args 10-11 (`groundingMissing`, `listingId`) are not passed.
  - `route.ts:1904` — `withListingFacts(...)` has exactly one call site, in POST. `route.ts:1999` —
    `filterDirectivesByPageType(...)` likewise.
  - `route.ts:1375` — GET calls `logDecisionAsync(...)`, so its decisions land in the same table the
    pilot measures from.
  - Callers: `grep -rn "api/adapt" scripts tests` finds only `tests/e2e/sprint-9-5-demo.spec.ts:211`
    (`fetch(..., { method: 'GET' })` liveness ping). Nothing in `packages/sdk`,
    `apps/control-plane/src/app/dashboard`, or `apps/control-plane/public` issues a GET.
  - Mitigation that exists: `withholdUngroundedDirectives` is inside `runDecisionTree`
    (`route.ts:441,592`), so GET's LLM branches withhold rather than serve ungrounded copy — which
    is also why GET is permanently degraded rather than dangerous today.
- **Impact on measured pilot.** _Invalidates measurement_ if ever hit: rows written by GET are
  indistinguishable in `adaptation_decisions` from real adapted sessions (same `holdout_group`,
  `variant`, `archetype`), so they enter `computeLift()`'s adapted arm. Secondary: it is the one
  adapt surface that bypasses the §E.7.0 / ESC-076 grounding context and the list-page headline
  suppression, so any future integrator (server-side renderer, partner, mis-set snippet) gets a
  materially different product from the same "canonical" route.
- **Ticket coverage.** Partial only. `FOLLOW-359` (return `variant` in GET response), `FOLLOW-473`
  (GET auth hardening), `FOLLOW-949` (GET CORS) all treat GET as **live**; none asks whether it has
  a caller. `FOLLOW-1163`/ESC-077 touched GET's `variant_suppressed` (`route.ts:1322-1324`). **No
  ticket proposes retiring it or reconciling the two handlers.** → NO COVERAGE for the divergence
  itself.
- **Priority + deps.** P1. Depends on nothing; should precede FOLLOW-820 because it removes a silent
  contaminant from the table the gate reads.
- **Proposed AC.**
  - A repo-wide caller census for `GET /api/adapt` is recorded (file:line or "none").
  - Either (a) GET is retired to `410 Gone` + a Rule-H assertion that no GET handler exists, or (b)
    GET is brought to POST parity: `withListingFacts`, `groundingMissing`, `listingId` and
    `filterDirectivesByPageType` all applied, with a test per guard.
  - `adaptation_decisions` gains a way to tell GET-written rows from POST-written rows (or GET stops
    writing), so a historical audit can exclude them.
  - ADR-0004/0006 updated to say which method is canonical.
- **Red-first proof.** A test that POSTs and GETs the same
  `(tenant, session, archetype, listing_id, page_type='listing_list')` and asserts the two responses
  carry the same `directives` set. Red today (GET returns a headline on a list page and serves
  ungrounded/withheld copy where POST serves grounded copy); green when (a) or (b) lands.

### A1-2 — Nothing in the repo provisions the ingest Worker's KV API-key record, so a tenant onboarded through the product flow cannot ingest a single event

- **Claim.** The ingest Worker authenticates `POST /v1/events` against Cloudflare KV key
  `api_key:<raw key>`; the control-plane mints keys into Postgres `api_keys` (SHA-256) and hands the
  tenant a snippet. No code path writes KV — it is a manual operator step.
- **Status.** CONFIRMED.
- **Evidence.**
  - `apps/ingest/src/auth.ts:75` — `raw = await kv.get(\`api_key:${apiKey}\`)`; `:78` `if (!raw)
    return { ok: false, reason: 'unknown_key' }`.
  - `apps/ingest/src/handlers/events.ts:178-181` — "_no in-repo code writes `KV_API_KEYS`; it is an
    explicit operator step, `docs/runbooks/BRAND_PROVISIONING.md` §Step 6_".
  - `apps/control-plane/src/app/api/schema/activate/route.ts:318,390,420` return
    `{ api_key, tenant_id }` to the onboarding UI; no KV write anywhere in that file or its helpers.
  - The only writer is a hand-run CLI:
    `apps/control-plane/scripts/project-allowed-origins.mts:558-595` (`wranglerKvPut`), which
    refuses to create a record for a non-`public` key because `hmac_secret` is not in Postgres
    (`:581-587`).
  - Failure is silent client-side: `packages/sdk/src/core/events.ts:99-104` swallows every dispatch
    error.
- **Impact on measured pilot.** _Blocks go-live / degrades data._ Every behavioural event from a
  freshly onboarded tenant is 401'd and dropped without a client-visible signal; the `events` table
  is the join side of `computeLift()`'s conversion count (`rollup/data.ts`), so the adapted arm
  shows zero conversions and the lift reads as a product failure.
- **Ticket coverage.** `FOLLOW-658` — "_`allowed_origins` producer-coverage: enforcement silently
  no-ops until KV is seeded + two-source-of-truth (PG vs KV) reconciliation_", P1,
  `promoted_to_queue: false` → **OPEN, unscheduled**. `FOLLOW-682` (P3, per-KEY not per-TENANT, not
  promoted) is adjacent. Both are framed around `allowed_origins`; neither states the stronger fact
  that **key existence itself** is unprovisioned.
- **Priority + deps.** P1. No deps. Belongs on the FOLLOW-820 checklist as an on-GO step, since hop
  1 going live is the moment this bites.
- **Proposed AC.**
  - `POST /api/schema/activate` (or a documented post-activation job) writes the KV record for the
    key it mints, or the endpoint refuses to return a snippet until KV is confirmed.
  - A reconciliation check reports Postgres `api_keys` rows with no KV counterpart (and vice-versa).
  - An unknown key produces an operator-visible signal (Sentry/log with tenant hint), not only
    a 401.
- **Red-first proof.** An integration test that runs the activation endpoint against a test tenant
  and then POSTs an event batch with the returned key, asserting HTTP 2xx and one `events` row. Red
  today (401 `unknown_key`).

### A1-3 — `apps/stream-consumer` is dead code with a _required_ CI gate

- **Claim.** Nothing produces to Redpanda any more, so the whole app is unreachable; its Python test
  job is nonetheless in the required-checks register.
- **Status.** CONFIRMED (dead).
- **Evidence.** Producer removed: `apps/ingest/src/handlers/events.ts:560-566` ("_That publish is
  GONE … had been a permanent no-op since ADR-0016_"); `ab-events.ts` absent from both apps
  (ADR-0022 option A executed). Consumer still present:
  `apps/stream-consumer/src/{main.py,redpanda_client.py,consumers/events.py}`. Required gate:
  `.github/required-checks.txt:97` `Test (Python) (3.12, stream-consumer)`. Deliberate non-deploy is
  recorded at `.github/workflows/modal-deploy.yml:13` and `docs/MASTER_DESIGN.md:469` (§Snapshot.1
  row A.1).
- **Impact on measured pilot.** _None functionally._ Cost is agent/diligence confusion (its README
  still describes it as "part of the Sprint 1 ingest pipeline",
  `apps/stream-consumer/README.md:3-4`) plus a required gate that can only ever go red over dead
  code.
- **Ticket coverage.** ADR-0022 accepted option A but scoped only the two remnants it named.
  `FOLLOW-825` (P3, promoted) covers "remove the dead decision-api libs" and stale-doc sweeps, not
  stream-consumer. → **NO COVERAGE** for stream-consumer's disposition.
- **Priority + deps.** P3. Depends on a CEO/architect ruling (delete vs keep-as-reference), exactly
  like FOLLOW-824's shape.
- **Proposed AC.** A one-line ruling; on delete, remove the app, drop the required check from
  `.github/required-checks.txt`, drop from `ci.yml:220` matrix and `pnpm-workspace.yaml`, correct
  CLAUDE.md's app count and §A.1's diagram line (`MASTER_DESIGN.md:760`).
- **Red-first proof.** `scripts/check-rule-i.sh`-style assertion: no non-test file imports
  `src/redpanda_client` and no workflow deploys the app → today that predicate is satisfiable while
  the app still ships, which is the point.

### A1-4 — `apps/decision-api` is a 410 tombstone plus ~1,090 LOC of dead libs; its retirement ticket was never promoted

- **Claim.** The Worker answers `410 Gone` on `/api/adapt` and its whole lib layer has zero non-test
  importers.
- **Status.** CONFIRMED.
- **Evidence.** `apps/decision-api/src/index.ts:69-71` routes POST to a handler documented as 410
  (`src/app/api/adapt/route.ts:5,12,67`). Importer census (`grep -rn "lib/<name>"` excluding the
  file itself and `*.test.ts`): `ab-assignment` 0, `consent-gate` 0, `reorder` 0 (only
  `src/lib/__tests__/reorder-deregistered.test.ts:11`), `bandit` 0, `llm-gateway` 0 — the live
  homonyms are `apps/control-plane/src/lib/{bandit-query,llm-gateway}.ts` and
  `packages/shared/src/{ab-holdout,bandit}.ts`. Line counts: 235+166+131+176+382 = 1,090.
- **Impact on measured pilot.** _None functionally._ It costs: `MASTER_DESIGN.md:784-789` still
  describes this Worker as the live "edge holdout gate", which is the single most misleading
  architecture claim in the document (see A2-5).
- **Ticket coverage.** `FOLLOW-107` — "_Remove deprecated Worker /api/adapt handler after observed
  zero traffic (Phase 2 retire)_", P3, `promoted_to_queue: false`,
  `depends_on: [FOLLOW-105, FOLLOW-111]`. `FOLLOW-111` (structured zero-traffic monitor) is also
  unpromoted, so the dependency chain has never started. `FOLLOW-045` (fate of the duplicate
  `bandit.ts`) unpromoted. `FOLLOW-825` (P3, promoted) includes "remove the dead decision-api libs".
- **Priority + deps.** P3. Blocked on FOLLOW-111 as written; the lib deletion half is not (nothing
  imports them, so it needs no traffic evidence) and can ride FOLLOW-825.
- **Proposed AC.** Split the ticket: (1) delete the five libs now under FOLLOW-825 with a Rule-I
  "zero importers" proof; (2) keep the 410 handler until FOLLOW-111's monitor reports a 7-day zero.
- **Red-first proof.** `scripts/check-rule-h.sh` gains a gate asserting `apps/decision-api/src/lib/`
  contains no file with zero non-test importers. Red today (five such files); green after deletion.

### A1-5 — The RAG hop is unreachable from the SDK: `retrieveListingContext` needs `body.intent_vector`, which the SDK never sends

- **Claim.** The only agency-FAQ retrieval path requires a caller-supplied 1536-dim `intent_vector`;
  `fetchDirectives()` builds a body that has no such field, so `retrieveListingContext` returns `{}`
  on every production request.
- **Status.** CONFIRMED (dead from the production caller).
- **Evidence.**
  - `apps/control-plane/src/lib/rag-retrieval.ts:44-46` —
    `if (!listingId || !intentVector || intentVector.length === 0) return {};`
  - `route.ts:1883-1887` —
    `retrieveListingContext(tenantId, body.listing_id ?? null, body.intent_vector ?? null)`.
  - `packages/sdk/src/core/adapt.ts:1240-1265` — the request body is
    `{ tenant_id, session_id, page_type, locale, lead_id, archetype_hint, confidence, similarity, listing_id?, listing_ids?, consent_state }`.
    No `intent_vector` anywhere in `packages/sdk/src`.
  - The route's own code says so: `route.ts:1889-1896` — "_the only thing that ever reached
    `listingContext` was the agency FAQ table, and only for a caller that sent BOTH `listing_id` and
    a 1536-dim `intent_vector` — which the SDK does not._"
  - Embedding-space split: `packages/db/src/schema/answers.ts:50` `vector(1536)` vs
    `listing_embeddings.ts:48` / `archetype_embeddings.ts:28` `vector(1024)`.
- **Impact on measured pilot.** _Degrades data / weakens the differentiator._ FOLLOW-1022 partially
  compensated by adding the listing's own facts (`withListingFacts`), so the LLM is grounded — but
  the agency-curated FAQ corpus (TICKET-AGENCY-001, §E.2's "Chat suggested replies … + RAG (tenant's
  FAQ)") contributes nothing to any served directive. Any pilot claim that adaptation is
  FAQ-informed is unsupported.
- **Ticket coverage.** The cause is documented in-code (FOLLOW-1022) but the _gap_ is not ticketed:
  no ticket asks the SDK to send an intent vector, or asks `retrieveListingContext` to derive one
  server-side from `session_embeddings`/the archetype. → **NO COVERAGE**.
- **Priority + deps.** P2. Depends on a decision about which embedding space the session vector
  lives in (1024 vs 1536).
- **Proposed AC.**
  - Either the SDK sends a session intent vector, or the route derives one (e.g.
    `fetchArchetypeEmbedding(archetypeId)`), with the dimension reconciled against
    `answers.question_embedding`.
  - A test proves at least one FAQ answer reaches `listingContext` on a request whose body is
    byte-identical to the SDK's.
  - If the answer is "not for this pilot": `answers`/`rag-retrieval` marked de-scoped, and §E.2's
    FAQ-RAG row flagged ASPIRATIONAL in §Snapshot.1.
- **Red-first proof.** An integration test that seeds one `answers` row, issues the exact SDK body,
  and asserts the prompt/`listingContext` contains that question. Red today (returns `{}`).

### A1-6 — `scoring_path` — FOLLOW-819 AC(3)'s discriminator — is written only when an env flag is set, and `cosine` has never been observed

- **Claim.** `logDecisionAsync` appends the `scoring_path` column by string-patching the INSERT,
  only when `SCORING_PATH_COLUMN_ENABLED === 'true'`; the harness reads that column to distinguish
  real cosine ranking from a djb2 hash shuffle.
- **Status.** PARTIAL.
- **Evidence.** `route.ts:736`
  `const scoringPathColumnEnabled = process.env.SCORING_PATH_COLUMN_ENABLED === 'true';`; `:784-785`
  the two `.replace()` patches; `:808` `param_p_scoring_path`. Harness dependency:
  `tests/e2e/follow-819/differentiator-e2e.mjs:103` `SCORING_PATHS`, `:~1050` "_Requires
  SCORING_PATH_COLUMN_ENABLED=true on the control plane, or the INSERT omits the column entirely and
  this reads a value the writer never wrote._" Prod DDL deliberately deferred
  (`backlog/QUEUE.md:26765`).
- **Impact on measured pilot.** _Invalidates measurement (of the ranker)._ With the flag off the
  column defaults to `not_applicable` and AC(3) is green on the column's own default; with it on,
  the only value ever observed on any substrate is `djb2_fallback`. So "the differentiator ranks by
  real affinity" is unproven either way.
- **Ticket coverage.** `FOLLOW-1071` (P2, `cosine` never observed) and `FOLLOW-1072` (DONE — seeded
  `tenant_site_schemas`, produced the first `djb2_fallback`) and `FOLLOW-1073`; QUEUE:1853 groups
  them. The env-flag-as-silent-off shape is described in the DONE row for FOLLOW-560
  (`QUEUE.md:26765`). Coverage is adequate; I am not filing a new ticket.
- **Priority + deps.** P2, existing tickets. Depends on listing embeddings being seeded on the local
  substrate.
- **Proposed AC.** (per FOLLOW-1071) at least one `adaptation_decisions` row with
  `scoring_path='cosine'` on the localhost substrate, produced by the production writer.
- **Red-first proof.** Already exists: FOLLOW-819 AC(3)'s `cosineVsDjb2Distinguishable` flag; today
  it is true only for `djb2_fallback`.

### A1-7 — The outcome hop is disabled by default: `/api/adapt/feedback` 503s unless an env flag is set, and the SDK swallows the 503

- **Claim.** ADR-0015's interim 503 gate is still the first statement in the handler; without
  `FEEDBACK_ENDPOINT_ENABLED=true` the bandit never learns and `conversion_labels` never fills.
- **Status.** PARTIAL (code complete, operator-pending).
- **Evidence.** `apps/control-plane/src/app/api/adapt/feedback/route.ts:16` (Step 1 of the
  documented algorithm) and ADR-0015:68 `if (process.env.FEEDBACK_ENDPOINT_ENABLED !== 'true')`;
  `:161` `→ 503`. SDK behaviour: `packages/sdk/src/core/adapt.ts:167` fire-and-forget POST with no
  status handling. Queue status: `backlog/QUEUE.md:23911` `status: CODE_COMPLETE_OPERATOR_PENDING`,
  `operator_action` = set the flag in Doppler `prd` + run `pnpm feedback:canary`.
- **Impact on measured pilot.** _Invalidates measurement._ Thompson sampling stays at Beta(1,1) →
  variant selection is a coin flip, and §T's conversion-label loop is empty, so per-archetype lift
  cannot be computed.
- **Ticket coverage.** `FOLLOW-450` P0, `CODE_COMPLETE_OPERATOR_PENDING`; it is FOLLOW-820
  condition 4. Adequate coverage.
- **Priority + deps.** P0 (operator). Depends on FOLLOW-820.
- **Proposed AC.** As FOLLOW-450 already states: flag flipped in `prd`, and a pasted real
  `ab_bandit_weights` delta.
- **Red-first proof.** FOLLOW-819 AC(4) already is this test (it polls for a Beta delta, not a 202);
  it is red without the flag and the three secrets.

### A1-8 — The analytics hop fabricates a lift when unconfigured, and the pilot's only defence is one string field

- **Claim.** `getPlatformAnalyticsRollup()` returns `buildMockRollup()` — a
  `seededRandom()`-generated lift — whenever the stores are unconfigured, distinguished from real
  data only by `data_source`.
- **Status.** PARTIAL (fail-soft by design, correctly surfaced in the UI, but a trap for any non-UI
  consumer).
- **Evidence.** `apps/control-plane/src/app/api/admin/analytics/rollup/data.ts:382` `seededRandom`,
  `:387-424` `buildMockRollup()` with `liftPct = -5 + seededRandom(seed+3)*30`, `:445-448`
  `if (…) return { ok: true, data: buildMockRollup() }`, `:552` the live value is
  `data_source: 'clickhouse'`. UI guards do exist: `src/app/dashboard/pilot/page.tsx:211,310` and
  `analytics/page.tsx:218,331` render a `MockDataBadge` when `data_source !== 'clickhouse'`.
  `computeLift()` at `:255` returns `null` on `holdoutN===0`/`holdoutRate===0` — the two nulls
  FOLLOW-819 AC(5) reasons about.
- **Impact on measured pilot.** _Invalidates measurement_ for any consumer that reads
  `rollup.ctaLift` without also asserting `data_source === 'clickhouse'`. The FOLLOW-819 harness
  does assert it (`differentiator-e2e.mjs` `const live = body?.data_source === 'clickhouse'`), and
  that assertion is the load-bearing anti-fixture guard for the whole gate.
- **Ticket coverage.** `FOLLOW-453` (dashboard fail-loud, no fabricated zeros) and `FOLLOW-122`
  shipped the badges. No ticket removes the mock or makes the API refuse to serve it outside dev. →
  **partial / NO COVERAGE** for the API-level trap.
- **Priority + deps.** P2. No deps.
- **Proposed AC.**
  - `buildMockRollup()` is unreachable when `NODE_ENV === 'production'` (the route returns a typed
    `unconfigured` error instead).
  - Every in-repo consumer of `rollup.ctaLift` asserts `data_source === 'clickhouse'`; a grep-based
    gate enforces it.
- **Red-first proof.** A test that unsets `CLICKHOUSE_URL` with `NODE_ENV=production` and asserts
  the route does **not** return a numeric `ctaLift`. Red today.

### A1-9 — The committed FOLLOW-819 artefact is three harness generations stale, shows AC(2) RED, and is what the FOLLOW-820 grader reads

- **Claim.** `tests/e2e/follow-819/last-run.json` is dated 2026-08-25, records `AC(2): false`, and
  predates FOLLOW-1138/1139 — the two tickets that fixed the AC(2) cause and completed the fixture.
  The harness is in no workflow, so no fresher artefact can be produced by CI.
- **Status.** STALE.
- **Evidence.**
  - `last-run.json` `ranAt: "2026-08-25T22:37:59.116Z"`; `results` = AC(1) true, **AC(2) false**,
    AC(3) true, AC(4) true, AC(7) true, AC(5) true.
  - Its AC(2) evidence object has only `before`/`after`/`changedSlots` — it lacks
    `resolvedPageType`, `pageContextsSeen`, `servedSlots`, `fixtureSlots`, which the harness at HEAD
    always records (`differentiator-e2e.mjs` AC(2) `record(...)` block). So the artefact predates
    FOLLOW-1138 (`820276e2`, 2026-08-26) and FOLLOW-1139 (`3db1f629`).
  - Its `before`/`after` list only `headline` and `description`; the fixture at HEAD also carries
    `cta` and `feature` slots (`fixture-listing.html:120,127`).
  - The AC(2) cause is fixed at HEAD: `packages/sdk/src/index.ts:224-231` resolves `listing_detail`
    from a single `[data-estalara-listing-id]`, and the fixture has exactly one
    (`fixture-listing.html:75`) — so `page_context` would now be 2 and `filterDirectivesByPageType`
    would no longer strip `headline`.
  - No CI wiring: `grep -rln 'follow-819\|differentiator-e2e' .github/workflows package.json` → no
    matches. `ingest → clickhouse smoke` is likewise absent from `.github/required-checks.txt`.
  - Stale guidance inside the harness itself: `differentiator-e2e.mjs:1507-1508` tells the reader
    `events = 0` is caused by a trailing `Z` in the ingest DateTime64 — that was fixed by FOLLOW-853
    (`apps/ingest/src/clickhouse-producer.ts:160` strips both `T` and `Z`;
    `handlers/intent-snapshot.ts:179` uses the helper).
- **Impact on measured pilot.** _Blocks go-live._ FOLLOW-820 condition 1 is graded on this artefact
  ("verified not asserted, evidence links not ticks"). The checked-in evidence says 5/6 with the DOM
  assertion red; a grader reading it would record NO-GO on a condition the code may already satisfy.
  Symmetrically, a grader told "6/6" verbally has no artefact to check.
- **Ticket coverage.** FOLLOW-819 itself, plus the chain
  FOLLOW-1075/1098/1099/1124/1125/1131/1138/1139 that keeps amending the harness. No ticket makes
  the artefact reproducible in CI or asserts its freshness. → **NO COVERAGE**.
- **Priority + deps.** P1, on the FOLLOW-820 critical path. Depends on the localhost substrate being
  up (real control plane, ClickHouse, Postgres).
- **Proposed AC.**
  - A fresh `last-run.json` produced at HEAD, with `ranAt` after `a7c891ae`, committed alongside the
    commit SHA it was run against.
  - The artefact records the harness's own source SHA, so staleness is detectable without reading
    field names.
  - `differentiator-e2e.mjs:1503-1512`'s DateTime64 hint corrected or deleted (it names a fixed bug
    as the likely cause).
  - A decision recorded on whether the harness gets a `workflow_dispatch` job (containers + secrets)
    or stays manual-with-a-freshness-gate.
- **Red-first proof.** A gate that fails when `last-run.json.ranAt` predates the newest commit
  touching `packages/sdk/src`, `apps/ingest/src`, or `apps/control-plane/src/app/api/adapt/`. Red
  today by 27 commits.

### A1-10 — Two ClickHouse tables are half-wired: `session_quality` has no producer, `session_summary` has no reader

- **Claim.** Migration 0005's `session_quality` is never written (DQS snapshots land in the generic
  `events` table as JSON); migration 0002's `session_summary` MV is written by ClickHouse but read
  by nothing in the product.
- **Status.** CONFIRMED.
- **Evidence.** `apps/ingest/src/consent-gate.ts:56-58` — "_the dedicated ClickHouse
  `session_quality` table (migration 0005) has NO producer today — `session.quality.snapshot` lands
  in the generic `events` table as JSON._" Every other reference to `session_quality` is a DSR
  erase/portability target (`apps/control-plane/src/lib/clickhouse-dsr.ts:75`,
  `src/app/api/dsr/erase/route.ts:31`). `session_summary` appears only in `clickhouse-dsr.ts:47` (as
  an MV note) and `apps/stream-consumer/tests/integration/test_e2e_consumer.py:137` — i.e. in a dead
  app's test.
- **Impact on measured pilot.** _Degrades data._ DQS (data-quality score) analysis has no queryable
  table; a DSR erase issues `ALTER TABLE … DELETE` against a table that is always empty, which reads
  as a successful erasure of nothing.
- **Ticket coverage.** **NO COVERAGE** (`grep -in session_quality ticket_index.txt` → no hits).
- **Priority + deps.** P3. No deps.
- **Proposed AC.** Either a `session_quality` writer is built (applying the same consent strip
  `consent-gate.ts` warns about), or the table + its DSR entry are dropped and
  `packages/shared/src/schemas/events/session-quality.ts:5`'s "forwarded to ClickHouse
  `session_quality`" claim is corrected.
- **Red-first proof.** A test asserting `SELECT count() FROM session_quality` > 0 after a session
  that emits `session.quality.snapshot`. Red today.

---

## AREA 2 — Responsibility matrix

"Designed owner" = what `docs/MASTER_DESIGN.md` says (§A.1, §A.1.5, §B, §E, §I). "Actual owner" =
the code that runs at HEAD.

| Capability                                         | Designed owner (MASTER_DESIGN)                                                         | Actual owner at HEAD                                                                                                                                                                              | Note                                                                                                |
| -------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Behavioural event collection                       | `packages/sdk`                                                                         | `packages/sdk/src/core/{events,observer,session,dqs}.ts`                                                                                                                                          | ✅ match. Batch interval 5 s (`index.ts:275`), doc says "every 2s" (`:719`)                         |
| Event ingest + validation + rate limit             | `apps/ingest` (Workers + DO)                                                           | same; DO used **only** for rate limiting (`wrangler.toml:54-56`, `src/rate-limiter.ts:65`)                                                                                                        | ✅ match                                                                                            |
| Event bus                                          | Redpanda Cloud (`:719`, `:760`, §I)                                                    | **none** — ingest writes ClickHouse directly (`clickhouse-producer.ts`); durability via Cloudflare Queues (ADR-0017)                                                                              | 🔴 retired by ADR-0022; §A.1 diagram still shows "Push to Redpanda Cloud"                           |
| Stream fan-out to ClickHouse                       | `apps/stream-consumer` (§A.1:760)                                                      | nobody (dead, A1-3)                                                                                                                                                                               | 🔴                                                                                                  |
| Holdout assignment                                 | `apps/decision-api` ("Component 2", `:787`); explicitly **NOT** control-plane (`:796`) | `packages/shared/src/ab-holdout.ts` `assignHoldout`, called from `apps/control-plane/.../adapt/route.ts:1272,1785`                                                                                | 🔴 **inverted**: decision-api is 410 Gone; control-plane does exactly what the doc says it does not |
| Archetype classification                           | in-browser Bayesian (§A.1.5 Component 1)                                               | `packages/sdk/src/core/intent.ts` (1,782 LOC)                                                                                                                                                     | ✅ match                                                                                            |
| Server-side / cross-tab intent + chat NLP          | `apps/intent-engine` (ADR-0005 "BUILD")                                                | `apps/intent-engine/src/{main,nlp,redis_writer}.py` real, deployed; **shadow-only** (Upstash key read by `control-plane/src/lib/chat-intent-cache.ts`)                                            | 🟡 built; traffic axis unproven (FOLLOW-892)                                                        |
| Sonnet batch conversation enrichment (§C.3 tier 2) | `apps/intent-engine`                                                                   | `src/jobs/batch_enrich.py` exists but `main.py` never imports it → not registered, cron never fires                                                                                               | 🔴 dead (already recorded in §Snapshot.1 row D)                                                     |
| Playbook selection                                 | control-plane adapt route                                                              | `packages/sdk/src/core/playbooks/` (18 files) imported by `route.ts:55`                                                                                                                           | 🟡 the playbook corpus lives in the **SDK** package, consumed server-side                           |
| LLM copy rewrite                                   | "via LiteLLM (Haiku/Sonnet)" (`:794`, §I, `:3807`)                                     | `apps/control-plane/src/lib/llm-gateway.ts:32` `import Anthropic` — direct SDK, no router                                                                                                         | 🔴 no LiteLLM anywhere except `apps/decision-api/src/lib/llm-gateway.ts` (dead)                     |
| Async description generation                       | `apps/llm-gateway` Modal                                                               | `apps/llm-gateway/src/jobs/generate_description.py` (2,391 LOC) + `description_requested_endpoint`; dispatched by `control-plane/.../adapt/description/route.ts:113`                              | ✅ match (ADR-0016)                                                                                 |
| Listing / archetype embeddings                     | pgvector, OpenAI `text-embedding-3-small`                                              | `POST /api/listings/embed` @1024 dims (`route.ts:7,51`); lookups `lib/embedding-lookup.ts`; seeding dispatched via Modal `consume_embed_seed_requests.py`                                         | ✅ match; note the 1024 vs 1536 split (A1-5)                                                        |
| Agency FAQ RAG                                     | control-plane adapt route (AGENCY-001)                                                 | `lib/rag-retrieval.ts` — present, unreachable (A1-5)                                                                                                                                              | 🔴                                                                                                  |
| Auto-detection L1/L2                               | `packages/sdk/src/auto-detect`                                                         | same, 10 techniques (`auto-detect/pipeline.ts:25-34`)                                                                                                                                             | ✅ match                                                                                            |
| Auto-detection L3 (platform fingerprints)          | `packages/platform-templates` (§B.5)                                                   | `templates/index.ts:30` `= []`; `index.ts:47-54` `matchPlatform()` returns `null`; **zero callers** — not even wired into `pipeline.ts`                                                           | 🔴 no-op stub                                                                                       |
| Auto-detection Vision fallback                     | `control-plane/src/app/api/detect/route.ts`                                            | same                                                                                                                                                                                              | ✅ match                                                                                            |
| Intent ontology types                              | `packages/intent-ontology`                                                             | 14-line version stub, 0 consumers; de-facto registry is `packages/shared/src/archetypes.ts`                                                                                                       | 🔴 stub                                                                                             |
| Consent / retention / DSR                          | `packages/compliance`                                                                  | 14-line stub, 0 consumers; real code is `apps/ingest/src/consent-gate.ts`, `packages/shared/src/consent-retention.ts`, `packages/sdk/src/ui/consent-banner.ts`, `control-plane/src/app/api/dsr/*` | 🔴 stub package, capability lives elsewhere                                                         |
| Fair-housing linter (§E.1 step 3c)                 | control-plane adapt pipeline                                                           | **nothing** — the only matches repo-wide are a docblock in the stub `packages/compliance/src/index.ts:2,7` and a comment in the dead `apps/decision-api/src/lib/ab-assignment.ts:2,14`            | 🔴 ASPIRATIONAL                                                                                     |
| Brand-guideline linter (§E.1 step 3b)              | control-plane adapt pipeline                                                           | **nothing** (`grep -rln 'brand.guideline\|brandLint'` → 0)                                                                                                                                        | 🔴 ASPIRATIONAL                                                                                     |
| HMAC-signed directive audit trail (§E.1 step 3d)   | adapt route                                                                            | not implemented; `adapt_decision_id` only (`explainability_id` deferred, FOLLOW-108)                                                                                                              | 🔴 ASPIRATIONAL                                                                                     |
| Photo re-ranking / CLIP (§E.2)                     | adapt route                                                                            | **nothing** (`grep -rn 'CLIP\|photoOrder'` → 0)                                                                                                                                                   | 🔴 ASPIRATIONAL                                                                                     |
| Framework wrappers                                 | `packages/sdk-react`, `packages/sdk-vue`                                               | 11-line version stubs, 0 consumers                                                                                                                                                                | 🔴 stub                                                                                             |
| Async loader (<2 KB)                               | `packages/sdk-loader`                                                                  | 11-line version stub, 0 consumers; the real loader is the IIFE `<script>` tag in `buildSnippet()`                                                                                                 | 🔴 stub                                                                                             |
| Tenant API-key auth                                | one tenant-auth model                                                                  | **two**: KV `api_key:<raw>` (ingest, `auth.ts:75`) and Postgres `api_keys` SHA-256 (`lib/api-key-auth.ts`), unsynchronised (A1-2)                                                                 | 🔴 duplicated                                                                                       |
| Bandit / Thompson sampling                         | adapt route + feedback                                                                 | live: `packages/shared/src/bandit.ts` + `control-plane/src/lib/bandit-{query,seed}.ts`; dead duplicate: `apps/decision-api/src/lib/bandit.ts` (FOLLOW-045)                                        | 🟡 duplicated                                                                                       |
| Schema-drift cron (§B.6)                           | `apps/data-quality`                                                                    | `apps/data-quality/src/crons/schema_validation.py` (874 LOC), deployed as `estalara-schema-validation`                                                                                            | ✅ match                                                                                            |

### A2-1 — Six packages are stubs or no-ops; only two of them are ticketed

- **Claim.** `packages/{sdk-loader,sdk-react,sdk-vue,compliance,intent-ontology}` are 11-14-line
  version-constant stubs with zero consumers, and `packages/platform-templates` is a compiling no-op
  whose one exported function returns `null` and has no callers.
- **Status.** CONFIRMED (ASPIRATIONAL as products).
- **Evidence.** `packages/sdk-loader/src/index.ts` 11 lines (`LOADER_VERSION`);
  `sdk-react/src/index.ts:11` / `sdk-vue/src/index.ts:11` (`SDK_*_VERSION`);
  `compliance/src/index.ts` 14 lines; `intent-ontology/src/index.ts` 14 lines. Consumer census for
  `@estalara/<name>` across `apps` + `packages` excluding the package itself and tests: 0 for all
  five. `platform-templates/src/templates/index.ts:30`
  `export const templates: PlatformTemplate[] = []`; `platform-templates/src/index.ts:47-54`
  `matchPlatform()` → `return null`; zero callers of `matchPlatform` anywhere (it is not imported by
  `packages/sdk/src/auto-detect/pipeline.ts`, which lists its ten techniques at `:25-34`). All five
  stubs still say "_Full implementation in TICKET-0xx_".
- **Impact on measured pilot.** _None functionally._ Cost is exactly the one FOLLOW-824 already
  names: agents and diligence readers take the package list as a capability list. CLAUDE.md claims
  10 packages; six of the eleven present are stubs or orphans.
- **Ticket coverage.** `FOLLOW-824` (⚖️ CEO decision — build or delete `platform-templates` +
  `intent-ontology`) `status: BLOCKED_ON_HUMAN`, P3 (`QUEUE.md:28249-28254`); `FOLLOW-784` (P3,
  intent-ontology fill-or-delete, unpromoted). **`sdk-loader`, `sdk-react`, `sdk-vue`, `compliance`
  have NO COVERAGE** (`grep -in 'sdk-loader\|sdk-react' ticket_index.txt` → no hits).
- **Priority + deps.** P3. FOLLOW-824 is the blocking human decision; the other four can ride the
  same ruling.
- **Proposed AC.** Extend FOLLOW-824 to all six packages; one ruling each (build / delete /
  keep-as-declared-placeholder). On delete: drop from `pnpm-workspace.yaml`, the turbo graph,
  `.github/required-checks.txt` where applicable, and correct CLAUDE.md's package count.
- **Red-first proof.** A gate asserting every `packages/*` has ≥1 non-test importer outside itself,
  with an explicit allowlist of ruled-on placeholders. Red today for six packages.

### A2-2 — Two different things are called "llm-gateway", and neither is the LiteLLM router the design names

- **Claim.** `apps/llm-gateway` (Python/Modal) does async description generation and embed-seed
  dispatch; `apps/control-plane/src/lib/llm-gateway.ts` does the synchronous adapt-path LLM calls
  with the Anthropic SDK directly; `apps/decision-api/src/lib/llm-gateway.ts` is the only LiteLLM
  client and is dead. MASTER_DESIGN says the adapt route rewrites copy "via LiteLLM".
- **Status.** STALE (doc) + duplicated naming.
- **Evidence.** `apps/control-plane/src/lib/llm-gateway.ts:32`
  `import Anthropic from '@anthropic-ai/sdk'`; no `litellm` string anywhere in that file or in
  `apps/llm-gateway`. LiteLLM appears only in
  `apps/decision-api/src/lib/llm-gateway.ts:2,5,96,115,135,140` (dead, A1-4).
  `apps/llm-gateway/README.md:3` — "_Estalara LLM gateway — Modal LiteLLM router for Claude
  Haiku/Sonnet calls_" — false; `:5-7` "_Status: Placeholder — full implementation in TICKET-013_" —
  false (2,391 LOC `generate_description.py`). Design claims: `docs/MASTER_DESIGN.md:794`
  ("optionally rewrites copy via LiteLLM"), `:3807` ("Claude Haiku 4.5 integration via LiteLLM"),
  `:2008` ("Canary deploy new model do 1% traffic via LiteLLM router").
- **Impact on measured pilot.** _None functionally._ It costs routing/cost-control claims: there is
  no router, so no per-tenant model routing, no 1 %-canary mechanism, and the spend cap is a bespoke
  ClickHouse `llm_calls` query (`lib/llm-gateway.ts` circuit breaker) rather than a gateway feature.
- **Ticket coverage.** `FOLLOW-825` (P3, promoted) is a stale-docs sweep but is scoped to
  §Snapshot.2/.3/.5, Tier framing and the decision-api libs — it does not name the LiteLLM claims or
  the app READMEs. → **partial / NO COVERAGE**.
- **Priority + deps.** P3. No deps.
- **Proposed AC.**
  - A ruling: adopt a router, or delete every LiteLLM claim from MASTER_DESIGN §A.1.5/§I/§R and the
    `apps/llm-gateway` README.
  - `apps/llm-gateway/README.md` describes what the app does (description generation + embed-seed
    endpoints) and drops "Placeholder".
  - One of the three "llm-gateway" names is changed so the three are not homonyms.
- **Red-first proof.** A docs gate: `grep -c LiteLLM docs/MASTER_DESIGN.md` must be 0 unless a
  `litellm` dependency exists in some `package.json`/`pyproject.toml`. Red today (3 vs 0).

### A2-3 — `apps/data-quality/src/main.py` is a placeholder that is never deployed, while the real app is a different file

- **Claim.** The app's `main.py` returns `status: "placeholder"` and declares no `modal.App`; the
  deployed entrypoint is `src/crons/schema_validation.py`.
- **Status.** CONFIRMED (harmless stub, misleading entrypoint).
- **Evidence.** `apps/data-quality/src/main.py:1-22` — docstring "_Full implementation in
  TICKET-012_", `get_service_info()` returns `"status": "placeholder"`, no `import modal`. Deploy
  target: `.github/workflows/modal-deploy.yml:85`
  `PYTHONPATH=apps/data-quality/src modal deploy apps/data-quality/src/crons/schema_validation.py`,
  job name `Deploy data-quality (estalara-schema-validation)` (`:269-270`).
  `apps/data-quality/README.md:5-7` also says "Placeholder".
- **Impact on measured pilot.** _None._ A reader opening `main.py` concludes the daily schema-drift
  cron (§B.6, a documented product feature) does not exist.
- **Ticket coverage.** **NO COVERAGE.**
- **Priority + deps.** P3. No deps. Fold into FOLLOW-825.
- **Proposed AC.** `main.py` either re-exports the real app (like `apps/llm-gateway/src/main.py`
  does for its jobs) or is deleted; the README names the deployed app and its cron schedule.
- **Red-first proof.** A gate asserting every `apps/*/src/main.py` either defines/re-exports a
  `modal.App` or does not exist. Red today for data-quality.

### A2-4 — Four app READMEs still announce themselves as unimplemented placeholders

- **Claim.** `apps/{intent-engine,llm-gateway,data-quality,decision-api}` READMEs all carry a
  "Status: Placeholder — full implementation in TICKET-0xx" section that contradicts HEAD.
- **Status.** STALE.
- **Evidence.** `apps/intent-engine/README.md:5-7` "Placeholder — full implementation in TICKET-013"
  vs 1,200+ LOC of real service (`src/{main,nlp,redis_writer,observability,schemas}.py`) deployed as
  `estalara-intent-engine`. `apps/llm-gateway/README.md:3-7` (A2-2).
  `apps/data-quality/README.md:5-7` (A2-3). `apps/decision-api/README.md:7-9` "Placeholder — full
  implementation in TICKET-011" — wrong in the other direction: the app is _retired_, not unbuilt.
- **Impact on measured pilot.** _None functionally._ This is the documented, twice-measured cost in
  FOLLOW-825's own body ("the brief for the 2026-08-04 audit carried four wrong figures"), and it
  recurred in this audit's brief.
- **Ticket coverage.** `FOLLOW-825` (P3, promoted) covers stale docs but its ACs name §Snapshot
  sections, Tier framing and the decision-api libs, not the four app READMEs. → **partial**.
- **Priority + deps.** P3.
- **Proposed AC.** Add an AC to FOLLOW-825: every `apps/*/README.md` "Status" line is either deleted
  or verified against HEAD in the same PR; a `check-*.sh` gate fails on the literal "full
  implementation in TICKET-".
- **Red-first proof.** `grep -rl 'full implementation in TICKET-' apps packages` must return
  nothing. Returns 9 files today.

### A2-5 — MASTER_DESIGN §A.1.5 states the decision-api/control-plane responsibility split exactly backwards

- **Claim.** §A.1.5 Component 2 attributes holdout assignment, the consent gate and
  `ReorderDirective` to `apps/decision-api`; Component 3 explicitly says the control-plane route
  does **not** do holdout assignment. At HEAD the opposite is true on every clause.
- **Status.** STALE.
- **Evidence.** `docs/MASTER_DESIGN.md:787` — "_Receives adapt requests from the SDK, assigns
  holdout group deterministically via HMAC(tenant_id, session_id), enforces consent gate, forwards
  non-holdout sessions to the canonical adapt route, returns ReorderDirective_" (about
  `apps/decision-api`). `:796` — "_What it does NOT do: Holdout assignment (that is the edge holdout
  gate's responsibility — Component 2)_" (about the control-plane route). Code: decision-api's
  `/api/adapt` is 410 (`apps/decision-api/src/index.ts:69` → `src/app/api/adapt/route.ts:12,67`) and
  its `ab-assignment`/`consent-gate`/`reorder` libs have zero importers; the control-plane route
  calls `assignHoldout` at `route.ts:1272` (GET) and `:1785` (POST), gates consent at
  `:1228`+`SKIP_CONSENT_STATES`, and builds the `ReorderDirective` at `:974`.
- **Impact on measured pilot.** _Degrades decisions, not data._ §Snapshot.1 row A.1 (`:469`) is
  honest about the Modal apps, but §A.1.5 is written in the present tense 300 lines later and is the
  section an architecture reader reaches first. Every future ticket that reasons "holdout lives at
  the edge" starts from a false premise — which is how A1-1's dead GET handler kept accruing
  hardening tickets.
- **Ticket coverage.** `FOLLOW-543` and `FOLLOW-825` cover §Snapshot.2/.3/.5 prose; neither names
  §A.1.5 or §A.1's diagram. → **NO COVERAGE**.
- **Priority + deps.** P2 (higher than the other doc findings because it misdirects design work). No
  deps; naturally bundled with A1-4.
- **Proposed AC.**
  - §A.1.5 Components 2 and 3 rewritten against HEAD, or Component 2 deleted with a pointer to
    ADR-0006.
  - §A.1's diagram loses "Push to Redpanda Cloud" (ADR-0022) and the `stream-consumer` line, and its
    SDK size reads `<42 KB` (ESC-028) rather than `<40 KB`.
  - The "+ WebSocket for live chat / live adaptation" line (`:719`) is removed or flagged —
    `grep -rn 'WebSocket' apps packages` (non-test, non-dist) returns nothing.
- **Red-first proof.** A docs gate asserting `MASTER_DESIGN.md` contains no present-tense claim that
  `apps/decision-api` assigns holdout while `scripts/check-rule-h.sh`'s Gate 2 asserts that route is
  retired. The two assertions contradict each other today.

---

## Area verdict

The production chain is real and end-to-end on the POST path — SDK → ingest → ClickHouse →
`/api/adapt` (playbook + grounded Anthropic call) → DOM → feedback → rollup are all implemented with
genuine transports and genuine auth, and the FOLLOW-819 harness is an honest instrument for it. What
the chain is missing is not intelligence but **provenance discipline at three specific joints**: the
tenant API key is provisioned into two unsynchronised registries so a self-serve-onboarded tenant
cannot ingest at all (A1-2); a second, uncalled adapt handler in the canonical file writes into the
very table the pilot measures from, without the grounding and page-type guards POST has (A1-1); and
the one artefact FOLLOW-820 condition 1 is graded on is 27 commits stale, records the DOM assertion
RED, and cannot be regenerated by CI (A1-9). Those three are the audit's P1s and all three are
cheap. The responsibility split is coherent where it is live — TypeScript edge for synchronous
adaptation, Modal for async jobs — but six of eleven packages are stubs, three capabilities
§E.1/§E.2 promise (fair-housing linter, brand linter, photo re-ranking) do not exist in any form,
and §A.1.5 describes the decision-api/control-plane division of labour exactly backwards, which is
the documentary root of A1-1's survival. No finding contradicts the localhost-first ruling; A1-1,
A1-2 and A1-9 all sit on the FOLLOW-820 path rather than behind it.

## Open questions for the CEO

1. **`GET /api/adapt` (A1-1) — retire or bring to parity?** Retiring is an hour; parity is a day and
   means maintaining two handlers. Retiring is recommended, but it is a public-API-surface change
   (CLAUDE.md escalation trigger), so it needs a ruling.
2. **FOLLOW-819 in CI (A1-9) —** do you want a `workflow_dispatch` job that stands up ClickHouse +
   Postgres + the real control plane and runs the harness (needs `ANTHROPIC_API_KEY` and ClickHouse
   creds in Actions), or does the harness stay manual with only a staleness gate on the artefact?
   This decides whether FOLLOW-820 condition 1 can ever be re-verified without a human session.
3. **Fair-housing and brand linters (§E.1 steps 3b/3c) —** required before the measured pilot serves
   adapted copy to US traffic, or explicitly deferred with §E.1 marked ASPIRATIONAL? `FOLLOW-034`
   (fair-housing audit of variants/copy_templates) was CANCELLED, so today nothing covers it.
4. **FOLLOW-824, widened (A2-1) —** the same build/delete ruling is needed for `sdk-loader`,
   `sdk-react`, `sdk-vue` and `compliance`, not just `platform-templates` and `intent-ontology`. One
   ruling can dispose of all six.
5. **`apps/stream-consumer` (A1-3) —** delete, or keep as reference code? It currently holds a
   _required_ CI gate over a path that ADR-0022 retired and that §Snapshot.1 says will never be
   deployed in this shape.
