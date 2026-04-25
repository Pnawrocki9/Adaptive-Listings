---
id: TICKET-001
title: Bootstrap monorepo (Turborepo + pnpm + base tooling)
sprint: 0
priority: P0
agent: devops-engineer
status: READY
estimated_hours: 4
depends_on: []
produces: [TICKET-002, TICKET-003, TICKET-004, TICKET-005, TICKET-006, TICKET-007, TICKET-008, TICKET-009, TICKET-010, TICKET-011, TICKET-012, TICKET-013, TICKET-014, TICKET-015]
affects_files:
  - "package.json"
  - "pnpm-workspace.yaml"
  - "turbo.json"
  - "tsconfig.json"
  - "tsconfig.base.json"
  - ".github/workflows/ci.yml"
  - ".github/workflows/codeql.yml"
  - ".eslintrc.json"
  - ".prettierrc"
  - ".gitignore"
  - ".nvmrc"
  - ".node-version"
  - "scripts/check-bundle-size.ts"
  - ".husky/pre-commit"
  - "lefthook.yml"
context_files:
  - docs/CONVENTIONS.md
  - docs/MASTER_DESIGN.md (section I.6 dev tooling)
labels: [foundation, p0, infra, devx]
---

# TICKET-001: Bootstrap monorepo (Turborepo + pnpm + base tooling)

## Summary

Initialize the monorepo skeleton that every subsequent ticket builds on. Set up Turborepo, pnpm workspaces, the base TypeScript config, ESLint, Prettier, Vitest, GitHub Actions CI, pre-commit hooks, and the size-limit infrastructure. Create empty placeholder packages and apps so other agents can start working in parallel from Sprint 0 day 2.

This ticket unblocks every other ticket in Sprint 0.

## Context

The Master Design (`docs/MASTER_DESIGN.md` Section I.6) specifies:

- Monorepo: Turborepo + pnpm
- Linter: ESLint + Prettier
- Testing: Vitest (TS) + pytest (Python)
- CI: GitHub Actions
- Bundle size enforcement: size-limit
- Pre-commit: lefthook (replaces husky for cross-platform speed)
- Node version: pinned in `.nvmrc` and `.node-version`

The repo structure follows `docs/CONVENTIONS.md`. This ticket creates the skeleton; subsequent tickets fill in actual code.

## Scope

### In scope

- Initialize root `package.json` with pnpm workspaces + Turborepo
- Create `pnpm-workspace.yaml` listing `apps/*` and `packages/*`
- Create `turbo.json` with pipeline definitions for `dev`, `build`, `lint`, `typecheck`, `test`
- Create base `tsconfig.json` and `tsconfig.base.json` (strict mode, target ES2022, module NodeNext, paths configured)
- Create `.eslintrc.json` with TypeScript + import + sonarjs presets
- Create `.prettierrc` matching CONVENTIONS.md (single quotes, no semicolons disabled — semicolons on, line width 100)
- Create `.gitignore` (node_modules, dist, .env*, .turbo, coverage, .DS_Store, etc.)
- Create `.nvmrc` and `.node-version` pinning Node 22.x LTS
- Create empty placeholder packages with their own `package.json` and `tsconfig.json`:
  - `packages/sdk`
  - `packages/sdk-loader`
  - `packages/sdk-react`
  - `packages/sdk-vue`
  - `packages/shared`
  - `packages/db`
  - `packages/auth`
  - `packages/intent-ontology`
  - `packages/compliance`
- Create empty placeholder apps:
  - `apps/ingest` (Cloudflare Worker scaffold via `wrangler init` non-interactive)
  - `apps/control-plane` (Next.js 15 App Router scaffold)
  - `apps/decision-api` (Cloudflare Worker scaffold)
  - `apps/intent-engine` (Modal Python placeholder)
  - `apps/adaptation-engine` (Modal Python placeholder)
  - `apps/llm-gateway` (Modal Python placeholder)
  - `apps/stream-consumer` (Modal Python placeholder)
  - `apps/archetype-pipeline` (Modal Python placeholder)
  - `apps/data-quality` (Modal Python placeholder)
- Each placeholder has at minimum: README.md, package.json (or pyproject.toml), tsconfig.json (or pyproject)/setup.cfg, src/index.ts (or src/main.py) with single export and a smoke test
- Create `.github/workflows/ci.yml` running: install, lint, typecheck, test, build (matrix: Node 22, ubuntu-latest)
- Create `.github/workflows/codeql.yml` for security scanning
- Set up lefthook with pre-commit hooks: lint-staged formatting, typecheck on changed files
- Create `scripts/check-bundle-size.ts` placeholder (full impl in TICKET-018)
- Initial commit on `main` branch
- Document local dev setup in `README.md` (top-level)

### Out of scope

- Actual implementation of any package or app — that's other tickets
- Doppler integration for secrets — TICKET-005
- Pre-commit secret scanning — TICKET-007
- Deploy workflows (only CI for now) — TICKET-014
- Database setup — TICKET-009
- Cloudflare Worker actual code — TICKET-010
- Anything ML — Sprint 4+

## Acceptance criteria

- [ ] AC1: `git clone <repo> && cd <repo> && pnpm install` completes with no errors on a clean Node 22 environment
- [ ] AC2: `pnpm turbo run lint` runs across all packages and apps and passes with zero errors
- [ ] AC3: `pnpm turbo run typecheck` runs across all packages and apps and passes
- [ ] AC4: `pnpm turbo run test` runs the smoke tests in every package and passes
- [ ] AC5: `pnpm turbo run build` succeeds for all TypeScript packages (Python apps excluded)
- [ ] AC6: GitHub Actions CI workflow runs all of the above on PR open and push to main
- [ ] AC7: Lefthook pre-commit hook runs lint-staged + typecheck on changed files in <10s
- [ ] AC8: All 9 packages and 9 apps are present with placeholder code that builds and tests pass
- [ ] AC9: `README.md` at repo root documents: prerequisites, install, dev, test, build, deploy
- [ ] AC10: `.nvmrc`, `.node-version`, `.tool-versions` (asdf) all pin Node 22.x LTS consistently
- [ ] AC11: No `node_modules` or build artifacts committed (verify via `git ls-files | grep -E '(node_modules|dist|\.turbo|coverage)'` returns empty)
- [ ] AC12: PR title is `chore(infra): bootstrap monorepo [TICKET-001]`

## Implementation guidance

Suggested order:

1. Top-level files first: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `.gitignore`, `.nvmrc`, `tsconfig.base.json`, `.eslintrc.json`, `.prettierrc`
2. One placeholder package as the template (e.g., `packages/shared`), get it linting/testing/building cleanly
3. Replicate the template across all other packages
4. One placeholder app, replicate
5. CI workflow last (now there's something to test)

For Cloudflare Workers placeholders, use `npx wrangler@latest init <name> --yes` and adjust as needed; don't deploy.

For Next.js, use `npx create-next-app@latest control-plane --typescript --app --tailwind --use-pnpm --import-alias "@/*"` non-interactive.

For Modal Python apps, the placeholder is just `pyproject.toml` + a `main.py` with `print("estalara-<n> placeholder")` and a pytest test that imports it. Modal isn't actually invoked in this ticket.

Example minimal `turbo.json`:

```json
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "tui",
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "dev": { "cache": false, "persistent": true },
    "lint": {},
    "typecheck": { "dependsOn": ["^build"] },
    "test": { "dependsOn": ["^build"] }
  }
}
```

Example root `package.json` scripts:

```json
"scripts": {
  "build": "turbo run build",
  "dev": "turbo run dev",
  "lint": "turbo run lint",
  "typecheck": "turbo run typecheck",
  "test": "turbo run test",
  "format": "prettier --write ."
}
```

## Test plan

- Unit: each package/app has a smoke test that imports its public export and asserts truthy
- Integration: none for this ticket
- E2E: `pnpm install && pnpm turbo run lint typecheck test build` from clean checkout in CI must pass
- Load test impact: none

## Definition of Done (universal)

- [x] Branch named `devops-engineer/TICKET-001-bootstrap-monorepo`
- [x] Conventional commits referencing TICKET-001
- [x] PR opened with `chore(infra): bootstrap monorepo [TICKET-001]` title
- [x] All ACs above verified
- [x] CI green (typecheck, lint, test, build)
- [x] No new TODO/FIXME without ticket number
- [x] No new dependencies beyond those listed in MASTER_DESIGN.md without architect approval
- [x] Top-level README.md updated with setup instructions
- [ ] HANDOFF written to `backlog/HANDOFFS.md`: TICKET-001 → TICKET-002, TICKET-003, ..., TICKET-015 (one entry summarizing skeleton)

## Notes

- Pin pnpm version via `packageManager` field in root package.json (use latest stable: `pnpm@9.x`)
- Do NOT install actual dependencies for the placeholders beyond what's needed to build (no Preact yet, no Drizzle yet, etc.) — those come in their dedicated tickets
- The `apps/control-plane` Next.js scaffold may pull in many deps; that's OK — keep upstream scaffold defaults, they'll be customized in subsequent tickets
- If `wrangler` or `create-next-app` versions conflict with our pinned tools, document in PR description and propose ADR

## Worked example link

After this ticket merges, every subsequent ticket follows the same format. See `docs/TICKET_FORMAT.md` for the schema.
