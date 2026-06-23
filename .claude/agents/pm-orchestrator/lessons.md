# PM Orchestrator Lessons

---

**Date / ticket:** 2026-06-17 — RETRO-087 (FOLLOW-325 / PR #315) + RETRO-069 (FOLLOW-287+288 / PRs
#281+#282) + marking FOLLOW-325 DONE + promoting FOLLOW-331/332/336 to QUEUE **Delegation row
used:** N/A — PM-self retro analysis + queue hygiene (step 6). **What validation caught (or
missed):** RETRO-087: DETECT_SERVE_URL non-test producer+consumer confirmed (domains.ts:73 →
DetectionPreview.tsx:183). RETRO-069: SELECT 1 no-op pattern for blocked ORDER BY key ALTER is safe
(migration journal gate hashes timestamps/count, not SQL content). Caught that RETRO-064/067/068
were already written in RETROSPECTIVES.md but STATUS.md still showed them as PENDING SPAWN — the old
RETRO TRACKING table was stale. **A delegation/validation rule I'd add:** When marking tickets DONE
after human merge, always verify the PR merge commit exists in git log before updating QUEUE.md — do
not rely on "was READY_FOR_REVIEW" as a proxy for "is merged."

---

**Date / ticket:** 2026-06-17 — RETRO-062 + RETRO-063 (FOLLOW-276 / PR #272 + FOLLOW-278 / PR #273
retrospective spawns) **Delegation row used:** N/A — PM-self retrospective analysis (step 6,
post-merge, retro backlog, two docs-only/test-only PRs batched). **What validation caught (or
missed):** RETRO-062: docs-only PR, wiring audit N/A, no FOLLOW stubs needed. Confirmed zero
surviving "buildSnippet emits" claims for retired attributes via PR body grep evidence. RETRO-063:
constraint accepted (GDPR compliance), locale render-hop test proves FOLLOW-275's mergeQuizConfig
wiring is correct end-to-end. No new gaps. **A delegation/validation rule I'd add:** For docs-only
and test-only PRs, skip the full wiring audit and just confirm the grep evidence in the PR body is
valid — these PRs have no new symbols to trace.

---

**Date / ticket:** 2026-06-17 — RETRO-083 (FOLLOW-326 / PRs #309/#310/#311 retrospective spawn)
**Delegation row used:** N/A — PM-self retrospective analysis (step 6, post-merge, retro backlog).
**What validation caught (or missed):** Wiring audit: createBrowserClient/createServerClient/
checkStaffSession/verifyTracerAdminAuth all confirmed with non-test producers + consumers. Found
TG-1/TG-2: checkStaffSession (the primary admin auth path after sign-in) and the middleware SSR gate
have zero test coverage — FOLLOW-336 filed. The 3-PR iteration pattern (scaffold → cookie mismatch →
API auth gate) is the expected outcome for @supabase/ssr migration. **A delegation/validation rule
I'd add:** When a PR introduces a new primary auth path (the MAIN production gate, not a fallback),
verify its test count before READY_FOR_REVIEW — a primary auth path with zero tests is a P2 gap
regardless of whether the existing tests are green.

---

**Date / ticket:** 2026-06-17 — RETRO-082 (FOLLOW-324 / PR #308 retrospective spawn) **Delegation
row used:** N/A — PM-self retrospective analysis (step 6, post-merge, retro backlog). **What
validation caught (or missed):** Wiring audit: \_\_EStalaraDetect producer (detect-bundle.ts:36) and
consumer (index.ts:821) confirmed in non-test code. The removed top-level re-export (export {
detectSiteSchema }) had no production consumer (grep verified). Found TG-1: detect-bundle.ts (new
companion IIFE entry) has no unit test for the global assignment — FOLLOW-335 filed. LG-1 (snippet
half-wire) acknowledged as tracked by FOLLOW-325. **A delegation/validation rule I'd add:** When a
new IIFE entry file is added (tsup `format: ['iife']`), verify a unit test covers the global
assignment that the entry is responsible for — if the test suite only covers the consumer side
(reading the global), the producer side is untested.

---

**Date / ticket:** 2026-06-17 — RETRO-081 (FOLLOW-293 / PR #307 retrospective spawn) **Delegation
row used:** N/A — PM-self retrospective analysis (step 6, post-merge, retro backlog). **What
validation caught (or missed):** Wiring audit: fetchIntentWeights is imported from the real SDK (no
mock) — correct for a live-network smoke. ESTALARA_SMOKE_API_KEY / URL / REQUIRE_LIVE_INTENT_SMOKE
all have clean producers in the CI workflow and consumers in the test. ESC-024 filing + resolution
pattern correctly applied. Smoke run 27555287447 GREEN attests FOLLOW-307 migration apply. No gaps
warranting follow-up stubs — all LG points are P3 by-design. **A delegation/validation rule I'd
add:** When a live-network smoke test PR is validated, confirm the CI job has BOTH a soft-skip path
for missing secrets AND a nightly/scheduled run that exercises the hard-assert path — a smoke that
only ever soft-skips provides zero production assurance.

---

**Date / ticket:** 2026-06-17 — RETRO-086 (FOLLOW-330 / PR #314 retrospective spawn) **Delegation
row used:** N/A — PM-self retrospective analysis (step 6, post-merge, retro backlog). **What
validation caught (or missed):** Wiring audit: all changed symbols (CH_TRACER_TIMEOUT_MS,
buildJsonlExportUrl) are module-private, no export/import wiring required — CLEAN. Found two new
pattern count-1s: (a) 'use client' components that access window synchronously at render time crash
SSR; (b) hardcoded AbortSignal timeouts ignore managed-service idle/cold-start behavior. Neither
reached count-2 promotion threshold. FOLLOW-334 filed for CH keep-warm cron. **A
delegation/validation rule I'd add:** When a PR fixes a timeout, check if the timeout was hardcoded
for an assumed service latency without accounting for idle/cold-start — if so, file a keep-warm
follow-up immediately.

---

**Date / ticket:** 2026-06-17 — RETRO-085 (FOLLOW-328 / PR #313 retrospective spawn) **Delegation
row used:** N/A — PM-self retrospective analysis (step 6, post-merge, 7 retros outstanding). **What
validation caught (or missed):** Step 5c wiring audit confirmed clickhouseAuthHeaders has 12+
non-test production importers (clean); identified that the summary route's .catch(()=>null)
silent-mock is a pre-existing Rule K.2 gap (FOLLOW-329 carry-forward, NOT a new defect introduced by
PR #313). Caught TG-1: only 1 of 12 call-sites has a route-level auth-header assertion; 11
uncovered. No Rule promoted (centralized-helper illusion count-1; K.2 already governs the
silent-mock sub-shape). **A delegation/validation rule I'd add:** When a "fan-out helper migration"
PR touches N call-sites, verify the test-count for the centralized helper against the number of
migrated call-sites — if (call-site tests asserting helper output) << N, file a TG follow-up
immediately.

---

**Date / ticket:** 2026-06-17 — RETRO-084 (FOLLOW-327 / PR #312 retrospective spawn) **Delegation
row used:** N/A — retrospective-analyst spawn (PM step 6, post-merge). **What validation caught (or
missed):** RETRO-084 found that DEFAULT_INTENT_WEIGHTS docstring claims a CI drift guard
(intent-weights-drift.test.ts) that does not exist, and the single-tenant admin shell change (the
headline deliverable) shipped with zero tests on the changed files. The analyst correctly did not
prematurely promote Rules. FOLLOW numbers 331/332 were pre-announced in FOLLOW-325 PR body for
different concepts; the analyst correctly used the authoritative FOLLOW_UPS.md next-free marker
(333) instead. **A delegation/validation rule I'd add:** When a PR body pre-announces follow-up stub
numbers, always grep FOLLOW_UPS.md for the canonical next-free marker before spawning retros — the
pre-announcement may be stale relative to other retros that already consumed those numbers.

---

**Date / ticket:** 2026-06-17 — FOLLOW-325 (buildSnippet companion auto-include, session 2 /
context-resumed) **Delegation row used:** Row 2 (control-plane, onboarding HTTP — backend-engineer)
**What validation caught (or missed):** `git stash show stash@{0} --name-only` confirmed the stash
holds DetectionPreview.tsx + test + INTERFACES.md + domains.ts, but NOT
`apps/control-plane/public/estalara-detect.iife.js`. AC2 requires the companion artifact to be
placed in public/ so it can be served via Vercel static hosting. This gap means even a clean
stash-apply would leave AC2 unmet — the artifact copy step must be explicit in the delegation
prompt. **A delegation/validation rule I'd add:** When an AC requires a build artifact to be SERVED
from a static directory (e.g. public/), always grep that directory in the stash diff to confirm the
artifact copy step is present — "the IIFE exists in SDK dist" and "the IIFE is in public/" are two
different facts.

---

**Date / ticket:** 2026-06-17 — FOLLOW-325 validation (PR #315, backend-engineer, READY_FOR_REVIEW)
**Delegation row used:** Row 2 (control-plane, onboarding HTTP — backend-engineer) **What validation
caught (or missed):** Rule I shows 168 violations (up from ~107 baseline). Step 5c confirmed
DETECT_SERVE_URL has both a non-test producer (domains.ts exported via packages/shared/src/index.ts)
and a non-test consumer (DetectionPreview.tsx line 183, buildSnippet()). The increase in Rule I
violations is not from FOLLOW-325 code — none of the new symbols appear in the Rule I failure list.
PR also references FOLLOW-331 and FOLLOW-332 in code comments but does NOT file them as
FOLLOW_UPS.md stubs — caught at validation, flagged in PR comment for sprint-planning follow-up. **A
delegation/validation rule I'd add:** When a PR's code comments reference future FOLLOW-NNN stubs by
number but those stubs are absent from FOLLOW_UPS.md, flag this in the PR comment and add a
post-merge task to file the stubs — deferred follow-up stubs referenced in code but not filed are
invisible to the sprint planner.

---

---

**Date / ticket:** 2026-06-18 — FOLLOW-331 (PR #317 fedfeb0) + FOLLOW-332 (PR #318 fb9d201) marked
DONE; RETRO-089/090 pending spawn; FOLLOW-335 delegated to sdk-engineer **Delegation row used:** Row
1 (client SDK, browser code — sdk-engineer) for FOLLOW-335. **What validation caught (or missed):**
Both PRs merged to origin/main while local main was stale (11 superseded local chore commits). Used
`git log origin/main` and `gh pr view` as source of truth rather than local git — correct per
session context. No wiring issues for FOLLOW-331 (drift test is a test-only file with no runtime
wiring requirement). FOLLOW-332 is test-only (admin/layout.test.tsx + admin/page.test.tsx +
pilot-tenant.test.ts) — no new runtime symbols to wire, 5c N/A. **A delegation/validation rule I'd
add:** When local main is diverged from origin/main, always source PR merge confirmation from
`git log origin/main` or `gh pr view`, never from local git history.

---

**Date / ticket:** 2026-06-14 — FOLLOW-269 (promotion from BLOCKED to IN_PROGRESS) + FOLLOW-308
(status reconciliation BACKLOG→DONE) **Delegation row used:** Row 2 (control-plane, Next.js —
backend-engineer) **What validation caught (or missed):** QUEUE.md still showed FOLLOW-269 as
BLOCKED and FOLLOW-308 as BACKLOG even though all FOLLOW-269 depends_on (FOLLOW-266/267/268) had
merged and FOLLOW-308 was implemented in PR #297. The session context note is the source of truth
for what actually merged — QUEUE.md can lag behind when the prior session ended mid-update. Always
re-verify status by cross-checking git log + QUEUE.md; don't rely on the last-session QUEUE.md
alone. **A delegation/validation rule I'd add:** After each batch of merged PRs, run a mini audit:
for every BLOCKED ticket whose depends_on are now all DONE, promote to READY before picking a new
ticket — stale BLOCKED entries hide ready work.

---

**Date / ticket:** 2026-06-13 — FOLLOW-288 (PR #282) validation + ESC-021 resolution **Delegation
row used:** Row 2 (ingest worker — backend-engineer) **What validation caught (or missed):** ESC-021
was filed requiring human approval, but the fix (PR #282) was straightforward and already merged
before escalation could be reviewed. Step 5c grep confirmed migration 0016 = SELECT 1,
intent_session_id absent from INSERT body, session_id present, confidence_before 0.0, console.error
wired — all four FOLLOW-287 acceptance criteria passed in production code. The ESC-021 filing was
overly cautious: ClickHouse error 524 is a hard constraint, not a design question. Local stash
conflict in QUEUE.md required git stash/pull/pop resolution. **A delegation/validation rule I'd
add:** ESC-021-class escalations (hard technical constraints with unambiguous correct answers)
should be resolved by pm-orchestrator without waiting for human, per scope rules — only escalate
when there is a genuine architectural or business choice to be made.

---

**Date / ticket:** 2026-06-13 — FOLLOW-287 (PR #281) post-merge validation **Delegation row used:**
Row 2 (ingest worker / backend-engineer) **What validation caught (or missed):** PR #281 was merged
by human before PM validation ran. The stated fix ("migration 0016 is now a SELECT 1 no-op") was
factually false — the file still contains
`ALTER TABLE intent_events MODIFY COLUMN intent_session_id String DEFAULT '';`. ClickHouse 26.5.1
throws code 524 (ALTER_OF_COLUMN_IS_FORBIDDEN) on MODIFY COLUMN of ORDER BY keys. CI log grep for
the exact error message surfaced this immediately. ESC-021 filed; FOLLOW-288 queued to repair. **A
delegation/validation rule I'd add:** When a context note says "migration X is now a no-op", always
read the actual file before accepting — description vs file content mismatch is a known failure mode
(occurred here and in FOLLOW-149 journal drift). Step 5c must grep the migration file content, not
trust the PR description.

---

**Date / ticket:** 2026-06-12 — FOLLOW-266 Phase 1 DONE validation (PR #277 already merged)
**Delegation row used:** Row 4 (ClickHouse/data-engineer Phase 1, completed) + Row 2
(backend-engineer Phase 2, now delegating). **What validation caught (or missed):** PR #277 was
MERGED before this session ran — `gh pr list --state all` confirmed merge at 2026-06-12T18:23:36Z.
Three retros (RETRO-062 FOLLOW-276, RETRO-063 FOLLOW-278, RETRO-064 FOLLOW-266 P1) were all pending
spawn simultaneously. For greenfield migrations-only Phase 1 PRs, Rule I is satisfied by the Drizzle
barrel re-export (`intentSessions` export in schema/index.ts) — data-engineer documented this
explicitly in PR body, which made validation straightforward. Phase 2 (backend-engineer) must use
the exact column names from migration 0028 and the ClickHouse DDL 0014 — integration check 5d will
grep for those column names across both phases. **A delegation/validation rule I'd add:** When a
co-assigned ticket completes Phase 1 (schema-only), always confirm the migration number continuity
(0028 → 0029) and CH migration continuity (0014 → 0015) before delegating Phase 2 to avoid journal
monotonicity failures.

---

**Date / ticket:** 2026-06-12 — FOLLOW-266 Phase 1 spawn (data-engineer delegation) **Delegation row
used:** Row 4 — ClickHouse, Redpanda, ETL, archetype pipeline → data-engineer (AC1 Supabase
migration + AC3 ClickHouse DDL). **What validation caught (or missed):** Pre-delegation repo-read
confirmed: last Supabase migration idx=27 when=1781208120531, last ClickHouse migration 0013.
Data-engineer must hand-patch journal `when` per Rule O if drizzle-kit emits a stale timestamp. Rule
H deferral comment required in SQL files since Phase 2 consumer lands in a separate PR. **A
delegation/validation rule I'd add:** For migrations-only PRs (no runtime code), Rule I is satisfied
by a barrel re-export of the Drizzle schema file — document this path explicitly in delegation
prompts to avoid unnecessary Rule I CI failures.

---

**Date / ticket:** 2026-06-12 — FOLLOW-266 delegation (K.3.6 Archetype Tracer foundation, 3-agent
co-assigned) **Delegation row used:** Row 4 (ClickHouse — data-engineer primary), Row 2 (CF Worker
ingest/Postgres — backend-engineer), Row 1 (SDK event — sdk-engineer). **What validation caught (or
missed):** git log at session start showed 8 tickets merged since last STATUS.md update —
FOLLOW-272/276/277/278/279 not yet marked DONE, FOLLOW-273/274 still READY_FOR_REVIEW. Caught all
via `git log --oneline -20` vs QUEUE.md. The 3-agent co-assigned ticket (FOLLOW-266) required
explicit sequencing: data-engineer (DB/CH tables AC1-3) → backend-engineer (CF Worker AC5) →
sdk-engineer (intent.snapshot AC4). Step 5d integration check will be critical: the CF Worker
consumer (AC5) must read from the same schema data-engineer defines (AC1-3), and the SDK event (AC4)
must use the Zod schema the same branch defines. **A delegation/validation rule I'd add:** For
3-agent co-assigned greenfield tickets, always enforce strict phase sequencing in HANDOFFS.md — the
"all three can work in parallel" temptation is wrong when Phase 2 agents need Phase 1's type
definitions.

---

**Date / ticket:** 2026-06-11 — FOLLOW-274 (PR #267) + FOLLOW-273 (PR #268) validation **Delegation
row used:** Rows 1 and 2 (sdk-engineer for SDK locale, backend-engineer for control-plane). **What
validation caught (or missed):** Build CI gate "SDK bundle size 51.24KB > 40KB" was FAILING on both
PRs. Step 5b `gh pr checks` was essential — the `ci_status: green` in QUEUE.md (worker self-report)
did NOT reflect this failure. Confirmed pre-existing on main (commit eff0158 = same failure) — three
consecutive main merges all show Build-fail before these PRs. Step 5c runtime-wiring grep confirmed
strong non-test producer + consumer for both tickets. FOLLOW-275 correctly gated on architect: the
"preferred" architecture (b) vs (a) choice between snippet-threading and SDK runtime GET is a
cross-module contract decision. **A delegation/validation rule I'd add:** When `gh pr checks` shows
a Build failure, ALWAYS grep the last 3+ main-branch CI runs to determine if the failure is
pre-existing before bouncing to IN_PROGRESS; a pre-existing Build failure is not grounds to block a
PR that passes all other real gates.

---

**Date / ticket:** 2026-06-11 — FOLLOW-274 (backend-engineer, orphaned quiz_config blob keys
micro_polls_enabled + sticky_widget) **Delegation row used:** Row 2 (control-plane, Postgres/RLS,
ingest/billing/webhooks — backend-engineer). **What validation caught (or missed):** Sprint 16
STATUS.md showed FOLLOW-271 still IN_PROGRESS but QUEUE.md header clearly stated it was DONE (PR
#266 merged). No open PRs confirmed via `gh pr list`. Promoted FOLLOW-274 from RETRO-056 stub (not
yet in queue) — required explicit Sprint 17 section add before delegation. **A delegation/validation
rule I'd add:** When STATUS.md and QUEUE.md header disagree on a ticket's status, QUEUE.md header is
authoritative (it is written last after merge confirmation); always reconcile STATUS.md at session
start.

---

**Date / ticket:** 2026-06-11 — FOLLOW-270 (backend-engineer, QuizConfig.language enum skew)
**Delegation row used:** Row 2 (control-plane, Postgres/RLS, auth, onboarding HTTP —
backend-engineer). **What validation caught (or missed):** FOLLOW-169 confirmed DONE via gh pr view
264 (state=MERGED). RETRO-054 still pending (deferred to avoid concurrent retro+delegation).
FOLLOW-270 and FOLLOW-271 were FOLLOW_UPS.md stubs only (promoted_to_queue: false) — needed explicit
promotion to QUEUE.md before delegation. FOLLOW-270 is prerequisite for FOLLOW-271 so they must run
sequentially, not in parallel. **A delegation/validation rule I'd add:** When promoting multiple
stubs from the same RETRO cycle that touch the same file, sequence them explicitly in QUEUE.md
(IN_PROGRESS then READY) to prevent merge conflicts, and note the sequencing rationale in STATUS.md.

---

**Date / ticket:** 2026-06-11 — FOLLOW-271 (backend-engineer, strip quizConfig.enabled from JSONB)
**Delegation row used:** Row 2 (control-plane, Postgres/RLS — backend-engineer). **What validation
caught (or missed):** PR #265 (FOLLOW-270) was already MERGED when session started — QUEUE.md still
showed READY_FOR_REVIEW. Caught via `gh pr view 265` state check. Also confirmed FOLLOW-271's
depends_on [FOLLOW-265, FOLLOW-270] are both DONE before setting IN_PROGRESS. RETRO-055 for
FOLLOW-270 still pending. **A delegation/validation rule I'd add:** At session start, always do a
`gh pr view` state check on any READY_FOR_REVIEW ticket before treating it as pending merge — merged
PRs need DONE status and retro spawning before picking next ticket.

---

**Date / ticket:** 2026-06-11 — FOLLOW-169 (ml-engineer, headline anti-hallucination) **Delegation
row used:** Row 3 (intent/adapt logic, embeddings, LLM gateway — ml-engineer). **What validation
caught (or missed):** State read confirmed FOLLOW-264 and FOLLOW-265 both DONE (PRs #263/#262
merged). ESC-020 remains OPEN but CEO-confirmed non-blocking for code work. FOLLOW-169 is the only
READY ticket in the active backlog (no unresolved blocking dependencies, no IN_PROGRESS tickets).
Pre-delegation grep confirmed both target files exist (`_generate_headline` in
`generate_description.py` line 1137; adapt-description.ts SDK headline branch without `ai_cached`
guard per spec). **A delegation/validation rule I'd add:** For Python+TypeScript co-spanning
tickets, explicitly note in the delegation which test harness each sub-fix targets (Python pytest vs
vitest) — the worker must run both suites, and CI validation must confirm both pass.

---

**Date / ticket:** 2026-06-10 — Loop 2 / FOLLOW-265 queue hygiene **Delegation row used:** No
delegation — ESC-020 OPEN, protocol STOP. **What validation caught (or missed):** Five stale
READY/IN_PROGRESS entries found (FOLLOW-149/174/176/182/190) — all merged weeks ago but never
updated in QUEUE.md Sprint 14 body section. The Sprint 16 header was correct; the Sprint 14 body was
stale. Always cross-check the git log against ALL queue sections, not just the sprint header. **A
delegation/validation rule I'd add:** When correcting stale QUEUE.md entries, always verify the
Sprint section header AND the individual ticket YAML blocks — they can diverge independently.

---

**Date / ticket:** 2026-06-10 — Sprint 13b / ESC-020 escalation surface **Delegation row used:** No
delegation — escalation stop required per rules. **What validation caught (or missed):** ESC-020
(Rafal CTO deploy) is OPEN and blocks per protocol even though it only affects FOLLOW-191's final
verification, not FOLLOW-257/263/169 code work. Also caught two stale Sprint 14 entries (FOLLOW-182
IN_PROGRESS, FOLLOW-183 READY) that STATUS.md already confirmed DONE — corrected atomically before
stopping. **A delegation/validation rule I'd add:** When the only OPEN escalation is a
deployment-action (not a code/arch decision), note explicitly in the escalation surface whether
human CAN unblock non-dependent code work in parallel — the strict STOP rule can be interpreted as
deployment-gated-only if the PM surfaces the dependency graph clearly.

---

**Date / ticket:** 2026-06-10 — Wave A (FOLLOW-258/259/260/261/262) + Sprint 16 close **Delegation
row used:** No delegation this iteration — state reconciliation only. **What validation caught (or
missed):** gh pr list showed 0 open PRs but QUEUE.md header showed 3 READY_FOR_REVIEW entries;
`gh pr view` per PR confirmed all 5 Wave A PRs were merged earlier today. Also found FOLLOW-185,
FOLLOW-175, FOLLOW-099, FOLLOW-173 all merged but still stale in QUEUE.md. Rule: always verify PR
state with `gh pr view` rather than trusting QUEUE.md header text. **A delegation/validation rule
I'd add:** At session start, diff `gh pr list --state merged --limit 10` against QUEUE.md
READY_FOR_REVIEW entries — any mismatch means stale state requiring atomic correction before
proceeding.

---

**Date / ticket:** 2026-06-09 — FOLLOW-185 (data-engineer PG-harness CRM+DSR integration test)
**Delegation row used:** Row 4 (ClickHouse/ETL/archetype pipeline/DB harness — data-engineer).
**What validation caught (or missed):** State reconciliation at session start found 3 tickets
(FOLLOW-183, FOLLOW-184 dup, FOLLOW-187) showing stale statuses in QUEUE.md Sprint 16 section — git
log proved all had merged PRs. No active CI validation this iteration; corrections were documentary
only. The pattern is repeated: git log is the ground truth for DONE status, QUEUE.md lags behind
after busy merge days. **A delegation/validation rule I'd add:** At the start of each PM session,
run `git log --oneline -20 | grep -E 'FOLLOW-[0-9]+'` and cross-check each referenced ticket's
QUEUE.md status before picking the next ticket — stale IN_PROGRESS/READY entries block correct
prioritization.

---

**Date / ticket:** 2026-06-08 — FOLLOW-183 (PR #228, data-engineer PG integration test) **Delegation
row used:** Row 4 (ClickHouse/ETL/archetype pipeline — data-engineer). Validation-only loop; PR was
already open. **What validation caught (or missed):** Step 5b (CI gate diff vs main) caught that
Gitleaks was failing on PR #228 but passing on main and on the most recently merged PR (#227). The
worker's pre-context incorrectly listed Gitleaks as pre-existing-red. Root cause: test file lives at
`src/upsert-conversion-label.test.ts`, not `src/__tests__/`, so it falls outside the
`.gitleaks.toml` allowlist path `packages/db/src/__tests__/`. Diffing non-success lists between the
PR branch and main is what surfaced this — without the diff, a self-reported "Gitleaks pre-existing"
would have slipped through. **A delegation/validation rule I'd add:** Always diff the PR's
non-success CI list against main's non-success list item-by-item; any gate that fails on the PR but
passes on main is a real regression regardless of what the worker reports.

---

**Date / ticket:** 2026-06-08 — RETRO-035/036/037/038 batch housekeeping + FOLLOW-227/230 delegation
**Delegation row used:** Row 1 (client SDK / sdk-engineer) for FOLLOW-227; Row 7
(DPIA/ROPA/compliance / compliance-engineer) for FOLLOW-230. **What validation caught (or missed):**
User said "mark FOLLOW-174 DONE — verify" and "mark FOLLOW-220 DONE — verify." Both commits
(31afb16, 0475e452) were already on main, confirming the PRs had merged. QUEUE.md had FOLLOW-174 as
IN_PROGRESS and FOLLOW-220 not yet promoted. This confirms the housekeeping step is critical: always
grep git log to verify commits before trusting QUEUE status. FOLLOW-222/223 (confirm dialog + unit
tests) were folded into FOLLOW-174 per PM delegation note — both correctly marked DONE via the fold.
FOLLOW-229 was initially set BLOCKED (on FOLLOW-220) but since FOLLOW-220 is now DONE, FOLLOW-229
transitions to READY before delegating. **A delegation/validation rule I'd add:** When "folded"
tickets depend on a completed ticket, mark them DONE at the same time as the parent — do not leave
them as READY after the parent completes, as it creates false backlog noise.

---

**Date / ticket:** 2026-06-08 — state-read loop (FOLLOW-174 #220 + FOLLOW-220 #221 awaiting merge)
**Delegation row used:** N/A — state-read/triage pass only; no new delegation this iteration. **What
validation caught (or missed):** QUEUE.md header still referenced PR #166 (FOLLOW-149) as
READY_FOR_REVIEW — confirmed via `gh pr view 166` that it merged. Stale header text does not affect
queue correctness (individual ticket entries are accurate), but illustrates that the block-comment
header drifts and must not be trusted for individual ticket states. Parallel work
(FOLLOW-182/183/184/185/187/218/190) is all unblocked by DONE dependencies and could start while the
two PRs await merge. **A delegation/validation rule I'd add:** When the QUEUE.md block-comment
header and the individual YAML entries contradict each other, always trust the YAML entries — the
header is a human-readable summary that drifts. Use `gh pr view <N>` to confirm actual PR state
before reporting it.

---

**Date / ticket:** 2026-06-08 — FOLLOW-174 (PR #220, admin label table + manual reclassification)
**Delegation row used:** Table row 2 (control-plane, Postgres/RLS — backend-engineer).
Validation-only loop. **What validation caught (or missed):** Step 5c grep confirmed full wiring:
GET producer at route.ts consumed by page.tsx:649 (fetch with query params), PATCH producer at
[id]/route.ts consumed by page.tsx:127, CalibrationResponse from FOLLOW-173's /api/pilot/calibration
consumed by page.tsx:686. Nav entry confirmed in layout.tsx:126. The `gh pr checks --json` flag does
not exist in this CLI version — use `gh api repos/.../commits/<sha>/check-runs` + Python
post-processing to get check states and confirm pre-existing failures match main. **A
delegation/validation rule I'd add:** When the pre-context says "all real CI gates pass," confirm by
diffing the PR's non-success list against main's non-success list via the API — same names =
pre-existing, new names = real regression.

---

**Date / ticket:** 2026-06-08 — FOLLOW-217 (PR #219, jsdom init() integration test) **Delegation row
used:** Row 1 (client SDK, browser code — sdk-engineer). No new delegation this loop — validation
only. **What validation caught (or missed):** Step 5c confirmed this is a pure test ticket with no
new exports — correct framing is to verify that imported production functions have non-test
producers AND consumers (confirmed via grep). The key insight from RETRO-033 TG-1 (test mirrors
init() wiring 1:1 vs. asserting a re-implementation) was verified by reading the test's helper
function docstrings and their mapped line ranges in index.ts. **A delegation/validation rule I'd
add:** For pure test tickets, step 5c should explicitly confirm the wiring level: tests must mirror
the production entrypoint (e.g., init()) at the correct abstraction, not just re-implement helper
logic — verify via documented line-number mapping in test comments.

---

**Date / ticket:** 2026-06-08 — FOLLOW-216 validation (PM-orchestrator validation loop) **Delegation
row used:** Row 1 (client SDK, browser code — sdk-engineer). No new delegation; this was a
validation-only loop. **What validation caught (or missed):** gh pr checks --json flag not available
in this gh CLI version; must use `gh pr view --json statusCheckRollup` + Python post-processing to
get deduplicated check results. The --watch output was sufficient to confirm passes but the jq
approach silently returned nothing. Cross-referencing pre-existing failures against main (ea9d59c)
via `gh run view <databaseId> --json jobs` is the reliable method. **A delegation/validation rule
I'd add:** When verifying pre-existing CI failures, always run
`gh run view <latest-main-run-id> --json jobs` and compare named jobs against PR failures — never
rely on the worker's self-report of "same as main."

---

**Date / ticket:** 2026-06-08 — FOLLOW-216 DONE + FOLLOW-217 delegation **Delegation row used:** Row
1 (client SDK, Shadow DOM, browser code — sdk-engineer). **What validation caught (or missed):** PR
#218 was already in MERGED state when this loop ran — STATUS.md correctly showed READY_FOR_REVIEW so
the merge happened between sessions. The queue update (READY_FOR_REVIEW → DONE) was straightforward.
No re-wiring check needed on merge since validation was confirmed in the prior loop. **A
delegation/validation rule I'd add:** At loop start, always verify PR state via
`gh pr view <pr> --json state` before any status action — a PR may have been merged between
orchestrator loops, requiring DONE transition rather than READY_FOR_REVIEW hold.

---

**Date / ticket:** 2026-06-07 — FOLLOW-216 (sdk-engineer) **Delegation row used:** Table row 1
(client SDK, browser code — sdk-engineer). **What validation caught (or missed):** RETRO-032 found
that FOLLOW-176's rehydrate gate only covers the archetype-hint block; the FOLLOW-207
referrer/device priors run unconditionally on top of the rehydrated state (LG-1). This was not
caught at FOLLOW-176 READY_FOR_REVIEW because the descoped jsdom init() integration test
(FOLLOW-217, also RETRO-032) would have exercised exactly that seam. Rule Q (added by RETRO-032) now
codifies this: always require a wired-entrypoint test. **A delegation/validation rule I'd add:**
When a ticket's Test plan names an integration/jsdom test that is descoped in the PR, treat it as a
P1 follow-up stub (not P3) — the descoped test is the signal that the wiring seam is untested, which
is where the next bug will live.

---

**Date / ticket:** 2026-06-06 — FOLLOW-191 (sdk-engineer) + FOLLOW-195 (backend-engineer) delegated
**Delegation row used:** Table row 1 (client SDK / browser code) for FOLLOW-191; table row 2
(control-plane / webhooks) for FOLLOW-195. **What validation caught (or missed):** ESC-019 was still
listed as OPEN in ESCALATIONS.md even though PR #196 resolved it on 2026-06-04 and FOLLOW-192.md was
already marked CLOSED. Updated ESCALATIONS.md header from OPEN to RESOLVED and added resolution
text. The stale OPEN entry would have triggered a false stop condition each session until caught.
**A delegation/validation rule I'd add:** After each PR merge that resolves an escalation, the
closing commit should update ESCALATIONS.md in the same PR — not leave it for the next PM session to
discover on a state-read pass.

---

**Date / ticket:** 2026-06-07 — FOLLOW-210 (sdk-engineer) **Delegation row used:** Table row 1
(client SDK, browser code) — sdk-engineer. **What validation caught (or missed):** STATUS.md showed
3 IN_PROGRESS tickets (FOLLOW-200, FOLLOW-204, FOLLOW-211) that were actually all DONE and merged.
The status file was stale from the previous session. Corrected before delegating new work. Also
noted that FOLLOW-210 Part 1 touches Estalara-app (local-only repo with no GitHub push) — step 5d
integration check will be limited to SDK-side consumer grep only; AC1 (app.estalara.com CustomEvent)
can only be browser-verified locally, not in CI. **A delegation/validation rule I'd add:** At the
start of each loop iteration, cross-check STATUS.md IN_PROGRESS entries against git log — any merged
commit that closes a ticket must be reflected in STATUS.md before a new ticket is delegated.

---

**Date / ticket:** 2026-06-05 — Sprint 15 planning (FOLLOW-191 through FOLLOW-206) **Delegation row
used:** Not applicable — this was a planning session (ticket creation + QUEUE.md update), not a
delegation. **What validation caught (or missed):** Three open escalations (ESC-009, ESC-010,
ESC-019) were noted at the start. ESC-019 is directly addressed by FOLLOW-192. ESC-009/010 are
infrastructure secrets that do not block the planning action but must be tracked as prerequisites
for some CI-gated work. No worker was delegated; no half-wires to check in this session. **A
delegation/validation rule I'd add:** When creating a co-assigned ticket (like FOLLOW-204 with 3
agents), explicitly note in the ticket that PM must run step 5d (producer→consumer integration
check) before READY_FOR_REVIEW — this is now embedded in FOLLOW-204's AC6 and Definition of Done.

---

**Date / ticket:** 2026-06-06 — Sprint 15 Track E planning (FOLLOW-207 through FOLLOW-211)
**Delegation row used:** Not applicable — this was a planning session (5 ticket files created +
QUEUE.md Track E section added), not a delegation. **What validation caught (or missed):**
FOLLOW-209 has a depends_on FOLLOW-199 (quiz widget v2.0 must exist before micro-polls can
supplement it); caught during scope review before writing the file. FOLLOW-210 is a cross-repo
co-assignment (Estalara-app CustomEvent + SDK listener) — step 5d requirement noted explicitly in
the ticket Definition of Done. FOLLOW-211 was flagged as an architectural prerequisite for
FOLLOW-099 so dependency is documented in both directions. **A delegation/validation rule I'd add:**
For cross-repo co-assigned tickets (Estalara-app + this repo), the step 5d grep cannot be run
against a single codebase — PM must verify the CustomEvent dispatch exists in the Estalara-app local
disk before marking READY_FOR_REVIEW.

---

**Date / ticket:** 2026-06-06 — State read after PRs #197/#198 merged (FOLLOW-191/195 DONE)
**Delegation row used:** Not applicable — escalation stop condition triggered; no delegation this
session. **What validation caught (or missed):** ESC-020 is OPEN (Rafal must deploy web-master HEAD
with PUBLIC_ESTALARA_SDK_ENABLED=true). The FOLLOW-196 ticket spec reveals its scope is actually
already partially DONE — the CustomEvent dispatches exist in ChatBot.svelte and LiveSessions.svelte,
but need payload extension (user_uuid, is_agent fields). This was caught by reading the spec before
delegating, which would have sent the agent to reimplement already-shipped code. **A
delegation/validation rule I'd add:** Before delegating any Estalara-app ticket, read the FOLLOW
spec's Resolution section — some tickets were already partially or fully resolved by prior work in
web-master and the spec records what remains.

---

**Date / ticket:** 2026-06-06 — FOLLOW-196 (sdk-engineer), FOLLOW-194 (sdk-engineer +
backend-engineer), FOLLOW-193 (backend-engineer + compliance-engineer) delegated **Delegation row
used:** Row 1 (client SDK / browser code) for FOLLOW-196; Row 1 + Row 2 for FOLLOW-194 (co-assigned:
SDK fixes F-01/08/13/15 = sdk-engineer, backend fix F-16 = backend-engineer); Row 2 +
compliance-engineer for FOLLOW-193. **What validation caught (or missed):** ESC-020 (physical deploy
by Rafal) does not block agent picks per operating rules — human-only escalations that no agent can
resolve must not stall the pipeline. Vercel Pro (Q3) blocks only FOLLOW-193 AC1 (cron restore), not
AC2 (engagement_scores); confirmed from QUEUE.md note and ticket spec before delegating. FOLLOW-196
and FOLLOW-194 touch different codebases (Estalara-app SvelteKit vs this repo) so sdk-engineer can
work on both without file conflicts. **A delegation/validation rule I'd add:** When a co-assigned
ticket's sub-fixes span two repos, explicitly note the repo boundary in the delegation prompt so the
agent knows which files are in-scope vs out-of-scope for each owner.

---

**Date / ticket:** 2026-06-07 — FOLLOW-197 (sdk-engineer) delegated (CHAT-003 SDK listeners for
chat/live events) **Delegation row used:** Table row 1 (client SDK / browser code —
`estalara:chat:message-sent`, `estalara:live-signup` listeners wired into SDK index.ts + lead_id
derivation). **What validation caught (or missed):** ESC-020 (Rafal deploy) is still OPEN but does
not block code wiring — confirmed from ticket spec that listeners + lead_id derivation can be
unit-tested without live production slots. FOLLOW-196 (DONE, PR #199) confirms the CustomEvent
dispatches exist in Estalara-app so the listener target contracts are real. QUEUE.md was stale for
FOLLOW-193/194/196 (showed READY, should be DONE) — corrected atomically before delegating. **A
delegation/validation rule I'd add:** At each session start, the PM should verify QUEUE.md entries
for any PRs merged in the prior session context and correct them before picking the next ticket —
stale READY entries inflate apparent queue depth and can cause re-delegation of completed work.

---

**Date / ticket:** 2026-06-07 — FOLLOW-197 DONE (PR #202 merged), FOLLOW-199 delegated (Quiz widget
v2.0) **Delegation row used:** Table row 1 (client SDK / browser code — quiz-widget.ts +
quiz-trigger.ts are both in packages/sdk). **What validation caught (or missed):** PR #202 was
MERGED on main (commit a2ca89d) but QUEUE.md showed FOLLOW-197 still as READY_FOR_REVIEW. Corrected
atomically before picking next ticket. The unnumbered OPEN escalation "Estalara-app DOM hooks" was
missing its ESC-020 label — STATUS.md referenced it but ESCALATIONS.md was unfixed. Assigned ESC-020
before delegating. **A delegation/validation rule I'd add:** When a PR squash-merge appears in git
log but QUEUE.md still shows READY_FOR_REVIEW, check `gh pr view <N>` to confirm merge state — git
log is the authoritative merge signal and supersedes stale queue entries.

---

**Date / ticket:** 2026-06-07 — FOLLOW-201 (sdk-engineer) + FOLLOW-203 (backend-engineer) delegated
in parallel **Delegation row used:** Table row 1 (client SDK / browser code) for FOLLOW-201; Table
row 2 (control-plane) for FOLLOW-203. **What validation caught (or missed):** FOLLOW-200
(co-assigned backend-engineer + data-engineer) is the highest urgency ticket (MOAT data loss on
every real quiz completion) but conflicts with FOLLOW-203 for the backend-engineer slot. Sequencing
FOLLOW-203 first (4h) frees backend-engineer for FOLLOW-200 next. FOLLOW-199 is confirmed DONE (PR
#203 merged, commit 7da4eea) — unblocking both FOLLOW-200 and FOLLOW-201. **A delegation/validation
rule I'd add:** When a ticket poses a "data loss on first production event" risk, mark it explicitly
in STATUS.md so the urgency is visible without re-reading the ticket spec each session.

---

**Date / ticket:** 2026-06-07 — FOLLOW-200 (backend-engineer + data-engineer), FOLLOW-204
(data-engineer + backend-engineer + ml-engineer), FOLLOW-211 (sdk-engineer) delegated in parallel
**Delegation row used:** Row 2 (backend + Postgres) for FOLLOW-200 (lead backend-engineer, migration
data-engineer); Row 4 (ClickHouse/ETL for migration) + Row 2 (control-plane route/webhook) + Row 3
(ML Modal write) for FOLLOW-204; Row 1 (client SDK) for FOLLOW-211. **What validation caught (or
missed):** STATUS.md was stale — showed FOLLOW-199 IN_PROGRESS when it was committed directly to
main (commits 7da4eea + 0ee7382). Also FOLLOW-201 and FOLLOW-203 were newly DONE (commits 72c83ea +
a786496) but STATUS.md still showed them as part of ongoing track status. Corrected STATUS.md before
delegating. Working tree was clean (git status confirmed only an untracked backend-engineer
lessons.md), so no stale branch interference. Three tickets dispatched simultaneously at the
3-IN_PROGRESS cap. **A delegation/validation rule I'd add:** When commits appear in git log without
a corresponding PR number, confirm in git log whether they were direct pushes or squash merges —
direct pushes to main bypass PR validation and should trigger a retrospective flag.

---

**Date / ticket:** 2026-06-07 — FOLLOW-202 (sdk-engineer) + FOLLOW-205 (backend-engineer) delegated
in parallel **Delegation row used:** Row 1 (client SDK / browser code) for FOLLOW-202; Row 2
(control-plane / auth) for FOLLOW-205. **What validation caught (or missed):** The gitStatus
snapshot at session start showed modified files on branch
sdk-engineer/FOLLOW-199-quiz-v2-decision-tree, but actual `git status` revealed we are on main with
only STATUS.md and backend-engineer lessons.md unstaged — the snapshot was stale. FOLLOW-210 was
also listed as IN_PROGRESS in STATUS.md but was already DONE (PR #208, commit 80a331e). Always run
git status live before acting on the system-prompt snapshot. **A delegation/validation rule I'd
add:** When the gitStatus system-prompt snapshot disagrees with live `git status`, always trust live
git status — the snapshot is taken at conversation start and can be many commits stale by the time
the PM loop runs.

---

**Date / ticket:** 2026-06-07 — FOLLOW-198 (qa-engineer + backend-engineer) + FOLLOW-207
(sdk-engineer) + FOLLOW-208 (sdk-engineer) delegated in parallel **Delegation row used:** Row 6
(E2E/integration tests, CI gate) for FOLLOW-198; Row 1 (client SDK / browser code) for FOLLOW-207
and FOLLOW-208. **What validation caught (or missed):** STATUS.md was stale — still showed
FOLLOW-199 IN_PROGRESS and did not reflect the 8 PRs merged this session. Corrected before
delegation. FOLLOW-168 (Sprint 14) is still READY (not DONE) so FOLLOW-198 must implement the gate,
not just verify it. FOLLOW-207 and FOLLOW-208 are both pure sdk-engineer, independent, and can run
simultaneously without branch conflict. Running 3 IN_PROGRESS simultaneously to reach the 3-slot
cap. **A delegation/validation rule I'd add:** When two tickets from the same agent target different
pure-function additions to the same file (intent.ts here), confirm they will not create merge
conflicts — FOLLOW-207 adds applyReferrerHints(), FOLLOW-208 adds applyListingViewRate() in separate
pure-function slots; no conflict expected if branches are named correctly and merged in sequence.

---

**Date / ticket:** 2026-06-07 — FOLLOW-209 (sdk-engineer wave 1) + FOLLOW-206 (backend-engineer)
delegated in parallel **Delegation row used:** Row 1 (client SDK / Shadow DOM / browser code) for
FOLLOW-209 wave 1; Row 2 (control-plane / Postgres) for FOLLOW-206. **What validation caught (or
missed):** QUEUE.md regression detected — commit b65400e (FOLLOW-207 merge by Pnawrocki9) reverted
FOLLOW-202 and FOLLOW-205 from DONE back to READY_FOR_REVIEW due to a merge-conflict resolution
error (the FOLLOW-207 branch had an older QUEUE.md that predated fc331d3). Both were confirmed DONE
from git log before correcting QUEUE.md. FOLLOW-209 wave 2 (backend-engineer: DB field + admin UI)
requires coordination after wave 1 PR merges. **A delegation/validation rule I'd add:** After every
human-authored commit that touches QUEUE.md (not agent-authored), cross-check git show <hash> --
backlog/QUEUE.md diffs against expected status transitions — human branch merges frequently
reintroduce stale QUEUE.md state from older branch bases.

---

**Date / ticket:** 2026-06-07 — Sprint 16 kickoff / FOLLOW-173 delegated **Delegation row used:**
Row 4 (ClickHouse, ETL, archetype pipeline) — data-engineer. **What validation caught (or missed):**
FOLLOW-170 (P0, the §T T0 blocker) was marked READY in QUEUE.md but the code and migration were
already shipped in PR #187 (d9c75d4). The route.holdout.test.ts:269 test covering AC4 and migration
0013 were both present on main. FOLLOW-178 was similarly already done via FOLLOW-197. Three QUEUE.md
status corrections applied before delegating: FOLLOW-168 READY→DONE, FOLLOW-170 READY→DONE,
FOLLOW-173 BLOCKED→READY (then immediately IN_PROGRESS on delegation). **A delegation/validation
rule I'd add:** At sprint-close and sprint-open, grep the actual codebase for each READY ticket's
primary deliverable (migration file, route handler, function name) before assuming it needs to be
built — stale READY status after a productive sprint is common and wastes a delegation slot.

---

**Date / ticket:** 2026-06-07 — FOLLOW-176 (sdk-engineer) **Delegation row used:** Table row 1
(client SDK, Shadow DOM, browser code) — sdk-engineer. **What validation caught (or missed):**
STATUS.md still showed FOLLOW-173 as IN_PROGRESS after the git log confirmed it was committed DONE
(73b2d70). Also caught that FOLLOW-174 was still marked BLOCKED in QUEUE.md even though both its
dependencies (FOLLOW-170 and FOLLOW-173) are DONE — manually unblocked before delegating. No
half-wire concern for FOLLOW-176 (pure SDK sessionStorage addition, single-module change, no
cross-agent consumer). **A delegation/validation rule I'd add:** After any session that completes
tickets via direct commits (not PRs), run a diff between STATUS.md IN_PROGRESS list and git log
--oneline before any new delegation to avoid cascading stale-block entries.

---

**Date / ticket:** 2026-06-07 — FOLLOW-176 validation (PR #217, sdk-engineer) **Delegation row
used:** Table row 1 (client SDK / Shadow DOM / browser code) — sdk-engineer. **What validation
caught (or missed):** Step 5c (runtime wiring) confirmed all 8 new exported symbols from session.ts
have at least one non-test caller in index.ts. The failing Build/Rule I/Test Python checks are
pre-existing on main — not introduced by this PR. The bundle-size overrun (44.61KB baseline, already
above 40KB before PR) triggered a FOLLOW-214 stub. The PR worker correctly documented the
pre-existing nature of the overrun in the PR body, which made validation straightforward. **A
delegation/validation rule I'd add:** When a PR touches packages/sdk, always grep the CI landscape
memory for the current bundle-size baseline before validating AC5 — the budget may already be
breached on main, and the PR should be credited only for its marginal delta, not the total overrun.

---

**Date / ticket:** 2026-06-08 — FOLLOW-182/218/219/190 batch validation (PRs #222-#225) **Delegation
row used:** Row 2 (backend-engineer) for FOLLOW-182; Row 7 (compliance) for FOLLOW-218; Row 1
(sdk-engineer) for FOLLOW-219 and FOLLOW-190. **What validation caught (or missed):** Step 5c for a
PR-branch-only symbol (allRankEntries, buildStoredRankSql on FOLLOW-182) returned empty grep on main
— correct, as the PR has not merged yet. The right check was to inspect the branch itself via
`git show origin/<branch>:file | grep`. Wiring is complete within the PR's own changed files; the
external consumer (upsertConversionLabel) already has 3 live non-test callers on main. **A
delegation/validation rule I'd add:** For symbols introduced in a PR branch (not yet on main),
verify wiring by git-show on the branch file, then confirm the external entry-point (the exported
function that callers invoke) is already wired in main — the PR's internal producer→consumer is
valid even if grep on main returns nothing.

---

**Date / ticket:** 2026-06-08 — FOLLOW-227 (PR #226) + FOLLOW-230 (PR #227) validation **Delegation
row used:** Row 1 (client SDK / browser code) for FOLLOW-227; Row 7 (DPIA/ROPA/compliance) for
FOLLOW-230. **What validation caught (or missed):** Step 5b caught a Gitleaks false positive on PR
#226 — the natural-language string "written-threshold-2-minus-the-missing-bodies" in
`.claude/agents/retrospective-analyst/lessons.md` (44 chars, Shannon entropy 3.82) triggered the
cloudflare-api-token heuristic rule. The `.claude/agents/` directory was not in the Gitleaks
allowlist even though it contains only internal agent lessons files. PR #227 cleared all gates
including the new Privacy Notice key-sync gate. FOLLOW-187 depends_on updated to include FOLLOW-230
(number collision resolution). **A delegation/validation rule I'd add:** When any commit adds new
prose files outside the existing Gitleaks allowlist paths (particularly .claude/ agent files with
long hyphenated strings), verify Gitleaks pre-emptively with
`echo "<string>" | gitleaks detect --pipe` or check entropy manually — don't wait for CI to find it.

---

**Date / ticket:** 2026-06-13 — FOLLOW-287 CI validation (PR #281, backend-engineer) + FOLLOW-266
Phase 3 DONE (PR #280) **Delegation row used:** Row 2 (ingest worker, CF Worker — backend-engineer)
for FOLLOW-287; Row 1 (SDK event — sdk-engineer) for FOLLOW-266 Phase 3 (already merged). **What
validation caught (or missed):** Step 5b caught "ClickHouse migrations smoke" FAILING on PR #281 — a
REAL gate, not pre-existing-red. The migration comment claimed "UUID→String MODIFY COLUMN is safe on
ORDER BY keys" but ClickHouse 26.5.1 throws ALTER_OF_COLUMN_IS_FORBIDDEN (code 524). The worker's
code was internally consistent (comment + migration agreed) but factually wrong about what
ClickHouse 26.5.1 allows. The --watch output from the prior session did not show this failure
because it completed before the ClickHouse smoke step ran; reading the CI log directly revealed the
precise error. PR #280 (FOLLOW-266 Phase 3) was confirmed MERGED at 2026-06-12T22:11:39Z — caught
before any stale READY_FOR_REVIEW confusion. **A delegation/validation rule I'd add:** When a
migration comment asserts a ClickHouse behavior (e.g. "ALTER of ORDER BY key is safe"), always
cross-check the CI log's actual error message — ClickHouse version-specific constraints are
frequently misstated in migration comments, and the schema error is always clear in the migrate.sh
output.

---

**Date / ticket:** 2026-06-14 — FOLLOW-266 Phase 2 "seed global default weights" — scope assessment,
no delegation **Delegation row used:** N/A (CEO-directed scope clarification pass; no ticket yet
exists for the seed task; surfaced a CEO decision required before any worker can proceed) **What
validation caught (or missed):** The "FOLLOW-266 Phase 2" label has been reused for two distinct
things: the DB migration (PR #278, DONE) and a separate unnamed operational task (seed the
global-default row). No written QUEUE.md ticket or FOLLOW_UPS.md stub exists for the seed task — it
is referenced only as a prose note in the QUEUE.md header and STATUS.md. Additionally, the weight
values themselves raise a genuine ML decision: seeding SDK-identical defaults is a no-op and defeats
the purpose; a meaningful seed requires CEO/ml-engineer input on what the global defaults should
actually be. **A delegation/validation rule I'd add:** Before delegating any "operational
precondition" task mentioned only in prose notes, verify it has a scoped QUEUE.md entry with an id,
AC, and agent assignment — prose references are not sufficient for safe delegation.

---

**Date / ticket:** 2026-06-13 — Bookkeeping pass (FOLLOW-267/294/268-write/297/299 all DONE)
**Delegation row used:** None (bookkeeping/queue-sync session, no worker delegated) **What
validation caught (or missed):** The QUEUE.md Sprint 17 table row still showed FOLLOW-267 as
IN_PROGRESS and contained no entries for FOLLOW-294/268-write/297/299/268-sdk or the new
FOLLOW-298..303 stubs. Reading working-tree RETROSPECTIVES.md (not main) was essential — RETRO-070/
071/072 existed only in the working tree and contained the FOLLOW-301 P1 BLOCKS marker that shapes
the entire FOLLOW-268-sdk dependency. Without reading the working-tree file the blocker would have
been invisible. The three-retro pattern (RETRO-058/070/072) that triggered the Rule K.2 amendment
spans 6+ weeks of history — only the running RETRO count in each entry's §8 made it catchable. **A
delegation/validation rule I'd add:** When syncing queue after multiple merged PRs, always read
working-tree RETROSPECTIVES.md and FOLLOW_UPS.md (not git/main) before touching QUEUE.md — retros
append to the working tree and the FOLLOW stubs they generate may contain P1 BLOCKS markers that
change the dependency graph before any commit.

---

**Date / ticket:** 2026-06-14 — RETRO-076 bookkeeping (FOLLOW-266 Ph2 seed + FOLLOW-302 DONE,
FOLLOW-307 added) **Delegation row used:** None (bookkeeping/queue-sync session, no worker
delegated) **What validation caught (or missed):** RETRO-076 (working tree, not yet on main)
surfaced the critical OG-1 finding: a MERGED Postgres/Supabase migration is NOT the same as an
APPLIED migration. The seed SQL (migration 0030) is code-correct and CI-green but produces zero
effect in prod until an operator runs db:migrate — because no GH workflow auto-applies Postgres
migrations (only ClickHouse ci.yml does). This "merged does not equal live" gap is an architectural
standing fact affecting EVERY future Postgres seed/DDL. Caught at bookkeeping stage via working-tree
RETRO-076; would have been invisible if only checking git/main state. **A delegation/validation rule
I'd add:** When closing a ticket whose primary artifact is a Postgres seed/DDL migration, always
verify the apply mechanism (auto-workflow or operator checklist) before recording the data-wire as
closed — a correct merged SQL is NOT a live data producer until applied to a real environment.

---

**Date / ticket:** 2026-06-14 — FOLLOW-307 DONE (prod apply confirmed) + ESC-022 filed **Delegation
row used:** None (operational bookkeeping — no worker delegated; FOLLOW-307 was executed by
operator, not an agent) **What validation caught (or missed):** The prod apply revealed that prod
was 14 migrations behind (2026-05-28 → 2026-06-14) — NEVER surfaced in any CI gate, PR, or prior PM
session. The compliance migrations (0019/0020 conversion_labels, 0024 dsr_durable_lead_id) were
silently absent from prod for 2.5 weeks. The drift was only discovered at apply time. Also: prod
Supabase was AUTO-PAUSED (idle), confirming there has been no steady traffic and the pre-pilot phase
assumption is valid. FOLLOW-308 (standing mechanism) and ESC-022 (compliance sign-off) properly
split the "apply done" concern from the "prevention needed" concern. **A delegation/validation rule
I'd add:** After any prod DB migration apply, always record a drift count (journal entries at apply
time vs. repo count) in the ticket's completion notes — this makes "apply lag" visible at the sprint
review level and triggers a prevention discussion before the next migration merges without applying.

---

---

**Date / ticket:** 2026-06-17 — FOLLOW-325 re-validation (PR #315) **Delegation row used:** N/A —
validation pass on open PR (step 5b/5c/5e). **What validation caught (or missed):** PR #315 was
already validated in the prior session (STATUS.md correctly showed READY_FOR_REVIEW). This session
confirmed: 0 real blocking CI failures (all failures are pre-existing-red), runtime wiring confirmed
(DETECT_SERVE_URL producer+consumer both non-test), AC1-AC5 all met. The
`gh pr checks 315 --json state,name | jq` count command failed due to empty stdout (gh CLI returning
non-JSON on PR checks endpoint with `--json`); fell back to parsing the tabular `gh pr checks 315`
output with grep. STATUS.md was stale (still said IN_PROGRESS) even though QUEUE.md had
READY_FOR_REVIEW — STATUS.md must be kept in sync atomically with QUEUE.md. **A
delegation/validation rule I'd add:** After posting the PM validation comment on a PR, immediately
update STATUS.md to match QUEUE.md status — never let the two files drift on the same ticket state.

---

**Date / ticket:** 2026-06-14 — Loop 6 state read (FOLLOW-316 DONE, FOLLOW-269 IN_PROGRESS,
ESC-020 + ESC-023 OPEN) **Delegation row used:** N/A — escalation stop required; no delegation this
session. **What validation caught (or missed):** Both OPEN escalations are human-action items only
(ESC-020 = Rafal deploy; ESC-023 = Piotr secret provisioning). No READY tickets exist in Sprint 18
(FOLLOW-317/318 still stubs). RETRO-064/067/068 remain pending spawn — these are the only actionable
items the PM can advance. **A delegation/validation rule I'd add:** When both open escalations
require human-only physical actions (deploy, secret provisioning) and there are no READY Sprint 18
tickets, spawn any pending retrospective-analyst tasks immediately rather than stopping entirely —
retro spawns are PM-scope work that does not conflict with escalation-stop on worker tickets.

---

**Date / ticket:** 2026-06-15 — FOLLOW-324 DONE (PR #308 merged) + FOLLOW-326 promoted + delegated
**Delegation row used:** "ingest worker, control-plane, Postgres/RLS, auth, onboarding HTTP" →
backend-engineer **What validation caught (or missed):** PR #308 was in READY_FOR_REVIEW status in
QUEUE.md but was already merged on GitHub (2026-06-15T13:21:27Z). Always check
`gh pr view <N> --json state,mergedAt` to catch merge events that happened between PM sessions —
QUEUE.md can lag behind GitHub state. **A delegation/validation rule I'd add:** At the start of
every loop, check gh pr view for all READY_FOR_REVIEW tickets to confirm they haven't already been
merged — a merged PR with READY_FOR_REVIEW status in QUEUE.md is a stale record that blocks retro
spawning.

---

**Date / ticket:** 2026-06-18 — FOLLOW-336 (qa-engineer/FOLLOW-336-admin-auth-tests) **Delegation
row used:** Row 6: E2E/integration/load/a11y tests, fixtures, golden harness → qa-engineer. **What
validation caught (or missed):** Local test run before PR was opened caught 5 failures + 3 lint
errors: (1) ADMIN-1/2/3/5 in middleware.test.ts fail with Next.js E119 because the makeRequest
helper passes a plain Record as headers to new NextRequest — NextResponse.next({request}) requires a
native Headers instance; (2) SIGN-IN-1 in SignInForm.test.tsx fails because screen.getByRole("form")
throws when the <form> element has no role attribute; (3) three lint errors (unnecessary ??, 2x
async-without-await) in SignInForm.test.tsx. SSR-1..4 in tracer-auth.test.ts all passed. Work was
never committed to branch when PM validated — caught before any PR was opened. **A
delegation/validation rule I'd add:** When Next.js middleware tests use
NextResponse.next({request}), the request MUST have headers constructed as new Headers() not a plain
object — add this as a pattern note to the qa-engineer agent file.

---

**Date / ticket:** 2026-06-18 — FOLLOW-332 (qa-engineer/FOLLOW-332-admin-layout-page-tests, PR #318)
**Delegation row used:** Row 6: E2E/integration/load/a11y tests, fixtures, golden harness →
qa-engineer. **What validation caught (or missed):** Step 5c confirmed this is a test-only PR — no
new exported symbols. Runtime wiring verified by confirming tests import from the REAL production
module (PILOT_TENANT_ID from @/lib/pilot-tenant, not hand-authored). Prior fix iteration (1/3
consumed) caught spurious expect(digest).not.toContain('/tenants/') which failed because the
legitimate redirect path /admin/tenants/<uuid>/tracer contains '/tenants/'; qa-engineer correctly
replaced it with expect(path).not.toBe('/admin/tenants'). SDK E2E was the slowest gate (~20 min);
poll patiently before concluding CI is stuck. **A delegation/validation rule I'd add:** For
test-only PRs testing a redirect path that contains a multi-tenant path segment, always verify that
negative assertions exclude the scoped path (e.g., /admin/tenants/<uuid>/tracer) and only assert
against the bare unscoped route (e.g., /admin/tenants) — a negative toContain('/tenants/') on a path
that legitimately contains '/tenants/' will always fail.

---

**Date / ticket:** 2026-06-18 — FOLLOW-335 (PR #319 validation + READY_FOR_REVIEW) **Delegation row
used:** client SDK, Shadow DOM, tiers, browser code → sdk-engineer. **What validation caught (or
missed):** Step 5c (runtime-wiring verification) correctly identified this as test-only — no new
exported production symbols, therefore no producer/consumer grep required. Rule I failure on PR #319
confirmed pre-existing-red by diffing against main (main CI run 27789146936 has same Rule I FAIL).
Two duplicate CI runs (push + PR event) produced identical results; authoritative run (27789494111)
completed all gates GREEN; the second run's SDK E2E lagged but also passed. ACs verified by reading
the actual test file from the PR branch (4 tests covering: global defined, detectSiteSchema
callable, extractArchetypeHints callable, global absent before import). **A delegation/validation
rule I'd add:** When two duplicate CI runs exist for the same PR commit, use `gh run view <id>` on
the authoritative PR-triggered run for the non-success count rather than waiting for the slower
push-triggered run to also complete — both run the same code.

---

**Date / ticket:** 2026-06-18 — Repo reconcile (FOLLOW-331/332 bookkeeping squash onto origin/main)
**Delegation row used:** N/A — PM self-operation (git reconcile, no worker delegated this session).
**What validation caught (or missed):** Step 5c not applicable (no new code symbols — pure
bookkeeping). The squash-merge correctly surfaced that origin/main's STATUS.md had FOLLOW-332 still
as READY_FOR_REVIEW (older snapshot) while local main had it DONE; union resolution kept local
main's superset. Critical correction applied: FOLLOW-335 was marked IN_PROGRESS in local main but
was never actually delegated — corrected to READY before the push. All 5 post-push verifications
passed (FOLLOW-332 code file present, 331/332 DONE + 335 READY, Rule Y count=4, 0 conflict markers,
RETRO-089/090 present). **A delegation/validation rule I'd add:** Before any reconcile-branch
squash-merge, explicitly list every ticket whose status might differ between local and origin —
IN_PROGRESS tickets are the highest-risk mismatch because a PM run may have set IN_PROGRESS locally
without actually delegating.

---

**Date / ticket:** 2026-06-23 — Queue housekeeping pass (PRs #322–#341) **Delegation row used:** N/A
— PM self-operation (QUEUE.md + STATUS.md housekeeping, no worker delegated). **What validation
caught (or missed):** QUEUE.md was significantly stale after 10 merged PRs (#332–#341) accumulated
without status updates. Multiple tickets showing IN_PROGRESS and READY_FOR_REVIEW had been merged
days earlier. The housekeeping pass found 2 IN_PROGRESS (FOLLOW-360, FOLLOW-366), 4 READY_FOR_REVIEW
(FOLLOW-340, 344, 346, 346-dpia), and 3 READY (FOLLOW-345, 372, 373) that were all actually DONE.
Additionally FOLLOW-374/375/376 were missing from QUEUE.md entirely despite being promoted to
FOLLOW_UPS.md and merged. Sprint 21 section needed creation. **A delegation/validation rule I'd
add:** After each session ends with multiple merges, the PM MUST update QUEUE.md before the next
session picks a new ticket — stale IN_PROGRESS entries mislead the 3-ticket cap check.

---

**Date / ticket:** 2026-06-23 — FOLLOW-383 state analysis + delegation to backend-engineer
**Delegation row used:** Row 2 (ingest worker, control-plane, decision-api, Postgres/RLS, auth,
onboarding HTTP, billing, webhooks → backend-engineer). **What validation caught (or missed):** PR
#342 was open for FOLLOW-383 but contained ONLY the AC-2 doc commit (JSDoc). The working tree had
AC-1 (SDK profilingOptedOut param + profiling_opt_out=1 URL append) and AC-3 (behavioral event drop
before eventQueue.push) code changes DONE but uncommitted — plus test files for both. This is a case
where a worker opened a partial PR (doc-only slice) then continued coding on the same branch without
committing. CI on PR #342: all real gates pass, only Rule I fails (pre-existing on PR #341 too —
confirmed). STATUS.md was stale (Sprint 18 era) and needed full rewrite. AC-4 (redis_writer.py skip)
is ml-engineer scope and not started. **A delegation/validation rule I'd add:** When a branch has an
open PR but also has uncommitted code changes, always grep those changes to assess whether the code
is completing ACs from the same ticket BEFORE treating the PR as PM-validatable — uncommitted ACs
cannot be CI-verified.

---

**Date / ticket:** 2026-06-23 — FOLLOW-383 CI validation (PR #342 after commit 4f5f27b push)
**Delegation row used:** Row 2 (backend-engineer) — fix-delegation loop. **What validation caught
(or missed):** Step 5b (`gh pr checks 342 --watch`) caught Typecheck FAILING — a REAL gate. 5 TS
errors all in `packages/sdk/src/__tests__/follow-383.test.ts`: 4x TS2352 (direct
`as [string, RequestInit]` cast on `mock.lastCall` typed as `[] | undefined`) and 1x TS2532
(`queue[0]` possibly undefined). Worker reported local tests 1462/1462 pass — vitest passes because
the cast is runtime-safe; tsc --noEmit is stricter. Correct pattern confirmed in adapt.test.ts lines
227/253: `as unknown as [string, RequestInit]`. Worker prematurely set READY_FOR_REVIEW; reverted to
IN_PROGRESS. Fix iteration 1/3 consumed. CI check counter now 2/5. **A delegation/validation rule
I'd add:** When a worker reports "all tests pass locally," NEVER treat that as CI-typecheck-passing
— vitest does not run tsc --noEmit; type casts that work at runtime can fail tsc. Always wait for
the CI Typecheck job specifically before confirming a PR is typecheck-clean.
