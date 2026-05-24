# FOLLOW-079 — Tighten demo-integration.yml: flip soft-skips to fail-loud

**Sprint:** 12  
**Lane:** A (pilot-critical hardening — gates Lane B)  
**Agent:** devops-engineer  
**Model:** sonnet-4.6  
**Priority:** P1  
**Estimated hours:** 1  
**Branch:** `devops-engineer/FOLLOW-079-demo-ci-failloud`  
**Depends on:** FOLLOW-040 (merged PR #138) — DOPPLER_TOKEN_DEV must be provisioned  
**Precondition (human action):** ESC-009 E2E_BEARER_TOKEN secret must be provisioned by Piotr before
this ticket can complete fully

---

## Context

FOLLOW-068 (PR #137) shipped the `demo-integration` CI job but with soft-skip guards:

- If `DOPPLER_TOKEN_DEV` is absent → job exits 0 (skips silently)
- If Next.js server doesn't reach `401/200/405` on `/api/adapt` within 120s → job exits 0 with a
  warning

This means the E2E detect→activate→adapt→SDK chain has **never been CI-verified in a fail-loud
mode**. A regression in any of those 4 hops would silently pass CI.

FOLLOW-040 (PR #138) provisioned DOPPLER_TOKEN_DEV in GitHub Actions. ESC-009 is the remaining
manual action (Piotr adds E2E_BEARER_TOKEN secret — ~5 min). Once both secrets are present, this
ticket flips the workflow to fail-loud.

---

## Acceptance Criteria

1. **Remove the `if: env.HAS_CREDS == 'false'` soft-skip path** — if DOPPLER_TOKEN is absent the job
   should fail, not skip. The secret is now provisioned (FOLLOW-040).

2. **Remove the `if: env.SERVER_HEALTHY == 'false'` soft-skip path** — if Next.js fails to start,
   the job should fail.

3. **The `demo-integration` job must be added to required status checks** for PRs targeting `main`.
   Document in `docs/ops/BRANCH_PROTECTION.md` (create if it doesn't exist) or add a comment in the
   workflow file listing which required checks to configure in GitHub Settings → Branch protection
   rules.

4. **Update workflow comments** — remove all "soft-skip" language from the step names and comments.
   Replace with "fail-loud" language.

5. **Preserve the E2E_BEARER_TOKEN absent guard in `beforeAll()`** — the
   `tests/e2e/sprint-9-5-demo.spec.ts` beforeAll() should still fail fast with an actionable error
   if the token is not set. This is a clear fail, not a skip.

6. **Verify locally** (or document) that with `HAS_CREDS=false`, the job now fails rather than
   soft-skips. Include evidence in PR description.

7. **No application code changes** — this is a CI workflow and process hardening ticket only.

---

## Key files to read first

- `.github/workflows/demo-integration.yml` — full workflow file; understand the `HAS_CREDS` and
  `SERVER_HEALTHY` guard logic
- `.github/workflows/ci.yml` — understand existing required checks and job naming conventions
- `tests/e2e/sprint-9-5-demo.spec.ts` — understand the E2E spec beforeAll() guard

---

## Implementation notes

- The `check-creds` step logic (lines 56-67 of demo-integration.yml) sets `HAS_CREDS=true/false`.
  With DOPPLER_TOKEN_DEV now provisioned, this step should no longer need to handle the `false` path
  gracefully — the whole job fails if the secret is absent.
- Consider simplifying the step from `if [ -n "$DOPPLER_TOKEN" ]; then` to just asserting the token
  is non-empty and failing fast:
  `if [ -z "$DOPPLER_TOKEN" ]; then echo "DOPPLER_TOKEN_DEV not set — CI misconfigured"; exit 1; fi`
- The "soft-skip notice" steps at the bottom of the workflow (lines 152-200) can be removed
  entirely.
- Branch protection rule change: document in PR description exactly which setting to enable in
  GitHub UI: Settings → Branches → Branch protection rules → main → Require status checks to pass →
  add `Demo integration (detect → activate → adapt → SDK)`.

---

## Definition of Done

- [ ] `.github/workflows/demo-integration.yml` has no soft-skip paths — job fails if secrets absent
      or server unhealthy
- [ ] PR description documents the GitHub branch protection rule to add
- [ ] `tests/e2e/sprint-9-5-demo.spec.ts` beforeAll() guard still present and working
- [ ] CI standard test-node job still passes
- [ ] Workflow passes on a PR (DOPPLER_TOKEN_DEV now available)
