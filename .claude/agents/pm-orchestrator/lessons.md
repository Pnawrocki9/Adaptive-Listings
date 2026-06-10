# PM Orchestrator Lessons

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
