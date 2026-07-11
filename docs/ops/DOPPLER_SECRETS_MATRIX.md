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

| Env Var                 | App    | Type   | Notes                                                                |
| ----------------------- | ------ | ------ | -------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | ingest | Secret | Worker deploy token; also used by decision-api                       |
| `CLOUDFLARE_ACCOUNT_ID` | ingest | Config | Same value for all Workers                                           |
| `CLOUDFLARE_ZONE_ID`    | ingest | Config | Zone ID for **estalara.com**                                         |
| `REDPANDA_REST_URL`     | ingest | Config | Pandaproxy REST URL (e.g. `https://pandaproxy.redpanda.cloud:30082`) |
| `REDPANDA_TOPIC_EVENTS` | ingest | Config | `estalara.events` (prod) / `estalara.events-staging` (staging)       |
| `SENTRY_DSN_INGEST`     | ingest | Secret | Set via `wrangler secret put SENTRY_DSN_INGEST`                      |
| `OTEL_EXPORTER_HEADERS` | ingest | Secret | Grafana Cloud OTLP auth header; set via `wrangler secret put`        |
| `OTEL_EXPORTER_URL`     | ingest | Config | Grafana Cloud OTLP endpoint                                          |
| `KV_API_KEYS_ID`        | ingest | Config | Substitute into `wrangler.toml` before deploy; not a runtime secret  |
| `KV_IDEMPOTENCY_ID`     | ingest | Config | Same — substitute into `wrangler.toml`                               |

---

## apps/decision-api (Cloudflare Worker)

| Env Var                     | App          | Type   | Notes                                                                                               |
| --------------------------- | ------------ | ------ | --------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`      | decision-api | Secret | Shared with ingest                                                                                  |
| `CLOUDFLARE_ACCOUNT_ID`     | decision-api | Config | Shared with ingest                                                                                  |
| `CLOUDFLARE_ZONE_ID`        | decision-api | Config | Shared with ingest                                                                                  |
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
| `ESTALARA_DECISION_API_URL`            | control-plane | Config         | `https://decision.estalara.com` (doc previously misstated `api.estalara.com`)                                                                                                                                           |
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
3. `CLOUDFLARE_ZONE_ID` (for `estalara.com`)
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
18. `ESTALARA_DECISION_API_URL` = `https://decision.estalara.com`
19. `ESTALARA_BACKEND_URL` = `https://api.app.estalara.com` (renamed from `api.estalara.com`,
    FOLLOW-568; mirror into Vercel prod env)
20. `SCHEMA_API_TOKEN`
21. `TURBO_TOKEN` + `TURBO_TEAM` (CI only)
