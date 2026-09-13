# AREA 13 — Documentation drift vs code at `main` `f510f749`

Read-only. Every row checked with a targeted grep against HEAD. Verdicts: MATCH / STALE /
ASPIRATIONAL / CONTRADICTS-OTHER-DOC.

---

## 0. Master drift table

### 0.1 Architecture — which apps/packages/services exist

| doc                     | line                     | claim                                                                                                                                                                                                                                                            | code evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                         | verdict                                                                                        |
| ----------------------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `CLAUDE.md`             | 51                       | "7 apps (ingest, control-plane, decision-api, plus 4 Modal Python apps)"                                                                                                                                                                                         | `ls apps` → control-plane, data-quality, decision-api, ingest, intent-engine, llm-gateway, stream-consumer = 7; 4 have `pyproject.toml` (data-quality, intent-engine, llm-gateway, stream-consumer)                                                                                                                                                                                                                                                                   | **MATCH**                                                                                      |
| `CLAUDE.md`             | 52                       | "10 packages"                                                                                                                                                                                                                                                    | `ls packages` → auth, compliance, db, intent-ontology, platform-templates, sdk, sdk-loader, sdk-react, sdk-vue, shared = 10                                                                                                                                                                                                                                                                                                                                           | **MATCH**                                                                                      |
| `README.md`             | 290–305                  | repo tree "apps/ (7 total)", "packages/ (10 total)" with exact names                                                                                                                                                                                             | same as above                                                                                                                                                                                                                                                                                                                                                                                                                                                         | **MATCH**                                                                                      |
| `README.md`             | 294                      | "`llm-gateway/` # Modal Python — **LiteLLM router**"                                                                                                                                                                                                             | `apps/llm-gateway/pyproject.toml:11-20` deps are `anthropic`, `httpx`, `confluent-kafka`, `modal`, `sentry-sdk`, `structlog`, `fastapi` — **no litellm**; `apps/llm-gateway/src/jobs/generate_description.py:1220` calls Anthropic directly (`_DEFAULT_GENERATION_MODEL = "claude-sonnet-4-6"`)                                                                                                                                                                       | **STALE**                                                                                      |
| `CLAUDE.md`             | 256                      | "LLM: … **via LiteLLM router**"                                                                                                                                                                                                                                  | the only LiteLLM reference in the whole estate is `apps/decision-api/src/lib/llm-gateway.ts:2-5,96-140` — and `apps/decision-api/src/index.ts:5` says `POST /api/adapt` is "DEPRECATED — 410 Gone (ADR-0006 Phase 1)". The live path `apps/control-plane/src/lib/llm-gateway.ts:32` imports `Anthropic from '@anthropic-ai/sdk'` — no router                                                                                                                          | **STALE**                                                                                      |
| `CLAUDE.md`             | 251; `README.md` 350     | "Event bus: **Redpanda Cloud**"                                                                                                                                                                                                                                  | ADR-0022 (`docs/adr/ADR-0022-retire-the-redpanda-remnants.md:3`) = "**Accepted (2026-08-15, CEO Piotr — option A)**"; `ADR-0022:38` "can the bus work at all today? **No.**" Remaining code: `apps/stream-consumer/src/redpanda_client.py`, `apps/llm-gateway/src/jobs/consume_embed_seed_requests.py:30-36,200-202`, `infra/terraform/redpanda/`. `.github/workflows/modal-deploy.yml:13` "apps/stream-consumer is deliberately NOT deployed here and never will be" | **CONTRADICTS-OTHER-DOC** (CLAUDE.md/README vs ADR-0022)                                       |
| `README.md`             | 295                      | "`stream-consumer/` # Modal Python — Redpanda → ClickHouse"                                                                                                                                                                                                      | `.github/workflows/modal-deploy.yml:13` explicitly never deploys it; `e2e-smoke.yml:77-81` "nothing in this harness could ever exercise the `redpanda`/`stream-consumer` services"                                                                                                                                                                                                                                                                                    | **ASPIRATIONAL**                                                                               |
| `README.md`             | 292                      | "`decision-api/` # Cloudflare Worker — adaptation decisions"                                                                                                                                                                                                     | `apps/decision-api/src/index.ts:5,10` — `POST /api/adapt` returns **410 Gone** since 2026-05-25; canonical is control-plane (ADR-0004/0006)                                                                                                                                                                                                                                                                                                                           | **STALE**                                                                                      |
| `docs/adr/README.md`    | 9–22                     | ADR index, **12 rows**                                                                                                                                                                                                                                           | `ls docs/adr/*.md` = 22 ADR files. Missing from the index: ADR-0002, 0008, 0009, 0010, 0011, 0012, **0016**, 0017, 0018, **0022**. ADR-0016 (direct-Modal) and ADR-0022 (Redpanda retirement) are the two most load-bearing recent ADRs and neither is indexed                                                                                                                                                                                                        | **STALE**                                                                                      |
| `docs/MASTER_DESIGN.md` | 512–531 (§Snapshot.2)    | "As of HEAD `398dc97`: `apps/archetype-pipeline/src/main.py` = 22 lines … `apps/adaptation-engine/src/main.py` = 22 lines … `apps/auto-detect/src/main.py` = 13 lines … `apps/intent-engine/src/main.py` = 27 lines … `apps/llm-gateway/src/main.py` = 22 lines" | **none of `apps/archetype-pipeline`, `apps/adaptation-engine`, `apps/auto-detect` exist** (`ls apps`); `wc -l apps/intent-engine/src/main.py` = **193**; `apps/llm-gateway/src/main.py` = **58**                                                                                                                                                                                                                                                                      | **STALE** (5 of 6 bullets false)                                                               |
| `docs/MASTER_DESIGN.md` | 595 (§Snapshot.7 item 2) | "**Modal placeholder gap.** Four named services are 22-line stubs"                                                                                                                                                                                               | as above — three of the four apps were deleted; `intent-engine` is a real 193-line Modal service                                                                                                                                                                                                                                                                                                                                                                      | **STALE**                                                                                      |
| `docs/MASTER_DESIGN.md` | 465 (§Snapshot.1 A.3)    | Multi-region "🟥 Design-only — only EU region actually provisioned"                                                                                                                                                                                              | `infra/terraform/` has no `fra1/iad1/lhr1/dxb1` region vars anywhere (grep returns 0)                                                                                                                                                                                                                                                                                                                                                                                 | **MATCH** (verdict honest)                                                                     |
| `README.md`             | 360–368                  | Multi-region table: 4 regions fra1/iad1/lhr1/dxb1 with compliance regimes, stated unconditionally                                                                                                                                                                | contradicted by §Snapshot.1 A.3 above and by §Snapshot.7 item 3 ("Single-region infrastructure despite four-region marketing claim")                                                                                                                                                                                                                                                                                                                                  | **CONTRADICTS-OTHER-DOC**                                                                      |
| `CLAUDE.md`             | 54                       | "Four regions (EU/US/UK/UAE), 12-week MVP timeline"                                                                                                                                                                                                              | same; also `backlog/PLAN-V3-2026-05-30.md:32` records the CEO bump "8 tygodni → **10-12 tygodni**"; QUEUE is at session 158 (≈ month 5)                                                                                                                                                                                                                                                                                                                               | **STALE**                                                                                      |
| `README.md`             | 253                      | "# Deploy to staging (automatic on merge to main)"                                                                                                                                                                                                               | there is **no staging**: `docs/MASTER_DESIGN.md:5633` (§V.6.1, FOLLOW-878/ESC-052) "**There is no staging environment** … `stg` is retired by FOLLOW-873 and must not be written to — a write to `stg` is a write to production". A CI gate exists: `scripts/check-no-staging-plane.sh`                                                                                                                                                                               | **CONTRADICTS-OTHER-DOC** (and survived a gate whose register evidently does not cover README) |

### 0.2 Models and embeddings

| doc                                           | line  | claim                                                                               | code evidence                                                                                                                                                                                                                                                                                                                                                                                                              | verdict                                                                                                                                                                                |
| --------------------------------------------- | ----- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md`                                   | 256   | "Claude **Haiku 4.5** (workhorse), **Sonnet 4.6** (complex)"                        | `apps/intent-engine/src/nlp.py:61-62` `HAIKU_MODEL=claude-haiku-4-5-20251001`, `SONNET_MODEL=claude-sonnet-4-6`; `apps/llm-gateway/src/jobs/generate_description.py:1220` `_DEFAULT_GENERATION_MODEL="claude-sonnet-4-6"`; `apps/control-plane/src/lib/global-config-store.ts:36-37` allow-list = the same two                                                                                                             | **MATCH**                                                                                                                                                                              |
| `apps/decision-api/src/lib/llm-gateway.ts`    | 123   | default `model = 'claude-haiku-4-5'` (no date suffix, unlike every other call site) | the file is only reachable from the 410-Gone Worker                                                                                                                                                                                                                                                                                                                                                                        | STALE-but-inert                                                                                                                                                                        |
| `CLAUDE.md`                                   | 257   | "Embeddings: OpenAI **text-embedding-3-small**"                                     | `apps/control-plane/src/lib/openai-client.ts:57` `model: 'text-embedding-3-small'`                                                                                                                                                                                                                                                                                                                                         | **MATCH**                                                                                                                                                                              |
| `apps/control-plane/src/lib/openai-client.ts` | 5, 32 | docblock: "`text-embedding-3-small` vectors (**1536** dimensions)"                  | same package: `apps/control-plane/src/lib/archetype-seeder.ts:27` "Embedding dimension … (**reduced**)"; `apps/control-plane/src/lib/__tests__/seed-archetypes.test.ts:142` "it('equals **1024** (matching OpenAI text-embedding-3-small reduced dims)')"; `app/api/listings/embed/route.ts:7` "at **1024** dimensions (Matryoshka)"; `src/lib/rag-retrieval.ts:36` "intentVector — Session intent vector (**1536** dims)" | **CONTRADICTS-OTHER-DOC** — two live dimensions (1536 session-intent vs 1024 listing/archetype) documented inconsistently in the same module. **Verify before any vector-space work.** |

### 0.3 Thresholds and constants

| doc claim                                                                                                       | code evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | verdict                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| similarity 0.85 / 0.6 band                                                                                      | `apps/control-plane/src/app/api/adapt/route.ts:106-108` `CONFIDENCE_THRESHOLD = 0.6`, `HIGH_SIMILARITY_THRESHOLD = 0.85`, `LOW_SIMILARITY_THRESHOLD = 0.6`; used `:440`, `:513`                                                                                                                                                                                                                                                                                                         | **MATCH** (v4.5/v4.6 corrections held)                                                                                                                                                                                             |
| "similarity **0.75**"                                                                                           | not a threshold — `apps/control-plane/src/lib/demo-override-store.ts:98` `export const DEMO_OVERRIDE_SIMILARITY = 0.75`, consumed only at `route.ts:1774` behind demo mode (`route.ts:1765` "medium similarity (0.75) so Branch 3 (LLM tweak) runs")                                                                                                                                                                                                                                    | MATCH — but any doc quoting 0.75 as a production band is wrong                                                                                                                                                                     |
| `JUDGE_CALL_BUDGET_* = 3`                                                                                       | `apps/control-plane/src/lib/llm-gateway.ts:211` `JUDGE_CALL_BUDGET_TWEAK_BAND = 3`, `:235` `JUDGE_CALL_BUDGET_GENERATION_BAND = 3`, dispatched `:272`                                                                                                                                                                                                                                                                                                                                   | **MATCH** (FOLLOW-1180, #883)                                                                                                                                                                                                      |
| holdout rate 10%                                                                                                | `apps/decision-api/src/lib/ab-assignment.ts:20-21` `DEFAULT_HOLDOUT_PCT = 0.1`; §Snapshot.3 "lift vs the 10% holdout"                                                                                                                                                                                                                                                                                                                                                                   | **MATCH** — but the constant lives in the **410-Gone Worker**; no equivalent default was found in the canonical control-plane path. Area 13 cannot rule on which value the pilot will actually use → hand to the adapt-route area. |
| k-anonymity 50 / epsilon 2 (differential privacy)                                                               | grep for `K_ANON`, `MIN_COHORT`, `EPSILON`, `epsilon` over `apps packages infra` (excluding vendor) returns **zero** implementation hits. Only `apps/control-plane/src/app/api/admin/analytics/rollup/data.ts:13` mentions "differential privacy" in a comment; §Snapshot.1 G already says "global DP aggregation = design-only"                                                                                                                                                        | **ASPIRATIONAL** (Snapshot honest; any doc stating the numbers as shipped is wrong)                                                                                                                                                |
| p95 <100 ms Decision API / <50 ms ingest ACK (`CLAUDE.md:290`)                                                  | ingest half is real and enforced in design: `apps/ingest/src/index.ts:14` "Latency target: p95 < 50ms", `handlers/events.ts:165,572-573`, `tests/load/k6-ingest-baseline.js:62` "Primary SLA: p95 < 50ms, p99 < 200ms" as a k6 threshold. **The <100 ms Decision API budget has no gate, test or threshold anywhere** — grep over `.github/workflows`, `tests/load`, `apps/control-plane` finds none; the canonical `/api/adapt` now makes a model call on every request (v4.11 §E.7.0) | **half MATCH / half ASPIRATIONAL**                                                                                                                                                                                                 |
| SDK bundle <42 KB gzip (`CLAUDE.md:291`)                                                                        | `packages/sdk/scripts/check-bundle-size.js:16` `MAX_BYTES = 42 * 1024`; gate wired at `.github/workflows/ci.yml:263` "SDK bundle size gate (<42KB gzip, ESC-028)" → `pnpm --filter=@estalara/sdk build:check`                                                                                                                                                                                                                                                                           | **MATCH**                                                                                                                                                                                                                          |
| "measured **39.86 KB** at 2026-07-01 audit" (`CLAUDE.md:291`; `MASTER_DESIGN` §Snapshot.1 B.2 "~95% of budget") | local `packages/sdk/dist/estalara-sdk.iife.js` (built 2026-08-27) gzips to **42,844 B = 41.84 KB** — i.e. **over** the 42 KB gate by 316 B on that artifact, and 2 KB above the quoted figure. Caveat: a dist built outside CI; the CI gate is the authority                                                                                                                                                                                                                            | **STALE** — the quoted number is ~5 % low and the "thin headroom" framing understates the risk. Worth a real measurement.                                                                                                          |

### 0.4 Counts

| doc claim                                                                                                          | code evidence                                                                                                                                                                                                                                                     | verdict                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------ |
| 18 archetypes (17 non-neutral)                                                                                     | `packages/shared/src/archetypes.ts:36-64` `CANONICAL_ARCHETYPE_IDS` = 17 named + `neutral` = **18**; `ls packages/sdk/src/core/playbooks/archetypes/*.ts` = **18** files, one per id                                                                              | **MATCH**                                                                                                                                                |
| "**17 playbooks**"                                                                                                 | 18 playbook files including `neutral.ts`; QUEUE session-156 banner says "all **17 shipped** playbooks carry exactly 3 slots" — i.e. 17 non-neutral + neutral                                                                                                      | MATCH (naming ambiguity only)                                                                                                                            |
| §Snapshot.1 D.6 "All 17 non-neutral archetypes reachable: 9 🟢 / 6 🟡 / 2 ⚪"                                      | consistent with the 17+neutral set. Contradicted by the userMemory-recorded scope "13/18 reachable" (`project_adaptive_listings_v1_scope`) — a doc-vs-memory gap, not a doc-vs-code one                                                                           | MATCH                                                                                                                                                    |
| "SDK emits 21 of 46 declared event types … the `EVENT_TYPES` tuple has since grown to **52**" (§Snapshot.1 C)      | `packages/shared/src/schemas/events/index.ts:225-292` — **55** entries                                                                                                                                                                                            | **STALE** (numerator unverified here; denominator wrong)                                                                                                 |
| 4 regions                                                                                                          | see 0.1                                                                                                                                                                                                                                                           | ASPIRATIONAL                                                                                                                                             |
| "**The 9 agents**" (`CLAUDE.md:169`, `docs/AGENT_WORKFLOW.md:14`, `README.md:322` "Nine specialized … subagents")  | `ls .claude/agents/*.md` = **10**: the 9 in the table **plus `retrospective-analyst.md`**. CLAUDE.md describes retrospective-analyst at length (§"Per-ticket retrospective loop", and the model-fit table routes it) but excludes it from the count and the table | **STALE** in all three docs. CLAUDE.md's own escalation rule ("they notice the agent count … is stale relative to current state") makes this reportable. |
| §Snapshot.5 "102 TypeScript test files + 14 Python = **116 total**"                                                | `find` over `apps packages tests` excluding `node_modules`/`dist`: **392** TS `\*.test.ts                                                                                                                                                                         | \*.test.tsx                                                                                                                                              | \_.spec.ts`+ **21** Python`test\_\_.py`(excluding`.venv`) | **STALE** by ~3.5× |
| §Snapshot.6 "**42 permanent rules** in `CONVENTIONS_PATCH.md` (A–L, N–P, R–U, W–Z, M, V, Q, AA–AP)"                | `grep -c '^#\+ Rule '` = **71**; last rules are AY, AZ, BA, BB, **BC**                                                                                                                                                                                            | **STALE**                                                                                                                                                |
| §Snapshot.6 "228+ retros (RETRO-001..228 as of 2026-08-03)"                                                        | `grep -c '^## RETRO-'` = **311**; newest = **RETRO-323**                                                                                                                                                                                                          | **STALE**                                                                                                                                                |
| §Snapshot.6 "591+ follow-ups (FOLLOW-001..591+)"                                                                   | `grep -c '^## FOLLOW-'` = **1003**; newest = **FOLLOW-1190**                                                                                                                                                                                                      | **STALE**                                                                                                                                                |
| §Snapshot.1 B.4.4 "Platform Templates Library (15 starters) ⛔ **Blocked** — `templates: PlatformTemplate[] = []`" | `packages/platform-templates/src/templates/index.ts:5` "Empty in this placeholder; populated in TICKET-032 (15 starter templates)"; `ls src/templates/*.ts` = 1 file (the empty registry)                                                                         | **MATCH**                                                                                                                                                |
| `packages/platform-templates/src/index.ts:4` "pre-validated CSS selectors for **50+** known real estate platforms" | the registry is empty (above)                                                                                                                                                                                                                                     | **STALE** — package docblock oversells its own empty registry                                                                                            |
| `packages/platform-templates/src/index.ts:9-15` layer table "L4 = Heuristic, **L5 = AI Vision (Claude)**"          | `MASTER_DESIGN` §Snapshot.1 B.5: "**L4 AI Vision** wired end-to-end … L3 (platform templates)"                                                                                                                                                                    | **CONTRADICTS-OTHER-DOC** — the L-numbering of the detection pipeline differs between the package and the SoT                                            |

### 0.5 §Snapshot.1 — the 10 most load-bearing rows vs QUEUE + code

| § row                            | Snapshot verdict                                                                                                                                                                           | QUEUE / code at HEAD                                                                                                                                                                                                                                       | verdict                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A.1 Architecture diagram         | 🟡 Partial/Drifted                                                                                                                                                                         | still true, but the reason text cites Modal apps that were deleted (see §Snapshot.2)                                                                                                                                                                       | MATCH (reason STALE)                                                                                                                                   |
| B.2 SDK perf budget              | 🟡 "39.86 KB, ~95% of budget"                                                                                                                                                              | local dist = 41.84 KB gzip                                                                                                                                                                                                                                 | **STALE**                                                                                                                                              |
| B.6 Continuous Schema Validation | 🟡 `CODE_COMPLETE_OPERATOR_PENDING` with a verbatim flip-condition                                                                                                                         | flip-condition never met per v4.8 changelog; `scripts/check-modal-local-imports.py` gate exists                                                                                                                                                            | MATCH                                                                                                                                                  |
| C Signal ingestion               | 🟡 "21 of 46 … tuple grown to 52"                                                                                                                                                          | tuple = **55**                                                                                                                                                                                                                                             | **STALE**                                                                                                                                              |
| D Intent Engine                  | 🟡 "18-archetype set consistent across ~15 code locations"                                                                                                                                 | `CANONICAL_ARCHETYPE_IDS` is now the single source with a parity test (`packages/shared/src/__tests__/archetype-canonical-parity.test.ts:54`) — stronger than the row claims                                                                               | STALE (understates)                                                                                                                                    |
| E.1–E.3 A/B + bandit             | 🟡 Partial                                                                                                                                                                                 | §Snapshot.3 still says "Bandit currently picks index 0 always" and §Snapshot.7 item 5 "bandit.ts not imported by any non-test file" — a `tests/e2e/follow-819/bandit-probe.mjs` now exists; not re-audited here                                            | **BLOCKED** — needs the bandit area's verdict                                                                                                          |
| E.7 Description pipeline         | 🟢 Shipped + LIVE in prod                                                                                                                                                                  | `MASTER_DESIGN:5` (v4.11 §E.7.0) now says an ungroundable request must **not** adapt and "niedostępność LLM degraduje się do BRAKU adaptacji"; QUEUE session-148 banner warns the adaptation rate will fall. The 🟢 row was not re-graded                  | **STALE** — the row predates the ruling that changed the behaviour it grades                                                                           |
| H Compliance                     | ✅ Shipped                                                                                                                                                                                 | QUEUE START-HERE: "FOLLOW-815 is DONE with operator residue only"; **FOLLOW-1169 (P1, prompt-text disclosure on a public GET) is listed as "a go-live gate item"** and open                                                                                | **STALE** — ✅ Shipped is not compatible with an open P1 disclosure gate                                                                               |
| V Security                       | 🟡 Partial                                                                                                                                                                                 | consistent with FOLLOW-1168/1169 open                                                                                                                                                                                                                      | MATCH                                                                                                                                                  |
| §Snapshot.5 last bullet          | "Critical gap: **no end-to-end test of intent → archetype → adapt → DOM**"                                                                                                                 | `tests/e2e/follow-819/differentiator-e2e.mjs` exists and `tests/e2e/follow-819/README.md:20` records **6/6 green, 2026-08-26T10:06:24Z**, and QUEUE START-HERE confirms "FOLLOW-819 is 6/6 with its AC(2) fixture caveat"                                  | **STALE** — the SoT still lists as an open critical gap the thing FOLLOW-820 condition 1 reads. This is the single highest-impact doc row in the area. |
| §Snapshot.7 item 4 RLS backfill  | listed as an open risk on `session_embeddings`, `tenant_site_schemas`, `ab_bandit_weights`, `schema_validation_history`, `archetype_embeddings`                                            | `packages/db/migrations/0012_rls_policies.sql:34,35,37,43` enables RLS on `tenant_site_schemas`, `ab_bandit_weights`, `schema_validation_history`, `session_embeddings`; also `0004:35`, `0008:28`. Only `archetype_embeddings` was not found in that file | **STALE** (4 of 5 closed)                                                                                                                              |
| §Snapshot header                 | "Snapshot (2026-05-24; verdicts refreshed **2026-07-09** — FOLLOW-470)" vs §Y.3: "if the snapshot date is older than **7 days**, sessions should assume drift" (`MASTER_DESIGN:6791-6800`) | 66 days stale by its own policy                                                                                                                                                                                                                            | **the document fails its own freshness rule**                                                                                                          |

### 0.6 Secrets / run instructions (names only)

| doc               | claim                                                                                                                                                                       | `.env.example` / code                                                                                                                                                                                                               | verdict                                                                                                  |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `README.md:61-99` | Doppler-only, `doppler setup` → project `estalara`, config `dev`; `pnpm seed:archetypes`                                                                                    | `.env.example` exists at root plus `apps/{ingest,decision-api,control-plane}/.env.example` — README says "Secrets are managed via **Doppler** — never stored in `.env` files" (`README.md:59`) while four `.env.example` files ship | minor CONTRADICTS (templates, not secrets — benign)                                                      |
| `.env.example:66` | `LITELLM_MASTER_KEY`                                                                                                                                                        | only consumer is the 410-Gone Worker (`apps/decision-api/src/lib/llm-gateway.ts:98`); `LITELLM_BASE_URL` is **absent** from `.env.example` while the code reads it                                                                  | **STALE** — a dead-path secret is templated and its sibling is not                                       |
| `.env.example`    | `DATABASE_URL_ADMIN` — **absent** (grep 0)                                                                                                                                  | referenced as a live Doppler secret in `MASTER_DESIGN:5633` (§V.6.1 / ESC-052) and in memory `project_admin_db_url_pooler_28p01`                                                                                                    | **STALE** (gap)                                                                                          |
| `.env.example`    | `CLICKHOUSE_URL` absent; `CLICKHOUSE_HOST/PORT/USER/PASSWORD` present (`:29-32`)                                                                                            | name shape differs from the runbooks' usual `CLICKHOUSE_URL`; not a defect on its own                                                                                                                                               | note only                                                                                                |
| `.env.example`    | `INTENT_REALTIME_MODEL`, `INTENT_BATCH_MODEL` absent                                                                                                                        | read at `apps/intent-engine/src/nlp.py:61-62`, `src/main.py:97`, `src/jobs/batch_enrich.py:50`                                                                                                                                      | **STALE** (gap) — the two model overrides that decide which Claude runs are undocumented in the template |
| `.env.example`    | `REDPANDA_REST_URL` absent; `REDPANDA_BROKERS/SASL_*/TOPIC_*` read at `apps/llm-gateway/src/jobs/consume_embed_seed_requests.py:30-36,200-202` and absent from the template | consistent with ADR-0022 retirement, inconsistent with README/CLAUDE.md still listing Redpanda as the event bus                                                                                                                     | see 0.1                                                                                                  |

### 0.7 The FOLLOW-819 / FOLLOW-820 narrative

| doc                                                    | line                        | claim                                                                                                                                                         | evidence                                                                                                                                                                                                                                                                                                                                                                                                                                        | verdict                                                                                                                                                                                                                                    |
| ------------------------------------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/MASTER_DESIGN.md`                                | whole document              | FOLLOW-1129: "MASTER_DESIGN does not mention FOLLOW-819, FOLLOW-820 or the localhost-first critical path at all" (`backlog/FOLLOW_UPS.md:44613`)              | `grep -c 'FOLLOW-819\|FOLLOW-820' docs/MASTER_DESIGN.md` = **2**, both incidental: `:5` (inside the v4.11 Polish changelog paragraph, saying the measured adaptation rate will fall) and `:2682` (the same sentence in English inside §E.7.0). **There is still no §Snapshot row, no §P roadmap entry and no statement of the gate** anywhere in the SoT; "localhost-first" appears only in §V.6.1 (`:5633`) as a data-plane secrets correction | **half-fixed → STALE.** FOLLOW-1129's headline is now literally false but its substance holds: the document every session boots from does not describe the only exit from the localhost stage. Do not close FOLLOW-1129 on the grep alone. |
| `docs/MASTER_DESIGN.md`                                | 584 (§Snapshot.5)           | "Critical gap: no end-to-end test of intent → archetype → adapt → DOM"                                                                                        | FOLLOW-819 is 6/6 green (`tests/e2e/follow-819/README.md:20`)                                                                                                                                                                                                                                                                                                                                                                                   | **STALE** — FOLLOW-1148's last clause, unexecuted                                                                                                                                                                                          |
| `tests/e2e/follow-819/README.md` §0                    | 15–60                       | Execution status table; "**6 / 6 green (§5.9, FOLLOW-1139)**"; AC(7)/AC(5)/AC(2) red-first proofs each named with a run                                       | internally consistent; the ESC-073 clarification is present and explicit ("Condition 1 does NOT require a positive lift, and never did", `:31`); `ctaLift` non-positive-by-construction is explained rather than used as a blocker                                                                                                                                                                                                              | **MATCH — FOLLOW-1133's defect is fixed.** The self-contradiction FOLLOW-1133 named ("imposes the positive-lift requirement ESC-073 abolished") is gone.                                                                                   |
| `tests/e2e/follow-819/README.md`                       | 26                          | "`last-run.json` is **`.gitignore`d by design** … NOT citable to a reader at HEAD"                                                                            | `git ls-files tests/e2e/follow-819/` returns only `.gitignore`, `README.md`, `bandit-probe.mjs`, `differentiator-e2e.mjs`, `fixture-listing.html`; `git check-ignore -v` confirms `tests/e2e/follow-819/.gitignore:4` ignores it. An untracked `last-run.json` **is present in the working tree**                                                                                                                                               | **MATCH** — FOLLOW-1148's `last-run.json` contradiction is fixed                                                                                                                                                                           |
| `tests/e2e/follow-819/README.md`                       | 3                           | "six independently-checkable acceptance criteria"                                                                                                             | the file defines AC(1)…AC(7)                                                                                                                                                                                                                                                                                                                                                                                                                    | minor STALE (count not bumped when AC(7) was added by FOLLOW-1131)                                                                                                                                                                         |
| FOLLOW-820 stub (`backlog/FOLLOW_UPS.md`, condition 1) | —                           | "**Not gradeable until FOLLOW-1124 lands**"                                                                                                                   | FOLLOW-1124 has landed — `tests/e2e/follow-819/README.md:748,797` (§5.4, §5.5) record the per-run-scoped AC(5) predicate and its executed red→green                                                                                                                                                                                                                                                                                             | **STALE** — the CEO's own checklist still says its first condition cannot be graded. FOLLOW-1148 scope.                                                                                                                                    |
| `README.md` (root)                                     | 12                          | "**Active development — Sprint 22b (Full-Stack Audit Remediation) in progress** … closes the 2026-07-01 audit findings (F-01…F-21) before a _measured_ pilot" | `backlog/QUEUE.md:3` START HERE = **session 158**, `main` `4a89aad1`→`f510f749`, ESC-078 billing lock resolved, next work FOLLOW-1184/1168/1169; 2026-08-04 and 2026-08-17 audits both postdate the one README names                                                                                                                                                                                                                            | **STALE** — ~10 weeks and three audits behind. The root README has no §0 and never mentions the localhost-first ruling, FOLLOW-819 or FOLLOW-820.                                                                                          |
| `docs/AUDIT-2026-08-17.md`                             | 25–35 (§1 "verified green") | "28/28 quiz paths … All 17 non-neutral archetypes now resolve to their own copy"; "Detection → DOM latency ✅ **9,565 ms → ~40 ms**"                          | §2 (`:38-52`) states the fixes and the measurement were made **inside `scripts/dev/mock-decision-server.mjs`** — the `:9100` mock decision harness. Per CLAUDE.md's localhost-first section, "a green local runbook with the mock in the loop is not evidence"                                                                                                                                                                                  | **STALE/misleading** — the most recent audit's headline green table is mock-derived and the caveat sits one section below the table, not in it                                                                                             |

### 0.8 Hardcoded Master_Design version numbers (CLAUDE.md §Document Versioning Policy forbids them)

Policy: `CLAUDE.md:99-113` — supporting documents must not carry a Master_Design version;
`docs/MASTER_DESIGN.md:6769` and `docs/ops/OPERATING_PRINCIPLES.md:80` — never link a versioned
filename.

**Live documents carrying a hardcoded Master_Design version (violations):**

| file                                                                                                                                                                                                                                                                                                                            | line   | text                                                                                              | note                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `HANDOFF.md`                                                                                                                                                                                                                                                                                                                    | 315    | table row \| `docs/MASTER_DESIGN.md` \| "Architektura **v1.4**"                                   | worst case — 3 major versions stale, in a handoff index                      |
| `AUDIT_RISK_MATRIX.md`                                                                                                                                                                                                                                                                                                          | 56, 99 | "CLAUDE.md is 6 minor versions stale vs MASTER_DESIGN.md (says **v1.1**, doc is **v1.7.1/v1.8**)" | the finding itself is obsolete; CLAUDE.md no longer carries a version at all |
| `AUDIT_REPORT_INVESTOR_READINESS.md`                                                                                                                                                                                                                                                                                            | 711    | "Master Design **v1.8** (this commit)"                                                            |                                                                              |
| `docs/AGENT_WORKFLOW.md`                                                                                                                                                                                                                                                                                                        | 75     | "`docs/MASTER_DESIGN.md` Changelog **v4.3**"                                                      | a quotation, arguably permissible                                            |
| `docs/adr/ADR-0004-canonical-adapt-endpoint.md`                                                                                                                                                                                                                                                                                 | —      | carries an MD version                                                                             | ADRs are dated records; acceptable                                           |
| `.claude/agents/pm-orchestrator/lessons.md`, `.claude/agents/architect/lessons.d/FOLLOW-882-887.md`                                                                                                                                                                                                                             | —      | MD version cited                                                                                  | dated lesson logs — exempt per Rule AI's corpus rule (`MASTER_DESIGN:9`)     |
| `backlog/PLAN-V3-2026-05-30.md`, `backlog/sprint-8/TICKET-ARCH-MD-001.md`, `backlog/sprint-15/FOLLOW-195/199/202.md`, `backlog/FOLLOW_UPS.md` (many), `backlog/QUEUE.md` (many)                                                                                                                                                 | —      | MD versions cited                                                                                 | dated backlog records — exempt                                               |
| `docs/AUDIT-2026-06-04.md`, `docs/AUDIT-2026-07-12.md`, `docs/PLAN-REMEDIATION-2026-07-12.md`, `docs/compliance/dpia.md`, `docs/ai-council/CHECKPOINT_2026-05-24_SPRINT_12.md`, `docs/decisions/DECISIONS_2026-05-18.md`, `docs/audits/AUDIT_REPORT_2026-07-21_CODE_DIAGNOSIS.md`, `docs/specs/TICKET-DESC-PIVOT-001-v1.7.1.md` | —      | MD versions cited                                                                                 | dated records — exempt                                                       |

**Links to versioned filenames:** only three hits estate-wide, and **all three are the prohibition
itself** (`CLAUDE.md:108`, `docs/MASTER_DESIGN.md:6769`, `docs/ops/OPERATING_PRINCIPLES.md:80`). The
snapshot file `docs/specs/MASTER_DESIGN_PATCH_v1_5.md` exists on disk but is not linked from any
active document. **No violation on this axis.**

---

## 1. Findings

### D-1 — `MASTER_DESIGN` §Snapshot.5 still lists the FOLLOW-820 condition-1 test as an open critical gap

- **Claim:** §Snapshot.5's last bullet reads "Critical gap: no end-to-end test of intent → archetype
  → adapt → DOM", while that test exists and has been 6/6 green since 2026-08-26.
- **Status:** STALE
- **Evidence:** `docs/MASTER_DESIGN.md:584`; `tests/e2e/follow-819/differentiator-e2e.mjs` (tracked,
  `git ls-files`); `tests/e2e/follow-819/README.md:20` "**6 / 6 green (§5.9, FOLLOW-1139)** …
  2026-08-26T10:06:24Z"; `backlog/QUEUE.md:36` "FOLLOW-819 is 6/6 with its AC(2) fixture caveat".
- **Impact on measured pilot:** blocks go-live — the CEO grades FOLLOW-820 condition 1 against a SoT
  row that says the condition is unmet. A conscientious reading of §Snapshot.1/.5 alone yields
  NO-GO.
- **Ticket coverage:** **FOLLOW-1148** (`backlog/FOLLOW_UPS.md:45904`, headline includes
  "MASTER_DESIGN still lists the now-green E2E as a critical gap"). QUEUE lists FOLLOW-1148 near the
  **end** of the session-158 order (`backlog/QUEUE.md:29`) — OPEN, not started.
- **Priority + deps:** **P0** on the FOLLOW-820 path (raise from FOLLOW-1148's position). Depends on
  nothing.
- **Proposed AC:**
  - §Snapshot.5 bullet rewritten to cite the harness path and the 6/6 run date, with the
    AC(2)-fixture-divergence caveat named.
  - A §Snapshot.1 row (or §P entry) states the localhost-first critical path and FOLLOW-820's four
    conditions.
  - Grep `FOLLOW-819|FOLLOW-820` over `docs/MASTER_DESIGN.md` returns ≥1 hit **outside** a changelog
    paragraph.
- **Red-first / proof:** a test or gate asserting
  `grep -n "no end-to-end test of intent" docs/MASTER_DESIGN.md` returns 0 lines — red today, green
  when done. (`scripts/check-*.sh` is the established substitute-gate pattern here.)

### D-2 — CLAUDE.md and README still name Redpanda Cloud as the event bus and LiteLLM as the LLM router; ADR-0022 retired the first and no code uses the second

- **Claim:** two decided-stack rows in both onboarding documents describe infrastructure that is
  retired (Redpanda) or nonexistent on the live path (LiteLLM).
- **Status:** STALE / CONTRADICTS-OTHER-DOC
- **Evidence:** `CLAUDE.md:251,256`; `README.md:294,295,350,355`;
  `docs/adr/ADR-0022-retire-the-redpanda-remnants.md:3` (Accepted 2026-08-15, option A), `:38` "can
  the bus work at all today? **No.**"; `.github/workflows/modal-deploy.yml:13` stream-consumer
  "deliberately NOT deployed … and never will be"; `apps/llm-gateway/pyproject.toml:11-20` (no
  litellm); `apps/control-plane/src/lib/llm-gateway.ts:32` (direct `@anthropic-ai/sdk`); the only
  LiteLLM code is `apps/decision-api/src/lib/llm-gateway.ts`, reachable only through a 410
  (`apps/decision-api/src/index.ts:5`).
- **Impact on measured pilot:** degrades data indirectly — every new session boots from CLAUDE.md
  with a false stack model; the documented escalation path for "add a third-party service" is
  calibrated against a bus that cannot work. Also `CLAUDE.md:177` still defines `data-engineer` as
  owning "Redpanda pipelines".
- **Ticket coverage:** **FOLLOW-986** and ADR-0022 own the code retirement; **FOLLOW-825**
  (`backlog/FOLLOW_UPS.md:27516`) is the "Stale-docs sweep … remove the dead decision-api libs"
  ticket and is the natural home. No ticket found that names `CLAUDE.md:251/256` or
  `README.md:350/355` specifically → **NO COVERAGE on the doc axis.**
- **Priority + deps:** P1. Independent.
- **Proposed AC:**
  - `CLAUDE.md` tech stack: Redpanda row marked RETIRED (ADR-0022) or removed; LLM row drops "via
    LiteLLM router".
  - `README.md` tech stack + repo tree agree with `ls apps` and ADR-0022; `stream-consumer` and
    `decision-api` rows state their real (undeployed / 410) status.
  - `data-engineer.md` and `CLAUDE.md:177` no longer assign Redpanda ownership.
- **Red-first:** `scripts/check-no-staging-plane.sh`-style gate with a register containing
  `Redpanda Cloud` and `LiteLLM router` over `CLAUDE.md`+`README.md` — red today.

### D-3 — §Snapshot.2/.3/.7 describe a repository that no longer exists (three deleted apps, HEAD `398dc97`)

- **Claim:** §Snapshot.2 enumerates `apps/archetype-pipeline`, `apps/adaptation-engine`,
  `apps/auto-detect` as 13–22-line placeholders and `apps/intent-engine` as 27 lines; none of the
  three apps exist and intent-engine is 193 lines. §Snapshot.7 item 2 repeats it.
- **Status:** STALE
- **Evidence:** `docs/MASTER_DESIGN.md:512-531`, `:595`; `ls apps` (7 dirs, none of the three);
  `wc -l apps/intent-engine/src/main.py` = 193, `apps/llm-gateway/src/main.py` = 58. The §Snapshot
  preamble (`:357-366`) already flags §Snapshot.2/.3/.5 as un-refreshed — the document knows.
- **Impact on measured pilot:** degrades data — a session planning the intelligence layer from
  §Snapshot.2 will propose building apps that were deliberately deleted (this is the exact
  2026-05-20 anti-pattern §Y exists to prevent).
- **Ticket coverage:** **FOLLOW-825** — "retire `§Snapshot.2/.3/.5`"
  (`backlog/FOLLOW_UPS.md:27516`), promoted (`backlog/QUEUE.md:28277`), still OPEN. Also ADR-0005
  (Modal apps disposition) documents the intent.
- **Priority + deps:** P1. Independent.
- **Proposed AC:** §Snapshot.2/.3/.7 either deleted or rewritten against `ls apps`/`ls packages` at
  the editing commit; no §Snapshot text names a path that does not exist.
- **Red-first:** a script that extracts every `apps/...`/`packages/...` path from §Snapshot and
  asserts each exists on disk — red today (≥3 failures).

### D-4 — §Snapshot.6 learning-loop counters are 2–3× low; §Snapshot header is 66 days past its own 7-day freshness rule

- **Claim:** "42 rules / 228+ retros / 591+ follow-ups" vs 71 / 311 (RETRO-323) / 1003
  (FOLLOW-1190); the snapshot header says verdicts were refreshed 2026-07-09 while §Y.3 requires
  re-verification each sprint and says >7 days ⇒ assume drift.
- **Status:** STALE
- **Evidence:** `docs/MASTER_DESIGN.md:586-591` (§Snapshot.6), `:357` (header date), `:6791-6800`
  (§Y.3); `grep -c '^#\+ Rule ' CONVENTIONS_PATCH.md` = 71 (last = Rule BC);
  `grep -c '^## RETRO-' backlog/RETROSPECTIVES.md` = 311, newest RETRO-323;
  `grep -c '^## FOLLOW-' backlog/FOLLOW_UPS.md` = 1003, newest FOLLOW-1190.
- **Impact on measured pilot:** none directly; it is the _reason_ the other rows in this report went
  unnoticed — the SoT has no live freshness enforcement.
- **Ticket coverage:** **NO COVERAGE** found for the counters. §Y.3 is the policy; no ticket
  enforces it.
- **Priority + deps:** P2.
- **Proposed AC:**
  - §Snapshot.6 counters are derived, not typed — replaced by a pointer to a script, or regenerated
    by one.
  - A CI gate fails when §Snapshot.6's stated counts differ from `grep -c` over the three files by
    more than a stated tolerance.
  - The §Snapshot header date is refreshed in the same PR as any §Snapshot.1 row change (already
    §Y.2 item 5; make it mechanical).
- **Red-first:** `scripts/check-snapshot-counters.sh` comparing the three numbers — red today
  (42≠71, 228≠311, 591≠1003).

### D-5 — §Snapshot.1 rows E.7 (🟢 Shipped + LIVE) and H (✅ Shipped) were not re-graded after the rulings/tickets that changed what they grade

- **Claim:** E.7 is 🟢 although v4.11 §E.7.0 changed the pipeline's failure mode from "canned
  adaptation" to "no adaptation" and predicts a measured-rate fall; H is ✅ although FOLLOW-1169
  (P1, prompt-text disclosure on a public GET) is explicitly listed in QUEUE as "a go-live gate
  item" and is open.
- **Status:** STALE
- **Evidence:** `docs/MASTER_DESIGN.md:465` region (§Snapshot.1 rows E.7 and H); `:5` and `:2682`
  (the §E.7.0 ruling and its named cost); `backlog/QUEUE.md:33` "FOLLOW-1169 (P1 — prompt-text
  disclosure on a public GET; a go-live gate item)"; v4.11's own §Y.2 propagation line says "5
  `backlog/STATUS.md` — no-op (§Snapshot.1 **nietknięte**)" — i.e. the ruling deliberately left the
  row it invalidates alone.
- **Impact on measured pilot:** invalidates measurement (E.7) and legal-security exposure (H) — a ✅
  Shipped compliance row is the row a go/no-go reads.
- **Ticket coverage:** FOLLOW-1169 covers the compliance defect (OPEN, P1, `backlog/QUEUE.md:33`);
  the E.7 row itself has **NO COVERAGE** — v4.11's propagation checklist recorded §Snapshot.1 as
  untouched rather than opening a stub.
- **Priority + deps:** P1. E.7 row depends on nothing; H row should flip only when FOLLOW-1169
  closes.
- **Proposed AC:**
  - E.7 row restated with the §E.7.0 grounding rule and the "no grounding ⇒ no adaptation" failure
    mode named.
  - H row carries an explicit open-P1 annotation naming FOLLOW-1169 until it closes.
  - §Y.2 gains a rule: a ruling that changes runtime behaviour may not record "§Snapshot.1
    untouched" without naming the row it grades and why it still holds.
- **Red-first:** a check that every §Snapshot.1 ✅/🟢 row has no OPEN P0/P1 ticket whose QUEUE text
  names it a go-live gate — red today on row H.

### D-6 — Both onboarding documents and AGENT_WORKFLOW say "9 agents"; there are 10 agent definitions

- **Claim:** `retrospective-analyst` is a tenth agent, described at length in CLAUDE.md prose and
  routed by the model-fit rule, but excluded from the count and the table in all three docs.
- **Status:** STALE
- **Evidence:** `CLAUDE.md:169` "## The 9 agents"; `docs/AGENT_WORKFLOW.md:14` "## The 9 agents";
  `README.md:322` "Nine specialized Claude Code subagents"; `ls .claude/agents/*.md` = 10 including
  `retrospective-analyst.md`; CLAUDE.md §"Per-ticket retrospective loop" describes it as a standing
  part of the workflow.
- **Impact on measured pilot:** none.
- **Ticket coverage:** **NO COVERAGE**. CLAUDE.md's own escalation list ("they notice the agent
  count or repository structure documented in CLAUDE.md is stale") makes this a reportable item
  rather than a silent fix.
- **Priority + deps:** P3.
- **Proposed AC:** the three tables list 10 agents with `retrospective-analyst`'s model; a gate
  asserts the table row count equals `ls .claude/agents/*.md | wc -l`.
- **Red-first:** that gate — red today (9 vs 10).

### D-7 — SDK bundle headroom is worse than every document says

- **Claim:** `CLAUDE.md:291` and §Snapshot.1 B.2 both quote **39.86 KB** gzip against the 42 KB
  gate; the artifact in the tree gzips to **41.84 KB** (42,844 B), 316 B over the gate.
- **Status:** STALE — with a caveat.
- **Evidence:** `CLAUDE.md:291`; `docs/MASTER_DESIGN.md:465` region (row B.2, "~95% of budget");
  `packages/sdk/scripts/check-bundle-size.js:16` `MAX_BYTES = 42 * 1024`;
  `.github/workflows/ci.yml:263` wires the gate;
  `gzip -c packages/sdk/dist/estalara-sdk.iife.js | wc -c` = **42844** on a dist dated 2026-08-27.
  **Caveat:** this is a local, possibly non-CI-equivalent build; the CI gate on `main` is green
  (44/45, only Rule I red — `backlog/QUEUE.md:16-19`), so the CI-built artifact is presumably ≤42
  KB. The _documented number_ is wrong either way.
- **Impact on measured pilot:** none directly; it removes the headroom margin the docs promise and
  makes FOLLOW-469 (headroom recovery, P3) look less urgent than it is.
- **Ticket coverage:** **FOLLOW-469** (headroom recovery, P3, cited in §Snapshot.1 B.2). The stale
  _number_ has **NO COVERAGE**.
- **Priority + deps:** P2. Depends on one CI-equivalent build to get the real figure.
- **Proposed AC:** B.2 and `CLAUDE.md:291` quote a figure produced by
  `pnpm --filter=@estalara/sdk build:check` in CI, with the run id; the docs stop carrying a
  hand-copied byte count, or a gate compares them.
- **Red-first:** `pnpm --filter=@estalara/sdk build:check` from a clean build and diff its printed
  KB against the two docs — red today.

### D-8 — `docs/AUDIT-2026-08-17.md`'s green table is mock-harness evidence presented as verified

- **Claim:** the most recent audit's §1 "What was verified green" table asserts 28/28 quiz paths,
  all 17 archetypes, and a 9,565 ms → ~40 ms latency win; §2 reveals the fixes and the measurement
  were made inside `scripts/dev/mock-decision-server.mjs` (the `:9100` mock).
- **Status:** STALE / misleading
- **Evidence:** `docs/AUDIT-2026-08-17.md:25-35` (table), `:38-52` (§2: "The latency target and the
  'demo shows the wrong buyer' bug were both fixed inside the local decision harness
  (`scripts/dev/mock-decision-server.mjs`)"); `CLAUDE.md` localhost-first section: "'Works on
  localhost' means the REAL control plane (`/api/adapt` via `llm-gateway.ts`), not the `:9100` mock
  decision harness. A green local runbook with the mock in the loop is not evidence."
- **Impact on measured pilot:** invalidates measurement if quoted — the ~40 ms figure is a mock's
  latency and cannot survive the v4.11 rule that every request now carries a model call.
- **Ticket coverage:** **NO COVERAGE** found (grepped `AUDIT-2026-08-17`, `mock-decision-server`,
  `9100` in FOLLOW_UPS/QUEUE/ESCALATIONS).
- **Priority + deps:** P2.
- **Proposed AC:** every row of that §1 table carries its substrate (mock vs real control plane)
  inline; the ~40 ms latency row is either re-measured against `/api/adapt` or marked mock-only.
- **Red-first:** grep the table for the word "mock"/"harness" — 0 hits today; ≥1 per mock-derived
  row when done.

### D-9 — `docs/adr/README.md` indexes 12 of 22 ADRs, omitting ADR-0016 and ADR-0022

- **Claim:** the ADR index is missing 10 ADRs including the two that define the current Modal
  dispatch (0016) and the Redpanda retirement (0022).
- **Status:** STALE
- **Evidence:** `grep -c '^| \[' docs/adr/README.md` = 12; `ls docs/adr/*.md` = 22 ADRs + README.
  Missing: ADR-0002, 0008, 0009, 0010, 0011, 0012, 0016, 0017, 0018, 0022. Also two ADRs claim the
  same number-ish topic under two filename conventions (`0007-canonical-adapt-endpoint.md` PROPOSED
  vs `ADR-0004-canonical-adapt-endpoint.md` ACCEPTED) — both indexed, easy to confuse.
- **Impact on measured pilot:** degrades data — D-2's Redpanda/LiteLLM drift is exactly what an
  unindexed ADR-0022 fails to prevent.
- **Ticket coverage:** **NO COVERAGE** found.
- **Priority + deps:** P2.
- **Proposed AC:** index row count equals ADR file count; a gate asserts it; filename convention
  normalised or the mixed convention documented at the top of the index.
- **Red-first:** `test $(ls docs/adr/[A0]*.md | wc -l) -eq $(grep -c '^| \[' docs/adr/README.md)` —
  red today (22 vs 12).

### D-10 — Root `README.md` is ~10 weeks and three audits stale and never mentions the localhost-first path

- **Claim:** README's Status section pins the repo to "Sprint 22b … closes the 2026-07-01 audit
  findings (F-01…F-21) before a _measured_ pilot" and its Deploy section documents a staging
  environment that was retired.
- **Status:** STALE
- **Evidence:** `README.md:12-23` (status + sprint table), `:253` ("Deploy to staging (automatic on
  merge to main)"); `backlog/QUEUE.md:3-40` (session 158, ESC-078, FOLLOW-1184/1168/1169 next);
  `docs/MASTER_DESIGN.md:5633` ("There is no staging environment … a write to `stg` is a write to
  production"); `docs/AUDIT-2026-08-04*`/`docs/AUDIT-2026-08-17.md` both postdate the audit README
  names; `README.md:229` "Check bundle size against budgets (full impl in TICKET-018)" — implemented
  (`packages/sdk/scripts/check-bundle-size.js`).
- **Impact on measured pilot:** blocks go-live indirectly — the repository's front door contradicts
  the standing CEO ruling it should be leading with, and tells a reader to deploy to a plane that is
  production.
- **Ticket coverage:** **FOLLOW-1133** fixed the FOLLOW-819 README §0, not the root README
  (`backlog/FOLLOW_UPS.md:44860`; DONE via #852, `backlog/QUEUE.md:1233`). FOLLOW-825 is the nearest
  stale-docs sweep. **NO COVERAGE for the root README specifically.**
- **Priority + deps:** P1.
- **Proposed AC:**
  - README Status states the localhost-first ruling, the FOLLOW-817/818/560 → 819 → 815 → 820 path,
    and links `backlog/QUEUE.md` as live state.
  - The staging line is removed; `scripts/check-no-staging-plane.sh`'s register covers `README.md`.
  - The "(full impl in TICKET-018)" and "(Master Design B.7)" parentheticals are corrected
    (platform-templates is §B.4.4/B.5.1, not B.7).
- **Red-first:** extend `scripts/check-no-staging-plane.sh`'s register to `README.md` — red today at
  `README.md:253`.

### D-11 — Embedding dimension is documented as both 1536 and 1024 inside one module

- **Claim:** `openai-client.ts` docblocks say 1536 dimensions; the seeder, the embed route and the
  seeder test say 1024 (Matryoshka-reduced); `rag-retrieval.ts` says the session intent vector
  is 1536.
- **Status:** CONTRADICTS-OTHER-DOC (code comments, same package)
- **Evidence:** `apps/control-plane/src/lib/openai-client.ts:5,32` ("1536 dimensions"), `:41`
  ("caller-specified"), `:57` (`model: 'text-embedding-3-small'`);
  `apps/control-plane/src/lib/archetype-seeder.ts:27,30`;
  `apps/control-plane/src/lib/__tests__/seed-archetypes.test.ts:142` ("equals 1024 … reduced dims");
  `apps/control-plane/src/app/api/listings/embed/route.ts:7` ("1024 dimensions (Matryoshka)");
  `apps/control-plane/src/lib/rag-retrieval.ts:36` ("1536 dims").
- **Impact on measured pilot:** degrades data if a future change trusts the wrong docblock — a
  dimension mismatch between the archetype space (1024) and the session intent vector (1536) is a
  silent cosine failure.
- **Ticket coverage:** **NO COVERAGE** found (grepped `1536`, `Matryoshka`, `dimension` in
  FOLLOW_UPS/QUEUE).
- **Priority + deps:** P2. The vector-space area should confirm which dimension each column actually
  uses before the doc fix.
- **Proposed AC:** one docblock in `openai-client.ts` states both dimensions and which caller uses
  which; the pgvector column widths are cited; a test asserts each seeded/queried vector's length
  against its column.
- **Red-first:** a test asserting `embedText()`'s default output length matches the
  `archetype_embeddings` column width — red or absent today.

### D-12 — `.env.example` omits the model-override and admin-DB names the code and runbooks use, and templates a dead-path secret

- **Claim:** `INTENT_REALTIME_MODEL`, `INTENT_BATCH_MODEL`, `DATABASE_URL_ADMIN`,
  `LITELLM_BASE_URL`, `DEMO_OVERRIDE_*` are absent from `.env.example`, while `LITELLM_MASTER_KEY`
  (only consumed by the 410-Gone Worker) is present.
- **Status:** PARTIAL (gaps + one dead entry)
- **Evidence:** `grep` over `.env.example` → 0 hits for each name listed;
  `apps/intent-engine/src/nlp.py:61-62`, `src/main.py:97`, `src/jobs/batch_enrich.py:50` read the
  two model overrides; `docs/MASTER_DESIGN.md:5633` treats `DATABASE_URL_ADMIN` as the live admin
  DSN; `.env.example:66` `LITELLM_MASTER_KEY`; `apps/decision-api/src/lib/llm-gateway.ts:5,98`.
- **Impact on measured pilot:** degrades data — the two variables that decide which Claude serves
  realtime vs batch intent are the ones a localhost operator is least likely to set correctly, and
  no template names them.
- **Ticket coverage:** **NO COVERAGE** found.
- **Priority + deps:** P2. Names-only change; no secret values.
- **Proposed AC:** `.env.example` names every `os.environ`/`process.env` key read by a non-test
  first-party file, or documents the exception; the `LITELLM_*` pair is removed or marked dead-path.
- **Red-first:** a script diffing `process.env.X`/`os.environ["X"]` reads in first-party non-test
  source against `.env.example` keys — red today with ≥5 gaps.

### D-13 — `packages/platform-templates` docblocks oversell an empty registry and renumber the detection layers against the SoT

- **Claim:** the package claims "pre-validated CSS selectors for 50+ known real estate platforms"
  and places AI Vision at L5; the registry is empty and the SoT places AI Vision at L4.
- **Status:** STALE / CONTRADICTS-OTHER-DOC
- **Evidence:** `packages/platform-templates/src/index.ts:4` ("50+"), `:9-15` (L1–L5 table with "L5
  AI Vision"), `:33` ("Real implementation lands in TICKET-032; this placeholder always returns
  null"); `packages/platform-templates/src/templates/index.ts:5` ("Empty in this placeholder");
  `docs/MASTER_DESIGN.md:465` region §Snapshot.1 B.5 ("**L4 AI Vision** wired end-to-end … L3
  (platform templates)") and B.4.4 ("⛔ Blocked").
- **Impact on measured pilot:** none (nothing routes through L3).
- **Ticket coverage:** **TICKET-032** (BLOCKED, cited in §Snapshot.1 B.4.4) owns the implementation.
  The docblock drift has **NO COVERAGE**.
- **Priority + deps:** P3.
- **Proposed AC:** the package docblock's first line states the registry is empty and
  TICKET-032-blocked; the layer table's numbering matches §B.5.1 or is deleted; `README.md:305`'s
  "(Master Design B.7)" pointer is corrected.
- **Red-first:** an assertion that `templates.length > 0` whenever the docblock claims a platform
  count — red today.

### D-14 — FOLLOW-1129's headline is now false while its substance stands; closing it on a grep would lose the finding

- **Claim:** `MASTER_DESIGN` now mentions FOLLOW-819/820 twice, so FOLLOW-1129's literal wording
  ("does not mention … at all") is refutable — but both hits are incidental sentences inside
  §E.7.0's cost paragraph, and the SoT still contains no statement of the localhost-first critical
  path or the FOLLOW-820 gate.
- **Status:** PARTIAL
- **Evidence:** `grep -c 'FOLLOW-819\|FOLLOW-820' docs/MASTER_DESIGN.md` = 2 →
  `docs/MASTER_DESIGN.md:5` (v4.11 changelog, Polish) and `:2682` (§E.7.0 body, English: "rate
  FOLLOW-819 / FOLLOW-820 report will FALL"); `grep -n 'localhost-first' docs/MASTER_DESIGN.md` →
  only `:13` and `:5633`, both §V.6 secrets/staging corrections; `backlog/FOLLOW_UPS.md:44613` (the
  stub). FOLLOW-1129 has **no mention in `backlog/QUEUE.md`** → never promoted.
- **Impact on measured pilot:** blocks go-live — same mechanism as D-1.
- **Ticket coverage:** **FOLLOW-1129** — stub exists (`backlog/FOLLOW_UPS.md:44613`), **not in
  QUEUE**, so un-promoted/OPEN.
- **Priority + deps:** P1, merge with D-1 into one ticket. Depends on the CEO deciding whether
  FOLLOW-820 belongs in the SoT at all (see Open questions).
- **Proposed AC:** FOLLOW-1129's stub is amended with the two-hit measurement so the next session
  cannot close it on the grep; the acceptance test becomes "a §Snapshot or §P section states the
  path and the gate", not "the string appears".
- **Red-first:** a check that `docs/MASTER_DESIGN.md` contains a heading or §Snapshot row whose body
  names both FOLLOW-819 and FOLLOW-820 outside a `Changelog v` paragraph — red today.

### D-15 — FOLLOW-820's own checklist still says condition 1 is "not gradeable"

- **Claim:** the CEO go/no-go stub asserts condition 1 "Not gradeable until FOLLOW-1124 lands";
  FOLLOW-1124 landed and its red-first was executed.
- **Status:** STALE
- **Evidence:** FOLLOW-820 stub, condition 1 (scratchpad copy `audit/follow-820.md`, sourced from
  `backlog/FOLLOW_UPS.md`): "**Not gradeable until FOLLOW-1124 lands** … today AC(5)'s adapted-arm
  conjunct counts conversions across the whole substrate over 7 days rather than the run under test
  (RETRO-310 §4a)"; `tests/e2e/follow-819/README.md:748` (§5.4 "AC(5) becomes falsifiable on the
  PERSISTENT substrate"), `:797` (§5.5 "red→green on the PERSISTENT substrate"), `:26` ("scoped to
  this `session_id`, not to the 7-day pool (FOLLOW-1124)").
- **Impact on measured pilot:** blocks go-live — the gate document disqualifies its own first
  condition.
- **Ticket coverage:** **FOLLOW-1148** (`backlog/FOLLOW_UPS.md:45904` — "FOLLOW-820 names neither
  AC(7) nor ESC-074, still says condition 1 is 'not gradeable' after the blocker landed"), OPEN,
  last in the session-158 order.
- **Priority + deps:** **P0** with D-1 — same ticket, same reader, same decision.
- **Proposed AC:** condition 1 names AC(1)–AC(5) + AC(7), cites the 6/6 run and the
  ESC-074/FOLLOW-1140 fixture caveat, and drops the FOLLOW-1124 blocker sentence.
- **Red-first:** grep FOLLOW-820's stub for "not gradeable" — 1 hit today, 0 when done.

---

## Area verdict

The code is in better shape than the documentation claims in some places and worse in others, and
both directions are dangerous on the FOLLOW-820 path. The single most consequential row is **D-1 /
D-15**: `MASTER_DESIGN` §Snapshot.5 still names the FOLLOW-819 differentiator E2E as an open
critical gap and FOLLOW-820's own checklist still says its first condition is ungradeable, while the
harness has been 6/6 green since 2026-08-26 — a CEO grading the gate from the SoT alone reaches
NO-GO on stale text. Second: two §Snapshot.1 ✅/🟢 rows (E.7, H) were left ungraded by the very
changes that invalidated them, and v4.11's propagation checklist recorded "§Snapshot.1 untouched" as
a no-op rather than a finding. Third: the two onboarding documents every session boots from still
name Redpanda Cloud as the event bus and LiteLLM as the LLM router, neither of which exists on the
live path, and `docs/adr/README.md` indexes neither of the ADRs that would have caught it. The
counters in §Snapshot.6 are 2–3× low and §Snapshot.2/.3/.7 describe three apps that were deleted —
structural, not cosmetic, because §Y exists precisely to stop a session rebuilding deleted code.
**Would one "doc sync" ticket absorb this?** Partly: D-3/D-4/D-6/D-9/D-10/D-13 are one mechanical
sweep (FOLLOW-825 is already scoped for most of it). D-1/D-14/D-15 must be their own P0 — they are
on the go/no-go path and need the CEO's reading, not a sweep. D-5, D-7 and D-11 each need a
measurement or a decision first and cannot be batched with prose edits.

## Open questions for the CEO

1. **Does FOLLOW-820 belong in `MASTER_DESIGN`?** The localhost-first ruling lives in `CLAUDE.md`
   and `backlog/QUEUE.md`, not in the SoT that Operating Principle 1 makes every session read first.
   Either the SoT gains a §Snapshot/§P statement of the gate (fixing D-1/D-14 properly), or §Y is
   amended to say that go/no-go state deliberately lives outside it. Picking neither is what
   produced this drift.
2. **Is `docs/AUDIT-2026-08-17.md` still quotable?** Its headline green table — including the "~40
   ms" latency win — is mock-harness derived, and v4.11 §E.7.0 now puts a model call on every
   request. Should that audit be marked superseded, or re-run against the real control plane before
   any external use?
3. **Redpanda: retire the documentation or reinstate the intent?** ADR-0022 retired the bus; two
   onboarding docs, a package (`stream-consumer`), a Terraform module and an agent charter still
   describe it as live. Deleting the docs is cheap; deleting `stream-consumer` and
   `infra/terraform/redpanda` is a decision.
