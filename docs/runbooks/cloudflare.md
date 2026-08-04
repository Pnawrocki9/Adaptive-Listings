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

Estalara uses Cloudflare Workers for two edge services:

- **Ingest Worker** (`apps/ingest`): Receives SDK events, validates, authenticates, and pushes to
  Redpanda
- **Decision API Worker** (`apps/decision-api`): Serves adaptation decisions in <100ms p95 latency

Both Workers are deployed to Cloudflare's global network with automatic routing to the nearest edge
location. Staging deploys automatically on merge to main; production deploys require manual
approval.

**Infrastructure components:**

- Cloudflare Workers (serverless edge functions)
- Durable Objects (per-tenant rate limiting for ingest)
- R2 Buckets (SDK CDN storage + tenant assets)
- DNS records (ingest.estalara.io, api.estalara.io, cdn.estalara.io)

## Account Setup

### Prerequisites

- Cloudflare account with Workers Paid plan ($5/mo, required for Durable Objects)
- Domain `estalara.io` added to Cloudflare and DNS active
- GitHub repository secrets configured

### Initial Account Creation

1. **Create Cloudflare account** (if not exists):

   ```bash
   # Visit https://dash.cloudflare.com/sign-up
   # Use team email: admin@estalara.io
   # Enable 2FA for security
   ```

2. **Add domain to Cloudflare**:

   ```bash
   # In Cloudflare dashboard:
   # 1. Click "Add a Site"
   # 2. Enter: estalara.io
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

# Staging config
doppler secrets set CLOUDFLARE_API_TOKEN="<token>" --project estalara-adaptive-listings --config stg
doppler secrets set CLOUDFLARE_ACCOUNT_ID="<account-id>" --project estalara-adaptive-listings --config stg
doppler secrets set CLOUDFLARE_ZONE_ID="<zone-id>" --project estalara-adaptive-listings --config stg
```

Add to GitHub repository secrets (Settings > Secrets and variables > Actions):

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

## API Token Management

### Creating an API Token

> **Zone is `estalara.com`, not `estalara.io`.** `estalara.io` is legacy naming that survives in
> parts of this runbook; the canonical domain is `estalara.com` per DECISIONS_2026-05-18_v2 — see
> `packages/shared/src/domains.ts` and the `zone_name` in both `wrangler.toml` files. A token scoped
> to the wrong zone deploys the script fine and then fails on route binding.

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
   - Zone > Workers Routes > Edit — `ingest.estalara.com/*`, `decision.estalara.com/*`
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
# For staging
terraform plan -var="environment=staging"

# For production
terraform plan -var="environment=production"
```

### Apply Infrastructure Changes

```bash
# Staging (auto-approved for R2 buckets and DNS)
terraform apply -var="environment=staging" -auto-approve

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

### Automatic Staging Deployment

On every merge to `main`, the `.github/workflows/deploy-staging.yml` workflow automatically deploys
both Workers to staging:

1. Builds Workers with `pnpm build`
2. Deploys ingest Worker to `ingest-staging.estalara.io`
3. Deploys decision API Worker to `api-staging.estalara.io`
4. Runs smoke tests (continues on failure if health endpoints not ready)

**Monitor deploy progress:**

```bash
gh run list --workflow=deploy-staging.yml
gh run watch  # Watch latest run
```

### Manual Production Deployment

Production deploys require manual approval and should be done during maintenance windows:

```bash
# 1. Ensure staging is stable (24h soak minimum)
# 2. Create deploy announcement in #engineering Slack

# 3. Deploy ingest Worker
cd apps/ingest
pnpm wrangler deploy --env production

# 4. Verify ingest health
curl https://ingest.estalara.io/health
# Expected: {"status":"ok","timestamp":1234567890}

# 5. Deploy decision API Worker
cd ../decision-api
pnpm wrangler deploy --env production

# 6. Verify decision API health
curl https://api.estalara.io/health
# Expected: {"status":"ok","version":"1.0.0"}

# 7. Monitor for 15 minutes before announcing deploy complete
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

If production is broken and staging is stable:

```bash
# 1. Identify last known good version
cd apps/ingest
pnpm wrangler deployments list

# 2. Rollback to previous deployment (automatic)
pnpm wrangler rollback --env production
# Prompts to select deployment from list

# 3. Verify rollback
curl https://ingest.estalara.io/health

# 4. Repeat for decision-api if needed
cd ../decision-api
pnpm wrangler rollback --env production
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

**Symptom:** `curl https://ingest.estalara.io` returns 404 or times out.

**Diagnosis:**

```bash
# Check DNS records
dig ingest.estalara.io

# Check Worker deployment
cd apps/ingest
pnpm wrangler deployments list --env production

# Check routes
pnpm wrangler routes list --env production
```

**Fix:**

- Ensure DNS record exists: `ingest.estalara.io` → `<account-id>.workers.dev`
- Ensure Worker route is configured: `ingest.estalara.io/*`
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

**Symptom:** 403 errors when accessing `https://cdn.estalara.io/sdk/bundle.js`.

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
