# Doppler Secrets Matrix — Phase 1 Activation Checklist

All env vars that must be set in Doppler before Phase 1 can activate. Generated from
RUNTIME_READINESS_AUDIT.md blockers B1, B8, and H2.

Canonical domain: **estalara.com** (per DECISIONS_2026-05-18_v2). See
`packages/shared/src/domains.ts` for exported constants.

## Legend

- **Secret** — API key, JWT, password, token. Treat as credential. Never commit.
- **Config** — URL, flag, non-sensitive setting. Safe to commit value to Doppler as plain text.
- **Injected by CI** — set automatically from git/build system; do not set manually in Doppler.

---

## apps/ingest (Cloudflare Worker)

| Env Var                 | App    | Type   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | ingest | Secret | Worker deploy token (formerly also the removed decision-api)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `CLOUDFLARE_ACCOUNT_ID` | ingest | Config | Same value for all Workers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `CLOUDFLARE_ZONE_ID`    | ingest | Config | Zone ID for **estalara.com**. NOT read by the ingest Worker or by `wrangler` — `wrangler.toml` binds routes with `zone_name`, not a zone id. Its only consumer in this repo is Terraform (`infra/terraform/cloudflare/variables.tf`, fed as `TF_VAR_cloudflare_zone_id`), which has never been applied. Absent from Doppler `prd`/`stg` as of 2026-08-04 and that blocks nothing.                                                                                                                                                                                                                                                                        |
| `REDPANDA_REST_URL`     | ingest | Config | Pandaproxy REST URL (e.g. `https://pandaproxy.redpanda.cloud:30082`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `REDPANDA_TOPIC_EVENTS` | ingest | Config | `estalara.events` (prod). `apps/ingest/wrangler.toml` `[env.staging]` also sets `events-staging`, but that Worker is a bundle/upload smoke with no bindings and no DNS record — no topic by that name is produced to (FOLLOW-878 / ESC-052)                                                                                                                                                                                                                                                                                                                                                                                                              |
| `SENTRY_DSN_INGEST`     | ingest | Secret | Set via `wrangler secret put SENTRY_DSN_INGEST`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `OTEL_EXPORTER_HEADERS` | ingest | Secret | Grafana Cloud OTLP auth header; set via `wrangler secret put`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `OTEL_EXPORTER_URL`     | ingest | Config | Grafana Cloud OTLP endpoint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `KV_API_KEYS_ID`        | ingest | Config | Substitute into `wrangler.toml` before deploy; not a runtime secret                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `KV_IDEMPOTENCY_ID`     | ingest | Config | Same — substitute into `wrangler.toml`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `FIRST_PARTY_TENANT_ID` | ingest | Config | FOLLOW-658. UUID of Estalara's own tenant; SAME value as the control-plane var. Set via `wrangler secret put` (settable without a redeploy). Enables the origin-gate provisioning guard: a non-first-party tenant whose api-key KV record has no `allowed_origins` gets 403 `origin_policy_unconfigured` instead of silently inheriting Estalara's allow-list. UNSET or MALFORMED (not a well-formed UUID — FOLLOW-678) = guard off (prior behavior), never a traffic outage. A WRONG-but-well-formed value is **NOT** safe — it 403s all first-party browser traffic; run BRAND_PROVISIONING.md §Step 0's post-flip verification POST after setting it. |

---

## apps/decision-api (Cloudflare Worker) — REMOVED 2026-09-24 (FOLLOW-1262)

> The Worker was deleted from the repo (410 Gone since ADR-0006). The rows below are kept only so an
> operator can find and delete the matching Doppler/Wrangler secrets; nothing reads them.

| Env Var                     | App          | Type   | Notes                                                                                               |
| --------------------------- | ------------ | ------ | --------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`      | decision-api | Secret | Shared with ingest                                                                                  |
| `CLOUDFLARE_ACCOUNT_ID`     | decision-api | Config | Shared with ingest                                                                                  |
| `CLOUDFLARE_ZONE_ID`        | decision-api | Config | Not read by this Worker either — see the ingest row; Terraform-only, never applied                  |
| `ADAPT_API_KEY`             | decision-api | Secret | Bearer token gating `/api/adapt`; set via `wrangler secret put`                                     |
| `ESTALARA_DECISION_API_URL` | decision-api | Config | `https://decision.estalara.com` (doc previously misstated `api.estalara.com`; Worker retired → 410) |
| `SCHEMA_API_URL`            | decision-api | Config | `https://admin.estalara.com/api/internal/schema`                                                    |
| `SCHEMA_API_TOKEN`          | decision-api | Secret | Bearer token for control-plane internal schema API                                                  |
| `REDPANDA_REST_URL`         | decision-api | Config | Same Pandaproxy as ingest                                                                           |
| `REDPANDA_TOPIC_EVENTS`     | decision-api | Config | `estalara.events`                                                                                   |
| `UPSTASH_REDIS_URL`         | decision-api | Config | Phase 2 — leave blank in Phase 1                                                                    |
| `UPSTASH_REDIS_TOKEN`       | decision-api | Secret | Phase 2 — leave blank in Phase 1                                                                    |

---

## apps/control-plane (Next.js on Vercel)

| Env Var                                | App           | Type           | Notes                                                                                                                                                                                                                   |
| -------------------------------------- | ------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_CONTROL_PLANE_URL`        | control-plane | Config         | `https://admin.estalara.com`                                                                                                                                                                                            |
| `NEXT_PUBLIC_SDK_CDN_URL`              | control-plane | Config         | `https://cdn.estalara.com`                                                                                                                                                                                              |
| `ESTALARA_INGEST_URL`                  | control-plane | Config         | `https://ingest.estalara.com`                                                                                                                                                                                           |
| `ESTALARA_DECISION_API_URL`            | control-plane | Config         | OBSOLETE (FOLLOW-1262): no reader; delete from Doppler. Was `https://decision.estalara.com`                                                                                                                             |
| `ESTALARA_BACKEND_URL`                 | control-plane | Config         | `https://api.app.estalara.com` — Estalara-app Spring backend (listing details / grounding). Renamed from `api.estalara.com` ~2026-06-30 (FOLLOW-568); must ALSO exist in Vercel prod env (was missing until 2026-07-11) |
| `NEXT_PUBLIC_SUPABASE_URL`             | control-plane | Config         | `https://<ref>.supabase.co`                                                                                                                                                                                             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`        | control-plane | Secret         | Public anon key                                                                                                                                                                                                         |
| `SUPABASE_SERVICE_ROLE_KEY`            | control-plane | Secret         | Server-only; never expose to browser                                                                                                                                                                                    |
| `DATABASE_URL`                         | control-plane | Secret         | Postgres connection string (via pgBouncer)                                                                                                                                                                              |
| `DATABASE_URL_ADMIN`                   | control-plane | Secret         | Admin role; used by migration scripts                                                                                                                                                                                   |
| `DATABASE_URL_DIRECT`                  | control-plane | Secret         | Direct Postgres; bypasses pgBouncer                                                                                                                                                                                     |
| `JWT_SECRET`                           | control-plane | Secret         | Supabase JWT signing secret                                                                                                                                                                                             |
| `API_KEY_HMAC_SECRET`                  | control-plane | Secret         | HMAC secret for tenant API key generation                                                                                                                                                                               |
| `ADMIN_API_SECRET`                     | control-plane | Secret         | Internal admin-only API secret                                                                                                                                                                                          |
| `DEMO_MODE_JWT_SECRET`                 | control-plane | Secret         | **No fallback in prod** — must be set (see B12)                                                                                                                                                                         |
| `SENTRY_DSN_CONTROL_PLANE`             | control-plane | Secret         | Per-project Sentry DSN                                                                                                                                                                                                  |
| `NEXT_PUBLIC_SENTRY_DSN_CONTROL_PLANE` | control-plane | Secret         | Browser-exposed Sentry DSN                                                                                                                                                                                              |
| `SENTRY_AUTH_TOKEN`                    | control-plane | Secret         | Sentry source-map upload                                                                                                                                                                                                |
| `SENTRY_ORG`                           | control-plane | Config         | Sentry organisation slug                                                                                                                                                                                                |
| `SENTRY_PROJECT`                       | control-plane | Config         | Sentry project slug                                                                                                                                                                                                     |
| `RESEND_API_KEY`                       | control-plane | Secret         | Email delivery via Resend                                                                                                                                                                                               |
| `STRIPE_SECRET_KEY`                    | control-plane | Secret         | Stripe server-side key                                                                                                                                                                                                  |
| `STRIPE_WEBHOOK_SECRET`                | control-plane | Secret         | Stripe webhook HMAC                                                                                                                                                                                                     |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`   | control-plane | Config         | Stripe publishable key                                                                                                                                                                                                  |
| `STRIPE_PRICE_OBSERVER`                | control-plane | Config         | Stripe price ID — Observer tier                                                                                                                                                                                         |
| `STRIPE_PRICE_AUGMENT`                 | control-plane | Config         | Stripe price ID — Augment tier                                                                                                                                                                                          |
| `STRIPE_PRICE_NATIVE`                  | control-plane | Config         | Stripe price ID — Native tier                                                                                                                                                                                           |
| `LISTING_UPDATED_WEBHOOK_SECRET`       | control-plane | Secret         | Listing-updated webhook HMAC                                                                                                                                                                                            |
| `ADAPT_API_KEY`                        | control-plane | Secret         | Bearer token for internal /api/adapt calls                                                                                                                                                                              |
| `SCHEMA_API_TOKEN`                     | control-plane | Secret         | Bearer token for /api/internal/schema                                                                                                                                                                                   |
| `ANTHROPIC_API_KEY`                    | control-plane | Secret         | Claude API key                                                                                                                                                                                                          |
| `OPENAI_API_KEY`                       | control-plane | Secret         | OpenAI API key                                                                                                                                                                                                          |
| `CLICKHOUSE_URL`                       | control-plane | Config         | Phase 2 — ClickHouse endpoint                                                                                                                                                                                           |
| `CLICKHOUSE_PASSWORD`                  | control-plane | Secret         | Phase 2                                                                                                                                                                                                                 |
| `REDPANDA_REST_URL`                    | control-plane | Config         | Phase 2 — Pandaproxy                                                                                                                                                                                                    |
| `REDPANDA_REST_USERNAME`               | control-plane | Config         | Phase 2                                                                                                                                                                                                                 |
| `REDPANDA_REST_PASSWORD`               | control-plane | Secret         | Phase 2                                                                                                                                                                                                                 |
| `REDPANDA_TOPIC_EVENTS`                | control-plane | Config         | Phase 2                                                                                                                                                                                                                 |
| `REDPANDA_TOPIC_DESCRIPTIONS`          | control-plane | Config         | Phase 2                                                                                                                                                                                                                 |
| `UPSTASH_REDIS_URL`                    | control-plane | Config         | Phase 2                                                                                                                                                                                                                 |
| `UPSTASH_REDIS_TOKEN`                  | control-plane | Secret         | Phase 2                                                                                                                                                                                                                 |
| `GIT_SHA`                              | control-plane | Injected by CI | Set by GitHub Actions                                                                                                                                                                                                   |
| `NEXT_PUBLIC_GIT_SHA`                  | control-plane | Injected by CI | Set by GitHub Actions                                                                                                                                                                                                   |
| `NODE_ENV`                             | control-plane | Config         | `production` in prod                                                                                                                                                                                                    |

---

## CI / shared

| Env Var                | Where          | Type   | Notes                                             |
| ---------------------- | -------------- | ------ | ------------------------------------------------- |
| `TURBO_TOKEN`          | GitHub Actions | Secret | Vercel Turborepo remote cache token               |
| `TURBO_TEAM`           | GitHub Actions | Config | Vercel team slug                                  |
| `CLOUDFLARE_API_TOKEN` | GitHub Actions | Secret | Used by `wrangler-action` in `deploy-staging.yml` |
| `DOPPLER_TOKEN`        | GitHub Actions | Secret | Doppler service token per environment             |

---

## Phase 1 minimum set (must be configured before activation)

These 20 vars are the minimum to boot Phase 1 (CF Worker + Supabase + Vercel + Doppler + DNS). Phase
2 vars (ClickHouse, Redpanda, Upstash, Modal) can remain blank.

1. `CLOUDFLARE_API_TOKEN`
2. `CLOUDFLARE_ACCOUNT_ID`
3. ~~`CLOUDFLARE_ZONE_ID`~~ — **not actually required for activation.** Both Workers have been
   serving production traffic without it present in Doppler `prd`/`stg` (verified 2026-08-04:
   `https://ingest.estalara.com/health` and `https://decision.estalara.com/api/health` both 200).
   Needed only if `infra/terraform/cloudflare/` is ever applied. Left in place, struck through,
   rather than deleted, so the "20 vars" count below and any external checklist keyed to this
   numbering do not silently shift.
4. `ADAPT_API_KEY`
5. `SENTRY_DSN_INGEST`
6. `OTEL_EXPORTER_HEADERS`
7. `NEXT_PUBLIC_SUPABASE_URL`
8. `NEXT_PUBLIC_SUPABASE_ANON_KEY`
9. `SUPABASE_SERVICE_ROLE_KEY`
10. `DATABASE_URL`
11. `JWT_SECRET`
12. `API_KEY_HMAC_SECRET`
13. `DEMO_MODE_JWT_SECRET`
14. `RESEND_API_KEY`
15. `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
16. `NEXT_PUBLIC_CONTROL_PLANE_URL` = `https://admin.estalara.com`
17. `ESTALARA_INGEST_URL` = `https://ingest.estalara.com`
18. `ESTALARA_DECISION_API_URL` = `https://decision.estalara.com` — **obsolete since 2026-09-24
    (FOLLOW-1262):** nothing reads it any more; delete from Doppler
19. `ESTALARA_BACKEND_URL` = `https://api.app.estalara.com` (renamed from `api.estalara.com`,
    FOLLOW-568; mirror into Vercel prod env)
20. `SCHEMA_API_TOKEN`
21. `TURBO_TOKEN` + `TURBO_TEAM` (CI only)
