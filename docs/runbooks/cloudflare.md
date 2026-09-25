# Cloudflare Workers Runbook

This runbook covers Cloudflare Workers deployment, management, and troubleshooting for the Estalara
Adaptive Listings platform.

## Table of Contents

1. [Overview](#overview)
2. [Account Setup](#account-setup)
3. [API Token Management](#api-token-management)
4. [Terraform Operations](#terraform-operations)
5. [Worker Deployment](#worker-deployment)
6. [Rollback Procedures](#rollback-procedures)
7. [Troubleshooting](#troubleshooting)
8. [Monitoring and Alerts](#monitoring-and-alerts)
9. [Cost Management](#cost-management)

## Overview

Estalara uses Cloudflare Workers for one edge service:

- **Ingest Worker** (`apps/ingest`): Receives SDK events, validates, authenticates, and pushes to
  Redpanda

The former Decision API Worker was removed 2026-09-24 (FOLLOW-1262); `/api/adapt` on the control
plane is the only decision endpoint (ADR-0006). Deleting its deployed Worker scripts
(`estalara-decision-api-*`) from the Cloudflare account is an operator step.

The Worker is deployed to Cloudflare's global network with automatic routing to the nearest edge
location. **Neither environment deploys automatically.** The staging workflow is
`workflow_dispatch`-only and is a bundle/upload smoke rather than a test environment (see
[Worker Deployment](#worker-deployment)); production is deployed by hand from this runbook and, for
the ingest Worker, from `docs/runbooks/INGEST_WORKER_DEPLOY.md`.

**Infrastructure components:**

- Cloudflare Workers (serverless edge functions)
- Durable Objects (per-tenant rate limiting for ingest)
- ~~R2 Buckets (SDK CDN storage + tenant assets)~~ — **R2 is not enabled on this account** (the API
  returns `10042`). No bucket exists and `cdn.estalara.com` is not provisioned; SDK bundles are
  served from `admin.estalara.com/sdk.js` instead (ESC-015, FOLLOW-808).
- DNS records — **only two hostnames are actually provisioned**, both verified live 2026-08-04:
  `ingest.estalara.com` (→ 200 on `/health`) and `decision.estalara.com` (→ 200 on `/api/health`).
  `api.estalara.com`, `cdn.estalara.com` and both `*-staging` hostnames have **no record**: they
  fall through the `*.estalara.com` wildcard to a non-Cloudflare host that answers 404 with a
  self-signed certificate. A hostname resolving is therefore NOT evidence it is configured — check
  the certificate issuer (Cloudflare-served names present a Google Trust Services cert for
  `CN=estalara.com`) or the answering IP (Cloudflare anycast) instead.

## Account Setup

### Prerequisites

- Cloudflare account with Workers Paid plan ($5/mo, required for Durable Objects)
- Domain `estalara.com` added to Cloudflare and DNS active
- GitHub repository secrets configured

### Initial Account Creation

1. **Create Cloudflare account** (if not exists):

   ```bash
   # Visit https://dash.cloudflare.com/sign-up
   # Use team email: admin@estalara.com
   # Enable 2FA for security
   ```

2. **Add domain to Cloudflare**:

   ```bash
   # In Cloudflare dashboard:
   # 1. Click "Add a Site"
   # 2. Enter: estalara.com
   # 3. Select "Free" plan (upgrade to Workers Paid later)
   # 4. Update nameservers at domain registrar to Cloudflare's NS records
   # 5. Wait for DNS propagation (usually <24h)
   ```

3. **Upgrade to Workers Paid plan**:

   ```bash
   # Navigate to: Workers & Pages > Plans
   # Select: Workers Paid ($5/month)
   # This unlocks Durable Objects (required for rate limiting)
   ```

4. **Capture Account ID**:
   ```bash
   # In Cloudflare dashboard, right sidebar shows:
   # Account ID: <32-char hex string>
   # Copy this for Doppler configuration
   ```

### Environment Configuration

Add the following secrets to Doppler. The project is `estalara-adaptive-listings` (see
`doppler.yaml`) — `--project estalara` is not a project that exists:

```bash
# Production config
doppler secrets set CLOUDFLARE_API_TOKEN="<token>" --project estalara-adaptive-listings --config prd
doppler secrets set CLOUDFLARE_ACCOUNT_ID="<account-id>" --project estalara-adaptive-listings --config prd
doppler secrets set CLOUDFLARE_ZONE_ID="<zone-id>" --project estalara-adaptive-listings --config prd

# NOTE (FOLLOW-878, 2026-08-07): the `stg` block that used to be here has been REMOVED.
# ESC-052 (RESOLVED, CEO option 2) established that Doppler `stg` is byte-identical to
# `prd` — writing Cloudflare credentials to `stg` writes them to production's config,
# and reading them back gives a false sense of a second environment. `stg` is retired
# by FOLLOW-873. Use `dev` for local work and `prd` for production.
```

Add to GitHub repository secrets (Settings > Secrets and variables > Actions):

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## API Token Management

### Creating an API Token

> **Zone is `estalara.com`, not `estalara.io`.** The canonical domain is `estalara.com` per
> DECISIONS_2026-05-18_v2 — see `packages/shared/src/domains.ts` and the `zone_name` in both
> `wrangler.toml` files. A token scoped to the wrong zone deploys the script fine and then fails on
> route binding. (The `estalara.io` occurrences this note used to warn about were removed from this
> runbook on 2026-08-04; the warning is kept because the wrong zone is still an easy mistake to make
> when creating a token.)

Cloudflare API tokens are scoped to specific permissions. Start from the "Edit Cloudflare Workers"
template, then add the permissions the template omits:

1. Navigate to: **Profile > API Tokens > Create Token**
2. Select template: **Edit Cloudflare Workers**
3. Permissions:
   - Account > Workers Scripts > Edit — deploys, `wrangler secret put`, Durable Object migrations
   - Account > Workers KV Storage > Edit — `KV_API_KEYS` + `KV_IDEMPOTENCY` are live bindings, and
     `apps/control-plane/scripts/project-allowed-origins.mts --apply` writes api-key records
   - Account > Queues > Edit — `estalara-events-retry` + `-dlq` (ADR-0017); NOT in the template, and
     without it `wrangler queues list` fails during the deploy pre-flight
   - Account > Account Settings > Read — account resolution (included in the template)
   - Zone > Workers Routes > Edit — `ingest.estalara.com/*` (the `decision.estalara.com/*` route
     belonged to the Decision API Worker removed by FOLLOW-1262)
   - Zone > DNS > Edit — only needed for `infra/terraform/cloudflare/dns.tf`
   - Account > Workers R2 Storage > Edit — only once R2 is enabled on the account (see below);
     harmless to include ahead of time
4. Account Resources: Include > `<Your Account>`
5. Zone Resources: Include > Specific zone > `estalara.com`
6. IP Address Filtering: Leave empty (GitHub Actions IPs rotate)
7. TTL: Start End (no expiry, rotate manually every 90 days)
8. Create Token and **copy immediately** (shown only once)
9. Verify before storing it anywhere:
   ```bash
   CLOUDFLARE_API_TOKEN=<token> npx wrangler whoami        # lists account + token scopes
   CLOUDFLARE_API_TOKEN=<token> npx wrangler kv namespace list
   CLOUDFLARE_API_TOKEN=<token> npx wrangler queues list
   ```

### R2 tokens (separate, and currently not provisioned)

R2 uses **S3-compatible access keys**, minted at **R2 > Manage R2 API Tokens** — a different screen
from the Workers token above. They back `CLOUDFLARE_R2_ACCESS_KEY_ID` /
`CLOUDFLARE_R2_SECRET_ACCESS_KEY` for the Terragrunt remote-state bucket (`infra/terragrunt.hcl`).

As of 2026-08-04 **R2 is not enabled on the account** (API returns
`10042 Please enable R2 through the Cloudflare Dashboard`), so the `estalara-tfstate` bucket and the
`cloudflare_r2_bucket` resources in `infra/terraform/cloudflare/r2.tf` do not exist and these keys
have nothing to authenticate against. Enable R2 in the dashboard first if you need Terraform remote
state.

### Token Rotation

Rotate tokens every 90 days for security:

1. Create new token with same permissions
2. Update Doppler: `doppler secrets set CLOUDFLARE_API_TOKEN="<new-token>"`
3. Update GitHub secrets
4. Wait 24h to ensure no active deploys using old token
5. Revoke old token in Cloudflare dashboard

## Terraform Operations

### Prerequisites

```bash
# Install Terraform >= 1.5
brew install terraform  # macOS
# or: https://developer.hashicorp.com/terraform/install

# Authenticate
export CLOUDFLARE_API_TOKEN=$(doppler secrets get CLOUDFLARE_API_TOKEN --plain)
export TF_VAR_cloudflare_account_id=$(doppler secrets get CLOUDFLARE_ACCOUNT_ID --plain)
export TF_VAR_cloudflare_zone_id=$(doppler secrets get CLOUDFLARE_ZONE_ID --plain)
```

### Initialize Terraform

```bash
cd infra/terraform/cloudflare
terraform init
```

### Validate Configuration

```bash
terraform validate
# Expected: Success! The configuration is valid.
```

### Plan Infrastructure Changes

```bash
# For production
terraform plan -var="environment=production"
```

> ⚠️ **CORRECTED 2026-08-07 (FOLLOW-878 / ESC-052 RESOLVED, CEO option 2).** The
> `-var="environment=staging"` invocations that used to open these two blocks have been removed:
> there is no staging plane for them to describe, and `infra/terraform/cloudflare/variables.tf:20`
> still **defaults** `environment` to `"staging"`, so a bare `terraform plan` plans a staging-named
> DNS set for hosts that have no records. **Always pass `-var="environment=..."` explicitly.**
> Changing that default (and the `dev/staging/production` enum) is deliberately NOT done here — it
> is entangled with the `api` vs `decision` record-naming decision FOLLOW-810 left open, and is
> filed as **FOLLOW-896**.

### Apply Infrastructure Changes

```bash
# Production (requires manual approval)
terraform apply -var="environment=production"
# Review plan carefully, type 'yes' to confirm
```

### View Current State

```bash
terraform show
terraform output
```

## Worker Deployment

### Staging Deployment (manual dispatch — a bundle/upload smoke, NOT a test environment)

`.github/workflows/deploy-staging.yml` runs on **`workflow_dispatch` only**. It does NOT run on
merge to `main`; nothing triggers it automatically and nothing downstream depends on it.

What it does, and the limit of what it proves:

1. Builds the ingest Worker
2. Uploads it as `estalara-ingest-staging`

**A green run means "the Worker compiles and uploads". That is the whole signal.** The staging
Worker is not reachable and is not meant to be: `[env.staging]` declares no KV/DO/queue bindings,
and `ingest-staging.estalara.com` has no DNS record (see `docs/runbooks/INGEST_WORKER_DEPLOY.md`
§3). The workflow used to end with HTTP smoke steps against those hostnames; they were removed
because they probed a host that by design never answers and swallowed the failure twice
(`curl -f … || echo …` under `continue-on-error: true`), reporting green regardless. Do not re-add
an HTTP probe unless the hostnames get provisioned first.

**Therefore: do not use a green staging run as a pre-production soak.** For the control plane, the
real pre-production surface is the Vercel preview deployment created on every PR.

**Monitor deploy progress:**

```bash
gh run list --workflow=deploy-staging.yml
gh run watch  # Watch latest run
```

### Manual Production Deployment

Production deploys require manual approval and should be done during maintenance windows:

> The "24h staging soak" this section used to open with is **not achievable** and was removed: the
> staging Workers have no bindings and no reachable hostname, so there is nothing to soak. See the
> staging section above. For the ingest Worker specifically, `docs/runbooks/INGEST_WORKER_DEPLOY.md`
> is the authoritative procedure — it carries the binding checklist and the post-deploy behavioural
> probes this section does not.

```bash
# 1. Create deploy announcement in #engineering Slack

# 2. Deploy ingest Worker
cd apps/ingest
pnpm wrangler deploy --env production

# 3. Verify ingest health  (note: /health, no prefix)
curl https://ingest.estalara.com/health
# Expected: {"status":"ok","service":"estalara-ingest","environment":"production"}

# 4. Monitor for 15 minutes before announcing deploy complete
```

### Local Testing

Test Workers locally before deploying:

```bash
cd apps/ingest
pnpm wrangler dev --env dev
# Worker runs at http://localhost:8787

# Test with curl
curl http://localhost:8787/health
```

## Rollback Procedures

### Emergency Rollback (Production)

If production is broken (there is no staging to compare against — FOLLOW-878 / ESC-052, corrected
2026-08-07; the rollback below is a Worker version rollback and never needed one):

```bash
# 1. Identify last known good version
cd apps/ingest
pnpm wrangler deployments list

# 2. Rollback to previous deployment (automatic)
pnpm wrangler rollback --env production
# Prompts to select deployment from list

# 3. Verify rollback
curl https://ingest.estalara.com/health

```

### Planned Rollback

For planned rollbacks during testing:

```bash
# 1. Deploy a known-good version by git ref
git checkout <commit-sha>
pnpm install
pnpm build
pnpm wrangler deploy --env production

# 2. Return to main branch
git checkout main
```

## Troubleshooting

### Workers Not Receiving Traffic

**Symptom:** `curl https://ingest.estalara.com` returns 404 or times out.

> **`dig` alone cannot diagnose this zone.** `*.estalara.com` is a wildcard pointing at a
> non-Cloudflare host, so **every** name resolves — including ones that were never created. Confirm
> with a control query before drawing any conclusion:
>
> ```bash
> dig +short definitely-does-not-exist-12345.estalara.com   # if this answers, the wildcard is in play
> ```
>
> A name that is genuinely served by Cloudflare answers on **Cloudflare anycast** (e.g. `172.67.x.x`
> / `104.21.x.x`) and presents a **Google Trust Services** certificate for `CN=estalara.com`. A name
> that is only caught by the wildcard answers on a single non-Cloudflare IP and presents a
> **self-signed `CN=TRAEFIK DEFAULT CERT`**. Treat that self-signed certificate as the signature of
> "this hostname does not exist in Cloudflare" — not as a TLS problem to work around with `curl -k`.

**Diagnosis:**

```bash
# Is this name served by Cloudflare at all?
dig +short ingest.estalara.com
echo | openssl s_client -connect ingest.estalara.com:443 -servername ingest.estalara.com 2>/dev/null \
  | openssl x509 -noout -subject -issuer

# Check Worker deployment
cd apps/ingest
pnpm wrangler deployments list --env production

# Check routes
pnpm wrangler routes list --env production
```

**Fix:**

- Ensure a **proxied** DNS record exists for `ingest.estalara.com` (the wildcard does not count —
  traffic must reach Cloudflare before a Worker route can match)
- Ensure Worker route is configured: `ingest.estalara.com/*` with `zone_name = "estalara.com"`
- Check Cloudflare dashboard > Workers & Pages > Routes

### Durable Objects Errors

**Symptom:** Rate limiting not working, errors mentioning "RATE_LIMITER binding not found".

**Diagnosis:**

```bash
# Check DO binding in wrangler.toml
grep -A 5 "durable_objects.bindings" apps/ingest/wrangler.toml

# Check DO namespace in Cloudflare dashboard
# Workers & Pages > Durable Objects
```

**Fix:**

- Ensure `[[durable_objects.bindings]]` block exists in wrangler.toml
- Deploy Worker with `pnpm wrangler deploy --env production` to create DO namespace

### R2 Bucket Access Issues

> **This whole section is aspirational — R2 is not enabled on this account.** The R2 API returns
> `10042`, no bucket exists, `cdn.estalara.com` is not provisioned, and
> `infra/terraform/cloudflare/` (including `r2.tf`) has **never been applied**, so
> `terraform output` below has no state to read. SDK bundles are served from
> `admin.estalara.com/sdk.js`, built on merge (ESC-015, FOLLOW-808). Kept for the day R2 is enabled;
> do not follow it as a diagnosis today.
>
> Note also that `infra/terraform/cloudflare/dns.tf` names the decision-API record `api` /
> `api-<env>`, while both `wrangler.toml` files bind the route to `decision.estalara.com` /
> `decision-staging.estalara.com`. Applying the Terraform as written would create hostnames the
> Worker routes do not match. Reconcile the two before any `terraform apply`.
>
> (Moot since 2026-09-24: FOLLOW-1262 removed both that record and the Worker it pointed at.)

**Symptom:** 403 errors when accessing `https://cdn.estalara.com/sdk/bundle.js`.

**Diagnosis:**

```bash
# Check R2 bucket exists
cd infra/terraform/cloudflare
terraform output

# Check bucket permissions
```

**Fix:**

- R2 buckets are private by default
- Public access requires custom domain setup (not in MVP scope)
- Use signed URLs for access control

### High Latency

**Symptom:** p95 latency >100ms for Decision API.

**Diagnosis:**

```bash
# Check Cloudflare Analytics dashboard
# Workers & Pages > <worker-name> > Metrics

# Check upstream service latency (Supabase, ClickHouse)
```

**Fix:**

- Enable Cloudflare Argo Smart Routing (paid addon)
- Add caching layer for frequently accessed data
- Profile Worker with `wrangler tail --env production`

## Monitoring and Alerts

### Real-time Logs

Stream Worker logs in real-time:

```bash
cd apps/ingest
pnpm wrangler tail --env production

# Filter by status code
pnpm wrangler tail --status error
```

### Metrics Dashboard

View Worker metrics in Cloudflare dashboard:

1. Navigate to: **Workers & Pages**
2. Select Worker: `estalara-ingest-production`
3. View: **Metrics** tab

Key metrics:

- Requests per second
- Errors (4xx, 5xx rates)
- Duration (p50, p95, p99)
- CPU time

### Alerts

Set up alerts in Cloudflare dashboard:

1. **Error rate alert**: Trigger if 5xx errors >1% of requests
2. **Latency alert**: Trigger if p95 duration >100ms for 5 minutes
3. **Request spike alert**: Trigger if requests >10,000 req/min (DDoS detection)

Configure notification channels: Email, PagerDuty, or Webhook.

## Cost Management

### Billing Overview

Cloudflare Workers pricing (as of 2026):

- **Workers Paid plan**: $5/month
- **Requests**: $0.50 per million requests (after free tier: 10M req/month)
- **Duration**: $12.50 per million GB-seconds (after free tier: 400,000 GB-s/month)
- **Durable Objects**: $0.15 per million requests + $0.20 per GB-month storage
- **R2 Storage**: $0.015 per GB-month (no egress fees)

### Estimated Monthly Cost (Production)

Assumptions: 1M ingest events/day, 500K decision requests/day

| Resource           | Usage              | Cost       |
| ------------------ | ------------------ | ---------- |
| Workers Paid       | Base plan          | $5.00      |
| Ingest requests    | 30M/month          | $10.00     |
| Decision requests  | 15M/month          | $2.50      |
| Durable Objects    | 30M requests/month | $4.50      |
| R2 SDK CDN         | 10 GB storage      | $0.15      |
| R2 Tenant assets   | 50 GB storage      | $0.75      |
| **Total estimate** |                    | **$22.90** |

### Cost Optimization

- Enable caching for Decision API to reduce request count
- Use Cloudflare's free tier fully before upgrading
- Monitor usage in Billing dashboard weekly

---

**Last updated:** 2026-04-29  
**Maintained by:** devops-engineer  
**Escalation:** Post in #engineering-infra Slack channel
