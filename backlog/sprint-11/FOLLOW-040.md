# FOLLOW-040 — Doppler CI Hygiene (DOPPLER_TOKEN in GitHub Actions)

**Sprint:** 11 **Agent:** devops-engineer **Priority:** P1 (ops hygiene; unblocks 063/068)
**Estimated hours:** 1 **Status:** IN_PROGRESS **Source:** Sprint 9.5 parallel pre-flight
(incomplete) → Sprint 10 surfaced 6 fix-commits for FOLLOW-043 due to env plumbing

---

## Context

Doppler is the secrets manager for this project (`docs/MASTER_DESIGN.md` §I — Doppler is the
canonical secret store; CI is expected to inject env via `doppler run`).

**The gap:** `DOPPLER_TOKEN` is not provisioned as a GitHub Actions secret, and CI workflows do not
wrap commands in `doppler run --`. Consequences observed in Sprint 10:

- FOLLOW-043 (PR #131) required **6 fix-commits post-merge** because the seed script needed env vars
  (`OPENAI_API_KEY`, `DATABASE_URL`) that Doppler holds but the CI workflow couldn't inject. Each
  iteration: push → CI fails → patch env handling → push → CI fails → repeat. Pattern surfaced in
  RETRO-006 §6.
- FOLLOW-063 (this sprint) will need `DATABASE_URL` to run the precheck.
- FOLLOW-068 (this sprint) will need DB credentials + `E2E_BEARER_TOKEN` to run the demo
  integration.
- FOLLOW-039 (this sprint) will need ClickHouse credentials for the migration.

**Without FOLLOW-040 closing first, the other Sprint 11 P1s soft-skip and the sprint goal cannot be
claimed achieved.** This is why FOLLOW-040 is grouped P1 even though it looks like ops hygiene.

---

## Acceptance Criteria

- [ ] `DOPPLER_TOKEN` GitHub Actions secret provisioned at the repo level (service token scoped to
      dev + staging config; production token NOT in repo secrets — kept in Vercel-only path).
- [ ] CI workflows updated to use `doppler run -- <command>` for steps that need injected env.
      Concretely: - `.github/workflows/ci.yml` — wrap test, build, migrate steps in `doppler run`
      where they touch DB / API keys - `.github/workflows/seed-archetypes.yml` — already uses
      Doppler manually; verify it's correct - Any future workflow added this sprint (FOLLOW-063,
      FOLLOW-068, FOLLOW-039) reads from Doppler via this pattern
- [ ] A `doppler` CLI installation step is present in workflows that use it (the
      `dopplerhq/cli-action` GitHub Action is the canonical install).
- [ ] Soft-degradation: if `DOPPLER_TOKEN` is somehow absent (forked PR from external contributor),
      the workflow logs a clear "Doppler secret missing — proceeding without injected env; some jobs
      will skip" and continues, rather than failing with cryptic "doppler: command not found".
- [ ] `docs/MASTER_DESIGN.md` §I (or §A.4 if that's where secrets are documented) updated to
      reflect: CI uses Doppler service token scoped to dev/staging configs; production secrets
      remain Vercel-only.
- [ ] `README.md` "Local development setup" section (or new section) lists `doppler login` +
      `doppler setup` as a one-shot for new contributors. Bundles with FOLLOW-074 if active.
- [ ] Verify the existing `Doppler verify` CI check — once this PR lands, that check MUST start
      passing on subsequent PRs. Note the "before/after" status in the PR description.
- [ ] All CI checks green INCLUDING `Doppler verify` (this is the ticket that unblocks it). Other
      ignored checks: Rule I, Python tests.

---

## What NOT to do

- Do not commit any actual Doppler tokens, API keys, or secrets to the repo.
- Do not provision a production-scope Doppler token in GitHub Secrets — staging only.
- Do not bundle FOLLOW-063 / FOLLOW-068 / FOLLOW-039 work here; this is purely the plumbing.
- Do not rewrite the existing Doppler integration patterns in `apps/control-plane` runtime code —
  those work (they read from `process.env`). This ticket is purely about CI.

---

## Files to read first

1. `.github/workflows/ci.yml` — main CI workflow
2. `.github/workflows/seed-archetypes.yml` — existing Doppler usage pattern (manual)
3. `docs/MASTER_DESIGN.md` §I (or §A.4) — secrets architecture
4. `apps/control-plane/.env.example` (if exists) — what env vars are needed
5. `backlog/RETROSPECTIVES.md` RETRO-006 §6 — Pattern B (operational seed scripts + env plumbing)
6. Doppler CLI GitHub Action docs: https://github.com/dopplerhq/cli-action

---

## Files to create / edit

1. `.github/workflows/ci.yml` — add Doppler install step + wrap commands
2. Possibly `.github/workflows/*.yml` other files that need env injection
3. `docs/MASTER_DESIGN.md` §I — update secrets section
4. `README.md` — local dev setup section (or coordinate with FOLLOW-074)

---

## CI watch + autonomous fix policy

After pushing PR:

1. Run `gh pr checks <pr> --watch` until critical checks complete.
2. Fix real failures: TypeScript, lint, format, test, build, Rule H, Rule J.
3. **This is the ticket that fixes Doppler verify** — that check MUST be green at end-state. Other
   ignored checks: Rule I, Python tests.
4. If QUEUE.md conflict on rebase: keep both sides + run prettier.
5. Loop until critical CI green, then post PM-validation comment: "PM-validated: critical CI green
   including Doppler verify (unblocks Sprint 11 pilot-blockers FOLLOW-063/068/039)"
6. Mark READY_FOR_REVIEW in QUEUE.md and stop.

---

## Escalation triggers

- If the Doppler service token does not exist yet (needs to be created in the Doppler dashboard by
  Piotr): write to `backlog/ESCALATIONS.md` with the exact scope/config needed. Do not block on this
  — provision the workflow files so they're ready the moment the secret lands.

---

## References

- `backlog/QUEUE.md` Sprint 11 yaml block
- `backlog/RETROSPECTIVES.md` RETRO-006 §6 Pattern B
- `backlog/FOLLOW_UPS.md` FOLLOW-040 stub
- `docs/MASTER_DESIGN.md` §I — secrets / Doppler architecture
