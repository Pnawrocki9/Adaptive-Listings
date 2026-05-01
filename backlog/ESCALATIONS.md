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

---

## OPEN — GitHub Actions CI workflow fails immediately with "workflow file issue" on all branches

**Filed by:** backend-engineer **Date:** 2026-05-01T10:50:00Z **Affects:** All tickets — TICKET-025
(and previously TICKET-012, TICKET-013, all main merges) **Type:** other (repo-config)

**Description:**

Every CI run since Sprint 0 completes in 0s with status `failure` and reason "This run likely failed
because of a workflow file issue." This includes pushes to `main` after merging TICKET-012 and
TICKET-013 (both previously marked DONE). The workflow file at `.github/workflows/ci.yml` appears
syntactically valid locally, so the issue is likely one of:

1. A required GitHub Actions secret (`TURBO_TOKEN`, `TURBO_TEAM`, or `GITHUB_TOKEN` permissions) is
   misconfigured or missing at the repo/org level
2. The `if: ${{ secrets.DOPPLER_TOKEN_DEV != '' }}` expression in the `doppler-verify` job uses a
   secrets context in a way that GitHub Actions flags as invalid at the workflow level
3. A GitHub Actions runner or org-level policy is blocking the workflow

All agent code (TICKET-012, 013, 025) passes local tests, typecheck, build, and prettier. The CI
infrastructure issue is not caused by agent code.

**Required action:**

1. Navigate to GitHub repo Settings → Actions → General and verify workflow permissions are set to
   "Read and write permissions"
2. Check if required secrets (`TURBO_TOKEN`, `TURBO_TEAM`) are set under Settings → Secrets and
   variables → Actions
3. Verify that the `if: ${{ secrets.DOPPLER_TOKEN_DEV != '' }}` guard in `doppler-verify` job is
   valid — this expression references `secrets` context which is not available in `if` conditions at
   the job level without `${{ secrets.NAME }}` wrapping. The correct form is:
   `if: ${{ secrets.DOPPLER_TOKEN_DEV != '' }}` which _should_ work but may fail for some org
   configurations
4. Try triggering a workflow run manually from the GitHub Actions UI to see the actual error message
5. If needed, devops-engineer should review and fix `.github/workflows/ci.yml`

**Partial fix history:**

- PR #21 (2026-05-01): Fixed `secrets` in job-level `if` condition (`doppler-verify` job)
- PR #22 (2026-05-01): Fixed `secrets` in workflow-level `env:` block (`TURBO_TOKEN`, `TURBO_TEAM`
  in `ci.yml`; `CLOUDFLARE_ACCOUNT_ID` in `deploy-staging.yml`)

**CI still fails after both fixes.** 30 runs total across all branches, 0 successes. The API returns
`total_count: 0` jobs and `billable: {}` — nothing runs. The exact error message is only visible in
the GitHub Actions UI (navigate to Actions → select any failed run → see the banner).

**Required human action:** Navigate to GitHub repo → Actions → select a failed run → read the banner
message that says "This run likely failed because of a workflow file issue." The SPECIFIC error text
below that banner will identify the remaining root cause. The agent cannot see this message via the
GitHub API. Possible remaining issues:

- Missing `permissions:` block required by a repo or org policy
- A GitHub Actions feature (required workflows, environment protection) blocking the run
- A third workflow validation error not yet identified

**Resolution:** Pending human investigation.
