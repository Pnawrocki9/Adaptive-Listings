# Vendor Account Setup Runbook

**Version:** 1.0  
**Last Updated:** 2026-04-27  
**Owner:** DevOps Engineer  
**Status:** READY — All accounts must be created by human before provisioning

## Overview

This runbook documents the step-by-step process for creating and configuring accounts with all 5
third-party vendors used in the Estalara Adaptive Listings infrastructure:

1. **Supabase** (PostgreSQL + Auth)
2. **ClickHouse Cloud** (Event Store)
3. **Modal** (Serverless Python Compute)
4. **Redpanda Cloud** (Kafka-compatible Event Bus)
5. **Upstash** (Serverless Redis)

Each section includes:

- Signup URL and account creation steps
- Token/API key generation instructions
- Scope and permissions required
- Doppler secret storage naming conventions
- Common gotchas and troubleshooting

**Prerequisites:**

- Access to Doppler workspace (`estalara`)
- `doppler` CLI installed and authenticated
- Email account for vendor signups (recommend: `infra@estalara.io` shared inbox)

## 1. Supabase (PostgreSQL + Auth)

### 1.1. Account Creation

1. **Navigate to:** https://supabase.com/dashboard
2. **Sign up** using GitHub OAuth (recommended) or email
   - Use `infra@estalara.io` or CTO's GitHub account
3. **Create Organization:**
   - Name: `Estalara`
   - Plan: **Free** (for testing), upgrade to **Pro** ($25/project/month) before production

### 1.2. Generate Personal Access Token (PAT)

1. Navigate to: https://supabase.com/dashboard/account/tokens
2. Click **"Generate New Token"**
3. **Name:** `terraform-automation`
4. **Scopes:** Select ALL (or minimum: `projects:write`, `organizations:read`)
5. **Expiry:** 1 year (set calendar reminder to rotate 2 weeks before expiry)
6. **Copy token immediately** (shown only once)

### 1.3. Find Organization ID

1. Navigate to: https://supabase.com/dashboard/org/`<your-org-slug>`/general
2. Scroll to **"Organization ID"** section
3. Copy the UUID (e.g., `550e8400-e29b-41d4-a716-446655440000`)

### 1.4. Store Secrets in Doppler

```bash
doppler secrets set SUPABASE_ACCESS_TOKEN="sbp_abc123xyz..." --config dev
doppler secrets set SUPABASE_ORG_ID="550e8400-e29b-41d4-a716-446655440000" --config dev

# Generate strong database password (store for later use)
doppler secrets set SUPABASE_DB_PASSWORD="$(openssl rand -base64 32)" --config dev
```

### 1.5. Common Gotchas

- **Token expiry:** Supabase PATs expire after 1 year. Set a calendar reminder 2 weeks before to
  rotate.
- **Free tier limits:** Free tier pauses projects after 7 days of inactivity. Upgrade to Pro before
  production.
- **Password requirements:** Database password MUST be ≥16 characters (Supabase requirement).
- **Regional availability:** Supabase doesn't have `me-central-1` (Bahrain) region. For UAE, use AWS
  RDS in Bahrain or fall back to EU region.

### 1.6. Cost Summary

| Tier | Cost        | Storage | Egress | Notes                        |
| ---- | ----------- | ------- | ------ | ---------------------------- |
| Free | $0          | 500 MB  | 2 GB   | Pauses after 7 days inactive |
| Pro  | $25/project | 8 GB    | 100 GB | Daily backups (7 days)       |

**MVP estimate:** 4 regions × $25 = $100/month base

---

## 2. ClickHouse Cloud (Event Store)

### 2.1. Account Creation

1. **Navigate to:** https://console.clickhouse.cloud/
2. **Sign up** using Google OAuth or email
   - Use `infra@estalara.io`
3. **Trial credit:** $300 (automatically applied)
4. **Create Organization:**
   - Name: `Estalara`
   - Default region: `eu-central-1` (AWS)

### 2.2. Generate API Key

1. Navigate to: https://console.clickhouse.cloud/organizations/`<org-id>`/keys
2. Click **"Create API Key"**
3. **Name:** `terraform-automation`
4. **Permissions:** Select `Admin` (or minimum: `Services: Write`, `Organizations: Read`)
5. **Copy both Key ID and Key Secret immediately** (secret shown only once)

### 2.3. Find Organization ID

1. Navigate to: https://console.clickhouse.cloud/organizations
2. Your organization ID is shown in the URL and organization card
3. Copy the UUID

### 2.4. Store Secrets in Doppler

```bash
doppler secrets set CLICKHOUSE_ORG_ID="<org-uuid>" --config dev
doppler secrets set CLICKHOUSE_API_KEY="<key-id>" --config dev
doppler secrets set CLICKHOUSE_API_SECRET="<key-secret>" --config dev
```

### 2.5. Common Gotchas

- **Key secret shown once:** Unlike Supabase, ClickHouse API key secret is NOT retrievable after
  creation. Store immediately.
- **Trial credit tracking:** $300 credit lasts 1-3 months depending on usage. Add billing alert at
  $200 spent.
- **Idle scaling:** Enable "idle scaling" (auto-pause after 15 minutes) to save costs in dev.
  (Corrected 2026-08-07, FOLLOW-878 / ESC-052: there is no staging ClickHouse service — Doppler
  `stg` carries no `CLICKHOUSE_*` at all.)
- **Query timeout:** Default 30-second timeout can fail for large aggregations. Increase to 60s for
  dashboard queries.
- **UAE region:** ClickHouse Cloud doesn't support AWS `me-central-1` yet. For UAE tenants, either
  use EU region or self-host ClickHouse on AWS Bahrain.

### 2.6. Cost Summary

| Tier        | Base Cost   | Storage | Compute     | Notes                        |
| ----------- | ----------- | ------- | ----------- | ---------------------------- |
| Development | ~$50/month  | 10 GB   | ~$0.20/hour | Auto-pause after 15 min idle |
| Production  | ~$500/month | 100 GB+ | ~$2/hour    | 24/7 availability            |

**MVP estimate:** ~$750-$1,000/month (EU region, 100M events/month)

---

## 3. Modal (Serverless Python Compute)

### 3.1. Account Creation

1. **Navigate to:** https://modal.com
2. **Sign up** using GitHub OAuth (recommended)
   - Use CTO's GitHub account or `infra@estalara.io`
3. **Free credit:** $30 (automatically applied)
4. **Create Workspace:**
   - Name: `estalara`
   - Invite team members (Piotr, Rafał, Krystian)

### 3.2. Generate API Token

1. Navigate to: https://modal.com/settings/tokens
2. Click **"Create Token"**
3. **Name:** `terraform-ci`
4. **Copy Token ID and Token Secret immediately** (secret shown only once)

### 3.3. Store Secrets in Doppler

```bash
doppler secrets set MODAL_TOKEN_ID="<token-id>" --config dev
doppler secrets set MODAL_TOKEN_SECRET="<token-secret>" --config dev
```

### 3.4. Authenticate Modal CLI Locally

```bash
# Install Modal CLI
pip install modal

# Authenticate (interactive, for local dev)
modal token set --token-id $(doppler secrets get MODAL_TOKEN_ID --plain) \
  --token-secret $(doppler secrets get MODAL_TOKEN_SECRET --plain)

# Verify setup
cd infra/terraform/modal/modal-config
python modal_setup.py
```

Expected output:

```
✓ Modal library installed (version 0.x.x).
✓ Modal environment variables OK.
Modal setup complete. Ready to deploy apps.
```

### 3.5. Create Modal Secrets (for LLM API keys)

Modal uses its own secrets management (separate from Doppler):

```bash
# Create Anthropic API key secret
modal secret create anthropic-api-key \
  ANTHROPIC_API_KEY=$(doppler secrets get ANTHROPIC_API_KEY --plain)

# Create OpenAI API key secret
modal secret create openai-api-key \
  OPENAI_API_KEY=$(doppler secrets get OPENAI_API_KEY --plain)

# Create Supabase credentials secret
modal secret create supabase-credentials \
  SUPABASE_URL=$(doppler secrets get SUPABASE_URL --plain) \
  SUPABASE_KEY=$(doppler secrets get SUPABASE_SERVICE_KEY --plain)

# Create ClickHouse credentials secret
modal secret create clickhouse-credentials \
  CLICKHOUSE_HOST=$(doppler secrets get CLICKHOUSE_HOST --plain) \
  CLICKHOUSE_PASSWORD=$(doppler secrets get CLICKHOUSE_PASSWORD --plain)
```

### 3.6. Common Gotchas

- **No Terraform provider:** Modal does not support Terraform. Use `modal deploy` in CI/CD instead.
- **Token rotation:** Modal tokens don't expire, but rotate every 90 days as best practice.
- **Cold start budget:** GPU functions (T4) have ~3-5s cold start. Use `keep_warm=5` for critical
  paths.
- **Timeout limits:** Functions have 5-minute default timeout (15 minutes max). Plan long-running
  jobs accordingly.
- **Region selection:** Modal auto-selects region per-app. For EU tenants, force `region="eu"` in
  app decorator.

### 3.6. Cost Summary

| Resource Type | Price (per second) | Price (per hour) | Use Case                 |
| ------------- | ------------------ | ---------------- | ------------------------ |
| CPU (1 vCPU)  | $0.000032          | ~$2.30           | Non-GPU inference, ETL   |
| GPU (T4)      | $0.00056           | ~$2.00           | CLIP embeddings (cached) |
| GPU (A100)    | $0.0028            | ~$10.00          | Future: fine-tuned Llama |

**MVP estimate:** ~$765/month (100k intent extractions/day, 5s avg per call)

---

## 4. Redpanda Cloud (Kafka-compatible Event Bus)

### 4.1. Account Creation

1. **Navigate to:** https://console.redpanda.com
2. **Sign up** using Google OAuth or email
   - Use `infra@estalara.io`
3. **Free trial:** 30 days (10 MBps throughput cluster)

### 4.2. Generate API Credentials (OAuth2)

1. Navigate to: https://console.redpanda.com/settings/api
2. Click **"Create API Key"**
3. **Name:** `terraform-automation`
4. **Scopes:** `cluster:write`, `topic:write`, `acl:write`
5. **Copy Client ID and Client Secret immediately** (secret shown only once)

### 4.3. Store Secrets in Doppler

```bash
doppler secrets set REDPANDA_CLIENT_ID="<client-id>" --config dev
doppler secrets set REDPANDA_CLIENT_SECRET="<client-secret>" --config dev
```

### 4.4. Common Gotchas

- **OAuth2 credentials:** Redpanda uses OAuth2 (client ID + secret), not API keys. Don't confuse
  with other vendors.
- **Trial cluster limits:** Free trial cluster is limited to 10 MBps throughput. Upgrade to Tier 1
  ($500/month) before production.
- **Topic retention:** Default retention is 7 days. For audit logs, increase to 30 days (costs
  ~$5/month per TB).
- **Consumer lag monitoring:** Use Redpanda Console (built-in) to monitor lag. Alert if lag >60
  seconds.
- **SASL/SCRAM setup:** Producers/consumers need separate SASL credentials (username/password),
  generated via Terraform after cluster creation.

### 4.5. Cost Summary

| Tier   | Ingress  | Egress   | Monthly Cost | Notes               |
| ------ | -------- | -------- | ------------ | ------------------- |
| Trial  | 10 MBps  | 30 MBps  | $0 (30 days) | Limited throughput  |
| Tier 1 | 50 MBps  | 150 MBps | ~$500        | MVP (10k tenants)   |
| Tier 2 | 150 MBps | 450 MBps | ~$1,200      | Scale (50k tenants) |

**MVP estimate:** $500/month (EU region)

---

## 5. Upstash (Serverless Redis)

### 5.1. Account Creation

1. **Navigate to:** https://console.upstash.com
2. **Sign up** using GitHub OAuth or email
   - Use `infra@estalara.io` or CTO's GitHub account
3. **Free tier:** 10,000 commands/day (no credit card required)

### 5.2. Generate API Key

1. Navigate to: https://console.upstash.com/account/api
2. Click **"Create API Key"**
3. **Name:** `terraform-automation`
4. **Copy API Key immediately** (NOT shown again)

### 5.3. Store Secrets in Doppler

```bash
doppler secrets set UPSTASH_EMAIL="infra@estalara.io" --config dev
doppler secrets set UPSTASH_API_KEY="<api-key>" --config dev
```

### 5.4. Common Gotchas

- **Email required:** Upstash Terraform provider requires BOTH email and API key (not just API key).
- **Free tier limits:** 10,000 commands/day free tier is generous for dev, but production needs
  pay-as-you-go ($0.20 per 100k commands).
- **Multi-zone costs:** Multi-zone databases (99.99% SLA) cost 2x single-zone. Use multi-zone for
  session cache, single-zone for intent cache.
- **REST API only:** Upstash Redis is REST-based (not TCP). Use `@upstash/redis` SDK in Cloudflare
  Workers (native support).
- **Regional availability:** Upstash doesn't have all AWS regions. For UAE, use `ap-southeast-1`
  (Singapore) as closest region.

### 5.5. Cost Summary

| Usage Level         | Commands/Day | Commands/Month | Monthly Cost | Notes         |
| ------------------- | ------------ | -------------- | ------------ | ------------- |
| Free Tier           | 10k          | 300k           | $0           | Dev + testing |
| MVP (10k tenants)   | 5M           | 150M           | ~$300        | 50 req/s avg  |
| Scale (50k tenants) | 25M          | 750M           | ~$1,500      | 250 req/s avg |

**MVP estimate:** ~$300/month (EU region)

---

## Summary: Secret Names in Doppler

All secrets stored in `dev` config. Copy to the `prd` config before deploying to production.

> ⚠️ **CORRECTED 2026-08-07 (FOLLOW-878 / ESC-052 RESOLVED, CEO option 2).** This line read "Copy to
> `staging` and `production` configs". **There is no staging config to copy to safely**: `stg` was
> byte-identical to `prd`, so "copy to staging" meant "write to production". `stg` is retired by
> FOLLOW-873.

| Vendor           | Doppler Secret Name(s)                                             | Notes                      |
| ---------------- | ------------------------------------------------------------------ | -------------------------- |
| Supabase         | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_ORG_ID`, `SUPABASE_DB_PASSWORD` | PAT + org ID + DB password |
| ClickHouse Cloud | `CLICKHOUSE_ORG_ID`, `CLICKHOUSE_API_KEY`, `CLICKHOUSE_API_SECRET` | API key ID + secret        |
| Modal            | `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`                             | OAuth2 token ID + secret   |
| Redpanda Cloud   | `REDPANDA_CLIENT_ID`, `REDPANDA_CLIENT_SECRET`                     | OAuth2 client ID + secret  |
| Upstash          | `UPSTASH_EMAIL`, `UPSTASH_API_KEY`                                 | Email + API key            |

---

## Verification Checklist

After completing all 5 vendor setups, verify:

- [ ] All 10+ secrets stored in Doppler `dev` config
- [ ] `doppler secrets get <SECRET_NAME> --plain` returns value for each secret
- [ ] `terraform init` succeeds in each of 5 modules (`supabase`, `clickhouse`, `modal`, `redpanda`,
      `upstash`)
- [ ] `terraform validate` passes in each module
- [ ] `python infra/terraform/modal/modal-config/modal_setup.py` passes (Modal only)
- [ ] Set calendar reminders for token rotation (1 year for Supabase, 90 days for others)

---

## Troubleshooting

### "Invalid credentials" error in Terraform

**Cause:** Secret not set in Doppler or wrong secret name.

**Fix:**

```bash
# List all secrets in dev config
doppler secrets list --config dev

# Verify specific secret
doppler secrets get SUPABASE_ACCESS_TOKEN --plain

# If missing, set it
doppler secrets set SUPABASE_ACCESS_TOKEN="sbp_..." --config dev
```

### "Organization not found" error

**Cause:** Organization ID is wrong or account doesn't have access.

**Fix:**

1. Double-check org ID in vendor dashboard
2. Ensure account used for signup matches token/API key
3. For Supabase: verify you're in the correct organization (check top-left dropdown in dashboard)

### "Rate limit exceeded" error

**Cause:** Terraform is making too many API calls (common during `terraform plan` on large configs).

**Fix:**

1. Add `parallelism = 5` to Terraform command: `terraform apply -parallelism=5`
2. For ClickHouse: check API rate limits (100 req/min for free tier, 1000 req/min for paid)

### Modal secrets not visible in app

**Cause:** Modal secrets are workspace-scoped. Ensure you're deploying to correct workspace.

**Fix:**

```bash
# List workspaces
modal workspace list

# Switch workspace (if multiple)
modal workspace use estalara

# Verify secrets
modal secret list
```

---

## Rotation Schedule

| Vendor           | Token/Key Name        | Rotation Frequency | Next Rotation |
| ---------------- | --------------------- | ------------------ | ------------- |
| Supabase         | Personal Access Token | 1 year             | 2027-04-27    |
| ClickHouse Cloud | API Key Secret        | 90 days            | 2026-07-26    |
| Modal            | Token Secret          | 90 days            | 2026-07-26    |
| Redpanda Cloud   | Client Secret         | 90 days            | 2026-07-26    |
| Upstash          | API Key               | 90 days            | 2026-07-26    |

**Calendar reminder:** Add all rotation dates to team calendar with 2-week advance warning.

---

## Cost Summary (All Vendors)

| Vendor           | MVP Monthly Cost  | Scale (50k tenants) | Notes                                |
| ---------------- | ----------------- | ------------------- | ------------------------------------ |
| Supabase         | $100              | $400                | 4 regions × $25 (Pro tier)           |
| ClickHouse Cloud | $1,000            | $4,000              | Event store, 100M-1B events/mo       |
| Modal            | $765              | $5,000              | Serverless Python compute            |
| Redpanda Cloud   | $500              | $4,800              | Kafka event bus (4 regions)          |
| Upstash          | $300              | $1,500              | Serverless Redis (4 regions)         |
| **Total**        | **~$2,665/month** | **~$15,700/month**  | Excludes LLM API costs (passthrough) |

**LLM costs** (Anthropic Claude API) are billed separately and passed through to tenants (base +
20-25% markup).

---

## Next Steps

1. **Complete all 5 vendor signups** (estimated time: 2 hours)
2. **Store all secrets in Doppler** (estimated time: 30 minutes)
3. **Verify Terraform modules** (run `terraform init && terraform validate` in each directory)
4. **Update ESCALATIONS.md** (mark escalations as resolved once accounts created)
5. **Proceed to TICKET-014, TICKET-015, TICKET-020** (provision resources in Sprint 1-2)

---

**Document End** — Total word count: ~2,400 words
