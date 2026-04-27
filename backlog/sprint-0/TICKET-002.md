---
id: TICKET-002
title: Doppler integration + secrets management baseline
sprint: 0
priority: P0
agent: devops-engineer
status: READY
estimated_hours: 3
depends_on: [TICKET-001]
produces: []
affects_files:
  - "doppler.yaml"
  - ".github/workflows/ci.yml"
  - "package.json"
  - "docs/runbooks/secrets.md"
  - "scripts/doppler-bootstrap.sh"
  - ".env.example"
context_files:
  - docs/MASTER_DESIGN.md (section I — tech stack, secrets)
  - docs/CONVENTIONS.md
  - docs/CONVENTIONS_PATCH.md
  - .claude/agents/devops-engineer.md
labels: [foundation, p0, infra, secrets, devx]
---

# TICKET-002: Doppler integration + secrets management baseline

## Summary

Set up Doppler as the single source of secrets for local dev, CI, and (later) production. Establish the project structure in Doppler, integrate `doppler` CLI into local workflow (`pnpm dev` runs through `doppler run`), wire Doppler service token into GitHub Actions CI, and document the rotation/onboarding runbook. No real secrets get added in this ticket — only the plumbing.

## Context

Master Design section I (tech stack) specifies Doppler for secrets management. CLAUDE.md lists `Edit(.env)` and `Read(.env)` in the deny list — meaning agents cannot read or write `.env*` files directly. Doppler is the workaround: secrets live in Doppler service, fetched at runtime by CLI or by service tokens in CI.

We use Doppler for three reasons over alternatives (1Password, AWS Secrets Manager, Vercel env):
1. Native multi-environment model (dev/staging/prod) with branch-based secret inheritance
2. Free tier covers 5 users + unlimited secrets (sufficient for MVP team)
3. CLI-first workflow that fits Claude Code agents naturally

## Scope

### In scope
- Create `doppler.yaml` at repo root mapping `doppler.config` → environment (dev/staging/prod)
- Update root `package.json` scripts to optionally wrap with `doppler run` (graceful fallback if Doppler not installed)
- GitHub Actions: add `DOPPLER_TOKEN_DEV` secret check + `dopplerhq/cli-action` setup step in `.github/workflows/ci.yml`
- Create `.env.example` at repo root documenting all expected secrets (without values)
- Write `docs/runbooks/secrets.md` documenting:
  - How to install Doppler CLI on macOS / Linux / WSL
  - How to authenticate (`doppler login`)
  - How to set up the project locally (`doppler setup`)
  - How to add a new secret (with PR review process)
  - How to rotate a secret
  - How CI accesses secrets (service tokens, scope limits)
- Create `scripts/doppler-bootstrap.sh` — idempotent script that contributors run once after cloning
- No actual secrets added yet — just the structure

### Out of scope
- Adding production secrets — that's per-vendor in Sprint 0 / 1
- Production deploy secrets — that's TICKET-008/009 vendor setup
- Doppler webhook / change auditing — Sprint 9 compliance work

## Acceptance criteria

- [ ] AC1: `doppler.yaml` exists at repo root with `setup.project: estalara-adaptive-listings`, configs `dev`/`staging`/`prod`
- [ ] AC2: `.env.example` exists at repo root, lists every expected env var with one-line description, no values
- [ ] AC3: `package.json` root has `"dev:secrets": "doppler run -- pnpm dev"` script that works locally if user has Doppler installed; `"dev"` script still works without Doppler (graceful fallback)
- [ ] AC4: `scripts/doppler-bootstrap.sh` is executable, runs `doppler login`, `doppler setup`, exits successfully on a fresh checkout
- [ ] AC5: `.github/workflows/ci.yml` has new step that uses `dopplerhq/cli-action@v3`, conditional on `secrets.DOPPLER_TOKEN_DEV` being present; CI passes if token present, also passes (with warning) if not present (so PRs from forks don't break)
- [ ] AC6: `docs/runbooks/secrets.md` covers: install, login, setup, add secret, rotate, CI integration, troubleshooting, at minimum 200 words
- [ ] AC7: `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` all pass
- [ ] AC8: PR title is `chore(infra): doppler integration baseline [TICKET-002]`

## Implementation guidance

Suggested order:
1. Create `doppler.yaml` and `.env.example` first
2. Update `package.json` scripts (test that fallback works without Doppler)
3. Update CI workflow (test that workflow is valid YAML via `pnpm exec js-yaml .github/workflows/ci.yml`)
4. Write the runbook
5. Make `scripts/doppler-bootstrap.sh` and `chmod +x`

For the GitHub Actions step, use this pattern (adapt to existing workflow):

```yaml
- name: Install Doppler CLI
  if: ${{ secrets.DOPPLER_TOKEN_DEV != '' }}
  uses: dopplerhq/cli-action@v3

- name: Verify Doppler auth (optional)
  if: ${{ secrets.DOPPLER_TOKEN_DEV != '' }}
  run: doppler me
  env:
    DOPPLER_TOKEN: ${{ secrets.DOPPLER_TOKEN_DEV }}
```

The `if:` guard means PRs from forks (which can't access secrets) still pass CI.

## Test plan

- Local: clone repo to temp dir, run `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` — all pass
- CI: open PR, verify workflow run is green, verify Doppler step is skipped (because token not set yet)
- Manual: run `bash scripts/doppler-bootstrap.sh` — script doesn't crash even if Doppler CLI isn't installed (gives helpful error)

## Definition of Done (universal)

- [ ] Branch named `devops-engineer/TICKET-002-doppler-integration`
- [ ] Conventional commits referencing TICKET-002
- [ ] PR opened with title above
- [ ] All ACs above verified
- [ ] CI fully green via `gh pr checks <pr> --watch` (NOT just local)
- [ ] `pnpm exec prettier --check .` returns clean (run `--write` on edited files before commit)
- [ ] No new dependencies beyond `doppler` (system tool, not npm dep)
- [ ] `docs/runbooks/secrets.md` discoverable from `docs/CONVENTIONS.md` (add a link)

## Notes

- This ticket creates **no real secrets**. We're setting up plumbing. First real secret likely goes in TICKET-008 (Cloudflare API token).
- Escalate if: Doppler free tier signup somehow blocks (unlikely), or if the team agrees we should swap to 1Password/AWS Secrets Manager (different tool, would need ADR).
