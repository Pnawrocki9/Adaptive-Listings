# Supabase Terraform Module

**Status:** Skeleton only. Resources are commented out until ready to provision.

## Overview

This module manages Supabase projects for the Estalara Adaptive Listings platform. We use Supabase
for:

- **PostgreSQL database** with Row Level Security (RLS) for multi-tenant isolation
- **Supabase Auth** for tenant user authentication
- **Realtime** for websocket subscriptions (optional, dashboard use)
- **pgvector extension** for embeddings storage (MVP: per-tenant; Year 2: Qdrant migration)

## Architecture

Multi-region deployment pattern:

| Region | Supabase Region     | Purpose                           | Launched  |
| ------ | ------------------- | --------------------------------- | --------- |
| EU     | `eu-central-1`      | GDPR primary, EU/EEA tenants      | Sprint 2  |
| US     | `us-east-1`         | CCPA/CPRA, US/CA tenants          | Sprint 10 |
| UK     | EU project, logical | Separate UK project for residency | Sprint 10 |
| UAE    | AWS me-central-1    | UAE PDPL, Middle East tenants     | Sprint 10 |

**MVP:** Only EU region is provisioned in Sprint 2. Other regions ship in Sprint 10 (multi-region
deploy).

## Prerequisites

1. **Supabase account** with organization created
   - Signup: https://supabase.com/dashboard
   - Free tier: 2 projects (paused after 7 days inactivity)
   - Pro tier: $25/project/month (required for production)

2. **Personal Access Token (PAT)**
   - Generate: https://supabase.com/dashboard/account/tokens
   - Scope: `all` (or minimum: `projects:write`, `organizations:read`)
   - Store in Doppler as `SUPABASE_ACCESS_TOKEN`

3. **Organization ID**
   - Find in: https://supabase.com/dashboard/org/`<slug>`/general
   - Copy the UUID from organization settings

## Usage

### Initialize provider

```bash
cd infra/terraform/supabase
terraform init
```

### Plan (dry-run, will show no resources since they're commented)

```bash
terraform plan \
  -var="supabase_access_token=$(doppler secrets get SUPABASE_ACCESS_TOKEN --plain)" \
  -var="organization_id=<your-org-id>"
```

### Apply (when ready to provision in Sprint 2)

Uncomment the `resource "supabase_project"` block in `main.tf`, then:

```bash
terraform apply \
  -var="supabase_access_token=$(doppler secrets get SUPABASE_ACCESS_TOKEN --plain)" \
  -var="organization_id=$(doppler secrets get SUPABASE_ORG_ID --plain)" \
  -var="db_password=$(doppler secrets get SUPABASE_DB_PASSWORD --plain)"
```

## Cost Estimation

| Tier | Monthly Cost | Storage | Egress | Backups        |
| ---- | ------------ | ------- | ------ | -------------- |
| Free | $0           | 500 MB  | 2 GB   | None           |
| Pro  | $25/project  | 8 GB    | 100 GB | Daily (7 days) |

**MVP estimate (4 regions × $25):** ~$100/month base + overage

Realistic overage (10k tenants, 5 GB storage per region, 50 GB egress):

- Storage: ~$0.125/GB/month beyond 8 GB → ~$2.50/project
- Egress: $0.09/GB beyond 100 GB → minimal for our use case
- **Total:** ~$110-130/month across 4 regions

See https://supabase.com/pricing for latest pricing.

## Security Notes

- Database password MUST be ≥16 characters (Supabase requirement)
- RLS policies are applied at the schema level (see TICKET-021)
- API keys are project-scoped (anon, service_role) — never commit to git
- Use connection pooling (pgBouncer, 25 connections per region per service)

## Terraform Provider Docs

- Provider: https://registry.terraform.io/providers/supabase/supabase/latest/docs
- Resource `supabase_project`:
  https://registry.terraform.io/providers/supabase/supabase/latest/docs/resources/project

## Next Steps

1. **TICKET-020:** Set up Drizzle ORM + migrations folder structure
2. **TICKET-021:** Create `tenants` table with RLS policies
3. Uncomment resources in this module once account setup is complete
