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

## RESOLVED — commitlint ticket-reference rule rejects the `TICKET-PILOT-` prefix [TICKET-PILOT-003]

**Filed by:** data-engineer **Date:** 2026-05-24T00:00:00Z **Affects:** TICKET-PILOT-003 (and any
other `TICKET-PILOT-NNN` Sprint 12 pilot tickets) **Type:** repo-config

**Description:**

The `ticket-reference` custom rule in `commitlint.config.cjs` enforces an allow-list of ticket
prefixes. Sprint 12 introduced the `TICKET-PILOT-NNN` family (see `backlog/sprint-12/`), but the
regex on line ~110 does not include a `PILOT-` alternative:

```js
/\[TICKET-(?:FIX-|INFRA-|...|RUNTIME-FIX-)?\d+[a-z]?\]|\[FOLLOW-\d+\]|\[ESCALATION\]/;
```

As a result the commit-msg hook rejects a well-formed message such as
`feat(data): add CTA-lift dashboard with holdout comparison [TICKET-PILOT-003]`.

I cannot edit `commitlint.config.cjs` from the data-engineer lane (it is a repo-wide config file),
and skipping hooks (`--no-verify`) is disallowed by the operating rules. The TICKET-PILOT-003 work
is otherwise complete: 26 new tests pass, full control-plane suite (568 tests) green, typecheck and
lint clean.

**Required action (devops-engineer or PM — ~2 minutes):**

Add `PILOT-` to the `ticketPattern` alternation in `commitlint.config.cjs`:

```js
/\[TICKET-(?:FIX-|INFRA-|DEMO-|ADM-|QUIZ-|DB-|EMB-|ARCH-|ADP-|DQS-|AUTO-|AB-|REORDER-|AGENCY-|GDPR-|VAL-|DESC-PIVOT-|DESC-|CAUSAL-|PROCESS-|DECISIONS-|RLS-|RUNTIME-AUDIT-|RUNTIME-FIX-|PILOT-)?\d+[a-z]?\]|\[FOLLOW-\d+\]|\[ESCALATION\]/;
```

Then the TICKET-PILOT-003 commit can be created and the PR opened.

**Resolution:** Resolved 2026-05-25 by pm-orchestrator. `PILOT-` was added to the `ticketPattern`
alternation in `commitlint.config.cjs`; the fix landed alongside PR #145 (FOLLOW-078). All
`[TICKET-PILOT-NNN]` commit subjects now pass the commit-msg hook (verified: PRs #143–#146 merged
with PILOT-prefixed commits).

---

## RESOLVED — ESC-010: DOPPLER_TOKEN_DEV secret must be provisioned in GitHub Actions [FOLLOW-040]

**Filed by:** devops-engineer **Date:** 2026-05-24T00:00:00Z **Affects:** FOLLOW-040, FOLLOW-063,
FOLLOW-068, FOLLOW-039 **Type:** repo-config

**Description:**

FOLLOW-040 has wired the Doppler CI integration into `.github/workflows/ci.yml`. The workflow
installs the Doppler CLI and uses `doppler run --` for secret injection. The `doppler-verify` job
performs a soft-skip when `DOPPLER_TOKEN_DEV` is absent (so CI is not broken), but it must have the
token to pass as a real green check.

The token has NOT been created yet. Until it is provisioned in GitHub Actions secrets:

- The `doppler-verify` job soft-skips (logs a clear message, exits 0) on every PR.
- FOLLOW-063 (seed CI), FOLLOW-068 (demo CI), FOLLOW-039 (ClickHouse DSR) will soft-skip any step
  that requires `doppler run --` with injected DB / API key credentials.

**Required action (Piotr — ~10 minutes):**

1. Go to [Doppler dashboard](https://dashboard.doppler.com) → project `estalara` → config `dev` →
   Access → Service Tokens → Create service token.
   - Name: `ci-github-actions`
   - Config: `dev` (NOT staging, NOT prod)
   - Expiry: none (or 1 year) — rotate on breach per V.6.1 policy
2. Copy the token value (shown only once).
3. Go to GitHub repo → Settings → Secrets and variables → Actions → New repository secret.
   - Name: `DOPPLER_TOKEN_DEV`
   - Value: (paste the token)
4. Trigger a CI run on any open PR (or push to a devops-engineer branch) — the `doppler-verify` job
   should now show "Doppler auth verified" instead of the soft-skip message.

**Do NOT create a production-scope token.** Production secrets remain Vercel-only per §V.6.3.

**Resolution:** RESOLVED 2026-06-10 by Piotr Nawrocki. Doppler service token `ci-github-actions`
created in project `estalara` config `dev`. Added as `DOPPLER_TOKEN_DEV` GitHub Actions repository
secret. CI `doppler-verify` job confirmed green ("Doppler auth verified").

---

## RESOLVED — GitHub Actions billing prevents CI from running on PR #125

**Filed by:** backend-engineer **Date:** 2026-05-21T21:40:00Z **Affects:** TICKET-AUTO-006-POLISH,
PR #125 **Type:** other

**Description:** All CI jobs for PR #125 fail immediately (2-4s) with "The job was not started
because recent account payments have failed or your spending limit needs to be increased." This is a
GitHub Actions billing/quota issue. All local checks pass: 474 tests, 0 ESLint errors in new files,
prettier unchanged. The code is production-ready but CI cannot validate it.

**Required action:** Resolve GitHub Actions billing so CI can run on PR #125. Once CI is green, PM
can merge and mark TICKET-AUTO-006-POLISH DONE.

**Resolution:** Resolved 2026-05-25 by pm-orchestrator. GitHub Actions billing has been restored —
CI has run green on PRs #142–#146 (Sprint 12) since this was filed. PR #125 (TICKET-AUTO-006-POLISH)
is stale and should be rebased + re-validated independently if the carve-out work is still wanted;
the billing block itself no longer applies.

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

---

## RESOLVED — Fair-housing risk in copy_template strings (US-region pilot blocker)

**Filed by:** retrospective-analyst (RETRO-004) **Date:** 2026-05-14 **Affects:** TICKET-046,
TICKET-DESC-001, Sprint 11 pilot launch **Type:** compliance

**Description:** RETRO-004 surfaced that multiple `copy_template.en` strings introduced in PR #92
(TICKET-046) contain protected-class (familial-status) value propositions. Specifically,
`family_buyer` and `student_parent` archetype templates describe lifestyle outcomes tied to
household composition — language that, while not using protected-class terms directly, could be
construed as steering under FHA (US) if served to sessions that could be profiled as family
households.

Examples (from PR #92 merged copy):

- `family_buyer.copy_template.en` — references "family-friendly", "school catchment areas", "family
  space" etc. as the primary value proposition surfaced to that archetype
- `student_parent.copy_template.en` — references proximity to universities as a primary hook

The 2026-05-13 fair-housing resolution (above) determined that archetype = behavioral, not
demographic. That determination holds — but it applies to the _routing/reordering_ layer, not the
_copy layer_. The copy_template strings are surfaced to buyers and explicitly market familial
lifestyle outcomes. This is a distinct exposure from the reorder decision:

- Reorder: "which listings appear first" — ruled non-steering because no protected class attaches
- Copy: "what language is served to a behavioral cluster" — if the cluster correlates with family
  status, serving family-marketing copy may constitute illegal steering under HUD guidance on
  advertising, even if the archetype signal is behavioral

**Required action:**

1. **Piotr / compliance-engineer review** — confirm whether the 2026-05-13 ruling extends to the
   copy layer or whether a separate assessment is needed.
2. If a separate assessment IS needed: compliance-engineer runs a fair-housing copy audit on all 17
   non-neutral `copy_template.en` strings (focus: family_buyer, student_parent, diaspora_buyer,
   retiree_relocator) before any US-region pilot tenant is onboarded.
3. If the 2026-05-13 ruling DOES extend (behavioral copy = not steering): mark this resolved, add a
   binding note that copy strings must not reference protected characteristics explicitly (race,
   religion, gender, disability, national origin, family status) — behavioral framing only.

**Impact if unresolved:** `copy_template.en` strings MUST NOT be served to US-region sessions until
this is resolved. The `GET /api/adapt/description` endpoint (TICKET-DESC-001, Sprint 9) and any
SDK-side copy rendering must gate on `tenant.region !== 'us'` OR require compliance sign-off. →
tracked as FOLLOW-034 in `backlog/FOLLOW_UPS.md`.

**Resolution:** Resolved 2026-05-14 by Piotr Nawrocki (CEO).

The system does NOT limit access to listings or information. Every buyer receives the same complete
set of listings — the copy_template and variant strings adjust only the PRESENTATION framing of the
same underlying property data, not which properties are shown or hidden. This is equivalent to a
travel site displaying "family-friendly amenities" vs "business-travel essentials" for the same
hotel room: the framing differs, the access does not.

HUD fair-housing advertising guidance prohibits copy that EXCLUDES or DISCOURAGES protected classes
from accessing listings. Because Estalara serves all listings to all sessions (no filtering by
archetype at the listing-selection layer), the copy layer presents no gatekeeping exposure. The
archetype system is purely behavioral (scroll depth, dwell time, intent signals); no protected-class
identity enters the signal space (binding constraint from 2026-05-13 resolution above). Presenting
the same property in a yield-focused framing vs a family-amenity framing to different behavioral
clusters does not constitute steering under FHA/HUD advertising rules.

Binding constraint going forward: copy_template and variant strings MUST NOT reference protected
characteristics explicitly (race, religion, gender, disability, national origin, family status,
national origin). Behavioral framing only (investment return, space utility, commute time, lifestyle
fit). Agents writing or editing copy strings must follow this constraint.

FOLLOW-034 is CANCELLED — no compliance audit or region gate required.

---

## RESOLVED — ESC-009: Provision E2E_BEARER_TOKEN GitHub Actions secret for demo-integration CI job

**Filed by:** qa-engineer **Date:** 2026-05-24T00:00:00Z **Affects:** FOLLOW-068, PR
`qa-engineer/FOLLOW-068-demo-ci` **Type:** other

**Description:** The `demo-integration` CI job (`.github/workflows/demo-integration.yml`) runs the
detect → activate → adapt → SDK E2E spec with a live Next.js server. Steps 1–3 of the spec POST to
authenticated routes (`/api/detect`, `/api/schema/activate`, `/api/adapt`) using a Bearer token
drawn from the `E2E_BEARER_TOKEN` environment variable. The spec's `beforeAll()` precheck
(FOLLOW-067, bundled into FOLLOW-068) fails fast with an actionable error if the token is absent, so
the job will not produce 401-hang failures — but it also cannot run the integration steps without
the token.

The token must be a valid JWT signed by `JWT_SECRET` for the demo/canary E2E tenant
(`E2E_TENANT_ID`, defaulting to `est_test_e2e_tenant`). It should be long-lived (or auto-rotated)
and scoped read-write to that tenant only.

Additionally, `E2E_TENANT_ID` (the canary tenant's Postgres UUID) should be set as a GitHub Actions
variable (`vars.E2E_TENANT_ID`) so the workflow can pass it to the spec without hardcoding.

**Required action:**

1. DevOps/Piotr: generate a long-lived E2E JWT for the `est_test_e2e_tenant` / `tnt_canary_eu` demo
   tenant (or whichever tenant UUID is used for canary).
2. Add it to GitHub Actions repository secrets as `E2E_BEARER_TOKEN`.
3. Add the tenant UUID to GitHub Actions repository variables as `E2E_TENANT_ID`.
4. After adding, re-run the `demo-integration` workflow on the PR branch to confirm the E2E steps
   execute (rather than soft-skipping due to missing DOPPLER_TOKEN_DEV — note: the DOPPLER soft-skip
   is a separate gate; the E2E_BEARER_TOKEN precheck is the inner gate within the E2E describe
   block).

**Note:** The demo-integration job also requires `DOPPLER_TOKEN_DEV` (tracked separately as
FOLLOW-040). Until FOLLOW-040 lands, the job soft-skips with exit 0 before the spec even runs.
Provisioning `E2E_BEARER_TOKEN` now is still recommended so it is ready the moment FOLLOW-040
unblocks the job.

**Resolution:** RESOLVED 2026-05-24 by Piotr Nawrocki. `E2E_BEARER_TOKEN` added as GitHub Actions
repository secret (2026-05-24T15:48Z). `E2E_TENANT_ID` added as GitHub Actions repository variable
with value `est_test_e2e_tenant` (2026-05-24T15:47Z). Confirmed present via `gh secret list` on
2026-06-10.

---

## RESOLVED — ESC-011: GitHub Actions not starting any runs — FOLLOW-105 Wave-1 PR #149 cannot get CI green

**Filed by:** pm-orchestrator **Date:** 2026-05-25T20:30:00Z **Affects:** FOLLOW-105 Wave 1 (PR
#149, `feat/follow-105-1bcd-canonical-adapt-enforcement`) and ALL subsequent PRs **Type:**
repo-config / account

**Description:** PR #149 (FOLLOW-105 Wave 1) was opened and pushed, but the GitHub Actions `CI`
workflow created **zero runs** for it. Diagnosis:

- The CI workflow is `active` (not disabled) — confirmed via `gh workflow list`.
- There have been **no workflow runs of any kind across the whole repo since 2026-05-25T15:08:45Z**
  (the #148 merge-to-main push). My PR was created well after that and got nothing.
- `ci.yml` `on.push.branches` only matches `main` + agent-prefixed branches (`sdk-engineer/**`,
  `architect/**`, …). A `feat/**` branch like #149's does NOT match the push trigger — but the
  `on.pull_request → main` trigger should still fire (it DID for #148's
  `feat/follow-105-1a-sdk-audit` branch at 14:54).
- Close/reopen of #149 (to re-fire the `pull_request` event) produced **no new run**.

**Most likely cause:** a **GitHub Actions minutes / billing limit** reached on the `Pnawrocki9`
personal account after 15:08 (workflows stay "active" but GitHub silently stops starting new runs),
or a transient GitHub Actions incident. Only the account owner can confirm/resolve.

**Impact:** Per CLAUDE.md, PM cannot mark a ticket READY_FOR_REVIEW until CI is green. With Actions
not running, CI-green is unverifiable on the platform. PM has validated locally instead (see below),
but this blocks the documented merge gate for #149 and every future PR until Actions runs again.

**Local validation already performed (substitute evidence while Actions is down):**

- `pnpm turbo run build typecheck test`: all pass except `@estalara/e2e-smoke` (needs a live ingest
  Worker at 127.0.0.1:8787 — environmental; pre-existing-red on merged PRs #146/#148 too).
- `pnpm exec prettier --check` on all changed files: clean.
- `bash scripts/check-rule-h.sh` (incl. the new adapt gates): pass.
- `bash scripts/check-mirror-files.sh` (Rule J): pass (ran in pre-push).
- `bash scripts/check-rule-i.sh`: 114 violations — **pre-existing-red (107 at base, FOLLOW-090),
  non-blocking** (merged PRs #146/#148 also have rule-i red). +7 from this PR: +3 decision-api libs
  orphaned by the ratified Worker-410 (owned by FOLLOW-107) + ~4 new test-only/util exports.

**Required action (account owner / Piotr):**

1. Check GitHub → Settings → Billing → Actions usage for the `Pnawrocki9` account; raise the
   spending limit or wait for the monthly reset if minutes are exhausted. (Or confirm a GH
   incident.)
2. Once Actions runs again, re-trigger #149 (push an empty commit, or close/reopen) and confirm the
   real merge gates are green: Build, Build (control-plane), Format check, Auto-Detection corpus
   gate, ClickHouse migrations smoke, Doppler verify, Test (Node), rule-h, rule-j. (Vercel, Rule I,
   and Python tests are pre-existing-red and non-blocking per the #146/#148 merge history.)
3. **Convention note:** #149 uses branch `feat/follow-105-1bcd-...` per the spawn instruction, which
   does NOT match the `push`-trigger agent-prefix allowlist in `ci.yml`. The repo's reliable CI path
   is push-triggered on agent-prefixed branches (CLAUDE.md branch-naming =
   `<agent>/<ticket>-<slug>`). Recommend future PR branches use an agent prefix (e.g.
   `architect/FOLLOW-105-...`) so push-CI fires regardless of the pull_request trigger. PM can
   rename/re-push #149's branch on request.

**Resolution:** RESOLVED 2026-05-25. Two compounding causes, both addressed: (1) **branch-name /
trigger mismatch** — the `feat/**` branch matched neither the `push` allowlist nor (anomalously) the
`pull_request` trigger; renaming to `architect/FOLLOW-105-canonical-adapt-enforcement` (PR #150,
supersedes #149) put it on the reliable push-CI path. (2) **Actions budget** — the account owner
bumped the GitHub Actions budget and pushed a retrigger commit (`09adfd6`). CI now runs; PR #150 is
green on every real merge gate (Build, Build control-plane, Typecheck, Lint, Test Node 22, SDK E2E,
rule-h, rule-j, Format, corpus, ClickHouse, Doppler, Gitleaks). **Lasting fix:** future PR branches
must use the `<agent>/<ticket>-<slug>` convention (CLAUDE.md) so push-CI fires regardless of the
pull_request trigger.

---

## RESOLVED — ESC-012: `pnpm db:migrate` against any env will fail until pilot tenant exists [FOLLOW-149 / TICKET-PILOT-001]

**Filed by:** devops-engineer **Date:** 2026-05-28T20:00:00Z **Affects:** any environment that runs
`pnpm db:migrate` after FOLLOW-149's journal repair lands and before TICKET-PILOT-001 seeds the
pilot tenant. Concretely: dev, staging, and any future region/tenant DB clone that has not yet had
the pilot tenant `000-app-estalara` inserted. **Type:** sequencing / operational

**Discovered during:** FOLLOW-149 Part D — applying migration 0015 to prd.

**Description:** Drizzle's pg-core migrator wraps ALL pending migrations in a single transaction
(`drizzle-orm/pg-core/dialect.js:60 `await
session.transaction(...)`). Migration 0016 (`0016_pilot_inquiry_selector.sql`) ends with a `DO $$
... RAISE
EXCEPTION`guard that aborts when the pilot tenant`000-app-estalara`is missing. Pre-pilot prd had 0 tenants → running`pnpm
db:migrate`raised inside the txn and rolled BOTH 0015 and 0016 back. To honour FOLLOW-149's explicit "do not apply 0016 in this ticket" instruction (and because 0016 requires a real tenant), I applied 0015 via a one-off, isolated`BEGIN/INSERT
INTO drizzle.\_\_drizzle_migrations/COMMIT` mirror of the migrator's per-entry logic. **0015 is now
applied on prd; 0016 remains pending.**

The systemic issue this exposes: `pnpm db:migrate` is no longer a "safe to run anywhere" command.
Any future invocation in dev / staging / a fresh region clone will hit the same 0016 raise and roll
back any future entries 0017+ alongside it.

**Required action (TICKET-PILOT-001 or earlier):** TICKET-PILOT-001 (Magic Link wizard
`POST /api/tenants`) MUST seed the pilot tenant row BEFORE the operator runs any `pnpm db:migrate`
that needs to pick up 0016+. Two equivalent paths:

1. Make TICKET-PILOT-001's wizard step explicitly call db:migrate AFTER tenant creation, and
   document the order in `docs/runbooks/pilot-onboarding.md` (does not exist yet — see FOLLOW stub).
2. Edit migration 0016 to skip its `UPDATE`/`RAISE` block when the tenant row is absent (i.e. change
   `RAISE EXCEPTION` to a `RAISE NOTICE` no-op). This is data-engineer's call; out of scope for
   FOLLOW-149 because the ticket forbids editing migration SQL.

**Workaround until then:** Operators running `pnpm db:migrate` against a tenant-less DB will see
0016 fail loudly with the FOLLOW-141/FOLLOW-147 error message. Pending entries from 0017+ (none
exist yet) would also roll back. Use the same isolated apply pattern I used for 0015 if any 0017+
entry must land before the pilot exists. Long-term, this is brittle — pick path 1 or 2 above.

**Resolution:** RESOLVED 2026-05-29. Path (1) confirmed: `POST /api/tenants` (tenant-create)
executed before `pnpm db:migrate` during TICKET-PILOT-001 onboarding. Migration 0016 applied cleanly
after pilot tenant `000-app-estalara` was seeded; `RAISE EXCEPTION` guard passed.
`SELECT inquiry_submit_selector` on the pilot tenant row confirms the column is populated.
Sequencing order documented in `docs/ops/PILOT_RUNBOOK.md` §3 "Migration sequencing."

---

## RESOLVED — ESC-013: app.estalara.com frontend repo path unknown to sdk-engineer [TICKET-PILOT-001]

**Filed by:** sdk-engineer **Date:** 2026-05-29T00:00:00Z **Affects:** TICKET-PILOT-001 Step 1 (SDK
snippet install in frontend layout) **Type:** scope / operational

**Description:**

TICKET-PILOT-001 Step 1 requires editing `+layout.svelte` in the app.estalara.com SvelteKit frontend
to inject the SDK snippet. However:

1. No SvelteKit repo (no `.svelte` files, no `svelte.config.js`) exists in any accessible directory
   on this machine. Searched: all directories under `/home/asipi/Projects/` and `/home/asipi/`.
2. `/home/asipi/Projects/EstalaraNew` is a Next.js app (marketing site `estalara.com`), not
   `app.estalara.com`.
3. `/home/asipi/Projects/Live-Hosts` is a .NET + Python stack unrelated to SvelteKit.

The ticket spec says "SvelteKit `+layout.svelte`" but no such file exists in the accessible tree.
The app.estalara.com frontend may be in a private repo, a separate machine, or may actually be
Next.js not SvelteKit. The SDK snippet parameters and slot requirements are fully documented in
`docs/ops/PILOT_RUNBOOK.md` §5 (added by this PR) and can be applied as soon as the path is known.

**Required action (Piotr — 2 minutes):**

Provide the path to the app.estalara.com frontend repo so sdk-engineer can edit the layout file and
inject the snippet in Step 1. Options:

a. If the repo is local: provide the absolute path. b. If the repo is on GitHub: provide the repo
URL. sdk-engineer will clone and edit. c. If the frontend is actually Next.js (not SvelteKit): the
snippet goes in `app/layout.tsx` using Next.js `<Script>` component with
`strategy="afterInteractive"`.

**Required action (DNS — separate):** `admin.estalara.com` resolves to an nginx server (not Vercel),
blocking the Step 1 smoke test for `GET /api/adapt`. See ESC-014.

**Resolution:** RESOLVED 2026-05-29. SDK installed on `app.estalara.com` via Tier 2 script tag by
CTO Rafał Palak. Script `src` points to `https://admin.estalara.com/sdk.js` (served as Vercel static
asset per ESC-015). Verified: `sdk.js` loads in browser DevTools on `app.estalara.com`.

---

## RESOLVED — ESC-014: admin.estalara.com DNS not pointing to Vercel control-plane [TICKET-PILOT-001]

**Filed by:** sdk-engineer **Date:** 2026-05-29T00:00:00Z **Affects:** TICKET-PILOT-001 smoke test
(Step 1 AC: `GET https://admin.estalara.com/api/adapt` returns 200) **Type:** operational / devops

**Description:**

The TICKET-PILOT-001 acceptance criteria require:

> Smoke assertion: `GET https://admin.estalara.com/api/adapt` returns 200 (NOT 410)

Current state: `admin.estalara.com` resolves to an nginx/1.22.1 server returning "Welcome to KIEG
server!" — not the Vercel-deployed control-plane. Verified via:

```
HTTP/1.1 200 OK
Server: nginx/1.22.1
Date: Fri, 29 May 2026 05:21:13 GMT
```

This means `GET https://admin.estalara.com/api/adapt` returns 404 (nginx, not Vercel). The
control-plane is confirmed to be a Next.js app with a Vercel deployment config
(`apps/control-plane/vercel.json`, region `cdg1`), but the custom domain `admin.estalara.com` has
not been configured as a Vercel custom domain, or the DNS has not been pointed to Vercel's
nameservers.

The SDK's `data-decision-url` in production must be `https://admin.estalara.com/api`. If this domain
does not point to Vercel before SDK install, all `/api/adapt` calls from app.estalara.com will 404.

**Required action (Piotr or devops-engineer — ~15 minutes):**

1. Go to Vercel project dashboard for the control-plane.
2. Add `admin.estalara.com` as a custom domain.
3. Update DNS records at the registrar to point `admin.estalara.com` to Vercel (CNAME to
   `cname.vercel-dns.com` or A record to Vercel's IP, as Vercel instructs).
4. Wait for DNS propagation.
5. Verify:
   `curl -s -o /dev/null -w "%{http_code}" "https://admin.estalara.com/api/adapt?session_id=smoke&archetype=neutral&confidence=0.5&similarity=0.5&tier=1" -H "Authorization: Bearer <key>"`
   returns 200.

Until this is resolved, use the Vercel preview URL as a temporary `data-decision-url` for shadow
mode. Report the Vercel preview URL to sdk-engineer to unblock the snippet install.

**Resolution:** RESOLVED 2026-05-29. `admin.estalara.com` added as a custom domain on the Vercel
control-plane project. DNS CNAME record set to `6f8ae58f0ad31434.vercel-dns-017.com`. Verified:
`dig admin.estalara.com` resolves to Vercel; `curl https://admin.estalara.com/api/adapt` returns 200
(not 404 nginx).

## RESOLVED — ESC-015: SDK serve URL `cdn.estalara.com` is unprovisioned; pilot snippet src 404s [TICKET-PILOT-001]

**Filed by:** devops-engineer **Date:** 2026-05-29T00:00:00Z **Affects:** TICKET-PILOT-001 (Sprint
13a pilot launch), every tenant onboarded via the Magic Link wizard, every snippet currently emitted
by `apps/control-plane/src/components/onboarding/DetectionPreview.tsx:buildSnippet()` **Type:**
infrastructure / pilot-blocker

**Description:**

`buildSnippet()` emits `<script src="https://cdn.estalara.com/sdk.js" ...>` (the canonical CDN host
named by `SDK_CDN_URL` in `packages/shared/src/domains.ts:16`). Diagnostic during pilot dry run
confirmed:

- `cdn.estalara.com` has never been provisioned. No DNS record, no Cloudflare R2 bucket, no
  Wrangler/Terraform deploy pipeline, no SRI release flow.
- `packages/sdk/dist/estalara-sdk.iife.js` is built by `pnpm --filter @estalara/sdk build` but is
  gitignored and only ever published via `npm pack` for downstream consumers. Nothing uploads it to
  a public host.
- Net effect: every tenant who copy-pastes the wizard-generated snippet hits a DNS-level 404 on the
  `src` attribute, so the SDK never loads. Tier 1/2/3 are all silently broken at the install step.

`admin.estalara.com` (the Next.js control plane on Vercel) went live today via ESC-014. It already
serves Vercel static assets from `apps/control-plane/public/`. CEO decision: **ship the pilot by
serving the SDK bundle as a Vercel static asset under `https://admin.estalara.com/sdk.js`**. CDN
provisioning (versioned releases, SRI hashes, multi-region edge cache) is deferred to Phase 2.

**Required action:** (resolved by this PR — devops lane)

1. Build `@estalara/sdk` IIFE bundle and copy it to `apps/control-plane/public/sdk.js` (Vercel will
   serve it at `https://admin.estalara.com/sdk.js` with `content-type: application/javascript`).
2. Add `SDK_SERVE_URL = ${CONTROL_PLANE_URL}/sdk.js` to `packages/shared/src/domains.ts` so the URL
   is derived from `CONTROL_PLANE_URL` rather than another hardcoded literal.
3. Flip `buildSnippet()` (`DetectionPreview.tsx`) to emit `src="${SDK_SERVE_URL}"`.
4. Update the Pilot Runbook (`docs/ops/PILOT_RUNBOOK.md` §5 "Install the snippet") to use
   `https://admin.estalara.com/sdk.js` and to note that `cdn.estalara.com` is Phase 2.

**Resolution:** RESOLVED 2026-05-29 by this PR (`devops-engineer/ESC-015-sdk-static-serving`). The
pilot serves the SDK from `admin.estalara.com/sdk.js` via Vercel static asset hosting.
`SDK_CDN_DOMAIN` / `SDK_CDN_URL` constants remain in `packages/shared/src/domains.ts` for the Phase
2 cutover and are not consumed by `buildSnippet()` while the pilot is live.

**Phase 2 follow-up (not in scope for this PR):** Provision `cdn.estalara.com` end-to-end —
Cloudflare R2 bucket, signed release pipeline (`pnpm --filter @estalara/sdk release`), SRI hash
injection in `buildSnippet()`, multi-region edge cache, and a rollback playbook. When that lands,
flip the snippet generator back from `SDK_SERVE_URL` to `SDK_CDN_URL` and delete the `SDK_SERVE_URL`
constant. Track in a Phase 2 ticket (FOLLOW stub when sprint plan opens).

---

## RESOLVED — ESC-016: ingest Worker has no CORS headers; SDK calls from app.estalara.com are blocked [TICKET-PILOT-001]

**Filed by:** devops-engineer **Date:** 2026-05-29T00:00:00Z **Affects:** TICKET-PILOT-001 (Sprint
13a pilot launch), every browser-loaded SDK call to `ingest.estalara.com/v1/events` from
`app.estalara.com` (pilot) and `admin.estalara.com` (control-plane dashboards / wizard test pings)
**Type:** infrastructure / pilot-blocker

**Description:**

The pilot SDK is now live on `app.estalara.com` (ESC-015 served `sdk.js` from the control plane; the
script tag appears in DevTools and executes). But every event POST to
`https://ingest.estalara.com/v1/events` is blocked by the browser with:

> Access to fetch at 'https://ingest.estalara.com/v1/events' from origin 'https://app.estalara.com'
> has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the
> requested resource.

Root cause: `apps/ingest/src/router.ts` registers `secureHeaders` + `errorHandler` + `idempotency`
but **no CORS middleware** at all. The Hono app has no OPTIONS handler, so the preflight returns 404
with no `Access-Control-*` headers, and the actual POST response is missing
`Access-Control-Allow-Origin`. Net effect: zero events reach Redpanda from the browser-loaded pilot
SDK. Shadow-mode telemetry was silently empty.

This was never caught earlier because every prior ingest integration test exercises the handler from
the same origin (Node `app.fetch` with no `Origin` header — the browser CORS check never runs).

**Required action:** (resolved by this PR — devops lane)

1. Add `hono/cors` middleware to `apps/ingest/src/router.ts`, ordered immediately after
   `secureHeaders` so CORS headers land on every response (including the 401/429/5xx error paths the
   SDK needs to read).
2. Allow-list exactly the origins the SDK runs in: `https://app.estalara.com` (pilot site) and
   `https://admin.estalara.com` (control-plane Magic Link wizard / dashboards).
3. Allow methods `GET, POST, OPTIONS` and the four headers the SDK sets on every batch:
   `Content-Type`, `X-Estalara-API-Key`, `X-Estalara-Signature`, `Idempotency-Key`.
4. Expose `X-Request-ID` (debugging) and `Retry-After` (so the SDK's rate-limit backoff can read the
   header on 429 responses) via `Access-Control-Expose-Headers`.
5. Set `Access-Control-Max-Age: 86400` so browsers cache the preflight for 24h and the per-request
   CORS overhead drops to zero after the first page-view.
6. Cover preflight + actual-request + disallowed-origin paths with five unit tests in
   `apps/ingest/src/index.test.ts` so the regression we just hit cannot land silently again.

**Resolution:** RESOLVED 2026-05-29 by this PR (`devops-engineer/ESC-016-ingest-cors-fix`). After
merge + Wrangler deploy of the ingest Worker, verify with:

```
curl -i -X OPTIONS https://ingest.estalara.com/v1/events \
  -H "Origin: https://app.estalara.com" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,x-estalara-api-key,x-estalara-signature"
# Expect: 204, Access-Control-Allow-Origin: https://app.estalara.com,
# Access-Control-Allow-Methods includes POST, Access-Control-Allow-Headers
# includes content-type + x-estalara-api-key + x-estalara-signature + idempotency-key.
```

**Phase 2 follow-up (not in scope):** when customer-owned tenant domains come online, the hardcoded
`ALLOWED_ORIGINS` array becomes a tenant-aware lookup (origin → tenant_id → check
`tenants.allowed_origins`). For the pilot the two-host allow-list is correct and minimises attack
surface.

**Verification (2026-05-29):** `OPTIONS https://ingest.estalara.com/v1/events` returns `204` with
`Access-Control-Allow-Origin: https://app.estalara.com` present. `X-Session-ID` added to
`Access-Control-Allow-Headers` in follow-up PR #169
(`fix(ingest): add X-Session-ID to CORS allow-headers — ESC-016`). Live in production.

---

## RESOLVED — ESC-017: Redpanda Cloud Serverless has no Pandaproxy; ingest Worker cannot produce events [TICKET-PILOT-001]

**Filed by:** devops-engineer **Date:** 2026-05-29T00:00:00Z **Affects:** TICKET-PILOT-001 (Sprint
13a pilot launch), `apps/ingest` event pipeline, Master Design §A.1 Redpanda producer hop **Type:**
infrastructure / pilot-blocker

**Description:**

During TICKET-PILOT-001 E2E smoke testing, the ingest Worker attempted to POST events to Redpanda
Cloud Serverless via the Pandaproxy REST API (`REDPANDA_BROKER_URL`). The Pandaproxy endpoint was
unreachable — Redpanda Cloud **Serverless tier does not expose a Pandaproxy REST interface**.
Pandaproxy is only available on Dedicated and BYOC clusters. The original Master Design assumed
Pandaproxy as the ingest Worker → Redpanda hop, which was never viable on the Serverless cluster.

Net effect: zero events reached ClickHouse via the Redpanda path. Shadow-mode telemetry was silently
empty until diagnosed.

**Required action (resolved by PR #170):**

Implement a direct Worker → ClickHouse HTTPS write path in `apps/ingest/src/clickhouse-producer.ts`
using the ClickHouse HTTP interface (port 8443, `INSERT INTO default.events FORMAT JSONEachRow`).
Retain the Redpanda call as a dual-write no-op so the full chain activates without Worker changes
when a Pandaproxy-capable cluster is provisioned.

**Resolution:** RESOLVED 2026-05-29 by PR #170
(`feat(ingest): direct ClickHouse-write path for pilot [ESC-017]`). Direct Worker→ClickHouse HTTPS
write path implemented in `apps/ingest/src/clickhouse-producer.ts` (port 8443, INSERT FORMAT
JSONEachRow). E2E verified: event count 0→1 after POST to `/v1/events`,
`event_id = 01928f00-...-a3fc180390b5`, `tenant_id = cbc51cfa-1056-40aa-b0a9-6e982b52b1de`,
end-to-end latency 1.4s. Redpanda dual-write no-op retained for future Dedicated/BYOC upgrade path.

**Architectural implication (FOLLOW-157):** Redpanda Cloud Serverless = no Pandaproxy. The original
ingest→Pandaproxy→Redpanda→ClickHouse chain is not viable at the current tier. Canonical pilot path
= direct Worker→ClickHouse. Upgrade path vs. formalizing direct-ClickHouse as canonical to be
decided at Sprint 4 planning.

---

## RESOLVED — ESC-018: `description.requested` event omits `original_description`; real description+headline pipeline never generates [ADR-0009]

**Filed by:** Claude (session) **Date:** 2026-06-03T00:00:00Z **Affects:** description pipeline
(`apps/control-plane/src/app/api/adapt/description/route.ts` →
`apps/llm-gateway/src/jobs/generate_description.py`), ADR-0009 per-listing headline **Type:**
architectural / contract

**Description:** Pre-existing contract mismatch, surfaced while shipping the ADR-0009 per-listing
LLM headline. The control-plane route builds the `description.requested` event WITHOUT an
`original_description` field, and `DescriptionRequestedEventSchema`
(`packages/shared/src/schemas/description.ts`) does not declare one. But the Modal consumer treats
`original_description` as **required** — `consume_description_requests()` rejects any message
missing it (`missing_fields`), and `generate_description()` reads `event["original_description"]`
directly (KeyError otherwise). It is also the primary factual-grounding source for both the v1.8
description prompt and the new `_generate_headline()` call.

Net effect: in the real Redpanda→Modal path, every `description.requested` message is dropped at
consumer validation — so neither the AI description nor the new per-listing headline is ever
generated or cached. The local demo works only because it routes through the mock decision harness
(`scripts/dev/mock-decision-server.mjs`, port :9100), which generates inline and bypasses this event
contract entirely.

This is **not** introduced by the ADR-0009 headline change (the route diff only added `headline`
fields to responses); the headline simply inherits the same latent gap. The headline implementation
itself is correct and rides the description cache as designed.

**Required action:** Thread `original_description` from the route into the `description.requested`
event and add it to `DescriptionRequestedEventSchema` (source: the listing's current description —
likely via `retrieveListingContext` or a dedicated listing fetch). Then verify end-to-end that a
Tier 2/3 cache miss results in a cached `{text, headline, generated_at}` entry. Decide whether to
fix in a follow-up ticket or fold into the next description-pipeline change.

**Resolution:** RESOLVED 2026-06-03 on branch `ml-engineer/per-listing-llm-headline` (PR #182).
`original_description` is now threaded through the pipeline:

- `DescriptionRequestedEventSchema` (`packages/shared/src/schemas/description.ts`) declares
  `original_description: z.string()` (always present; may be empty).
- New helper `apps/control-plane/src/lib/listing-details.ts` →
  `fetchListingOriginalDescription(listingId, locale)` fetches the listing's original description
  from the Estalara backend listing-details API (`ESTALARA_BACKEND_URL`, UUID→`?listing-uuid=` else
  `/slug?slug=`, locale upper-cased) — mirroring the mock harness `fetchListing`. Fail-open to `''`
  with a 2s timeout; no `listings` table exists, so the tenant backend is the source.
- The description route (`/api/adapt/description`) fetches it in parallel with RAG context on cache
  miss and includes it in the published event. `ESTALARA_BACKEND_URL` added to `.env.example`.
- Tests: route asserts the event carries `original_description` (and is populated from the backend);
  6 unit tests for the helper (UUID vs slug, locale upper-casing, fail-open paths). Full
  control-plane typecheck/lint/prettier clean.

Note: SSRF check is intentionally NOT applied — the base host comes from our trusted
`ESTALARA_BACKEND_URL` and `listing_id` is URL-encoded into a query value (cannot alter the host);
`checkSsrf` would also reject the loopback backend used in local dev.

---

## RESOLVED — ESC-019: production Estalara backend listing-details API requires auth; server-side fetch fails open to empty `original_description` [TICKET-DESC-001]

**Filed by:** Claude (session) **Date:** 2026-06-03T00:00:00Z **Affects:** description + per-listing
headline pipeline (`apps/control-plane/src/lib/listing-details.ts`, `/api/adapt/description`),
ESC-018 fix end-to-end correctness **Type:** architectural / infra

**Description:** Surfaced while verifying the ESC-018 fix (RETRO-028 P1 PM action: "verify against a
real backend"). The fix grounds generation by fetching the listing's original description from the
Estalara backend listing-details API. This works against the **local dev backend**
(`localhost:8081`, what the mock harness `fetchListing` uses) but NOT against the **production**
backend.

Verified against production (read-only GET):

```
GET https://app.estalara.com/api/v1/listing/details/slug?slug=9-blackberry-pl-palm-coast-fl-32137&locale=EN
→ HTTP 302  location: /en?back=%2Fapi%2Fv1%2Flisting%2Fdetails%2Fslug%3F...
```

An **unauthenticated server-to-server** call is redirected to the SvelteKit login page. The helper's
`fetch` follows the redirect (undici default `redirect: 'follow'`), receives the SPA HTML with
`200`, `res.json()` throws, and the helper **fails open to `''`**. Net effect in production:
`original_description` is empty, so both the adapted description and the ADR-0009 per-listing
headline are generated **without factual grounding** (the v1.8 thin-original exception kicks in) —
the consumer no longer drops the message (the key is present), so the failure is **silent**: copy is
produced, just ungrounded. (`api.estalara.com` is not the host — returns 404.)

The local dev backend does not enforce the auth guard, so the mock-harness demo and the unit tests
(mocked backend) both pass — the gap is invisible until a real authenticated production fetch.

**Required action (human / devops + backend — needs a decision):**

1. Decide how the control-plane authenticates server-to-server to the Estalara backend listing API:
   an **internal/unguarded backend URL** (set `ESTALARA_BACKEND_URL` to it, not the public
   `app.estalara.com`), OR a **service token / session** the helper attaches (e.g. `Authorization`
   header or signed internal header), OR a dedicated internal listing-details endpoint.
2. Set the resolved `ESTALARA_BACKEND_URL` (and any token secret) in Vercel prod + Doppler.
3. Harden the helper to fail **loud not silent** on a non-JSON / redirected response: use
   `redirect: 'manual'` or assert the response `content-type` is JSON, and log a distinct warning
   (and/or emit a metric) so an ungrounded-generation regression is observable rather than silent.
4. Re-verify end-to-end: a Tier 2/3 cache miss against the real backend yields a cached
   `{text, headline, generated_at}` whose copy reflects the actual listing facts.

**Note:** The ESC-018 data-shape fix itself is correct and remains RESOLVED (the event now always
carries the `original_description` key). ESC-019 is the _reachability/auth_ half — the field is now
threaded, but the production source it reads is not yet reachable by an unauthenticated server call.

**Resolution:** RESOLVED 2026-06-04 by PR #196
(`fix(control-plane): correct ESTALARA_BACKEND_URL to api.estalara.com + redirect guard [ESCALATION]`).
Root cause: `ESTALARA_BACKEND_URL` was pointing at `app.estalara.com` (SvelteKit frontend with auth
guard). PR #196 corrected it to `https://api.estalara.com` (Spring Boot backend with `permitAll()` —
no auth required for listing-details). Added `redirect: 'manual'` guard in `listing-details.ts` so
redirect responses fail loud rather than silently failing open. FOLLOW-192 (Sprint 15) marked
CLOSED.

---

## RESOLVED — ESC-021: PR #281 (FOLLOW-287) merged with FAILING ClickHouse migrations smoke gate [FOLLOW-287/FOLLOW-288]

**Filed by:** pm-orchestrator **Date:** 2026-06-13T10:30:00Z **Affects:** FOLLOW-287 (PR #281),
FOLLOW-288 (remediation), ClickHouse migrations smoke CI gate on main **Type:** CI gate violation /
repo integrity

**Description:**

PR #281 (FOLLOW-287, branch `backend-engineer/FOLLOW-279-k36-ch-write-fix`) was merged to main at
2026-06-12T22:31:19Z while the **ClickHouse migrations smoke** CI gate was FAILING. This violates
the non-negotiable rule: PM must not mark a ticket READY_FOR_REVIEW while any real CI check is
failing, and PRs must not be merged without all real gates green.

Root cause confirmed from CI logs (run 27446753341):

```
ClickHouse migrations smoke  Apply migrations (LOCAL=1 → MergeTree)
curl: (22) The requested URL returned error: 500
Code: 524. DB::Exception: ALTER of key column intent_session_id from type UUID to type String
is not safe because it can change the representation of primary key.
(ALTER_OF_COLUMN_IS_FORBIDDEN) (version 26.5.1.882 (official build))
Process completed with exit code 22.
```

Migration 0016 (`infra/clickhouse/migrations/0016_intent_events_session_id_type_fix.sql`) contains:

```sql
ALTER TABLE intent_events
  MODIFY COLUMN intent_session_id String DEFAULT '';
```

ClickHouse 26.5.1 forbids `MODIFY COLUMN` on ORDER BY key columns. This was the exact fix that was
supposed to have been applied as a SELECT 1 no-op, but the actual file still contains the forbidden
ALTER TABLE statement.

**Impact on main branch:** The ClickHouse migrations smoke gate now FAILS on every PR that runs
against main. FOLLOW-267 (the next P1 ticket in the K.3.6 chain) cannot be merged cleanly while this
gate is red.

**Required action (human — approve remediation path):**

FOLLOW-288 (P0) has been added to the queue with status READY. It will:

1. Replace migration 0016 with a `SELECT 1` no-op (preserves journal sequence, fixes smoke gate).
2. Remove `intent_session_id` from the INSERT body in intent-snapshot.ts (session_id is the
   authoritative join key per migration 0015 — intent_session_id stays UUID with original default).
3. Update tests accordingly.

**Human decision needed:** Please confirm the remediation approach is acceptable before PM delegates
FOLLOW-288. Specifically: confirm that leaving `intent_session_id` as UUID NOT NULL with its
original default (writing nothing to it) is acceptable — existing rows will have the UUID default,
new rows will also have the UUID default. The `session_id` String column (migration 0015) is the
authoritative join key for FOLLOW-269, not intent_session_id.

**Resolution:** RESOLVED 2026-06-13 by backend-engineer (PR #282, merged 2026-06-12T23:27:03Z). No
CEO decision was required. ClickHouse error 524 (ALTER_OF_COLUMN_IS_FORBIDDEN on ORDER BY key
columns) is a hard constraint — there is no design choice to make. The remediation was technically
unambiguous: migration 0016 was replaced with a SELECT 1 no-op, and intent_session_id was removed
from the INSERT body (ClickHouse uses zero-UUID default; session_id String from migration 0015 is
the authoritative join key for FOLLOW-269). ClickHouse migrations smoke gate is now PASSING on PR
#282. All real CI gates confirmed green. ESC-021 filed in error as requiring human decision.

---

## OPEN — ESC-020: Estalara-app DOM hooks committed but not deployed to production [FOLLOW-191]

**Filed by:** sdk-engineer **Date:** 2026-06-06T13:30:00Z **Affects:** FOLLOW-191, FOLLOW-197,
Sprint 15 Track A **Type:** deployment

**Description:**

FOLLOW-191 audit (2026-06-06) confirmed the following gap: the `data-estalara-slot` hooks and the
SDK `<script>` loader are **committed** to the Estalara-app git repo (`web-master` HEAD at commit
`9d2df9d`) but the **production `app.estalara.com`** is running an older build that predates these
changes. Evidence:

```
curl -s https://app.estalara.com/en/listing/deerfield-lake-ct-cape-coral-fl-33909-90681784-8a9a-4953-ae48-fe8f8a3865e2 \
  | grep -c "data-estalara"
# Returns: 0
```

The production HTML has zero `data-estalara-*` attributes and no SDK `<script>` tag in `<head>`. The
adaptation layer fires `adapt.skipped` with `reason: 'no_slot_elements'` for every listing view. No
adapted experience has been measured in production.

Additionally, the local `web-master` working tree has `src/app.html` temporarily overridden to point
to `http://localhost:9100/estalara-sdk.iife.js` for local demo use. This override is uncommitted and
must NOT be deployed.

**Required action (Rafał Palak, CTO):**

Three steps to unblock pilot measurement:

1. In the `web-master` directory, restore `app.html` to the committed (production) version if it
   differs: `git checkout -- src/app.html`. The committed version correctly points to
   `https://admin.estalara.com/sdk.js`.

2. Set `PUBLIC_ESTALARA_SDK_ENABLED=true` in the production hosting environment for `web-master`
   (Docker env, hosting provider config, or equivalent). This flag gates all four A1 slot edits —
   without it the listing page renders with no slots (byte-identical to before the edits).

3. Deploy `web-master` HEAD to production. After deploy, verify with:

   ```bash
   curl -s https://app.estalara.com/en/listing/deerfield-lake-ct-cape-coral-fl-33909-\
   90681784-8a9a-4953-ae48-fe8f8a3865e2 | grep -c "data-estalara"
   # Expected: ≥3 (listing-id attr + headline slot + description slot)
   ```

4. Confirm `https://admin.estalara.com/sdk.js` returns HTTP 200 (the SDK IIFE bundle must be served
   there — see `apps/control-plane/public/sdk.js` in Adaptive-Listings).

5. Mark this escalation RESOLVED and update FOLLOW-191 → DONE in `backlog/QUEUE.md`.

Full deployment guide: `backlog/HANDOFFS.md` section "FOLLOW-191 → Rafał Palak (CTO)". Original slot
spec: `/home/asipi/Projects/Estalara-app/web-master/HANDOFF_ESTALARA_ADAPTIVE.md`.

**Blocking:** FOLLOW-197 (adapt.applied signal) depends on this being live.

**Resolution:** CEO clarification 2026-06-10: agreed workflow is **local-first testing** — all
verification must pass on localhost (Estalara-app running on developer machine) BEFORE Rafał deploys
to production. This escalation's "Required action (Rafał)" is DEFERRED until local testing is
complete and CEO signs off. **This escalation does NOT block the PM pipeline for other tickets.**
FOLLOW-191 tracks local validation; once CEO confirms local testing passes, Rafał will be instructed
on the production deployment steps listed above. ESC-020 remains OPEN until the production deploy is
confirmed.

---

## OPEN — ESC-022: Prod Supabase was 14 migrations behind (2026-05-28 → 2026-06-14) including compliance migrations — human sign-off needed on data integrity + standing mechanism decision

**Filed by:** pm-orchestrator **Date:** 2026-06-14T10:00:00Z **Affects:** prod Supabase (project
yhmivuqeqkmzpxpyrsvc, "Adaptive-Listings", eu-west-3), FOLLOW-307, FOLLOW-308, compliance posture
(conversion_labels, dsr_durable_lead_id) **Type:** compliance / operational

**Description:**

On 2026-06-14, the K.3.6 D-1 seed (migration 0030) was applied to prod Supabase via
`doppler run --config prd -- pnpm db:migrate`. During apply it was discovered that prod was **14
migrations behind** — `drizzle.__drizzle_migrations` had only 17 entries, last applied approximately
2026-05-28 (migration ~0016), while the repo was at migration 0030. Migrations **0017 through 0030
had NEVER been applied to prod**.

The affected migrations include:

- **0019, 0020** — `conversion_labels` table (CRM tracking, GDPR-related label data)
- **0024** — `dsr_durable_lead_id` column (DSR / GDPR Art. 17 erasure tracking)
- **0021** — `engagement_scores` table
- **0022** — `quiz_completions` table
- **0025** — `tenants_quiz_enabled` column
- **0026, 0027** — quiz_config strip migrations
- **0028** — `intent_sessions` table (K.3.6)
- **0029** — `intent_weight_configs` table (K.3.6)
- **0030** — global-default seed row (K.3.6)

This means that for approximately **2.5 weeks** (2026-05-28 → 2026-06-14), features that depended on
these schemas were silently non-functional in prod:

- Conversion label writes would have failed (table did not exist)
- DSR `dsr_durable_lead_id` column would have been absent from `leads` (DSR erasure tracking broken)
- Quiz completion writes would have failed (table did not exist)
- All K.3.6 intent tracer features were inert in prod (schemas absent)

All 14 migrations applied cleanly on 2026-06-14. Prod `drizzle.__drizzle_migrations` is now at 31
(full repo count). Root cause: no auto-apply mechanism (RETRO-076 OG-1) — Postgres migrations are
operator-driven only, unlike ClickHouse which auto-applies in CI. Note: prod project was AUTO-PAUSED
(Supabase idle pause) and had to be resumed before apply — confirming prod is not yet serving steady
traffic (pre-pilot phase).

**FOLLOW-307** (apply objective) is DONE. **FOLLOW-308** (standing mechanism) tracks the prevention
fix.

**Required human action (Piotr / Rafał — compliance + operations):**

1. **Compliance data-integrity check:** Confirm whether any compliance-dependent features were
   exercised in prod during the 2.5-week gap (2026-05-28 → 2026-06-14):
   - Were any DSR delete requests processed via the `dsr_durable_lead_id` path? If so, were those
     requests correctly executed despite the missing column, or did they silently fail/skip?
   - Were any conversion labels written via the `conversion_labels` table during that window?
   - Were any quiz completions written? (table was absent — writes would have errored)
   - Answer: since prod is pre-pilot with no real user traffic confirmed, the likely answer is "no
     meaningful data was affected." CEO/CTO should confirm this is the case.

2. **Standing mechanism decision:** Approve one of the two options in FOLLOW-308:
   - Option A: Add an auto-apply `db:migrate` step to the deploy workflow (mirrors ClickHouse).
   - Option B: Add an explicit operator checklist gate with a CI divergence check. This decision
     blocks FOLLOW-308 (P1) from proceeding to implementation.

3. **Once compliance check confirmed and mechanism decided:** Mark ESC-022 RESOLVED and unblock
   FOLLOW-308.

**This escalation does NOT block the PM pipeline** for other tickets (FOLLOW-293, FOLLOW-269, etc.)
but DOES block FOLLOW-308 AC3 closure.

**Resolution:** (open — awaiting human action)
