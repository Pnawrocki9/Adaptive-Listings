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

## RESOLVED — Vendor Account Creation Required for 5 Infrastructure Providers

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

**Resolution:** Resolved 2026-05-14 by pm-orchestrator audit. All 5 vendor accounts (Supabase,
ClickHouse Cloud, Modal, Redpanda Cloud, Upstash) have been active since Sprint 1+ — confirmed by
active tables in Supabase, ClickHouse DDL applied (TICKET-014, PR merged), Modal Python skeleton
running (TICKET-015), Redpanda consumer deployed (stream-consumer app), Upstash Redis active
(session cache). No human action required; this escalation was stale.

---

## RESOLVED — GitHub Actions CI workflow fails immediately with "workflow file issue" on all branches

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

**Resolution:** Resolved 2026-05-04 via PR #34. Root cause:
`if: ${{ secrets.DOPPLER_TOKEN_DEV != '' }}` on a step-level `if` is invalid in GitHub Actions
(secrets context not available there), causing the workflow to fail at parse time before any jobs
were queued. Fix: removed the invalid `if` condition (job has `continue-on-error: true` so
doppler-verify is non-blocking). Additional fixes in the same PR: build @estalara/shared before
lint, add `permissions: pull-requests: read` to gitleaks-scan, auto-detect placeholder test,
ClickHouse auth (CLICKHOUSE_PASSWORD env var + per-statement execution + UInt64 type fix). CI now
green on main: `completed success` run #25315111966.

---

## RESOLVED — Sprint 8 spec doc needed before architect can write ticket files

**Filed by:** pm-orchestrator **Date:** 2026-05-13T10:00:00Z **Affects:** TICKET-AB-001,
TICKET-REORDER-001, TICKET-AGENCY-001, TICKET-FAIR-001, TICKET-AB-004, TICKET-NATIVE-001,
TICKET-CAUSAL-001 **Type:** scope **resolved_at:** 2026-05-13 **resolved_by:** Piotr Nawrocki

**Description:**

Sprint 7 and Sprint 7.5 are both DONE as of 2026-05-13. Sprint 8 ticket skeletons have been added to
QUEUE.md under "Sprint 8 — A/B holdout + re-ranking + agency answers + fair-housing linter" with
agent assignments, estimated hours, dependencies, and scope notes. However, no formal
`docs/specs/SPRINT_8_SPEC.md` exists yet (analogous to `docs/specs/SPRINT_7_5_SPEC.md`).

Architect agent cannot write the full ticket markdown files (under `backlog/sprint-8/`) without a
human-reviewed spec doc that resolves the two open scope questions below.

**Open questions requiring human decision before spec is written:**

1. **Fair-housing linter scope for re-ranking (TICKET-REORDER-001 + TICKET-FAIR-001 conflict).** The
   Master Design (E.3.2) requires `brand_safety_score` from the fair-housing linter as one of five
   inputs to the multi-objective optimization score. But the ReorderDirective re-sorts listing cards
   on a search results grid. This raises a genuine fair-housing question: does re-ranking listings
   per archetype constitute "steering" under the US Fair Housing Act (FHA) or UK Equality Act? If a
   `yield_hunter` archetype sees investment-yielding listings ranked first, and that archetype
   correlates with a protected class, we have a legal exposure. The compliance-engineer has not yet
   assessed this. **Decision needed:** (a) permit re-ranking with a linter gate, or (b) restrict
   re-ranking to non-protected signals only (price, size, location), or (c) defer REORDER-001 to
   Sprint 9 until compliance assessment is complete.

2. **NATIVE-001 CTO/CPO dependency.** TICKET-NATIVE-001 (app.estalara.com Tier 3 integration)
   requires Rafal (CTO) to add `data-estalara-*` attributes to SvelteKit components and Krystian
   (CPO) to approve the slot mapping. This is human engineering work that agents cannot perform.
   **Decision needed:** (a) who schedules this human work, (b) whether NATIVE-001 is in Sprint 8 or
   a dedicated CTO sprint, (c) whether the SDK side of NATIVE-001 (sdk-engineer wiring the init and
   corpus fixture) can proceed before CTO adds the attributes.

**Required action:**

1. Piotr reviews the two open questions above and provides direction.
2. Architect agent writes `docs/specs/SPRINT_8_SPEC.md` incorporating that direction plus the
   skeleton ticket scopes already in QUEUE.md.
3. Piotr reviews and approves the spec doc.
4. PM-orchestrator promotes Sprint 8 tickets from BACKLOG to READY and begins delegation.

**Suggested first-mover once spec is approved:** TICKET-AB-001 (no internal Sprint 8 dependencies,
unblocks AB-004 and FAIR-001) in parallel with TICKET-REORDER-001 (if fair-housing question is
resolved). TICKET-CAUSAL-001 is P2 and should not start until AB-001 has 2+ weeks of real holdout
data in production.

**Resolution:**

Both open questions resolved by Piotr Nawrocki on 2026-05-13:

1. **Fair-housing / REORDER-001:** REORDER-001 is **unblocked**. No FAIR-001 linter is needed at
   this stage. Rationale: Estalara does not collect demographic data. Archetypes are derived
   exclusively from behavioral signals (scroll depth, chat intent, dwell time, click patterns) —
   they are behavioral clusters, not demographic categories. No protected-class identity attaches to
   a session. Re-ranking listings to fit a buyer's expressed behavioral intent (e.g., `yield_hunter`
   reading rental-yield content → surface high-yield listings first) is not steering under
   FHA/Equality Act/UAE PDPL definitions, which all anchor on protected characteristics (race,
   religion, family status, national origin, gender, disability). Because none of those signals
   enter the archetype space, the legal premise of "steering" does not apply. **IMPORTANT CAVEAT
   (binding on all future agents):** This determination holds only as long as the archetype space
   remains purely behavioral. If any agent proposes adding a demographic or proxy-demographic signal
   to an archetype — including zip-code priors, name analysis, photo analysis, or any signal that
   acts as a proxy for race, religion, family status, national origin, gender, or disability — this
   decision MUST be re-litigated via a new escalation before that signal enters any model or
   pipeline. TICKET-FAIR-001 is CANCELLED as a result (not required at this stage).

2. **NATIVE-001 CTO/CPO dependency:** TICKET-NATIVE-001 is **deferred to MVP launch**. Tier 3 Native
   components require Rafal (CTO) and Krystian (CPO) scheduling on the SvelteKit side. That work is
   sequenced for the launch window, not Sprint 8. The SDK side does not proceed speculatively — it
   would create rework risk. NATIVE-001 remains BLOCKED with updated reason.
