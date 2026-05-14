# Conventions Patch — Estalara Adaptive Listings

Permanent rules codified from lessons learned. Rules A–F come from Paczka 1 retrospective. Rules G+
are added by the `retrospective-analyst` agent when the same finding pattern appears in ≥2
per-ticket retrospectives (RULE_PROMOTION_THRESHOLD = 2).

**This file is authoritative.** When a rule here conflicts with older prose in CLAUDE.md, this file
wins. PM orchestrator includes the current rules in every worker delegation prompt.

---

## Rule A — Always verify CI green before READY_FOR_REVIEW

**Pattern:** Marking ticket READY_FOR_REVIEW based only on local test pass, without waiting for
GitHub Actions CI to complete.

**Evidence:** Paczka 1 TICKET-001 (original failure mode documented in pm-orchestrator.md)

**Rule:** PM-orchestrator MUST run `gh pr checks <pr-number> --watch` and wait for completion before
marking any ticket READY_FOR_REVIEW. Local tests passing ≠ CI passing. This step is non-negotiable
even if the worker reports "all tests pass."

**Verification:**

```bash
gh pr checks <pr-number> --json state,name | jq '[.[] | select(.state != "SUCCESS")] | length'
# Must return 0
```

---

## Rule B — Run prettier on every file you edit, every time

**Pattern:** Skipping prettier re-run on previously formatted files, causing CI format check
failures on unchanged-looking code.

**Evidence:** Paczka 1 format CI failures across multiple tickets

**Rule:** Run `pnpm prettier --write <file>` on every file you touch, on every edit, even if you ran
it earlier in the session. CI format check is strict and catches any divergence.

**Verification:**

```bash
pnpm prettier --check .
# Must return exit 0
```

---

## Rule C — Check repo-config dependencies BEFORE opening PR

**Pattern:** Merging a workflow that requires Code Scanning, GitHub Secrets, or branch protection
rules that don't exist, causing CI to fail in a way that can't be fixed by code changes alone.

**Evidence:** Paczka 1 CodeQL workflow added without Code Scanning enabled in repo settings

**Rule:** Before opening a PR that adds or modifies `.github/workflows/*.yml`, verify that every
required repo setting, secret, or permission already exists. If it doesn't → write to
`backlog/ESCALATIONS.md` BEFORE opening the PR, not after CI fails. Do not push the workflow file
until the human has confirmed the setting is active.

**Verification:** Review `.github/workflows/` diff manually against available repo settings.

---

## Rule D — Python build-backend must be setuptools.build_meta

**Pattern:** Using `setuptools.backends.legacy` as the pyproject.toml build-backend, which does not
exist and causes packaging failures.

**Evidence:** Paczka 1 Python app packaging failures

**Rule:** In every `pyproject.toml`, the build-backend MUST be exactly `setuptools.build_meta`.
Also: every Python app needs `__init__.py` in `src/` (even if empty) for the package to be
importable.

**Verification:**

```bash
grep -r "build-backend" apps/ --include="pyproject.toml"
# All results must say: build-backend = "setuptools.build_meta"
```

---

## Rule E — pnpm version belongs in package.json, not in CI

**Pattern:** Setting `version:` in the `pnpm/action-setup@v4` CI step, which overrides
`packageManager` in `package.json` and causes version mismatch errors.

**Evidence:** Paczka 1 CI pnpm version conflicts

**Rule:** The pnpm version is declared once, in the root `package.json` under `packageManager`. The
`pnpm/action-setup@v4` step in CI MUST NOT include a `version:` key — it reads from `packageManager`
automatically.

**Verification:**

```bash
grep -A3 "pnpm/action-setup" .github/workflows/*.yml
# Must NOT contain "version:" key
```

---

## Rule F — Slot names must be canonical: headline, cta, feature

**Pattern:** Using non-canonical slot names (e.g., `feature-section`) in playbook archetype files,
causing SDK query selector mismatches and silent slot injection failures.

**Evidence:** TICKET-046 / PR #92 — `yield-hunter.ts` had `feature-section` instead of `feature`,
also present in `llm-gateway.ts` prompt string

**Rule:** The three canonical slot names are `headline`, `cta`, `feature`. Any other value is a bug.
When adding a new slot or archetype, validate the name against this list. The LLM gateway prompt
strings listing available slots must also use these exact names.

**Verification:**

```bash
grep -rn "feature-section" packages/sdk/src/core/playbooks/ apps/control-plane/src/
# Must return 0 results
```

---

## Rule G — Breaking type changes require grep for inline mock objects

**Pattern:** Adding a required field to a shared TypeScript type (e.g., making `copy_template`
required on `PlaybookEntry`) without scanning all files that construct inline mock objects of that
type, leaving test mocks incomplete and causing typecheck failures in CI.

**Evidence:** TICKET-046 / PR #92 — `MOCK_PLAYBOOK` in `llm-gateway.test.ts` failed typecheck after
`copy_template` became required on `PlaybookEntry`; RETRO-001 identified this pattern

**Rule:** When making a field required (removing `?`) or adding a new required field to any exported
type in `packages/shared/` or `packages/sdk/`, IMMEDIATELY run:

```bash
grep -rn "TypeName" packages/ apps/ --include="*.ts" --include="*.tsx" | grep -v "import"
```

Find all inline object constructions of that type and update them before opening the PR.

**Verification:**

```bash
pnpm typecheck
# Must return exit 0 — catches all incomplete mock objects
```

---

<!-- Rule H+ added by retrospective-analyst when RULE_PROMOTION_THRESHOLD (2) is met -->
