# Infrastructure as Code

**Status:** Skeleton only. All resources commented out until vendor accounts created.

## Overview

This directory contains all Infrastructure as Code (IaC) for the Estalara Adaptive Listings
platform.

```
infra/
├── terraform/                 # Terraform modules per vendor
│   ├── supabase/             # PostgreSQL + Auth
│   ├── clickhouse/           # Event store
│   ├── modal/                # Serverless Python (code-as-config, no Terraform)
│   ├── redpanda/             # Kafka-compatible event bus
│   ├── upstash/              # Serverless Redis
│   └── validate-all.sh       # Validation script for all modules
├── terragrunt.hcl            # Parent config (remote state on Cloudflare R2)
└── README.md                 # This file
```

## Quick Start

### 1. Prerequisites

Install required tools:

```bash
# Terraform (>= 1.5)
brew install terraform
# or: https://developer.hashicorp.com/terraform/install

# Doppler CLI (for secrets)
brew install dopplerhq/cli/doppler
# or: https://docs.doppler.com/docs/install-cli

# Authenticate Doppler
doppler login
doppler setup --project estalara --config dev
```

### 2. Create Vendor Accounts

Follow the comprehensive runbook:

```bash
cat docs/runbooks/vendor-accounts.md
```

This will guide you through:

- Creating accounts with 5 vendors (Supabase, ClickHouse, Modal, Redpanda, Upstash)
- Generating API tokens/keys
- Storing credentials in Doppler

**Estimated time:** 2-3 hours

### 3. Validate Modules

Once accounts are created and secrets stored:

```bash
cd infra/terraform
./validate-all.sh
```

Expected output:

```
✓ terraform init succeeded
✓ terraform validate succeeded
```

### 4. Provision Resources

Uncomment resources in each module's `main.tf`, then apply:

```bash
cd supabase
terraform apply \
  -var="supabase_access_token=$(doppler secrets get SUPABASE_ACCESS_TOKEN --plain)" \
  -var="organization_id=$(doppler secrets get SUPABASE_ORG_ID --plain)" \
  -var="db_password=$(doppler secrets get SUPABASE_DB_PASSWORD --plain)"
```

Repeat for other modules (clickhouse, redpanda, upstash). Modal uses `modal deploy` instead of
Terraform.

## Architecture Decisions

### Why Terragrunt?

Terragrunt provides:

- DRY remote state configuration (shared S3/R2 backend)
- Environment-specific variable injection
- Dependency management between modules

Alternative (plain Terraform) would require copy-paste backend config in every module.

### Why Cloudflare R2 for Terraform State?

- **Cost:** 10x cheaper egress than AWS S3 ($0.00/GB vs. $0.09/GB)
- **Ecosystem fit:** We already use Cloudflare for edge ingest and Workers
- **S3-compatible:** Drop-in replacement, no vendor lock-in

### Why Separate Modules per Vendor?

- **Blast radius:** Changes to one vendor don't affect others
- **Team ownership:** Different engineers can work on different modules (e.g., data-engineer owns
  ClickHouse, backend-engineer owns Supabase)
- **Cost visibility:** Track spend per vendor in separate Terraform state

## Multi-Region Strategy

**MVP (Sprint 1-2):** EU region only (`eu-central-1` for all vendors)

**Sprint 10:** Multi-region rollout:

- US: `us-east-1` (AWS) for all vendors
- UK: Separate Supabase project in EU region for data residency; logical separation
- UAE: `me-central-1` (AWS Bahrain) for Postgres; EU fallback for ClickHouse/Redpanda if unavailable

Each region gets its own Terraform workspace:

```bash
terraform workspace new eu
terraform workspace new us
terraform workspace new uk
terraform workspace new uae
```

## Cost Tracking

All modules include cost estimation in their READMEs. Summary:

| Vendor           | MVP Monthly Cost  | Scale (50k tenants) |
| ---------------- | ----------------- | ------------------- |
| Supabase         | $100              | $400                |
| ClickHouse Cloud | $1,000            | $4,000              |
| Modal            | $765              | $5,000              |
| Redpanda Cloud   | $500              | $4,800              |
| Upstash          | $300              | $1,500              |
| **Total**        | **~$2,665/month** | **~$15,700/month**  |

**LLM costs** (Anthropic Claude API) are billed separately and passed through to tenants.

## Security Best Practices

1. **Never commit secrets:** All credentials stored in Doppler, never in `.tf` files
2. **Use variable files for non-secrets:** Environment-specific configs in `dev.tfvars`,
   `staging.tfvars`, `production.tfvars`
3. **Enable MFA:** All vendor accounts MUST have MFA enabled (enforce via team policy)
4. **Rotate tokens quarterly:** Set calendar reminders for 90-day rotation (see runbook section
   "Rotation Schedule")
5. **Least privilege:** API tokens scoped to minimum required permissions (documented per vendor)

## Troubleshooting

### "terraform: command not found"

Install Terraform: https://developer.hashicorp.com/terraform/install

### "doppler: command not found"

Install Doppler CLI: https://docs.doppler.com/docs/install-cli

### "Error: Invalid provider credentials"

Check secrets in Doppler:

```bash
doppler secrets list --config dev
doppler secrets get <SECRET_NAME> --plain
```

If missing, follow `docs/runbooks/vendor-accounts.md` to create account and generate token.

### "Error: Backend initialization required"

Terragrunt remote state requires Cloudflare R2 bucket `estalara-tfstate` to exist. Create it in
Cloudflare dashboard:

1. Navigate to: https://dash.cloudflare.com/?to=/:account/r2
2. Click "Create bucket"
3. Name: `estalara-tfstate`
4. Region: auto
5. Generate R2 API token (S3-compatible) and store in Doppler as `CLOUDFLARE_R2_ACCESS_KEY_ID` and
   `CLOUDFLARE_R2_SECRET_ACCESS_KEY`

## Next Steps

1. **TICKET-009:** ✅ Create Terraform skeletons (this ticket)
2. **Human action:** Create vendor accounts (see `backlog/ESCALATIONS.md`)
3. **TICKET-014:** ClickHouse table DDL (data-engineer)
4. **TICKET-015:** Modal stream consumer (data-engineer)
5. **TICKET-020:** Supabase + Drizzle ORM (backend-engineer)

## References

- Master Design: `docs/MASTER_DESIGN.md` (sections A.3, I)
- Vendor runbook: `docs/runbooks/vendor-accounts.md`
- Agent definition: `.claude/agents/devops-engineer.md`
- Ticket spec: `backlog/sprint-0/TICKET-009.md`
