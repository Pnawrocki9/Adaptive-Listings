# Git Hooks Runbook

**Owner:** devops-engineer  
**Last updated:** 2026-04-29  
**Status:** Production

## Overview

This runbook documents the git hooks configured for Estalara Adaptive Listings. We use Lefthook to
manage pre-commit and commit-msg hooks that enforce code quality, formatting standards, security
scanning, and commit message conventions. These hooks run locally on each developer's machine before
code reaches CI, catching issues early and reducing CI failures.

## What the Hooks Check

### Pre-commit Hooks (run before commit is created)

Our pre-commit hooks run in parallel for performance and include:

1. **Format (prettier):** Automatically formats staged files matching
   `*.{ts,tsx,js,jsx,json,yaml,yml,md,css}` patterns. Changes are automatically staged after
   formatting via `stage_fixed: true`. This ensures all committed code follows our formatting
   standards without manual intervention.

2. **Lint (eslint):** Runs ESLint with auto-fix on staged TypeScript and JavaScript files. Catches
   common code quality issues, unused imports, potential bugs, and style violations. Auto-fixed
   changes are re-staged.

3. **Gitleaks (secret scanning):** Scans staged files for accidentally committed secrets like AWS
   keys, API tokens, database passwords, and other credentials. Uses patterns defined in
   `.gitleaks.toml` to detect over 20 types of sensitive data. If gitleaks binary is not installed
   locally, shows a warning but allows commit (CI will catch secrets later).

**Performance target:** Pre-commit hooks should complete in under 10 seconds for a typical 5-file
change. Formatting and linting run only on staged files (not the entire repository) to maintain
speed. Typecheck was deliberately removed from pre-commit because it requires checking the entire
project and was causing 30+ second delays.

### Commit-msg Hook (validates commit message after writing)

The commit-msg hook uses commitlint to enforce Conventional Commits format with our project-specific
requirements:

**Required format:**

```
<type>(<scope>): <subject> [TICKET-XXX]
```

**Valid types:**

- `feat` — New feature
- `fix` — Bug fix
- `chore` — Maintenance, dependencies, configuration
- `docs` — Documentation only changes
- `test` — Adding or refactoring tests
- `refactor` — Code restructuring without behavior change
- `perf` — Performance improvement
- `build` — Build system or external dependencies
- `ci` — CI/CD pipeline changes

**Valid scopes:**

- `sdk`, `ingest`, `control-plane`, `intent`, `adapt`, `data`, `infra`, `compliance`, `qa`,
  `agents`, `deps`, `repo`

**Rules enforced:**

- Scope is REQUIRED (cannot be empty)
- Subject must be at least 10 characters
- Subject maximum 120 characters (keeps messages readable in git log)
- Subject must not end with a period
- Subject must be lowercase (start-case, Pascal-case, and upper-case are rejected)
- Must include `[TICKET-XXX]` reference where XXX is a number

**Valid examples:**

```
feat(ingest): add event validation for schema version 2 [TICKET-042]
fix(sdk): handle missing data-tenant attribute gracefully [TICKET-051]
chore(deps): bump preact to 10.22.0 [TICKET-073]
docs(compliance): add GDPR data retention policy [TICKET-089]
```

**Invalid examples (will be rejected):**

```
Update stuff                           ❌ No type, scope, or ticket
feat: add validation                   ❌ Missing scope
feat(ingest): add                      ❌ Subject too short
feat(ingest): Add validation [TICKET-042]  ❌ Subject starts with capital
feat(ingest): add validation.          ❌ Subject ends with period
feat(ingest): add validation           ❌ Missing ticket reference
```

## How to Bypass Hooks (with Justification)

Hooks can be bypassed using the `--no-verify` flag:

```bash
git commit --no-verify -m "emergency hotfix message"
```

**When bypass is justified:**

- **Emergency hotfixes** in production incidents where every second counts (must follow up with
  proper commit in next PR)
- **Merge commits** created by GitHub (these are auto-generated and follow different format)
- **Revert commits** that need to preserve original message format
- **Work-in-progress commits** on local feature branches (but clean up before pushing)

**When bypass is NOT justified:**

- "Hooks are too slow" — if hooks take over 10 seconds regularly, file an issue, don't bypass
- "I don't have time to write a proper message" — commit messages are documentation, take the 30
  seconds
- "The linter is wrong" — if the linter rule is bad, propose changing it via ADR, don't bypass
- "I need to commit a test secret" — never commit real secrets, use `.env.example` or test fixtures

**Important:** All commits pushed to `main` branch are checked in CI regardless of local bypass. CI
uses the same gitleaks configuration and runs additional security scans. Bypassing locally only
delays detection to CI, it does not allow secrets or bad code to merge.

## How to Update Hook Rules

### Adding New Secret Patterns to Gitleaks

Edit `.gitleaks.toml` and add a new rule:

```toml
[[rules]]
id = "new-api-key-type"
description = "New Service API Key"
regex = '''new-service-key-[a-zA-Z0-9]{32}'''
tags = ["api-key", "new-service"]
```

Test the new pattern:

```bash
echo "new-service-key-abcd1234..." > test-secret.txt
gitleaks detect --source . --no-git
rm test-secret.txt
```

### Allowing False Positives

If gitleaks flags a legitimate pattern (example code, test fixture), add to the allowlist in
`.gitleaks.toml`:

```toml
[allowlist]
paths = [
  '''tests/fixtures/example-secrets\.txt''',
]

regexes = [
  '''EXAMPLE_NOT_A_REAL_KEY''',
]
```

### Modifying Commit Message Rules

Edit `commitlint.config.cjs` to change rules. For example, to add a new valid scope:

```javascript
'scope-enum': [
  2,
  'always',
  [
    // ... existing scopes ...
    'new-scope',  // Add here
  ],
],
```

After changing commitlint rules, test locally:

```bash
echo "feat(new-scope): test message [TICKET-001]" | pnpm exec commitlint
```

### Disabling a Hook Temporarily

Edit `lefthook.yml` and add `skip: true` to a command:

```yaml
pre-commit:
  commands:
    gitleaks:
      skip: true # Disables this hook
      run: gitleaks protect --staged
```

Or skip for a single developer by setting environment variable:

```bash
export LEFTHOOK_EXCLUDE=gitleaks
git commit -m "message"
```

## Troubleshooting

### Problem: "gitleaks: command not found" warning on commit

**Cause:** Gitleaks binary is not installed locally. The hook will show a warning but allow the
commit to proceed. Secrets will still be caught in CI.

**Solution (recommended):** Install gitleaks locally for faster feedback:

```bash
# macOS
brew install gitleaks

# Linux
curl -sSfL https://github.com/gitleaks/gitleaks/releases/download/v8.18.0/gitleaks_8.18.0_linux_x64.tar.gz | tar -xz
sudo mv gitleaks /usr/local/bin/

# Windows
scoop install gitleaks

# Verify installation
gitleaks version
```

**Workaround:** Continue without local gitleaks. CI will catch any secrets before merge.

### Problem: "commitlint: command not found"

**Cause:** Node modules are not installed or commitlint dependencies are missing.

**Solution:**

```bash
pnpm install --frozen-lockfile
pnpm exec commitlint --version  # Should show v19.x.x
```

If still failing, re-run hooks installation:

```bash
./scripts/install-hooks.sh
```

### Problem: Hooks are not running at all

**Cause:** Lefthook hooks were not installed in `.git/hooks/` directory.

**Solution:**

```bash
pnpm exec lefthook install
```

Verify hooks are present:

```bash
ls -la .git/hooks/
# Should see: pre-commit, commit-msg
```

### Problem: Pre-commit hook is very slow (over 30 seconds)

**Cause:** Too many files staged at once, or typecheck running on entire project.

**Diagnosis:** Run with verbose logging:

```bash
LEFTHOOK_VERBOSE=1 git commit
```

**Solutions:**

- Commit files in smaller batches (stage fewer files at a time)
- If one specific check is slow, investigate that tool's performance
- Consider running full typecheck only in CI, not pre-commit (current config already does this for
  typecheck)

### Problem: False positive from gitleaks on test fixture

**Cause:** Test file contains example secrets that match gitleaks patterns.

**Solution:** Add the file path to `.gitleaks.toml` allowlist:

```toml
[allowlist]
paths = [
  '''tests/fixtures/example-api-responses\.json''',
]
```

Or wrap the test secret in a way that breaks the pattern:

```javascript
// Before (flags as secret):
const API_KEY = 'sk-proj-abc123...';

// After (does not flag):
const API_KEY = 'sk-' + 'proj-abc123...';
```

### Problem: Commitlint rejects valid message

**Cause:** Message format does not exactly match Conventional Commits spec or custom rules.

**Diagnosis:** Test the message directly:

```bash
echo "your message here" | pnpm exec commitlint
```

**Common issues:**

- Scope missing: Add `(scope)` — `feat: message` ❌ → `feat(infra): message` ✓
- Subject too short: Must be at least 10 characters
- Subject starts with capital: Must be lowercase — `feat(infra): Add feature` ❌ →
  `feat(infra): add feature` ✓
- Missing ticket reference: Must end with `[TICKET-XXX]`

### Problem: Need to commit during CI/CD pipeline

**Cause:** Automated tools (dependabot, release scripts) need to commit without interactive hooks.

**Solution:** Use `--no-verify` in automation:

```bash
git commit --no-verify -m "chore(deps): automated dependency update"
```

Or set environment variable to skip all hooks:

```bash
LEFTHOOK=0 git commit -m "message"
```

## CI Integration

The same checks that run locally also run in CI to ensure no bad code reaches `main` branch even if
developers bypass hooks.

### Gitleaks in CI

Job: `gitleaks-scan` in `.github/workflows/ci.yml`

Uses official GitHub Action: `gitleaks/gitleaks-action@v2`

**What it does:**

- Scans entire git history for secrets (not just current commit)
- Fails PR if any secrets detected
- Uses same `.gitleaks.toml` configuration as local hooks
- Runs with full history (`fetch-depth: 0`) to catch secrets in old commits

**Handling CI failures:** If gitleaks fails in CI:

1. Review the scan results in GitHub Actions logs
2. If it's a real secret: **immediately rotate the credential** and remove from git history using
   `git filter-repo` or BFG Repo-Cleaner
3. If it's a false positive: add to `.gitleaks.toml` allowlist and push fix

### Commit Message Validation in CI

Currently validated via Lefthook locally. Future enhancement: add `commitlint-github-action` to
validate all commit messages in a PR.

## Performance Benchmarks

Target performance on reference hardware (M1 Mac, NVMe SSD, 16GB RAM):

| Hook Stage            | Target | Typical  | Slow Threshold |
| --------------------- | ------ | -------- | -------------- |
| Pre-commit (5 files)  | <5s    | 3-6s     | >10s           |
| Pre-commit (20 files) | <10s   | 7-12s    | >20s           |
| Commit-msg            | <1s    | 0.2-0.5s | >2s            |
| Total commit cycle    | <10s   | 5-8s     | >15s           |

If your commit cycle regularly exceeds "Slow Threshold", investigate using verbose mode and file an
issue.

## Related Documentation

- [CONVENTIONS.md](../CONVENTIONS.md) — Full commit message format specification
- [.gitleaks.toml](../../.gitleaks.toml) — Secret detection patterns and allowlist
- [commitlint.config.cjs](../../commitlint.config.cjs) — Commit message validation rules
- [lefthook.yml](../../lefthook.yml) — Hook configuration and command definitions
- [CI workflow](../../.github/workflows/ci.yml) — CI security scanning jobs

## Emergency Contact

If hooks are blocking critical production hotfix:

1. Use `--no-verify` to bypass and deploy immediately
2. File incident report in `backlog/ESCALATIONS.md` with justification
3. Follow up with proper fix in next PR that passes all hooks

For hook configuration issues or performance problems:

- File issue labeled `infra` and `devx`
- Tag `@devops-engineer` agent for prioritization
- Include verbose output: `LEFTHOOK_VERBOSE=1 git commit`
