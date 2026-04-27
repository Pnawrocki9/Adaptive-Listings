# Conventions — UPDATE PATCH (Paczka 2)

**Apply this on top of existing `docs/CONVENTIONS.md`.** This document describes additions and changes to coding conventions based on lessons learned from Paczka 1 testing (TICKET-001 implementation).

If you have time/inclination to merge this into the main CONVENTIONS.md by hand, that's cleaner. If not — leave both files; agents read both.

---

## NEW Section: Lessons from Paczka 1 (REQUIRED READING for all agents)

These rules exist because the first TICKET-001 attempt failed CI in specific, identifiable ways. We codify them here so they don't recur across the next 28 tickets.

### Rule A — Always re-prettier post-edit

After editing ANY file (including `.md`, `.json`, `.yml`, `.sql`), run:

```bash
pnpm exec prettier --write <files-you-edited>
```

before your commit, **even if you previously ran `prettier --write` in this session**. Format check in CI is strict and will reject any file whose formatting differs from prettier's output.

The Paczka 1 bug: agent ran `prettier --write .` early in TICKET-001 work, then later edited 2 markdown files, did not re-format them, format check failed.

**Test:** before any commit, run `pnpm exec prettier --check .`. If it lists any files, run `--write` on them, restage, recommit.

### Rule B — Verify CI is green before signaling completion

After your final push to a PR branch, wait for CI to complete:

```bash
gh pr checks <pr-number> --watch
```

This blocks until all checks resolve. After it returns, verify:

```bash
gh pr checks <pr-number> --json state,name | jq '[.[] | select(.state != "SUCCESS")] | length'
```

Expected: `0`. If any check failed, you fix the failure. Do NOT signal "ready for review" while any check is failing.

The Paczka 1 bug: PM-orchestrator marked TICKET-001 as `READY_FOR_REVIEW` while 16 of 22 CI checks were failing. Local `pnpm test` passing ≠ CI passing.

### Rule C — Repo-config dependencies must be checked BEFORE PR

Before opening a PR that adds a workflow file, verify the workflow can actually run with the repo's current configuration:

| Workflow needs | Repo config required | Check by |
|---|---|---|
| `actions/codeql-action` | Code Scanning enabled (paid GitHub plan for private repos) | `gh api /repos/:owner/:repo/code-scanning/default-setup` |
| `secrets.X` | Secret X exists in repo settings | `gh secret list` |
| Branch protection workflows | Branch protection rules configured | `gh api /repos/:owner/:repo/branches/main/protection` |
| Dependabot updates | Dependabot enabled | Visible in Settings → Code security |

If a required config is missing, **escalate to `backlog/ESCALATIONS.md` BEFORE opening the PR**:

```markdown
## OPEN — Workflow X requires Code Scanning enabled

**Filed by:** devops-engineer
**Date:** <ISO timestamp>
**Affects:** TICKET-XXX, future tickets adding security workflows
**Type:** repo-config

**Description:**
TICKET-XXX adds .github/workflows/codeql.yml. CodeQL Security Analysis requires Code Scanning to be enabled in repo settings, which is not available on GitHub Free for private repositories.

**Required action:**
Either:
1. Upgrade to GitHub Team ($4/user/month) to enable Code Scanning on private repos
2. Defer the security workflow until repo goes public or plan upgrade
3. Replace with alternative security scanner (Snyk, Trivy)

**Resolution:** <empty until human decides>
```

Do not let CI fail on a missing config. Do not let humans discover this in a failing PR review.

### Rule D — Python build backend ALWAYS uses `setuptools.build_meta`

Every `pyproject.toml` for a Python app/package MUST have:

```toml
[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"
```

**NEVER** `setuptools.backends.legacy` (does not exist as a valid backend; pip install fails). NEVER any other backend without an explicit ADR.

The Paczka 1 bug: an agent typed `setuptools.backends.legacy` (looks plausible, isn't real). All 6 Python apps failed `pip install` in CI.

### Rule E — Every Python app needs `__init__.py` in src/

Every Python source directory needs an `__init__.py` file:

```
apps/<python-app>/
├── pyproject.toml
└── src/
    ├── __init__.py    ← REQUIRED, even if empty
    └── main.py
```

Without it, pytest fails to import the package and `pnpm test` for Python apps reports "no tests collected" or `ImportError`.

### Rule F — pnpm version comes from `package.json`, not from CI

In `.github/workflows/*.yml`, the `pnpm/action-setup` step MUST NOT set a `version:` parameter:

```yaml
# CORRECT
- uses: pnpm/action-setup@v4
  with:
    run_install: false

# WRONG — conflicts with packageManager field in package.json
- uses: pnpm/action-setup@v4
  with:
    version: 9
```

The version is read from `package.json` `packageManager` field (e.g. `"packageManager": "pnpm@9.12.2"`). Specifying it in CI causes a conflict warning that becomes a fatal error in newer `pnpm/action-setup` versions.

---

## Updated section: Repository structure

Replaces the corresponding section in main CONVENTIONS.md. We now have **10 apps and 10 packages** (was 9+9 in Paczka 1):

```
apps/
├── ingest/                # Cloudflare Worker
├── control-plane/         # Next.js dashboard + API
├── decision-api/          # Edge Worker for adaptation decisions
├── intent-engine/         # Modal Python
├── adaptation-engine/     # Modal Python
├── llm-gateway/           # Modal Python (LiteLLM router)
├── stream-consumer/       # Modal Python (Redpanda → ClickHouse)
├── archetype-pipeline/    # Modal Python (daily batch)
├── data-quality/          # Modal Python
└── auto-detect/           # NEW v1.1 — Modal Python (Puppeteer + Vision)

packages/
├── sdk/                   # core embeddable SDK
├── sdk-loader/            # tiny loader
├── sdk-react/             # React wrapper
├── sdk-vue/               # Vue wrapper
├── shared/                # Zod schemas, types
├── db/                    # Drizzle schemas, migrations
├── auth/                  # JWT, API key utilities
├── intent-ontology/       # 12-dimension schema
├── compliance/            # linters, consent utilities, retention
└── platform-templates/    # NEW v1.1 — Pre-built selectors for 50+ platforms
```

---

## Other small additions

### Conventional Commit scopes (additions)

Existing scopes: `sdk`, `ingest`, `control-plane`, `intent`, `adapt`, `data`, `infra`, `compliance`, `qa`

New scopes for v1.1:
- `auto-detect` — for `apps/auto-detect/` work
- `templates` — for `packages/platform-templates/`
- `onboarding` — for control-plane onboarding wizard UI
- `db` — for `packages/db/` schema/migration work (was implicit, now explicit)

### Branch naming (no change)

`<agent>/TICKET-XXX-<kebab-summary>` — same as before.

### Required CI checks (updated list)

After Sprint 0 completes, the following CI checks MUST pass for any PR to main:

- Lint (ESLint)
- Typecheck (tsc --noEmit)
- Test (Node 22) — Vitest
- Test (Python 3.12) — pytest, per Python app
- Format check — Prettier
- Build — all TS apps and packages
- Build (control-plane) — separate Next.js build

(CodeQL was deferred per ADR-0002 until paid GitHub plan or open-source release.)

In Sprint 1+, add:

- E2E (Playwright) — when SDK Tier 1 ships
- Bundle size check — size-limit, when SDK builds output
- Load test smoke — k6 trigger, when ingest is functional

### Logging (small clarification)

When logging events related to onboarding/auto-detection, use the `auto-detect` service tag:

```typescript
log.info({ service: 'auto-detect', tenant_id, url, layer: 'L5' }, 'vision detection started');
```

Not `intent-engine` or `control-plane`. Keeps tracing clean.
