# FOLLOW-068 — demo-integration CI Job (E2E Activation)

**Sprint:** 11 **Agent:** qa-engineer + devops-engineer **Priority:** P1 (pilot-blocking)
**Estimated hours:** 4 **Status:** IN_PROGRESS **Source retro:** RETRO-006 §3 TG-1 **Source PR:**
FOLLOW-055 (#130)

---

## Context

FOLLOW-055 (PR #130) shipped `tests/e2e/sprint-9-5-demo.spec.ts` — a vitest integration spec
covering the full investor demo path: detect → activate → adapt → DOM mutation → feedback ping. Five
static contract tests in the file always run in CI (fixture schema shape, `ReorderDirective` sort,
`TextDirective` DOM mutation, score-descending invariant, grid builder).

**The gap:** the actual E2E steps (5 of them) are guarded behind `NEXT_PUBLIC_TEST_E2E=true`. CI
never sets this flag. **The detect→activate→adapt→SDK chain has never run unattended in CI.** Static
contracts pass; the integration does not.

**Consequence:** the "we have an end-to-end test" claim is mechanically true but functionally false.
The investor demo on `app.estalara.com` works because it was hand-driven and verified manually —
there is no automated regression guard against the day someone breaks the activation chain.

**Pilot blocker:** before any pilot tenant onboards, we need confidence that the
detect→activate→adapt path is regression-tested. Today, only static contracts are.

This ticket provisions a `demo-integration` CI job that brings up Next.js + seeded demo DB + sets
`NEXT_PUBLIC_TEST_E2E=true` and runs the full spec end-to-end.

---

## Acceptance Criteria

- [ ] New CI job `demo-integration` added to `.github/workflows/ci.yml` (or new file
      `.github/workflows/demo-integration.yml` if cleaner).
- [ ] Job sets `NEXT_PUBLIC_TEST_E2E=true` and brings up Next.js dev server + seeded test DB
      (Postgres with the demo-tenant fixtures from `DEMO_LISTING_MANIFEST` and archetype embeddings
      — see FOLLOW-046 + FOLLOW-043 plumbing).
- [ ] Job runs `pnpm --filter @estalara/e2e test:e2e tests/e2e/sprint-9-5-demo.spec.ts` or
      equivalent.
- [ ] Job runs on `pull_request` for PRs that touch `apps/control-plane/**`, `packages/sdk/**`,
      `tests/e2e/**`, or this workflow file. Always runs on `push: main`.
- [ ] Soft-skip strategy if `DOPPLER_TOKEN` / DB credentials not yet in CI (FOLLOW-040 not yet
      merged): the job is present but logs a clear skip message — does NOT block CI green. Comment
      in YAML explains this is temporary until FOLLOW-040.
- [ ] `E2E_BEARER_TOKEN` env var (used by the spec) provisioned via GitHub Actions secret. If not
      yet provisioned, document the secret name in the workflow comment so DevOps can add it (or
      escalate to backlog/ESCALATIONS.md).
- [ ] Spec `beforeAll()` precheck for `E2E_BEARER_TOKEN` presence (FOLLOW-067 work, bundle here): if
      missing, fail fast with actionable error message rather than hanging on 401.
- [ ] All CI checks green except the explicitly-ignored ones (Doppler verify until FOLLOW-040, Rule
      I, Python tests).

---

## What NOT to do

- Do not rewrite the spec itself (`tests/e2e/sprint-9-5-demo.spec.ts`) beyond the `beforeAll()`
  precheck addition.
- Do not replace vitest with Playwright (Sprint 10 decision; vitest+JSDOM was chosen because
  `tests/e2e` workspace has no Next.js dep).
- Do not add the integration job to the `format` / `lint` / `typecheck` matrix — it's a separate,
  slower job by design.

---

## Files to read first

1. `tests/e2e/sprint-9-5-demo.spec.ts` — the spec to activate
2. `.github/workflows/ci.yml` — where to add the job
3. `apps/control-plane/scripts/seed-archetypes.mts` — seed script (for fixture setup)
4. `apps/control-plane/src/lib/demo-listing-manifest.ts` — demo fixture data
5. `backlog/RETROSPECTIVES.md` RETRO-006 §3 TG-1 — full context
6. `backlog/sprint-10/FOLLOW-055.md` — predecessor ticket

---

## Files to create / edit

1. `.github/workflows/ci.yml` or `.github/workflows/demo-integration.yml`
2. `tests/e2e/sprint-9-5-demo.spec.ts` — add `beforeAll()` precheck
3. Possibly `tests/e2e/package.json` if a new npm script is needed

---

## CI watch + autonomous fix policy

After pushing PR:

1. Run `gh pr checks <pr> --watch` until critical checks complete.
2. Fix real failures: TypeScript, lint, format, test, build, Rule H, Rule J.
3. **Ignore** these checks (pre-existing): Doppler verify, Rule I, Python tests.
4. If QUEUE.md conflict on rebase: keep both sides + run prettier.
5. Loop until critical CI green, then post PM-validation comment: "PM-validated: critical CI green,
   ignored Doppler/Rule-I/Python per Sprint 11 policy"
6. Mark READY_FOR_REVIEW in QUEUE.md and stop.

---

## References

- `backlog/QUEUE.md` Sprint 11 yaml block
- `backlog/RETROSPECTIVES.md` RETRO-006 §3 TG-1 (FOLLOW-068 originating finding)
- `backlog/FOLLOW_UPS.md` FOLLOW-067 (bundle here) + FOLLOW-068 stubs
- `docs/MASTER_DESIGN.md` Snapshot.1 §B.4 (auto-onboarding chain)
