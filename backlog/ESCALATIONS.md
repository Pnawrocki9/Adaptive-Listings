# Escalations

Issues that require human decisions. Agents append; humans resolve.

## Format

```markdown
## OPEN — <short title>

**Filed by:** <agent or human> **Date:** <ISO timestamp> **Affects:** <ticket-id or area> **Type:**
[architectural | compliance | priority | scope | vendor | other]

**Description:** What happened, what was expected, what's needed to unblock.

**Required action:** What needs to happen to resolve.

**Resolution:** <empty until resolved>
```

When resolved, change `## OPEN` to `## RESOLVED` and add the resolution.

---

## OPEN — Vendor Account Creation Required for 5 Infrastructure Providers

**Filed by:** devops-engineer  
**Date:** 2026-04-27T14:00:00Z  
**Affects:** TICKET-009, TICKET-014, TICKET-015, TICKET-020  
**Type:** vendor

**Description:**

TICKET-009 created Terraform module skeletons for 5 vendors (Supabase, ClickHouse Cloud, Modal,
Redpanda Cloud, Upstash), but all resources are commented out because vendor accounts do not exist
yet. These accounts must be created by a human with access to:

1. Shared team email (`infra@estalara.io` recommended) or CTO's personal accounts
2. Payment method (credit card) for production tiers
3. Doppler workspace access to store credentials

Without these accounts, downstream tickets are blocked:

- TICKET-014 (ClickHouse table DDL)
- TICKET-015 (Stream consumer Modal scaffold)
- TICKET-020 (Drizzle ORM + Supabase setup)

**Required action:**

1. **Create accounts** for all 5 vendors (follow `docs/runbooks/vendor-accounts.md`)
2. **Generate API tokens/keys** (documented in runbook, section-by-section)
3. **Store secrets in Doppler** under `dev` config (10+ secrets total):
   - `SUPABASE_ACCESS_TOKEN`, `SUPABASE_ORG_ID`, `SUPABASE_DB_PASSWORD`
   - `CLICKHOUSE_ORG_ID`, `CLICKHOUSE_API_KEY`, `CLICKHOUSE_API_SECRET`
   - `MODAL_TOKEN_ID`, `MODAL_TOKEN_SECRET`
   - `REDPANDA_CLIENT_ID`, `REDPANDA_CLIENT_SECRET`
   - `UPSTASH_EMAIL`, `UPSTASH_API_KEY`
4. **Verify setup** by running `terraform init && terraform validate` in each module
5. **Mark this escalation as RESOLVED** once all accounts are created and secrets stored

**Estimated time:** 2-3 hours (30 minutes per vendor)

**Cost commitment:** All vendors have free tiers or trial credits (no immediate payment required for
MVP testing).

**Resolution:** <awaiting human action>
