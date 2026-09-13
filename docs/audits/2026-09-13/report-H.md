# Audit report H — AREA 11 (local bring-up, `L-n`) + AREA 12 (tests & CI, `T-n`)

Repo `/home/asipi/Projects/Adaptive-Listings`, branch `main` @ `f510f749`. READ-ONLY: no file in the
repo was modified, no container started, no `pnpm install`, no `doppler`, no network calls. Every
claim below cites `path:line` at HEAD. Version facts were read from config, never from prose.

---

# AREA 11 — Local bring-up

## Baseline: what the config actually pins

| Thing          | Pinned where                                                                     | Value                                              |
| -------------- | -------------------------------------------------------------------------------- | -------------------------------------------------- |
| Node (engines) | `package.json:7`                                                                 | `>=22.0.0`                                         |
| Node (exact)   | `.nvmrc:1`, `.node-version:1`, `.tool-versions:1`                                | `22.15.0`                                          |
| pnpm           | `package.json:5` (`packageManager`), `package.json:8` (`engines.pnpm >=9.0.0`)   | `pnpm@9.15.4`                                      |
| Python         | `.tool-versions:2`; `apps/*/pyproject.toml` `requires-python`                    | `3.12.3` / `>=3.12`                                |
| Turbo          | `node_modules/turbo/package.json` → `2.9.6`; manifest `package.json:47` `^2.3.0` | 2.9.6 (strict `envMode` default)                   |
| Doppler        | `doppler.yaml:2-3`                                                               | project `estalara-adaptive-listings`, config `dev` |

Environment observed while auditing (host, not repo): `node v22.22.2`, `pnpm 9.15.4`,
`Python 3.12.3`. Nothing in the repo enforces the exact Node pin (no `engine-strict`, no preflight,
no CI assertion on `.nvmrc`); CI hardcodes `node-version: "22"` (e.g. `.github/workflows/ci.yml:88`)
rather than reading `.nvmrc`, so the pin and CI can drift without either noticing.

---

## L-1 — Turbo 2.9.6 strict `envMode` strips every environment variable from every turbo task, so the repo's own documented dev command cannot work

- **Claim.** `turbo.json` declares no `env`, `globalEnv` or `passThroughEnv`; Turbo 2.x defaults
  `envMode` to `strict`, so `turbo run dev|test|build|lint|typecheck` receives only the built-in
  system set. Root `pnpm dev`, `pnpm dev:secrets` and `README.md:75` (`doppler run -- pnpm dev`) all
  route through turbo and therefore start the control plane without `DEMO_MODE_JWT_SECRET`,
  `DATABASE_URL_ADMIN`, `ADAPT_API_KEY`, `CLICKHOUSE_*` — `/api/adapt` answers 500
  `demo_auth_misconfigured` for every request.
- **Status.** CONFIRMED.
- **Evidence.** `turbo.json:1-33` — the whole file is `$schema`, `ui` and seven `tasks` entries; the
  three env keys appear nowhere. `package.json:12` `"dev": "turbo run dev"`; `package.json:13`
  `"dev:secrets": "doppler run -- pnpm dev"`. Installed binary 2.9.6.
  `tests/e2e/follow-819/README.md:1221-1246` is the measured write-up (§6.5) and gives the one-call
  discriminator (`demo_auth_misconfigured` vs `invalid_demo_token`).
- **Impact on measured pilot.** invalidates measurement — this is the documented cause of a `0/5`
  FOLLOW-819 run that read as a dead differentiator.
- **Ticket coverage.** `FOLLOW-1132` (P1, `backlog/FOLLOW_UPS.md:44803`, `promoted_to_queue: false`)
  — OPEN, named in the session-145 banner as "the one that reaches outside the harness"
  (`backlog/QUEUE.md:1403`). `FOLLOW-1001` (DONE, PR #760) fixed one downstream symptom (`/admin`
  pages prerendering the unconfigured branch) but not the declaration.
- **Priority.** P0 for the localhost path (it is the substrate FOLLOW-819/820 stand on); no deps.
- **Proposed AC.** (1) `turbo.json` declares the env each task reads, or sets `envMode` explicitly
  with written reasoning; (2) the six CI turbo invocations are enumerated against what strict mode
  passes, measured not reasoned; (3) `pnpm dev` + `doppler run -- pnpm dev` are re-executed and the
  `/api/adapt` probe returns `invalid_demo_token`; (4) the finding is re-homed out of one test's
  README into `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md`.
- **Red-first proof.**
  `curl -s -X POST -H 'content-type: application/json' -d '{}' http://localhost:3000/api/adapt`
  started via `doppler run -- pnpm dev` returns `{"error":"demo_auth_misconfigured"}` today and
  `{"error":"invalid_demo_token"}` when done.

## L-2 — Doppler project name in `README.md` is wrong; `doppler.yaml` still advertises a `staging` config that ESC-052 abolished, and the staging-plane gate's corpus cannot see it

- **Claim.** `README.md:113` tells a new operator
  `doppler setup   # select project: estalara / config: dev`; the project is
  `estalara-adaptive-listings`. `doppler.yaml:5-8` documents three configs including
  `staging — single-region staging (eu-frankfurt)`, while `stg` is byte-identical to `prd` (ESC-052,
  CEO option 2) — a write to "staging" is a write to production. The gate that exists to stop
  exactly this belief cannot read `doppler.yaml`: its corpus is `.github/workflows`,
  `apps/*/wrangler.toml`, `infra/`, `scripts/`, `*/src`.
- **Status.** STALE (both halves).
- **Evidence.** `README.md:113`; `doppler.yaml:2-3` vs `doppler.yaml:5-8`;
  `scripts/doppler-bootstrap.sh:9-10` has the correct project; corpus at
  `scripts/check-no-staging-plane.sh:87-91` (no root-level file is globbed) and pattern list at
  `:63-72` (no pattern matches `doppler.yaml`'s prose).
- **Impact.** legal-security exposure — the one surviving document that reads like operator config
  still promises isolation that does not exist, and `db-migrate.yml:100` is a live `--config stg`
  path into production.
- **Ticket coverage.** `FOLLOW-873` owns `db-migrate.yml`'s `--config stg`
  (`scripts/baselines/staging-plane.register:11,33`). `doppler.yaml` and `README.md:113`: NO
  COVERAGE.
- **Priority.** P1; depends on nothing.
- **Proposed AC.** (1) `README.md:113` names `estalara-adaptive-listings`; (2) `doppler.yaml`'s
  comment says `stg ≡ prd` and points at ESC-052; (3) `check-no-staging-plane.sh`'s corpus gains
  root-level `*.yaml`/`*.yml`/`*.md`-adjacent config files (or the register records the exemption
  explicitly per Rule AS).
- **Red-first proof.** `bash scripts/check-no-staging-plane.sh` exits 0 today with the
  `doppler.yaml` claim in the tree; after the corpus widens it exits 1 until the comment is fixed.

## L-3 — Env-name inventory: 62 names are read by code and documented in no `.env.example`; 34 documented names are read by nothing

- **Claim.** A full sweep of `process.env.X`, `process.env['X']`, `os.environ[...]`,
  `os.environ.get`, `os.getenv` across `apps/ packages/ scripts/ tests/ infra/`, plus a separate
  sweep of Worker `env.X` bindings, does not reconcile with the four `.env.example` files.
- **Status.** CONFIRMED.
- **Evidence.** Four example files: `.env.example`, `apps/ingest/.env.example`,
  `apps/decision-api/.env.example`, `apps/control-plane/.env.example`. Names only, never values.

**Read by code, in no `.env.example` (62).** Runtime/operational (the ones that matter):
`SUPABASE_DB_URL` (6 files, e.g. `apps/control-plane/src/app/api/admin/generation-model/route.ts`),
`SUPABASE_ACCESS_TOKEN` (`apps/control-plane/src/lib/archetype-seeder.ts:80`), `ADAPT_TENANT_ID` (3
files, e.g. `apps/control-plane/src/app/api/crm/outcome/route.ts`),
`PLATFORM_REGISTRATION_TOS_VERSION_PREVIOUS`
(`apps/control-plane/src/app/api/v1/consent/platform-registration/route.ts`),
`NEXT_PUBLIC_PILOT_TENANT_ID`, `INTENT_REALTIME_MODEL` (4 files, e.g.
`apps/intent-engine/src/local_dev.py`), `INTENT_BATCH_MODEL`, `LLM_DAILY_SPEND_CAP_USD`
(`apps/llm-gateway/src/jobs/generate_description.py`), `CLICKHOUSE_SECURE`, `CONSUMER_GROUP_ID`,
`REDPANDA_DLQ_TOPIC`, `REDPANDA_TOPIC`, `REDPANDA_USERNAME`, `REDPANDA_PASSWORD`,
`REDPANDA_SASL_MECHANISM`, `REDPANDA_DESCRIPTIONS_TOPIC`, `REDPANDA_DESCRIPTIONS_GROUP`,
`REDPANDA_EMBED_GROUP`, `BATCH_SIZE`, `LOG_LEVEL`, `FORCE_RESEED`. Worker bindings read but absent
from the app's own example file: `CLICKHOUSE_URL`, `CLICKHOUSE_DATABASE`, `CLICKHOUSE_USER`,
`CLICKHOUSE_PASSWORD`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `FIRST_PARTY_TENANT_ID`,
`RATE_LIMIT_PER_MIN`, `ENVIRONMENT`, `GIT_SHA`, `CF_VERSION_METADATA`
(`apps/ingest/src/handlers/intent-snapshot.ts:69,288`, `apps/ingest/src/origin-gate.ts`,
`apps/ingest/src/rate-limiter.ts`, `apps/ingest/src/router.ts`) and `SCHEMA_API_URL`,
`SCHEMA_API_TOKEN`, `UPSTASH_REDIS_URL`, `UPSTASH_REDIS_TOKEN`
(`apps/decision-api/src/lib/reorder.ts`) — `apps/decision-api/.env.example` lists only
`ADAPT_API_KEY` and `LLM_DAILY_CAP_USD`. Harness/test-only (lower value, listed for completeness):
`API_KEY`, `INGEST_URL`, `INGEST_ORIGIN`, `DECISION_ORIGIN`, `LISTING_URL`, `LISTING_BASE_URL`,
`SESSION_JSON`, `PASSES`, `HEADLESS`, `PREWARM`, `PORT`, `PROMPT_FILE`, `SDK_BUNDLE`, `DEMO_SLUG`,
`ARCHETYPE`, `BACKEND_URL`, `DESCRIPTION_MODEL`, `PUBLIC_CONFIG_API_KEY`, `PUBLIC_CONFIG_UPSTREAM`,
`FEEDBACK_URL`, `FOLLOW1131_CONTROL_HOLDOUT_PCT`, `NX_RUN_SUFFIX`, `E2E_BASE_URL`,
`E2E_BEARER_TOKEN`, `E2E_TENANT_ID`, `NEXT_PUBLIC_TEST_E2E`, `ESTALARA_SMOKE_API_KEY`,
`ESTALARA_SMOKE_DECISION_API_URL`, `ESTALARA_SMOKE_LISTING_ID`, `ESTALARA_SMOKE_TENANT_ID`,
`REQUIRE_CLICKHOUSE`, `REQUIRE_INGEST_SMOKE`, `REQUIRE_LIVE_ADAPT_SMOKE`,
`REQUIRE_LIVE_INTENT_SMOKE`, `REQUIRE_REDIS_SMOKE`, `K2_GUARD_NO_ALLOWLIST`, `FAKE_MODAL_MODE`,
`FAKE_MODAL_WEB_URL`, `CI`, `GITHUB_STEP_SUMMARY`, `RUNNER_TEMP`.

**In `.env.example`, read by no code (34).** `API_KEY_HMAC_SECRET` (appears only in
`apps/control-plane/src/app/api/adapt/feedback/route.follow943.test.ts:120` as a `vi.stubEnv`, and
in docs/backlog — no production reader anywhere), `LITELLM_MASTER_KEY` (only `.env.example:66`;
`apps/decision-api/src/lib/llm-gateway.ts:5` names a different var, `LITELLM_BASE_URL`),
`JWT_SECRET` (`apps/control-plane/.env.example:48`; zero word-boundary hits in any `.ts`/`.py` — the
code uses `DEMO_MODE_JWT_SECRET`/`SUPABASE_JWT_SECRET`), `SUPABASE_ANON_KEY` (code reads
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, e.g. `apps/control-plane/src/lib/session-auth.ts:84`),
`REDPANDA_REST_URL`, `REDPANDA_REST_USERNAME`, `REDPANDA_REST_PASSWORD`, `REDPANDA_TOPIC_EVENTS`,
`REDPANDA_TOPIC_DESCRIPTIONS`, `ESTALARA_INGEST_URL`, `ESTALARA_DECISION_API_URL`,
`ESTALARA_SDK_CDN_URL`, `NEXT_PUBLIC_CONTROL_PLANE_URL`, `NEXT_PUBLIC_SDK_CDN_URL`,
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS`,
`GRAFANA_CLOUD_INSTANCE_ID`, `GRAFANA_CLOUD_API_KEY`, `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`, `DOPPLER_TOKEN`, `TURBO_TOKEN`, `TURBO_TEAM`,
`KV_API_KEYS_ID`, `KV_API_KEYS_PREVIEW_ID`, `KV_IDEMPOTENCY_ID`, `KV_IDEMPOTENCY_PREVIEW_ID`,
`LLM_DAILY_CAP_USD`, `MODAL_CHAT_NLP_URL`, `SENTRY_DSN_INGEST`, `OTEL_EXPORTER_URL`,
`OTEL_EXPORTER_HEADERS`. Five of those last six are legitimate: they are `wrangler.toml` `[vars]` /
`wrangler secret put` names read as `env.X`, not `process.env`
(`apps/ingest/wrangler.toml:27-32,101,177-193`; `apps/decision-api/wrangler.toml:13`).
`CLOUDFLARE_*`/`TURBO_*`/`DOPPLER_TOKEN` are CI/CLI inputs. `KV_*_ID` are hardcoded ids in
`apps/ingest/wrangler.toml:39-49` and are not env at all. The genuinely dead names are
**`API_KEY_HMAC_SECRET`, `LITELLM_MASTER_KEY`, `JWT_SECRET`, `SUPABASE_ANON_KEY`, `REDPANDA_REST_*`,
`REDPANDA_TOPIC_EVENTS`, `REDPANDA_TOPIC_DESCRIPTIONS`**.

- **Impact.** degrades data — a missing `SUPABASE_DB_URL`/`ADAPT_TENANT_ID` does not crash anything;
  routes fall through to a degraded branch. `API_KEY_HMAC_SECRET` being documented as a required
  control-plane secret (`docs/ops/DOPPLER_SECRETS_MATRIX.md:69,136`) while nothing reads it is a
  security-posture claim with no implementation.
- **Ticket coverage.** NO COVERAGE for the `.env.example` reconciliation (no hit for `.env.example`
  in the ticket index).
- **Priority.** P2 for the reconciliation; P1 for `API_KEY_HMAC_SECRET` (a documented secret with no
  reader means tenant API-key hashing is not doing what the matrix says).
- **Proposed AC.** (1) a generator or gate derives the union of read names and fails when an
  `.env.example` omits one or documents one nothing reads (names only, never values); (2) the six
  dead names above are deleted or given a reader; (3) `apps/decision-api/.env.example` gains
  `SCHEMA_API_URL`, `SCHEMA_API_TOKEN`, `UPSTASH_REDIS_URL`, `UPSTASH_REDIS_TOKEN`; (4)
  `apps/ingest/.env.example` gains the CLICKHOUSE/SUPABASE/FIRST_PARTY/RATE_LIMIT names.
- **Red-first proof.** The new gate exits non-zero at HEAD with a printed diff of 62 + 34 names, and
  exits 0 after reconciliation.

## L-4 — `apps/ingest/.env.example` still documents the Redpanda hop that ADR-0022 stage C removed

- **Claim.** `apps/ingest/.env.example:16-17` sets `REDPANDA_REST_URL=http://localhost:8082` and
  `REDPANDA_TOPIC_EVENTS=estalara.events` and tells the operator they are "set as wrangler env
  binding in wrangler.toml"; `grep -c REDPANDA apps/ingest/wrangler.toml` is **0**, and
  `pushToRedpanda` no longer exists (`apps/ingest/src/handlers/events.ts:562` is its tombstone).
- **Status.** STALE.
- **Evidence.** `apps/ingest/.env.example:13-17`; `apps/ingest/wrangler.toml` (zero REDPANDA hits);
  `apps/ingest/src/handlers/events.ts:562`; `.github/workflows/e2e-smoke.yml:73-84` narrates the
  removal.
- **Impact.** none on measurement; costs an operator a wrong belief about where events go.
- **Ticket coverage.** NO COVERAGE.
- **Priority.** P3; folds into L-3's AC.
- **Proposed AC.** the two lines are deleted and the section header removed.
- **Red-first proof.** `grep -c REDPANDA apps/ingest/.env.example` is 4 today, 0 when done.

## L-5 — There is no `.dev.vars.example`, yet two runbooks require the operator to author `.dev.vars` by hand

- **Claim.** `apps/ingest/wrangler.toml:96-98` says the local `INTERNAL_API_SECRET` "belongs in
  `apps/ingest/.dev.vars`, which is gitignored"; `.gitignore:106-107` ignores `.dev.vars` and
  `.dev.vars.*`; there is no `.dev.vars.example` anywhere in the tree. A fresh clone therefore has
  no template for the local-only Worker secrets (`CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`,
  `INTERNAL_API_SECRET`), and the only record of them is prose in two runbooks.
- **Status.** PARTIAL (documented, not templated).
- **Evidence.** `apps/ingest/wrangler.toml:96-98`; `.gitignore:106-107`;
  `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md:196-200` and `:270-274`;
  `tests/e2e/follow-819/README.md:308-310`. A `.dev.vars` exists on this machine (untracked) — i.e.
  the file is real and undocumented-by-template.
- **Impact.** none on measurement; a reproducibility tax on every fresh bring-up.
- **Ticket coverage.** NO COVERAGE.
- **Priority.** P3.
- **Proposed AC.** `apps/ingest/.dev.vars.example` exists (names + empty values), is un-ignored via
  a `!.dev.vars.example` negation, and the runbooks point at it.
- **Red-first proof.** `test -f apps/ingest/.dev.vars.example` fails today.

## L-6 — Both documented `wrangler dev` paths are individually broken; only an undocumented third form works

- **Claim.** `apps/ingest/package.json` `"dev": "wrangler dev"` selects the **top-level** config,
  whose `[vars]` (`apps/ingest/wrangler.toml:19-32`) does **not** set `MODAL_CHAT_NLP_URL` — so the
  chat hop is inert. `--env dev` (`apps/ingest/wrangler.toml:99-101`) does set it, but named
  wrangler environments inherit no bindings, so `[env.dev]` has no KV/DO/queue and every
  `POST /v1/events` 401s with `reason: kv_error`. The form that actually works is a bare
  `wrangler dev` plus explicit `--var MODAL_CHAT_NLP_URL:…`.
- **Status.** CONFIRMED (config contradicts the package script and the `[env.dev]` block).
- **Evidence.** `apps/ingest/wrangler.toml:19-32` (no `MODAL_CHAT_NLP_URL`), `:99-101` (`[env.dev]`
  vars with it), `:124-127` (the repo's own note that named envs inherit nothing, for
  `version_metadata`); `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md:268-276` records the FOLLOW-874
  measurement; `apps/ingest/package.json` `"dev": "wrangler dev"`.
- **Impact.** degrades data — a bring-up via the package script silently drops the chat→archetype
  signal, which is the only discriminator for 8 of 17 archetypes
  (`docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md:229-231`).
- **Ticket coverage.** FOLLOW-874 is cited as the measurement of the `[env.dev]` half; the
  **`package.json` `dev` script** is unaddressed — NO COVERAGE.
- **Priority.** P2; blocks nothing but quietly degrades every FOLLOW-817 exercise.
- **Proposed AC.** (1) `apps/ingest/package.json` `dev` carries the working `--var` form (or
  `[env.dev]` repeats the KV/DO/queue bindings and the script uses `--env dev`); (2) a comment at
  the script names which of the two was chosen and why; (3) the runbooks point at the script rather
  than re-transcribing flags.
- **Red-first proof.** `pnpm --filter @estalara/ingest dev` then a `chat.message.sent` POST leaves
  `shadow:…:chat_intent` NULL today and populated when done.

## L-7 — Postgres migrations bootstrap cleanly on an empty local container; ClickHouse DDL has no journal, no pnpm script, and no way to answer "is this at head?"

- **Claim.** PG: `pnpm db:bootstrap:local` → `pnpm db:migrate` is a real, guarded, loopback-only
  chain that reports `applied`/`pending` honestly. CH: `infra/clickhouse/scripts/ migrate.sh` must
  be invoked by hand with `LOCAL=1`, it is wrapped by **no** root package script, and it explicitly
  "does NOT track applied migrations in a table" — so migration-head state is unqueryable and a
  preflight can only check object/column existence.
- **Status.** CONFIRMED (this is exactly the PG-auto-applies / CH-does-not asymmetry in memory).
- **Evidence.** `packages/db/scripts/bootstrap-local.ts:1-36` (the two preconditions), `:52`
  (`ALLOWED_HOSTS`), `:60-76` (`assertLocalUrl` refuses non-loopback), `:97-121` (applies journal
  entry 0 outside the migrator's transaction and mirrors drizzle's hash bookkeeping);
  `packages/db/scripts/migrate.ts:23-33` (applied/pending accounting, exit 2 on
  `pending>0 && applied===0`); `package.json:22-23` wire both. CH:
  `infra/clickhouse/scripts/migrate.sh:18-20` ("does NOT track applied migrations in a table yet"),
  `:69-72` (`LOCAL=1` rewrites `ReplicatedMergeTree`→`MergeTree`), `:88-93` (lexicographic apply of
  all 23 files in `infra/clickhouse/migrations/`). No `package.json` script references it; CI
  invokes it directly (`.github/workflows/ci.yml:377-383`, `:470-473`).
- **Impact.** degrades data — the FOLLOW-819 substrate depends on migration `0022` having applied
  (`adaptation_decisions.scoring_path`), and the only proof is a hand-run `DESCRIBE TABLE`
  (`docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md:186-191`).
- **Ticket coverage.** `FOLLOW-822` (P2, prod `DESCRIBE TABLE` vs the journal in CI) is the _drift
  detection_ ticket, still OPEN and repeatedly mis-cited in the queue
  (`backlog/QUEUE.md:2016,2084-2089`). A **local** head-check: NO COVERAGE.
- **Priority.** P2; feeds the preflight in §Preflight below.
- **Proposed AC.** (1) `pnpm db:migrate:clickhouse:local` wraps the script with `LOCAL=1`; (2) a
  `ch-head-check` asserts the set of tables and the specific columns the adapt/analytics paths name
  (at minimum `adaptation_decisions.scoring_path`, `.holdout_pct`, `.variant`,
  `.adapt_decision_id`), derived from the migration files rather than hardcoded; (3) the check is
  what the preflight calls.
- **Red-first proof.** Against a ClickHouse with migrations `0001..0021` applied, the check exits
  non-zero naming `scoring_path`; after `0022` it exits 0.

## L-8 — `pnpm seed:archetypes` writes to hosted Supabase over PostgREST, so the local Postgres can never get archetype embeddings — `scoring_path = 'cosine'` is unreachable on the localhost substrate

- **Claim.** Migration `0005` inserts the 18 archetype rows with `embedding = NULL`. The only seeder
  is `apps/control-plane/src/lib/archetype-seeder.ts`, which talks to
  `https://<hardcoded PROJECT_REF>.supabase.co/rest/v1/archetype_embeddings` — never to
  `DATABASE_URL_ADMIN`. Nothing in `packages/db/scripts/*.sql` or `seed-local-tenant.mts` touches
  `archetype_embeddings` or `listing_embeddings`. With a NULL archetype vector, `affinityScore()`
  returns `usedCosine: false` for every listing, so `buildReorderDirective` can only ever aggregate
  to `'djb2_fallback'` (or `'djb2_guard'`/`'not_applicable'`). `README.md:104-140` presents this as
  the "Local development setup" step that unbreaks the cosine path — it does the opposite: it
  mutates the shared hosted dev database and leaves localhost degraded.
- **Status.** CONFIRMED.
- **Evidence.** `packages/db/migrations/0005_seed_archetype_embeddings.sql:1-3` ("embedding is
  NULL"); `apps/control-plane/src/lib/archetype-seeder.ts:24-25` (hardcoded `PROJECT_REF`), `:78-84`
  (`SUPABASE_SERVICE_ROLE_KEY` / `SUPABASE_ACCESS_TOKEN`), `:108,121,142,173` (all `/rest/v1/`
  HTTP); `apps/control-plane/src/app/api/adapt/route.ts:949` (`ScoringPath` union), `:996-1000` (the
  aggregation), `:2020-2052` (`embeddingsAttempted`); `README.md:104-140`.
- **Impact.** invalidates measurement — FOLLOW-819 AC(3) grades `scoring_path`, and on this
  substrate the discriminating value is structurally unreachable. Every localhost adapt decision
  ranks listings by a djb2 hash, i.e. the cosine differentiator §F.3 claims has never executed
  outside production.
- **Ticket coverage.** NO COVERAGE (no `seed:archetypes` / `bootstrap-local` hit in the ticket
  index). `README.md`'s own §2 prose acknowledges the degradation mechanism but not that the seeder
  cannot reach localhost.
- **Priority.** **P1** — it is a condition-1 grading input for FOLLOW-820. Depends on nothing.
- **Proposed AC.** (1) the seeder accepts a direct-Postgres target (`DATABASE_URL_ADMIN`) in
  addition to PostgREST, and refuses a hosted URL when a loopback one is supplied; (2)
  `pnpm seed:archetypes` against `:5433` leaves 0 NULL embeddings in the local
  `archetype_embeddings`; (3) `README.md`'s "Local development setup" says which database each step
  writes to; (4) the FOLLOW-819 README records the first localhost run whose
  `adaptation_decisions.scoring_path` reads `cosine`.
- **Red-first proof.** `SELECT count(*) FROM archetype_embeddings WHERE embedding IS NULL` against
  the local `:5433` is 18 today and 0 when done; the harness's AC(3) evidence changes from
  `djb2_fallback` to `cosine`.

## L-9 — The nightly `e2e-smoke` harness runs an unpinned ClickHouse and a hand-maintained fixture DDL, both of which CI deliberately avoids

- **Claim.** `tests/e2e/docker-compose.yml:3` is `clickhouse/clickhouse-server:latest` — the exact
  tag `ci.yml` pinned away from because `latest` moving to 26.7 broke migration `0002` on every PR.
  Its schema comes from `tests/e2e/fixtures/clickhouse-init.sql` (3 objects, hand-written), not from
  the 23-file migration chain, and no gate compares the two.
- **Status.** CONFIRMED.
- **Evidence.** `tests/e2e/docker-compose.yml:3`; `.github/workflows/ci.yml:333-340` (the pin and
  its reason, FOLLOW-620/621); `tests/e2e/fixtures/clickhouse-init.sql:1-49` vs
  `infra/clickhouse/migrations/0001_create_events.sql` (47 lines) and 22 sibling files.
- **Impact.** degrades data — the nightly smoke can go red for an upstream image bump, or green
  against a schema production does not have. `.github/workflows/e2e-smoke.yml:151-156` records "103
  consecutive failures" with no notification channel.
- **Ticket coverage.** `FOLLOW-620`/`FOLLOW-621` cover the CI pin and 26.x compatibility; the
  **e2e-smoke compose file** and the fixture-vs-migration divergence: NO COVERAGE.
- **Priority.** P2.
- **Proposed AC.** (1) `tests/e2e/docker-compose.yml` pins the same tag `ci.yml` pins, sourced from
  one place; (2) either the fixture DDL is replaced by a `LOCAL=1 migrate.sh` step, or a gate
  asserts the fixture's object/column set is a subset of the migration chain's; (3) the divergence,
  if kept, is stated in the fixture header with the reason.
- **Red-first proof.** A gate diffing `clickhouse-init.sql` against `SHOW CREATE TABLE` after
  `migrate.sh` fails at HEAD and passes once reconciled.

## L-10 — The local event pipeline (`Redpanda → stream-consumer → ClickHouse`) is dead code: no compose service, an undeclared dependency, and an orphaned Dockerfile

- **Claim.** The ingest Worker writes straight to ClickHouse over HTTPS (ADR-0022 stage C), so
  nothing produces to Redpanda locally; `tests/e2e/docker-compose.yml` has exactly one service
  (`clickhouse`) — `redpanda` and `stream-consumer` were removed.
  `apps/stream-consumer/src/ consumer_local.py:16` imports `from kafka import KafkaConsumer`
  (kafka-python), which is **not** in `apps/stream-consumer/pyproject.toml`'s dependencies
  (`confluent-kafka` is); it exists only in `requirements-e2e.txt`, referenced only by
  `apps/stream-consumer/Dockerfile:7-8`, which no compose file or workflow builds.
- **Status.** CONFIRMED (dead, not broken — but it reads as a supported local path).
- **Evidence.** `apps/stream-consumer/src/consumer_local.py:16`;
  `apps/stream-consumer/pyproject.toml:11-19`; `apps/stream-consumer/requirements-e2e.txt:1`;
  `apps/stream-consumer/Dockerfile:7-8`; `tests/e2e/docker-compose.yml` (one service);
  `.github/workflows/e2e-smoke.yml:73-84` narrates the removal;
  `apps/ingest/src/handlers/events.ts:562`.
- **Impact.** none on measurement; it costs an operator a wrong mental model of the pipeline and
  keeps three files alive that a reader will try to use.
- **Ticket coverage.** NO COVERAGE (no `consumer_local` / `requirements-e2e` / `kafka-python` hit).
- **Priority.** P3. Per CLAUDE.md §3 I am flagging, not proposing deletion beyond the ticket.
- **Proposed AC.** (1) `consumer_local.py`, `Dockerfile`, `requirements-e2e.txt` are either deleted
  (with the ADR-0022 reference) or `kafka-python` moves into a declared
  `[project.optional- dependencies] e2e` extra and a compose service exercises them; (2) if deleted,
  the runbooks lose the Redpanda hop from their pipeline diagrams.
- **Red-first proof.** `pip install -e ".[dev]" && python src/consumer_local.py` fails with
  `ModuleNotFoundError: kafka` today.

## L-11 — Only `intent-engine` has a non-Modal local entrypoint; `README.md`'s "run locally without Modal" instruction cannot work for any of the four Python apps

- **Claim.** `README.md:161-165` instructs `cd apps/intent-engine && … && python src/main.py`. None
  of the four `src/main.py` files has an `if __name__ == "__main__"` block; `intent-engine` and
  `stream-consumer` construct a `modal.App` at import time, `llm-gateway` registers functions
  against a shared `modal.App` in `jobs/_app.py`, `data-quality` has no `modal.App` at all. The only
  working local server is `apps/intent-engine/src/local_dev.py` under `uvicorn` — which `README.md`
  never mentions. `llm-gateway` and `data-quality` have **no** local run path; `stream-consumer`'s
  is the dead `consumer_local.py` of L-10.
- **Status.** STALE (README) + ASPIRATIONAL (two apps have no local path at all).
- **Evidence.** `apps/intent-engine/src/main.py:35,42`; `apps/stream-consumer/src/main.py:20,25`;
  `apps/llm-gateway/src/main.py:7,24,34`; `apps/data-quality/src/main.py` (no modal.App); zero
  `__main__` blocks; `apps/intent-engine/src/local_dev.py:1-19,19` (the uvicorn command);
  `README.md:161-165`.
- **Impact.** blocks go-live indirectly — FOLLOW-820 condition 3 turns on the intent-engine hop
  being exercisable, and the description-generation path (`llm-gateway`) has never run outside Modal
  on this substrate.
- **Ticket coverage.** `FOLLOW-729` delivered `local_dev.py` for intent-engine (DONE, referenced at
  `apps/intent-engine/pyproject.toml:27-29`). The README staleness and the two apps with no local
  path: NO COVERAGE.
- **Priority.** P2.
- **Proposed AC.** (1) `README.md`'s Python block is replaced with the real per-app commands, or
  says "Modal-only" where true; (2) `apps/llm-gateway` gets a `local_dev.py` on the same pattern, or
  its README states the Modal-only constraint and what that costs the localhost stage.
- **Red-first proof.** `cd apps/intent-engine && python src/main.py` exits without binding a port
  today; the documented command binds one when done.

## L-12 — The FOLLOW-819 harness ships two defaults its own README proved wrong, and its "real control plane" probe accepts the 500 that L-1 produces

- **Claim.** `differentiator-e2e.mjs:55` still defaults `LISTING_URL` to
  `http://localhost:9200/fixture-listing.html` — the port README §6.2 measured as CORS-refused
  (`CORS_DEV_EXTRA_ORIGINS` is a hardcoded `['http://localhost:5173','http://localhost:3000']`), so
  the documented invocation must override it or the run is a silent false RED. Separately,
  `assertRealControlPlane()` rejects only a 404 (`:216-221`) — a 500 `demo_auth_misconfigured`
  passes the probe, which is precisely the L-1 failure the README's §6.5 curl distinguishes by hand.
- **Status.** PARTIAL — `FOLLOW-1074` corrected the prose; the code defaults and the probe were
  outside its AC.
- **Evidence.** `tests/e2e/follow-819/differentiator-e2e.mjs:55`, `:180-223`;
  `apps/control-plane/src/lib/origin-policy.ts:42-45`; `tests/e2e/follow-819/README.md:1189-1204`
  (§6.2), `:1221-1246` (§6.5), `:325-343` (§3.6 must pass `LISTING_URL` explicitly);
  `backlog/FOLLOW_UPS.md:41434-41470` (FOLLOW-1074's AC — prose only, merged as PR #835 per
  `backlog/QUEUE.md:1749`).
- **Impact.** invalidates measurement — both defects produce a 0/N run that reads as a dead
  differentiator, on the one instrument FOLLOW-820 condition 1 depends on.
- **Ticket coverage.** `FOLLOW-1074` DONE (docs half). Code half: NO COVERAGE. L-1's ticket
  `FOLLOW-1132` does not cover the probe.
- **Priority.** P1; depends on nothing.
- **Proposed AC.** (1) the `LISTING_URL` default is `http://localhost:5173/fixture-listing.html`, or
  the harness hard-fails when the resolved listing origin is outside `CORS_DEV_EXTRA_ORIGINS` (read
  from `origin-policy.ts`, not re-typed); (2) `assertRealControlPlane()` rejects a body containing
  `demo_auth_misconfigured` with the FOLLOW-1132 pointer; (3) the probe timeout exceeds a cold Next
  compile or retries once (README §6.6 measured 8655 ms against an 8000 ms abort).
- **Red-first proof.** Start the control plane through `turbo run dev` (env stripped): the harness
  today prints `probedStatus: 500` and proceeds to a 0/N run; when done it exits 1 naming
  `demo_auth_misconfigured`.

---

## Preflight design — `scripts/preflight-local.mjs` (does not exist at HEAD)

`ls scripts | grep -i preflight` returns nothing. `backlog/QUEUE.md:1-30` (session-158 banner) ends
with _"The local substrate is DOWN (every container exited) and must be brought up before any
localhost measurement"_ — which is the whole argument for this command. **NO COVERAGE** in
`FOLLOW_UPS.md`/`QUEUE.md`/`ESCALATIONS.md` (no `preflight script`, `one command`, `bring-up script`
hit that refers to this).

Recommend **`.mjs`**, not `.sh`: it must parse `turbo.json`, `meta/_journal.json`,
`origin-policy.ts`'s exported constant and JSON from ClickHouse/Postgres/HTTP, and it must run on
the same Node the repo pins. Design: **read-only, never starts a process, never prints a value.**

### Ordered checks

| #   | Check                                 | How                                                                                                                                                                                                                                                                                                                                                              | Needs secrets?                    |
| --- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1   | Tool versions                         | `node -v` vs `.nvmrc`; `pnpm -v` vs `packageManager`; `python3 -V` vs `.tool-versions`; `docker version` present; `wrangler` resolvable                                                                                                                                                                                                                          | no                                |
| 2   | Turbo env mode                        | parse `turbo.json` — fail if `env`/`globalEnv`/`passThroughEnv` are all absent while turbo major ≥ 2 (the L-1 guard, so a stripped-env bring-up is refused before anything else)                                                                                                                                                                                 | no                                |
| 3   | Ports owned by the right process      | `ss -ltnp` for 5433, 8123, 8787, 3000, 9100, 5173 (+ 8090, 8079 when `--chat`); assert the listener's command matches the expected binary — an orphaned `workerd` on 8787 answers requests (README §6.8)                                                                                                                                                         | no                                |
| 4   | Containers                            | `docker ps --format` — `al_pg_local`, `estalara_ch_local` running (not merely existing); for PG, assert the **second** "ready to accept connections" line                                                                                                                                                                                                        | no                                |
| 5   | Env **names** present                 | assert the non-empty presence of `DATABASE_URL_ADMIN`, `ADAPT_API_KEY`, `ADMIN_API_SECRET`, `OPS_TENANT_ID`, `SCORING_PATH_COLUMN_ENABLED`, `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `FEEDBACK_ENDPOINT_ENABLED`; print `NAME: set` / `NAME: MISSING` only — never a value, never a prefix, never a length                                    | no (only that the shell has them) |
| 6   | `DATABASE_URL_ADMIN` is loopback      | reuse `bootstrap-local.ts`'s `ALLOWED_HOSTS` idea: refuse a hosted host outright — this is the §6.1 hosted-Supabase trap turned into a gate                                                                                                                                                                                                                      | no                                |
| 7   | Postgres reachable + at head          | connect; `SELECT count(*) FROM drizzle.__drizzle_migrations` vs `meta/_journal.json` entry count → report `applied/total`, fail on `pending > 0`                                                                                                                                                                                                                 | no                                |
| 8   | ClickHouse reachable + schema present | `SHOW TABLES`; then assert every column the adapt/analytics paths name, derived from `infra/clickhouse/migrations/*.sql` rather than hardcoded (at minimum `adaptation_decisions.scoring_path`) — CH has no journal (L-7), so existence is the only available proof                                                                                              | no                                |
| 9   | Seeds present                         | local PG: `tenants` row for the fixture tenant + `api_keys` row (`seed:local-tenant`); `archetype_embeddings` = 18 rows **and** `count(embedding IS NULL)`; `tenant_site_schemas` non-empty; `listing_embeddings` count. **Report the NULL-embedding count as a first-class warning** — it is L-8, and it is the difference between `cosine` and `djb2_fallback` | no                                |
| 10  | Ingest Worker                         | `GET :8787/health` → `{"status":"ok","environment":"development"}`; assert `environment !== "production"` (else the origin gate 403s); assert the seeded KV record's tenant matches the fixture's `data-tenant-id` by reading the fixture HTML                                                                                                                   | no                                |
| 11  | Control plane is REAL, not the mock   | `GET :3000/mock/status` must **not** answer (the harness's own rule); then `POST :3000/api/adapt` with `{}` must return `invalid_demo_token` — a 500 `demo_auth_misconfigured` is a **hard fail** pointing at check 2; 404 is a hard fail (wrong origin). Warm the route first and allow ≥ 20 s for a cold compile                                               | no                                |
| 12  | Staff route reachable                 | `GET :3000/api/admin/analytics/rollup?tenant_id=…` with `ADMIN_API_SECRET` → not 401/500; this is the AC(5) credential that is _not_ `ADAPT_API_KEY`                                                                                                                                                                                                             | yes (local string)                |
| 13  | CORS origin sanity                    | import `CORS_DEV_EXTRA_ORIGINS` from `apps/control-plane/src/lib/origin-policy.ts` and assert the fixture/listing origin is in it — the §6.2 trap                                                                                                                                                                                                                | no                                |
| 14  | Postgres connection headroom          | `SELECT count(*) FROM pg_stat_activity` vs `max_connections`; warn above 70 % (README §6.7 — exhausted connections read as product failures)                                                                                                                                                                                                                     | no                                |
| 15  | Chat hop (opt-in `--chat`)            | `POST :8090/chat_nlp_endpoint` unauthenticated → 401; `POST :8079` with the local token → `{"result":"OK"}`; assert the Worker has `MODAL_CHAT_NLP_URL` set (via `/health` or a probe), catching L-6                                                                                                                                                             | no                                |

### Exit codes

| Code | Meaning                                                                                                                                                                                                                    |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | every check PASS (warnings allowed, printed)                                                                                                                                                                               |
| 1    | one or more substrate checks FAIL — something is down, unmigrated, unseeded, or on the wrong port                                                                                                                          |
| 2    | **configuration** fault that would make a run a false RED: check 2 (turbo env), 6 (hosted DB), 11 (`demo_auth_misconfigured`), 13 (CORS origin). Distinct from 1 because the substrate is _up_ and the run would still lie |
| 3    | UNDETERMINED — the preflight itself could not look (missing `docker`/`ss`, unparseable `turbo.json`, timeout). Never green, never a verdict on the substrate. Mirrors the PR-checks verifier's exit 3 semantics            |
| 4    | version mismatch only (check 1), everything else green                                                                                                                                                                     |

### Output format

One line per check, stable order, machine-greppable, no values:

```
[ 1/15] PASS  tool versions           node 22.15.0 · pnpm 9.15.4 · python 3.12.3 · docker present
[ 2/15] FAIL  turbo env allowlist     turbo 2.9.6 strict + 0 declared keys -> FOLLOW-1132
[ 5/15] PASS  env names               DATABASE_URL_ADMIN: set · ADAPT_API_KEY: set · ADMIN_API_SECRET: MISSING
[ 9/15] WARN  seeds                   archetype_embeddings 18 rows, 18 NULL -> scoring_path cannot be 'cosine' (L-8)
...
RESULT: FAIL  (13 pass, 1 fail, 1 warn, 0 undetermined)  exit=2
```

`RESULT:` as the last line, on the PR-checks verifier precedent (the session memory on verifier exit
codes masked by a pipe: read the `RESULT:` line, never the exit code through a pipe). A `--json`
flag emits the same rows so the FOLLOW-819 harness can call it and record the substrate state in
`last-run.json`.

### Which checks need no secrets

**1, 2, 3, 4, 6, 7, 8, 9, 10, 11, 13, 14, 15** — all of them except 5 (which only asserts _presence_
of names already in the operator's shell) and 12 (which needs the local `ADMIN_API_SECRET` string
the operator chose). Nothing in the preflight requires Doppler, a cloud credential, or network
egress. That matters: it means the preflight can run in a terminal with no `doppler login`, and it
can be the first thing a session runs.

### Suggested ticket

`NO COVERAGE` today. Recommended shape: P1, `devops-engineer`, depends on `FOLLOW-1132` only for
check 2's remediation (the _check_ can land first and fail loudly), blocks nothing but shortens
every localhost measurement and would have caught four of the eight defects
`tests/e2e/follow-819/ README.md` §6 found by hand.

---

# AREA 12 — Tests and CI completeness

## T-1 — Workspace × task matrix

`runs in CI` cites workflow + job. Root-level `format:check` (`package.json:18`,
`prettier --check .`) covers every workspace at once via the `Format check` job
(`.github/workflows/ci.yml:291-309`); **no workspace defines its own `format:check`**, so that
column is "root-only" everywhere and is marked `→root`.

| Workspace                                                                                              | lint                                  | typecheck                                      | test                                                                                                                                         | build                                                                                                                                  | format:check                       |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `apps/control-plane`                                                                                   | `eslint src/` — CI `ci.yml:80` Lint   | `tsc --noEmit` — CI `ci.yml:105` Typecheck     | `vitest run` — CI `ci.yml:171` Test (Node 22)                                                                                                | `copy-sdk-bundle + next build` — CI `ci.yml:267` Build (control-plane)                                                                 | →root                              |
| `apps/ingest`                                                                                          | ✓ CI Lint                             | ✓ CI Typecheck                                 | ✓ CI Test (Node 22)                                                                                                                          | `tsc --noEmit` — CI `ci.yml:240` Build. **No emit: `build` produces no artifact despite `turbo.json:7` declaring `dist/**` outputs\*\* | →root                              |
| `apps/decision-api`                                                                                    | ✓ CI Lint                             | ✓ CI Typecheck                                 | ✓ CI Test (Node 22)                                                                                                                          | `tsc --noEmit` — same no-emit note                                                                                                     | →root                              |
| `packages/{auth,compliance,db,intent-ontology,platform-templates,sdk-loader,sdk-react,sdk-vue,shared}` | ✓ CI Lint                             | ✓ CI Typecheck                                 | ✓ CI Test (Node 22)                                                                                                                          | `tsc -p tsconfig.build.json` — ✓ CI Build                                                                                              | →root                              |
| `packages/sdk`                                                                                         | ✓ CI Lint                             | ✓ CI Typecheck                                 | ✓ CI Test (Node 22); `test:corpus` — CI `ci.yml:511` corpus gate; `test:e2e` (playwright) — CI `ci.yml:1446` SDK E2E tests                   | `tsup` + `build:check` size gate — ✓ CI Build                                                                                          | →root                              |
| `tests/integration` (`@estalara/integration-smoke`)                                                    | **script missing** — never linted     | **script missing** — never typechecked         | `vitest run` — CI `ci.yml:201` Test (Node 22) (added by FOLLOW-1065)                                                                         | **script missing**                                                                                                                     | →root                              |
| `tests/e2e` (`@estalara/e2e-smoke`)                                                                    | **script missing**                    | **script missing**                             | `vitest run` — **runs in NO `pull_request` job**; only `e2e-smoke.yml` (nightly cron / dispatch) and the soft-skipped `demo-integration.yml` | **script missing**                                                                                                                     | →root                              |
| `apps/intent-engine` (py)                                                                              | ruff declared, **run by no workflow** | mypy `strict` declared, **run by no workflow** | `pytest src/` — CI `ci.yml:203` Test (Python) (3.12, intent-engine)                                                                          | n/a                                                                                                                                    | black declared, **run by nothing** |
| `apps/llm-gateway` (py)                                                                                | same                                  | same                                           | ✓ Test (Python) (3.12, llm-gateway)                                                                                                          | n/a                                                                                                                                    | same                               |
| `apps/stream-consumer` (py)                                                                            | same                                  | same                                           | ✓ Test (Python) (3.12, stream-consumer)                                                                                                      | n/a                                                                                                                                    | same                               |
| `apps/data-quality` (py)                                                                               | same                                  | same                                           | ✓ Test (Python) (3.12, data-quality)                                                                                                         | n/a                                                                                                                                    | same                               |

Also outside every workspace and therefore outside `turbo run lint|typecheck`: `scripts/` (16
`.mjs`/`.cjs`/`.ts` gate scripts) and `.claude/hooks/`. `eslint.config.mjs:22-34` additionally
ignores `apps/control-plane/scripts/**` and `packages/sdk/scripts/**` by name, so
`feedback-canary.mts`, `seed-*.mts`, `copy-sdk-bundle.mjs` and `check-bundle-size.js` are unlinted
too.

## T-2 — Coverage thresholds are configured to the CLAUDE.md bar and enforced nowhere

- **Claim.** Every unit vitest config declares thresholds matching the quality bar — 80 % for
  `packages/*`, 70 % for `apps/*` — but `--coverage` appears in **no** script, **no** workflow and
  **no** config sets `coverage.enabled: true`. `vitest run` without `--coverage` never computes
  coverage, so no threshold can ever fail. The CLAUDE.md bar ("≥80% for `packages/*`, ≥70% for
  `apps/*`") is unmeasured.
- **Status.** ASPIRATIONAL.
- **Evidence.** Thresholds: `packages/shared/vitest.config.ts:8-17` (80),
  `packages/sdk/ vitest.config.ts:9-18` (80), `packages/auth`, `packages/compliance`,
  `packages/intent-ontology`, `packages/platform-templates`, `packages/sdk-loader`,
  `packages/sdk-react`, `packages/sdk-vue` (all 80), `packages/db/vitest.config.ts:21-35` (80,
  `include` narrowed to two files), `apps/control-plane/vitest.config.ts:42-51` (70),
  `apps/ingest/vitest.config.ts:25-34` (70), `apps/decision-api/vitest.config.ts:8-17` (70).
  Integration configs deliberately disable it (`apps/ingest/vitest.integration.config.ts:28-30`,
  `apps/control-plane/ vitest.integration.config.ts:46-48`,
  `tests/integration/vitest.config.ts:34-36`). A repo-wide grep for `--coverage` /
  `coverage.enabled: true` over `apps packages tests .github scripts package.json` returns **zero**
  hits.
- **Impact.** degrades data (indirectly) — the repo's one stated quantitative quality bar is
  decorative, and `packages/db`'s `include` narrowing means even if enabled it would measure two
  files out of the package.
- **Ticket coverage.** `FOLLOW-236` (`backlog/FOLLOW_UPS.md:6170`) covers one narrow instance
  (restoring `src/index.ts` to `packages/db`'s `coverage.include`) and has no QUEUE status line →
  stub, never promoted. The _enforcement_ gap: NO COVERAGE.
- **Priority.** P2; depends on nothing. (Per CONVENTIONS_PATCH Rule AF, a threshold that can never
  fail is a disabled gate.)
- **Proposed AC.** (1) one CI job runs `vitest run --coverage` per workspace (or
  `turbo run test -- -- --coverage`) and the thresholds bite; (2) the measured baseline per
  workspace is pasted into the PR, and any workspace below its bar either rises or gets an explicit,
  dated, ticketed exemption rather than a silent one; (3) `packages/db`'s `coverage.include`
  narrowing is justified in place or removed; (4) CLAUDE.md's bar cites the job that enforces it.
- **Red-first proof.** Drop one threshold to 100 in a scratch branch: `pnpm test` still exits 0
  today (proof nothing reads it); after the job lands, that change goes red.

## T-3 — Zero Python lint, typecheck or format in CI or hooks

- **Claim.** All four Python apps declare `ruff`, `mypy` (`strict = true`) and `black` in
  `[project.optional-dependencies] dev` and configure them in `pyproject.toml`. A grep for
  `ruff|mypy|black ` across `.github/workflows/` returns **nothing**. `lefthook.yml` runs prettier +
  eslint + gitleaks + commitlint and no Python tool. The only Python check anywhere is `pytest`.
- **Status.** ASPIRATIONAL.
- **Evidence.** `apps/data-quality/pyproject.toml:21-44`, `apps/intent-engine/pyproject.toml:20-44`,
  `apps/llm-gateway/pyproject.toml:21-42`, `apps/stream-consumer/pyproject.toml:21-49`;
  `.github/workflows/ci.yml:236-237` (`python -m pytest src/ -v` is the whole Python gate);
  `lefthook.yml:1-35`. Sub-finding: `intent-engine` and `llm-gateway` put `select = [...]` under
  `[tool.ruff]` (`:39` / `:37`) while `data-quality` and `stream-consumer` use the current
  `[tool.ruff.lint]` (`:38-39` / `:43-44`) — an inconsistency that is currently moot because nothing
  runs ruff, and would produce different behaviour the moment something does.
- **Impact.** degrades data — `mypy strict` on the Modal tier is where a silent `None` in
  `write_shadow_intent` or a wrong field name in a consumer would be caught; the repo's own history
  (a `KeyError` on a missing `UPSTASH_REDIS_REST_URL` inside a `.spawn()`, per
  `docs/runbooks/LOCAL_PILOT_ENVIRONMENT.md:299-302`) is exactly that class.
- **Ticket coverage.** NO COVERAGE (`ruff`, `mypy`, `python lint` all return zero hits in the ticket
  index).
- **Priority.** P1 — four production services have no static analysis at all, and one of them
  (`intent-engine`) is FOLLOW-820 condition 3.
- **Proposed AC.** (1) the `test-python` matrix gains `ruff check .`, `ruff format --check .` (or
  `black --check`) and `mypy src/` steps; (2) all four `[tool.ruff]` blocks use the same
  `[tool.ruff.lint]` shape; (3) the four new check-run names are added to
  `.github/required-checks.txt` **in the same PR** (CLAUDE.md Lesson 1); (4) the initial finding
  count per app is pasted, and anything suppressed is suppressed by explicit rule code with a
  reason, never by lowering `strict`.
- **Red-first proof.** `cd apps/intent-engine && mypy src/` and `ruff check .` today produce a
  nonzero finding count that no CI run has ever seen; the new jobs are red until it reaches 0 or an
  agreed baseline.

## T-4 — `tests/e2e` runs in no pull-request job, and `demo-integration.yml` tells every reader that it does

- **Claim.** `ci.yml:201`'s test filter is
  `--filter='./packages/*' --filter='@estalara/ingest' --filter='@estalara/decision-api' --filter='@estalara/control-plane' --filter='@estalara/integration-smoke'`.
  `@estalara/e2e-smoke` (`tests/e2e`) is absent. `demo-integration.yml:64` and `:190-191` assert
  _"Static contract tests (5 always-run tests) still execute in the standard 'test-node' CI job"_ —
  they do not. Those five tests (`tests/e2e/sprint-9-5-demo.spec.ts:483-580`,
  `describe('Demo flow — static contract assertions (always run)')`) run only in `e2e-smoke.yml`
  (nightly cron / dispatch) whose own header records 103 consecutive failures with no notification
  channel.
- **Status.** CONFIRMED. This is FOLLOW-1065's exact defect, one workspace over: the fix added
  `@estalara/integration-smoke` and left its sibling out.
- **Evidence.** `.github/workflows/ci.yml:196-201` (the filter and the FOLLOW-1065 comment above
  it); `tests/e2e/package.json` (`name: @estalara/e2e-smoke`);
  `tests/e2e/sprint-9-5-demo.spec.ts:27` (`RUN_E2E`), `:191` (`describe.skipIf(!RUN_E2E)`),
  `:483-580` (the five always-run tests); `.github/workflows/demo-integration.yml:64,190-191`;
  `.github/workflows/e2e-smoke.yml:3-6` (schedule + dispatch only), `:151-156`.
- **Impact.** degrades data — `applyReorderDirectiveToDOM` / `applyTextDirectiveToDOM` contract
  assertions, the DOM half of the differentiator, are unguarded on every PR while two workflow
  comments state the opposite.
- **Ticket coverage.** `FOLLOW-1065` (`backlog/FOLLOW_UPS.md:40898`) is the same-shape ticket, DONE
  (`backlog/QUEUE.md:2362` — "runs in NO CI job (FOLLOW-1065)"). `@estalara/e2e-smoke`: NO COVERAGE.
- **Priority.** P1; depends on nothing.
- **Proposed AC.** (1) `--filter='@estalara/e2e-smoke'` is added to `ci.yml:201`; (2) the five
  always-run tests are observed as `passed` (not `skipped`) in a `Test (Node 22)` log, pasted; (3)
  `demo-integration.yml:64,190-191` are corrected or become true; (4) `tests/e2e` and
  `tests/integration` gain `lint` and `typecheck` scripts so `turbo run lint|typecheck` covers them.
- **Red-first proof.**
  `pnpm turbo run test --filter='./packages/*' --filter='@estalara/ingest' --filter='@estalara/decision-api' --filter='@estalara/control-plane' --filter='@estalara/integration-smoke'`
  reports zero tests from `tests/e2e` today.

## T-5 — 22 of 32 shell gates and all 16 JS/TS gate scripts under `scripts/` are linted by nothing

- **Claim.** `scripts/` holds 32 `.sh` files (including `lib/` and `__tests__/`). The
  `shellcheck-sentry-gates` job lints exactly 10 of them plus two `.claude/hooks` files and one
  fixture. `scripts/` is not a pnpm workspace, so `turbo run lint` never reaches it — the 16
  `.mjs`/`.cjs`/`.ts` gate scripts there (`check-adapt-schema-drift.cjs`,
  `check-adr-0021-conditions.mjs`, `check-consent-*.mjs`, `check-deployment-surfaces.mjs`,
  `check-measured-premises.mjs`, `check-k2-consumer-swallow.cjs`,
  `check-session-identifier-corpus- sync.mjs`, `check-staff-write-atomicity.cjs`,
  `check-ticket-status-vocabulary.mjs`, `check-archetype-seeds.ts`, `check-bundle-size.ts`, …) are
  never linted or typechecked.
- **Status.** CONFIRMED.
- **Evidence.** `.github/workflows/ci.yml:1164-1198` (the explicit file list:
  `check-sentry-capture- has-init.sh`, `check-sentry-init-singleton.sh`,
  `lib/clean-python-source.sh`, `lib/suppression-baseline.sh`, the PR-checks verifier script,
  `check-gate-exit-codes.sh`, `check-rule-h.sh`, `check-rule-i.sh`, `lib/wired-or-dead-common.sh`),
  `:1233-1238` (`.claude/hooks/*` + fixture), `:1148-1154` (the job's own comment that its scope is
  explicit, not `scripts/**/*.sh`); `package.json:14` (`"lint": "turbo run lint"`);
  `eslint.config.mjs:22-34`.
- **Impact.** none directly on measurement; these are the gates every merge is judged by, and the
  repo has repeatedly found fail-open defects in them (FOLLOW-830, FOLLOW-842, FOLLOW-857 all
  concern a gate that silently stopped checking).
- **Ticket coverage.** `FOLLOW-775` (`backlog/FOLLOW_UPS.md:24764`, "shellcheck runs over four
  files; the other ~30 shell scripts in `scripts/` are unlinted, and two of them are blocking
  gates") and `FOLLOW-844` (`:28580`, P3) — both **OPEN stubs**, referenced in QUEUE only as filed
  (`backlog/QUEUE.md:9015`, `:6370`), never as done. `FOLLOW-966` (`:35462`) covers the hooks half.
  The **JS/TS** gate scripts: NO COVERAGE.
- **Priority.** P2 (FOLLOW-775 already exists; the JS half is the new part).
- **Proposed AC.** (1) `shellcheck` runs over every `scripts/**/*.sh` and `.claude/hooks/*.sh`, with
  any exclusion listed by name and reason; (2) `scripts/` is added to the eslint run (a root
  `lint:scripts` script wired into the `Lint` job, or `scripts/` promoted to a workspace); (3) the
  initial finding count is pasted; (4) no new check-run name without a `.github/required-checks.txt`
  edit in the same PR.
- **Red-first proof.** `shellcheck scripts/*.sh` and `pnpm exec eslint scripts/` both produce
  findings today that no CI run has ever evaluated.

## T-6 — Two gates registered as must-be-SUCCESS are structurally incapable of being red; one PR-running job always exits 0 and is unregistered

- **Claim.** (a) `Doppler verify` is registered green-required (`.github/required-checks.txt:69`)
  while the job carries `continue-on-error: true` (`ci.yml:55`) **and** exits 0 when
  `DOPPLER_TOKEN_DEV` is absent (`ci.yml:73`). (b) `Archetype embeddings not-NULL check` is
  registered green-required (`.github/required-checks.txt:59`) while the job carries
  `continue-on-error: true` (`ci.yml:1364`) and skips its only assertion when the same secret is
  absent (`ci.yml:1408-1410`, `if: steps.doppler-check.outputs.skip == 'false'`). (c)
  `Demo integration (detect → activate → adapt → SDK)` runs on `pull_request` (path-filtered) and
  cannot fail: every substantive step is gated on `env.HAS_CREDS == 'true'` and both soft-skip
  branches echo and exit 0. It is **not** in the register — correctly, since path filtering would
  false-red it, but the net effect is a PR-visible job that is a no-op.
- **Status.** CONFIRMED for the structure; **BLOCKED** on whether `DOPPLER_TOKEN_DEV` is actually
  provisioned — that is a repo-settings fact I cannot read without `gh`/network. If it _is_
  provisioned, (a) and (b) still cannot go red because of `continue-on-error`.
- **Evidence.** as cited; plus `.github/required-checks.txt:22-30` — the register's own contract is
  "every check-run carrying it must be SUCCESS" unless marked `any-state`, and neither of these is.
- **Impact.** degrades data — the register is the repo's identity axis for CI trust (FOLLOW-918);
  two of its 51 green-required entries buy presence only, which is the `any-state` semantics without
  the label. `Archetype embeddings not-NULL` is the only gate that would notice L-8's sibling defect
  in the hosted dev DB.
- **Ticket coverage.** NO COVERAGE (`Doppler verify`, `doppler-verify`, `vacuous` return zero hits).
  `FOLLOW-918` established the register; `FOLLOW-040` / ESC-009 are the long-standing
  secret-provisioning items these two jobs soft-skip for.
- **Priority.** P2.
- **Proposed AC.** (1) each of the two is either made a real gate (drop `continue-on-error`, fail on
  a missing secret once it is provisioned) or moved to the `any-state` section with the reason
  written next to it, as `.github/required-checks.txt:110-119` already does for three prod-only
  jobs; (2) `Demo integration`'s two soft-skip branches emit a `::warning` and the job is either
  registered `any-state` or documented in the register's "DELIBERATELY NOT REGISTERED" block per
  Rule AS (`:121-135`); (3) a one-line statement of whether `DOPPLER_TOKEN_DEV` exists today.
- **Red-first proof.** Force the assertion in `ci.yml:1397` to `process.exit(1)` on a scratch
  branch: the check-run still reports success today.

## T-7 — Integration specs wired to no workflow

| Spec                                                                                     | Runner | Status                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/control-plane/src/__tests__/integration/clickhouse-dsr.integration.test.ts`        | none   | **excluded by name** — `ci.yml:480-483`: "has known latent failures tracked by FOLLOW-317; running it here would produce false negatives". `FOLLOW-317` is still a stub (`backlog/FOLLOW_UPS.md:8664`; `backlog/QUEUE.md:20531` "remains a stub in FOLLOW_UPS.md") |
| `apps/control-plane/src/lib/__tests__/llm-gateway-judge-rate.integration.test.ts`        | none   | reachable only via `pnpm --filter @estalara/control-plane test:integration:judge-rate` (`apps/control-plane/package.json`); grep of `.github/workflows/` for `llm-gateway-judge-rate` → 0 hits                                                                     |
| `apps/control-plane/src/lib/__tests__/llm-gateway-unjudged-register.integration.test.ts` | none   | same; 0 workflow hits                                                                                                                                                                                                                                              |
| `apps/stream-consumer/tests/integration/test_e2e_consumer.py`                            | none   | outside `testpaths = ["src"]` (`apps/stream-consumer/pyproject.toml:52`), and CI additionally pins `python -m pytest src/` (`ci.yml:237`). Also `@pytest.mark.skipif(not _docker_services_available())` (`:81`)                                                    |

- **Status.** CONFIRMED.
- **Impact.** degrades data — the DSR ClickHouse mutation path (a GDPR erasure control) and the
  judge-cost register (the FOLLOW-1173/1176 subject) have no automated execution anywhere.
- **Ticket coverage.** `FOLLOW-317` OPEN stub for the DSR spec. The two llm-gateway integration
  specs and the stream-consumer integration test: NO COVERAGE.
- **Priority.** P2 (DSR spec P1 on the compliance axis, but that is Area 9/10's call).
- **Proposed AC.** (1) each spec is either wired to a job or its non-execution is recorded in
  `.github/required-checks.txt`'s Rule AS block with the coverage forgone stated; (2)
  `apps/stream-consumer/pyproject.toml` `testpaths` includes `tests` (the marker already keeps it
  off a runner without docker) or the file moves under `src/`; (3) `FOLLOW-317` gets a QUEUE status.
- **Red-first proof.** `grep -rl llm-gateway-judge-rate .github/workflows/` returns nothing today.

## T-8 — skip / todo / only inventory: no unconditional skips; every skip is secret- or container-gated

No `it.todo`, `test.todo`, `describe.skip(` (bare), `xit(` or `.only(` anywhere in
`apps packages tests`. Every skip is conditional and justified in place:

| File:line                                                                                                | Gate                                                                                       |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `apps/ingest/src/__tests__/integration/clickhouse-producer.integration.test.ts:134`                      | `REQUIRE_CLICKHOUSE \|\| CLICKHOUSE_URL ? describe : describe.skip`                        |
| `apps/control-plane/src/__tests__/integration/clickhouse-dsr.integration.test.ts:142,192,220`            | `test.skipIf(!HAS_CLICKHOUSE)`                                                             |
| `apps/control-plane/src/__tests__/integration/clickhouse-tracer.integration.test.ts:191,216,241,261,278` | `test.skipIf(!HAS_CLICKHOUSE)`                                                             |
| `apps/control-plane/src/__tests__/integration/consent-log-retention.integration.test.ts:133`             | `describe.skipIf(!HAS_CLICKHOUSE)`                                                         |
| `apps/control-plane/src/lib/__tests__/llm-gateway-judge-rate.integration.test.ts:106`                    | `it.skipIf(!process.env.ANTHROPIC_API_KEY)`                                                |
| `apps/control-plane/src/lib/__tests__/llm-gateway-unjudged-register.integration.test.ts:119,154`         | `it.skipIf(!CLICKHOUSE_URL \|\| !ANTHROPIC_API_KEY)`                                       |
| `tests/integration/intent-weights-live.smoke.test.ts:128,181,254`                                        | `it.skipIf(!HAS_SECRETS)`                                                                  |
| `tests/integration/adapt-llm-source-live.smoke.test.ts:126`                                              | `it.skipIf(!HAS_SECRETS)`                                                                  |
| `tests/integration/redis-shadow-round-trip.smoke.test.ts:174,241,396,452`                                | `it.skipIf(!HAS_ALL_CREDS)`                                                                |
| `tests/e2e/smoke-ingest.test.ts:89`                                                                      | `it.skipIf(!REQUIRE)`                                                                      |
| `tests/e2e/sprint-9-5-demo.spec.ts:191`                                                                  | `describe.skipIf(!RUN_E2E)`                                                                |
| `apps/intent-engine/src/test_intent_engine.py:61,70`                                                     | `@pytest.mark.skipif(not _HAS_API_KEY)`; `:470` `pytest.importorskip("anthropic")`         |
| `apps/stream-consumer/tests/integration/test_e2e_consumer.py:40,46,56,81`                                | `pytestmark = integration`; two `importorskip`; `skipif(not _docker_services_available())` |

The hard-fail `REQUIRE_*` counter-levers exist and CI sets them where a container is guaranteed
(`ci.yml:417`, `:479`, `:501` (`REQUIRE_CLICKHOUSE: "1"`), `e2e-smoke.yml:120`
`REQUIRE_INGEST_SMOKE: "1"`), which is Rule Q done correctly. **Status: CONFIRMED, no finding.**

## T-9 — Tests that report without asserting: one candidate, and it is a false positive

Across 413 test files (`*.test.ts(x)`, `*.spec.ts`, `test_*.py`), exactly one has fewer than two
`expect(`/`assert`/`.toBe`/`self.assert` occurrences:
`apps/control-plane/src/lib/__tests__/llm-gateway-judge-rate.integration.test.ts` (1). Every other
file asserts. No test body is `console.log`-only. **Status: CONFIRMED, no finding.**

The reporting-without-asserting problem in this repo lives at the **job** level, not the test level
— see T-6 (a), (b), (c) and the `|| true` diagnostics in `e2e-smoke.yml:132-143` (those are
failure-path diagnostics under `if: failure()`, which is correct).

## T-10 — Required-checks register vs workflows

Computed by extracting every `    name:` from `.github/workflows/*.yml`, expanding the two matrices
(`Test (Node 22)`, `Test (Python) (3.12, <app>)` ×4) and diffing against
`.github/required-checks.txt`.

**Registered, produced by no workflow job (2):** `Vercel`, `Vercel Preview Comments`
(`.github/required-checks.txt:101-102`). Both come from the Vercel GitHub App, not a workflow —
legitimate, but it means two of the register's green-required entries depend on an external
integration staying connected, and nothing in the repo documents that. Worth one line in the
register's header. No other registered name is unproduced: **49 of 51 green-required names and all
four `any-state` names map to a real job.**

**Workflow jobs not registered (15).** Thirteen are deploy/seed/manual/scheduled and correctly
absent: `Migrate (staging)`, `Migrate (prod)` (`db-migrate.yml`), `Deploy Ingest Worker (Staging)`,
`Deploy Decision API Worker (Staging)` (`deploy-staging.yml`, dispatch-only), the three
`modal-deploy.yml` deploys, `Release`, `Seed archetype embedding vectors`,
`Seed archetype embeddings (if any NULL)`, `ingest → clickhouse smoke` (nightly), `k6 load test …`
(dispatch), `Announce a failed nightly heartbeat`. Two deserve a line:

- `K.3.6 D-1 live-network smoke (…)` — deliberately and explicitly not registered, with the
  reasoning at `.github/required-checks.txt:121-135`. Exemplary; no action.
- `Demo integration (detect → activate → adapt → SDK)` — runs on `pull_request`, is not registered,
  and cannot fail (T-6c). Undocumented in the register's Rule AS block.

**Status.** CONFIRMED. **Impact:** none directly; the register is in good shape. **Ticket
coverage:** `FOLLOW-918` established it; the two gaps above: NO COVERAGE. **Priority** P3.
**Proposed AC:** the register's header gains a line for the Vercel App dependency, and
`Demo integration` is added to the Rule AS block with its forgone coverage stated. **Red-first
proof:** a reader cannot today tell from the register that `Vercel` is not a workflow.

## T-11 — `ci.yml:1246` justifies a duplicated job with a property `test-python` does not have

- **Claim.** `ci.yml:1245-1247` reads _"The existing test-python matrix is NOT used here because it
  has continue-on-error on individual pytest runs. This dedicated job is always blocking."_ The
  `test-python` job (`ci.yml:203-237`) has **no** `continue-on-error` at any level — it has
  `fail-fast: false` (`:207-208`), which is a different thing. The stated reason for
  `cross-language-contract` existing as a separate job is false at HEAD.
- **Status.** STALE.
- **Evidence.** `.github/workflows/ci.yml:203-237` vs `:1245-1247`; the only
  `continue-on-error: true` entries in `ci.yml` are `:55` and `:1364`.
- **Impact.** none on measurement; it is a comment that will justify the next wrong decision about
  where a Python gate belongs.
- **Ticket coverage.** NO COVERAGE.
- **Priority.** P3; folds into T-3's PR (which will touch `test-python` anyway).
- **Proposed AC.** the comment states the real reason (a dedicated blocking job with its own
  registered name) or is deleted.
- **Red-first proof.** `grep -n continue-on-error .github/workflows/ci.yml` shows `:55` and `:1364`
  only.

---

## Area verdict

**Local bring-up (Area 11): the runbooks are unusually honest and the code beneath them is not
consistent with them.** Three defects are load-bearing for the localhost stage rather than cosmetic:
`turbo.json` declares no env under Turbo 2.9.6 strict mode so the repo's own `pnpm dev` cannot start
a working control plane (L-1, FOLLOW-1132 OPEN P1); `pnpm seed:archetypes` can only write to hosted
Supabase, so `archetype_embeddings.embedding` is NULL on every local database and
`adaptation_decisions.scoring_path = 'cosine'` is structurally unreachable on the substrate
FOLLOW-820 condition 1 is graded against (L-8, **NO COVERAGE, P1**); and the FOLLOW-819 harness
still defaults to the CORS-refused `:9200` port and accepts the L-1 500 as a healthy control plane
(L-12, **NO COVERAGE, P1**). ClickHouse DDL has no journal and no pnpm wrapper, so "migrations at
head" is answerable only by column existence — which is what the proposed preflight checks. There is
no preflight command today and no ticket for one; the fifteen checks above are all runnable
**without a single secret**, which is the reason to build it.

**Tests and CI (Area 12): the gate surface is broad and well-reasoned, and three whole axes are
missing.** The coverage thresholds match CLAUDE.md's bar exactly and are enforced nowhere — no
script or workflow ever passes `--coverage`, so the repo's one quantitative quality bar is
decorative (T-2). The four Python services declare `ruff`, `mypy strict` and `black` and CI runs
none of them; `pytest` is the entire Python gate (T-3). `tests/e2e` is in no pull-request job while
two comments in `demo-integration.yml` assert that its five contract tests run there — the same
defect FOLLOW-1065 fixed one workspace over (T-4). On the positive side: there are no unconditional
`skip`/`todo`/`only` tests, every skip is secret- or container-gated with `REQUIRE_*` hard-fail
counter-levers wired in CI, only one test file has a single assertion, and 49 of 51 green-required
register entries map to a real job. The register's weakness is not identity but falsifiability:
`Doppler verify` and `Archetype embeddings not-NULL check` are registered must-be-SUCCESS and carry
`continue-on-error: true`, so they cannot go red (T-6) — Rule AF's own definition of a disabled
gate.

## Open questions for the CEO

1. **L-8 is a grading question, not an engineering one.** The localhost substrate can never produce
   `scoring_path = 'cosine'`, because the only archetype-embedding seeder writes to hosted Supabase.
   Does FOLLOW-820 condition 1 accept a 6/6 FOLLOW-819 run in which the cosine ranking path — the
   §F.3 differentiator — has provably never executed, or is a local cosine run added to the gate?
2. **T-2/T-3 versus the FOLLOW-820 critical path.** Enabling coverage enforcement and adding
   `ruff`/`mypy` to the four Python apps will surface an unknown backlog of findings on services
   that are on the localhost path (`intent-engine` is condition 3). Should that land before
   FOLLOW-820, or is it explicitly queued behind GO?
3. **`DOPPLER_TOKEN_DEV`.** I cannot read repo secrets. Two registered green-required gates
   soft-skip on it and are additionally `continue-on-error`. Is it provisioned, and if so, may the
   `continue-on-error` come off both?
