# FOLLOW-063 — Archetype Embeddings Auto-Seed in CI (NOT NULL Invariant)

**Sprint:** 11 **Agent:** devops-engineer + ml-engineer **Priority:** P1 (pilot-blocking)
**Estimated hours:** 3 **Status:** IN_PROGRESS **Source retro:** RETRO-006 §3 LG-1 **Source PR:**
FOLLOW-043 (#131)

---

## Context

FOLLOW-043 (PR #131) shipped `pnpm seed:archetypes` — a one-shot Node script that calls OpenAI
`text-embedding-3-small` for each of the 18 archetype label strings and UPDATEs
`archetype_embeddings.embedding`. A manual `workflow_dispatch` GitHub Action exists.

**The gap:** no CI step or on-merge automation runs the seed automatically. On any fresh DB pull (CI
staging spin-up, new dev environment, restored backup, post-migration), the `archetype_embeddings`
table has 18 rows with `embedding = NULL`. The cosine-affinity lookup in
`apps/control-plane/src/lib/embedding-lookup.ts` silently falls back to the djb2 deterministic-hash
path because `fetchArchetypeEmbedding()` returns `null`.

**Consequence:** the cosine-affinity path FOLLOW-019 wired (and FOLLOW-043 was meant to unblock)
**is unreachable by default on any fresh deploy**. Demo only works because the production DB was
manually seeded once on 2026-05-22.

**Pilot blocker:** any new pilot tenant's DB starts NULL → adaptation degrades to djb2 hash on day 1
with no diagnostic surfaced. The cosine differentiator promised in Master Design §F.3 is silently
inactive.

This ticket makes the seed step CI-enforced + READMe-documented + post-migration-automatic.

---

## Acceptance Criteria

- [ ] CI precheck job (`archetype-embeddings-not-null`) added to `.github/workflows/ci.yml` that
      connects to the staging DB and fails the build if any row in `archetype_embeddings` has
      `embedding IS NULL`. Job runs after migrations apply, before the main test suite.
- [ ] Post-migration seed automation: a new GitHub Actions workflow
      `.github/workflows/post-migrate-seed.yml` (or extension of existing) runs
      `pnpm seed:archetypes` against staging on merge to `main` **only if** any
      `archetype_embeddings.embedding` row is NULL. Idempotent — safe to re-run.
- [ ] The existing `.github/workflows/seed-archetypes.yml` `workflow_dispatch` is retained as the
      manual override (operator can still trigger ad-hoc).
- [ ] README "Local development setup" section gains a one-shot step:
      `doppler run -- pnpm seed:archetypes` after first `pnpm install`. Bundles with FOLLOW-074
      (architect README). If FOLLOW-074 not yet open, write the README section yourself.
- [ ] If `DOPPLER_TOKEN` is not yet available in CI secrets (FOLLOW-040 not yet merged), the
      precheck job is allowed to soft-skip with a clear log line (NOT fail) — but the job MUST be
      present so it activates the moment FOLLOW-040 lands. Document this in the workflow YAML
      comment.
- [ ] All CI checks green except the explicitly-ignored ones (Doppler verify, Rule I, Python tests).

---

## What NOT to do

- Do not change the seeding script itself (`apps/control-plane/scripts/seed-archetypes.mts`) unless
  a real bug surfaces.
- Do not add the precheck to the `pull_request` workflow if it requires DB access — only add to
  `push: main` or scheduled.
- Do not bundle FOLLOW-040 work into this PR (separate ticket, separate agent).

---

## Files to read first

1. `.github/workflows/seed-archetypes.yml` — current manual workflow_dispatch
2. `.github/workflows/ci.yml` — existing CI structure (where to add precheck job)
3. `apps/control-plane/scripts/seed-archetypes.mts` — the seed script itself
4. `apps/control-plane/src/lib/embedding-lookup.ts` — the cosine lookup that falls back
5. `backlog/RETROSPECTIVES.md` RETRO-006 §3 LG-1 — full context
6. `backlog/sprint-10/FOLLOW-043.md` — predecessor ticket

---

## Files to create / edit

1. `.github/workflows/ci.yml` — add `archetype-embeddings-not-null` job
2. `.github/workflows/post-migrate-seed.yml` — new workflow (or extend existing)
3. `README.md` — add "Local development setup" section (or update if exists)

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
- `backlog/RETROSPECTIVES.md` RETRO-006 §3 LG-1 (FOLLOW-063 originating finding)
- `backlog/FOLLOW_UPS.md` FOLLOW-063 stub
- `docs/MASTER_DESIGN.md` §F.3 (cosine archetype affinity — the consumer)
