# Ingest Worker — verified production deploy (FOLLOW-690)

**Status:** executed end-to-end 2026-07-26 (session 61, CEO at the keyboard for every mutation).
Every step below was actually run that day — nothing here is aspirational (Rule AH). Context and
evidence for WHY this was needed: ESC-043 in `backlog/ESCALATIONS.md` (prod ran 2026-05-29 code for
two months; 14 merged ingest commits were not live).

## Operator model

All commands run from `apps/ingest/`. Wrangler is authenticated headless — there is no
`wrangler login` on this machine:

```bash
doppler run --project estalara-adaptive-listings --config prd -- npx wrangler <cmd>
```

(`CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` live in Doppler `prd`; token acts as
piotr@estalara.com.)

## 1. Pre-flight (read-only — do ALL of it before any mutation)

1. **What changed since the running binary:**
   `git log -p --since=<last-deploy-date> -- apps/ingest/wrangler.toml` → enumerate every binding
   added. Cross-check the `Env` type in `apps/ingest/src/types.ts` — every binding/secret the code
   requires must have a source (toml var, account resource, or `wrangler secret list`).
2. **Account resources:** `wrangler kv namespace list` (ids must match toml),
   `wrangler queues list`, `wrangler secret list --env production`. Optional secrets that degrade
   gracefully when absent (verified in code 2026-07-26): `SENTRY_DSN_INGEST` (Sentry no-op),
   `MODAL_CHAT_NLP_URL` (chat-NLP dispatch skipped), `REDPANDA_*` (skipped when `REDPANDA_REST_URL`
   var is `""`).
3. **Record the rollback target:** `wrangler deployments list --env production` → note the current
   100% Version ID verbatim.
4. **Live-traffic sample:** `wrangler tail --env production` for 3–5 min; record origins seen. If
   real traffic arrives from an origin outside the allow-list about to be enforced, STOP — that is a
   CEO call.
5. Build workspace deps (`pnpm --filter @estalara/shared build`) and confirm `git status` is clean
   for `apps/ingest` + `packages/shared` against `origin/main`.

## 2. Missing account resources

2026-07-26 finding: the queues `estalara-events-retry` / `estalara-events-retry-dlq` (required since
FOLLOW-482, #449) did not exist — the account had zero queues.

**Trap:** `wrangler queues create` on the repo-pinned wrangler **3.114** fails with
`The specified queue settings are invalid.` — the old client sends a request shape today's API
rejects. Queue creation is client-agnostic (it is just an account resource), so use wrangler 4
ad-hoc for this ONE command; the deploy itself works fine on 3.114:

```bash
doppler run --project estalara-adaptive-listings --config prd -- npx --yes wrangler@4 queues create estalara-events-retry
doppler run --project estalara-adaptive-listings --config prd -- npx --yes wrangler@4 queues create estalara-events-retry-dlq
```

Queue creation is purely additive — the running Worker does not see it.

## 3. Staged deploy

```bash
doppler run --project estalara-adaptive-listings --config prd -- npx wrangler deploy --env staging
doppler run --project estalara-adaptive-listings --config prd -- npx wrangler deploy --env production
```

- Staging is a **bundle/API smoke only**: `[env.staging]` deliberately declares no KV/DO/queue
  bindings (wrangler envs do NOT inherit them — the warnings are expected), and
  `ingest-staging.estalara.com` has no DNS record. A green `Uploaded`+`Deployed` is the whole
  signal.
- On the production output, EYEBALL the bindings list before calling it done: both KV namespaces,
  `RATE_LIMITER`, both queue producers AND `Consumer for estalara-events-retry`, route
  `ingest.estalara.com/*`. Record the new Version ID.

## 4. Post-deploy behavioral probes (the standing regression tests)

Zero-persistence by construction: the event `type` `page_view` is deliberately invalid (real is
`page.view`), so a request that passes every gate is still rejected by schema validation and writes
nothing.

**Probe B — origin gate live + first-party classification correct:**

```bash
curl -s -X POST https://ingest.estalara.com/v1/events \
  -H "Content-Type: application/json" -H "X-Estalara-API-Key: 000-app-estalara" \
  -H "Origin: http://localhost:5173" \
  -d '{"events":[{"type":"page_view","session_id":"diag-probe","ts":"2026-01-01T00:00:00.000Z"}]}'
```

MUST return 403 `forbidden_origin`. Failure modes: reaches schema validation = the origin gate is
not deployed; 403 `origin_policy_unconfigured` = `FIRST_PARTY_TENANT_ID` mis-set (the guard
mis-classifies Estalara as external) → roll back.

**Probe C — first-party traffic passes:**

Same curl with `-H "Origin: https://app.estalara.com"` → MUST pass both gates and be rejected ONLY
by `Invalid discriminator value` schema errors (`accepted:0, rejected:1`). ANY 403 here =
first-party traffic is being dropped → roll back immediately.

Fingerprint check: the discriminator list in probe C's response reflects the deployed schema —
post-#595 code lists `live.signup` / `intent.snapshot` / `adapt.description.*`; the 2026-05 binary
did not. A longer list is direct proof the new bundle is serving.

## 5. Rollback

```bash
doppler run --project estalara-adaptive-listings --config prd -- npx wrangler rollback --env production
```

Execute immediately on: probe C returning any 403, `/health` non-200, or
`origin_policy_unconfigured` firing for the first-party tenant. Roll back first, debug after.

## Executed 2026-07-26 — record

| Item                   | Value                                                                    |
| ---------------------- | ------------------------------------------------------------------------ |
| Old (rollback) version | `6b943785-2d32-4ace-b76e-580d950ed662` (2026-05-29 code + later secrets) |
| New version            | `e64dd0c3-89ef-44a7-849c-47a4883ea6a6`                                   |
| Queues created         | `estalara-events-retry`, `estalara-events-retry-dlq` (via wrangler@4)    |
| Pre-deploy traffic     | 2 samples (45s + 4min): zero requests                                    |
| Probe B before / after | reached schema validation / **403 `forbidden_origin`**                   |
| Probe C                | schema-only rejection, `accepted:0` — first-party passes                 |
| Rollback needed        | no                                                                       |

## Known follow-ups (out of scope here)

- `SENTRY_DSN_INGEST` is unset in prod → the FOLLOW-658 guard's Sentry alerting channel is mute
  (guard still 403s; it just cannot page anyone). Set the secret to arm it.
- No production deploy **pipeline** exists (`deploy-staging.yml` is manual, staging-only, never
  green) — ESC-043 required-action item 4, a separate decision.
- FOLLOW-678 (canonicalize the `FIRST_PARTY_TENANT_ID` comparison) remains open; probe B doubles as
  its mis-set detector.
