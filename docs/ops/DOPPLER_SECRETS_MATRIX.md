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

| Env Var                 | App    | Type   | Notes                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------- | ------ | ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | ingest | Secret | Worker deploy token                                                                                                                                                                                                                                                                                                                                                               |
| `CLOUDFLARE_ACCOUNT_ID` | ingest | Config | Same value for all Workers                                                                                                                                                                                                                                                                                                                                                        |
| `CLOUDFLARE_ZONE_ID`    | ingest | Config | Zone ID for **estalara.com**. NOT read by the ingest Worker or by `wrangler` — `wrangler.toml` binds routes with `zone_name`, not a zone id. Its only consumer in this repo is Terraform (`infra/terraform/cloudflare/variables.tf`, fed as `TF_VAR_cloudflare_zone_id`), which has never been applied. Absent from Doppler `prd`/`stg` as of 2026-08-04 and that blocks nothing. |
| `SENTRY_DSN_INGEST`     | ingest | Secret | Set via `wrangler secret put SENTRY_DSN_INGEST`                                                                                                                                                                                                                                                                                                                                   |
| `OTEL_EXPORTER_HEADERS` | ingest | Secret | Grafana Cloud OTLP auth header; set via `wrangler secret put`                                                                                                                                                                                                                                                                                                                     |
| `OTEL_EXPORTER_URL`     | ingest | Config | Grafana Cloud OTLP endpoint                                                                                                                                                                                                                                                                                                                                                       |

---

## apps/control-plane (Next.js on Vercel)

| Env Var                                | App           | Type           | Notes                                                                                                                                                                                                                   |
| -------------------------------------- | ------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_CONTROL_PLANE_URL`        | control-plane | Config         | `https://admin.estalara.com`                                                                                                                                                                                            |
| `NEXT_PUBLIC_SDK_CDN_URL`              | control-plane | Config         | `https://cdn.estalara.com`                                                                                                                                                                                              |
| `ESTALARA_INGEST_URL`                  | control-plane | Config         | `https://ingest.estalara.com`                                                                                                                                                                                           |
| `ESTALARA_BACKEND_URL`                 | control-plane | Config         | `https://api.app.estalara.com` — Estalara-app Spring backend (listing details / grounding). Renamed from `api.estalara.com` ~2026-06-30 (FOLLOW-568); must ALSO exist in Vercel prod env (was missing until 2026-07-11) |
| `NEXT_PUBLIC_SUPABASE_URL`             | control-plane | Config         | `https://<ref>.supabase.co`                                                                                                                                                                                             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`        | control-plane | Secret         | Public anon key                                                                                                                                                                                                         |
| `SUPABASE_SERVICE_ROLE_KEY`            | control-plane | Secret         | Server-only; never expose to browser                                                                                                                                                                                    |
| `DATABASE_URL`                         | control-plane | Secret         | Postgres connection string (via pgBouncer)                                                                                                                                                                              |
| `DATABASE_URL_ADMIN`                   | control-plane | Secret         | Admin role; used by migration scripts                                                                                                                                                                                   |
| `DATABASE_URL_DIRECT`                  | control-plane | Secret         | Direct Postgres; bypasses pgBouncer                                                                                                                                                                                     |
| `ADMIN_API_SECRET`                     | control-plane | Secret         | Internal admin-only API secret                                                                                                                                                                                          |
| `DEMO_MODE_JWT_SECRET`                 | control-plane | Secret         | **No fallback in prod** — must be set (see B12)                                                                                                                                                                         |
| `SENTRY_DSN_CONTROL_PLANE`             | control-plane | Secret         | Per-project Sentry DSN                                                                                                                                                                                                  |
| `NEXT_PUBLIC_SENTRY_DSN_CONTROL_PLANE` | control-plane | Secret         | Browser-exposed Sentry DSN                                                                                                                                                                                              |
| `SENTRY_AUTH_TOKEN`                    | control-plane | Secret         | Sentry source-map upload                                                                                                                                                                                                |
| `SENTRY_ORG`                           | control-plane | Config         | Sentry organisation slug                                                                                                                                                                                                |
| `SENTRY_PROJECT`                       | control-plane | Config         | Sentry project slug                                                                                                                                                                                                     |
| `RESEND_API_KEY`                       | control-plane | Secret         | Email delivery via Resend                                                                                                                                                                                               |
| `LISTING_UPDATED_WEBHOOK_SECRET`       | control-plane | Secret         | Listing-updated webhook HMAC                                                                                                                                                                                            |
| `ADAPT_API_KEY`                        | control-plane | Secret         | Bearer token for internal /api/adapt calls                                                                                                                                                                              |
| `ANTHROPIC_API_KEY`                    | control-plane | Secret         | Claude API key                                                                                                                                                                                                          |
| `OPENAI_API_KEY`                       | control-plane | Secret         | OpenAI API key                                                                                                                                                                                                          |
| `CLICKHOUSE_URL`                       | control-plane | Config         | ClickHouse Cloud endpoint (analytics and DSR reads)                                                                                                                                                                     |
| `CLICKHOUSE_PASSWORD`                  | control-plane | Secret         | ClickHouse password                                                                                                                                                                                                     |
| `UPSTASH_REDIS_URL`                    | control-plane | Config         | Upstash REST URL (caches)                                                                                                                                                                                               |
| `UPSTASH_REDIS_TOKEN`                  | control-plane | Secret         | Upstash REST token (caches)                                                                                                                                                                                             |
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

These vars are the minimum to boot Phase 1 (CF Worker + Supabase + Vercel + Doppler + DNS). Vars
outside this list (ClickHouse, Upstash, Modal) can remain blank to boot. Names that nothing reads
any more are not listed; secrets to delete from production are tracked in
`docs/handover/CTO_HANDOVER.md`.

1. `CLOUDFLARE_API_TOKEN`
2. `CLOUDFLARE_ACCOUNT_ID`
3. `ADAPT_API_KEY`
4. `SENTRY_DSN_INGEST`
5. `OTEL_EXPORTER_HEADERS`
6. `NEXT_PUBLIC_SUPABASE_URL`
7. `NEXT_PUBLIC_SUPABASE_ANON_KEY`
8. `SUPABASE_SERVICE_ROLE_KEY`
9. `DATABASE_URL`
10. `DEMO_MODE_JWT_SECRET`
11. `RESEND_API_KEY`
12. `NEXT_PUBLIC_CONTROL_PLANE_URL` = `https://admin.estalara.com`
13. `ESTALARA_INGEST_URL` = `https://ingest.estalara.com`
14. `ESTALARA_BACKEND_URL` = `https://api.app.estalara.com` (renamed from `api.estalara.com`,
    FOLLOW-568; mirror into Vercel prod env)
15. `TURBO_TOKEN` + `TURBO_TEAM` (CI only)
