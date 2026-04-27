---
id: TICKET-009
title: Vendor account stubs (Supabase + ClickHouse + Modal + Redpanda + Upstash) Terraform skeleton
sprint: 0
priority: P0
agent: devops-engineer
status: READY
estimated_hours: 6
depends_on: [TICKET-001, TICKET-002]
produces: [TICKET-014, TICKET-015, TICKET-020]
affects_files:
  - "infra/terraform/supabase/**"
  - "infra/terraform/clickhouse/**"
  - "infra/terraform/modal/**"
  - "infra/terraform/redpanda/**"
  - "infra/terraform/upstash/**"
  - "infra/terragrunt.hcl"
  - "docs/runbooks/vendor-accounts.md"
context_files:
  - docs/MASTER_DESIGN.md (sections A.3, I)
  - .claude/agents/devops-engineer.md
  - infra/terraform/cloudflare/* (TICKET-008 pattern to mirror)
labels: [foundation, p0, infra, terraform, vendors]
---

# TICKET-009: Vendor account stubs Terraform skeleton

## Summary

Create Terraform module skeletons for the 5 remaining vendors: Supabase (Postgres), ClickHouse Cloud (events), Modal (Python compute), Redpanda Cloud (Kafka), Upstash (Redis). Like TICKET-008, this ticket likely requires human action: account creation. The agent sets up the structure, documents what humans need to do, and escalates account creation needs. Resources are NOT actually created in this ticket — just module skeletons + variables + documentation. Real provisioning happens in subsequent infra tickets.

## Context

5 vendors to onboard. Each has its own Terraform provider quality and account model:

| Vendor | Provider | Free tier? | MVP cost |
|---|---|---|---|
| Supabase | Official `supabase/supabase` | Yes (2 projects) | $25/mo Pro per region × 4 |
| ClickHouse Cloud | Official `clickhouse/clickhouse` | $300 credit | <$2k/mo at MVP |
| Modal | No Terraform — CLI/Python config | $30 free | <$500/mo |
| Redpanda Cloud | Official `redpanda-data/redpanda` | Trial cluster | <$500/mo |
| Upstash | Official `upstash/upstash` | Yes (256MB) | <$200/mo |

We're not adding 4 Supabase regions yet (us, uk, eu, ae). Just the skeleton + EU. Other regions ship in Sprint 10 (multi-region deploy).

## Scope

### In scope
- `infra/terraform/supabase/` — provider config, variables, project resource (commented out, ready to enable), DB migrations placeholder, README
- `infra/terraform/clickhouse/` — provider config, organization data source, service resource (commented out)
- `infra/terraform/modal/` — Modal does not have Terraform provider. Instead create `modal-config/` with `modal.toml` skeleton, environment variables doc, and a `modal_setup.py` script
- `infra/terraform/redpanda/` — provider config, cluster resource (commented out), topics module
- `infra/terraform/upstash/` — provider config, Redis database resource (commented out)
- `infra/terragrunt.hcl` at root — Terragrunt parent config that defines remote state (S3 backend pattern, but we'll use Cloudflare R2 with S3-compatible API — document this)
- `docs/runbooks/vendor-accounts.md` — comprehensive: how to create each account, scope tokens, add to Doppler, common gotchas
- File 5 escalations to `backlog/ESCALATIONS.md` if account creation requires human action — one per vendor as needed

### Out of scope
- Actually provisioning resources (skeletons commented out)
- Multi-region setup beyond EU primary (Sprint 10)
- Real database schemas / migrations (Sprint 1+ per service)
- Backup/restore configuration (Sprint 9)

## Acceptance criteria

- [ ] AC1: All 5 directories exist under `infra/terraform/` with `main.tf`, `variables.tf`, `README.md`
- [ ] AC2: Each `main.tf` declares provider with version pin; each `variables.tf` defines required tokens (e.g., `supabase_access_token`, `clickhouse_organization_id`)
- [ ] AC3: `infra/terraform/modal/` instead has `modal-config/modal.toml`, `modal_setup.py` (skeleton), and a clear note in README that Modal uses code-as-config not HCL
- [ ] AC4: `terraform init` succeeds in each module directory (downloads providers, no real resources created since they're commented out)
- [ ] AC5: `terraform validate` passes in each module
- [ ] AC6: `infra/terragrunt.hcl` exists with remote_state config, generate_block for provider, inputs map; file is valid Terragrunt syntax (`terragrunt validate-inputs`)
- [ ] AC7: `docs/runbooks/vendor-accounts.md` documents all 5 vendors with: signup URL, token scoping, Doppler env var name, common gotchas; minimum 800 words total
- [ ] AC8: At least one escalation entry created in `backlog/ESCALATIONS.md` requesting human to: create accounts, scope tokens, add tokens to Doppler under `dev` config (per vendor: `SUPABASE_ACCESS_TOKEN`, `CLICKHOUSE_API_KEY`, `MODAL_TOKEN_ID + MODAL_TOKEN_SECRET`, `REDPANDA_CLOUD_TOKEN`, `UPSTASH_API_KEY`)
- [ ] AC9: All existing CI checks still green
- [ ] AC10: PR title `feat(infra): vendor terraform skeletons + runbooks [TICKET-009]`

## Implementation guidance

For each vendor, the Terraform module looks like:

```hcl
# infra/terraform/supabase/main.tf
terraform {
  required_providers {
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.0"
    }
  }
  required_version = ">= 1.5"
}

provider "supabase" {
  access_token = var.supabase_access_token
}

# Project resources commented out until we're ready to actually create them.
# Uncomment + apply in TICKET-021 (real Postgres setup).
#
# resource "supabase_project" "estalara_eu" {
#   organization_id = var.organization_id
#   name            = "estalara-eu"
#   region          = "eu-central-1"
#   database_password = var.db_password
# }
```

For Modal (no Terraform provider), use code-as-config:

```python
# infra/terraform/modal/modal-config/modal_setup.py
"""
Modal does not have a Terraform provider. Instead, we manage Modal apps via
Modal CLI + this Python script.

To set up Modal infra:
  pip install modal
  modal token set --token-id $MODAL_TOKEN_ID --token-secret $MODAL_TOKEN_SECRET
  python infra/terraform/modal/modal-config/modal_setup.py

Real app deployment: each app deploys itself via `modal deploy apps/<app>/src/main.py`
in CI. This script just verifies environment.
"""
import os
import sys


def verify_env():
    required = ["MODAL_TOKEN_ID", "MODAL_TOKEN_SECRET"]
    missing = [k for k in required if not os.getenv(k)]
    if missing:
        print(f"Missing env vars: {missing}", file=sys.stderr)
        sys.exit(1)
    print("Modal env OK.")


if __name__ == "__main__":
    verify_env()
```

For Terragrunt parent config:

```hcl
# infra/terragrunt.hcl
remote_state {
  backend = "s3"
  config = {
    bucket   = "estalara-tfstate"
    key      = "${path_relative_to_include()}/terraform.tfstate"
    region   = "auto"
    endpoint = "https://<cf-account-id>.r2.cloudflarestorage.com"
    skip_credentials_validation  = true
    skip_region_validation       = true
  }
}

generate "provider_versions" {
  path      = "_versions.tf"
  if_exists = "overwrite"
  contents  = <<EOF
terraform {
  required_version = ">= 1.5"
}
EOF
}
```

(We use Cloudflare R2 for Terraform state because we're already in the Cloudflare ecosystem; R2 is S3-compatible, ~10x cheaper than AWS S3 for our usage.)

## Test plan

- Local: `cd infra/terraform/supabase && terraform init && terraform validate` (repeat for each module) — all pass
- Local: `cd infra && terragrunt validate-inputs` — passes
- Local: `python infra/terraform/modal/modal-config/modal_setup.py` — fails gracefully with "Missing env vars" (no real token yet)
- CI: existing checks pass

## Definition of Done

- [ ] Branch `devops-engineer/TICKET-009-vendor-terraform-skeletons`
- [ ] PR title above
- [ ] All ACs verified (escalations counted as "verified" if account-creation blocker exists)
- [ ] CI green via `gh pr checks <pr> --watch`
- [ ] Prettier clean
- [ ] Escalations filed in `backlog/ESCALATIONS.md` for any blocked vendor account creation
- [ ] HANDOFF written: TICKET-009 → TICKET-014 (ClickHouse), TICKET-015 (Modal), TICKET-020 (Supabase + Drizzle)

## Notes

- This is the largest infra ticket in Sprint 0. 6 hours. Don't try to do it in one sitting.
- Account creation IS likely a blocker. Don't try to use personal accounts; the team needs proper accounts. Escalate freely.
- Treat each vendor as a separate sub-task; commit per vendor with conventional commit (`feat(infra): supabase terraform skeleton [TICKET-009]`, etc.)
