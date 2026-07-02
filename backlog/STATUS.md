# Status — 2026-07-02 (Sprint 22b OPEN — FOLLOW-452/453/454/455 DONE; FOLLOW-450/457 IN_PROGRESS)

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
