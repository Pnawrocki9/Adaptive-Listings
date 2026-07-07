# Status — 2026-07-08 (Sprint 22b OPEN — RETRO-163 filed for FOLLOW-464, PR #471 open)

## SESSION 16 RETRO (2026-07-08) — RETRO-163 packaged + PR #471 opened; FOLLOW-528/529/530 stubbed

**Coordinator update:** PR #470 (session-16 DONE close-out) merged (main `acf87bb → 2785191`);
`retrospective-analyst` completed RETRO-163 for FOLLOW-464 but left its edits uncommitted on the
(now-merged) close-out branch working tree.

**Actions taken:**

1. `git stash push -u` the uncommitted retro edits (`backlog/RETROSPECTIVES.md`,
   `backlog/FOLLOW_UPS.md`, `.claude/agents/retrospective-analyst/lessons.md`).
2. `git checkout main && git pull` (confirmed `main` had moved to `2785191`, past the PR #470 the
   coordinator's message had described as still-open — it had since merged).
3. `git checkout -b retrospective-analyst/retro-163-follow464` off fresh `main` (independent of the
   already-merged close-out branch, per instruction).
4. `git stash pop`, reviewed the retro content in full (RETRO-163 §1-10, the 3 FOLLOW-528/529/530
   stubs, the 2 lessons.md entries) for internal consistency and quality — clean, no red flags.
5. `prettier --check` flagged 2 of 3 files; `prettier --write` on those 2 (confirmed via
   `git diff --stat` the reformat was additions-only, no reflow of pre-existing content).
6. Committed, pushed, opened **PR #471**.
7. `gh pr checks 471 --watch` to completion: all real gates green; only the standing pre-existing
   "Rule I — wired-or-dead check" baseline red (1 leg this run). Posted PM-validated comment. Not
   merged (human-only).

**Registered planning note (per coordinator instruction):** FOLLOW-528 (P2, stubbed, not yet
promoted) requires rebuilding the `description_cache_persistent_active_uniq` partial unique index to
add `model`. Per the standing MEMORY fact (FOLLOW-308 `db-migrate.yml`), Postgres migrations
auto-apply staging→prod with NO human gate — so when FOLLOW-528 is promoted to the queue and
delegated, its delegation brief MUST explicitly require an additive/safe migration ordering (new
index created before the old one is dropped, no window where the constraint is absent or a valid
insert could be rejected). Recorded in the QUEUE.md banner as a standing reminder for whoever
promotes FOLLOW-528.

**CI-check counter this session (cumulative across the FOLLOW-464 code PR + 2 docs PRs):** PR #468:
2 checks (watch + json confirm). PR #469: 2 checks. PR #470: 3 checks (initial watch + 2 follow-up
settle polls due to a slow Test-Node-22 leg). PR #471: 2 checks (watch + settle poll). 0 fix
iterations across all four — every push was green on first CI run.

**Hand-off:** 1 open PR (#471, RETRO-163 docs, awaiting human merge). 0 tickets IN_PROGRESS (only
the stale `TICKET-PILOT-001` record). 3 standing OPEN escalations (ESC-020/ESC-028/ESC-034)
unchanged, non-blocking.

---

## SESSION 16 CLOSE-OUT (2026-07-07) — PRs #468/#469 merged; FOLLOW-464 DONE; worktree/branches cleaned

**Human confirmed:** PR #468 (FOLLOW-464 code fix) and PR #469 (docs bookkeeping) both merged.

**Actions taken:**

1. `git checkout main && git pull origin main` — fast-forward `42e2821..acf87bb` (commits `bc3b1ea`
   #468, then `acf87bb` #469). Verified via `git log --oneline` that both merge commits are present
   on local `main`.
2. `backlog/QUEUE.md`: `FOLLOW-464` flipped `READY_FOR_REVIEW → DONE`,
   `completed_at: '2026-07-07T00:00:00Z'`, `merged_commit: bc3b1ea` added; DONE close-out note
   appended documenting both merges and the cleanup performed.
3. `backlog/STATUS.md` (this entry) refreshed.
4. Cleanup: `git worktree remove .claude/worktrees/wt-follow464` (worktree was clean, no dangling
   changes — confirmed via `git status --short` before removal); deleted local + remote branch
   `ml-engineer/FOLLOW-464-model-key-pg-cache` and local + remote branch
   `pm-orchestrator/session16-follow464-recovery` (both fully merged into `main`, confirmed via
   `git branch --merged main` before deletion).

**Did NOT spawn `retrospective-analyst`** per explicit instruction — the main/coordinating session
will invoke it after this close-out. RETRO-163 (FOLLOW-464) is owed on the next retro pass.

**Hand-off:** 0 open PRs. 3 standing `## OPEN` escalations (ESC-020, ESC-028, ESC-034) unchanged,
non-blocking. 0 tickets IN_PROGRESS (only the stale `TICKET-PILOT-001` record, well under the
3-ticket cap).

---

## SESSION 16 (2026-07-07) — recovered stalled ml-engineer FOLLOW-464 work, opened PR #468, READY_FOR_REVIEW

**Read state (step 1):** `backlog/QUEUE.md`, `backlog/ESCALATIONS.md` (3 standing `## OPEN`:
ESC-020, ESC-028, ESC-034 — unchanged, previously-established non-blocking), `backlog/HANDOFFS.md`,
`git log --oneline -20` (`main` tip `42e2821`), `gh pr list --state open` → 0 open PRs.

**Found two pieces of stranded state on entry (neither committed by session 15):**

1. `git status --short` on `main` showed uncommitted modifications to
   `.claude/agents/pm-orchestrator/lessons.md`, `backlog/QUEUE.md`, `backlog/STATUS.md` — session
   15's own banner/lessons write, never committed before the session ended.
2. `git worktree list` surfaced `.claude/worktrees/wt-follow464` on branch
   `ml-engineer/FOLLOW-464-model-key-pg-cache` at commit `d90cdfa` (== the pre-dispatch base, no
   drift) with **uncommitted-but-complete** changes: `description-pg-cache.ts` + `route.ts`
   modified, 2 new test files. The dispatched ml-engineer subagent had done the work but
   stalled/handed off before commit/push/PR.

**Ran the mandatory recovered-work re-verification (docs/AGENT_WORKFLOW.md "Recovered-work
re-verification") before committing anything:**

1. Confirmed branch: work was on `ml-engineer/FOLLOW-464-model-key-pg-cache`, never `main`. Good.
2. Confirmed nothing else was stranded / kept the two diffs separate: the docs diff on `main` is
   unrelated PM bookkeeping — moved it off `main` onto its own branch
   (`pm-orchestrator/session16-follow464-recovery`) rather than sweeping it into the ticket's
   commit.
3. Independently re-ran verification myself (did NOT trust the stalled session's implicit "done"
   state): `pnpm turbo run lint typecheck test --filter=@estalara/control-plane --force` (cache
   bypassed) — **8/8 tasks green**, 137 test files / 1544 tests passed, 0 failures. Targeted run of
   the 2 new test files (`description-pg-cache.test.ts`, `route.follow464.test.ts`): **6/6 passed**.
   `prettier --check` on all 4 changed files: clean.
4. Reviewed the diff against all 4 FOLLOW-464 AC items in QUEUE.md — all covered: model-scoped WHERE
   filter added to `getPgCachedDescription`; FIT model-switch cache-busting test; NEUTRAL
   cross-model regression-guard test (RETRO-162 LG-1); demo `override_model` non-short-circuit test.
   Confirmed only one call site of `getPgCachedDescription` in the repo (`route.ts`), and existing
   mocked tests (`route.follow465.test.ts`, `route.follow460.test.ts`) have no strict arity
   assertions that would break from the added parameter (confirmed both pass in the full run).

**Committed `94cce4c`, pushed, opened PR #468** (with a "Recovered-work note" in the PR description
per AGENT_WORKFLOW.md step 4). `gh pr checks 468 --watch`: all real gates pass; the only non-success
is the standing pre-existing "Rule I — wired-or-dead check" (2x, one per matrix leg) — confirmed via
`gh api .../logs` this is the baseline **181 violations** (identical count to every recent merged
PR), containing zero FOLLOW-464 symbols. `gh pr view 468 --json statusCheckRollup` confirms exactly
these 2 non-SUCCESS entries out of 58 total checks. **CI non-success count for REAL gates: 0.**

**Runtime-wiring grep (evidence_requirements item 2):** producer
`apps/control-plane/src/app/api/adapt/description/route.ts:310` —
`getPgCachedDescription(tenantId, listing_id, archetypeId, localeCode, effectiveModel)` — reaches
consumer `apps/control-plane/src/lib/description-pg-cache.ts:127` —
`eq(descriptionCachePersistent.model, model)` in the WHERE clause. Both non-test production code.

Posted the "PM-validated. CI green. Runtime wiring confirmed. Ready for human review." comment on PR
#468. Flipped FOLLOW-464 `IN_PROGRESS → READY_FOR_REVIEW` in QUEUE.md, added `pr: 468`. Did NOT
merge (human-only). Not co-assigned (single-agent ticket) — step 5d N/A.

**CI-check counter this session:** 2/5 (`gh pr checks 468 --watch` + 1 `gh pr view --json`
confirmation read). 0/3 fix iterations — nothing needed fixing, all real gates were green on first
push.

**Hand-off:** 1 open PR (#468, FOLLOW-464, READY_FOR_REVIEW, awaiting human merge). Separately, a
small docs-only PR is still owed for the `pm-orchestrator/session16-follow464-recovery` branch
(session-15's original banner + this session's lessons/STATUS/QUEUE updates) — to be opened
immediately following this entry. 0 tickets IN_PROGRESS besides the stale `TICKET-PILOT-001` record.
3 standing OPEN escalations (ESC-020/ESC-028/ESC-034) unchanged, non-blocking.

---

## SESSION 15 (2026-07-07) — PRs #466/#467 confirmed merged; FOLLOW-464 dispatched to ml-engineer

**Read state:** `git fetch`+`git pull` (`main` tip `42e2821`, fast-forwarded from `d90cdfa` through
#466/#467), `backlog/QUEUE.md`, `backlog/ESCALATIONS.md` (3 standing `## OPEN`: ESC-020, ESC-028,
ESC-034 — unchanged, previously-established non-blocking), `backlog/HANDOFFS.md` (FOLLOW-464 brief
present, now natively on `main`, no longer only in an unmerged PR diff), `gh pr list --state open` →
**0 open PRs**.

**Confirmed** `backlog/QUEUE.md`'s `FOLLOW-464` entry (Sprint 22b) is live on `main` with
`status: IN_PROGRESS`, `assigned_to: ml-engineer`,
`branch: ml-engineer/FOLLOW-464-model-key-pg-cache`, `priority: P1`, `depends_on: [FOLLOW-460]`
(DONE), `folds: [FOLLOW-523]`. Only 1 other real `IN_PROGRESS` row exists (`TICKET-PILOT-001`, a
stale unrelated 2026-05-29 record) — well under the 3-ticket cap.

**Ran the 4-point pre-delegation check (feedback_ticket_analysis_discipline)** independently against
the live code, not trusting the HANDOFFS.md brief's prose:

1. Hallucination risk: none — every cited file/symbol verified to exist as described.
2. Data/dependency access: verified `getPgCachedDescription`
   (`apps/control-plane/src/lib/description-pg-cache.ts:87-124`) omits `model` from its WHERE;
   `route.ts:296,305` computes `effectiveModel` BEFORE the model-blind call; migration
   `0033_description_cache_verdict.sql` present + journal-monotonic; `model` column `NOT NULL` (safe
   to filter on for every pre-existing row).
3. Backward chain: `depends_on FOLLOW-460` DONE; `folds FOLLOW-523` marked `FOLDED_INTO_FOLLOW-464`;
   no other IN_PROGRESS ticket touches the same files.
4. Second-pass: the route's existing `effectiveModel` already unifies demo/global model
   discrimination, so passing it straight into the new `model` param covers the brief's demo-path
   guard (AC item 3) without a separate code path — flagged in the QUEUE.md banner so the worker
   doesn't over-build.

No blockers. **Dispatched FOLLOW-464 to ml-engineer** this session using the existing delegation
brief in `backlog/HANDOFFS.md` ("Delegation brief — FOLLOW-464 (ml-engineer)"). No QUEUE.md field
edit needed (already correct from #466); added a superseding `START HERE` banner instead.

**CI-check counter this session:** 0/5 (no PR opened yet by the worker; nothing to check). No fix
iterations.

---

## SESSION 14 (2026-07-07) — validated PR #466 (RETRO-162 close-out / FOLLOW-464 promotion), no new delegation

**Read state (step 1):** `backlog/QUEUE.md`, `backlog/ESCALATIONS.md`, `backlog/HANDOFFS.md`,
`git log --oneline -20` (HEAD `d90cdfa`), `gh pr list --state open` → **1 open PR: #466**
(`pm-orchestrator/retro-162-follow464-p1-fastfollow`, docs-only bookkeeping). Re-confirmed the 3
standing `## OPEN` escalations (ESC-020, ESC-028, ESC-034) unchanged, previously-established
non-blocking (ESC-020 explicitly says "does NOT block the PM pipeline"; ESC-028 is a soft-skip CI
canary; ESC-034 is code-complete/operator-pending) — did not re-litigate, did not stop the pipeline.

**Validated PR #466** (RETRO-162 retro close-out for FOLLOW-465 + P2→P1 promotion of FOLLOW-464,
folding FOLLOW-523): confirmed 0 code files in the diff (only
`.claude/agents/retrospective-analyst/ lessons.md`,
`backlog/{FOLLOW_UPS,HANDOFFS,QUEUE,RETROSPECTIVES}.md`) so step 5c (runtime-wiring grep) and 5d
(co-assigned integration check) are N/A. Ran `gh pr checks 466`: all real gates PASS; only
`Rule I — wired-or-dead check` (2x) is non-success — confirmed this is the standing pre-existing-red
baseline (unaffected by a docs-only diff). CI non-success count for REAL gates: **0**. Diffed the
QUEUE.md/HANDOFFS.md content against the PR's own commit message and found it internally consistent
(FOLLOW-464: P2→P1, reassigned ml-engineer, branch `ml-engineer/FOLLOW-464-model-key-pg-cache`,
folds FOLLOW-523's model-scoping AC + NEUTRAL cross-model regression-guard test; FOLLOW-523 marked
`FOLDED_INTO_FOLLOW-464`). Posted PM-validated comment on PR #466. **Did not merge** (human-only).
Did not start a new delegation this session: `main`'s `QUEUE.md`/`HANDOFFS.md` do not yet contain
the FOLLOW-464 reassignment/brief (that content only exists in the unmerged PR #466 diff) — starting
the `ml-engineer/FOLLOW-464-model-key-pg-cache` branch now would race an unmerged docs PR that
itself edits QUEUE.md, and could also state the delegation twice (once in the merged QUEUE.md, once
in the still-open PR). Correct next action is for the human to merge #466 first; the FOLLOW-464
delegation is ready to fire the moment it lands.

**CI-check counter this session:** 1/5 (single `gh pr checks 466` read, no fix iterations — nothing
to fix, all real gates already green from the prior session's push).

---

## SESSION 13 (2026-07-06) — FOLLOW-465 delegated (P2, ml-engineer, NEUTRAL-verdict negative cache)

**Read state first (step 1):** `backlog/QUEUE.md` (banner headed "resume 2026-07-06 (session 12)" at
session start; superseded with a fresh banner this session), `backlog/ESCALATIONS.md` (3 real
`## OPEN` entries re-read in full: ESC-020, ESC-028, ESC-034 — content unchanged, all
previously-established non-blocking operator-action-pending; no new escalation opened),
`backlog/HANDOFFS.md`, `git log --oneline -20` (HEAD `d79d800`, matches: FOLLOW-466 closed DONE, PR
#457-461 merged, RETRO-161 filed), `gh pr list --state open` → **0 open PRs** (nothing to validate
this round — went straight to ticket selection).

**Ticket picked:** FOLLOW-465 (P2, ml-engineer — negative-cache NEUTRAL archetype-fit verdicts so a
repeat request for the same (tenant,listing,archetype,locale,model) doesn't re-invoke Sonnet 4.6
forever). Considered against the other fresh worker-implementable READY Sprint 22b candidates:
FOLLOW-464 (P2, backend-engineer, stale-Postgres-description-cache correctness,
`depends_on FOLLOW-460` DONE) and FOLLOW-491 (P2, backend-engineer, spoofable-header sweep on
`/api/config` + `/api/audit`, but both target routes confirmed still in-memory MVP stubs per its own
ticket text — deferred real severity). Independently verified (not trusted from audit-report prose):
read `apps/control-plane/src/lib/description-pg-cache.ts:75-125` — confirmed
`getPgCachedDescription` omits `model` from its WHERE clause (the FOLLOW-464 bug, real but bounded —
closes on the next `listing.updated` webhook invalidation); read
`apps/llm-gateway/src/jobs/generate_description.py:330-338` and `:1101-1113` — confirmed the NEUTRAL
branch of `_generate_with_sonnet` is structurally identical to a genuine failure and writes NOTHING
to Redis/Postgres, so a NEUTRAL verdict re-triggers a full Sonnet 4.6 call on every single repeat
request, uncapped. Picked FOLLOW-465 over FOLLOW-464 because its leak is unbounded and compounds
with live traffic on a path that went live in prod 2026-07-03 (Modal description generation,
ADR-0016), whereas FOLLOW-464's staleness window is bounded and narrow (only during a model switch);
also weighed that ADR-0016 explicitly dropped a ~$500/mo Redpanda tier over pilot budget, making an
uncapped recurring-Sonnet-call leak the higher real-world-cost bug of the two.

Also read the full surrounding cache infrastructure before writing the brief (not left to the worker
to re-discover): `DescriptionResponseSchema`/`DescriptionCacheValueSchema`
(`packages/shared/src/schemas/description.ts`), the `/api/internal/description-cache` route's
`BodySchema` (`description: z.string().min(1)`), and `description_cache_persistent`'s Postgres
schema — confirmed a naive empty-string sentinel for "NEUTRAL, don't regenerate" would be rejected
by two existing Zod validators (though the DB `NOT NULL` column itself permits `''`). Wrote the
concrete design constraint into the brief: add an optional `verdict: 'FIT'|'NEUTRAL'` field to both
schemas (back-compat default `'FIT'`), reuse the EXISTING Redis-key/Postgres-row shape so the
already-shipped `listing.updated` invalidation (Redis wildcard SCAN + Postgres tenant+listing WHERE)
invalidates a NEUTRAL marker for free, and explicitly confirmed this stays an internal-cache-shape
change — NOT a wire-contract change to `DescriptionResponseSchema` (SDK-facing), so no escalation is
triggered by this ticket as scoped.

Promoted FOLLOW-465 in `backlog/QUEUE.md` (single writer): flipped `READY -> IN_PROGRESS`,
`assigned_to: ml-engineer`, `started_at: 2026-07-06T00:00:00Z`,
`branch: ml-engineer/FOLLOW-465-neutral-verdict-negative-cache`. Full delegation brief written to
`backlog/HANDOFFS.md` ("Delegation brief — FOLLOW-465 (ml-engineer)"), including explicit AC that
the write-side (Python) and read-side (control-plane route short-circuit) BOTH must land — a
write-only half-wire would look done but do nothing, mirroring the FOLLOW-097→114→127→141 half-wire
pattern this PM is required to check for at validation step 5c. Delegation-table row used:
"intent/adapt logic, embeddings, LLM gateway, auto-detect, ontology, platform-templates →
ml-engineer".

FOLLOW-464/491/519/522 remain `READY`/stub for a future session pick (not started this session —
only 1 ticket picked, keeping IN_PROGRESS count at 1, well under the 3-concurrent cap). FOLLOW-471
(clean re-audit gate) confirmed still correctly `BACKLOG` — its `depends_on` list includes
FOLLOW-464/465 among others, none yet DONE.

**This session has no subagent-spawn tool** — only the QUEUE.md/HANDOFFS.md/STATUS.md state changes
were performed; the main orchestrator must actually invoke the ml-engineer worker on the branch
above using this ticket's YAML block, `docs/MASTER_DESIGN.md` §Snapshot.1, `CONVENTIONS_PATCH.md`,
and the HANDOFFS.md brief as context.

**CI-check counter:** 0/5 (no PR opened yet this session — nothing to validate). **Escalation
ages:** ESC-020 open since 2026-06-06 (~30 days, operator/CTO-deploy-gated, non-blocking per
established precedent); ESC-028 open since 2026-06-23 (~13 days, GH-secrets-provisioning,
non-blocking); ESC-034 open since 2026-06-30 (~6 days, operator go-live only, non-blocking).

---

## SESSION 12 (2026-07-06) — FOLLOW-466 delegated (P2, backend-engineer, feedback-HMAC replay protection)

**Read state first (step 1):** `backlog/QUEUE.md` (banner headed "resume 2026-07-06 (session 11)" at
session start; corrected with a fresh superseding banner this session), `backlog/ESCALATIONS.md` (3
real `## OPEN` entries re-read in full: ESC-020, ESC-028, ESC-034 — content unchanged since last
confirmation, all previously-established non-blocking operator-action-pending per documented
precedent; no new escalation opened, none block picking a ticket), `backlog/HANDOFFS.md`,
`git log --oneline -20` (HEAD `a704516`, matches the launching context: FOLLOW-462/490/482/513/516
all closed per prior sessions), `gh pr list --state open` → **0 open PRs** (nothing to validate this
round — went straight to ticket selection).

**Ticket picked:** FOLLOW-466 (P2, backend-engineer — replay protection on the `/api/adapt/feedback`
HMAC + unify the two remaining plain-`===` `CRON_SECRET` comparisons onto `timingSafeEqual`).
Considered against the other 3 fresh worker-implementable READY Sprint 22b candidates: FOLLOW-464
(P2, backend, stale-Postgres-description-cache correctness, `depends_on FOLLOW-460` DONE),
FOLLOW-465 (P2, ml-engineer, negative-cache NEUTRAL verdicts to stop Sonnet re-spend, no deps), and
FOLLOW-491 (P2, backend, spoofable-header sweep on `/api/config` + `/api/audit`). Picked FOLLOW-466
as the highest real-world-severity clean delegate: it is a security-integrity gap (a captured
`(body, signature)` pair is replayable indefinitely, letting an observer inflate a bandit arm's
measured win-rate) versus FOLLOW-464's pure cache-correctness bug and FOLLOW-465's cost-efficiency
gap — both real but lower-severity than an auth/replay hole. `depends_on: [FOLLOW-450]` verified
DONE in QUEUE.md before picking. Independently re-confirmed the finding in the repo (not just
trusting the audit-report prose): read `apps/control-plane/src/app/api/adapt/feedback/route.ts` in
full (HMAC covers `(key, body)` only, no timestamp/nonce, `constantTimeEqual` compare — so the
_replay_ half of F-21 is live even though the _timing-safety_ half is already correct there);
grepped `INTERNAL_API_SECRET|CRON_SECRET|WEBHOOK_SECRET|webhook` across `apps/control-plane/src` and
found the two concrete plain-`===` `CRON_SECRET` call sites
(`api/internal/retention/conversion-labels/route.ts:55`,
`api/canary/adaptation-writes/route.ts:91`), confirming the second half of F-21 against
`apps/control-plane/src/app/api/webhooks/listing-updated/route.ts` (already correct, uses
`secretEquals`/`timingSafeEqual`) and `apps/control-plane/src/lib/tracer-auth.ts` (already correct)
as the reference pattern to reuse.

Promoted FOLLOW-466 in `backlog/QUEUE.md` (single writer): flipped `READY -> IN_PROGRESS`,
`assigned_to: backend-engineer`, `started_at: 2026-07-06T00:00:00Z`,
`branch: backend-engineer/FOLLOW-466-feedback-hmac-replay-protection`. Full delegation brief written
to `backlog/HANDOFFS.md` ("Delegation brief — FOLLOW-466 (backend-engineer)"), including an explicit
flag that adding a timestamp to the HMAC message may change the SDK→control-plane wire contract and,
if so, MUST go through an ESCALATIONS.md entry per CLAUDE.md's public-API-surface rule rather than
being silently shipped — left this call to the worker with instructions to escalate, not decide
unilaterally. Delegation-table row used: "ingest worker, control-plane, decision-api, Postgres/RLS,
auth, onboarding HTTP, billing, webhooks → backend-engineer".

FOLLOW-464/465/491 remain `READY` for a future session pick (not started this session — only 1
ticket picked, keeping IN_PROGRESS count at 1, well under the 3-concurrent cap). FOLLOW-471 (clean
re-audit gate) confirmed still correctly `BACKLOG` — its `depends_on` list includes
FOLLOW-464/465/466 among others, none yet DONE.

**This session has no subagent-spawn tool** — only the QUEUE.md/HANDOFFS.md/STATUS.md state changes
were performed; the main orchestrator must actually invoke the backend-engineer worker on the branch
above using this ticket's YAML block, `docs/MASTER_DESIGN.md` §Snapshot.1, `CONVENTIONS_PATCH.md`,
and the HANDOFFS.md brief as context.

**CI-check counter:** 0/5 (no PR opened yet this session — nothing to validate). **Escalation
ages:** ESC-020 open since 2026-06-06 (~30 days, operator/CTO-deploy-gated, non-blocking per
established precedent); ESC-028 open since 2026-06-23 (~13 days, GH-secrets-provisioning,
non-blocking); ESC-034 open since 2026-06-30 (~6 days, corrected 2026-07-06, operator go-live only,
non-blocking).

---

## SESSION 11 (2026-07-06) — FOLLOW-513 delegated (P1, backend-engineer, ingest Sentry-on-queue-path)

**Read state first (step 1):** `backlog/QUEUE.md` (banner still headed "resume 2026-07-04" at
session start — stale; corrected with a fresh superseding banner this session),
`backlog/ESCALATIONS.md` (3 real `## OPEN` entries: ESC-020, ESC-028, ESC-034 — all re-read in full,
content unchanged since last confirmation, all previously-established non-blocking
operator-action-pending per documented precedent; no new escalation opened, none block picking a
ticket), `backlog/HANDOFFS.md`, `git log --oneline -20` (HEAD `2083e07`, matches the launching
context's session-10 close-out: FOLLOW-462/490 DONE, FOLLOW-482 CODE_COMPLETE_OPERATOR_PENDING,
ADR-0017 ACCEPTED, ESC-037 RESOLVED, RETRO-153..159 filed), `gh pr list --state open` → **0 open
PRs** (nothing to validate this round).

**Bookkeeping note:** `backlog/STATUS.md`'s own prior "SESSION 10" entry (below) only narrates the
FOLLOW-462 half of session 10's actual work — FOLLOW-490 and FOLLOW-482 also closed in that session
per `git log` and `backlog/QUEUE.md`'s own ticket blocks, but this file was never updated to say so.
Not fixing that retroactively (out of scope, no code/queue impact) — flagging so the next reader
trusts `git log` + `QUEUE.md` ticket YAML over this file's prose when they disagree.

**Ticket picked:** FOLLOW-513 (P1, backend-engineer, `apps/ingest` — bind Sentry on the `queue()`
consumer path so `retry_reinsert_failed`/`malformed_retry_message` captures aren't structural
no-ops). Chosen over the other fresh RETRO-159 stubs (FOLLOW-512/514/515, all P1/P2 but
devops/operator-provisioning-shaped, not cleanly worker-delegable) and over FOLLOW-500 (P1, real
post-deploy Modal smoke — devops/ml, also legitimate but FOLLOW-513 is a clean, fully-specified,
single-file-family backend-engineer fix with no operator dependency) and over the FOLLOW-490 P2/P3
sweep tail (FOLLOW-473 explicitly flagged risky/needs-preflight, FOLLOW-491/484 lower priority).
Verified the finding directly in the repo before delegating (`apps/ingest/src/index.ts:39-51`,
`observability.ts`, `handlers/events-retry-consumer.ts:42,70`) rather than trusting the retro prose
alone. Promoted the FOLLOW-513 stub from `backlog/FOLLOW_UPS.md` into `backlog/QUEUE.md` (single
writer), flipped `READY -> IN_PROGRESS`, `assigned_to: backend-engineer`,
`branch: backend-engineer/FOLLOW-513-queue-sentry-binding`. Full delegation brief written to
`backlog/HANDOFFS.md` ("PM orchestrator (session 11) → backend-engineer, FOLLOW-513").
Delegation-table row used: "ingest worker, control-plane, decision-api, Postgres/RLS, auth,
onboarding HTTP, billing, webhooks → backend-engineer".

**This session has no subagent-spawn tool** — only the QUEUE.md/HANDOFFS.md state changes were
performed; the main orchestrator must actually invoke the backend-engineer worker on the branch
above using this ticket's YAML block, `docs/MASTER_DESIGN.md` §Snapshot.1, `CONVENTIONS_PATCH.md`,
and the HANDOFFS.md brief as context.

**IN_PROGRESS count:** FOLLOW-513 + stale `TICKET-PILOT-001` (ancient, sdk-engineer, started
2026-05-29, still never cleared across 11 sessions — worth a hygiene pass) = 2 (cap 3, room for one
more).

**CI-check counter:** 0/5 (no PR opened this session, nothing to check). **Fix-iteration counter:**
0/3.

---

## SESSION 10 (2026-07-06) — bookkeeping fix (FOLLOW-456/459 DONE flip), retro debt flagged, FOLLOW-462 delegated

**Read state first (step 1):** `backlog/QUEUE.md` (START HERE resume note dated 2026-07-04),
`backlog/ESCALATIONS.md` (4 `## OPEN` headers: 1 is the format template, 3 real — ESC-020/ESC-028/
ESC-034, all previously confirmed non-blocking operator-action-pending, re-confirmed unchanged this
session, no new escalation opened), `backlog/HANDOFFS.md`, `git log --oneline -20` (HEAD `b3c2de6`,
matches the resume note exactly), `gh pr list --state open` → **0 open PRs** (nothing to validate
this round).

**Bookkeeping-hygiene finding (not a code defect):** cross-checked the resume note's own claim that
PR #429 (FOLLOW-459) and PR #430 (FOLLOW-456) are merged against
`gh pr view 429/430 --json state,mergedAt` → both `state: MERGED` confirmed (`2026-07-03T09:14:42Z`,
`2026-07-03T09:42:22Z`). Their individual Sprint 22b ticket entries in QUEUE.md were still
`status: READY_FOR_REVIEW` — never flipped to DONE by the prior session. Corrected both to `DONE`
with real `completed_at` timestamps and `pr: ... (MERGED)` annotations. **Retro debt:**
`backlog/RETROSPECTIVES.md` tops out at RETRO-152 (FOLLOW-450) — FOLLOW-456, FOLLOW-459, FOLLOW-460,
and FOLLOW-485 are ALL merged with NO retrospective entry. This session's tool inventory
(Read/Write/Edit/Bash only, no Task/Agent-spawn tool) could not itself invoke the
`retrospective-analyst` subagent — flagged in QUEUE.md's new session-10 note for the next invocation
with subagent-spawn capability to write RETRO-153..156 before any sprint-close activity.

**Ticket delegated:** FOLLOW-462 (P2, data-engineer, table row: "ClickHouse, Redpanda, ETL,
archetype pipeline, drift cron, DSR delete → data-engineer") — bind ClickHouse DSR `session_id` as a
bound param instead of quote-only escaping, so a trailing backslash can't silently defeat an Art.17
erasure DELETE. Chosen because: no P1 is READY in Sprint 22b (FOLLOW-471, the epic's P1 gate ticket,
is `BACKLOG`, blocked on the full ticket list); among the READY P2 tail
(461/462/463/464/465/466/473/474/467/468/469) FOLLOW-462 is the highest real-world-severity item — a
live GDPR Art.17 compliance-erasure correctness bug, not hardening/cost/bundle cleanup. Flipped
`READY → IN_PROGRESS`, `assigned_to: data-engineer`,
`branch: data-engineer/FOLLOW-462-clickhouse-dsr-param-binding`. **This session could not itself run
the worker subagent** (no Task tool) — only the QUEUE.md state change was performed; the actual
isolated-worktree implementation must be run by an invocation with subagent-spawn capability, using
this ticket's YAML block + `docs/MASTER_DESIGN.md` §Snapshot.1 + `CONVENTIONS_PATCH.md` + this note
as context, per delegation protocol.

IN_PROGRESS count: FOLLOW-462 + stale `TICKET-PILOT-001` (ancient, sdk-engineer,
`TICKET-PILOT-001-pilot-launch-shadow`, started 2026-05-29 — still never cleared across 10 sessions;
worth a hygiene pass to confirm it's genuinely dead or close it) = 2 (cap 3).

**CI-check counter:** 0/5 (no PR opened this session, nothing to check). **Fix-iteration counter:**
0/3.

---

## SESSION 8 (2026-07-02) — recovered crashed session 7; FOLLOW-454/455 DONE + retros written, FOLLOW-450/457 delegated

**Read state first (step 1):** `backlog/QUEUE.md`, `backlog/ESCALATIONS.md`, `backlog/HANDOFFS.md`,
`git log --oneline -20`, `gh pr list --state open` (0 open PRs at session start — both FOLLOW-454
and FOLLOW-455 PRs had already merged before this session started reading state; `git status` clean
on `main`, in sync with `origin/main` at `765cb81`). Session 7 had crashed mid-flight after
delegating FOLLOW-454 and FOLLOW-455 to isolated worktrees; both completed and merged (PR #422 →
`c060a69`, PR #423 → `765cb81`) via a mechanism outside this session's visibility (matching the
session-6/session-7 pattern where the recovering session finds the PR already open/merged).

**Verification, not trust (step 1, per user's explicit framing this session):**

- `gh pr view 422/423 --json state,mergedAt,mergeCommit,title` → both `state: MERGED`, merge commits
  match `git log` HEAD exactly (`c060a69` then `765cb81`).
- `gh pr checks 422` → 57 pass / 2 fail (both fails = pre-existing non-blocking "Rule I —
  wired-or-dead check", zero violations in touched files). `gh pr checks 423` → 56 pass / 2 fail,
  same pattern. **CI non-success count for all REAL gates: 0 on both PRs** (evidence requirement §1
  — Rule I is a documented pre-existing baseline, not a real merge gate, per project memory "CI gate
  landscape").
- Runtime-wiring (step 5c, evidence requirement §2) — FOLLOW-454:
  `grep -rn "getSessionAuth\b" apps/control-plane/src --include=*.ts | grep -v '\.test\.'` → 1
  producer (`session-auth.ts:151`) + 2 non-test consumers (`ab/weights/route.ts:70`,
  `tenants/[id]/bandit/weights/[archetype]/route.ts:48`);
  `grep -n "checkDashboardSession" apps/control-plane/src/middleware.ts` → definition :195, call
  site :332 (real middleware entrypoint). FOLLOW-455:
  `grep -rln "dsr-rate-limit\|dsr-verify" apps/control-plane/src --include=*.ts | grep -v '\.test\.'`
  → 4 non-test consumers across the 4 DSR capability routes;
  `grep -n "intent_events\|quiz_completions\|intent_sessions" apps/control-plane/src/app/api/dsr/erase/ route.ts`
  → all 3 new erasure targets have real DELETE call sites, not comments only.
- **Migration-class distinction confirmed (important refinement to the "migrations don't auto-apply"
  project memory):** FOLLOW-455's new migration `0032_dsr_verifications_attempt_count.sql` targets
  Postgres/Drizzle, which DOES auto-apply on push to `main` via `.github/workflows/db-migrate.yml`
  (staging then prod) — unlike ClickHouse, which has no such mechanism (FOLLOW-449's class). This
  session found and is tracking `gh run` id `28586941940`, auto-triggered by the FOLLOW-455 merge
  commit; it was STILL IN PROGRESS (staging leg) when this session ended (prior runs of this
  workflow took up to ~1h42m end-to-end) — **NOT YET CONFIRMED COMPLETE.** `dsr-verify.ts` reads/
  writes the new `attempt_count` column on every DSR verify, so until the prod leg completes, a live
  DSR request against prod would 500 on the missing column — this is a real but BOUNDED drift window
  (the mechanism is confirmed to exist and fire, unlike the ClickHouse class where no mechanism
  exists at all). **NEXT SESSION MUST run `gh run view 28586941940` and confirm `completed success`
  before treating migration 0032 as live in prod; if it failed, this is a P0/P1 escalation** (DSR is
  a live legal-compliance surface).

**QUEUE.md updated:** FOLLOW-454 and FOLLOW-455 flipped `IN_PROGRESS` → `DONE`, all AC checkboxes
`[x]`, `completed_at` set to the actual merge timestamps.

**RETRO-149 (FOLLOW-454) and RETRO-150 (FOLLOW-455) written** to `backlog/RETROSPECTIVES.md`
(10-section format). RETRO-149: no fresh pattern (tenant-side mirror of the already-established
admin-side SSR-cookie-auth fix, project memory `admin_ssr_cookie_auth`). RETRO-150: **one fresh
count-1 pattern — RECOVERED-WORK-MULTI-GATE-DEFECT** ("a crashed/died worker's uncommitted work,
even when correctly branch-isolated per FOLLOW-448, can carry multiple independent gate-class
defects — lint, format, type-narrowness, AND bundler-specific import resolution — that only a full
local pre-PR gate run [including an actual `next build`, not just `vitest`+`tsc`] surfaces").
Explicitly distinguished from RETRO-146's WORKER-BRANCH-HYGIENE (that pattern is about WHERE
uncommitted work ends up — stranded on `main` vs. a proper branch; this pattern is about whether
correctly-located work is actually gate-clean). Held at count 1, no rule promotion — **FOLLOW-474
filed** (P3, devops-engineer, promoted directly to Sprint 22b as READY) to codify a mandatory pre-PR
`next build` gate for control-plane workers + fold in the session-6 candidate note about worktree
workspace-dts bootstrap.

**Delegated FOLLOW-450 and FOLLOW-457**, the next two unblocked Sprint 22b tickets, to different
free agents (no shared-tree hazard), each requiring an isolated worktree as its literal first action
per FOLLOW-448:

- FOLLOW-450 (P0, backend-engineer) — the only READY P0 this session (FOLLOW-449 remains
  CODE_COMPLETE_OPERATOR_PENDING, not a fresh pick; FOLLOW-451 is DONE). Enable feedback endpoint /
  bandit learning loop — code leg only (canary wiring, SDK Sentry breadcrumb, e2e verification
  harness); the Doppler-prd provisioning + flag flip (AC1) stays operator-only, same class as
  FOLLOW-449's AC1/AC2.
- FOLLOW-457 (P1, ml-engineer) — LLM grounding integrity: fail-loud on empty original-description
  fetch + fact whitelist on the directive (headline/CTA) path. Noted in the ticket that ESC-019 is
  ALREADY RESOLVED (the reachability/auth half) per ESCALATIONS.md — this ticket's audit-report
  source text calling it "still open" refers to the distinct fail-loud/whitelist residual, not a
  reopen; flagged in the delegation note to avoid confusion.

**IN_PROGRESS count:** FOLLOW-450 + FOLLOW-457 + stale TICKET-PILOT-001 = 3 (at the 3-ticket cap —
no further delegation until one clears).

**No new escalation opened.** Three OPEN escalations (ESC-020, ESC-028, ESC-034) re-confirmed
non-blocking against established precedent (each explicitly self-documents as operator-action-
pending, not an unresolved architectural/product decision).

**Tool-availability note (carried forward from session 7):** this session's toolset does not include
a subagent-spawn mechanism for `retrospective-analyst` or the two newly-delegated workers; retro
analysis and delegation bookkeeping were performed directly in QUEUE.md/RETROSPECTIVES.md/
FOLLOW_UPS.md by the orchestrating session, and the actual FOLLOW-450/457 implementation work is
expected to happen via the external harness that acts on this session's `NEXT:` directive.

---

## SESSION 7 (2026-07-02) — FOLLOW-452/453 DONE + retros written, FOLLOW-454/455 delegated

**Read state first (step 1):** `backlog/QUEUE.md`, `backlog/ESCALATIONS.md`, `backlog/HANDOFFS.md`,
`git log --oneline -20`, `gh pr list --state open` (0 open PRs at session start; `git status` clean
on `main`, in sync with `origin/main` at `7f473d3`). Three OPEN escalations (ESC-020, ESC-028,
ESC-034) re-confirmed non-blocking — each is explicitly self-documented in ESCALATIONS.md as
operator-action-pending (not an unresolved architectural/product decision), consistent with every
prior session's re-check. No new escalation opened. Proceeded with validation + delegation.

**FOLLOW-452 and FOLLOW-453 confirmed MERGED and marked DONE.** `gh pr view 418/419` confirm
`state: MERGED` at commits `c0d9b39` / `807869d` respectively (both squash-merged 2026-07-02T09:17Z,
matching `main` HEAD history). QUEUE.md updated: both `status: READY_FOR_REVIEW` → `DONE`, all AC
checkboxes flipped `[x]`, `completed_at` set. Runtime-wiring re-verified independently (not trusting
the PR bodies' own claims):

- FOLLOW-452: `grep -n "assignHoldout" apps/control-plane/src/app/api/adapt/route.ts` → 2 real
  (non-test) call sites (POST pre-existing at :1287, GET new at :879);
  `grep -n "GROUP BY ad.archetype" apps/control-plane/src/app/api/pilot/cta-lift/route.ts` →
  confirms the per-archetype lift consumer this fix reconnects.
- FOLLOW-453:
  `grep -rn "/api/analytics" apps/ packages/ --include=*.ts --include=*.tsx | grep -v node_modules`
  → zero source references (only stale `.next/` build artifacts, which regenerate);
  `grep -rln "MockDataBadge" apps/control-plane/src` → 3 real non-test consumers (analytics page
  new, pilot + labels pages pre-existing).

**RETRO-147 (FOLLOW-452) and RETRO-148 (FOLLOW-453) written** to `backlog/RETROSPECTIVES.md`
following the retrospective-analyst's 10-section algorithm (summary, verification, wiring audit,
discovered gaps, cascading impact, new lesson candidates, prior-follow-up closure, multi-axis
reconciliation, follow-ups, cross-references). Both wiring audits clean. RETRO-147 logged one fresh
count-1 pattern candidate (PLACEHOLDER-VALUE-ON-MEASURED-ARM — a measured arm's telemetry write uses
a hardcoded placeholder instead of the would-be real value; sibling-but-distinct from RETRO-146's
ARM-ASYMMETRY-WRITE-GAP). RETRO-148 found no fresh pattern (confirming instance of the
already-promoted Rule K.2 applied to the UI-read axis). No rule promoted (both single sightings; no
prior corpus match found for the RETRO-147 pattern). No new FOLLOW stub filed by either retro —
minor notes folded into the existing FOLLOW-441 canary-widening recommendation (RETRO-146/147) and
FOLLOW-471 re-audit QA awareness (RETRO-148), not duplicated.

**Note on process (tool-availability constraint):** this session's toolset did not include a
subagent-spawn mechanism for `retrospective-analyst`; the analysis above was performed directly by
the orchestrating session using the same read-only tool surface (Read/Grep/Bash) the
retrospective-analyst agent definition specifies, following its documented algorithm verbatim. Flag
for a future session/tooling check: confirm whether an actual Task/Agent-spawn tool should be
available to pm-orchestrator sessions going forward, since literal spawning is the documented design
(`.claude/agents/retrospective-analyst.md`).

**Delegated FOLLOW-454 and FOLLOW-455** to two different free agents, each in an isolated worktree
(FOLLOW-448 branch-first discipline mandated as literal first action):

- FOLLOW-454 (P1, backend-engineer; table row: "ingest worker, control-plane, decision-api,
  Postgres/RLS, auth, onboarding HTTP, billing, webhooks -> backend-engineer") — SSR-cookie auth
  mismatch (F-01). Picked as the highest-impact unblocked P1: fixes login-then-401 across the ENTIRE
  tenant dashboard (analytics/pilot/ab/quiz-config/tenants), the same class FOLLOW-326/ADR-0013
  already patched admin-side. Directly complements the just-merged FOLLOW-453 (fail-loud UI now
  shows an honest error banner instead of fake zeros for exactly the users this bug breaks). Branch:
  `backend-engineer/FOLLOW-454-ssr-cookie-auth`.
- FOLLOW-455 (P1, compliance-engineer; table row: "DPIA/ROPA/consent/DSR rules/fair-housing/AI-Act
  docs -> compliance-engineer") — DSR OTP hardening (F-20): Math.random() (not CSPRNG), no
  rate-limit/lockout, incomplete Art.17 erasure coverage, stubbed Art.15/20 disclosure count. A live
  security + compliance gap, same class this repo has previously treated as a go-live blocker (cf.
  ESC-035 forgeable-auth precedent). Branch: `compliance-engineer/FOLLOW-455-dsr-otp-hardening`.

Both agents differ from each other and from the stale TICKET-PILOT-001 assignees, so no shared-tree
hazard; each still requires its own isolated `git worktree` per FOLLOW-448.

**FOLLOW-449 / FOLLOW-450 explicitly NOT delegated to a worker this session.** Both remain
operator-gated (ClickHouse prod migration attest+apply for FOLLOW-449;
`FEEDBACK_ENDPOINT_ENABLED=true` Doppler-prd flip for FOLLOW-450) — privileged actions only Piotr or
Rafał can execute, per the existing PILOT GO-LIVE CHECKLIST below. Surfacing here rather than as a
new ESCALATIONS.md entry: both are already fully documented as operator-pending in QUEUE.md/this
file with no new information this session, matching the ESC-020/ESC-028/ESC-034 non-blocking-checkl
ist pattern rather than a fresh unresolved decision.

**IN_PROGRESS count after this session: 3** — FOLLOW-454 (backend-engineer), FOLLOW-455
(compliance-engineer), TICKET-PILOT-001 (stale since 2026-05-29, unchanged, still flagged for a
future queue-hygiene pass). AT the 3-ticket cap — no further ticket may be delegated until one of
these three clears.

**CI check-count this session: 0/5** (docs-only bookkeeping; no new PR opened by this session beyond
the QUEUE/STATUS/RETROSPECTIVES update, which will get its own CI run once pushed). Fix-iteration
counter: 0/3.

**Branch-first discipline (FOLLOW-448) applies** to this session's own docs-only commit as well —
must branch off `main` before committing, per the established pm-orchestrator precedent (sessions
4/5).

---

## SESSION 5 (2026-07-02) — FOLLOW-451 DONE, two residuals filed, FOLLOW-450 decoupled, FOLLOW-452/453 delegated

**Read state first (step 1):** `backlog/QUEUE.md`, `backlog/ESCALATIONS.md`, `backlog/HANDOFFS.md`,
`git log --oneline -20`, `gh pr list --state open` (0 open PRs at session start). Three OPEN
escalations re-confirmed non-blocking against precedent already recorded in this file (ESC-020,
ESC-028, ESC-034 — all operator-action-pending, none is an unresolved architectural/product
decision). No new escalation opened. Proceeded with bookkeeping + delegation.

**FOLLOW-451 marked DONE.** PR #416 confirmed MERGED (`gh pr view 416`) at merge commit
`0e994156773c58c04c21f092233e5dc28e7a34d9` (matches `main` HEAD `0e99415` at session start),
2026-07-01T23:37:35Z. Real API-key auth added to `POST /api/adapt` alongside the existing demo-JWT
path via the shared ADR-0015 `resolveApiKey()`; 403 on API-key-path `body.tenant_id` mismatch;
`resolveApiKey()` DB error fails loud (401 + Sentry, tags `area:adapt kind:api_key_auth_db_error`)
per Rule K.2. Evidence pulled from PR #416's own body: 13 tests (6 new `route.follow451.test.ts` + 7
unmodified `route.demo-auth.test.ts` regressions), CI counter 0/5, fix-iterations 0/3.

**Two residuals filed as new FOLLOW tickets** (next-free-pointer confirmed at 472 via
`backlog/FOLLOW_UPS.md` tail comment before writing):

- **FOLLOW-472** (P3, backend-engineer) — demo-JWT path has no tenant_id-claim-vs-body mismatch
  check when the JWT carries no `tenant_id` claim (PR #416 scope decision §1, deliberately not
  closed by FOLLOW-451 to avoid breaking the FOLLOW-260 supersede-only test). Low risk (demo JWTs
  are server-minted with the claim today).
- **FOLLOW-473** (P2, backend-engineer) — `GET /api/adapt` still uses `ADAPT_API_KEY` presence-only
  auth (degrades to "any non-empty bearer" when unset) + spoofable `x-tenant-id` fallback (PR #416
  scope decision §2) — now materially weaker than the hardened POST path.

Both stubbed in `backlog/FOLLOW_UPS.md` with source/scope/AC, next-free pointer bumped to 474, AND
promoted directly into `backlog/QUEUE.md` Sprint 22b as `status: READY` (not left as stubs — the
user's request was explicit that these should be immediately actionable).

**FOLLOW-450 `depends_on` loosened from `[FOLLOW-449]` to `[]`.** Confirmed by re-reading the prior
session's own flagged note (session 4, this file) that the bandit/feedback subsystem
(`ab_bandit_weights`, `conversion_labels`) is Postgres-only with zero code dependency on
`intent_events`/ClickHouse migration 0015 (FOLLOW-449's scope). Left a note in QUEUE.md that
FOLLOW-450's CODE can proceed now; only its production go-live (`FEEDBACK_ENDPOINT_ENABLED` flip +
`OPS_TENANT_ID`/`ADAPT_API_KEY` Doppler prd provisioning) remains operator-gated — same class as
FOLLOW-449's own operator leg, schedulable together but not a technical blocker.

**FOLLOW-452 and FOLLOW-453 marked IN_PROGRESS**, delegated to backend-engineer on isolated worktree
branches:

- `backend-engineer/FOLLOW-452-holdout-archetype-logging` — table row: "ingest worker,
  control-plane, decision-api, Postgres/RLS, auth, onboarding HTTP, billing, webhooks ->
  backend-engineer".
- `backend-engineer/FOLLOW-453-analytics-fail-loud-ui` — same table row.

Both notes in QUEUE.md flag the ISOLATED-WORKTREE requirement explicitly: the FOLLOW-451/RETRO-146
near-miss showed a shared working directory lets one worker's branch-switch strand another's
uncommitted commit on `main`. Each worker gets its own `git worktree` checkout on its own branch
before either touches a file — this is the human's responsibility when spawning (delegation scopes
below), not something this PM session executes.

**IN_PROGRESS count after this session: 3** — FOLLOW-452 (backend-engineer), FOLLOW-453
(backend-engineer), TICKET-PILOT-001 (stale since 2026-05-29, unchanged, still flagged for a future
queue-hygiene pass). This is AT the 3-ticket cap — acceptable for this batch per the user's explicit
instruction, but no further ticket may be delegated until one of these three clears.

**CI check-count this session: 0/5** (docs-only bookkeeping PR about to be opened; will validate its
own CI once pushed). Fix-iteration counter: 0/3.

**Branch-first discipline (FOLLOW-448) applied:** branched
`pm-orchestrator/FOLLOW-451-bookkeeping-0702` off `main` (`0e99415`) before any edit, per the
mandated first action.

---

## SESSION 4 FOLLOW-UP (2026-07-02) — PR #414 merged, CI green confirmed, worker branch live

PR #414 MERGED by Piotr Nawrocki (CEO) at commit `e867092`, 2026-07-01T23:13:57Z. CI evidence:
non-success count for REAL gates = **0** (verified via `gh pr checks 414` after full completion; the
only fail is `Rule I — wired-or-dead check`, 173 violations, confirmed via job log
`Rule I FAILED: 173 symbol(s) with zero non-test importers` — same count as PR #413's own
pre-existing baseline, and this PR touched zero source files, only `backlog/*.md`,
`docs/MASTER_DESIGN.md`, `.gitleaks.toml`).

**CI check-count for PR #414: 2/5** (iteration 1: gitleaks false-positive found on
`backlog/STATUS.md:68` — a 40+-char branch-name substring tripping the `cloudflare-api-token`
heuristic, same class as the existing QUEUE.md/HANDOFFS.md exemptions; iteration 2: fixed via a
path-scoped allowlist addition, confirmed green). Fix-iteration counter: 1/3.

**Mid-session collaboration note:** while this PR's CI was running, Piotr pushed a second,
complementary `.gitleaks.toml` fix directly to the same branch (commit `6df0d0a`, co-authored
"Claude Fable 5") — a token-scoped regex for the `<agent>/<ticket>-<kebab>` branch-slug pattern,
narrower than my path-based fix per Rule V's "never file-scope backlog/\*.md" principle. Both
exemptions now coexist in `.gitleaks.toml` (harmless redundancy, not a conflict); no action needed.

**FOLLOW-451 worker branch confirmed live:** `backend-engineer/FOLLOW-451-adapt-api-key-auth` exists
(branch-first per FOLLOW-448), currently at parity with `main` — work not yet pushed.

**IN_PROGRESS count:** 2 — FOLLOW-451 (backend-engineer); TICKET-PILOT-001 (stale since 2026-05-29,
unchanged, flagged again for a future queue-hygiene pass). Within the 3-ticket cap.

## SESSION 4 (2026-07-02) — CEO decisions recorded, FOLLOW-449 marked code-complete, FOLLOW-451 delegated

**Branch-first (FOLLOW-448) applied to this docs-only PM session:** started uncommitted edits on
`main` for the CEO-decision recording, caught by the pre-commit hook warning, immediately branched
to `pm-orchestrator/FOLLOW-449-ceo-decisions-0702` before committing (mirrors PR #412 precedent for
docs-only PM sessions).

**PR #413 (FOLLOW-449) confirmed MERGED** to `main` at `18367d3`. QUEUE.md updated: FOLLOW-449
status → `CODE_COMPLETE_OPERATOR_PENDING` (code/CI/docs scope AC3/AC4/AC5 DONE; AC1/AC2 prod
attest+apply remain OPERATOR-PENDING, tracked in the new "PILOT GO-LIVE CHECKLIST" section below,
per ESC-020/ESC-034 precedent — code-complete-awaiting-operator is non-blocking for delegation but
the ticket itself is NOT DONE).

**CEO decisions Q1/Q2/Q3 (2026-07-02) recorded** in `backlog/QUEUE.md` (Sprint 22b ticket notes) and
`docs/MASTER_DESIGN.md` §Snapshot.1 addendum:

- Q1: BOTH PATHS mandated for POST /api/adapt (demo-JWT + real API key). FOLLOW-451 confirmed P0.
- Q2: SHADOW-ONLY for this pilot. FOLLOW-458 downgraded P1→P2 fast-follow (deploy deferred, code
  kept — not deleted).
- Q3: MEASURED pilot confirmed. FOLLOW-450/452/453 confirmed P0/P1 go-live blockers.

**Escalations re-checked:** ESC-020, ESC-028, ESC-034 all OPEN but non-blocking (unchanged). No new
escalations opened. No blocking escalation prevents delegation this session.

**Delegated FOLLOW-451** (P0, backend-engineer; table row: "ingest worker, control-plane,
decision-api, Postgres/RLS, auth, onboarding HTTP, billing, webhooks -> backend-engineer") — add
real API-key auth path to POST /api/adapt reusing ADR-0015 `resolveApiKey()`. Pure code ticket, no
depends_on, no operator/prod gate — proceeds immediately. QUEUE.md updated atomically before
delegation: `status: IN_PROGRESS`, `assigned_to: backend-engineer`, `started_at`,
`branch: backend-engineer/FOLLOW-451-adapt-api-key-auth`.

**FOLLOW-450 depends_on review:** flagged in QUEUE.md notes that `depends_on:[FOLLOW-449]` looks
over-constrained — the feedback/bandit subsystem (`ab_bandit_weights`) is Postgres-only and has no
code dependency on `intent_events` (ClickHouse); the real coupling is that both need a Doppler prd
touch, which is an operator-sequencing convenience, not a technical blocker. Left the dependency in
place pending explicit confirmation (not unilaterally changing scope/dependencies without review) —
flagged for whoever picks up FOLLOW-450 next.

**IN_PROGRESS count after this delegation:** 2 — FOLLOW-451 (backend-engineer, this session);
TICKET-PILOT-001 (sdk-engineer+backend-engineer, STALE since 2026-05-29, Lane B, not touched again
this session — carrying forward the session-3 flag for a future queue-hygiene pass; within the
3-ticket cap either way). FOLLOW-449 no longer counts (moved to CODE_COMPLETE_OPERATOR_PENDING, off
the IN_PROGRESS cap).

**CI check-count this iteration:** 0/5 (no PR opened yet for FOLLOW-451 — it was just delegated).
Fix-iteration counter: 0/3. This session's own PR (docs-only, CEO-decision recording) is a separate
artifact from the ticket itself; validate that PR's CI as usual once opened.

## SESSION 3 (2026-07-01) — PR #412 merged, FOLLOW-449 delegated to data-engineer

PR #412 merged to `main` (commit `9278cca`). Sprint 22b (FOLLOW-449..471) is now live in
`backlog/QUEUE.md` on `main`. Queue hygiene: found FOLLOW-448 (branch-first discipline) still marked
`IN_PROGRESS` in QUEUE.md despite its PR #411 having merged (`42050a0`, 2026-07-01T20:09:09Z) —
corrected to `DONE` before picking new work (self-check: no stale IN_PROGRESS counted against the
3-ticket cap).

Escalations re-checked, all still non-blocking (unchanged from session 2): ESC-020, ESC-028, ESC-034
(all OPEN but explicitly marked non-blocking-for-pipeline in ESCALATIONS.md). ESC-035 is RESOLVED.
No new escalations opened this session.

**Delegated FOLLOW-449** (P0, data-engineer; table row: "ClickHouse, Redpanda, ETL, archetype
pipeline, drift cron, DSR delete -> data-engineer") — apply CH migration 0015
(`intent_events.session_id`) to prod + de-silence rejected `intent_events` inserts + extend
FOLLOW-402 contract test to `intent_events`. QUEUE.md updated atomically before delegation:
`status: IN_PROGRESS`, `assigned_to: data-engineer`, `started_at`,
`branch: data-engineer/FOLLOW-449-intent-events-session-id-prod`. Branch-first (FOLLOW-448) mandated
as the worker's literal first action. Prod-apply caveat embedded in the delegation: the worker
prepares code/CI/runbook only — actual `migrate.sh` execution against Doppler `prd` CH credentials
is a privileged operator action (Piotr/Rafał), per ESC-022/ESC-031 precedent.

IN_PROGRESS count after this delegation: 2 (FOLLOW-449 data-engineer; TICKET-PILOT-001
sdk-engineer+backend-engineer, stale since 2026-05-29, Lane B, not touched this session — flagging
for a future queue-hygiene pass, not blocking). Within the 3-ticket cap.

CI check-count this iteration: 0/5 (no PR opened yet for FOLLOW-449). Fix-iteration counter: 0/3.

## SESSION 2 (2026-07-01) — Sprint 22b chartered, PR #412 open

Second end-to-end code audit (session 2, 8 tracks) found 21 findings (F-01..F-21). Chartered as
**Sprint 22b** directly into `backlog/QUEUE.md` (FOLLOW-449..471), Master_Design bumped to v4.2.
This is a **docs/backlog-only** change (no app code) on branch
`pm-orchestrator/AUDIT-0701B-full-audit-remediation-plan` → **PR #412**
(https://github.com/Pnawrocki9/Adaptive-Listings/pull/412).

**CI check-count this iteration: 1/5.** CI green — non-success count for REAL gates = **0** (only
pre-existing-red `Rule I — wired-or-dead check` fails, confirmed also FAILURE on the immediately
prior merged PR #411, unrelated to this diff). Fix-iteration counter: 0/3 (no fixes needed).

**Escalations reviewed, all confirmed non-blocking-for-new-work (operator/CEO-priority items, not
unresolved architectural decisions):** ESC-020 (Rafał prod DOM-hook deploy, non-blocking per CEO),
ESC-028 (4 Upstash GH secrets, soft-skip canary by design), ESC-034 (Modal embed-seed operator
go-live, code bugs already fixed by FOLLOW-437). None block picking Sprint 22b's P0s.

**Why PR #412 must merge BEFORE any Sprint 22b ticket is delegated:** per FOLLOW-448 (branch-first
worker discipline, merged #411), every worker's first action is `git checkout -b <branch> main` — a
ticket only exists for a worker once it is on `main`'s `QUEUE.md`. Delegating FOLLOW-449 now would
mean the data-engineer branches from a main that has no Sprint 22b ticket definition.

**Three CEO decisions still open (gate priority, not correctness):** Q1 pilot auth model (demo-JWT
vs real API key, affects FOLLOW-451 severity), Q2 chat in scope for this pilot (affects FOLLOW-458),
Q3 measured vs demonstration pilot (affects FOLLOW-450/452/453 urgency). Not escalated as blocking
since Sprint 22b's P0 ordering (FOLLOW-449 → 450 → 451) is CEO-directed and correct regardless of
the answers — the answers only affect P1-tier severity, not what ships first.

**Next action:** human merges PR #412, then PM delegates FOLLOW-449 (data-engineer, ClickHouse
migration + fail-loud row — decision table row: "ClickHouse, Redpanda, ETL, archetype pipeline,
drift cron, DSR delete").

---

## AUDIT 2026-07-01 (session 1) — Pilot-blocking findings promoted to tickets

A staff-level end-to-end code audit (F-01..F-25, verdict YELLOW) completed this session. Five
pilot-blocking findings were promoted; four are now DONE:

| Audit ref | FOLLOW / ESC | Priority | Agent          | Status                                   | Summary                                                                                              |
| --------- | ------------ | -------- | -------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| F-01      | FOLLOW-439   | P0       | backend        | DONE (#398)                              | Lift route: delete buildMockLiftRows, fix dqsUnavailable=false, add data_source                      |
| F-02      | FOLLOW-440   | P0       | backend        | DONE (#398)                              | Fix assigned_at→ts + phantom latency_ms in summary + inquiry-starts                                  |
| F-04      | FOLLOW-329   | P0       | backend        | DONE (#398)                              | Summary route: same fail-loud + data_source fix (resolved in same PR as 439/440)                     |
| F-05      | FOLLOW-442   | P1       | backend        | DONE (#406, merged 2026-07-01T16:29:05Z) | POST adapt holdout missing logDecisionAsync                                                          |
| F-06      | FOLLOW-441   | P0       | data           | DONE (#399)                              | Prod CH write-verification canary for logDecisionAsync                                               |
| F-09      | **ESC-035**  | **SEC**  | human decision | **RESOLVED**                             | SECURITY fix shipped: ADR-0015 ACCEPTED + FOLLOW-443 merged (#401); FOLLOW-444 interim merged (#397) |

FOLLOW-392 (prod archetype seed) DONE — verified 18/18 seeded in prod 2026-07-01 (PR #402 corrected
the stale NULL claim). CI gate hardening follow-ons FOLLOW-446 DONE (#403), FOLLOW-447 (P3, READY,
not pilot-blocking).

**HARD PILOT GO-LIVE GATE: FULLY CLEAR ON THE CODE SIDE as of 2026-07-01T19:24Z** (ESC-035
RESOLVED + FOLLOW-329/439/440/441/442 all DONE + FOLLOW-392 prod seed verified). Only the two
non-blocking operator actions remain outside the pipeline: ESC-034 (Modal embed-seed go-live) and
setting `OPS_TENANT_ID`/`ADAPT_API_KEY`/`FEEDBACK_ENDPOINT_ENABLED` in Doppler `prd` (see below).

RETRO-146 (PR #409, for FOLLOW-442) surfaced a near-miss: the backend-engineer worker stalled 600s
mid-ticket, leaving the correct fix uncommitted directly on the `main` working tree (never ran
`git checkout -b`). PM recovered it onto the proper branch, independently re-ran
typecheck+lint+11/11 holdout tests (never trusting the stalled worker's unclaimed "passing" state),
then committed/pushed/opened the PR. Generated FOLLOW-448 (P2, devops-engineer + pm-orchestrator) —
branch-first worker discipline + a mechanical `HEAD==main` guard hook + formalizing "recovered work
must be independently re-verified" in the PM handoff procedure. Promoted to QUEUE.md and delegated
this session (queue hygiene: FOLLOW-364 and FOLLOW-442 were also corrected from stale IN_PROGRESS to
DONE in QUEUE.md — both were already merged, #408 and #406 respectively).

**HARD PILOT GO-LIVE GATE:** ESC-035 RESOLVED ✓ + FOLLOW-329/439/440/441 DONE ✓ + FOLLOW-392 seed
run ✓. Only **FOLLOW-442** remains open on the code side. Separately, an **operator action** remains
(non-blocking, tracked like ESC-034): ops must set `OPS_TENANT_ID` + `ADAPT_API_KEY` in Doppler
`prd` and flip `FEEDBACK_ENDPOINT_ENABLED=true` before the feedback endpoint serves live pilot
traffic.

---

## ESC-031 RESOLVED — prod incident closed

Migration 0019 applied 2026-06-26T~12:00Z via ClickHouse Cloud SQL console. Column
`page_context_source` exists with correct type and default. All `/api/adapt` writes now succeeding.
FOLLOW-394 remaining code ACs (contract test + runbook) delegated to data-engineer. See
backlog/ESCALATIONS.md ESC-031.

---

## PILOT GO-LIVE CHECKLIST — privileged operator actions (Piotr/Rafał)

Running list of code-complete-awaiting-operator items that must clear before/during the measured
pilot. Each is non-blocking for further ticket delegation (ESC-020/ESC-034 precedent) but IS
blocking for actual go-live. Do not mark any of these DONE until the real output is pasted in.

| Item                                                                                                | Ticket             | What's needed                                                                                                                                                                          | Status                                                                             |
| --------------------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| CH migration 0015 attest+apply to prod                                                              | FOLLOW-449         | `doppler run --config prd -- ./migrate.sh` (or equivalent) against prod ClickHouse; paste real `DESCRIBE TABLE intent_events` proof into `docs/runbooks/clickhouse-migrations.md` stub | OPERATOR-PENDING (code/CI/docs DONE, PR #413 merged 18367d3)                       |
| Backfill/verify all 0015→latest CH migrations applied in prod                                       | FOLLOW-449         | Same runbook, step 4 attestation                                                                                                                                                       | OPERATOR-PENDING                                                                   |
| Provision `OPS_TENANT_ID` + `ADAPT_API_KEY` in Doppler `prd`; flip `FEEDBACK_ENDPOINT_ENABLED=true` | FOLLOW-450         | Doppler prd secrets + flag flip, then prod canary ping                                                                                                                                 | NOT STARTED (ticket READY, CEO-confirmed P0 2026-07-02)                            |
| Modal embed-seed consumer go-live (3 secrets + `modal deploy`)                                      | FOLLOW-436/ESC-034 | `docs/runbooks/modal-embed-seed-consumer-golive.md` steps 1-3                                                                                                                          | OPERATOR-PENDING                                                                   |
| Upstash Redis test-instance secrets (4x) in GitHub Actions + Doppler                                | ESC-028            | Create test Upstash DB, add 4 secrets, add to Doppler dev/staging/prod                                                                                                                 | OPERATOR-PENDING                                                                   |
| Estalara-app prod deploy of committed DOM hooks + SDK flag                                          | ESC-020            | Deploy `web-master` HEAD, set `PUBLIC_ESTALARA_SDK_ENABLED=true`, verify `data-estalara-*` in prod HTML                                                                                | OPERATOR-PENDING (local-first testing agreed; deploy still gates live measurement) |

---

## PROD SEED ACTION REQUIRED — §F cosine MOAT go-live (FOLLOW-341 / FOLLOW-392)

FOLLOW-341 (PR #352) merged and code-complete. Dev DB auto-populates via post-migrate-seed.yml. PROD
Supabase does NOT auto-populate.

OPERATOR ACTION:
`cd apps/control-plane && SUPABASE_SERVICE_ROLE_KEY=<prod_key> OPENAI_API_KEY=<key> pnpm seed:archetypes`
OR trigger seed-archetypes.yml workflow_dispatch with prod credentials. Until this runs,
affinityScore() falls back to djb2-fallback ordering in prod (safe degradation). Tracked as
FOLLOW-392 (devops+ml, P1, promoted).

---

## Active CI-check counters (step 5b tracking)

| Ticket         | CI checks used | Fix iterations used | Status                                                                                                                                                         |
| -------------- | -------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FOLLOW-342     | 0/5            | 0/3                 | DONE (PR #327 + #353 merged 2026-06-25/26)                                                                                                                     |
| FOLLOW-357     | 2/5            | 1/3                 | DONE (PR #334 + #354 d8d5cb8, 2026-06-25)                                                                                                                      |
| FOLLOW-356     | —              | —                   | DONE (absorbed into FOLLOW-357 PR #354)                                                                                                                        |
| FOLLOW-363     | 1/5            | 0/3                 | DONE (PR #351 merged 2026-06-25)                                                                                                                               |
| FOLLOW-389     | —              | —                   | DONE (PR #355 merged 0e1b9eb, 2026-06-26)                                                                                                                      |
| FOLLOW-361     | 1/5            | 0/3                 | DONE (PR #356 merged 4eb24af4, 2026-06-26T10:08Z). RETRO-117 DONE.                                                                                             |
| FOLLOW-358     | 3/5            | 2/3                 | DONE (PR #357 merged a8eacb4a, 2026-06-26T10:40Z). RETRO-118 DONE.                                                                                             |
| FOLLOW-354     | 1/5            | 0/3                 | DONE (PR #358 merged 701aa4efb9, 2026-06-26T11:23Z). RETRO-119 DONE.                                                                                           |
| FOLLOW-362     | 1/5            | 0/3                 | DONE (PR #359 merged dfe8a9cd71, 2026-06-26T11:31Z). RETRO-120 DONE.                                                                                           |
| FOLLOW-394     | 3/5            | 2/3                 | DONE — PR #360 merged 5898739afaf6 (2026-06-26T13:24Z). RETRO-121 DONE.                                                                                        |
| FOLLOW-397     | 1/5            | 0/3                 | DONE — PR #361 merged 7962b4e9c22e (2026-06-26T14:01Z). RETRO-122 DONE.                                                                                        |
| FOLLOW-396     | 1/5            | 0/3                 | DONE — PR #362 merged 2026-06-26T14:17Z. RETRO-123 DONE.                                                                                                       |
| FOLLOW-403     | 1/5            | 0/3                 | DONE — PR #363 merged 2026-06-26T14:32Z. RETRO-124 DONE.                                                                                                       |
| FOLLOW-407     | 1/5            | 0/3                 | DONE — PR #364 merged 2026-06-26T14:48Z. RETRO-125 DONE.                                                                                                       |
| FOLLOW-398     | 1/5            | 0/3                 | DONE — PR #365 merged 2026-06-26T14:52Z. RETRO-126 DONE.                                                                                                       |
| FOLLOW-410     | 1/5            | 0/3                 | DONE — PR #366 merged 2026-06-26T15:13Z. RETRO-127 DONE.                                                                                                       |
| FOLLOW-409     | 1/5            | 0/3                 | DONE — PR #367 merged 2026-06-26. RETRO-128 DONE.                                                                                                              |
| FOLLOW-402     | 1/5            | 0/3                 | DONE — PR #368 merged 2026-06-26. RETRO-129 DONE.                                                                                                              |
| FOLLOW-414     | 1/5            | 0/3                 | DONE — PR #369 merged 2026-06-26T16:46Z. RETRO-130 DONE.                                                                                                       |
| FOLLOW-415     | 0/5            | 0/3                 | DONE — PR #370 merged 2026-06-26T17:12Z. RETRO-131 DONE.                                                                                                       |
| FOLLOW-405     | 1/5            | 0/3                 | DONE — PR #371 merged 2026-06-26. RETRO-132 DONE.                                                                                                              |
| FOLLOW-404     | 0/5            | 0/3                 | DONE — PR #372 merged 2026-06-26. RETRO-133 DONE.                                                                                                              |
| FOLLOW-406/411 | 0/5            | 0/3                 | DONE — PR #373 merged 2026-06-26. RETRO-134 PENDING.                                                                                                           |
| FOLLOW-425     | 0/5            | 0/3                 | DONE — PR #374 merged 2026-06-26. RETRO-135 DONE.                                                                                                              |
| FOLLOW-422     | 0/5            | 0/3                 | DONE — PR #375 merged 2026-06-28. RETRO-136 PENDING.                                                                                                           |
| FOLLOW-427/428 | 0/5            | 0/3                 | DONE — PR #377 merged. RETRO-137 DONE.                                                                                                                         |
| FOLLOW-429/430 | 0/5            | 0/3                 | DONE (fire-and-forget sweep chain).                                                                                                                            |
| FOLLOW-431     | 0/5            | 0/3                 | DONE — PR #379 merged. RETRO-138 DONE.                                                                                                                         |
| FOLLOW-432     | 0/5            | 0/3                 | DONE — PR #381 merged. RETRO-139 DONE.                                                                                                                         |
| FOLLOW-433     | 0/5            | 0/3                 | DONE — PRs #382+#384 merged. RETRO-140 DONE.                                                                                                                   |
| FOLLOW-434     | 0/5            | 0/3                 | DONE — PR #385 merged. RETRO-141 DONE.                                                                                                                         |
| FOLLOW-435     | 0/5            | 0/3                 | DONE — PRs #389+#390 merged. RETRO-142 DONE.                                                                                                                   |
| FOLLOW-436     | 0/5            | 0/3                 | OPEN — ESC-034 operator go-live pending.                                                                                                                       |
| FOLLOW-437     | 0/5            | 0/3                 | DONE — PR #393 merged 2026-06-30. RETRO-143 DONE.                                                                                                              |
| FOLLOW-438     | 0/5            | 0/3                 | DONE — PR #395 merged 2026-06-30. RETRO-144 DONE.                                                                                                              |
| FOLLOW-444     | 0/5            | 0/3                 | DONE — PR #397 merged (interim 503 + scoped ops bypass).                                                                                                       |
| FOLLOW-439     | 0/5            | 0/3                 | DONE — PR #398 merged 2026-06-30 (with FOLLOW-329/440).                                                                                                        |
| FOLLOW-440     | 0/5            | 0/3                 | DONE — PR #398 merged 2026-06-30 (with FOLLOW-329/439).                                                                                                        |
| FOLLOW-329     | 0/5            | 0/3                 | DONE — PR #398 merged 2026-06-30 (with FOLLOW-439/440).                                                                                                        |
| FOLLOW-441     | 0/5            | 0/3                 | DONE — PR #399 merged (prod CH write-verification canary).                                                                                                     |
| ADR-0015       | 0/5            | 0/3                 | DONE — PR #400 merged, ACCEPTED.                                                                                                                               |
| FOLLOW-443     | 0/5            | 0/3                 | DONE — PR #401 merged (ESC-035 permanent fix). ESC-035 RESOLVED.                                                                                               |
| FOLLOW-392     | 0/5            | 0/3                 | DONE — PR #402 merged (prod seed verified 18/18, stale claim corrected).                                                                                       |
| FOLLOW-446     | 0/5            | 0/3                 | DONE — PR #403 merged (CI gate un-blinded).                                                                                                                    |
| FOLLOW-442     | 0/5            | 0/3                 | IN_PROGRESS — PR #406 open, CI running (owned by main session; PM-orchestrator instructed NOT to touch/re-validate/merge this ticket).                         |
| FOLLOW-447     | 0/5            | 0/3                 | READY — P3, not pilot-blocking. depends_on FOLLOW-446 (DONE).                                                                                                  |
| FOLLOW-364     | 0/5            | 0/3                 | IN_PROGRESS — delegated to ml-engineer 2026-07-01 (this PM pass). Docs-only §D.6 coverage-summary fix, premise re-verified against docs/MASTER_DESIGN.md:1954. |
| FOLLOW-451     | 0/5            | 0/3                 | DONE — PR #416 merged 2026-07-01T23:37:35Z (commit 0e99415). Real API-key auth on POST /api/adapt.                                                             |
| FOLLOW-450     | 0/5            | 0/3                 | READY — depends_on loosened to [] 2026-07-02 (Postgres-only, no code coupling to FOLLOW-449).                                                                  |
| FOLLOW-452     | 0/5            | 0/3                 | DONE — PR #418 merged 2026-07-02T09:17:04Z (commit c0d9b39). RETRO-147 DONE.                                                                                   |
| FOLLOW-453     | 0/5            | 0/3                 | DONE — PR #419 merged 2026-07-02T09:17:07Z (commit 807869d). RETRO-148 DONE.                                                                                   |
| FOLLOW-472     | 0/5            | 0/3                 | READY — filed + promoted 2026-07-02 (FOLLOW-451 residual, demo-JWT mismatch check).                                                                            |
| FOLLOW-473     | 0/5            | 0/3                 | READY — filed + promoted 2026-07-02 (FOLLOW-451 residual, GET auth parity).                                                                                    |
| FOLLOW-454     | 0/5            | 0/3                 | IN_PROGRESS — delegated to backend-engineer 2026-07-02 (session 7), isolated worktree.                                                                         |
| FOLLOW-455     | 0/5            | 0/3                 | IN_PROGRESS — delegated to compliance-engineer 2026-07-02 (session 7), isolated worktree.                                                                      |

---

## Open escalations (re-checked 2026-07-02, session 5)

| ESC     | Age | Summary                                                         | Blocking pipeline?                          |
| ------- | --- | --------------------------------------------------------------- | ------------------------------------------- |
| ESC-020 | 26d | Estalara-app DOM hooks not deployed to prod                     | No (operator action)                        |
| ESC-028 | 9d  | Upstash Redis secrets for smoke CI                              | No (soft-skip)                              |
| ESC-034 | 2d  | Modal embed-seed consumer operator go-live                      | No (operator action, code ready)            |
| ESC-035 | 1d  | RESOLVED 2026-07-01 — feedback HMAC forgeable auth (code fixed) | No (only a flip-flag operator step remains) |

---

## Active sprint: Sprint 22 (OPEN)

Next free FOLLOW stub number: **448**.

**IN_PROGRESS (2/3 max, as of this pass):**

- FOLLOW-442 (P1, backend-engineer) — PR #406 open, CI running. Owned by the main session
  (human-authorized to merge on green); this PM pass does not touch it. Last remaining code item on
  the hard pilot go-live gate.
- FOLLOW-364 (P2, ml-engineer) — delegated this pass (see "DELEGATING NOW").

**DELEGATING NOW:**

- FOLLOW-364 (P2, ml-engineer) — table row: intent/adapt logic, embeddings, LLM gateway,
  auto-detect, ontology, platform-templates. Reconcile §D.6 coverage-summary counts to a clean
  18-way partition in docs/MASTER_DESIGN.md (docs-only). ~1h. Not pilot-blocking; picked because it
  is P2, fully unblocked (depends_on: []), premise-verified against the live repo today, and
  ml-engineer/sdk-engineer/data-engineer/devops-engineer were all otherwise free (backend-engineer
  is occupied by FOLLOW-442, which rules out same-agent P2/P3 backend tickets FOLLOW-367/370/400/401
  this pass).

**READY — re-surveyed 2026-07-01 (this pass; supersedes the stale FOLLOW-417/418/420/421 list
below,** **those IDs no longer exist in QUEUE.md):**

- FOLLOW-447 (P3, devops-engineer) — audit sibling CI gates for INERT-GATE failure modes. 2h. Fully
  unblocked (depends_on FOLLOW-446, DONE). Good next pick after this pass.
- FOLLOW-395 (P3, data-engineer) — realize page_context_source discriminator consumer. 2h. Fully
  unblocked (depends_on FOLLOW-394, DONE).
- FOLLOW-355 (P3, sdk-engineer) — cold-start signal_count invariant. 2h. depends_on: [].
- FOLLOW-401 (P3, backend-engineer) — bandit locale-scope decision. 3h. depends_on: []. Blocked on
  agent availability while FOLLOW-442 is IN_PROGRESS (same agent).
- FOLLOW-370 (P2, backend-engineer) — cache getBanditArms non-holdout path. 2h. depends_on: [].
  Blocked on agent availability while FOLLOW-442 is IN_PROGRESS (same agent); also touches the same
  route.ts file as FOLLOW-442 — do not run in parallel even once backend-engineer frees up without
  diffing against FOLLOW-442's merged change first.
- FOLLOW-367 (P2, backend-engineer) — implement/remove CHAT_NLP_LIVE gate. 3h. NOT actually ready
  despite depends_on:[FOLLOW-366] (DONE) — notes require "all 5 C-07 DPIA go-live items signed off"
  first; that sign-off is not confirmed done. Needs a human/compliance check before delegating.
- FOLLOW-399 (P3, sdk-engineer) — BLOCKED on FOLLOW-355 (still READY, not DONE).
- FOLLOW-400 (P2, backend-engineer) — BLOCKED on FOLLOW-031 (not promoted to QUEUE.md at all — only
  a FOLLOW_UPS.md stub; not truly ready regardless of agent availability).
- FOLLOW-388 (P2, data-engineer) — flagged NOT actionable yet in QUEUE.md notes 2026-07-01: its
  premise (surface opt-out state in `read_recent_chat_sessions`) requires a real ClickHouse batch
  query that no ticket has implemented yet (`apps/intent-engine/src/clickhouse_reader.py:4` is still
  a hardcoded `[]` stub). Do not delegate until that prerequisite exists.

---

## Pending retrospectives (RETRO-134, RETRO-136)

| RETRO     | Source ticket(s) | PR(s) | Status                  |
| --------- | ---------------- | ----- | ----------------------- |
| RETRO-134 | FOLLOW-406/411   | #373  | PENDING — to be spawned |
| RETRO-136 | FOLLOW-422       | #375  | PENDING — to be spawned |

---

## Migration status

| Migration       | Scope   | CI             | Prod apply                      | Notes                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------- | ------- | -------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0019 (CH)       | CH      | CI container   | APPLIED ~12:00Z                 | page_context_source — ESC-031 RESOLVED 2026-06-26                                                                                                                                                                                                                                                                                                                                                            |
| 0031 (Postgres) | Drizzle | db-migrate.yml | APPLIED (confirmed)             | Strip variant='default'; run 28231486742 success                                                                                                                                                                                                                                                                                                                                                             |
| 0032 (Postgres) | Drizzle | db-migrate.yml | IN PROGRESS — NOT YET CONFIRMED | dsr_verifications.attempt_count (FOLLOW-455); run 28586941940 auto-triggered by merge `765cb81`, still on staging leg as of 2026-07-02 session 8 end. `dsr-verify.ts` reads this column on every DSR verify — NEXT SESSION MUST `gh run view 28586941940` and confirm `completed success` (both staging+prod legs) before treating as live; escalate as P0/P1 if failed (DSR is a legal-compliance surface). |

---

## CI Gates — Real gates status (last verified 2026-06-30)

Real gates (GREEN): Build, Build (control-plane), Typecheck, Lint, Test (Node 22), SDK E2E, Rule H,
Rule J, ClickHouse migrations smoke, Corpus gate, Tracer query CI guard, Redis shadow round-trip
(soft-skip pending ESC-028), Privacy Notice SDK key-sync, Demo integration, Gitleaks, Migration
journal monotonicity, Modal singleton guard (FOLLOW-438, PR #395), Archetype embeddings not-NULL
(un-blinded 2026-07-01 by FOLLOW-446/PR #403 — now genuinely verifies prod-shaped seed data;
DOPPLER_TOKEN_DEV absence on forked PRs still soft-skips, but build/query breakage now REDs).

Pre-existing FAILURE / NON-BLOCKING: Rule I (~175 violations, FOLLOW-090 baseline; SDK-bundle
`Build` gate may also be pre-existing-red — do not treat as a merge blocker).

---

## ESCALATION STATUS

| ESC     | Status   | Summary                                                                             |
| ------- | -------- | ----------------------------------------------------------------------------------- |
| ESC-035 | RESOLVED | SECURITY: ADR-0015 ACCEPTED + FOLLOW-443 merged (#401) — operator flip-flag remains |
| ESC-034 | OPEN     | Modal embed-seed operator go-live pending (non-blocking; code ready)                |
| ESC-028 | OPEN     | Upstash Redis secrets not provisioned (non-blocking, soft-skip)                     |
| ESC-020 | OPEN     | Estalara-app DOM hooks not deployed to prod (non-blocking)                          |
| ESC-032 | RESOLVED | ingest_worker grant breadth security posture — signed off                           |
| ESC-031 | RESOLVED | P1: adaptation_decisions writes silently failing — migration 0019 applied           |
| ESC-033 | RESOLVED | Fire-and-forget sinks lack after() — fixed by FOLLOW-431..433                       |
| ESC-030 | RESOLVED | CEO Option A; FOLLOW-341 DONE PR #352                                               |
| ESC-029 | RESOLVED | CEO approved ChatMessageSentPayloadSchema extension 2026-06-24                      |
| ESC-027 | RESOLVED | CEO: page_context; FOLLOW-357+356 DONE PR #354                                      |
| ESC-026 | RESOLVED | FOLLOW-360 merged 2836adc                                                           |
| ESC-025 | RESOLVED | FOLLOW-366 merged eaf31a9                                                           |
