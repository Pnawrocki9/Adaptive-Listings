# Handoffs

When one agent's ticket produces output another agent needs, the producing agent appends a handoff note here. The PM reads this file before delegating downstream tickets.

## Format

```markdown
## TICKET-XXX → TICKET-YYY
**From:** <producing agent>
**To:** <consuming agent>
**Date:** <ISO timestamp>
**Summary:** One paragraph: what was produced, where it lives, key details.
**Action required:** What the consuming agent needs to do with it.
**Files:** <list of relevant files / artifacts>
```

---

## TICKET-001 → TICKET-002 through TICKET-015
**From:** devops-engineer
**To:** all Sprint 0 agents
**Date:** 2026-04-25
**Summary:** Monorepo skeleton is live. All 9 packages and 9 apps exist with placeholder code that builds, lints, typechecks, and passes smoke tests. Root config files (turbo.json, tsconfig.base.json, eslint.config.mjs, .prettierrc, pnpm-workspace.yaml) are authoritative. CI is green. Note: ESLint 9 flat config is used (`eslint.config.mjs`), not the legacy `.eslintrc.json` format. All packages declare `"type": "module"` in package.json for ESM compatibility with `verbatimModuleSyntax`. Cloudflare Worker apps (ingest, decision-api) use `moduleResolution: Bundler` and `@cloudflare/workers-types`.
**Action required:** Each downstream ticket should branch from `main` (after merge) and fill in the placeholder package/app it owns. Do not modify root config files without coordinating with devops-engineer.
**Files:** package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json, eslint.config.mjs, .prettierrc, lefthook.yml, .github/workflows/ci.yml, .github/workflows/codeql.yml, packages/*/package.json, apps/*/package.json
