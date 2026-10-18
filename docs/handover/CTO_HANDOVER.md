# Adaptive Listings — CTO handover package

**Version:** v0 (2026-10-18 — skeleton, living document; opened by FOLLOW-1319, plan package 0.4,
CEO ruling D-F of 2026-10-16: production deployment is a handover package for the CTO, not steps the
PM executes). **Frozen as v1 at plan Phase 7 (H2), after checkpoint K7.** Every later PR that adds,
removes or changes a production-side obligation appends a row here in the same PR (Rule: this file
is the ONLY list of production steps owed; `backlog/QUEUE.md` carries none).

**Audience:** Rafał Palak (CTO). **Author of record:** architect (Fable) for v0; the PM keeps it
current between checkpoints. **Scope:** what the CTO needs to put the localhost-proven Adaptive
Listings on production app.estalara.com and admin.estalara.com, verify it, and roll it back.

**How to read the markers.** `TODO(Kn)` = filled at or before checkpoint Kn of the plan;
`TODO(phase N)` = filled by that phase's PRs. Nothing marked TODO is a known fact yet.

Sources this document cites, in order of authority: `docs/MASTER_DESIGN.md` (§P.0 for the gate and
the post-GO list; §Snapshot.0 for status), `backlog/ESCALATIONS.md` (ESC-020, ESC-084, ESC-085),
`docs/runbooks/clickhouse-migrations.md`, `docs/runbooks/DEPLOYMENT_SURFACES.md`,
`docs/runbooks/INGEST_WORKER_DEPLOY.md`, `docs/ops/DOPPLER_SECRETS_MATRIX.md`,
`docs/runbooks/secrets.md`, `backlog/FOLLOW_UPS.md` (FOLLOW-1297 closure note of 2026-10-13).

---

## 1. System map

One product, one tenant (app.estalara.com), four runtime surfaces and five packages. The register of
what ships automatically on merge and what does not is `docs/runbooks/DEPLOYMENT_SURFACES.md` §The
register — this list does not restate it.

| Surface                          | What it is                                                                                                                                                                               | Ships how                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `packages/sdk` (`@estalara/sdk`) | Browser SDK (Preact + Shadow DOM, vanilla TS). Observes the page, runs the quiz and chat hooks, calls `/api/adapt`, mutates `data-estalara-slot` elements. Bundle ≤ 43,136 B gzip.       | Served as `admin.estalara.com/sdk.js` (built into the control plane). |
| `apps/ingest`                    | Cloudflare Worker: `/v1/events` ingest (HMAC/API-key auth, origin gate, signed-caller class), writes ClickHouse directly, dispatches chat to the intent engine over HTTPS.               | **Manual** `wrangler deploy --env production`.                        |
| `apps/control-plane`             | Next.js 15 on Vercel: `/api/adapt` (decision + LLM gateway + description generator), the staff backoffice `/admin`, consent/DSR routes, lift readers, cron routes.                       | Vercel merge-triggered deploy.                                        |
| `apps/intent-engine`             | Modal (Python): chat-NLP intent extraction (Haiku 4.5), shadow `chat_intent` key in Redis.                                                                                               | `modal-deploy.yml` on push to `main`.                                 |
| `apps/data-quality`              | Modal (Python) schema-validation cron. PARKED (FOLLOW-1298); REMOVED by ESC-085 — deleted from the repo by FOLLOW-1324.                                                                  | Not deployed; `modal app stop` owed (§4).                             |
| `packages/shared`, `db`, `auth`  | Zod event/decision schemas and examples; Drizzle schema + Postgres migrations (RLS); JWT/session helpers.                                                                                | Libraries.                                                            |
| `packages/platform-templates`    | REMOVED by ESC-085 (plan Phase 2 R1).                                                                                                                                                    | —                                                                     |
| Stores                           | Supabase Postgres (EU; config, tenants, consent, caches), ClickHouse Cloud (events, decisions), Upstash Redis (session/intent shadow, description cache), pgvector (listing embeddings). | Managed services; credentials by name in §3.                          |
| Observability                    | Sentry + OpenTelemetry + Grafana Cloud; the four production canaries of §9.                                                                                                              | GitHub Actions (scheduled).                                           |

Data path (buyer): page → SDK → `POST /v1/events` (ingest, < 50 ms ACK) → ClickHouse; SDK →
`POST /api/adapt` (control plane) → directives → DOM. Chat: SDK → ingest → intent engine → Redis
shadow key → next `/api/adapt`. Conversion: Estalara's backend → signed `live.signup` /
`inquiry.completed` → ingest (`caller_signed = 1`) → lift readers (§7).

`TODO(K7)`: replace the table with the final diagram after Phase 2/3 deletions land (the §A.1
diagram of MASTER_DESIGN is the source).

## 2. Single-tenant invariants (ESC-085, ruling D-A)

- **One tenant row.** `tenants` holds the Estalara tenant; its id is the constant
  `ESTALARA_TENANT_ID` (`apps/control-plane/src/lib/estalara-tenant.ts`, env
  `NEXT_PUBLIC_ESTALARA_TENANT_ID`; successor of `PILOT_TENANT_ID` / `NEXT_PUBLIC_PILOT_TENANT_ID`,
  one release of fallback — plan Phase 1 C2). `TODO(K1)`: confirm the file and env name as merged.
- **`tenant_id` stays everywhere internally.** Every event row, every RLS policy, every API key and
  every decision carries it. Nothing is re-keyed; there is simply one value. Do not "simplify" RLS
  by dropping the column — the policies are the only thing between a leaked service-role query and
  the whole table (ADR-0018 invariant 5).
- **Fixed origin allowlist.** Production accepts `https://app.estalara.com` and
  `https://admin.estalara.com`; outside production the localhost and fixture origins are added (plan
  Phase 2 R11: `lib/origin-policy.ts`, `lib/api-key-auth.ts`,
  `apps/ingest/src/{origin-gate,auth,router}.ts`). The DB column `allowed_origins` stays but is no
  longer read. `TODO(K2c)`: paste the final list and the test names that pin it.
- **No foreign-site detection, no registrations, no agency roles, no Stripe** (ESC-085 D-A/D-B/D-D/
  D-H). The investor consent endpoint `/api/v1/consent/platform-registration` is NOT multi-tenancy
  and stays.
- **The harness contract that must survive every deletion:** `GET /api/admin/analytics/rollup`
  (Bearer `ADMIN_API_SECRET`, no `tenant_id` ⇒ the Estalara tenant) keeps answering `data_source`,
  `rollup.ctaLift`, `conversion_source` — FOLLOW-819 AC(5) reads them.

## 3. Secrets inventory — BY NAME ONLY

Values live in Doppler (`dev` / `prd`) and, for the control plane, in Vercel environment variables;
the Worker's in `wrangler secret`. **No value is ever written in this repository or this document.**
The authoritative per-surface matrix is `docs/ops/DOPPLER_SECRETS_MATRIX.md` (sections "apps/ingest
(Cloudflare Worker)", "apps/control-plane (Next.js on Vercel)", "CI / shared"); the handling rules
are `docs/runbooks/secrets.md`. Names the handover steps in §4 refer to:

| Name                                                                                                                                                                           | Where                                     | Used for                                                                                        |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `CLICKHOUSE_URL`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`                                                                                                                     | Doppler `prd`; Worker                     | event store (admin `default` user for DDL; `ingest_worker` for writes, no ALTER)                |
| `DATABASE_URL_ADMIN`, `DATABASE_URL_DIRECT`, `SUPABASE_SERVICE_ROLE_KEY`                                                                                                       | Doppler `prd`; Vercel                     | Postgres (admin pooler for the backoffice; service role for staff writes)                       |
| `ADMIN_API_SECRET`                                                                                                                                                             | Doppler `prd`; Vercel                     | Bearer for staff/admin APIs (the harness reads the rollup with it; writes 403 after Phase 1 C1) |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`                                                                                                                                          | Doppler `prd`; Vercel; Modal secret       | LLM directives/descriptions; embeddings                                                         |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`                                                                                                                           | Doppler `prd`; Vercel; Worker             | session/intent shadow keys, description cache                                                   |
| `CRON_SECRET`                                                                                                                                                                  | Vercel                                    | Vercel Cron routes (incl. the lift daily snapshot, plan Phase 3 M5)                             |
| `HOLDOUT_PCT` and the holdout secret (ESC-079)                                                                                                                                 | Doppler `prd`; Vercel                     | arm assignment keyed on a server secret (§E.3.4 item 1)                                         |
| `CALLER_SIGNED_COLUMN_ENABLED`, `SCORING_PATH_COLUMN_ENABLED`                                                                                                                  | Worker vars; Doppler `prd`; Vercel        | flag-gated ClickHouse columns (§4 steps 2 and 4; order is load-bearing)                         |
| `FEEDBACK_ENDPOINT_ENABLED`                                                                                                                                                    | Doppler `prd`                             | bandit feedback endpoint (post-GO flip, §4 step 6)                                              |
| `MODAL_CHAT_NLP_URL`                                                                                                                                                           | Worker (`--env production`)               | ingest → intent engine dispatch (§4 step 7)                                                     |
| `STRIPE_*`                                                                                                                                                                     | Doppler `prd`; Vercel                     | TO BE DELETED (§4 step 9)                                                                       |
| `NEXT_PUBLIC_ESTALARA_TENANT_ID`                                                                                                                                               | Vercel; local env                         | the single-tenant constant override (non-production only after Phase 1 C2)                      |
| `PUBLIC_ESTALARA_SDK_ENABLED`, `PUBLIC_ESTALARA_SDK_URL`, `PUBLIC_ESTALARA_API_KEY`, `PUBLIC_ESTALARA_TENANT_ID`, `PUBLIC_ESTALARA_DECISION_URL`, `PUBLIC_ESTALARA_INGEST_URL` | Estalara `web-master` env (not this repo) | the SDK loader tag on app.estalara.com (ESC-020; `docs/runbooks/SDK_PRODUCTION_INTEGRATION.md`) |

`TODO(K7)`: the PM reconciles this table against `.env.example` files and the matrix at the final
SHA (plan K7 "every secret by name consistent with the env files").

## 4. Production steps owed (the list of record)

Each row: what, where, source, and the verification the CTO pastes. Order matters where stated. None
of these is executed by the PM (ESC-085 D-F). Rows are appended by later PRs; nothing is removed, a
done row is marked.

| #   | Step                                                                                                                                                                                                                                                                                                                                                                                                                                                | Source                                                                                                                                            | Verify                                                                                                                                  | Status |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | **SDK embed on app.estalara.com (ESC-020).** Set the `PUBLIC_ESTALARA_*` variables in `web-master`'s environment, deploy `web-master` so the server-rendered `<head>` carries the loader tag with the `data-estalara-slot` hooks, with `data-debug` OFF (plan Phase 5 X4 makes it env-driven).                                                                                                                                                      | `backlog/ESCALATIONS.md` ESC-020; `docs/runbooks/SDK_PRODUCTION_INTEGRATION.md` (hook recipe, env names); MASTER_DESIGN §P.0 "On GO"              | `curl -s https://app.estalara.com/<listing> \| grep -c data-estalara` > 0; no `data-debug="true"`; an `adapt.*` event row in ClickHouse | owed   |
| 2   | **ClickHouse 0022 (`adaptation_decisions.scoring_path`)** applied by the admin user, THEN `SCORING_PATH_COLUMN_ENABLED=true` in Doppler `prd` and a control-plane redeploy.                                                                                                                                                                                                                                                                         | `docs/runbooks/clickhouse-migrations.md` §"Prod Attestation — migration 0022" (operator sequence, steps 1–5)                                      | `DESCRIBE TABLE adaptation_decisions` shows the column; the row-level attestation query in the runbook                                  | owed   |
| 3   | **ClickHouse 0023** — drop `session_summary_mv`, `session_summary`, `session_quality` as its **three DROP statements directly**, NOT via `migrate.sh` (which would also apply gated 0022). Gate: the control plane containing #949 is live first.                                                                                                                                                                                                   | `docs/runbooks/clickhouse-migrations.md` §"0023 on prod" (pre-check on Postgres `dsr_clickhouse_mutations` = 0 first)                             | the three `SHOW TABLES` misses; paste in the FOLLOW-1268 closure note                                                                   | owed   |
| 4   | **ClickHouse 0024 (`events.caller_signed`)**, THEN `CALLER_SIGNED_COLUMN_ENABLED` — **writer first** (the ingest Worker var + deploy), then the readers (Doppler `prd` / Vercel + redeploy). Without it production reports `conversion_source: 'disabled'` and a null lift — intended, not an incident.                                                                                                                                             | `docs/runbooks/clickhouse-migrations.md` §"0024 on prod" (steps 1–7); MASTER_DESIGN §P.0 post-GO list; ESC-084 ruling 3                           | rollup answers `conversion_source: "signed_events"`; attestation query by `type, caller_signed`                                         | owed   |
| 5   | **Modal stops:** `modal app stop estalara-description-generator` (its job was deleted by FOLLOW-1297 PR B #1001) and `modal app stop estalara-schema-validation` (`apps/data-quality` parked by FOLLOW-1298, removed by ESC-085 R2; app deleted from the repo by the FOLLOW-1324 PR).                                                                                                                                                               | `backlog/FOLLOW_UPS.md` FOLLOW-1297 closure note (2026-10-13); `docs/runbooks/DEPLOYMENT_SURFACES.md` register; MASTER_DESIGN §Snapshot.1 row A.1 | `modal app list` shows neither as `deployed`                                                                                            | owed   |
| 6   | **`FEEDBACK_ENDPOINT_ENABLED=true` in Doppler `prd`** (FOLLOW-450's operator leg) — only meaningful once `BANDIT_ENABLED` is on (frozen since #957, D3).                                                                                                                                                                                                                                                                                            | MASTER_DESIGN §P.0 post-GO list; §Snapshot.0 row 4                                                                                                | a pasted real weight delta                                                                                                              | owed   |
| 7   | **`MODAL_CHAT_NLP_URL` on the production ingest Worker** (`wrangler secret put … --env production`) + a traffic proof (a `chat_intent` shadow key populated end to end).                                                                                                                                                                                                                                                                            | MASTER_DESIGN §P.0 post-GO list; FOLLOW-892                                                                                                       | the shadow key in Upstash for a real session                                                                                            | owed   |
| 8   | **Production ingest Worker deploy** — `wrangler deploy --env production` from the final SHA (the Worker never auto-deploys; the live one predates FOLLOW-1201/1203 and the fixed origin list of R11).                                                                                                                                                                                                                                               | `docs/runbooks/INGEST_WORKER_DEPLOY.md`; `docs/runbooks/DEPLOYMENT_SURFACES.md` §The ingest deploy question                                       | `GET /health` → `version_id` equals the deployed one                                                                                    | owed   |
| 9   | **Stripe off:** disable the webhook endpoint in the Stripe dashboard, delete the `STRIPE_*` secrets from Doppler `prd` and Vercel (code removed by plan Phase 2 R9; `tenants.plan` stays).                                                                                                                                                                                                                                                          | ESC-085 ruling D-H                                                                                                                                | no `STRIPE_*` name in `doppler secrets --config prd`; webhook endpoint disabled                                                         | owed   |
| 10  | **DROP `tenant_registrations`** (code removed by FOLLOW-1325) — a Postgres migration owed; the schema file is kept `@deprecated` precisely so that no automatic `db-migrate.yml` run drops it before the CTO decides (migrations auto-apply to prod on push to `main`).                                                                                                                                                                             | ESC-085 ruling D-D (PM decision in the plan); `docs/runbooks/DEPLOYMENT_SURFACES.md` register row "Postgres migrations"                           | table absent; no reader left (grep = 0 in the tree)                                                                                     | owed   |
| 11  | **Supabase Auth redirect-URL allowlist** for password recovery (`/auth/callback`, `/reset-password` added by plan Phase 3 M3) on the production project.                                                                                                                                                                                                                                                                                            | plan Phase 3 M3                                                                                                                                   | a recovery email lands on `admin.estalara.com/reset-password`                                                                           | owed   |
| 12  | **API-key issuance runbook** (`docs/runbooks/API_KEY_ISSUANCE.md`, script `apps/control-plane/scripts/issue-tenant-api-key.mts`, plan Phase 2 R5): the only way to mint/rotate/revoke the SDK key once `api/schema/activate` is gone. The CTO issues the production key with it.                                                                                                                                                                    | [`docs/runbooks/API_KEY_ISSUANCE.md`](../runbooks/API_KEY_ISSUANCE.md) (FOLLOW-1327, plan Phase 2 R5); K2b proof recipe in its §7                 | SDK sends → ingest 2xx with the new key; old key 401                                                                                    | owed   |
| 13  | **DROP `demo_sessions`** — a Postgres migration owed (FOLLOW-1326, removed 2026-10-18). Nothing writes the table any more (`api/demo/sessions*` and `admin/demo-sessions` are deleted); the schema file is kept `@deprecated` so no automatic `db-migrate.yml` run drops it first. Its ONE remaining reader is `lib/demo-session-revocation.ts` (called from `/api/adapt` for a demo JWT that carries `session_id`); remove that reader, then DROP. |

Done rows (kept as record): **2026-10-13 cutover** of description generation to the control plane —
see §5.

`TODO(phase 2–6)`: every PR that removes a surface or flips a flag appends its production residue
here (e.g. the Vercel env removal for deleted routes, the Sentry `TOTAL_SITES` baseline).

## 5. The 2026-10-13 production cutover record and rollback

**What happened (source: `backlog/FOLLOW_UPS.md`, "AMENDMENT to FOLLOW-1297 — 2026-10-13" and the
"CLOSURE NOTE — 2026-10-13" that follows it; ADR-0023 §5).** On the CEO's ruling the two Vercel
production variables `MODAL_DESCRIPTION_URL` and `MODAL_EMBED_SEED_URL` were deleted (~05:15Z). The
cutover landed with the next merge to `main` (#1000, deployment `njlqhvc41`, aliased to
`admin.estalara.com`, `adapt-llm-source-smoke.yml` green on it): description generation and the
embed seed now run in-process in the control plane. PR B #1001 then deleted `apps/llm-gateway`, its
Modal deploy job and the callback route. The previous variable values were not archived (the API
returned none); the Modal web endpoint is in the last `deploy-llm-gateway` workflow log.

**Rollback (two parts, both needed since PR B merged):**

1. `vercel rollback` to deployment **`af5gddgnf`** (`dpl_4dHT7KLkcuJhnQ9D2GrBnKJz6Bim`, #997's
   production build — the last one that carried both variables). This alone is no longer enough: the
   current `main` has no Modal dispatch code.
2. `git revert` of #1001 (PR B) on `main`, then re-create both `MODAL_*` variables in Vercel
   production from the values in the last `deploy-llm-gateway` log, and redeploy the Modal app
   (`estalara-description-generator`) if it was stopped (§4 step 5).

`TODO(K7)`: add the rollback target for the final production deploy (deployment id + SHA) and the
Worker's previous `version_id`.

## 6. Real-app gaps and the patch set

The real application (`~/Projects/Estalara-gitlab-2026-08-17`: `core-master`, `web-master`; a local
checkout without git) today does NOT: emit the signed conversions (`live.signup`,
`inquiry.completed`), call `/api/webhooks/listing-updated` on listing save, or carry the `cta` /
`feature` slot hooks on the listing page; `data-debug` is hard-coded `true`. Plan Phase 5 X1–X4
fixes these and delivers them as **reviewable patches + README** in
`docs/handover/estalara-app-patches/` (after a `tar` snapshot of the directory), so the CTO applies
a diff, not a modified tree.

`TODO(phase 5)`: list each patch file, what it touches, and the HMAC test vector shared with the
control-plane verifier (X1).

## 7. Known limits and open risks (what localhost does NOT prove)

- **The lift value.** Harness arms are synthetic and the holdout is ~10 % by construction, so
  `ctaLift` on the fixture is non-positive by design; N3 batch sessions are scripted. K5/K7 prove
  the pipeline counts the right two events (ESC-085 D-J) with the right formula
  (`lib/pilot-stats.ts`), not that adaptation sells. The real "by how much %" appears only in
  production after ≥ 30 real sessions per arm (`MIN_SAMPLE_PER_ARM`) — a CTO-side reading.
- **Production lift reads `disabled`** until §4 step 4 (0024 + flag) and a signed producer (§6, X1)
  exist. A browser-emitted conversion is accepted, reported unsigned, never counted (ESC-084).
- **Stand-ins.** `:8081` (fixture listing details + signed emitter) and `:8078` (Redis REST path
  adapter) replace production services on localhost; neither is production evidence.
- **No production `source='description'` row exists** yet (FOLLOW-1297 K2 item); the ADR-0023 §8 p95
  gate has no baseline until the first real description request.
- **Bandit frozen** (`BANDIT_ENABLED` off since #957, D3; inert on LLM branches, FOLLOW-1168).
- **Returning-visitor profile** (FOLLOW-1316, D-E) ships with its consent/DPIA review; until then
  `__estalara_xid__` is minted and transmitted nowhere.
- **Local `next build`** fails on two React copies in the local `node_modules` (plan Phase 3 M4);
  Vercel builds correctly. A clean-install build at the final SHA is a K7 STOP condition.

`TODO(K7)`: the one-page "what is proven / what is not" the CEO reads at K7, linked here.

## 8. Localhost proof recipe

- **Bring-up:** `scripts/dev/localhost-up.sh` (real control plane via `doppler run -c dev`, PG,
  ClickHouse, ingest Worker, fixture `:5173`/`:8081`, SRH Redis + `:8078` adapter); teardown
  `scripts/dev/localhost-down.sh`. Switching to the real app: `.al-local/al-real-up.sh` /
  `al-real-down.sh --restore-fixture` (ports collide; one substrate at a time; ~4.9 GB RAM).
- **Harness series:** `node tests/e2e/follow-819/differentiator-e2e.mjs` three times on one
  un-restarted control plane; each run's `TALLY … run=GREEN` and `[FRESH]` line
  (`--check-staleness runN.json`) pasted into `tests/e2e/follow-819/README.md` §5. Latest of record:
  §5.24 at `e8d1a04d` (MASTER_DESIGN §Snapshot.0).
- **Real-app acceptance:** `scripts/dev/local-pilot-session.mjs` today (hops 1/4/5/10), replaced
  from K4 by `scripts/dev/real-app-acceptance.mjs` (N3; from K5 with `--arms N`).
- **Backoffice:** N2 `tests/e2e/backoffice/admin-smoke.spec.ts` + `admin-nav-reachability.test.ts`
  (from K1).

`TODO(K7)`: links to the final evidence (README §5.x record at the final SHA, N3 ×3, N2, clean build
exit 0, `docs/checkpoints/K7.md`).

## 9. Post-deploy checks for the CTO — the four production canaries

Run on `workflow_dispatch` after each production step, then let the schedules run; all four green =
the deploy is live and talking to its stores.

| Workflow name (`.github/workflows/`)                     | File                            | What it proves                                                                         |
| -------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------- |
| `Adapt LLM-source canary (FOLLOW-1022)`                  | `adapt-llm-source-smoke.yml`    | `/api/adapt` on production answers an LLM-sourced directive (not template fallback)    |
| `K.3.6 D-1 Intent Weights Live Smoke (FOLLOW-293)`       | `intent-weights-live-smoke.yml` | the admin intent-weights API reads live rows on production                             |
| `Redis shadow round-trip smoke (FOLLOW-368, FOLLOW-752)` | `redis-shadow-smoke.yml`        | the Upstash shadow key round-trips through the production control plane                |
| `Cron Heartbeat (FOLLOW-893)`                            | `cron-heartbeat.yml`            | the scheduled Modal job (intent-engine since PR B) wrote a heartbeat within the window |

Plus, after §4 step 4: `GET /api/admin/analytics/rollup` with the Bearer answers
`conversion_source: "signed_events"`; after step 8: the Worker `GET /health` `version_id`.

`TODO(K7)`: confirm the four names against `.github/workflows/*.yml` at the final SHA (a renamed
workflow invalidates this table).
