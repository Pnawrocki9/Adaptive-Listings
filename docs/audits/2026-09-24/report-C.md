# Report C — data + ML pipeline over-engineering audit (2026-09-24, HEAD `9723ec10`)

Read-only; nothing edited. Auditor: general-purpose subagent (Opus). Scope: `apps/ingest`,
`apps/stream-consumer`, `apps/intent-engine`, `apps/llm-gateway`, `apps/data-quality`,
`apps/decision-api`, `packages/db`, `packages/shared`, `infra/`, `.github/workflows`. Synthesis in
`docs/AUDIT-2026-09-24.md`.

**Main finding:** the designed pipeline is mostly history. Redpanda and stream-consumer are already
out of the runtime. ADR-0016, ADR-0022 and ESC-017 retired them, but the code, infra and docs are
still in the repo.

## 1. Actual event path

- **Events:** SDK → ingest Worker (`apps/ingest/src/handlers/events.ts`). Hops: auth via the
  `KV_API_KEYS` and `KV_IDEMPOTENCY` stores (`:139`); Durable Object `RateLimiter`, used only for
  per-tenant rate limiting (`:328`, `wrangler.toml:54`); a direct HTTP insert into ClickHouse
  `events` (`pushToClickHouse`, `:649`) in `waitUntil` after the ACK; on terminal failure a
  Cloudflare Queue `estalara-events-retry` plus a dead-letter queue (`:713-725`,
  `wrangler.toml:74-90`). **There is no Redpanda hop.** `events.ts:599-605` says the Pandaproxy push
  is "GONE" (ADR-0022 stage C).
- **`intent.snapshot`** is dual-written from ingest: ClickHouse `intent_events` plus Postgres
  `intent_sessions` via PostgREST (`handlers/intent-snapshot.ts`).
- **Chat:** ingest `dispatchChatNlp` (`events.ts:567`) POSTs to the Modal `chat_nlp_endpoint`
  (`intent-engine/src/main.py:127`). That runs Haiku (`nlp.py:61`), then
  `redis_writer.write_shadow_intent` writes to Upstash. `/api/adapt` reads it through
  `readShadowChatIntent` (`route.ts:2178`).
- So ingest already writes ClickHouse directly and calls intent-engine directly. Removing the
  leftovers loses nothing, because the bus "cannot work at all today" (ADR-0022 table). Left to
  remove: `apps/stream-consumer` (2,198 lines, never deployed, `modal-deploy.yml:13`, still in the
  CI test matrix `ci.yml:220`); the Redpanda pollers left "for reference" in
  `generate_description.py:2199-2324` and `consume_embed_seed_requests.py:149-346`; the Kafka
  producer in data-quality (`schema_validation.py:101,521-556`); `infra/terraform/redpanda`.

## 2. The two llm-gateways are complementary, not duplicates

- **TypeScript, `lib/llm-gateway.ts` (1,696 lines):** serves `POST /api/adapt`, producing the
  headline/feature directives with Haiku.
- **Python, `generate_description.py` (2,391 lines):** the long-form description job (Sonnet). The
  control plane only reads caches and dispatches to it:
  `/api/adapt/description/route.ts:110-113,476` returns the template immediately and fires the Modal
  job in `afterResponse`. The SDK calls it at `packages/sdk/src/core/adapt-description.ts:330`. This
  path is **live**; MASTER_DESIGN A.1 says it is deployed in prod as
  `estalara-description-generator`.
- The embed-seed path is also live: `seed-listing-embeddings.ts` → `MODAL_EMBED_SEED_URL` → Modal →
  `/api/listings/embed` → `listing_embeddings`, read by `embedding-lookup` in `/api/adapt`
  (`route.ts:74`).
- **Real duplication is in the grounding and fact-check logic,** which exists in both languages.
  `llm-gateway.ts:898-931` is ported from `_check_headline_facts`, `_canon_number` and
  `_stem_loose`. So there are two LLM stacks and two spend caps, one reading `llm_calls` from each
  side (`llm-gateway.ts:490`, `generate_description.py:310`).

## 3. data-quality and decision-api

- **data-quality** (874-line cron): writes `schema_validation_history` and `cron_heartbeats` and
  sends Sentry alerts. Only it reads `schema_validation_history` (its own 24-hour dedup). No
  control-plane reader. Only useful if `tenant_site_schemas` rows exist for the one tenant.
- **decision-api:** `domains.ts:30` marks it **@deprecated**, with removal "in FOLLOW-107 (Sprint
  14)", which has not happened. The SDK's `decisionApiUrl` is just a config name that points at the
  control plane. The only deploy is the manual `deploy-staging.yml:69`, to a hostname with no DNS.
  It still carries its own copy of `bandit.ts` (166 lines). Total 2,634 lines. **Nothing live calls
  it.** Live Cloudflare routing was not checked (unverified).

## 4. Table usage (grep of non-test source)

**Postgres.** Written and read: `api_keys`, `tenants`, `users`, `app_config`, `demo_*`,
`quiz_definitions`, `quiz_completions`, `intent_sessions`, `intent_weight_configs`,
`conversion_labels`, `description_cache_persistent`, `listing_embeddings`, `archetype_embeddings`,
`tenant_site_schemas`, `staff_audit_log`, `consent_records`, `dsr_*`, `tenant_registrations`,
`ab_bandit_weights`. Read or erased but never written: `engagement_scores` (only the DSR routes
touch it; migration 0021 says "computed by the Modal intent engine", but no such writer exists),
`session_embeddings` (DSR routes only). Only the cron itself reads them:
`schema_validation_history`, `cron_heartbeats`. Unused: `tenant_compliance_records` (0 references).

**ClickHouse.** Written and read: `events`, `adaptation_decisions`, `llm_calls`, `intent_events`,
`dsr_audit_log`. Write-only audit: `description_generations`. No reader: the `session_summary` view
(migration 0002). No writer: `session_quality`, which `consent-gate.ts:56` itself calls a "phantom
write-path".

## 5. Bandit and holdout are not the learning loop

- The arm is sampled (`route.ts:1352,2025`), but it only chooses among `variants.en` of a playbook
  slot (`:398`). Today only `headline` has variants (`:380-384`), and headline is withheld on the
  template branches (§E.7.0, `:430-458`). `callLlmGateway` is never passed the variant (`:562-574`),
  so on the LLM branches it has no effect. **So Thompson sampling changes nothing a buyer sees.**
  `variant_suppressed` exists precisely to stop crediting it. This matches RETRO-317.
- The feedback endpoint is gated off unless `FEEDBACK_ENDPOINT_ENABLED` is set
  (`feedback/route.ts:13`); the live flag was not checked. MASTER_DESIGN E.1-3 says the weights sit
  at their starting values (Beta(1,1)). `/api/ab/weights` feeds only a dashboard panel
  (`dashboard/analytics/page.tsx:670`).
- **Holdout does have an effect:** holdout sessions get the control copy and are logged with
  `holdout_group`/`holdout_pct`. Whether that effect is measured is unverified here.
- **There is no closed learning loop anywhere.** `conversion_labels` are collected and exported; the
  "lora-tenant-\*" models that `/api/pilot/calibration` refers to have no training code in the repo.
  `intent_weight_configs` are set by hand in the admin panel. The intent-engine 6-hour Sonnet
  `batch_enrich` cron runs over a stub reader that returns `[]` (`clickhouse_reader.py:28`), so it
  processes 0 sessions.

## 6. Infra and workflows

- **Terraform:** effectively unused. Every resource in clickhouse, supabase, redpanda and upstash is
  commented out, and all of them are EU `eu-central-1` only. Only Cloudflare DNS and R2 are active,
  and that includes a DNS record for `decision_api`. No workflow runs terraform. Multi-region shows
  up only as a label, `region.ts`'s `mapCountryToRegion`, stored on events. There is one EU project.
- **Workflows that deploy live things:** `modal-deploy.yml` (three Modal apps on push to main),
  `db-migrate.yml` (Postgres migrations applied to prod), `post-migrate-seed.yml`. The control plane
  deploys through Vercel's git integration. No workflow deploys the ingest Worker to prod, so it is
  presumably manual (unverified).
- **Smoke and cron workflows:** adapt-llm-source-smoke, cron-heartbeat, intent-weights-live-smoke,
  redis-shadow-smoke, e2e-smoke, demo-integration. **Manual only:** deploy-staging (upload smoke
  only), load-test, release, seed-archetypes. **Gate:** ci.yml.

## 7. Ranked simplifications

| #   | Change                                                                                                                                                        | Removes                                      | Risk to core goal                           | Blocker                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------- |
| 1   | Delete `apps/stream-consumer` and drop it from CI                                                                                                             | ~2.2k lines, 1 app                           | None                                        | e2e-smoke still references its services in comments             |
| 2   | Retire `apps/decision-api` and its DNS record, and stop deploy-staging deploying it                                                                           | ~2.6k lines, 1 app, 1 duplicate bandit       | None if nothing live routes to it           | Check Cloudflare routes (FOLLOW-107)                            |
| 3   | Delete the Redpanda pollers, data-quality's Kafka producer and `terraform/redpanda`                                                                           | ~450 lines, the confluent-kafka dependency   | None                                        | —                                                               |
| 4   | Delete the no-op `batch_enrich` cron and its stub reader                                                                                                      | ~110 lines, 1 cron                           | None                                        | —                                                               |
| 5   | Drop the phantom tables (`session_quality`, `session_summary`, `engagement_scores`, `session_embeddings`, `tenant_compliance_records`) or build their writers | 5 tables plus DSR branches                   | Low                                         | DPIA/ROPA cite `engagement_scores` (compliance sign-off needed) |
| 6   | Freeze the bandit: serve control and hide the arm UI until FOLLOW-1164 adds variants that survive the §E.7.0 withhold                                         | ~1.6k lines paused, 3 routes                 | None today                                  | CEO; the Master Design treats it as a feature                   |
| 7   | Put description generation into the TypeScript control plane, or move headline fact-checking into one shared module                                           | One of two grounding checkers, one Modal app | Medium: this is the anti-hallucination path | Needs async generation on Vercel (`after()`) and parity tests   |
| 8   | Delete the commented-out Terraform, or state plainly that infra is hand-provisioned                                                                           | ~400 lines                                   | None                                        | —                                                               |
| 9   | Pick one description cache instead of Redis plus Postgres                                                                                                     | One cache layer                              | Low                                         | Load test                                                       |
| 10  | Defer the data-quality cron until there are several tenants                                                                                                   | 1 Modal app                                  | Low                                         | Needs a CEO decision (built to the B.6 design)                  |

**Must stay:** ingest → ClickHouse `events`, plus the retry queue; the chat → intent-engine → Redis
→ `/api/adapt` path; `llm-gateway.ts` and its grounding rule; the description Modal endpoint, until
item 7 is done; `adaptation_decisions`, `llm_calls` (the spend cap reads it), `conversion_labels`,
`intent_*`, `quiz_*`; the embeddings tables; the DSR and consent tables; the holdout assignment, if
lift will ever be measured.
