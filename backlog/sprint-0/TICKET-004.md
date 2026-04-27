---
id: TICKET-004
title: Pre-commit security hooks (Lefthook + git-secrets + commit lint)
sprint: 0
priority: P1
agent: devops-engineer
status: READY
estimated_hours: 2
depends_on: [TICKET-001]
produces: []
affects_files:
  - "lefthook.yml"
  - ".github/workflows/ci.yml"
  - "package.json"
  - ".gitleaks.toml"
  - "scripts/install-hooks.sh"
  - "docs/runbooks/git-hooks.md"
context_files:
  - docs/MASTER_DESIGN.md (section I — dev tooling)
  - docs/CONVENTIONS.md (commits)
  - .claude/agents/devops-engineer.md
labels: [foundation, p1, infra, security, devx]
---

# TICKET-004: Pre-commit security hooks

## Summary

Configure Lefthook to run pre-commit checks: format on changed files, lint on changed files, conventional commit message linting, and gitleaks/git-secrets scan to prevent committing API keys, AWS credentials, or other secrets. CI gets the same gitleaks scan on PR. This is fast (target <10s on a typical commit) and catches the highest-leverage class of bugs (leaked secrets) before they reach git history.

## Context

`CLAUDE.md` already lists Lefthook as the chosen pre-commit tool. `TICKET-001` set up the basic Lefthook config but only with `lint-staged` + typecheck. This ticket extends it with secret scanning.

The Conventional Commits format is required per CONVENTIONS.md. We add commit-msg hook to enforce this locally and a CI check that mirrors it.

## Scope

### In scope
- Update `lefthook.yml` to add:
  - `pre-commit`: format-changed (prettier --write on staged), lint-changed (eslint --fix on staged), gitleaks scan on staged
  - `commit-msg`: validate via `commitlint` against Conventional Commits config
- Create `.gitleaks.toml` config with rules for: AWS keys, GCP keys, generic API tokens, Stripe keys, Anthropic API keys (`sk-ant-*`), OpenAI keys (`sk-*`), Doppler tokens
- Add `gitleaks` to root `package.json` devDependencies (or use Docker fallback in CI if binary unavailable)
- Add CI step in `.github/workflows/ci.yml` that runs `gitleaks detect --source . --no-banner` on PR
- Add `commitlint` config (`commitlint.config.cjs`) at repo root with allowed types from CONVENTIONS.md
- Create `scripts/install-hooks.sh` that sets up Lefthook locally for new contributors
- Document in `docs/runbooks/git-hooks.md`

### Out of scope
- Branch protection rules (server-side enforcement) — requires GitHub plan upgrade or owner action, escalate if needed
- Signed commits enforcement — Sprint 9 compliance work
- Pre-push hooks — keeping pre-commit lightweight for now

## Acceptance criteria

- [ ] AC1: `lefthook.yml` has `pre-commit` with steps: format, lint, gitleaks; `commit-msg` step using commitlint
- [ ] AC2: `.gitleaks.toml` includes rules for at minimum: AWS access key, AWS secret key, generic high-entropy tokens, Anthropic API keys (`sk-ant-`), OpenAI API keys (`sk-proj-`, `sk-`), Stripe live keys (`sk_live_`)
- [ ] AC3: `commitlint.config.cjs` enforces types: `feat`, `fix`, `chore`, `docs`, `test`, `refactor`, `perf`, `build`, `ci` (from CONVENTIONS.md); requires at least one scope; subject min 10 chars max 80
- [ ] AC4: CI workflow has `gitleaks-scan` job that runs `gitleaks detect` and fails PR if secrets detected
- [ ] AC5: `scripts/install-hooks.sh` installs Lefthook locally and runs a smoke test (touch a temp file, try commit with bad message, expect rejection)
- [ ] AC6: `docs/runbooks/git-hooks.md` covers: what hooks check, how to bypass (with justification), how to update rules, troubleshooting; minimum 200 words
- [ ] AC7: All existing CI checks still pass (no regression from added steps)
- [ ] AC8: Lefthook pre-commit cumulative time on a typical 5-file change <10s
- [ ] AC9: PR title `feat(infra): pre-commit security hooks [TICKET-004]`

## Implementation guidance

`lefthook.yml` example:

```yaml
pre-commit:
  parallel: true
  commands:
    format:
      glob: "*.{js,ts,jsx,tsx,json,md,yml,yaml,css}"
      run: pnpm exec prettier --write {staged_files} && git add {staged_files}
    lint:
      glob: "*.{js,ts,jsx,tsx}"
      run: pnpm exec eslint --fix {staged_files} && git add {staged_files}
    gitleaks:
      run: gitleaks protect --staged --no-banner

commit-msg:
  commands:
    commitlint:
      run: pnpm exec commitlint --edit {1}
```

For commitlint config:

```javascript
// commitlint.config.cjs
module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'chore', 'docs', 'test', 'refactor', 'perf', 'build', 'ci']],
    'scope-empty': [2, 'never'],
    'subject-min-length': [2, 'always', 10],
    'subject-max-length': [2, 'always', 80],
  },
};
```

Add `@commitlint/cli` and `@commitlint/config-conventional` to root devDependencies.

For gitleaks in CI, use the official action:

```yaml
- name: Gitleaks scan
  uses: gitleaks/gitleaks-action@v2
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

## Test plan

- Manual: try commit with `bad message` → rejected by commitlint
- Manual: try commit with `AKIAIOSFODNN7EXAMPLE` (fake AWS key) in code → rejected by gitleaks
- Manual: typical commit with valid message and no secrets → passes in <5s
- CI: open PR with intentionally malformed commit → CI fails on commit-msg step
- CI: open PR clean → CI passes

## Definition of Done

- [ ] Branch `devops-engineer/TICKET-004-precommit-security`
- [ ] PR title `feat(infra): pre-commit security hooks [TICKET-004]`
- [ ] All ACs verified
- [ ] CI fully green via `gh pr checks <pr> --watch`
- [ ] `pnpm exec prettier --check .` clean
- [ ] No new dependencies in root beyond commitlint and gitleaks (gitleaks via npm or system binary)
- [ ] `docs/runbooks/git-hooks.md` linked from CONVENTIONS.md

## Notes

- gitleaks may have many false positives initially. Tune `.gitleaks.toml` allowlist for known-safe patterns (e.g., test fixtures, ADR examples).
- Lefthook bypass: `git commit --no-verify` works but logged in audit. Don't use for real secrets.
