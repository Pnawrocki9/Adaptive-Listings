---
id: TICKET-008
title: Cloudflare account setup + Wrangler Terraform module
sprint: 0
priority: P0
agent: devops-engineer
status: READY
estimated_hours: 4
depends_on: [TICKET-001, TICKET-002]
produces: [TICKET-012, TICKET-018]
affects_files:
  - 'infra/terraform/cloudflare/**'
  - 'apps/ingest/wrangler.toml'
  - 'apps/decision-api/wrangler.toml'
  - '.github/workflows/deploy-staging.yml'
  - 'docs/runbooks/cloudflare.md'
context_files:
  - docs/MASTER_DESIGN.md (sections A.1, A.3 — multi-region, I — tech stack)
  - .claude/agents/devops-engineer.md
  - apps/ingest/* (existing skeleton from TICKET-001)
labels: [foundation, p0, infra, cloudflare, terraform]
---

# TICKET-008: Cloudflare account setup + Wrangler Terraform module

## Summary

Set up a Cloudflare account for Estalara and create the Terraform module that manages all Cloudflare
resources we'll use: Workers (ingest, decision-api), R2 buckets (CDN for SDK bundles), DNS records,
WAF rules, Durable Object namespaces. Also configure Wrangler config files for the two existing
Worker apps so they can be deployed to staging via CI. Production deploy is manual via
`pnpm deploy:prod` (gated behind human approval), staging deploy is automatic on merge to main.

This ticket likely requires human action: creating the Cloudflare account, capturing the API token,
adding it to Doppler. The agent will set up the structure and document what the human needs to do;
if account creation is blocked, escalate.

## Context

Master Design section A.3 specifies multi-region deployment via Cloudflare Workers (fra1, iad1,
lhr1, dxb1 routing). Workers are stateless edge functions; Durable Objects provide per-tenant rate
limiting state. R2 hosts SDK CDN bundles. We picked Cloudflare over alternatives (Vercel Edge, AWS
Lambda@Edge) because of zero cold start, generous free tier, and integrated DO/R2.

## Scope

### In scope

- Create `infra/terraform/cloudflare/` module structure:
  - `main.tf` — provider config, version pin
  - `variables.tf` — `cloudflare_account_id`, `cloudflare_zone_id`, `environment`
  - `workers.tf` — Worker definitions for ingest + decision-api (placeholder routes)
  - `r2.tf` — bucket for SDK CDN (`estalara-cdn-sdk`)
  - `dns.tf` — DNS records for `ingest.estalara.io`, `cdn.estalara.io`, `api.estalara.io`
  - `durable_objects.tf` — DO namespace for ingest rate limiting
  - `outputs.tf` — Worker URLs, R2 endpoints
- Update `apps/ingest/wrangler.toml`:
  - Account ID, zone, routes (set via Doppler / env vars, not hardcoded)
  - Compatibility date pinned
  - Durable Object binding stub
  - Environments: dev (preview), staging, production
- Update `apps/decision-api/wrangler.toml` (same pattern)
- Create `.github/workflows/deploy-staging.yml` triggered on push to main, deploys both Workers to
  staging environment
- Document in `docs/runbooks/cloudflare.md`:
  - How to create Cloudflare account (or join existing org)
  - How to scope an API token (use template "Edit Cloudflare Workers")
  - How to add the token to Doppler (`CLOUDFLARE_API_TOKEN`)
  - How to verify Terraform plan locally
  - How to deploy a Worker manually for testing
  - Rollback procedure
- If the agent cannot create a Cloudflare account (no Estalara org credentials available), escalate
  via `backlog/ESCALATIONS.md` and document in runbook what the human needs to provide

### Out of scope

- Production deploy workflow — comes in Sprint 10 (multi-region deploy work)
- WAF rules — ship in Sprint 9 (compliance + security pass)
- Custom DNS for tenant subdomains (white-label) — Sprint 7
- CDN cache rules / page rules — Sprint 10

## Acceptance criteria

- [ ] AC1: `infra/terraform/cloudflare/` directory exists with files: main.tf, variables.tf,
      workers.tf, r2.tf, dns.tf, durable_objects.tf, outputs.tf
- [ ] AC2: `terraform init && terraform validate && terraform plan` runs cleanly (with mock vars for
      plan, e.g., via `terraform-cloud-mock` or env vars)
- [ ] AC3: `apps/ingest/wrangler.toml` defines: name, main, compatibility_date, durable_objects
      binding, three env profiles (dev/staging/production)
- [ ] AC4: `apps/decision-api/wrangler.toml` similar
- [ ] AC5: `.github/workflows/deploy-staging.yml` runs `wrangler deploy --env staging` for both
      Workers; uses `CLOUDFLARE_API_TOKEN` from secrets; only triggers on push to main
- [ ] AC6: Workflow has a manual smoke test step: `curl https://ingest-staging.estalara.io/health`
      returns 200 (or skip with comment if DNS not ready)
- [ ] AC7: `docs/runbooks/cloudflare.md` covers all topics listed in scope; minimum 400 words
- [ ] AC8: If Cloudflare account doesn't exist, escalation written to `backlog/ESCALATIONS.md`
      BEFORE PR opens
- [ ] AC9: All existing CI checks still green
- [ ] AC10: PR title `feat(infra): cloudflare terraform module + wrangler config [TICKET-008]`

## Implementation guidance

For Terraform, use the official Cloudflare provider:

```hcl
# infra/terraform/cloudflare/main.tf
terraform {
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 4.0"
    }
  }
  required_version = ">= 1.5"
}

provider "cloudflare" {
  api_token = var.cloudflare_api_token
}
```

For `apps/ingest/wrangler.toml`:

```toml
name = "estalara-ingest"
main = "src/index.ts"
compatibility_date = "2026-04-26"
account_id = "" # filled at deploy time via env

[[durable_objects.bindings]]
name = "RATE_LIMITER"
class_name = "RateLimiter"

[env.staging]
name = "estalara-ingest-staging"
routes = [{ pattern = "ingest-staging.estalara.io/*", zone_name = "estalara.io" }]

[env.production]
name = "estalara-ingest-production"
routes = [{ pattern = "ingest.estalara.io/*", zone_name = "estalara.io" }]
```

For deploy workflow:

```yaml
name: Deploy Staging
on:
  push:
    branches: [main]

jobs:
  deploy-ingest:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          workingDirectory: apps/ingest
          command: deploy --env staging
```

## Test plan

- Local: `terraform init && terraform validate` passes
- Local: `terraform plan -var="cloudflare_api_token=fake"` exits 0 with shows plan (errors expected
  on actual resources due to fake token, but plan structure is valid)
- CI: PR open, all CI checks pass; staging deploy workflow doesn't run yet (only on merge)
- Post-merge: staging deploy workflow runs, deploys ingest + decision-api to `*-staging.estalara.io`
- Manual: `curl https://ingest-staging.estalara.io/health` returns 200 (or document why it doesn't
  yet)

## Definition of Done

- [ ] Branch `devops-engineer/TICKET-008-cloudflare-terraform`
- [ ] PR title above
- [ ] All ACs verified (or escalations filed for blocked AC8)
- [ ] CI green via `gh pr checks <pr> --watch`
- [ ] Prettier clean
- [ ] HANDOFF written: TICKET-008 → TICKET-012 (ingest can deploy now), TICKET-018 (observability
      needs CF logs)

## Notes

- **Likely escalation:** if you (devops-engineer) don't have access to create a Cloudflare account
  for the team, you MUST escalate. Don't hack around with a personal account.
- Cloudflare free tier is generous: 100k requests/day on Workers, 10GB R2 storage, $5/mo for Workers
  paid plan unlocks Durable Objects (we'll need this).
- Workers KV is NOT used in MVP (Upstash Redis for cache instead). Don't accidentally configure KV
  bindings.
