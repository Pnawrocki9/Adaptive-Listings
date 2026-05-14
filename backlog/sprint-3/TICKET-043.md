# TICKET-043 — SDK npm Publish Pipeline (GitHub Actions + changesets)

**Sprint:** 3 **Agent:** devops-engineer **Priority:** P1 **Estimated hours:** 4 **Status:** BLOCKED
**Depends on:** TICKET-038 (tsup gate — bundle must pass size check before publish) **Unblocks:**
TICKET-044

## Context

The SDK packages (`@estalara/sdk`, `@estalara/sdk-loader`, `@estalara/sdk-react`,
`@estalara/sdk-vue`) need a reliable npm publish pipeline. The publish is triggered by a version tag
`sdk-v*` (e.g. `sdk-v1.0.0-beta.1`).

**References:**

- `packages/sdk/package.json` — current `"name": "@estalara/sdk"`
- `packages/sdk-loader/package.json` — exists but may be a stub
- `packages/sdk-react/package.json` — exists but may be a stub
- `packages/sdk-vue/package.json` — exists but may be a stub
- `.github/workflows/ci.yml` — existing CI workflow for reference
- Changesets docs: https://github.com/changesets/changesets

## What to build

### 1. Changesets configuration

`.changeset/config.json`:

```json
{
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [["@estalara/sdk", "@estalara/sdk-loader", "@estalara/sdk-react", "@estalara/sdk-vue"]],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

### 2. GitHub Actions publish workflow

New file: `.github/workflows/publish-sdk.yml`

```yaml
name: Publish SDK to npm

on:
  push:
    tags:
      - 'sdk-v*'

jobs:
  publish:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write # for npm provenance
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          registry-url: 'https://registry.npmjs.org'
          cache: 'pnpm'
      - run: pnpm install --frozen-lockfile
      - name: Build SDK
        run: pnpm --filter @estalara/sdk build
      - name: Check bundle size
        run: pnpm --filter @estalara/sdk build:size
      - name: Publish packages
        run: pnpm publish -r --access public --no-git-checks
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
```

### 3. Required secrets

Document in `backlog/ESCALATIONS.md` (or confirm already set):

- `NPM_TOKEN` — npm automation token with `automation` type (not 2FA-required)

Verify the token is stored in GitHub repo secrets under `Settings → Secrets → Actions`. If not,
escalate to ESCALATIONS.md BEFORE creating the PR.

## Acceptance criteria

- [ ] `.changeset/config.json` exists with correct linked packages config
- [ ] `.github/workflows/publish-sdk.yml` exists and is syntactically valid (run `actionlint` or
      dry-run)
- [ ] Publish workflow triggers on `sdk-v*` tags only (not on every push)
- [ ] Bundle size check runs BEFORE publish in the workflow — publish fails if bundle > 40KB
- [ ] `pnpm publish -r --access public` publishes all 4 packages: `@estalara/sdk`,
      `@estalara/sdk-loader`, `@estalara/sdk-react`, `@estalara/sdk-vue`
- [ ] `NPM_TOKEN` secret is either confirmed to exist in repo secrets OR escalated to
      `backlog/ESCALATIONS.md` with the exact secret name needed
- [ ] `package.json` files for all 4 packages have `"version": "1.0.0-beta.1"` or whatever version
      is appropriate for the first publish
- [ ] Workflow file does NOT use `--no-verify` or skip any build step

## Notes

- Do NOT push the first `sdk-v*` tag as part of this ticket — the workflow just needs to be ready.
  Piotr (CEO) will trigger the first publish by pushing the tag after reviewing the bundle.
- If `@estalara/sdk-loader`, `@estalara/sdk-react`, or `@estalara/sdk-vue` are stubs with only
  placeholder content, they should still be versioned at `1.0.0-beta.1` as empty-but- valid
  packages. Real content comes in Sprint 11.
