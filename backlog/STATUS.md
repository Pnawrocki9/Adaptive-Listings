# Status — 2026-07-15 (session 30 — FOLLOW-557/558 work found ALIVE in agent worktrees and rescued → PRs #528/#529)

## SESSION 30 (2026-07-15) — the "execution gap" did not exist; both workers had run, their work was stranded uncommitted in worktrees

**Headline: sessions 28 and 29 were both wrong, and this session found the work by looking one
directory further.** FOLLOW-557 and FOLLOW-558 were never un-executed. Both subagents had run to
completion and produced full, AC-satisfying implementations. The diffs were sitting **uncommitted**
in `.claude/worktrees/agent-acb218b87d9630ff6/` and `.claude/worktrees/agent-ad875b8d6ec42ae9d/` —
the prior session hung before either agent could commit.

**Why two sessions missed it.** Both ran `git diff main..<branch> --stat`, got empty, and concluded
"never ran". That command compares **committed branch tips**. Uncommitted work leaves the tip at
`main` HEAD — so a worker that did everything except commit is indistinguishable from one that never
started. Session 28 codified the faulty inference as a rule in
`.claude/agents/pm-orchestrator/lessons.md` ("an empty diff means the dispatch never actually got
executed"); session 29 applied it faithfully and repeated the error, then escalated a
worker-execution crisis into the `QUEUE.md` START HERE banner. **The rule has been corrected at
source** in `lessons.md` (session-30 entry supersedes the session-28 one) — otherwise session 31
makes the same call again.

**Cost of the miss:** two full PM sessions spent confirming a non-existent crisis, and a near-miss
on re-dispatching both tickets — which would have discarded finished work and silently re-derived
it.

**Rescued (unmodified apart from commit messages), each validated locally BEFORE push:**

| Ticket     | PR   | Commit    | Local validation                                            |
| ---------- | ---- | --------- | ----------------------------------------------------------- |
| FOLLOW-557 | #528 | `ce9125e` | vitest 3/3, prettier clean, `tsc --noEmit` clean            |
| FOLLOW-558 | #529 | `1877722` | vitest 92/92 (17 route-driven pglite), prettier + tsc clean |

**Quality note — the rescued work is good, not merely present.** Both hit the hard parts of their
briefs rather than the easy reading of them:

- **FOLLOW-557 / Rule Z:** the cross-runtime fixture is _mechanically parsed_ out of
  `apps/intent-engine/src/redis_writer.py`'s `shadow_key()` f-string literal, not hand-typed in TS.
  If the Python key format drifts, the test hard-fails or compares against the changed literal — it
  cannot silently pass. That is Rule Z option (a) done properly.
- **FOLLOW-558 / Rule N:** the DPIA _does_ enumerate the disclosed stores (§8 step 5), so the agent
  updated it in the same PR (2.8 → 2.9 + changelog row) instead of taking the
  satisfied-by-absence-of-claim escape hatch.
- **FOLLOW-558 scope:** it added `engagement_scores` beyond the stub's two named tables. Correct
  call, not scope creep — the parity AC asserts access-set == erase-set, and erase covers it, so
  omitting it would have failed parity and left the same gap class open. Flagged in the PR body.

**Verification discipline applied:** did not trust the rescued work because it looked complete —
independently confirmed `shadowChatIntentKey` is exported (`chat-intent-cache.ts:62`) and that the
test's regex actually matches the current `shadow_key()` source in `redis_writer.py` before
committing.

**Merged (CEO-approved, 2026-07-15):** FOLLOW-557 → `7b83f39` (PR #528), FOLLOW-558 → `797b8ab` (PR
#529). Both `DONE`. Pre-merge check: neither PR carried a migration, so the `db-migrate.yml` prod
auto-apply path was not triggered; both do redeploy control-plane to Vercel prod (intended).

**NEXT:** (1) **FOLLOW-559** — backend-engineer lane is free, correct next pick. (2) **FOLLOW-356**
— still needs the CEO priority call flagged in session 29 (P1 with a free sdk lane, but outside
Sprint 23; active-sprint-first vs P1-first is not the PM's call). (3) **RETROs owed for FOLLOW-557
and FOLLOW-558** — deferred at merge, not skipped. The worktree-stranding miss is itself
retro-grade: it is the second occurrence of the stranded-work shape (RETRO-146 §4e / FOLLOW-448 was
the first, on `main`), so a `CONVENTIONS_PATCH.md` rule may now be justified under the ≥2-occurrence
bar — that promotion decision belongs to the retrospective-analyst, not to this session's ad-hoc
judgement.

---

## (superseded — see session 30 above) SESSION 29 (2026-07-15) — re-verified session 28's findings independently; rescued stranded work; escalated the execution gap

**Independently re-verified (did not trust session 28's STATUS.md write-up):**

- `grep -c "^## OPEN" backlog/ESCALATIONS.md` → 2, of which one is the format template at line 8 and
  one is **ESC-020** (line 1064). Read ESC-020 in full: OPEN, but its own **Resolution** block (CEO
  clarification 2026-06-10) states verbatim "**This escalation does NOT block the PM pipeline for
  other tickets.**" → not a stop condition. Proceeded.
- `gh pr list --state open` → **empty**. `gh pr list --state all --limit 8` confirms **PR #526
  MERGED**, matching `git log` HEAD `9bef30b`. The session-27 `START HERE` banner's
  "READY_FOR_REVIEW, awaiting human merge" was stale → **fixed in `QUEUE.md` this session**.
- `git diff main..backend-engineer/FOLLOW-557-dsr-erase-shadow-redis --stat` → **empty**.
  `git diff main..compliance-engineer/FOLLOW-558-dsr-access-portability-disclosure --stat` →
  **empty**. Both branches exist at `main` HEAD with zero commits. **Session 28 was correct, and the
  state is unchanged one session later.**

**Finding (escalated into the `QUEUE.md` banner): the bottleneck is worker execution, not
dispatch.** FOLLOW-557/558 were dispatched in session 27 with complete `HANDOFFS.md` briefs. Session
28 found zero commits and handed back. Session 29 finds zero commits again. Two consecutive PM
sessions have now been spent confirming that nothing happened. The PM tool surface has no
subagent-spawn capability (long-standing; noted at `backlog/STATUS.md` lines 438/1334/1394/1441 and
`backlog/HANDOFFS.md` 235/402/539), so dispatch only becomes work when the coordinator invokes the
worker off the `NEXT:` line. The loop demonstrably works when that happens (PRs #517–#522 were all
worker-produced). It simply has not happened for 557/558.

**Deliberate decision: NO new dispatch this session.** Two of three `IN_PROGRESS` slots hold
fully-briefed, un-executed tickets. Opening a third would consume the last slot with more paperwork
that also would not run, and would make the eventual cleanup worse. Writing briefs is not the
constraint; running workers is. Recorded rather than papered over.

**Stranded-on-main rescue (recovered-work checklist, `docs/AGENT_WORKFLOW.md`).** Session 28's
`backlog/STATUS.md` + `.claude/agents/pm-orchestrator/lessons.md` edits were sitting **uncommitted
on `main`** — the exact shape RETRO-146 §4e / FOLLOW-448 warn about. Ran the checklist: confirmed
via `git status --porcelain` that **only those two `.md` files** were stranded (no code, no
untracked dirs), `git stash list` empty, `main` in sync with `origin/main`. Moved onto branch
`pm-orchestrator/FOLLOW-553-session29-queue-truth` — nothing committed to `main`. Docs-only diff, so
no typecheck/lint/test re-run is applicable (no code touched).

**Queue-truth corrections applied to the `START HERE` banner (all verified against the ticket YAML,
not inherited from prose):**

- **FOLLOW-553 is `READY_OPERATOR`, not `DONE`.** Therefore FOLLOW-560 and FOLLOW-565
  (`depends_on: [FOLLOW-553]`) are **not** dependency-eligible under the strict rule. Session 27's
  note reasoned the dependency was "satisfied in spirit" and held 560 back on the concurrency cap
  instead — recording the stricter, correct reason so a future session does not dispatch it on the
  looser one.
- **FOLLOW-559** is not eligible while FOLLOW-557 occupies the backend-engineer lane.
- **FOLLOW-356 (P1, sdk-engineer, `deps: []`, READY, lane free)** is the highest-priority eligible
  ticket in the queue and has been passed over by recent sessions in favour of the Sprint 23 P2
  pool. Surfaced to the human as a **priority call** (active-sprint-first vs P1-first) rather than
  decided unilaterally — priority sequencing across sprints is not the PM's call to make.

**Counters:** CI checks this session **0/5**; fix iterations **0/3** (no code PR validated — nothing
to validate). Open escalations: **ESC-020**, age **~39 days** (filed 2026-06-06), status OPEN,
non-blocking by CEO ruling, awaiting Rafał-side production deploy (Wave 0 Step 6).

---

# Status — 2026-07-15 (session 28 — no new dispatch; confirmed FOLLOW-557/558 still awaiting worker execution)

## SESSION 28 (2026-07-15) — state check, no PRs open, no escalations blocking, FOLLOW-557/558 handed back to workers

**Read state fresh (Operating Principle 1 — verify, don't guess):** `docs/MASTER_DESIGN.md`
§Snapshot.1 context assumed current per session-27 notes (not re-read line-by-line this pass — no
code merged since session 27 that would move Snapshot.1); `backlog/QUEUE.md`,
`backlog/ ESCALATIONS.md` (only one `## OPEN` entry: ESC-020, confirmed non-blocking per its own
2026-06-10 CEO resolution text — "This escalation does NOT block the PM pipeline for other tickets"
— consistent with every session since), `backlog/HANDOFFS.md`, `git log --oneline -20`,
`gh pr list --state open` (empty — zero open PRs) and `gh pr list --state all --limit 20` (confirms
PR #526 is MERGED, matching `git log`'s top commit `9bef30b` — the prior session's
"READY_FOR_REVIEW, awaiting human merge" note at the top of QUEUE.md is now stale; human merged it
since).

**FOLLOW-557 (backend-engineer) and FOLLOW-558 (compliance-engineer) are still `IN_PROGRESS`** in
`backlog/QUEUE.md`, with full delegation briefs already in `backlog/HANDOFFS.md` from session 27
cont'd. Verified (not assumed) that no work has landed yet: both branches exist
(`backend-engineer/FOLLOW-557-dsr-erase-shadow-redis`,
`compliance-engineer/FOLLOW-558-dsr-access-portability-disclosure`) but
`git diff main..<branch> --stat` is **empty** for both — the branches are literally at `main` HEAD,
zero commits. No PR exists for either (`gh pr list --state all` has no FOLLOW-557/558 entries). This
confirms the assigned subagents have not yet executed against their briefs — this is not a
stall/crash to recover from (nothing to re-verify per the Recovered-work checklist, since there is
no work product at all yet), it is simply pending execution.

**No new ticket picked this session** — 2 of the 3 allowed concurrent `IN_PROGRESS` slots are
already occupied by fully-briefed, ready-to-execute tickets (FOLLOW-557, FOLLOW-558). Per this
tool-surface's known constraint (repeatedly noted in `backlog/HANDOFFS.md` across prior sessions:
"pm-orchestrator has no subagent-spawn capability in this tool surface"), this session cannot itself
invoke the `backend-engineer`/`compliance-engineer` subagents — it can only confirm the dispatch is
correctly queued and hand back control via the `NEXT:` line for the coordinator to actually run the
worker.

**QUEUE.md `START HERE` banner not rewritten this session** — no material state change beyond the PR
#526 merge confirmation (which the existing banner already anticipated) and the FOLLOW-557/558
non-execution finding. Leaving the existing banner as the substantive record; this STATUS.md entry
is the delta.

---

# Status — 2026-07-14 (session 27 cont'd — PR #525 MERGED; 3 more queue-truth corrections + Sprint 23 Wave 2 P2 dispatch)

## SESSION 27 cont'd (2026-07-14) — PR #525 merged; FOLLOW-551/436/569 queue-truth corrections; FOLLOW-557/558 dispatched

**PR #525 confirmed MERGED** (`196d431`, verified via `git log --oneline main` + `git status` clean
on `main`).

**3 more stale-bookkeeping items** (flagged by the prior sub-session but not fixed) corrected on
branch `pm-orchestrator/FOLLOW-553-queue-truth-corrections` (PR **#526**):

- **FOLLOW-551 → DONE.** `pr: 512` independently re-confirmed MERGED
  (`gh pr view 512 --json state,mergedAt` → `MERGED`, `2026-07-11T09:02:26Z`, merge commit
  `c2670b2`). Status was stuck at stale `READY_FOR_REVIEW`. No AC re-check needed beyond confirming
  the merge — the ticket's own notes already carry a full PM-validated evidence trail from the
  original merge session.
- **FOLLOW-436 → DONE.** Was `BLOCKED_ON_HUMAN`. `backlog/ESCALATIONS.md` ESC-034 is RESOLVED
  2026-07-13 with an end-to-end attestation (`docs/runbooks/OPERATOR_SESSION_2026-07-12.md` Step 3):
  live Modal endpoint smoke returned `202 accepted` with valid auth / `401` without; the async
  callback landed (`listing_embeddings.updated_at` bumped, SQL-verified). **Important nuance
  documented in-ticket:** the ticket's own literal 3-step checklist (provision a Redpanda-topic
  Modal secret + `modal deploy` registering a polling cron) describes the PRE-ADR-0016 design.
  ADR-0016 (`docs/adr/ADR-0016-pilot-direct-modal-invocation.md`) replaced that with direct-HTTPS
  invocation before go-live happened. The Step-3 attestation verifies the CURRENT design's
  equivalent requirements (`MODAL_EMBED_SEED_URL` set, `INTERNAL_API_SECRET` confirmed matching,
  full async path proven live) — this discharges the ticket's actual intent even though 3 literal
  checklist lines are now describing a superseded architecture. Recorded so a future reader doesn't
  mistake the stale checklist for the operative one.
- **FOLLOW-569 → added retroactively as DONE.** Previously had **no** `QUEUE.md` block at all — an
  ad-hoc ticket ID coined only in commit `b0d77a6` / PR #517 (merged 2026-07-12T13:52:50Z), whose
  own PR body explicitly asked PM to "confirm/formalize the ticket id." `backlog/FOLLOW_UPS.md` stub
  updated in lockstep (`status: DONE`, `promoted_to_queue: true`).

None of the three is independently AC-re-validated beyond the cited attestations/PR evidence — same
flagging discipline as the FOLLOW-554/555/556/567 corrections from the prior sub-session.

**Dispatch — Sprint 23 Wave 2 P2s (CEO direction: proceed now, Step 6/ESC-020 is Rafał-side and
non-blocking to this pipeline):**

- **FOLLOW-557** (backend-engineer, table row: "ingest worker, control-plane... auth" ->
  backend-engineer; model: Sonnet, routine well-scoped fix) — DSR erase misses the
  `shadow:{tenant}:{session}:chat_intent` Redis key namespace (audit A3-F-05).
  `READY -> IN_PROGRESS`, branch `backend-engineer/FOLLOW-557-dsr-erase-shadow-redis`. Full
  delegation brief in `backlog/HANDOFFS.md`.
- **FOLLOW-558** (compliance-engineer, table row: "DPIA/ROPA/consent/DSR rules..." ->
  compliance-engineer; model: Sonnet, mechanical table-set mirror + parity test, not novel legal
  interpretation) — DSR access/portability responses omit `quiz_completions` + `intent_sessions`
  (audit A3-F-06), even though erasure already covers them (FOLLOW-455). `READY -> IN_PROGRESS`,
  branch `compliance-engineer/FOLLOW-558-dsr-access-portability-disclosure`. Full delegation brief
  in `backlog/HANDOFFS.md`. Brief adds a Rule N (compliance-docs-must-match-code) check not in the
  ticket's original AC — verify/update the DPIA's store enumeration if one exists.

**FOLLOW-559/FOLLOW-560 intentionally held back this round** — the ≤3-tickets-IN_PROGRESS guardrail
is now at 2/3. FOLLOW-560 additionally `depends_on: [FOLLOW-553]`, which is not literally `DONE`
(Step 6 open); its own notes describe the dependency as riding "the FOLLOW-553-established
attestation flow" (i.e. the Steps 3-5 attestation pattern, already present) with an explicit
fallback (OTel counter, skip the CH migration) if migration friction bites — judged
satisfied-in-spirit, not DONE-gated, but held back this round on the concurrency cap regardless.

**CI on PR #526: GREEN.** `gh pr checks 526 --watch` run to completion (2 watch cycles — first
interrupted by a follow-up commit pushed mid-watch, re-watched to completion on the final commit).
`gh pr view 526 --json statusCheckRollup | jq '[.statusCheckRollup[] | select(.conclusion != "SUCCESS" and .conclusion != null)] | length'`
= **2**, both `Rule I — wired-or-dead check` (matrix-duplicated). Confirmed pre-existing baseline
via `gh run view <run> --log-failed | grep -c WARN` = **181**, identical to the standing baseline —
expected, docs-only diff (`backlog/{QUEUE, FOLLOW_UPS,HANDOFFS,STATUS}.md`,
`gh pr view 526 --json files`), zero code touched. 5c/5d N/A (no new symbols/wires, not
co-assigned). PM-validated comment posted on PR #526 with full evidence trail. **Status:
READY_FOR_REVIEW, awaiting human merge. CI-check counter: 2/5. Fix-iteration counter: 0/3.**

---

# Status — 2026-07-14 (session 27 — recovered stranded FOLLOW-553 attestation branch, PR #525 READY_FOR_REVIEW; queue-truth corrections)

## SESSION 27 (2026-07-14) — recovered-work re-verification + queue-truth corrections

**Starting state:** current branch `pm-orchestrator/FOLLOW-553-step4-attestation` had 3 attestation
commits (Step 3 ESC-034, Step 4 embeddings, Step 5 ESC-028) open as PR #524, reported
`mergeable: CONFLICTING` by GitHub. `git merge-tree` alone looked clean, but a REAL local
`git merge --no-commit` test (per Recovered-work re-verification checklist,
`docs/AGENT_WORKFLOW.md`) confirmed a genuine conflict in
`docs/runbooks/OPERATOR_SESSION_2026-07-12.md`: the branch's own Step-4 attestation commit
(`c064f51`) duplicated content already merged separately as PR #523 (`0335484`, same content
different SHA) — a rebase/sync gap from working across two branches for overlapping Wave-0 steps.

**Fix:** closed PR #524 as superseded (no data loss — confirmed nothing else was stranded on `main`;
content preserved). Rebuilt a fresh branch `pm-orchestrator/FOLLOW-553-step3-step5-attestation` off
current `main`, containing ONLY the two net-new pieces (Step 3 ESC-034-resolved + Step 5
ESC-028-resolved attestation blocks + `backlog/ESCALATIONS.md` RESOLVED flips) — Step 4's content
was left untouched since it's already on `main` via #523. Verified via direct `diff` that both
reconstructed files are byte-identical to the superseded branch's intended end-state before
committing. Opened PR **#525**.

**CI (independently verified, not self-reported):** `gh pr view 525 --json statusCheckRollup` → all
real gates PASS across both duplicate-triggered workflow runs; only "Rule I — wired-or-dead check"
fails, confirmed via `gh run view --log` to be the standing pre-existing baseline (**181
violations**, identical symbol set to the FOLLOW-532/546/548/549/550/551 baseline — expected since
this PR is docs-only, 2 `.md` files, zero code touched). CI non-success count for real gates =
**0**. No new symbols/wires in the diff (5c N/A). PM-validated comment posted on PR #525 with full
evidence trail. **CI-check counter: 1/5. Fix-iteration counter: 0/3.**

**Queue-truth corrections applied** (git-log-confirmed merges that never got their `QUEUE.md` status
flipped from `READY` → `DONE`): FOLLOW-554 (PR #518, `28a915c`), FOLLOW-555 (PR #519, `386f58d`),
FOLLOW-556 (PR #520, `c78af84`), FOLLOW-567 (PR #522, `e48f9ec`) — all four were merged
2026-07-12/13 but still showed stale `status: READY` in `backlog/QUEUE.md`, which would have caused
a future PM session to re-delegate already-shipped work. Flips are git-log-confirmed only, NOT
independently re-validated against each ticket's own AC in this pass — flagged in each ticket's own
status comment for a future retro/audit pass to double-check if desired. Note: FOLLOW-569 (PR #517,
`b0d77a6`, "queue inquiry.completed for ingest") has no `QUEUE.md` ticket block at all (ad-hoc
ticket ID used in a commit message only) — not fabricated one; flagging here for whoever owns Sprint
23 bookkeeping.

**Wave 0 (FOLLOW-553) state:** Steps 3, 4, 5 attested DONE this session + previous session (ESC-034,
embeddings 0→6, ESC-028 all RESOLVED). Step 6 (ESC-020, Rafał — DOM hooks deploy) remains the only
open item; **not touched or claimed done** — no pasted prod evidence was available this session, and
Rule AA (FOLLOW-553's own notes) restricts FOLLOW-449/450's DONE-flip to real pasted prod output,
which I do not have. Left FOLLOW-449/450 at `CODE_COMPLETE_OPERATOR_PENDING` — did NOT flip.

**No new ticket delegated this session** — this iteration was entirely recovered-work
re-verification + queue hygiene, not new development. Once PR #525 merges: no further QUEUE.md
action needed for it (bookkeeping-only ticket, folds into FOLLOW-553's own Wave-0 tracking, no
separate DONE-flip ticket block exists for the Step-3/Step-5 attestation itself).

---

# Status — 2026-07-11 (Sprint 22b OPEN — PR #512 PM-validated, folded into #511, session 25 cont'd)

## SESSION 25 cont'd (2026-07-11) — PR #512 validated (folded into #511, no separate validation PR)

architect drafted FOLLOW-551's content in DRAFT-ONLY mode (no git; returned exact markdown +
insertion points + rationale in its report); the coordinator applied it verbatim as commit `a8421e7`
on branch `architect/FOLLOW-551-tool-capability-routing`, opened as PR #512 (2 files, +69/-5: new
"Agent tool-capability routing" section in `docs/AGENT_WORKFLOW.md`, and a fix to
`.claude/agents/architect.md`'s "First action" section which previously instructed a
`git checkout -b` command the agent has no tool to run).

**Validated PR #512** per the non-negotiable checklist:

1. **CI:** `gh pr checks 512 --watch` → green except the standing 2-leg "Rule I — wired-or-dead"
   gate. Independently computed non-success count via `gh pr view 512 --json statusCheckRollup` →
   **2**. Cross-checked via `gh run view --log-failed` → **180 WARN lines**, identical to the
   FOLLOW-532/546/548/549/550 baseline (expected — docs-only diff, confirmed via
   `gh pr view 512 --json files` → exactly 2 files; `CONVENTIONS_PATCH.md` untouched).
2. **AC:** read the full 96-line diff directly — new section correctly placed after "Model-fit
   decision"; both routing options present, option (2) named default; both precedents cited by exact
   number with a verbatim Changelog v4.3 quote; explicit non-Rule-promotion statement present with a
   notable nuance (acknowledges the raw `CLAUDE.md` threshold is technically met but correctly
   defers the actual call to FOLLOW-551's own retro rather than deciding it inline); FOLLOW-545
   bullet 2 explicitly confirmed to stay open, not silently absorbed; `architect.md`'s "First
   action" section confirmed fixed with a no-Bash note cross-referencing the new section.

**CI-check counter: 1/5. Fix-iteration counter: 0/3.** PR comment posted with the full evidence
trail.

**No two-`QUEUE.md`-PRs-in-flight collision confirmed:** PR #511 (FOLLOW-551's promotion) touches
`backlog/QUEUE.md`; PR #512 touches only the two docs files above — disjoint file sets. Per the new
rule (b)/(d) and the FOLLOW-550/#508 precedent, this validation was folded as an additional commit
onto #511's own branch (`pm-orchestrator/FOLLOW-551-dispatch`) rather than requiring #511 to merge
first or opening a new PR. `backlog/QUEUE.md` FOLLOW-551 flipped `IN_PROGRESS` -> `READY_FOR_REVIEW`
in place, with `pr: 512` recorded (the content PR) alongside the existing promotion PR context.
**#511 remains correct to MERGE, not close-superseded**, once ready — its dispatch-record content is
not duplicated/re-included elsewhere; this validation commit only extends it, matching the
FOLLOW-550/#508 pattern exactly.

**Merge-order note (no ordering constraint):** #511 and #512 touch disjoint files, so either can
merge first without breaking the other. Once BOTH are merged, the DONE+RETRO bundle will be cut
fresh from post-merge `main` (rule (c)), matching the FOLLOW-550 precedent (#508+#509 -> #510).

---

## SESSION 25 cont'd (2026-07-11) — PR #510 MERGED, FOLLOW-551 promoted + dispatched DRAFT-ONLY

PR #510 (`pm-orchestrator/FOLLOW-550-done`, DONE-flip + RETRO-174 bundled) confirmed MERGED as
commit `146de2f`. Local sync: `git checkout main && git pull` fast-forwarded `66f8e76..146de2f`;
confirmed FOLLOW-550 shows `status: DONE` on `main`, RETRO-174 present in
`backlog/RETROSPECTIVES.md`, and both FOLLOW-551 + FOLLOW-552 stubs present in
`backlog/FOLLOW_UPS.md`. No QUEUE.md-touching PR in flight — rule (b) satisfied, safe to promote.

**Promoted FOLLOW-551** (P3, source_ticket FOLLOW-550, RETRO-174 §5a) into Sprint 22b. Human
decision: resolve via option (2) from the stub — formalize draft-then-apply as the standing
resolution (not route-away, not give-architect-Bash). **Dispatched to architect in DRAFT-ONLY
execution mode** (dogfooding the very pattern being codified): architect does not branch, Edit, or
touch `git` — it returns the exact content + insertion points + rationale in its report; the
coordinator applies it. Delegation-table row: "a contract between two modules, a new dependency, an
ADR" -> architect. Model: **Sonnet** (routine codification, fully-specified AC, no open design
question). AC pulled from the FOLLOW-551 stub + a concrete NEW finding surfaced while drafting this
brief: **`.claude/agents/architect.md`'s own "First action on any ticket" section instructs
`git checkout -b ...` — a command architect has no tool to run.** Flagged for architect to fix as
part of this ticket, alongside the primary `docs/AGENT_WORKFLOW.md` addition.

**Rule-AB-discipline precision (stated explicitly in the ticket, not hand-waved):** the
architect-no-Bash pattern has exactly 2 banked prior numbered-retro sightings (RETRO-168/FOLLOW-470,
RETRO-174/FOLLOW-550) and no 3rd sighting yet. FOLLOW-551 is the FIX, not a fresh occurrence —
implementing it does not itself satisfy the ≥2-PRIOR-plus-3rd-sighting promotion threshold this
repo's Rules Q/V/X/AA/AB all follow. This stays workflow guidance (`docs/AGENT_WORKFLOW.md` +
possibly `architect.md`), explicitly NOT a `CONVENTIONS_PATCH.md` Rule promotion.

Full brief in `backlog/HANDOFFS.md` ("Delegation brief — FOLLOW-551 (architect) — DRAFT-ONLY").
Queue edits on branch `pm-orchestrator/FOLLOW-551-dispatch` (branch-first, never committed to
`main`). **Anti-sprawl applied to this ticket's own lifecycle** (per explicit instruction): ONE
promotion PR (this one, human merges it), later ONE DONE+RETRO bundle — no separate validation PR
(there is nothing to "validate" via CI for a draft — the coordinator's application of the draft is
itself the deliverable that gets validated, at DONE-flip time). **Not spawned by pm-orchestrator** —
brief reported to the coordinator to dispatch.

---

## SESSION 25 cont'd (2026-07-10) — #508/#509 MERGED, FOLLOW-550 DONE, RETRO-174 dispatch prepared

Both PRs merged by the human: PR #509 (`architect/FOLLOW-550-bookkeeping-pr-sequencing`, the content
— `docs/AGENT_WORKFLOW.md`) as commit `66f8e76`; PR #508 (`pm-orchestrator/FOLLOW-550-dispatch`, the
bookkeeping — dispatch + this session's own validation) as commit `c02b96b`. Local sync:
`git checkout main && git pull` fast-forwarded `e0a11b3..66f8e76`. Confirmed
`docs/AGENT_WORKFLOW.md`'s "Bookkeeping-PR sequencing" section is live on `main`; confirmed
FOLLOW-550 showed `status: READY_FOR_REVIEW` in `backlog/QUEUE.md` before this edit.

**#508 merging (not closing) is CORRECT**, verified against the new section's own rule (a): #508's
dispatch-record content was never duplicated/re-included in a later PR — the validation was folded
into #508 IN PLACE (an extra commit, per rule (d), dogfooded last turn) rather than a new PR, so
#508 had genuine non-redundant content to merge. This is the key structural difference from
FOLLOW-549's #504 (whose content WAS about to be duplicated by the separate #506) — confirms the new
rule's own logic holds up against a real case immediately.

**Post-merge close done on branch `pm-orchestrator/FOLLOW-550-done`** (agent-prefix, branch-first):
FOLLOW-550 flipped `READY_FOR_REVIEW` → `DONE` in `backlog/QUEUE.md` (`completed_at: 2026-07-10`,
`merged_pr:` citing #509 as content + #508 as bookkeeping, `merge_commit: 66f8e76`). Confirmed
exactly ONE `FOLLOW-550` block, no duplication from the two merges.

**Retro brief prepared** in `backlog/HANDOFFS.md` ("Retro delegation brief — FOLLOW-550") for
RETRO-174 — model **Opus** (matches `retrospective-analyst`'s own agent-file default) — to be
appended onto `pm-orchestrator/FOLLOW-550-done` so DONE + RETRO ship as ONE bundled PR (dogfooding
rule (d) one more time). Flagged three specific angles per the coordinator: (a) did the dogfooding
of FOLLOW-550's own bundle shape actually hold, or did sprawl leak back in; (b) is FOLLOW-551
correctly scoped, and are there OTHER agents with a similar tool/role mismatch worth sweeping in
now; (c) confirm the Rule AB ARMED trigger from RETRO-173 is still correctly pending (count 1) and
not accidentally tripped by FOLLOW-550's mere existence — codifying guidance is not itself a second
retro sighting. Not spawned by pm-orchestrator; reported back to the coordinator to dispatch.

---

## SESSION 25 cont'd (2026-07-10) — PR #509 validated (folded into #508, no separate validation PR)

architect drafted FOLLOW-550's content; the coordinator applied the git mechanics (branch, commit
`5025edd`, push, open PR #509) since the architect subagent has **no Bash tool** (manifest:
Read/Write/Edit/Glob/Grep/WebSearch/WebFetch). The architect correctly REFUSED to `Edit`
`docs/AGENT_WORKFLOW.md` directly rather than risk stranding the change on `main` (the exact
FOLLOW-448/RETRO-146 failure mode) — drafted full content + insertion point + rationale and
escalated the tooling gap instead. **Recorded as a routing/process finding** (not a numbered retro
finding — no retro triggered for this): future implement-with-git docs-codification tickets should
NOT be dispatched to architect without a plan for who applies the git mechanics. **FOLLOW-551
filed** (P3, pm-orchestrator, ~1h) to formalize the resolution — concrete recurrence risk flagged:
FOLLOW-543 (Master_Design narrative refresh, still unpromoted, `recommended_agent: architect`) will
hit the identical wall when dispatched.

**Validated PR #509** per the non-negotiable checklist:

1. **CI:** `gh pr checks 509 --watch` → green except the standing 2-leg "Rule I — wired-or-dead"
   gate. Independently computed non-success count via `gh pr view 509 --json statusCheckRollup` →
   **2**. Cross-checked via `gh run view --log-failed` → **180 WARN lines**, identical to the
   FOLLOW-532/546/548/549 baseline (expected — docs-only diff, confirmed via
   `gh pr view 509 --json files` → exactly one file, `docs/AGENT_WORKFLOW.md`;
   `CONVENTIONS_PATCH.md` untouched).
2. **AC:** read the full 53-line diff directly — new section correctly placed between
   "Recovered-work re-verification" and "The retrospective loop"; all four rules (a)-(d) present;
   cites RETRO-173 §5a/§6/§9 and the #504/#505/#506 incident with the correct causal chain; contains
   the required "workflow guidance, not a `CONVENTIONS_PATCH.md` Rule — Rule AB /
   ≥2-prior-numbered-retro threshold genuinely unmet" statement, citing RETRO-153/158/169/170 by
   name as the promotion-discipline precedent.

**CI-check counter: 1/5. Fix-iteration counter: 0/3.** PR comment posted with the full evidence
trail.

**Dogfooding FOLLOW-550's own rule (d):** this validation was folded directly into the EXISTING
promotion PR #508 (extra commit on branch `pm-orchestrator/FOLLOW-550-dispatch`) rather than opened
as a separate validation PR — `backlog/QUEUE.md` FOLLOW-550 flipped `IN_PROGRESS` ->
`READY_FOR_REVIEW` in place. **Confirmed PR #508 is still correct to MERGE, not close-superseded**,
per rule (a): its content (the dispatch record) is not being duplicated/re-included in a later PR —
this validation commit only extends #508 in place, so #508 remains the sole, non-redundant source of
FOLLOW-550's bookkeeping trail. The eventual DONE+RETRO bundle will be a fresh PR cut from `main`
AFTER both #508 and #509 merge, per rule (c).

---

## SESSION 25 cont'd (2026-07-10) — PR #507 MERGED, FOLLOW-550 promoted + dispatched to architect

PR #507 (`pm-orchestrator/FOLLOW-549-done`, DONE-flip + RETRO-173 bundled) confirmed MERGED as
commit `e0a11b3`. Local sync: `git checkout main && git pull` fast-forwarded `f541f37..e0a11b3`;
confirmed FOLLOW-549 shows `status: DONE` on `main`, RETRO-173 present in
`backlog/RETROSPECTIVES.md` (1 occurrence of `## RETRO-173`), FOLLOW-550 stub present in
`backlog/FOLLOW_UPS.md` (1 occurrence). FOLLOW-549's loop is now FULLY closed — no open PRs, no
pending retro, no residual sprawl.

**Promoted FOLLOW-550** (P3, RETRO-173 §5d/§6/§9, source_ticket FOLLOW-549) into Sprint 22b.
Human-approved reassignment to **architect** (cross-cutting process/convention change, not a worker
deliverable — overrides the FOLLOW_UPS.md stub's original `recommended_agent: pm-orchestrator`,
which didn't map onto the decision table). Delegation-table row: "a contract between two modules, a
new dependency, an ADR" -> architect. Model: **Sonnet** (routine docs codification with ready-made
Rule text from the retro; not the ambiguous-design Opus tier). AC pulled directly from RETRO-173's
ready-made text: (a) bookkeeping PRs whose content a later PR folds in are ALWAYS closed-superseded,
never merged; (b) never two QUEUE.md-touching PRs in flight; (c) validation/DONE PRs cut from `main`
AFTER the code PR merges; (d) fold validation into the DONE+RETRO bundle rather than a separate PR.
Home decided: `docs/AGENT_WORKFLOW.md` (new subsection, recommended placement between
"Recovered-work re-verification" and "The retrospective loop") — **explicitly NOT
`CONVENTIONS_PATCH.md`**, since RETRO-173 held the pattern at count 1 (≥2-PRIOR-numbered-retro
threshold unmet, Rule AB discipline) and did not promote it; the AC requires the architect's new
section to say so explicitly, and routes any disagreement to `backlog/ESCALATIONS.md` rather than a
silent Rule add. Branch: `architect/FOLLOW-550-bookkeeping-pr-sequencing`. Full brief in
`backlog/HANDOFFS.md` ("Delegation brief — FOLLOW-550").

**Anti-sprawl applied to THIS ticket's own lifecycle:** ONE promotion bookkeeping PR (this one,
human merges it), later ONE DONE+RETRO bundle — no separate validation PR, per the coordinator's
explicit instruction to apply FOLLOW-550's own lesson to itself. Queue edits on branch
`pm-orchestrator/FOLLOW-550-dispatch` (branch-first, never committed to `main`).

**Not spawned by pm-orchestrator** — brief reported back to the coordinator to dispatch (coordinator
will pass it inline so architect can start off `main` in parallel, without waiting for this
promotion PR to merge).

---

## SESSION 25 cont'd (2026-07-10) — #504/#505 MERGED, #506 superseded/closed, FOLLOW-549 DONE

**Sequencing note for the human/coordinator, per explicit instruction:** this branch
(`pm-orchestrator/FOLLOW-549-done`) has the DONE-flip committed and pushed but **NO PR opened yet**.
Wait until `retrospective-analyst` appends RETRO-173 onto this SAME branch, THEN open ONE bundled PR
(matches the FOLLOW-532/#503 pattern) — do not open a PR now.

**What happened:** the human merged BOTH PR #504 (`pm-orchestrator/FOLLOW-549-dispatch`, the
original dispatch-record/IN_PROGRESS block, commit `857e069`) AND PR #505 (the actual code,
`backend-engineer/FOLLOW-549-adapt-get-auth-area-pin`, commit `f541f37`) — rather than closing #504
as superseded. This made the PM's already-open validation PR #506
(`pm-orchestrator/FOLLOW-549-validate`, cut from `main` BEFORE #504/#505 merged) develop an
unresolvable `backlog/QUEUE.md` merge conflict once both landed (too large for the web editor). Per
the coordinator's explicit instruction: did NOT attempt to rebase/resolve #506 — closed it unmerged
instead (`gh pr close 506 --comment "..."`, no data loss — its evidence is independently
re-confirmed against `main` post-merge below, not copy-pasted blind) and deleted its branch plus the
already-merged `pm-orchestrator/FOLLOW-549-dispatch` branch.

**Recovery:** `git checkout main && git pull` confirmed both merge commits present (`f541f37 (#505)`
then `857e069 (#504)` in `git log --oneline`). Confirmed `backlog/QUEUE.md` has exactly ONE
`FOLLOW-549` block (no duplication from the two merges — read the region in full before editing).
Confirmed the #505 code is genuinely on `main`: `adapt-get-auth.ts`'s docstring (lines 13-16) and
both route test files' `RETRO-172 TG-1` pin tests all present and grep-matched directly against the
live file, not assumed from the PR diff. Since the code is already merged, FOLLOW-549 skips a
separate `READY_FOR_REVIEW` state and goes straight `IN_PROGRESS` → `DONE` on a fresh branch
`pm-orchestrator/FOLLOW-549-done` (off current `main`), with `merged_pr: 505`,
`merge_commit: f541f37`, `completed_at: 2026-07-10`, and the full CI/AC evidence trail
(independently re-derived pre-close-out — see the FOLLOW-549 ticket block's `ci_status:`) folded
into `notes:`. `backlog/FOLLOW_UPS.md` stub note updated to reflect DONE.

**Retro brief prepared** in `backlog/HANDOFFS.md` ("Retro delegation brief — FOLLOW-549") for
RETRO-173 — model **Opus** (matches `retrospective-analyst`'s own agent-file default) — to be
appended onto `pm-orchestrator/FOLLOW-549-done` so DONE + RETRO ship as ONE bundled PR, explicitly
to stop the 3-PR-per-ticket sprawl (#504/#505/#506) this ticket produced. Not spawned by
pm-orchestrator; reported back to the coordinator to dispatch.

---

## SESSION 25 cont'd (2026-07-10) — PR #503 MERGED, FOLLOW-549 promoted + dispatched

PR #503 (`pm-orchestrator/FOLLOW-532-close`) confirmed MERGED via `gh pr view`/coordinator report as
commit `f1f9646`. Local sync: `git checkout main && git pull` fast-forwarded `a934adf..f1f9646`;
confirmed FOLLOW-532 shows `status: DONE` on `main` (`backlog/QUEUE.md` line ~10970-10982,
`merged_pr: 502`, `merge_commit: a934adf`) and RETRO-172 + the FOLLOW-549 stub are present
(`backlog/RETROSPECTIVES.md`, `backlog/FOLLOW_UPS.md`).

**Promoted FOLLOW-549** (P3, RETRO-172 §4c TG-1/§4d DG-1, source_ticket FOLLOW-532) from
`backlog/FOLLOW_UPS.md` into Sprint 22b. Delegation-table row: "ingest worker, control-plane,
decision-api, Postgres/RLS, auth, onboarding HTTP, billing, webhooks" -> backend-engineer. Model:
**Sonnet** (routine, mechanical — 2 spy assertions + 1 docstring sentence, no design judgment).
Branch: `backend-engineer/FOLLOW-549-adapt-get-auth-area-pin`. AC filled in directly from the retro:
(1) a lightweight `toHaveBeenCalledWith(..., 'adapt'|'description')` assertion in each route's
EXISTING test suite (both already have a hoisted `mockResolveAdaptGetAuth` spy — confirmed via grep,
no new test file needed); (2) strengthen the `adapt-get-auth.ts:13-14` call-site-inventory docstring
to name the `area`-union-widening compile error as the forcing function for a genuine third
consumer. Full brief in `backlog/HANDOFFS.md` ("Delegation brief — FOLLOW-549"). Queue edits done on
branch `pm-orchestrator/FOLLOW-549-dispatch` (branch-first, never committed to `main`).

**Not spawned by pm-orchestrator** — brief reported back to the coordinator to dispatch
backend-engineer.

---

## SESSION 25 close-out (2026-07-10) — PR #502 MERGED (a934adf), FOLLOW-532 DONE, RETRO pending

PR #502 (`backend-engineer/FOLLOW-532-adapt-get-auth-dbthrow-parity`) confirmed MERGED via
`gh pr view 502 --json state,mergeCommit,mergedAt` → `state: MERGED`, `mergeCommit: a934adf`
(`a934adfd2359d4f12aa6538923e08ce351112025`), `mergedAt: 2026-07-10T14:36:48Z`. Local sync:
`git checkout main && git pull` fast-forwarded `e429524..a934adf`; `git log --oneline -1` confirms
`a934adf ... [FOLLOW-532] (#502)` present.

**Post-merge close done on branch `pm-orchestrator/FOLLOW-532-close`** (agent-prefix, branch-first —
the QUEUE/STATUS/HANDOFFS/FOLLOW_UPS edits from the validation pass were made directly in the
working tree before the merge landed; moved onto this branch on resume, never committed to `main`):
FOLLOW-532 flipped `READY_FOR_REVIEW` → `DONE` in `backlog/QUEUE.md` (`completed_at: 2026-07-10`,
`merged_pr: 502`, `merge_commit: a934adf`).

**Retro delegation brief prepared** in `backlog/HANDOFFS.md` ("Retro delegation brief — FOLLOW-532")
per CLAUDE.md's per-ticket retrospective loop — **not spawned by pm-orchestrator** (no
subagent-spawn capability in this tool surface); reported back to the coordinator to dispatch. Model
recommendation: **Opus** (matches `retrospective-analyst`'s own agent-file default; also genuinely
warranted here — first retro on a shared-auth-helper signature change with an explicit "3rd consumer
must be appended here" call-site inventory, plus RETRO-164's own co-assignment recommendation being
overridden this session, both cross-module/precedent-setting judgment calls, not routine).

**This is a fresh bookkeeping PR, opened but NOT merged** — awaiting RETRO content to land on the
same branch first (matches PRs #486/#487/#489/#493/#497/#501 RETRO+DONE bundling convention).

---

## SESSION 25 cont'd (2026-07-10) — PR #502 validated, FOLLOW-532 READY_FOR_REVIEW

backend-engineer opened PR #502 for FOLLOW-532. Validated per the non-negotiable checklist:

1. **CI:** `gh pr checks 502 --watch` → all pass except the standing 2-leg "Rule I — wired-or-dead"
   gate. Independently computed non-success count via `gh pr view 502 --json statusCheckRollup` →
   **2**, both Rule I. Cross-checked via `gh run view 29097226725 --log-failed` → **180 WARN
   lines**, identical to the FOLLOW-546/548 baseline; grepped for `adapt-get-auth` /
   `AdaptGetAuthResult` / `resolveAdaptGetAuth` in that log → **0 hits** (worker's "none of mine"
   claim independently confirmed, not taken on faith).
2. **Wiring:**
   `grep -rn "resolveAdaptGetAuth(" apps/ --include=*.ts | grep -v node_modules | grep -v test` →
   exactly the helper's own export + the 2 production call sites (`adapt/route.ts:714`,
   `adapt/description/route.ts:220`) — no orphan caller, `Sentry` import confirmed still used
   elsewhere in both files (not orphaned by the removed try/catch).
3. **AC:** worker chose option 2 (fold into helper as a 3rd `AdaptGetAuthResult` disposition,
   `dbError: true`, keyed on a new required `area` param) — both routes now share one code path,
   structurally stronger than the option-1 test-only parity the ticket also allowed. New parity
   test's `.toEqual` cross-area assertion independently read and confirmed load-bearing.
4. **Local re-verification (not trusting the worker's self-report, per Rule 4e/FOLLOW-448):** fresh
   `git worktree` off the PR branch, `pnpm install`, rebuilt `@estalara/{db,shared,auth,sdk}` first
   (FOLLOW-474/RETRO-150's documented worktree-bootstrap gotcha — control-plane `tsc` 2307s on those
   packages otherwise), then `tsc --noEmit` = clean; `vitest run adapt-get-auth.parity.test.ts` =
   4/4; `vitest run adapt/route.test.ts adapt/description/route.test.ts` = 89/89; targeted
   `eslint` + `prettier --check` on all 6 touched files = clean. Worktree removed after.

**CI-check counter: 1/5. Fix-iteration counter: 0/3.** PR comment posted with the full evidence
trail. `backlog/QUEUE.md` FOLLOW-532 flipped `IN_PROGRESS` -> `READY_FOR_REVIEW`. Not merged (human
reviews PRs).

---

## SESSION 25 (2026-07-10) — FOLLOW-532 promoted + dispatched; RETRO-171 confirmed already merged

**State read at session start:** `git log --oneline -20` clean at `e429524`;
`gh pr list --state open` → 0 open PRs. `backlog/RETROSPECTIVES.md` confirmed **RETRO-171 IS filed
and merged** (commit `e429524` — the prior session's STATUS.md header calling it "pending" was
stale; corrected here). 3 standing `## OPEN` escalations (ESC-020, ESC-028, ESC-034) re-read in full
— all carry explicit non-blocking resolutions/status from prior human decisions (ESC-020's own
`Resolution:` field, `backlog/STATUS.md` ESCALATION STATUS table) — not re-litigated, pipeline
proceeds per established precedent across ~10+ prior sessions.

**Ticket selection:** 4 tickets already `READY` in-queue (FOLLOW-467/468/469/474) are all P3.
FOLLOW-458 (P2) is blocked (`depends_on: [FOLLOW-449]`, still `CODE_COMPLETE_OPERATOR_PENDING`).
**FOLLOW-532** (P2, `backlog/FOLLOW_UPS.md`, RETRO-164 §4a LG-1, source_ticket FOLLOW-473,
`depends_on: []`) is the highest-priority genuinely-unblocked item — promoted to `backlog/QUEUE.md`
and dispatched. Delegation-table row: "ingest worker, control-plane, decision-api, Postgres/RLS,
auth, onboarding HTTP, billing, webhooks" -> backend-engineer. Model: **Sonnet** (routine,
well-scoped, no cross-module ambiguity — model-fit table). Assigned to backend-engineer ALONE, not
co-assigned with qa-engineer as the stub suggested (scope is confined to backend-engineer's own two
route files; avoids an unwarranted step-5d cross-agent integration check). Branch:
`backend-engineer/FOLLOW-532-adapt-get-auth-dbthrow-parity`. Full brief in `backlog/HANDOFFS.md`.

**CI-check counter:** 0/5 (not yet started — worker has not opened a PR). **Fix-iteration counter:**
0/3.

**Queue hygiene:** `backlog/QUEUE.md` FOLLOW-532 ticket block added, `status: IN_PROGRESS`.
`backlog/FOLLOW_UPS.md` FOLLOW-532 stub `promoted_to_queue: true` with the co-assignment-deviation
rationale noted inline.

**Not touched this session (explicitly out of scope, no new information changes their status):**
FOLLOW-543/545/547/533/534 (unpromoted stubs), FOLLOW-458 (still blocked), TICKET-PILOT-001 and the
old Sprint 2.5/3 `READY` fossils (TICKET-030/038, FOLLOW-065/071/073/074/355/356/367/370/388/395/
399/400/401/447/472) — pre-dates the current Sprint 22b active work, several superseded (e.g.
TICKET-038's <40KB gzip bundle gate superseded by the 42KB ESC-028 raise; TICKET-030/040 Magic Link
wizard superseded by later onboarding-HTTP work); not re-litigated this session, flagging for a
future queue-hygiene pass rather than silently actioning without confirming which are genuinely dead
vs. genuinely forgotten.

---

## SESSION 24 CLOSE-OUT (2026-07-10) — PR #499 MERGED (ae1bc67), FOLLOW-548 DONE, Rule AB citation fixed, RETRO-171 pending

PR #499 (`sdk-engineer/FOLLOW-548-raf-deferred-staleness-guard`) confirmed MERGED via
`gh pr view 499 --json state,mergeCommit,mergedAt` → `state: MERGED`, `mergeCommit: ae1bc67`,
`mergedAt: 2026-07-10T10:24:35Z`. PR #500 (PM validation) confirmed MERGED (`b3770f6`, immediately
after). PR #498 (superseded promotion/dispatch-record PR) confirmed `CLOSED` (not merged) via
`gh pr view 498 --json state` — per human decision, its content already lives fully folded into
FOLLOW-548's DONE trail (no data lost). `gh pr list --state open` → 0 open PRs. Local `main` synced
(`git log --oneline -1` → `b3770f6`), clean.

**Post-merge close done on branch `pm-orchestrator/FOLLOW-548-close`** (agent-prefix, branch-first):
FOLLOW-548 flipped `READY_FOR_REVIEW` → `DONE` in `backlog/QUEUE.md` (`completed_at: 2026-07-10`,
`merged_pr: 499`, `merge_commit: ae1bc67`).

**Rule AB citation fix folded in (human-approved recommendation, option (a)):**
`CONVENTIONS_PATCH.md` Rule AB — corrected both the "Evidence" bullet's RETRO-170 sub-entry and the
HTML provenance footnote. Both originally attributed the residual gap to `:323`/`:333`
(`requestAnimationFrame(applyAndObserveSlot(...))`) being "rAF-deferred"; corrected to point at the
actual genuinely-deferred write — the `reapply` loop-guard closure, re-invoked via the
`MutationObserver`'s OWN internal `requestAnimationFrame`, independent of the caller's initial rAF
schedule — with FOLLOW-548 (PR #499) cited as the proof. Rule AB's normative "Rule:" list (the
numbered principle text, which never cited specific line numbers) is UNCHANGED — verified it was
already generically correct ("if the write is deferred ... re-check INSIDE the deferred callback").
`backlog/RETROSPECTIVES.md` RETRO-170's own historical text was NOT touched (append-only convention
for retro entries, per the RETRO-168 DURABLE-SELF-REPORT-DRIFT pattern).

**Not run this pass (per explicit instruction):** the retrospective. `retrospective-analyst` will be
spawned by the coordinator directly onto `pm-orchestrator/FOLLOW-548-close` to append **RETRO-171**
— also tasked with assessing whether the RETRO-105 cross-listing async-interleave class is now FULLY
closed after three relocation hops (FOLLOW-380 → FOLLOW-546 → FOLLOW-548) or whether a 4th hop
exists — bundling RETRO + DONE-flip + the Rule AB fix into one PR (matches PRs
#486/#487/#489/#493/#497 convention). PM will validate that bundled PR once the coordinator confirms
it's ready.

**This is a fresh bookkeeping PR, opened but NOT merged** — awaiting RETRO-171 content to land on
the same branch first.

---

## SESSION 24 VALIDATION (2026-07-10) — PR #499 (FOLLOW-548) validated, READY_FOR_REVIEW

**Context:** PR #498 (FOLLOW-548 promotion + dispatch record) is still UNMERGED (awaiting human,
same pattern as FOLLOW-380/#490 and FOLLOW-546/#494) — `main` has no FOLLOW-548 ticket block at all
yet. This session's QUEUE.md edit promotes FOLLOW-548 straight into a real ticket block at
`READY_FOR_REVIEW`, folding the full trail into one edit rather than assuming #498 landed.

**Independently re-verified (not taken on the worker's self-report):**

- `gh pr checks 499 --watch` run to completion; `gh pr view 499 --json statusCheckRollup` →
  non-success count = **2**, both "Rule I — wired-or-dead check" (matrix-duplicated). Pulled
  `--log-failed`: 180 violations — IDENTICAL count to the FOLLOW-546 baseline, zero new flags.
- Pulled the full `Test (Node 22)` job log: `@estalara/sdk:test` ran fresh — **69 files / 1524
  tests, 100% pass** (up from FOLLOW-546's 1521 by exactly the 3 new tests: TG-1, TG-2, headline).
- Bundle-size gate: **40.49KB gzip vs 42KB budget** — passed, exact match to the self-report this
  time (no discrepancy, unlike FOLLOW-546's 40.25 vs 40.47).
- `gh pr view 499 --json files` → exactly 4 files: `.claude/agents/sdk-engineer/lessons.md`,
  `packages/sdk/src/__tests__/adapt-description.test.ts`,
  `packages/sdk/src/core/adapt-description.ts`,
  `packages/shared/src/schemas/events/adapt-description.ts`. Zero edits to `backlog/QUEUE.md`,
  `docs/MASTER_DESIGN.md`, `README.md`, or `CLAUDE.md`. Confirmed `index.ts` correctly ABSENT from
  the diff (unchanged, already correct).

**The required-param / prod-caller check (item 2):**

- `grep -rn "applyDescriptionAdaptation" packages/sdk/src --include=*.ts | grep -v test` → confirmed
  exactly ONE production call site (`index.ts:809`), unchanged in this diff, already passing the
  real predicate `() => myRefreshId !== latestRefreshId` — read directly, not assumed. No other prod
  caller exists that could silently compile-break or mis-wire.
- `grep -c "() => false"` in the test file → 32 occurrences (the ~31 pre-existing call sites plus
  the new tests' literal), confirming the unit-test sites were mechanically updated to pass an
  explicit never-stale predicate rather than relying on a removed default.

**Runtime-wiring verification (read the full function bodies, not just grep for the check):**

- `reapply()`'s `if (isStale())` appears FIRST (before the `descFingerprint` comparison); on the
  stale path it calls `s.obs.disconnect()` then `pushEvent(EVT + 'skipped', {reason:'stale'})` then
  returns — confirmed this genuinely precedes the `render`/`obs.observe` statements further down
  (unreachable once this early-returns). The `disconnect()` kills the persistence leg by retiring
  the watchdog entirely.
- A second `if (isStale())` at entry (defense-in-depth) also confirmed to precede the "Initial
  write" `render`/`obs.observe` pair.
- `AdaptDescriptionSkippedPayloadSchema.reason` unchanged (`z.string().min(1).optional()`) — the
  `{reason:'stale'}` payload is schema-valid without any contract change; JSDoc updated to document
  it (DG-1 confirmed).

**Both new tests independently read (not just re-run) and confirmed non-vacuous:** TG-1 drives a
fresh paint → a simulated DOM revert (arming the observer's internal rAF) → sets the supersession
flag IN THE GAP between arming and firing → fires the deferred reapply via `vi.runAllTimers()` →
asserts the slot keeps the newer content and that a SUBSEQUENT revert is no longer re-asserted
(proving `disconnect()` genuinely ran). TG-2 covers the persistence leg: the superseding nav's own
fetch resolves non-adaptable (`template_fallback`), so it bails before its own write — the stale
watchdog, once fired, still must not resurrect the stale copy. A third test mirrors TG-1 for the
headline path. Without the fix, `reapply()`'s unconditional repaint on a fingerprint mismatch would
resurrect the stale content in all three — these tests are structurally guaranteed to fail without
the guard.

**AC spot-check:** all 5 items (a: reapply-watchdog guard + entry defense-in-depth; b: TG-1; c:
TG-2; d: LG-2 required param; e: DG-1 JSDoc) confirmed present in the diff.

**SEPARATE — permanent-record accuracy recommendation (per the coordinator's explicit ask, not
actioned, just recommended):** RETRO-170 §4a LG-1's prose and Rule AB's evidence footnote in
`CONVENTIONS_PATCH.md` cite `:323`/`:333` as "the unguarded write," but — as both the PM dispatch
brief and the worker's independent re-confirmation established — that line runs synchronously and
was already guarded by the pre-existing `:309` check; the real gap is the `reapply` closure fired
via the observer's internal `:155` rAF. **Recommendation: (a)** fold a small, surgical
evidence-citation correction into Rule AB's `CONVENTIONS_PATCH.md` footnote as part of the eventual
FOLLOW-548 close PR (mirrors the FOLLOW-544 precedent — Rule AB is live/forward-looking and benefits
most from an accurate citation for future engineers). Do NOT edit RETRO-170's own text (append-only
convention for retro entries, per the RETRO-168 DURABLE-SELF-REPORT-DRIFT pattern — propagate
corrections to durable/live docs, don't rewrite history); the eventual RETRO-171 will naturally
reconcile this as part of its own analysis. The Rule AB PRINCIPLE itself is correct and needs no
change — only the specific line citation in its supporting evidence.

**Result:** FOLLOW-548 promoted directly to `READY_FOR_REVIEW` in `backlog/QUEUE.md` (no separate
IN_PROGRESS commit landed on `main` first, since #498 is still unmerged — the full trail is folded
into the ticket's `notes:`), `pr: 499` recorded with the full evidence trail inline. CI-check
counter: 1/5. Fix-iteration counter: 0/3. Branch `pm-orchestrator/FOLLOW-548-validate` (based on
current `main`, NOT stacked on the still-unmerged #498) — opened as a new PR, not merged.

---

## SESSION 23 CLOSE-OUT (2026-07-10) — PR #495 MERGED (118bdd8), FOLLOW-546 DONE, RETRO-170 pending

PR #495 (`sdk-engineer/FOLLOW-546-description-staleness-guard`) confirmed MERGED via
`gh pr view 495 --json state,mergeCommit,mergedAt` → `state: MERGED`, `mergeCommit: 118bdd8`,
`mergedAt: 2026-07-10T08:30:32Z`. PR #496 (PM validation) confirmed MERGED (`4a5c2ba`, immediately
after). PR #494 (superseded promotion/dispatch-record PR) confirmed `CLOSED` (not merged) via
`gh pr view 494 --json state` — per human decision, its content already lives fully folded into
FOLLOW-546's DONE trail (no data lost). `gh pr list --state open` → 0 open PRs. Local `main` synced
(`git log --oneline -1` → `4a5c2ba`), clean.

**Post-merge close done on branch `pm-orchestrator/FOLLOW-546-close`** (agent-prefix, branch-first):
FOLLOW-546 flipped `READY_FOR_REVIEW` → `DONE` in `backlog/QUEUE.md` (`completed_at: 2026-07-10`,
`merged_pr: 495`, `merge_commit: 118bdd8`).

**Not run this pass (per explicit instruction):** the retrospective. `retrospective-analyst` will be
spawned by the coordinator directly onto `pm-orchestrator/FOLLOW-546-close` to append **RETRO-170**,
bundling RETRO + DONE-flip into one PR (matches PRs #486/#487/#489/#493 convention). PM will
validate that bundled PR once the coordinator confirms it's ready.

**This is a fresh bookkeeping PR, opened but NOT merged** — awaiting RETRO-170 content to land on
the same branch first.

---

## SESSION 23 VALIDATION (2026-07-10) — PR #495 (FOLLOW-546) validated, READY_FOR_REVIEW

**Context:** PR #494 (FOLLOW-546 promotion + dispatch record) is still UNMERGED (awaiting human,
same pattern as FOLLOW-380/#490) — `main` has no FOLLOW-546 ticket block at all yet. This session's
QUEUE.md edit promotes FOLLOW-546 straight into a real ticket block at `READY_FOR_REVIEW`, folding
the full trail into one edit rather than assuming #494 landed.

**Independently re-verified (not taken on the worker's self-report):**

- `gh pr checks 495 --watch` run to completion; `gh pr view 495 --json statusCheckRollup` →
  non-success count = **2**, both "Rule I — wired-or-dead check" (matrix-duplicated). Pulled
  `--log-failed`: 180 violations — IDENTICAL count to the FOLLOW-380 baseline, zero new flags,
  confirmed via `git diff` that neither touched file adds a new `export`.
- Pulled the full `Test (Node 22)` job log: `@estalara/sdk:test` ran fresh — **69 files / 1521
  tests, 100% pass** (up from FOLLOW-380's 1520 by exactly the 1 new hardening (d) test).
- Bundle-size gate (embedded in `Build`): **40.47KB gzip vs 42KB budget** — passed (worker
  self-reported 40.25KB — a minor discrepancy, still comfortably under budget).
- `gh pr view 495 --json files` → exactly 4 files, one of which (`follow-380.test.ts`) is EXTENDED
  (11 tests, was 10), not a new/duplicate file. Zero edits to `backlog/QUEUE.md`,
  `docs/MASTER_DESIGN.md`, `README.md`, or `CLAUDE.md`.

**Runtime-wiring verification (read the actual diff):**

- `applyDescriptionAdaptation` gained a third, OPTIONAL parameter
  `isStale: () => boolean = () => false` (`adapt-description.ts:276`) — default preserves the ~30
  existing 2-arg test call sites (both `adapt-description.test.ts` and `follow-354.test.ts` are
  UNTOUCHED in this diff, confirmed via the 4-file list above, so they keep compiling/passing purely
  off the default). The real production call site (`index.ts:805`) passes a live predicate
  `() => myRefreshId !== latestRefreshId`, reusing the FOLLOW-380 `:737` checkpoint's closure vars —
  confirmed genuinely wired, not left defaulting in prod.
- Both checkpoints (`adapt-description.ts:288` entry, `:309` post-`await fetchDescription`) read in
  full context — both unambiguously precede every DOM-mutating statement (`:323` `slots.forEach`,
  and the headline-slot mutation further down).
- Non-vacuous test independently inspected: the new hardening (d) case in `follow-380.test.ts`
  deliberately resolves a NEWER-navigation description fetch first and a STALE one last, then
  asserts the DOM keeps the fresh copy and an `adapt.description.skipped {reason:'stale'}` event
  fires exactly once (observable discard, not silent) — this would fail without the `:309` guard.

**The load-bearing claim ("4 pre-existing failures, RED on main too") — thoroughly re-verified, did
NOT hold up literally, but the substance does:**

- Ran `packages/sdk/src/__tests__/adapt-description.test.ts` (35/35 pass) and
  `packages/shared/src/schemas/events/events.test.ts` (67/67 pass, incl. the exact
  "adapt.description.\* events (FOLLOW-461 / audit F-04) — ingest round-trip" describe block)
  locally on the PR branch after a fresh `@estalara/shared` build — 100% green.
- Repeated the SAME two local runs on `main` itself under the identical fresh-build condition — also
  100% green. Could not reproduce "RED on main" as stated.
- Structural confirmation: `AdaptDescriptionSkippedPayloadSchema.reason` is
  `z.string().min(1).optional()` — its own doc comment says this is deliberate ("keeps
  forward-compat with new reason codes"), so a new `reason: 'stale'` value cannot possibly break the
  round-trip regardless of build state.
- **Conclusion:** the worker's "RED on main too" framing is not literally accurate under my testing,
  but the conclusion that matters for merge-gating — this PR introduces ZERO test regression — is
  independently confirmed three ways (CI green, local reruns green on both branches, structural
  schema analysis). Most likely explanation: the worker's local "4 failures" were the same transient
  stale-`@estalara/shared`-build-artifact class already documented in their own lessons.md from the
  FOLLOW-380 session — an environment property, not a code defect.

**AC spot-check:** guard before+after fetch (confirmed at `:288`/`:309`); non-vacuous test
(confirmed); no regression to the same-archetype fast-path (structurally guaranteed by the
never-stale default + confirmed via the full green suite); no QUEUE/MASTER_DESIGN/README/CLAUDE
edits (confirmed).

**Result:** FOLLOW-546 promoted directly to `READY_FOR_REVIEW` in `backlog/QUEUE.md` (no separate
IN_PROGRESS commit landed on `main` first, since #494 is still unmerged — the full trail is folded
into the ticket's `notes:`), `pr: 495` recorded with the full evidence trail inline. CI-check
counter: 1/5. Fix-iteration counter: 0/3. Branch `pm-orchestrator/FOLLOW-546-validate` (based on
current `main`, NOT stacked on the still-unmerged #494) — opened as a new PR, not merged.

---

## SESSION 22 CLOSE-OUT (2026-07-10) — PR #491 MERGED (4cc5ba5), FOLLOW-380 DONE, RETRO-169 pending

PR #491 (`sdk-engineer/FOLLOW-380-cross-listing-hardening`) confirmed MERGED via
`gh pr view 491 --json state,mergeCommit,mergedAt` → `state: MERGED`, `mergeCommit: 4cc5ba5`,
`mergedAt: 2026-07-10T07:16:20Z`. PR #492 (the PM-validation bookkeeping) confirmed MERGED
(`57a0116`, immediately after). PR #490 (superseded dispatch-record PR) confirmed `CLOSED` (not
merged) via `gh pr view 490 --json state` — per human decision, its content already lives fully
folded into FOLLOW-380's DONE trail (no data lost). Local `main` synced (`git log --oneline -1` →
`57a0116`), clean.

**Post-merge close done on branch `pm-orchestrator/FOLLOW-380-close`** (agent-prefix, branch-first):
FOLLOW-380 flipped `READY_FOR_REVIEW` → `DONE` in `backlog/QUEUE.md` (`completed_at: 2026-07-10`,
`merged_pr: 491`, `merge_commit: 4cc5ba5`).

**FOLLOW-375 test-debt retirement (verified, not assumed):** `backlog/FOLLOW_UPS.md`'s FOLLOW-375
stub carried one open bullet — "Add SDK unit tests for the new paths (a) observer in-place mutation,
(b) refreshDirectives SoT restore/update, (c) eraseIntentState clears resolved-archetype key."
Re-checked the merged `follow-380.test.ts` describe-block names against this exact list:
`cross_ref (a) — navMutObs emits listing.viewed...` /
`cross_ref (b) + hardening (c) — SoT restore re-pins archetype + confidence...` /
`cross_ref (c) — eraseIntentState clears...` — a clean 1:1 match on all three items. Checked `[x]`
with a resolution note citing PR #491. The stub's other two bullets (platform/Rafał
production-delivery actions — versioned SDK bundle URL, `chat_intent_dimensions` prod confirmation)
are unrelated to this ticket and were left OPEN untouched.

**Not run this pass (per explicit instruction):** the retrospective. `retrospective-analyst` will be
spawned by the coordinator directly onto `pm-orchestrator/FOLLOW-380-close` to append **RETRO-169**
and any follow-up stubs, bundling RETRO + DONE-flip into one PR (matches PRs #486/#487, #489
convention). PM will validate that bundled PR once the coordinator confirms it's ready.

**This is a fresh bookkeeping PR, opened but NOT merged** — awaiting RETRO-169 content to land on
the same branch first.

---

## SESSION 22 VALIDATION (2026-07-10) — PR #491 (FOLLOW-380) validated, READY_FOR_REVIEW

**Context:** PR #490 (FOLLOW-380 dispatch record: READY→IN_PROGRESS flip + HANDOFFS.md brief) is
still UNMERGED (blocked on a merge-guard, awaiting human) — the sdk-engineer worker was launched
with the brief content relayed out-of-band by the coordinator, not via `main` state. This session's
QUEUE.md edit works from current `main` (which still shows FOLLOW-380 as `READY`, no brief) and
folds the full READY→IN_PROGRESS→READY_FOR_REVIEW trail into one ticket-block edit rather than
assuming #490 landed.

**Independently re-verified (not taken on the worker's self-report):**

- `gh pr checks 491 --watch` run to completion; `gh pr view 491 --json statusCheckRollup` →
  non-success count = **2**, both "Rule I — wired-or-dead check" (matrix-duplicated). Pulled
  `--log-failed`: 180 violations (stable vs. the ~180-181 baseline across recent PRs) — confirmed
  the NEW `ResolvedArchetype` interface is NOT among them.
- Pulled the full `Test (Node 22)` job log directly (not the PR-checks summary line): the
  `@estalara/sdk:test` step ran the ENTIRE suite fresh — **69 test files / 1520 tests, 100% pass** —
  including `follow-380.test.ts (10 tests)` and, notably, `adapt-description.test.ts (35 tests)`,
  the file the worker's self-report flagged 4 LOCAL failures on as a stale `@estalara/shared` build
  artifact. CI's fresh-build job shows it fully green, corroborating that explanation rather than
  taking it on faith.
- Pulled the `Build` job log for the SDK bundle-size gate (there is no separate "bundle-size" CI
  check — it's embedded inside `Build`): **40.43KB gzip vs the 42KB budget (ESC-028)** — passed,
  +0.57KB over the pre-ticket 39.86KB baseline.
- `gh pr view 491 --json files` → exactly 4 files: `.claude/agents/sdk-engineer/lessons.md`,
  `packages/sdk/src/__tests__/follow-380.test.ts`, `packages/sdk/src/core/session.ts`,
  `packages/sdk/src/index.ts`. Zero edits to `backlog/QUEUE.md`, `docs/MASTER_DESIGN.md`,
  `README.md`, or `CLAUDE.md`.

**Runtime-wiring verification (read the actual diff, not the self-report):**

- Bug (a) in-flight guard: `let latestRefreshId = 0` module-level; each `refreshDirectives()` call
  claims `++latestRefreshId`, checks `myRefreshId !== latestRefreshId` after its `await` and bails
  if superseded. Confirmed non-vacuous by reading the dedicated test — it resolves a stale L2 fetch
  AFTER a fresh L3 fetch and asserts the DOM reflects L3, not L2 (would fail without the guard).
- Bug (b) per-listing headline: `Map<listingId, string>` replaces the single global
  `originalHeadlineText`; capture + restore sites both keyed by listing id. Confirmed non-vacuous
  via the dedicated test (listing-2's own title shows on a non-fitting listing-2, never
  listing-1's).
- Bug (c) confidence re-pin — full chain traced: new `ResolvedArchetype { archetype, confidence }`
  interface in `session.ts`; `persistResolvedArchetype` now writes JSON `{archetype, confidence}`
  (backward-compatible with legacy bare-string entries via a documented
  `RESOLVED_ARCHETYPE_FALLBACK_CONFIDENCE = 0.85`, chosen above both gates); `readResolvedArchetype`
  returns the typed interface; `index.ts`'s SoT-restore site re-pins BOTH `archetype` AND
  `confidence` on `currentIntentState`; both `persistResolvedArchetype` call sites updated to pass
  `currentIntentState.confidence`. Independently confirmed the server gate this feeds:
  `apps/control-plane/src/app/api/adapt/route.ts:84` `CONFIDENCE_THRESHOLD = 0.6`, `:287` the gate
  check — matches the worker's comment citation exactly.
- `ResolvedArchetype` Rule I claim:
  `grep -rn "ResolvedArchetype" packages/sdk/src --include=*.ts | grep -v test` shows a genuine
  non-test producer (`readResolvedArchetype`, session.ts) AND consumer
  (`const sot: ResolvedArchetype | null = ...`, index.ts) — confirmed absent from the 180 Rule I
  violations.

**AC spot-check:** all 3 bugs fixed per the diff; quiz vs quiz-disabled stickiness doc gap closed
(new inline comment in `refreshDirectives`); ONE consolidated test file (`follow-380.test.ts`, 543
lines, 10 `it()` across 8 `describe` blocks) covering all 5 cross_ref items (a–e) + 3 new hardening
tests — confirmed via file list this is the only new test file (no duplicate/competing suite).

**Result:** FOLLOW-380 flipped `IN_PROGRESS`(folded-in)→`READY_FOR_REVIEW` in `backlog/QUEUE.md`,
`pr: 491` recorded with the full evidence trail inline. CI-check counter: 1/5. Fix-iteration
counter: 0/3. Branch `pm-orchestrator/FOLLOW-380-validate` (based on current `main`, NOT stacked on
the still-unmerged #490) — opened as a new PR, not merged.

---

## SESSION 21 CLOSE-OUT (2026-07-09) — PR #488 MERGED (8275e23), FOLLOW-470 DONE, RETRO pending

PR #488 (`architect/FOLLOW-470-snapshot1-doc-refresh`) confirmed MERGED via
`gh pr view 488 --json state,mergeCommit,mergedAt` → `state: MERGED`, `mergeCommit: 8275e23`,
`mergedAt: 2026-07-09T21:28:52Z`. Local `main` synced (`git log --oneline -1` → `8275e23`), clean.

**Post-merge close done on branch `pm-orchestrator/FOLLOW-470-close`** (agent-prefix, branch-first):
FOLLOW-470 flipped `READY_FOR_REVIEW` → `DONE` in `backlog/QUEUE.md` (`completed_at: 2026-07-09`,
`merged_pr: 488`, `merge_commit: 8275e23`). Re-appended the FOLLOW-470 _validation_ lessons.md entry
that was lost in a post-merge `git stash pop` conflict during the coordinator's `main` sync (the
coordinator reset to clean merged HEAD rather than hand-resolving conflict markers in the prose file
— correct per the guidance logged in the PRIOR lessons.md entry on this exact topic; the delegation
entry survived, only the validation entry needed restoring).

**Not run this pass (per explicit instruction):** the retrospective. `retrospective-analyst` will be
spawned by the coordinator directly onto `pm-orchestrator/FOLLOW-470-close` to append RETRO-NNN +
any follow-up stubs, bundling RETRO + DONE-flip into one PR (matches PRs #486/#487 convention). PM
will validate that bundled PR once the coordinator confirms it's ready.

**This is a fresh bookkeeping PR, opened but NOT merged** — awaiting the retrospective content to
land on the same branch first.

---

## SESSION 21 VALIDATION (2026-07-09) — PR #488 (FOLLOW-470) validated, READY_FOR_REVIEW

**Independently re-verified (not taken on the worker's word):**
`gh pr view 488 --json statusCheckRollup` → non-success count = 2, both "Rule I — wired-or-dead
check" (matrix- duplicated same check). Pulled `--log-failed`: 181 violations, all pre-existing
symbols in `apps/control-plane/src/lib/*` and `src/app/*` — confirmed pre-existing (not introduced
by this diff) both by count (181, matches the standing baseline cited across PR #486/session-20
validation) and by content (PR #488's file list, independently pulled via `gh pr view --json files`,
is 100% docs: `.claude/agents/pm-orchestrator/lessons.md`, `CLAUDE.md`, `README.md`,
`backlog/FOLLOW_UPS.md`, `backlog/HANDOFFS.md`, `backlog/QUEUE.md`, `backlog/STATUS.md`,
`docs/MASTER_DESIGN.md` — zero `.ts`/`.py`/`.sql`). Every other real gate (Format, Typecheck, Lint,
all Node/Python test suites, Build, Build (control-plane), Vercel, Rule H, Rule J, Redis shadow
round-trip, ClickHouse migrations smoke, Cross-language event contract, Gitleaks, etc.) green.

**AC spot-checks (independent, not self-report):**

- §Snapshot.1 rows: read the actual diff hunk for docs/MASTER_DESIGN.md; confirmed 9 rows corrected
  (A.1, B.1, B.2, C, D, E.1–E.3, E.4, E.7, H) each with grep-citable file/symbol evidence inline.
- Rule count 8→27: independently re-derived via
  `grep -oE "Rule [A-Z]{1,2}" CONVENTIONS_PATCH.md | sort -u` in CONVENTIONS_PATCH.md → 26 lettered
  rules A–Z + Rule AA = **27**. Matches the PR's claim exactly.
- FOLLOW-380 promotion: confirmed `id: FOLLOW-380` now exists as a real ticket block in
  `backlog/QUEUE.md` (status READY, agent sdk-engineer, depends_on []), AND its
  `backlog/FOLLOW_UPS.md` stub confirmed flipped `promoted_to_queue: true` (was `false`).
- README: confirmed "Sprint 0"→"Sprint 22b" correction in the diff.
- CLAUDE.md: confirmed Tier 1/2/3 language actually edited (historical callout + heading + budget
  line corrected <40KB→<42KB) — note this diverges from the architect's stated PLAN (flag-only, not
  edit); the top-level orchestrator executed the edit directly on the architect's behalf since the
  architect had no shell tool. Recorded as a correction on the FOLLOW-470 ticket block rather than
  silently absorbed, per the coordinator's explicit ask.

**Deferred scope filed as follow-up, not silently dropped:** FOLLOW-470 explicitly left
§Snapshot.2/.3/.5 narrative refresh and §B.1's section-body Tier-prose rename out of scope (flagged
inline in the PR). Filed **FOLLOW-543** (P3, architect, `backlog/FOLLOW_UPS.md`,
`promoted_to_queue: false`) — does not block FOLLOW-471 (the epic gate only cites §Snapshot.1).

**Result:** FOLLOW-470 flipped `IN_PROGRESS` → `READY_FOR_REVIEW` in `backlog/QUEUE.md`, `pr: 488`
recorded with the full CI evidence trail inline. CI-check counter for FOLLOW-470: 1/5. Fix-iteration
counter: 0/3. Not merged — human review only.

---

## SESSION 21 (2026-07-09) — queue-hygiene fix (FOLLOW-473 DONE flip); FOLLOW-470 delegated to architect (Opus)

**On entry:** `main` tip `a4a2224` (#487). 0 open PRs. 3 standing `## OPEN` escalations (ESC-020,
ESC-028, ESC-034) re-confirmed non-blocking, unchanged.

**Queue-hygiene fix:** FOLLOW-473 was stuck at `status: READY_FOR_REVIEW` despite PR #475 being
confirmed MERGED 2026-07-08T19:03:53Z (`511fbbe`) and RETRO-164 already filed (commit `c5be497`).
Corrected to `DONE`, `completed_at` set. No re-retro needed.

**Delegated:** FOLLOW-470 (P2, Master_Design §Snapshot.1 + README + CLAUDE.md staleness refresh +
promote orphaned FOLLOW-380) — reassigned from its own `agent: pm-orchestrator` field to
**architect** (closest decision-table fit for cross-repo doc/SoT reconciliation; PM does not author
the canonical architecture doc itself). **Model: Opus** — whole-repo verification/reconciliation
task, not single-domain implementation. Full brief in `backlog/HANDOFFS.md` ("PM orchestrator
(session 21) → architect, FOLLOW-470"). QUEUE.md flipped `IN_PROGRESS`, branch
`architect/FOLLOW-470-snapshot1-doc-refresh`.

**Why this ticket over other READY candidates:** FOLLOW-458 (READY-labeled but
`depends_on: [FOLLOW-449]` which is only CODE_COMPLETE_OPERATOR_PENDING, not DONE — effectively
blocked despite its own stale label, flagged for a follow-on QUEUE.md correction) was skipped;
FOLLOW- 467/468/469/472/474 are all P3. FOLLOW-470 is the highest-priority (P2) truly-unblocked
candidate and is itself in FOLLOW-471's (the Sprint-22b epic-closing gate) `depends_on` list.

**1 ticket IN_PROGRESS** (FOLLOW-470), 0 PRs opened this turn (worker not yet launched — that
happens in a separate subagent-invocation turn; this session's tool surface is bookkeeping-only).
CI-check counter: 0/5. Fix-iterations: 0/3.

**NEXT:** launch `architect` subagent on FOLLOW-470 per the HANDOFFS.md brief, then run full PM
validation (step 5; docs-only diff so 5c/5d are N/A, but AC verification + CI still apply).

---

## SESSION 20 (2026-07-09) — validated PR #486, flipped FOLLOW-535/FOLLOW-463 DONE, no new dispatch

**Scope:** two bookkeeping tasks only, per explicit instruction — validate PR #486, reconcile
QUEUE.md for the completed CH operator action (migration 0020 TTL + FOLLOW-463 grant, both applied
and CLI-verified in prod 2026-07-09). No workers spawned, no retro re-run (RETRO-167 already filed,
bundled into PR #486 by the data-engineer session rather than a separate `retrospective-analyst`
spawn).

**On entry:** `main` tip was `41eb890` through PR #484; pulling fast-forwarded to `4895d6b`,
discovering PR #485 (session-19 pause-banner save) AND PR #486 (RETRO-167 + prod attestation) had
both already merged. FOLLOW-535 and FOLLOW-463 QUEUE.md entries still showed
`CODE_COMPLETE_OPERATOR_PENDING` (PR #486 deliberately left the QUEUE.md status flip to the PM, per
its own PR body) — this session closes that gap.

**PR #486 validation:**

- `gh pr checks 486 --watch` → completion. `gh pr view --json statusCheckRollup` non-success count:
  **2**, both `Rule I — wired-or-dead check` (pre-existing baseline, 181 violations, all
  pre-existing SDK/shared symbols — confirmed via `--log-failed` none are new; confirmed via
  `gh pr view --json files` the PR is 100% docs, 0 `.ts` files touched). All other 45+ real gates
  SUCCESS (Lint, Typecheck, Build ×2, Test Node 22, SDK E2E, ClickHouse migrations smoke,
  Cross-language event contract, Gitleaks, Format check, Doppler verify, Rule H/J, Modal singleton
  guard, Fire-and-forget sink guard, K.3.6 live smoke, Redis shadow round-trip, Archetype gates,
  Auto-Detection corpus gate, Tracer query-builders, Vercel deploy).
- Posted PM-validated comment on PR #486 with the evidence above. Human merged it independently
  while this validation was in flight (confirmed via `gh pr view 486 --json state` = MERGED).
- CI-check counter: 1/5. Fix-iteration counter: 0/3 (zero fixes needed — docs-only PR, CI green on
  first watch).

**QUEUE.md reconciliation:**

- **FOLLOW-535**: `CODE_COMPLETE_OPERATOR_PENDING -> DONE`, `completed_at: 2026-07-09`. Evidence: PR
  #486's verbatim `SHOW CREATE TABLE description_generations` shows the TTL expression live in prod.
  AC checkboxes flipped `[x]`.
- **FOLLOW-463**: `CODE_COMPLETE_OPERATOR_PENDING -> DONE`, `completed_at: 2026-07-09`. Evidence: PR
  #486's verbatim `SHOW GRANTS` (as `ingest_worker`) shows the INSERT grant live in prod, correct
  table name (typo `descriptions_generations` REVOKEd + re-GRANTed correctly, 0 occurrences of the
  typo remain). AC checkboxes flipped `[x]`. Its go-live escalation is RESOLVED in
  `backlog/ESCALATIONS.md`.
- Noted **FOLLOW-536** (write-only reader gap — `description_generations` has a producer
  (FOLLOW-463) and now a TTL (FOLLOW-535) but zero in-repo consumer) as the only remaining open hop
  for that table. It's an unpromoted stub in `backlog/FOLLOW_UPS.md` (`promoted_to_queue: false`),
  not yet a QUEUE ticket.
- Rewrote the START HERE banner (top of `backlog/QUEUE.md`) to reflect the above and recommend
  **FOLLOW-532** (P2, backend+qa, no operator dependency, no `depends_on`) as the next
  worker-delegable pick.

**Escalations:** re-confirmed the 3 standing `## OPEN` entries (ESC-020, ESC-028, ESC-034)
unchanged, non-blocking, established multi-session precedent — none gate this session's
bookkeeping-only scope. No P0/P1 before-go-live FOLLOW is open; not writing "sprint closed" this
session (Sprint 22b remains open, FOLLOW-471's re-audit gate still BACKLOG pending its full
`depends_on` list).

**Hand-off:** 0 open PRs (PR #486 merged during this session). 0 tickets IN_PROGRESS dispatched by
PM this session. CI-check counter: 1/5. Fix-iterations: 0/3.

---

## SESSION 19 (2026-07-09) — validated PR #485 (session-18 pause banner); RETRO-167 next

**On entry:** `main` tip `41eb890` (unchanged since session 18). 1 open PR (#485, docs-only banner
save). Re-confirmed 4 standing `## OPEN` escalations: the new FOLLOW-463 CH-grant escalation plus
ESC-020/028/034 — all operator/infra action items (ClickHouse grant, DNS/deploy, GH Actions secrets,
Modal go-live), none an unresolved architectural/pricing/priority decision. Continued the loop per
established multi-session precedent rather than halting on these standing, already-surfaced,
non-decision escalations.

**Validated PR #485:** `gh pr checks 485` → 55/57 real gates SUCCESS; only "Rule I — wired-or-dead
check" (2 matrix legs) red — the standing pre-existing baseline, unrelated (docs-only single-file
diff). Non-success count for all REAL gates: 0. Step 5c N/A (no new symbol/event/column in a prose
diff). Posted PM-validated comment. Not merged (human-only).

**Did not spawn a new ticket this session** — per the session-18 banner's explicit resume order,
RETRO-167 (FOLLOW-535) must run before picking the next ticket, and this session's tool access is
bookkeeping/validation only (no direct subagent-spawn tool available) — ends with a NEXT: pointer
for the harness/human to invoke `retrospective-analyst` for FOLLOW-535. Teed up **FOLLOW-532** (P2,
backend-engineer + qa-engineer, no operator dependency) as the strongest next-ticket candidate after
the retro, still only a stub (`promoted_to_queue: false`) pending PM promotion.

**Hand-off:** 1 open PR (#485, validated, human-merge pending). 4 standing OPEN escalations
unchanged, non-blocking. 0 tickets IN_PROGRESS (only stale `TICKET-PILOT-001`). CI-check counter:
1/5. Fix-iterations: 0/3.

---

## SESSION 17 (2026-07-08) — FOLLOW-473 elevated P2→P1 + dispatched (Opus) to backend-engineer

**On entry:** confirmed via `git log`/`gh pr list` that PR #471 (RETRO-163 docs) plus two further
docs PRs (#472, #473 "mandatory model-fit rule") merged since the session-16 banner; `main` tip
`9210400`; 0 open PRs. 3 standing `## OPEN` escalations (ESC-020/ESC-028/ESC-034) re-confirmed
unchanged and non-blocking (established multi-session precedent).

**Ticket selection:** read the full Sprint 22b tail. READY+unblocked worker-delegable candidates:
FOLLOW-461 (P2 sdk-engineer), FOLLOW-463 (P2 data-engineer), FOLLOW-467/468/469/474 (P3),
FOLLOW-472/473 (backend-engineer). FOLLOW-458 READY but blocked on FOLLOW-449
(CODE_COMPLETE_OPERATOR_PENDING, not DONE). FOLLOW-471 (epic gate) BACKLOG, blocked on ~7 open
tickets.

**Found + actioned an un-promoted stub, FOLLOW-510** (`backlog/FOLLOW_UPS.md`, source RETRO-158,
`recommended_agent: pm-orchestrator`): recommends reassessing FOLLOW-473 P2→P1 (GET /api/adapt + GET
/api/adapt/description are the two highest-blast-radius fail-open routes in the repo — hit on every
live SDK pageview, KNOWN-live-fail-open today) and requires an ADAPT_API_KEY/OPS_TENANT_ID
provisioning preflight paired with the fail-closed flip so it can't itself cause an SDK-wide outage.
This is ordinary PM priority-triage (not an architectural/pricing/compliance call) — **elevated
FOLLOW-473 P2→P1**, ran the preflight myself: `vercel env ls production` against
`adaptive-listings-control-plane` (read-only) shows `ADAPT_API_KEY` present (Production+Preview),
`OPS_TENANT_ID` absent. Conclusion: real tenant SDK traffic (sends its own per-tenant
`config.apiKey`) is unaffected; the ops-bypass branch will hit the same "OPS_TENANT_ID must be set
alongside ADAPT_API_KEY" 500 that `feedback/route.ts` already returns in prod today (FOLLOW-450,
live) — no new failure mode. Folded into FOLLOW-473's QUEUE.md notes; marked FOLLOW-510 actioned
(not a separate queue ticket).

**Verified the fix pattern directly in the repo** before delegating: both GET handlers
(`apps/control-plane/src/app/api/adapt/route.ts:703`,
`apps/control-plane/src/app/api/adapt/description/route.ts:183`) share the identical
`if (adaptApiKey && token !== adaptApiKey)` fail-open shape; `feedback/route.ts` already implements
the target two-step pattern (`resolveApiKey()` primary + `ADAPT_API_KEY`/`OPS_TENANT_ID`-scoped
`secretEquals()` ops-bypass); the SDK already sends real per-tenant `config.apiKey` bearers on these
GET calls (`packages/sdk/src/core/adapt-description.ts:231`, `adapt.ts:169/267/800`).

**Dispatched FOLLOW-473 to backend-engineer**, table row "ingest worker, control-plane,
decision-api, Postgres/RLS, auth, onboarding HTTP, billing, webhooks -> backend-engineer". Flipped
`READY → IN_PROGRESS`, branch `backend-engineer/FOLLOW-473-adapt-get-auth-hardening`. **Model:
Opus** — live-production auth change on the highest-blast-radius routes, prior outage-risk flag,
cross-file symmetric fix (Rule S); exceeds routine in-scope implementation per the mandatory
model-fit rule. Full delegation brief in `backlog/HANDOFFS.md` ("PM orchestrator (session 17) →
backend-engineer, FOLLOW-473").

**Hand-off:** 0 open PRs. 3 standing OPEN escalations unchanged, non-blocking. 1 real ticket
IN_PROGRESS (FOLLOW-473; `TICKET-PILOT-001` stale record is the other) — under the 3-ticket cap.
CI-check counter: 0/5 (no PR opened yet this session). Fix-iterations: 0/3.

---

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
| FOLLOW-473     | 1/5            | 0/3                 | DONE — PR #475 merged 2026-07-08T19:03:53Z (511fbbe). RETRO-164 DONE. (QUEUE.md status flip corrected 2026-07-09, session 21 — was stuck at READY_FOR_REVIEW.) |
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
