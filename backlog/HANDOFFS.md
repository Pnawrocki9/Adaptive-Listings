# Handoffs

When one agent's ticket produces output another agent needs, the producing agent appends a handoff
note here. The PM reads this file before delegating downstream tickets.

## Delegation brief — FOLLOW-557 (backend-engineer) — DSR erase: delete the chat-intent shadow Redis key namespace

**From:** pm-orchestrator (session 27 cont'd) **To:** backend-engineer **Date:** 2026-07-14

**Ticket:** `backlog/QUEUE.md` id `FOLLOW-557` (P2, Sprint 23 Wave 2, source: audit finding A3-F-05,
2026-07-11 audit). **Branch:** `backend-engineer/FOLLOW-557-dsr-erase-shadow-redis` (branch-first —
create it before any Edit, per repo convention; never commit to `main`).

**Delegation-table row used:** "ingest worker, control-plane, decision-api, Postgres/RLS, auth,
onboarding HTTP, billing, webhooks" -> `backend-engineer` (the fix touches
`apps/control-plane/src/app/api/dsr/erase/route.ts`, a control-plane HTTP route).

**Model: Sonnet** — routine implementation inside a well-defined ticket scope (add one Redis
SCAN/DEL pattern + one cross-runtime fixture test); no open design question. Model-fit table row:
"routine implementation inside a well-defined ticket scope ... tests" -> Sonnet.

**Context (read first):**

- `docs/MASTER_DESIGN.md` §Snapshot.1 (Implementation Status Snapshot, line 329) — read before any
  non-trivial task per Operating Principle 1. §H covers DSR/compliance status; note FOLLOW-455
  (DONE, PR #423) is the ticket that most recently touched DSR erase coverage — mirror its pattern,
  don't re-derive from scratch.
- `CONVENTIONS_PATCH.md` Rule Z (line 1388) applies directly: this is a cross-runtime consumer (TS
  erase route reading a Redis key namespace whose canonical format is defined in Python
  `apps/intent-engine/src/redis_writer.py`). A mock/fixture hand-authored in the TS side's assumed
  shape is FORBIDDEN as sole evidence — the AC explicitly requires a fixture checked against the
  Python writer's literal key format, not just a TS-side assertion.
- No prior HANDOFFS note exists for this ticket; this is the full brief.

**Verified starting facts (do not re-derive, but do verify against current HEAD before editing):**

- `apps/control-plane/src/app/api/dsr/erase/route.ts:84-85` — the existing erase logic:
  `// SCAN for session:{sessionId}:* keys then DEL them`,
  `matchPattern = \`session:${sessionId}:\*\``.
- `apps/intent-engine/src/redis_writer.py:37` — the shadow-key format function returns
  `f"shadow:{tenant_id}:{session_id}:chat_intent"` (comment at line 5: "NEVER the main intent
  namespace").
- These two do not match — `session:{sessionId}:*` never matches `shadow:{tenant}:{session}:*` — so
  erase silently misses the shadow chat-intent key. Currently non-live in prod (stream-consumer
  undeployed per Q2/FOLLOW-458 shadow-only ruling) but becomes live the day FOLLOW-458 deploys —
  this is a pre-emptive fix, not a live-incident fix.

**AC (from the ticket, verbatim):**

- [ ] Erase deletes `shadow:{tenant}:{session}:chat_intent`; test with a seeded key.
- [ ] Key-format fixture shared/checked against the Python writer's literal (Rule Z).

**Scope discipline (per CLAUDE.md Agent coding standards §3):** touch only the erase route's
Redis-deletion logic + its test. Do not refactor unrelated erase-route code (e.g. the Postgres/
ClickHouse legs of the same route) even if you notice something odd — mention it, don't fix it
unless it's your own newly-introduced orphan.

**On completion:** open a PR from the branch above, run local
`pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, and report back. Do not
mark your own ticket DONE — PM validates (CI green + runtime wiring + AC) before READY_FOR_REVIEW.

---

## Delegation brief — FOLLOW-558 (compliance-engineer) — DSR access + portability must disclose quiz_completions and intent_sessions

**From:** pm-orchestrator (session 27 cont'd) **To:** compliance-engineer **Date:** 2026-07-14

**Ticket:** `backlog/QUEUE.md` id `FOLLOW-558` (P2, Sprint 23 Wave 2, source: audit finding A3-F-06,
2026-07-11 audit). **Branch:** `compliance-engineer/FOLLOW-558-dsr-access-portability-disclosure`
(branch-first — create it before any Edit, per repo convention; never commit to `main`).

**Delegation-table row used:** "DPIA/ROPA/consent/DSR rules/fair-housing/AI-Act docs" ->
`compliance-engineer` (Art. 15/20 DSR-disclosure completeness — also touches the two DSR HTTP
routes' query logic, but the finding is a compliance-completeness gap, not a plumbing bug).

**Model: Sonnet** — routine implementation inside a well-defined ticket scope: mirror an
already-established table set (FOLLOW-455's erase coverage) into two read routes, plus a parity
test. No open design/legal-interpretation question. Model-fit table row: "routine implementation
inside a well-defined ticket scope ... docs/backlog bookkeeping" -> Sonnet, not the Opus
ambiguous-legal-interpretation row (the DPIA cross-check is mechanical, not novel legal reasoning).

**Context (read first):**

- `docs/MASTER_DESIGN.md` §Snapshot.1 (line 329) and §H (Compliance & Privacy — Multi-Jurisdiction,
  line 2743) — read before any non-trivial task per Operating Principle 1.
- `CONVENTIONS_PATCH.md` Rule N (line 712) applies directly: if the DPIA or any compliance doc
  enumerates the specific data stores disclosed in a DSR access/portability response, that
  enumeration MUST be updated in the same PR to match the new code — a doc-only or code-only fix
  that leaves the other out of sync is exactly the ABSENCE/inaccurate-disclosure failure mode Rule N
  exists to prevent.
- `FOLLOW-455` (DONE, PR #423, `backlog/QUEUE.md` line ~9961) is the direct precedent: it fixed the
  erasure (Art. 17) table-set gap for `quiz_completions` + `intent_sessions`. This ticket closes the
  matching access/portability (Art. 15/20) gap — same table set, different routes. Read #423's diff
  for the erasure table list before writing the access/portability fix so the sets are provably
  identical, not independently re-derived (that's also the AC's explicit ask: a parity test).

**Files to start from (verify against current HEAD, do not assume unchanged):**

- `apps/control-plane/src/app/api/dsr/access/route.ts` (per the ticket source, currently reads only
  `session_embeddings`, `consent_records`, `conversion_labels` around lines 27-38).
- `apps/control-plane/src/app/api/dsr/portability/route.ts` (same gap, per ticket source).
- `apps/control-plane/src/app/api/dsr/erase/route.ts` (FOLLOW-455's reference table set — the erase
  side already covers `quiz_completions` + `intent_sessions`).

**AC (from the ticket, verbatim):**

- [ ] Access + portability payloads include `quiz_completions` + `intent_sessions` rows for the
      verified (tenant, session/email) scope.
- [ ] Parity test: the erase table-set and the access table-set are asserted equal (minus documented
      exceptions) so the next new store cannot drift them apart again.
- [ ] (Rule N, added by this brief, not in the original stub — verify before closing) If the DPIA
      (`docs/MASTER_DESIGN.md` §H or a dedicated DPIA doc, check which is canonical) enumerates the
      stores disclosed in a DSR access/portability response, update that enumeration in the same PR.
      If no such doc-level enumeration exists, state that explicitly in the PR body so Rule N is
      provably satisfied by absence-of-claim, not silently skipped.

**Scope discipline (per CLAUDE.md Agent coding standards §3):** touch only the access/portability
routes' table-read logic + the new parity test + the DPIA enumeration if one exists. Do not refactor
unrelated DSR logic.

**On completion:** open a PR from the branch above, run local
`pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, and report back. Do not
mark your own ticket DONE — PM validates (CI green + runtime wiring + AC) before READY_FOR_REVIEW.

---

## Delegation brief — FOLLOW-551 (architect) — DRAFT-ONLY — codify the architect-has-no-Bash routing gap

**From:** pm-orchestrator (session 25 cont'd) **To:** architect **Date:** 2026-07-11

**⚠️ EXECUTION MODE: DRAFT-ONLY. Read this section first, it overrides the normal worker workflow.**
You do **NOT** create a branch. You do **NOT** call `Edit` or `Write` on any file in this repo. You
do **NOT** attempt `git` of any kind — you have no Bash tool, and attempting to fake it (e.g.
writing directly to a file on `main`) would strand the change on `main`, exactly the FOLLOW-448/
RETRO-146 failure mode this very ticket exists to prevent, and exactly what you correctly refused to
do on FOLLOW-550. Instead: **produce the complete, ready-to-apply content in your final report** —
the exact markdown to add, the exact file(s) and line/insertion-point citations, and the rationale
prose, written so a Bash-capable party (the coordinator) can copy it in verbatim without having to
make any editorial judgment calls of their own. If you use `Read`/`Glob`/`Grep` to verify line
numbers or existing content, cite what you found (line numbers, exact surrounding text) so the
applier can verify placement before committing — do not describe "roughly where" something goes.

**Model: Sonnet** — routine workflow-doc codification with a fully-specified AC and two named ≥2×
precedent instances already gathered (no open design question to resolve from scratch). Model-fit
table row: "routine implementation inside a well-defined ticket scope ... docs/backlog bookkeeping"
-> Sonnet, not the ambiguous-design Opus row. The one open judgment call (architect.md vs
AGENT_WORKFLOW.md placement, see AC below) is bounded and doesn't need heavier reasoning.

**Table row used:** "a contract between two modules, a new dependency, an ADR" -> architect (this is
a process/workflow codification about architect's OWN routing, human-approved — same category as
FOLLOW-550).

**Context to read first:** `docs/MASTER_DESIGN.md` §Snapshot.1; the current `CONVENTIONS_PATCH.md`
(skim the Rule-promotion-discipline pattern — Rules Q/V/X/AA/AB's provenance footnotes are the
canonical examples of "2 banked prior sightings + a 3rd independent sighting triggers promotion"
that you must NOT bypass here); `docs/AGENT_WORKFLOW.md` in full (you're adding to it);
`backlog/RETROSPECTIVES.md` RETRO-168 (FOLLOW-470, the first occurrence) and RETRO-174 §5a
(FOLLOW-550, the second occurrence, which cross-references RETRO-168);
`.claude/agents/ architect.md` (your own definition file — see the concrete bug flagged below); the
ticket source `backlog/FOLLOW_UPS.md` FOLLOW-551 and `backlog/QUEUE.md` FOLLOW-551's `notes:`
(already contains the precise Rule-AB-discipline count you must not contradict).

**What happened (verified, not guessed):** dispatching FOLLOW-550 (a `docs(workflow)` codification
ticket) to you surfaced that your tool manifest —
`Read, Write, Edit, Glob, Grep, WebSearch, WebFetch` — has no `Bash`. You correctly refused to
`Edit` `docs/AGENT_WORKFLOW.md` directly (no `git` means no branch/commit, which would have stranded
the change on `main`) and instead drafted the content for the coordinator to apply. This was NOT a
one-off: `backlog/RETROSPECTIVES.md` RETRO-174 §5a found the SAME workaround already fired once
before, on FOLLOW-470 (RETRO-168, `docs/MASTER_DESIGN.md` Changelog v4.3 — "the edit was applied by
the top-level orchestrator on the architect's behalf [the architect subagent has no shell tool]").
**Human decision (2026-07-11):** resolve via option (2) — formalize draft-then-apply as the
standing, documented resolution (not option 1, routing every git-touching ticket away from architect
entirely; not option 3, giving architect a Bash tool).

**A concrete bug in your own agent definition, found while preparing this brief — fix it as part of
this ticket:** `.claude/agents/architect.md`'s "First action on any ticket (mandatory)" section
(lines 20-26) currently reads:
`"Before touching a single file: git checkout -b <agent>/<ticket-id>-<kebab-summary>. This is the FIRST action..."`
— **this instructs you to run a `git` command you have no tool to execute.** Every ticket you're
assigned that writes a file (ADRs, interface specs, Master Design edits, workflow-doc codifications)
needs this fixed or it will keep silently producing the FOLLOW-550 dispatch-then-discover
round-trip. Draft the corrected text for this section as part of your report (see AC below).

**Required content (per the ticket AC in `backlog/QUEUE.md` FOLLOW-551 — follow it precisely, the
full AC list with the exact promotion-discipline count is already written there; do not re-derive or
contradict it):**

1. **Primary home: `docs/AGENT_WORKFLOW.md`**, near "The 9 agents" table (currently lines 14-28)
   and/or the "Model-fit decision" section (currently lines 30-48) — mirror the structure/citation
   style of the existing "Bookkeeping-PR sequencing" section (currently line 163) and "Branch-first
   worker discipline" section (currently line 108). States: your tool manifest has no Bash; any
   ticket whose AC requires git/PR mechanics and is assigned to architect MUST use draft-then-apply
   (you produce content + insertion point + rationale in your final report; a Bash-capable party
   applies it verbatim) — UNLESS the delegator reassigns the ticket to a Bash-capable agent from the
   start (also acceptable).
2. **Cite BOTH precedents by number:** FOLLOW-470/RETRO-168 and FOLLOW-550/RETRO-174, stating this
   is a ≥2× recurrence.
3. **State the exact Rule-AB-discipline count** (already written for you in the ticket's `notes:` in
   `backlog/QUEUE.md` — copy/adapt it, don't redo the analysis): this pattern has exactly 2 banked
   prior numbered-retro sightings (RETRO-168, RETRO-174) and no 3rd sighting yet; FOLLOW-551 itself
   is the FIX, not a fresh occurrence, so implementing it does not satisfy the promotion threshold.
   This is workflow guidance, explicitly NOT a `CONVENTIONS_PATCH.md` Rule.
4. **Fix `.claude/agents/architect.md`'s "First action on any ticket" section** (see the concrete
   bug above) — draft the corrected text. Your own judgment call, explicitly asked (state your
   answer + reasoning in your report either way): should this section instead say "you have no Bash
   — see docs/AGENT_WORKFLOW.md's draft-then-apply guidance for any git-touching ticket," or is
   there a class of architect ticket that doesn't need git at all (e.g., pure design review/
   feedback with no file written) where the original branch-first instruction still correctly
   applies? Draft precisely, don't hand-wave.
5. **Note for CLAUDE.md/AGENT_WORKFLOW.md's PM delegation-table guidance** to reflect the resolution
   so a future PM session doesn't repeat the round-trip — draft the exact sentence(s) to add, and
   where.

**CRITICAL — do NOT add a `CONVENTIONS_PATCH.md` Rule as part of this ticket** (see point 3 above).
If you believe this genuinely warrants an immediate Rule despite the count, that is an
ESCALATION/ADR question for the human — describe it in your report as a recommendation, do not draft
the Rule text yourself as part of this deliverable.

**Scope guardrails (Rule 3, surgical changes):** Content only — you are not touching code. Don't
rewrite unrelated sections of `docs/AGENT_WORKFLOW.md` or `.claude/agents/architect.md`.

**What happens next:** report back with (a) the exact `docs/AGENT_WORKFLOW.md` addition + insertion
point, (b) the exact `.claude/agents/architect.md` fix + insertion point, (c) your judgment call on
point 4 above with reasoning, (d) the exact CLAUDE.md/AGENT_WORKFLOW.md delegation-guidance
sentence(s) + where. The coordinator applies all of it on branch `pm-orchestrator/FOLLOW-551-done`
(or similar), runs prettier, commits, pushes, and the PM validates

- opens the promotion PR. You do not open a PR.

---

## Retro delegation brief — FOLLOW-550 (retrospective-analyst)

**From:** pm-orchestrator (session 25 cont'd, post #508/#509 close-out) **To:**
retrospective-analyst (to be spawned by the coordinator — pm-orchestrator has no subagent-spawn
capability in this tool surface) **Date:** 2026-07-10 **Branch:** `pm-orchestrator/FOLLOW-550-done`
(already created off `main` at `66f8e76`, carries the DONE-flip; append RETRO-174 content on this
SAME branch — do NOT open a new PR, the PM will open ONE bundled PR after this lands, dogfooding
rule (d) one more time). **Model: Opus** — matches `retrospective-analyst`'s own agent-file default
(`model: opus`).

**What merged:** PR #509 (`architect/FOLLOW-550-bookkeeping-pr-sequencing`, commit `66f8e76`) — a
new "Bookkeeping-PR sequencing (workflow guidance — RETRO-173 / FOLLOW-550)" section in
`docs/AGENT_WORKFLOW.md`, stating 4 rules: (a) redundant bookkeeping PRs always closed-superseded,
never merged; (b) never two `QUEUE.md`-touching PRs in flight; (c) validation/DONE PRs cut from
`main` after the code PR merges; (d) fold validation into the DONE+RETRO bundle. Explicitly NOT a
`CONVENTIONS_PATCH.md` Rule (Rule AB threshold unmet). Also PR #508
(`pm-orchestrator/FOLLOW-550-dispatch`, commit `c02b96b`) — the dispatch-record + this session's own
PM-validation of #509, folded into #508 as a second commit rather than opened as a separate PR.

**Context to read first:** `docs/MASTER_DESIGN.md` §Snapshot.1; `docs/AGENT_WORKFLOW.md`'s new
"Bookkeeping-PR sequencing" section (the artifact itself); `backlog/RETROSPECTIVES.md` RETRO-173
(the direct source); `backlog/FOLLOW_UPS.md` FOLLOW-551 (the architect-no-Bash routing-gap stub
filed this session); `.claude/agents/architect.md` and the other 8 agent definition files' tool
manifests (needed for angle (b) below).

**Three specific angles the coordinator asked to be flagged — investigate each, don't just
restate:**

**(a) Did FOLLOW-550's own dogfooding actually hold, or did sprawl leak back in?** Trace the ACTUAL
PR count and shape for FOLLOW-550 end-to-end: #508 (promotion, later extended in-place with
validation — 2 commits, 1 PR) + #509 (content, 1 PR) = 2 PRs total, the SAME tight shape as
FOLLOW-532's #502+#503. Verify this claim independently (don't take the ticket notes' self-report):
`gh pr list --search "FOLLOW-550 in:title"` or equivalent, confirm exactly 2 PRs exist for this
ticket (not counting this eventual DONE+RETRO PR itself, which will be a 3rd — is a 3rd PR here
actually consistent with rule (d), or does rule (d) itself imply FOLLOW-550 should have had
validation

- DONE + RETRO all in ONE PR with the ORIGINAL promotion, i.e. was even 2 PRs already one more than
  the theoretical minimum? Adjudicate honestly — rule (d) says "fold validation into the DONE+RETRO
  bundle," which is about the VALIDATION/DONE/RETRO trio, not about merging the ORIGINAL dispatch PR
  into that same bundle too; confirm your reading of the rule's own scope before grading FOLLOW-550
  against it).

**(b) Is FOLLOW-551 correctly scoped? Are there OTHER agents with a similar tool/role mismatch?**
Read `backlog/FOLLOW_UPS.md` FOLLOW-551 in full. Then independently check EVERY agent's tool
manifest in `.claude/agents/*.md` frontmatter against whether their typical ticket ACs require git
mechanics (commit/push/PR). Architect (Read/Write/Edit/Glob/Grep/WebSearch/WebFetch, no Bash) is the
confirmed instance. Are there other DESIGN/REVIEW-shaped agents (vs. IMPLEMENTATION-shaped agents)
in this repo's 9-agent roster with the same gap? If you find another, name it concretely in your
findings (don't just say "check for more" — either confirm none exist, with the grep/read evidence,
or name the specific agent + ticket-shape risk). Judge whether FOLLOW-551's proposed options (route
away from architect / formalize draft-then-apply / give architect Bash) are complete or missing an
option a 2nd instance would reveal.

**(c) Confirm the Rule AB ARMED trigger is NOT accidentally tripped.** RETRO-173 held the
bookkeeping-PR-sequencing pattern at count 1 (numbered-retro finding), explicitly ARMED for a 2nd
numbered-retro SIGHTING of the underlying pattern (a NEW instance of "merged-not-closed bookkeeping
PR → downstream conflict," not a re-statement of the same one). FOLLOW-550 CODIFIED the guidance —
it did not observe the pattern recurring. Explicitly confirm in RETRO-174 that codifying a workflow
doc section is not itself the "2nd sighting" RETRO-173 pre-authorized, and that the count remains 1
unless THIS retro (RETRO-174) independently observes a NEW instance of the pattern in FOLLOW-550's
own execution (see angle (a) — if you find sprawl DID leak back in somewhere, that could genuinely
be the 2nd sighting; be precise about which finding, if any, triggers promotion).

**Standard retro deliverables per CLAUDE.md's per-ticket retrospective loop:** read the merged PR
#509 diff (single file, `docs/AGENT_WORKFLOW.md`) and PR #508's diff, map any changed symbols (none
— this is a docs-only ticket, so "map to consumers" means: confirm no other doc/rule
cross-references the new section incorrectly), check the last 5 retro entries (RETRO-169–173) for
repeating patterns, check adjacent QUEUE.md tickets (FOLLOW-551, FOLLOW-543, FOLLOW-533/534) for
cascading assumptions, append a structured RETRO-174 entry to `backlog/RETROSPECTIVES.md`, generate
FOLLOW_UPS stubs for any gap found, and promote a finding to a permanent `CONVENTIONS_PATCH.md` Rule
ONLY if the same pattern appeared in ≥2 PRIOR numbered retros (per angle (c) above, this threshold
is almost certainly still unmet — verify, don't assume).

---

## Delegation brief — FOLLOW-550 (architect) — codify bookkeeping-PR sequencing discipline

**From:** pm-orchestrator (session 25 cont'd) **To:** architect **Date:** 2026-07-10 **Branch:**
`architect/FOLLOW-550-bookkeeping-pr-sequencing` (create as your FIRST action, off `main` at
`e0a11b3` or later — branch-first, never commit to `main`). You can start immediately off `main`;
you don't need to wait for the QUEUE.md promotion bookkeeping PR to merge.

**Model: Sonnet** — this is cross-cutting PROCESS/convention codification (a workflow-doc
subsection + rationale prose, no code, and the retro already did the hard analysis and left
ready-made Rule text — see below), which fits the model-fit table's "routine implementation inside a
well-defined ticket scope ... docs/backlog bookkeeping" row better than the "ambiguous acceptance
criteria / non-trivial design" Opus row. Escalate yourself to a heavier pass only if, while
drafting, the CONVENTIONS_PATCH-vs-AGENT_WORKFLOW placement question (below) turns out to be
genuinely contested in a way this brief's answer doesn't already resolve.

**Table row used:** "a contract between two modules, a new dependency, an ADR" -> architect (the
closest fit for a cross-cutting process-convention change that isn't a single-agent's module work —
human-approved override of the FOLLOW-550 stub's original `recommended_agent: pm-orchestrator`,
which didn't map cleanly onto the decision table since it's PM editing its own workflow doc, not a
worker deliverable).

**Context to read first:** `docs/MASTER_DESIGN.md` §Snapshot.1 (current implementation status — read
before any non-trivial task, OPERATING_PRINCIPLES Rule 1), the current `CONVENTIONS_PATCH.md` (skim
the Rule-promotion-discipline pattern — Rules Q/AA/AB's provenance footnotes are the canonical
examples of "≥2 PRIOR numbered retros" adjudication you must NOT bypass here),
`docs/AGENT_WORKFLOW.md` in full (you're adding a subsection to it), and the ticket source
`backlog/FOLLOW_UPS.md` FOLLOW-550 / `backlog/RETROSPECTIVES.md` RETRO-173 §5d/§6/§9 (the retro that
diagnosed this and left the ready-made Rule text you should draw from).

**What happened (the concrete incident this codifies, verified in the repo's own history, not
guessed):** FOLLOW-549 (RETRO-172's own 1h P3 fast-follow) produced **three** PRs — #504
(dispatch-record bookkeeping), #505 (the actual code), #506 (PM validation) — where the ticket
immediately before it, FOLLOW-532, achieved a tight **two**-PR shape (code #502 + one bundled
DONE+RETRO PR #503). #506 was cut from `main` BEFORE #504/#505 merged. The human then merged BOTH
#504 (redundant once folded) AND #505, instead of closing #504 as superseded — so #506 developed an
unresolvable `backlog/QUEUE.md` merge conflict (too large for the GitHub web editor) and had to be
closed unmerged; the close-out was rebuilt from scratch on a fresh branch
(`pm-orchestrator/ FOLLOW-549-done`), independently re-deriving all evidence against post-merge
`main` rather than losing it. **Root cause, per RETRO-173 §5d:** the PM's own recurring close-out
notes on FOLLOW-380/532/546/548 all phrased the choice as "when merging, merge #N first (OR accept
its content is superseded and close it — human's call)" — presenting two options as CO-EQUAL-SAFE
when they are not: merging the redundant PR GUARANTEES a conflict on any in-flight sibling; closing
it does not.

**Required fix (per the ticket AC in `backlog/QUEUE.md` FOLLOW-550 — follow it precisely, it is
already fully specified):**

1. Add a new `docs/AGENT_WORKFLOW.md` subsection (recommended placement: between "Recovered-work
   re-verification" — ends ~line 162 — and "The retrospective loop" — starts ~line 163 — mirroring
   that section's "mandatory (...)" heading style and citation format, e.g. how "Branch-first worker
   discipline" at line 108 cites FOLLOW-448/RETRO-146 inline).
2. The section must state, as a single unambiguous default (not one of two options):
   - (a) A bookkeeping/dispatch PR touching ONLY backlog files whose content a later PR folds in is
     ALWAYS closed-as-superseded, never merged.
   - (b) Never keep two `QUEUE.md`-touching PRs open in parallel — serialize them.
   - (c) A validation/DONE PR must be cut from `main` AFTER the code PR merges (or rebased
     immediately before opening) — never carry a stale `QUEUE.md` base.
   - (d) Prefer folding validation directly into the DONE+RETRO bundle (one PR, cut from current
     `main` after the code merges) over a separate validation PR — the FOLLOW-532/#503 pattern.
3. Cite RETRO-173 (§5d/§6/§9) and the FOLLOW-549 PR numbers (#504/#505/#506) as the concrete
   precedent in the rationale prose.

**CRITICAL — do NOT add a `CONVENTIONS_PATCH.md` Rule as part of this ticket.** RETRO-173 explicitly
held this pattern at count 1 as a NUMBERED-RETRO finding and did NOT promote it — the
≥2-PRIOR-numbered-retro threshold (Rule AB / the RETRO-153/158/169/170 promotion discipline) is
genuinely unmet. The raw ~4x in-session recurrence of the two-PRs-in-flight SHAPE this session does
NOT count toward that threshold — only documented findings in PRIOR NUMBERED retros do. FOLLOW-550
is a deliberate `docs/AGENT_WORKFLOW.md` workflow-guidance codification, explicitly NOT a back-door
route to a `CONVENTIONS_PATCH.md` Rule that would bypass the threshold. Your new section should
itself say (1-2 sentences) that this is workflow guidance, not a promoted Rule, and briefly why — so
a future reader doesn't mistake it for one or wonder why `CONVENTIONS_PATCH.md` doesn't
cross-reference it. **If, while drafting, you genuinely believe this warrants an immediate
`CONVENTIONS_PATCH.md` Rule despite the count** — that is an ESCALATION/ADR question for the human,
not something to add silently. Write it to `backlog/ESCALATIONS.md` with your reasoning and stop
there; do not add the Rule yourself.

**Scope guardrails (Rule 3, surgical changes):** This is a docs-only ticket. No code changes. Do not
touch `CONVENTIONS_PATCH.md`. Do not rewrite unrelated sections of `docs/AGENT_WORKFLOW.md` — a
single new subsection, surgically inserted.

**Anti-sprawl instruction for THIS ticket's own lifecycle (apply the lesson to itself):** the PM
will open exactly ONE bookkeeping PR to promote this ticket (human merges it), and later exactly ONE
DONE+RETRO bundle PR — no separate validation PR. Please keep your own PR to a single, clean commit
if practical.

**Validation before opening the PR:** this is a markdown-only change; `pnpm lint` (markdown linting,
if configured) is the main gate. No `pnpm test`/`pnpm build` impact expected, but run the standard
local gate sequence anyway per convention.

---

## Retro delegation brief — FOLLOW-549 (retrospective-analyst)

**From:** pm-orchestrator (session 25 cont'd, post #504/#505/#506 close-out) **To:**
retrospective-analyst (to be spawned by the coordinator — pm-orchestrator has no subagent-spawn
capability in this tool surface) **Date:** 2026-07-10 **Branch:** `pm-orchestrator/FOLLOW-549-done`
(already created off `main` at `f541f37`, carries the DONE-flip; append RETRO-173 content on this
SAME branch — do NOT open a new PR, the PM will open ONE bundled PR after this lands, matching the
FOLLOW-532/#503 pattern). **Model: Opus** — matches `retrospective-analyst`'s own agent-file default
(`model: opus`).

**What merged:** PR #505 (`backend-engineer/FOLLOW-549-adapt-get-auth-area-pin`, commit `f541f37`) —
2 spy assertions (`toHaveBeenCalledWith(..., 'adapt'|'description')`) pinning each GET route's own
`area` literal to `resolveAdaptGetAuth`'s 3rd param, plus 1 docstring sentence on
`adapt-get-auth.ts`'s call-site-inventory naming the `area`-union-widening compile error as the
forcing function for a genuine 3rd consumer. Test/docs-only — zero production logic touched. This
closes RETRO-172's own §4c TG-1 / §4d DG-1 residual findings.

**Unusual process wrinkle this retro should analyze (the actual interesting finding here, arguably
more than the code itself):** this ticket produced **3 PRs (#504, #505, #506)** instead of the usual
2 (dispatch-record + code) or the tighter 1 (when folded). #504 (dispatch-record) and #505 (the
code) were BOTH merged by the human — #504 was expected to be closed-as-superseded once a validation
PR folded its content, per the established convention from FOLLOW-380/546/548 (see
`backlog/QUEUE.md`'s own historical notes on those tickets — "when merging, merge #504 first (or
accept its content is superseded/duplicated by this validation's fold-in and can be closed without
merging — human's call, flag the redundancy)"). Because the human merged BOTH #504 and #505, the
PM's already-open validation PR #506 (`pm-orchestrator/FOLLOW-549-validate`, cut from `main` BEFORE
#504/#505 merged) developed an unresolvable `backlog/QUEUE.md` merge conflict once both landed (too
large for the GitHub web editor). Per explicit coordinator instruction, #506 was NOT rebased/
resolved — it was closed unmerged (no data loss: its validation evidence — CI non-success count,
Rule I baseline check, and an independently-reproduced swap-fails property check in a fresh worktree
— was re-derived fresh against `main` post-merge rather than copy-pasted from the stale PR) and a
clean DONE-flip was written on a NEW branch (`pm-orchestrator/FOLLOW-549-done`).

**Specific angles this retro should check:**

1. **Is "merge #504, don't close it" actually the wrong human instinct, or is the PM's own
   established convention (leave a redundant dispatch-record PR open, expecting it to be closed
   later) the fragile part?** Three prior tickets (FOLLOW-380, FOLLOW-546, FOLLOW-548) all left a
   note like "when merging, merge #N first (or accept superseded/closable)" — ALL THREE were
   apparently closed-not-merged by the human successfully; THIS is the first time the human merged
   both. Is this a one-off (human simply chose the other valid option, both are "safe" per the PM's
   own notes), or does the repeated PM-authored guidance itself invite this outcome by presenting
   "merge it" as an explicitly sanctioned option rather than a discouraged one? If the latter, is a
   CONVENTIONS_PATCH rule warranted (count check: this is the 4th occurrence of the two-PR-in-flight
   shape, but the FIRST occurrence where the redundant PR was merged rather than closed — check
   whether that's a NEW failure mode or just variance within an already-tolerated ambiguity).
2. **Cost of the resulting 3-PR sprawl vs. the tighter FOLLOW-532 1-PR-per-hop pattern this same
   session achieved for the PRIOR ticket.** FOLLOW-532 itself was dispatched+validated+closed with
   exactly one bookkeeping PR per phase, ending clean. FOLLOW-549 (dispatched by the SAME session,
   minutes later) regressed to the older, messier 3-PR shape. Is there a structural reason (the
   validation PR being cut mid-flight before the dispatch PR merged) or is this pure timing luck?
3. **Verify no residual QUEUE.md corruption:** confirm (independently, not by trusting this brief)
   that `backlog/QUEUE.md` has exactly ONE `FOLLOW-549` block on `pm-orchestrator/FOLLOW-549-done`,
   with `status: DONE`, `merged_pr: 505`, `merge_commit: f541f37`, and both AC checkboxes `[x]`.
4. **Confirm FOLLOW-549's own AC is genuinely closed** — re-verify the swap-fails property yourself
   (don't just re-read the PM's report) if you have the tooling to do so; if not, note that the PM's
   evidence trail should be treated as one independent check, not the only one.

**Standard retro deliverables per CLAUDE.md's per-ticket retrospective loop:** read the merged PR
#505 diff, map changed symbols to consumers (already confirmed: `resolveAdaptGetAuth`'s `area` param
has exactly 2 production call sites, unchanged from FOLLOW-532), check the last 5 retro entries
(RETRO-168–172) for repeating patterns — RETRO-172 is the DIRECT source and worth re-reading in full
— check adjacent QUEUE.md tickets (FOLLOW-533/534, the other RETRO-164 stubs, still unpromoted) for
cascading assumptions, append a structured RETRO-173 entry to `backlog/RETROSPECTIVES.md`, generate
FOLLOW_UPS stubs for any gap found, and promote a finding to a permanent `CONVENTIONS_PATCH.md` Rule
ONLY if the same pattern appeared in ≥2 PRIOR numbered retros.

---

## Delegation brief — FOLLOW-549 (backend-engineer) — pin each GET adapt route's `area` literal

**From:** pm-orchestrator (session 25 cont'd) **To:** backend-engineer **Date:** 2026-07-10
**Branch:** `backend-engineer/FOLLOW-549-adapt-get-auth-area-pin` (create as your FIRST action, off
`main` at `f1f9646` or later — branch-first, never commit to `main`).

**Model: Sonnet** — routine, mechanical, well-scoped (add 2 spy assertions + 1 docstring sentence to
a file you likely just touched in FOLLOW-532); no cross-module ambiguity or design judgment call.
Model-fit table row: "Routine implementation inside a well-defined ticket scope ... tests,
docs/backlog bookkeeping, mechanical refactors, CI fixes" -> Sonnet.

**Context to read first:** `docs/MASTER_DESIGN.md` §Snapshot.1 (current implementation status — read
before any non-trivial task, OPERATING_PRINCIPLES Rule 1), the current `CONVENTIONS_PATCH.md` (Rule
S — symmetric siblings, the axis this ticket strengthens), and the ticket source
`backlog/FOLLOW_UPS.md` FOLLOW-549 / `backlog/RETROSPECTIVES.md` RETRO-172 §4c TG-1 / §4d DG-1 / §7
(the retro that flagged this residual immediately after your own FOLLOW-532 PR #502 merged).

**Table row used:** "ingest worker, control-plane, decision-api, Postgres/RLS, auth, onboarding
HTTP, billing, webhooks" -> backend-engineer.

**Why this exists (verified in code, not guessed):** FOLLOW-532 (your own prior PR) folded the
`resolveApiKey` DB-throw handling into `resolveAdaptGetAuth` and gave it a required 3rd
`area: 'adapt' | 'description'` param, tagged onto the internal `Sentry.captureException` call. Both
`GET /api/adapt` and `GET /api/adapt/description` now pass their own literal
(`apps/control-plane/src/app/api/adapt/route.ts:714` passes `'adapt'`;
`.../adapt/description/route.ts:220` passes `'description'`). **Nothing pins each route to its own
literal today:** `apps/control-plane/src/lib/__tests__/adapt-get-auth.parity.test.ts` drives
`resolveAdaptGetAuth` directly (bypassing the routes entirely), and BOTH
`apps/control-plane/src/app/api/adapt/route.test.ts` and `.../adapt/description/route.test.ts` mock
`resolveAdaptGetAuth` wholesale via a hoisted `mockResolveAdaptGetAuth = vi.fn()` (confirmed:
`grep -n "mockResolveAdaptGetAuth"` in both files shows the mock is asserted on for call-COUNT in a
few places, e.g. `.not.toHaveBeenCalled()`, but never for call-ARGUMENTS). A future clone of either
route (or a copy-paste refactor) that passed the WRONG literal would silently mislabel the Sentry
`tags.area` on a real DB outage — the disposition and `tags.kind` would still be correct, so this is
a cosmetic observability mislabel, not a fail-open/correctness risk (hence P3, not P2 like the
original FOLLOW-532 seam).

**Required fix (both items, per the ticket AC in `backlog/QUEUE.md` FOLLOW-549):**

1. **Pin the literal per route.** In `apps/control-plane/src/app/api/adapt/route.test.ts`, add (or
   extend an existing happy-path test) an assertion like
   `expect(mockResolveAdaptGetAuth).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'adapt')`.
   Mirror it in `.../adapt/description/route.test.ts` with `'description'`. This is intentionally
   lightweight — no new test file, no new describe block required; folding it into an existing test
   that already exercises the happy path
   (`mockResolveAdaptGetAuth.mockReset() .mockResolvedValue({ ok: true, tenantId: ... })` is already
   the `beforeEach` default in both files) is sufficient and keeps the diff minimal (Rule 3,
   surgical changes).
2. **Strengthen the docstring.** `apps/control-plane/src/lib/adapt-get-auth.ts:13-14` currently
   reads:
   `"Both MUST call this helper (never re-implement the two-step inline). A third consumer added later MUST be appended here."`
   Add a sentence stating that a third consumer must ALSO widen the `area: 'adapt' | 'description'`
   union type (name the resulting TypeScript compile error as the forcing function — so a future
   reader understands this part is enforced by the compiler, unlike the inventory-list sentence
   itself, which is only convention).

**Scope guardrails (Rule 3, surgical changes):** Do not touch the DB-throw disposition shape, the
Sentry-capture logic, or the `AdaptGetAuthResult` type itself — those are FOLLOW-532's already-
merged, already-validated work. This ticket is purely: (a) 2 small test assertions, (b) 1 docstring
sentence. No wire-contract change, no new exported symbol.

**Validation before opening the PR:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
(control-plane `next build` too, per the FOLLOW-474/RETRO-150 worktree-bootstrap convention if
working in a fresh worktree — build `@estalara/{db,shared,auth,sdk}` first or `tsc` will 2307 on
those packages). Re-run prettier on every file you touch.

---

## Retro delegation brief — FOLLOW-532 (retrospective-analyst)

**From:** pm-orchestrator (session 25 close-out) **To:** retrospective-analyst (to be spawned by the
coordinator — pm-orchestrator has no subagent-spawn capability in this tool surface) **Date:**
2026-07-10 **Branch:** `pm-orchestrator/FOLLOW-532-close` (already created off `main` at `a934adf`,
carries the DONE-flip; append RETRO-172 content on this SAME branch per the repo's RETRO+DONE
bundling convention — matches PRs #486/#487/#489/#493/#497/#501). **Model: Opus** — matches
`retrospective-analyst`'s own agent-file default (`model: opus`); also genuinely warranted: this is
the first retro on a shared-auth-helper SIGNATURE change (a required param added to a function whose
docstring maintains an explicit call-site inventory — "a third consumer added later MUST be appended
here"), and it must independently judge whether overriding the source stub's co-assignment
recommendation (qa-engineer dropped) was sound — both are cross-module precedent calls, not routine
mechanical analysis.

**What merged:** PR #502 (`backend-engineer/FOLLOW-532-adapt-get-auth-dbthrow-parity`), commit
`a934adf`. Diff: `apps/control-plane/src/lib/adapt-get-auth.ts` (resolveAdaptGetAuth gained a
required 3rd `area: 'adapt'|'description'` param, now catches the `resolveApiKey` configured-but-
failed-DB throw internally — Rule K.2 — Sentry-captures, and returns a new third
`AdaptGetAuthResult` disposition `{ok:false,status:401,message,dbError:true}`); both
`apps/control-plane/src/app/api/adapt/route.ts` and `.../adapt/description/route.ts` deleted their
duplicated try/catch+Sentry blocks and now call the shared helper directly with the new 3-arg
signature; new `apps/control-plane/src/lib/__tests__/adapt-get-auth.parity.test.ts` (cross-area
`.toEqual` parity assertion); the two pre-existing `follow473` route test suites updated from
`mockRejectedValue` to `mockResolvedValue({...dbError:true})` to match the new no-throw contract.

**Context to read first:** `docs/MASTER_DESIGN.md` §Snapshot.1; `backlog/RETROSPECTIVES.md`
RETRO-164 (the source retro — search for FOLLOW-532's origin, §4a LG-1, source_ticket FOLLOW-473)
and its 2 sibling stubs still sitting unpromoted in `backlog/FOLLOW_UPS.md`: **FOLLOW-533** (the
`OPS_TENANT_ID` vs `ADAPT_TENANT_ID` env-var-naming-drift finding — same RETRO-164/FOLLOW-473
source, adjacent auth surface, NOT touched by this PR — worth checking whether FOLLOW-532's fix
pattern (fold into the shared helper) suggests the same treatment) and **FOLLOW-534** (the
divergent-duplicate-worktree AGENT_WORKFLOW checklist amendment — same source, unrelated code path).
Last 5 retros (RETRO-167–171) are ALL on the RETRO-105 async-interleave class (SDK cross-listing
nav) — a different domain/module than this ticket (control-plane auth); read them primarily to
confirm there's no cross-cutting pattern (e.g. "guard/contract folded into a shared helper only
after 2+ duplicated call sites drifted" as its own recurring shape) rather than expecting direct
overlap.

**Specific angles this retro should check (not exhaustive — use your own judgment too):**

1. **Was folding into the helper (option 2) actually the better choice, or does it hide a NEW
   risk?** Before this PR, a DB-throw was OBSERVABLE as a distinct code path per route (each had its
   own try/catch). Now both routes' `if (!authResult.ok)` branch treats `dbError:true` identically
   to any other 401 — the discriminant exists ONLY for test assertions (confirmed: no production
   code branches on `.dbError`). Is that a latent under-observability regression (e.g. would ops
   actually WANT to alert differently on "DB is down" vs "bad API key" at the route/dashboard level,
   not just via the internal Sentry `tags.kind`), or is `tags.kind: 'api_key_auth_db_error'`
   sufficient observability on its own (it was, pre-PR, at each call site)? Check whether any
   dashboard/alert config reads `tags.kind` today.
2. **Call-site-inventory discipline:** `adapt-get-auth.ts`'s docstring literally says "A third
   consumer added later MUST be appended here" (line ~14) — verify this obligation is still
   satisfiable / not weakened by the new `area: 'adapt'|'description'` union type (a genuinely NEW
   third route would need a type-level change too, which is arguably a GOOD forcing function — but
   confirm the docstring's inventory list itself was updated to describe the new param, not just the
   throw-handling change).
3. **FOLLOW-533 adjacency:** does the `area` param's introduction suggest the SAME "fold a
   duplicated caller obligation into a shared helper" pattern should apply to FOLLOW-533's
   `OPS_TENANT_ID`/ `ADAPT_TENANT_ID` drift (structurally different — that's an env-var-name split
   across 5 routes, not a throw-handling duplication — but worth an explicit yes/no in the retro
   rather than silence).
4. **Test-debt check:** the `dbError: true` field's ONLY consumer today is the new parity test and
   the 2 updated `follow473` mocks. Confirm this isn't a Rule-I-shaped half-wire (Rule I's own CI
   run this session showed 180 pre-existing violations, none on this diff's symbols — but Rule I
   checks EXPORTED SYMBOLS/functions, not object-literal discriminant fields, so it would NOT have
   caught a genuinely dead `dbError` field either way; this needs a human-judgment check, not just
   re-trusting the green gate).

**Standard retro deliverables per CLAUDE.md's per-ticket retrospective loop:** read the merged PR
#502 diff, map changed symbols (`resolveAdaptGetAuth`, `AdaptGetAuthResult`) to ALL consumers in the
repo (already confirmed exactly 2 production + 1 new test file by pm-orchestrator's validation pass
— re-verify independently), check the last 5 retro entries for repeating patterns, check adjacent
QUEUE.md tickets (FOLLOW-473, FOLLOW-533, FOLLOW-534, FOLLOW-450/ADR-0015 sibling auth work) for
cascading assumptions, append a structured RETRO-172 entry to `backlog/RETROSPECTIVES.md`, generate
FOLLOW_UPS stubs for any gap found, and promote a finding to a permanent `CONVENTIONS_PATCH.md` Rule
ONLY if the same pattern appeared in ≥2 PRIOR numbered retros (not this one).

---

## Delegation brief — FOLLOW-532 (backend-engineer) — pin the two GET adapt call sites' DB-throw parity

**From:** pm-orchestrator (session 25) **To:** backend-engineer **Date:** 2026-07-10 **Branch:**
`backend-engineer/FOLLOW-532-adapt-get-auth-dbthrow-parity` (create as your FIRST action, off `main`
at `e429524` or later — branch-first, never commit to `main`).

**Context to read first:** `docs/MASTER_DESIGN.md` §Snapshot.1 (current implementation status — read
before any non-trivial task, OPERATING_PRINCIPLES Rule 1), the current `CONVENTIONS_PATCH.md`
(especially Rule K.2 and its fire-and-forget amendment — "a configured-but- failed store must be
observable/fail loud", the same family this ticket pins), and the ticket source
`backlog/FOLLOW_UPS.md` FOLLOW-532 / `backlog/RETROSPECTIVES.md` RETRO-164 §4a LG-1.

**Table row used:** "ingest worker, control-plane, decision-api, Postgres/RLS, auth, onboarding
HTTP, billing, webhooks" -> backend-engineer. **Model: Sonnet** — routine, well-scoped
implementation inside one existing ticket family (FOLLOW-473's own two routes), no cross-module
ambiguity, no prod-irreversible risk (model-fit table: "Routine implementation inside a well-defined
ticket scope ... mechanical refactors, CI fixes").

**Why this exists (verified in code, not guessed):**

- `apps/control-plane/src/lib/adapt-get-auth.ts:29-32/61-62` — `resolveAdaptGetAuth`'s docstring
  says `resolveApiKey` THROWS on a configured-but-failed DB lookup (Rule K.2) and that the helper
  deliberately does NOT catch it — "the caller MUST wrap the call in try/catch, capture to Sentry,
  and fail loud (401)."
- Both call sites duplicate this obligation identically today:
  `apps/control-plane/src/app/api/adapt/route.ts:708-721` and
  `apps/control-plane/src/app/api/adapt/description/route.ts:215-228` — same
  `try { authResult = await resolveAdaptGetAuth(...) } catch (err) { ...Sentry.captureException... return 401 }`
  shape, only the `tags.area` value (`'adapt'` vs `'description'`) differs.
- Each route's own `follow473` test suite asserts its own DB-throw→401 in isolation. Nothing pins
  the two together — if a future edit dropped or altered ONE route's catch (e.g. during an unrelated
  refactor), that route would 500 on a DB outage instead of 401, and the OTHER route's still-green
  CI would give no signal of the drift.

**Required fix (pick ONE, per the ticket AC in `backlog/QUEUE.md` FOLLOW-532):**

1. **Shared parity test** — a new test (co-located wherever makes sense, e.g.
   `apps/control-plane/src/lib/__tests__/adapt-get-auth.test.ts` or a small shared spec) that drives
   BOTH `GET /api/adapt` and `GET /api/adapt/description` through a forced `resolveApiKey` throw and
   asserts BOTH map it to 401 with an identical Sentry-capture shape (same `tags.kind`), so the two
   routes cannot silently diverge — OR
2. **Fold into the helper** — add a third `AdaptGetAuthResult` disposition (e.g.
   `{ ok: false; status: 401; dbError: true }`) so `resolveAdaptGetAuth` itself catches the throw
   and returns a normalized result, eliminating the duplicated try/catch at both call sites
   entirely.

Either way, the mechanism must be load-bearing: **the chosen test must fail CI if one call site's
disposition drifts from the other** (not a decorative assertion that would stay green even if only
one route regressed). State which option you chose and why in your PR description — either is
acceptable, this is an implementation-detail choice, not an escalation.

**Scope guardrails (Rule 3, surgical changes):** Do not touch the Step 1 (ops-bypass) or Step 2
(`resolveApiKey`) logic itself — this ticket is only about the DB-throw→401 CONTRACT parity between
the two callers. Do not rename `AdaptGetAuthResult`'s existing two variants if you choose option 2;
only add the third. No wire-contract change (SDK/adapt response shape untouched either way).

**Validation before opening the PR:** `pnpm lint && pnpm typecheck && pnpm test && pnpm build`
(control-plane `next build` too — per FOLLOW-474/RETRO-150, `next build`'s webpack import resolution
catches defects `tsc`/`vitest` don't). Re-run prettier on every file you touch.

---

## Delegation brief — FOLLOW-464 (ml-engineer) — folds FOLLOW-523, RETRO-162 P1 fast-follow

**From:** pm-orchestrator (session 13 cont'd, RETRO-162 close-out) **To:** ml-engineer **Date:**
2026-07-07 **Branch:** `ml-engineer/FOLLOW-464-model-key-pg-cache` (create as your FIRST action, off
`main` at `d90cdfa` or later — branch-first per Rule AA; never commit to `main`).

**Why this is P1 and why it's you (not the originally-filed backend-engineer):** FOLLOW-465 (which
YOU just shipped, PR #463 / commit `5acc055`) negative-caches a NEUTRAL archetype-fit verdict. Its
read-path short-circuit fires on the Postgres Step-1 read `getPgCachedDescription`, which per the
long-known-open FOLLOW-464 bug omits `model` from its WHERE clause. RETRO-162 LG-1 verified in code
that this turns a bounded stale-model quality bug into a cross-model CORRECTNESS regression: a
NEUTRAL row written under model A now permanently suppresses generation under model B (and defeats
the DEMO `override_model` preview) until `listing.updated`. You own this read path — hence the
reassignment. FOLLOW-523 (the model-scoping fix) is FOLDED into this ticket.

**The bug (verified, not guessed):**

- `apps/control-plane/src/lib/description-pg-cache.ts:~103-111` — `getPgCachedDescription`'s WHERE
  filters `tenantId, listingId, archetype, locale, invalidatedAt IS NULL` and takes
  `ORDER BY generatedAt DESC LIMIT 1` — **no `model`**. It even SELECTs `model` (and now `verdict`)
  but never filters on it.
- `apps/control-plane/src/app/api/adapt/description/route.ts` — the Postgres Step-1 hit branch
  (~`:305→314/318`, the FIT `ai_cached` return AND the FOLLOW-465 `verdict==='NEUTRAL'`
  short-circuit) runs BEFORE the model-scoped Redis Step-2 (`:365-369`, key `:{model}` /
  `:demo:{model}`). So the model-blind Step-1 wins first.

**Required fix (AC in QUEUE.md FOLLOW-464, incl. the folded FOLLOW-523 items):**

1. Add `model` to the `getPgCachedDescription` WHERE clause so a (tenant,listing,archetype,locale,
   **model**) request only matches a row written under that same model. This fixes BOTH the FIT read
   (original F-15) and the FOLLOW-465 NEUTRAL short-circuit (RETRO-162 LG-1) in one place, since
   both go through this reader.
2. Confirm the signature already threads `model` in (the route passes it / the Redis key already has
   it) — if `getPgCachedDescription` doesn't currently receive `model`, add the param and pass it
   from the route's Step-1 call. Keep the change surgical.
3. **Demo path:** ensure a non-demo NEUTRAL row does not short-circuit a DEMO `override_model`
   request. Check how the demo model is represented in the cache key/`model` column (`:demo:{model}`
   in Redis) and mirror that discrimination on the pg read so the demo preview always re-dispatches
   past a non-demo NEUTRAL. If the pg cache doesn't distinguish demo at all, state that and scope
   the guard to "demo requests bypass the pg NEUTRAL short-circuit" — do NOT silently let a prod
   NEUTRAL leak into the demo preview.
4. **Out of scope (leave alone):** the P3 items RETRO-162 filed separately —
   `listPgDescriptionCache` verdict wiring (FOLLOW-524), shared-enum binding (FOLLOW-525), NEUTRAL
   metrics (FOLLOW-526), worktree autosave (FOLLOW-527). Surgical changes only.

**Tests (AC):**

- Model-switch cache-busting on the pg path for the FIT case (a FIT row under model A does not
  satisfy a model-B request).
- **RETRO-162 LG-1 regression guard:** a NEUTRAL row written under model A does NOT short-circuit a
  model-B request (nor a DEMO `override_model` request) — assert model B re-dispatches /
  re-generates (the `publishDescriptionRequested` spy IS called for model B) instead of serving
  `template_fallback`.
- Reuse the FOLLOW-465 test harness (`route.follow465.test.ts`) patterns for the NEUTRAL/dispatch
  spies.

**Files most likely touched:** `apps/control-plane/src/lib/description-pg-cache.ts`,
`apps/control-plane/src/app/api/adapt/description/route.ts` (+ its test files). Likely NO Python /
migration / schema change (the `verdict` column + `model` column already exist post-FOLLOW-465).

**Read before starting:** `docs/MASTER_DESIGN.md` §Snapshot.1; `CONVENTIONS_PATCH.md` (Rule AA);
`backlog/RETROSPECTIVES.md` RETRO-162 §4a LG-1; the FOLLOW-465 diff (`git show 5acc055`) so you
build on the read-path shape you just shipped.

**Validation the orchestrator will require before READY_FOR_REVIEW:**

- `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` all green + the
  FOLLOW-474 gate `pnpm --filter control-plane build`.
- CI green on every real gate (`gh pr checks <pr> --watch`, then confirm the only reds are the
  documented pre-existing "Rule I — wired-or-dead" baseline — name them, prove they're not new).
- Runtime-wiring: paste the `getPgCachedDescription` WHERE now including `model`, AND a test proving
  the NEUTRAL cross-model re-dispatch.

**Open a PR when done; do not merge.** Report status, PR link, CI result back to me (the
orchestrator) — do NOT edit `backlog/QUEUE.md` yourself (single-writer).

---

## Delegation brief — FOLLOW-465 (ml-engineer)

**From:** pm-orchestrator (session 13) **To:** ml-engineer **Date:** 2026-07-06T00:00:00Z
**Branch:** `ml-engineer/FOLLOW-465-neutral-verdict-negative-cache` (create as your FIRST action,
off `main` at `d79d800` or later — branch-first per FOLLOW-448/Rule AA discipline; never commit to
`main`). Delegation-table row used: "intent/adapt logic, embeddings, LLM gateway, auto-detect,
ontology, platform-templates" → ml-engineer.

**Read before starting:**

- `docs/MASTER_DESIGN.md` §Snapshot.1 (current implementation status — Operating Principle 1)
- `CONVENTIONS_PATCH.md` (current permanent rules, incl. Rule K.2 fire-and-forget-observability and
  the newer Rule AA CODE-VS-PROD-AXIS)
- This ticket's YAML block in `backlog/QUEUE.md` → Sprint 22b → `FOLLOW-465` (source: 2026-07-01
  audit F-18, ADR-0010, audit report §5.4)
- `docs/adr/ADR-0010-archetype-fit-gate-neutral-verdict.md` (why a NEUTRAL verdict exists at all —
  do not weaken or bypass the gate itself; this ticket only changes what happens to its OUTPUT)

**The bug (verified in repo, not guessed from the audit one-liner):**

- `apps/llm-gateway/src/jobs/generate_description.py:1101-1113` — `_generate_with_sonnet` parses
  `<adaptation_verdict>` (ADR-0010); on `NEUTRAL` it logs and `return "", []` — identical to the
  contract-violation failure path at `:1121-1128` and structurally indistinguishable to the caller.
- `generate_description()` (`:330-338`): `if not description: ... # Do not write to Redis. return` —
  a NEUTRAL verdict and a genuine Sonnet failure both hit this branch and BOTH result in **zero**
  writes to Redis or `description_cache_persistent`.
- Consequence: `GET /api/adapt/description`
  (`apps/control-plane/src/app/api/adapt/description/route.ts`) never gets a cache hit for a NEUTRAL
  (tenant,listing,archetype,locale,model) combination. Every single subsequent request for that
  exact combination — which will recur constantly, e.g. every page view by every visitor the
  archetype-detector classifies into that non-fitting archetype — re-runs the full miss path:
  `retrieveListingContext` + `fetchListingOriginalDescription` + a fresh
  `publishDescriptionRequested` dispatch to Modal, i.e. a brand-new Sonnet 4.6 API call, forever,
  with NO cap. This is live in prod today: the description-generation pipeline went live 2026-07-03
  (Modal `estalara-description-generator`, ADR-0016 direct-HTTPS dispatch), and NEUTRAL verdicts are
  an expected, not rare, output of the archetype-fit gate whenever the visitor's detected archetype
  doesn't genuinely fit the listing. Given the pilot is explicitly cost-conscious (ADR-0016 dropped
  a ~$500/mo Redpanda tier over budget), an uncapped repeat-Sonnet-call leak on a live path is a
  real, compounding-with-traffic cost bug, not a theoretical one.

**Required fix (per ticket AC in QUEUE.md) — design constraints found by reading the surrounding
infra BEFORE this brief was written, so you don't have to re-discover them:**

1. **This is an internal-cache-shape change, NOT a wire-contract change — keep it that way.**
   `DescriptionResponseSchema` (`packages/shared/src/schemas/description.ts:106-132`, the actual
   HTTP response to the SDK) and its `description: z.string().min(1)` must NOT change, and the SDK
   must never see a new `source` value. The existing response for a "known-NEUTRAL, short-circuited"
   request should remain `source: 'template_fallback'` with the non-empty playbook `templateText` —
   exactly what the miss path already returns — you are only changing whether the Modal
   dispatch/enqueue happens, not the HTTP contract. If you find yourself needing a new `source`
   value or a schema change the SDK consumes, STOP and escalate per CLAUDE.md (public API surface
   change) rather than shipping it under a P2 ticket.
2. **Two internal schemas currently reject the obvious "empty string" sentinel — don't fight them,
   extend them:**
   - `DescriptionCacheValueSchema` (`packages/shared/src/schemas/description.ts:261-274`):
     `text: z.string().min(1)`.
   - `/api/internal/description-cache` `BodySchema`
     (`apps/control-plane/src/app/api/internal/description-cache/route.ts:55-63`):
     `description: z.string().min(1)`.
   - `description_cache_persistent.description`
     (`packages/db/src/schema/description_cache_persistent.ts:42`) is a Postgres `text NOT NULL`
     column — NOT NULL permits `''` at the DB layer, it's the Zod validators above that actually
     block an empty sentinel. Recommended shape (your call, but state your reasoning if you
     diverge): add an optional `verdict: z.enum(['FIT', 'NEUTRAL']).optional()` field
     (absent/undefined ⇒ implicit `'FIT'` for full backward compat with every existing
     row/cache-entry) to both schemas, and relax the `min(1)` constraint on `text`/`description` to
     only apply when `verdict !== 'NEUTRAL'` (e.g. `.superRefine` or a discriminated union —
     whichever is more idiomatic given the rest of the file). This avoids overloading an empty
     string as a silent, undocumented sentinel that a future reader could easily misinterpret as
     "generation succeeded with blank text."
3. **Postgres migration.** If you add a `verdict` column to `description_cache_persistent`, write a
   new sequential migration in `packages/db/migrations/` (latest is
   `0032_dsr_verifications_attempt_count.sql`, so yours is `0033_...`), nullable, matching the
   existing Drizzle-schema-vs-SQL-migration pattern already used for this table (see
   `0023_description_cache_persistent.sql` for the pattern this table follows). Confirm CI's
   ClickHouse/Postgres migration-journal-monotonicity gate stays green.
4. **Wire the write side.** In `generate_description()`, branch the NEUTRAL case (verdict ==
   `'NEUTRAL'`) separately from the genuine-failure/contract-violation case (empty response,
   exception, or `_body_violates_contract`). On NEUTRAL: call `_write_to_redis` and
   `_write_to_postgres_cache` (or new thin variants) with the negative-cache marker
   (`verdict='NEUTRAL'`, empty/placeholder text, `headline=None`) using the SAME `cache_key` /
   (tenant,listing,archetype,locale,model) shape the FIT path already uses — this is what lets the
   EXISTING invalidation infra (Redis `SCAN desc:{tenant}:{listing}:*` wildcard delete in
   `description-cache.ts`, and Postgres `invalidatePgDescriptionCache`'s tenant+listing WHERE clause
   in `description-pg-cache.ts:191-209`) invalidate a NEUTRAL marker automatically on the next
   `listing.updated` webhook, with zero changes to the webhook route. On genuine failure/contract
   violation: KEEP the current behavior (no write, retry next request) — do NOT scope-creep into
   caching those; that's a different failure class and out of this ticket's AC.
5. **Wire the read side.** In `GET /api/adapt/description`
   (`apps/control-plane/src/app/api/adapt/description/route.ts`), both the Step-1 Postgres hit
   branch (`:278-313`) and the Step-2 Redis hit branch (`:325-364`) need a new check: if the hit is
   a NEUTRAL marker (not a real description), skip the `ai_cached` response entirely, skip the
   RAG/original- description fetch AND the Modal dispatch
   (`publishDescriptionRequested`/`afterResponse`), and return the same `template_fallback` shape
   the miss path already builds (`:426-435` — reuse `templateText`, do not duplicate it). This is
   the actual mechanism that stops the re-spend; without this half of the wire, the write-side
   change alone does nothing (this is exactly the class of half-wire flagged by
   FOLLOW-097→114→127→141 and re-checked at PM validation step 5c — expect the PM to grep for both
   the negative-cache WRITE (Python) and the negative-cache READ/short-circuit (control-plane route)
   before accepting this as done).
6. **Explicitly out of scope (do not touch):** `getPgCachedDescription`'s missing `model` filter
   (`description-pg-cache.ts:96-104`) is a real, separate bug — that's FOLLOW-464, not this ticket.
   Leave it alone; do not "fix it while you're in there" (CLAUDE.md "Surgical Changes").
7. **Test (AC2):** two identical NEUTRAL requests for the same
   (tenant,listing,archetype,locale,model) trigger exactly ONE Modal dispatch/Sonnet-eligible
   enqueue (assert the mock/spy for `publishDescriptionRequested` or the equivalent Modal-job
   entrypoint is called exactly once across both requests, second request short-circuits to
   `template_fallback` with no dispatch). Also add/ update a Python-side test asserting the NEUTRAL
   branch in `generate_description()` writes the marker (not silently returns).

**Files most likely touched:** `apps/llm-gateway/src/jobs/generate_description.py` (+ its test
file), `apps/control-plane/src/app/api/adapt/description/route.ts` (+ its test file),
`apps/control-plane/src/lib/description-pg-cache.ts`,
`apps/control-plane/src/lib/description-cache.ts`,
`apps/control-plane/src/app/api/internal/description-cache/route.ts` (+ its test file),
`packages/shared/src/schemas/description.ts`,
`packages/db/src/schema/description_cache_persistent.ts`, a new `packages/db/migrations/0033_*.sql`
(if you add the `verdict` column).

**Validation the orchestrator will require before READY_FOR_REVIEW (do not skip):**

- Local: `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` all green, PLUS
  the FOLLOW-474 control-plane gate: `pnpm --filter control-plane build` (or `next build`) since
  this ticket touches `apps/control-plane` routes/lib.
- CI green on every real gate (`gh pr checks <pr> --watch`, then
  `jq '[.[]|select(.state!="SUCCESS")]|length'` — paste the `0`). Only the pre-existing "Rule I —
  wired-or-dead" red (baseline noise, unrelated to this diff) and any pre-existing SDK-bundle
  `Build` red are acceptable — confirm they are the SAME baseline failures, not new ones.
- Runtime-wiring grep (step 5c) — paste both:
  - A non-test PRODUCER: the Python `generate_description()` NEUTRAL branch actually calling the
    negative-cache write (not just a docstring/comment).
  - A non-test CONSUMER: the control-plane route's Step-1/Step-2 hit branches actually checking the
    verdict/marker and skipping Modal dispatch on it (not just the write path landing with nothing
    ever reading it back).
- Confirm the migration (if any) doesn't regress the migration-journal-monotonicity CI gate.
- Single-agent ticket, no step-5d co-assignment check needed (though this ticket crosses
  Python/llm-gateway and TS/control-plane files within one agent — mirrors the FOLLOW-460 precedent
  where ml-engineer already legitimately touched `description-pg-cache.ts`).
- Cite the audit report §5.4 F-18 and ADR-0010 in the PR description as the source pattern.

**Open a PR when done; do not merge.** Update `backlog/QUEUE.md` FOLLOW-465 status only via the
orchestrator (single writer) — report back status, PR link, and CI result instead of editing the
queue yourself.

---

## Delegation brief — FOLLOW-466 (backend-engineer)

**From:** pm-orchestrator (session 12) **To:** backend-engineer **Date:** 2026-07-06T00:00:00Z
**Branch:** `backend-engineer/FOLLOW-466-feedback-hmac-replay-protection` (branch off `main`, tip
`a704516`). Delegation-table row used: "ingest worker, control-plane, decision-api, Postgres/RLS,
auth, onboarding HTTP, billing, webhooks" → backend-engineer.

**Ticket:** `backlog/QUEUE.md` id `FOLLOW-466` — "Add replay protection to feedback HMAC + unify
secret comparisons on timingSafeEqual (F-21)". P2, depends_on `FOLLOW-450` (DONE, verified in
QUEUE.md). Source: 2026-07-01 audit finding F-21 (`audit report §5.5`), ADR-0015.

**Read first (in order):** `docs/MASTER_DESIGN.md` §Snapshot.1, `docs/ops/OPERATING_PRINCIPLES.md`,
`docs/AGENT_WORKFLOW.md`, `CONVENTIONS_PATCH.md` (esp. Rule K.1/K.2 on parity + fail-loud
observability, and the general secret-comparison conventions — grep `timingSafeEqual` /
`constantTimeEqual` for the established pattern before inventing a new one), this brief.

**Problem (independently re-confirmed by pm-orchestrator, not just trusting the audit stub):**

1. `apps/control-plane/src/app/api/adapt/feedback/route.ts` computes
   `expectedHex = await hmacSha256Hex(bearerToken, rawBody)` (HMAC-SHA256 over the raw body only —
   no timestamp, no nonce) and compares with `constantTimeEqual` (already timing-safe — that half of
   F-21 is NOT broken here). Because the signature covers only `(key, body)`, any observer of a
   single valid `(body, X-Estalara-Signature)` pair (e.g. a MITM on a non-TLS-terminated hop, a
   logging pipeline, a compromised analytics proxy) can replay that exact POST indefinitely — each
   replay re-invokes `updateArmAsync` (Thompson-sampling bandit alpha/beta update) and, if
   `prediction_id` is present, re-invokes `upsertConversionLabelAsync`. This is a bounded but real
   bandit-integrity issue (an attacker who captures one `converted:true` ping for an
   under-performing variant can inflate its win-rate indefinitely).
2. Two other secret-compared routes still use plain string equality instead of `timingSafeEqual`:
   - `apps/control-plane/src/app/api/internal/retention/conversion-labels/route.ts:55` —
     `return authHeader === \`Bearer ${secret}\`;` (CRON_SECRET)
   - `apps/control-plane/src/app/api/canary/adaptation-writes/route.ts:91` — same pattern
     (CRON_SECRET) Contrast with the already-correct pattern in
     `apps/control-plane/src/lib/tracer-auth.ts` (uses `timingSafeEqual` from `crypto`) and
     `apps/control-plane/src/app/api/webhooks/listing-updated/route.ts` (uses `secretEquals` from
     `@/lib/secret-compare.ts`, itself `timingSafeEqual`-backed). Reuse one of those two existing
     helpers — do not write a third comparison primitive.

**Scope (per ticket AC — do not gold-plate beyond this):**

- [ ] Feedback signature (`X-Estalara-Signature` on `POST /api/adapt/feedback`) covers a timestamp
      with a bounded acceptance window; a replayed old `(body, sig)` pair outside the window is
      rejected with 401. Decide and document the window (ADR-0015 doesn't specify one — a few
      minutes is the conventional HMAC-freshness window; pick one, state the rationale in the PR,
      escalate only if you believe this needs a product/compliance call, not because you're unsure
      of a number). - **SDK wire-contract note:** the route's docstring says "SDK wire contract
      (unchanged — no SDK re-deployment required)". Adding a timestamp requirement to the HMAC WILL
      change the wire contract (the signed message must now include a timestamp the caller sends).
      If the chosen approach requires an SDK change, that is a public-API-surface change per
      CLAUDE.md's escalation rules ("public APIs... ingest event schema, decision API contract") —
      STOP and write an ESCALATIONS.md entry (sequential ESC-NNN) rather than silently changing the
      SDK→control-plane feedback contract. A design that adds the timestamp as a NEW header (e.g.
      `X-Estalara-Timestamp`) folded into the HMAC message alongside the existing signature header,
      with a documented graceful-degradation path for callers not yet sending it, may avoid a
      breaking change — your call, but flag the tradeoff explicitly in the PR description either
      way. - Optional nonce store (Redis, TTL'd) is explicitly marked optional in the ticket AC —
      only add it if the timestamp window alone doesn't close the replay window to your and the
      auto-verifier's satisfaction; don't over-build.
- [ ] All shared-secret comparisons migrate to `timingSafeEqual` — concretely, fix the two
      `CRON_SECRET` call sites named above (grep for other `===`/`!==` string secret comparisons
      before declaring this AC done; the two named here are the ones independently found, but do
      your own sweep since the audit finding says "INTERNAL_API_SECRET/CRON_SECRET/webhook" plural).
- [ ] Test: a replayed ping outside the acceptance window is rejected (401), and a fresh ping inside
      the window is accepted — cover both in `route.test.ts` (extend the existing suite, don't
      duplicate it). Also add/extend a unit test for each `CRON_SECRET` route confirming
      `timingSafeEqual` is actually exercised (not just imported).

**Validation gates (non-negotiable, run all before opening the PR):**

1. `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` — local, full monorepo.
2. **FOLLOW-474 gate (mandatory for any `apps/control-plane` change):** run `next build` for
   `apps/control-plane` specifically, not just `tsc --noEmit` / `vitest run` — RETRO-150 found
   `next build`'s webpack import resolution catches defects the other two gates miss. If you're
   working in a fresh git worktree, build `@estalara/{shared,db,auth,sdk}` BEFORE your first
   lint/typecheck pass (worktree bootstrap note, same RETRO-150 finding).
3. Push to the named branch, open the PR, then `gh pr checks <pr> --watch` — CI green is
   non-negotiable; PM will independently re-run
   `gh pr checks <pr> --json state,name | jq '[.[]|select(.state!="SUCCESS")]|length'` and expects
   `0` for every real gate (pre-existing-red Rule I / Vercel / Python-test checks are the only
   accepted non-zero per the standing CI-gate landscape note).
4. Runtime-wiring: for the new timestamp/header (if added), grep for a non-test producer (SDK or
   ops-caller emitting the header) AND a non-test consumer (the route reading/validating it) — paste
   both in the PR description. For the `CRON_SECRET` fix, grep confirms the same route file is both
   where the secret is read (producer = env) and where `timingSafeEqual` is invoked (consumer).
5. Commit message: Conventional Commits, ticket ref `[FOLLOW-466]`, scope `control-plane`.

**Do NOT:** touch `FOLLOW-464`/`FOLLOW-465`/`FOLLOW-491` (separate tickets, separate agents/no
shared-tree hazard expected but don't preempt); do NOT flip `FEEDBACK_ENDPOINT_ENABLED` or any other
operator-gated flag; do NOT silently change the SDK wire contract (see escalation note above).

---

## Format

```markdown
## TICKET-XXX → TICKET-YYY

**From:** <producing agent> **To:** <consuming agent> **Date:** <ISO timestamp> **Summary:** One
paragraph: what was produced, where it lives, key details. **Action required:** What the consuming
agent needs to do with it. **Files:** <list of relevant files / artifacts>
```

---

## FOLLOW-102 → any downstream quiz/tenant ticket

**From:** sdk-engineer **To:** backend-engineer / data-engineer / qa-engineer **Date:**
2026-06-10T00:00:00Z

**Summary:** FOLLOW-102 ships `tenants.quiz_enabled boolean NOT NULL DEFAULT true` (migration 0025),
`PATCH /api/tenants/:id` (tenant-scoped JWT, Zod validation), the SDK gate in `showQuizTrigger()`,
and `data-quiz-enabled="false"` emission from `buildSnippet()`. The `GET /api/quiz/config` route now
also returns `quiz_enabled` and `tenant_id` so the dashboard can call PATCH without a separate
lookup.

**Action required:** Any ticket that reads or mutates quiz enablement should use
`tenants.quiz_enabled` (the dedicated boolean column) — NOT `tenants.quiz_config.enabled` (the JSONB
field which is for widget configuration only). PATCH `/api/tenants/:id` is the write path; the SDK
`data-quiz-enabled` attribute is the propagation mechanism.

**Files:**

- `packages/db/migrations/0025_tenants_quiz_enabled.sql`
- `packages/db/src/schema/tenants.ts` (`quizEnabled` field)
- `apps/control-plane/src/app/api/tenants/[id]/route.ts`
- `apps/control-plane/src/app/api/quiz/config/route.ts` (now returns `quiz_enabled` + `tenant_id`)
- `apps/control-plane/src/components/onboarding/DetectionPreview.tsx` (`buildSnippet`)
- `packages/sdk/src/core/config.ts` (`SdkConfig.quiz`, `readConfig`)
- `packages/sdk/src/index.ts` (`showQuizTrigger` gate)

---

## TICKET-041 → TICKET-GDPR-004

**From:** sdk-engineer **To:** backend-engineer **Date:** 2026-05-15T08:00:00Z

**Summary:** Consent banner ships in `packages/sdk`. `consent.granted` / `consent.denied` events are
emitted to the event queue and flushed to ingest even when consent is denied (compliance audit
trail). `getConsentState()` and `setConsentState()` are exported from `session.ts`. The consent
state key is `estalara_consent` in `localStorage`. The `ConsentGrantedEventSchema` and
`ConsentDeniedEventSchema` are registered in the shared `EventSchema` discriminated union.
TICKET-GDPR-004 (server-side consent gate) can now rely on these events flowing through ingest to
ClickHouse.

**Action required:** TICKET-GDPR-004 should gate server-side processing on `consent_state` field in
the event envelope. No SDK changes needed for that gate.

**Files:** `packages/sdk/src/ui/consent-banner.ts`, `packages/sdk/src/core/session.ts`,
`packages/shared/src/schemas/events/consent.ts`

---

## TICKET-011 → TICKET-012, TICKET-014

**From:** architect  
**To:** backend-engineer (TICKET-012), data-engineer (TICKET-014)  
**Date:** 2026-04-30T22:00:00Z

**Summary:**

Event schemas v1 implemented in `@estalara/shared` per ADR-0003 and Master Design C.1. Common
envelope (`EventEnvelopeSchema`) plus 33 per-type event schemas across all 10 categories, assembled
into a discriminated union (`EventSchema`). 74 vitest cases covering parse success, missing-required
failures, enum / range / length boundaries, and discriminator routing. zod ^3.23.8 added as a
runtime dep on `@estalara/shared`. Re-exported from the package root, so any consumer can
`import { EventSchema, EVENT_TYPES } from '@estalara/shared'`.

**Action required:**

For TICKET-012 (backend-engineer, Cloudflare Worker ingest):

1. `import { EventSchema } from '@estalara/shared'` in the worker
2. Validate every incoming POST body with `EventSchema.safeParse(...)` before publishing to Redpanda
3. Strict envelope: reject on parse failure with HTTP 400 + zod issue list
4. Lenient payload: don't add per-type guard rails beyond what `EventSchema` enforces (additive
   evolution per ADR-0003)
5. Tag failed parses with structured logs (use `packages/shared/observability` logger) so we can
   detect SDK-side regressions

For TICKET-014 (data-engineer, ClickHouse table DDL):

1. The canonical `events` table stores `payload` as ZSTD-compressed JSON String per ADR-0003
2. Mirror the envelope columns 1:1 (event_id UUID, tenant_id UUID, session_id String, ts DateTime64,
   region LowCardinality(String), consent_state LowCardinality(String), schema_version UInt8, type
   LowCardinality(String), payload String, listing_id Nullable(String), archetype_hint
   Nullable(String))
3. Build per-type materialized views projecting payload JSON keys into typed columns (one view per
   high-traffic event type — start with `page.view`, `chat.message.sent`, `inquiry.completed`)
4. Use `EVENT_TYPES` from `@estalara/shared` as the source of truth when generating DDL or fixtures

**Files:**

- `packages/shared/src/schemas/event.ts` (envelope)
- `packages/shared/src/schemas/events/*.ts` (10 category files)
- `packages/shared/src/schemas/events/index.ts` (`EventSchema` discriminated union, `EVENT_TYPES`
  tuple)
- `packages/shared/src/schemas/index.ts` (public re-export)
- `packages/shared/src/index.ts` (top-level re-export)
- `docs/adr/0003-event-schema-and-versioning.md` (spec)
- `docs/MASTER_DESIGN.md` (section C.1 — event taxonomy)

---

## TICKET-012 → TICKET-013, TICKET-015, TICKET-016, TICKET-018, TICKET-019

**From:** backend-engineer  
**To:** backend-engineer (TICKET-013), data-engineer (TICKET-015), qa-engineer (TICKET-016),
devops-engineer (TICKET-018), backend-engineer (TICKET-019)  
**Date:** 2026-05-01T00:00:00Z

**Summary:**

Cloudflare Worker ingest MVP shipped in `apps/ingest/`. Hono-based, p95 < 50 ms target.
`POST /v1/events` validates batches against `EventSchema` from `@estalara/shared`, authenticates via
`X-Estalara-API-Key` (KV lookup of `api_key:<token>` → `{tenant_id, scopes, hmac_secret?}`) with
optional `X-Estalara-Signature: hmac-sha256:<hex>` for server-side adapters, enriches each event
with server-side `tenant_id`, `region` (from `CF-IPCountry`), `ingest_received_at`, and pushes to
Redpanda via the HTTP REST proxy (Pandaproxy) with 3-attempt exponential backoff (100ms, 500ms,
2500ms). 47 vitest cases covering auth (missing/unknown/kv-error/HMAC paths), body shape (400/413),
happy path with rejection reporting, and Redpanda 5xx/4xx/network failure.

**Action required:**

For TICKET-013 (backend-engineer, Durable Object rate limiting):

1. Add a `RateLimiter` Durable Object. The DO binding `RATE_LIMITER` is already declared in
   `apps/ingest/wrangler.toml` (placeholder — `class_name` matches).
2. Wire the limiter into `events.post('/')` after auth, before parse — ID by `tenant_id` to keep the
   buckets per-tenant. Suggested: 100 req/min per tenant on Tier 1, configurable later.
3. On rate-limit hit, return 429 with `Retry-After`. Don't read body; rate-limit decisions must
   happen before JSON.parse to keep abusive-traffic cost low.

For TICKET-015 (data-engineer, Modal stream consumer):

1. Subscribe to topic `events` (or `events-staging`) on Redpanda. Records are JSON-encoded events
   with the envelope plus server-side fields (`tenant_id`, `region`, `ingest_received_at`).
2. Validate each record again with `EventSchema` (defense-in-depth — should be a no-op in steady
   state), then batch-insert to ClickHouse.

For TICKET-016 (qa-engineer, ingest smoke test):

1. End-to-end smoke: `wrangler dev` + curl with a real test API key seeded into KV. Verify 200 shape
   (`accepted`, `rejected`, `batch_id`).
2. Negative path: missing key → 401, malformed event → 200 with rejection reported.

For TICKET-018 (devops-engineer, observability):

1. The Worker already wraps with `withSentry` (`apps/ingest/src/observability.ts`). Add structured
   span instrumentation around: auth lookup, Zod parse, Redpanda push (3 separate spans).
2. Tag spans with `tenant_id` (after auth), batch size, accepted/rejected counts.

For TICKET-019 (backend-engineer, idempotency):

1. Use `event.event_id` (UUIDv7) as idempotency key. Suggested: 24h Redis TTL via Upstash binding.
2. Dedup decisions happen post-validate, pre-push. Skip duplicates silently from `accepted` count.

**Files:**

- `apps/ingest/src/index.ts` (Hono entry-point + `withSentry` wrapping)
- `apps/ingest/src/router.ts` (Hono routes: `/health`, `/v1/events`, 404, 500)
- `apps/ingest/src/handlers/events.ts` (`POST /v1/events` logic)
- `apps/ingest/src/auth.ts` (`authenticateRequest`, `computeHmacSha256Hex` helper)
- `apps/ingest/src/redpanda-producer.ts` (REST proxy producer with retry + abort)
- `apps/ingest/src/region.ts` (CF-IPCountry → region mapper)
- `apps/ingest/src/types.ts` (`Env` shared bindings)
- `apps/ingest/wrangler.toml` (`KV_API_KEYS` binding placeholder, REDPANDA env vars per env)
- ADR-0003 (`docs/adr/0003-event-schema-and-versioning.md`)
- Master Design C.2 (ingestion strategy), I.2 (backend stack)

---

## TICKET-009 → TICKET-014 (ClickHouse)

**From:** devops-engineer  
**To:** data-engineer  
**Date:** 2026-04-27T14:00:00Z

**Summary:**

ClickHouse Cloud Terraform module skeleton created at `infra/terraform/clickhouse/`. The module
includes provider configuration, variables for organization ID and API credentials, and
commented-out resource definitions for ClickHouse service and password. The README documents cost
estimation (~$750-$1,000/month for EU region at MVP scale), architecture decisions (columnar storage
for append-only events), and performance budgets (<50ms write latency, <500ms query latency).

**Action required:**

1. Wait for human to create ClickHouse Cloud account and store credentials in Doppler (see
   ESCALATIONS.md)
2. Uncomment `resource "clickhouse_service"` and `resource "clickhouse_service_password"` in
   `main.tf`
3. Run `terraform apply` to provision EU region service
4. Use service endpoint and password to create first ClickHouse table (events table, partitioned by
   `tenant_id` + `date`)
5. Document table DDL and migration strategy in TICKET-014

**Files:**

- `infra/terraform/clickhouse/main.tf`
- `infra/terraform/clickhouse/variables.tf`
- `infra/terraform/clickhouse/README.md`
- `docs/runbooks/vendor-accounts.md` (section 2: ClickHouse Cloud)

---

## TICKET-009 → TICKET-015 (Modal)

**From:** devops-engineer  
**To:** data-engineer  
**Date:** 2026-04-27T14:00:00Z

**Summary:**

Modal does NOT have a Terraform provider (code-as-config via Python decorators instead). Created
`infra/terraform/modal/modal-config/` with `modal.toml` skeleton, `modal_setup.py` verification
script, and comprehensive README documenting Modal architecture, cost estimation (~$765/month for
MVP), and deployment strategy (`modal deploy` per-app in CI). Modal is used for stream consumer
(Redpanda → ClickHouse ETL), intent engine, adaptation engine, and auto-detection service.

**Action required:**

1. Wait for human to create Modal account, generate token (ID + secret), and store in Doppler
2. Authenticate Modal CLI locally:
   `modal token set --token-id $MODAL_TOKEN_ID --token-secret $MODAL_TOKEN_SECRET`
3. Create Modal secrets for third-party credentials (Anthropic API, Supabase, ClickHouse) via
   `modal secret create` (documented in runbook)
4. Implement stream consumer app in `apps/<stream-consumer>/src/main.py` (subscribe to Redpanda
   `events` topic, batch insert to ClickHouse)
5. Deploy via `modal deploy apps/<app>/src/main.py`

**Files:**

- `infra/terraform/modal/modal-config/modal.toml`
- `infra/terraform/modal/modal-config/modal_setup.py`
- `infra/terraform/modal/README.md`
- `docs/runbooks/vendor-accounts.md` (section 3: Modal)

---

## TICKET-009 → TICKET-020 (Supabase + Drizzle)

**From:** devops-engineer  
**To:** backend-engineer  
**Date:** 2026-04-27T14:00:00Z

**Summary:**

Supabase Terraform module skeleton created at `infra/terraform/supabase/`. The module includes
provider configuration, variables for Personal Access Token (PAT), organization ID, and database
password, and commented-out resource definitions for Supabase project. The README documents
multi-region architecture (EU/US/UK/UAE), cost estimation (~$100/month base for 4 regions), and
security notes (RLS policies required per-tenant, pgBouncer for connection pooling with 25
connections per region per service).

**Action required:**

1. Wait for human to create Supabase account, generate PAT, find org ID, and store all in Doppler
2. Uncomment `resource "supabase_project"` in `main.tf`
3. Run `terraform apply` to provision EU region project (Pro tier, $25/month)
4. Set up Drizzle ORM (`packages/db` or `apps/control-plane/db/`) with connection to Supabase
   Postgres
5. Create first migration: `tenants` table with RLS policies (see TICKET-021)
6. Document migration workflow (Drizzle vs. Supabase migrations UI vs. raw SQL)

**Files:**

- `infra/terraform/supabase/main.tf`
- `infra/terraform/supabase/variables.tf`
- `infra/terraform/supabase/README.md`
- `docs/runbooks/vendor-accounts.md` (section 1: Supabase)

---

## TICKET-003 → TICKET-018

**From:** devops-engineer  
**To:** devops-engineer  
**Date:** 2026-04-27  
**Summary:** Sentry + OTel baseline in packages/shared/src/observability/. Ingest wrapper at
apps/ingest/src/observability.ts. DSN env vars: SENTRY_DSN_INGEST (ingest), SENTRY_DSN_CONTROL_PLANE
(control-plane). OTel collector skeleton at infra/observability/otel-collector.yaml.  
**Action required:** TICKET-018 should add real span instrumentation to the ingest handler using
createTracer() and createLogger() from packages/shared/src/observability.  
**Files:**

- `packages/shared/src/observability/logger.ts`
- `packages/shared/src/observability/tracer.ts`
- `packages/shared/src/observability/error.ts`
- `packages/shared/src/observability/index.ts`
- `apps/ingest/src/observability.ts`
- `apps/control-plane/sentry.client.config.ts`
- `apps/control-plane/sentry.server.config.ts`
- `apps/control-plane/sentry.edge.config.ts`
- `infra/observability/otel-collector.yaml`
- `docs/runbooks/observability.md`

---

## TICKET-005 → TICKET-007, TICKET-033

**From:** devops-engineer  
**To:** backend-engineer (TICKET-007), ml-engineer (TICKET-033)  
**Date:** 2026-04-29

**Summary:**

`apps/auto-detect/` Python placeholder app created following the same pattern as
`apps/intent-engine/`. The app includes pyproject.toml with setuptools.build_meta build backend,
src/main.py with `is_ready()` function, tests/test_smoke.py with passing pytest tests, and README.md
referencing Master Design sections B.4-B.7 (Auto-Onboarding, Schema Discovery, Continuous
Validation, Pre-Built Templates). CI workflow updated to include auto-detect in Python test matrix.

**Action required:**

For TICKET-007 (backend-engineer):

1. Add `auto_detected_schema` field to TenantConfig schema in `packages/db/src/schema.ts`
2. Field should store JSON mapping:
   `{ selectors: {...}, confidence: number, detected_at: timestamp }`
3. Document field purpose and update migration script

For TICKET-033 (ml-engineer):

1. Implement real auto-detection logic in `apps/auto-detect/src/main.py`
2. Add dependencies: puppeteer (or playwright), anthropic SDK, modal SDK
3. Implement Puppeteer screenshot capture + Claude Vision analysis
4. Add Modal serverless deployment decorator (@stub.function)
5. Create tests beyond smoke tests (mock Vision API, test selector extraction)

**Files:**

- `apps/auto-detect/README.md`
- `apps/auto-detect/pyproject.toml`
- `apps/auto-detect/src/main.py`
- `apps/auto-detect/src/__init__.py`
- `apps/auto-detect/tests/test_smoke.py`
- `.github/workflows/ci.yml` (auto-detect added to Python test matrix)

---

## TICKET-020 → TICKET-021, TICKET-022, TICKET-023, TICKET-029

**From:** backend-engineer **To:** backend-engineer **Date:** 2026-05-03T00:00:00Z

**Summary:** Drizzle ORM set up in `packages/db`. `createClient()` exported from
`packages/db/src/client.ts`, supporting both direct (transaction mode, port 5432) and pooled
(session mode, port 6543) connections. `drizzle.config.ts` ready for `drizzle-kit` commands.
`migrations/` folder exists (`.gitkeep`). Root `package.json` wired with `db:generate`,
`db:migrate`, `db:studio`, `db:push:dev` scripts. All downstream tickets (021/022/023/029) can now
add schema files to `packages/db/src/schema/`, re-export from the barrel `index.ts`, and run
`pnpm db:generate` + `pnpm db:migrate`.

**Action required:**

For TICKET-021 and downstream:

1. Add a schema file at `packages/db/src/schema/<table-name>.ts` using `pgTable` from
   `drizzle-orm/pg-core`.
2. Re-export from `packages/db/src/schema/index.ts`.
3. Run `pnpm db:generate` to generate the SQL migration file.
4. Add RLS policies to the generated migration file before applying.
5. Run `pnpm db:migrate` to apply (requires `DATABASE_URL_DIRECT` env var).

**Files:**

- `packages/db/src/client.ts`
- `packages/db/src/index.ts`
- `packages/db/src/schema/index.ts`
- `packages/db/drizzle.config.ts`
- `packages/db/scripts/migrate.ts`
- `packages/db/scripts/seed.ts`
- `packages/db/migrations/.gitkeep`
- `packages/db/README.md`

---

## Sprint 7 Phase 1 — Architect review

**From:** pm-orchestrator (architect role) **To:** backend-engineer (TICKET-ADP-001), sdk-engineer
(TICKET-ADP-003) **Date:** 2026-05-11T00:00:00Z **Summary:** Pre-implementation findings for Sprint
7 Phase 1. No blockers found.

### Finding 1 — Canonical ArchetypeId source

`Archetype` type is defined in `packages/sdk/src/core/intent.ts` (18 values + 'neutral' fallback).
In `packages/shared/src/directives.ts`, the `ArchetypeId` type MUST be declared as an inline union
(copy the 18 + 1 values verbatim). Do NOT import from `packages/sdk` — that would create a circular
workspace dependency (`shared` → `sdk` while `sdk` already depends on `shared` implicitly through
the event types). Keeping `ArchetypeId` inline in `directives.ts` is the correct pattern.

### Finding 2 — ClickHouse migration location

Confirmed: `infra/clickhouse/migrations/`. Existing files are `0001_create_events.sql` and
`0002_create_session_summary_mv.sql`. New file must be `0003_create_adaptation_decisions.sql`. The
migration runner substitutes `MergeTree` for `ReplicatedMergeTree` in CI (see comment in
0001_create_events.sql). Use `MergeTree()` in the new migration.

### Finding 3 — errorBody canonical helper

Confirmed: `errorBody()` in `packages/shared/src/errors.ts` is the canonical helper. Import it as:
`import { errorBody, ErrorCode } from '@estalara/shared'`.

### Finding 4 — GET /api/adapt does not exist yet

The route at `apps/control-plane/src/app/api/adapt/route.ts` does NOT exist. TICKET-042 wired the
SDK to call `/api/adapt` but the route was never created (the stub referenced in the briefing was
from PR #42 which created a different stub). Backend-engineer must create the directory and file
from scratch.

### Finding 5 — control-plane cannot import @estalara/sdk currently

`apps/control-plane/package.json` does NOT include `@estalara/sdk` as a dependency. The playbooks
module (to be built in ADP-003) lives in `packages/sdk/src/core/playbooks/`. Resolution:

- For ADP-001: backend-engineer creates a minimal LOCAL stub for `getPlaybook()` inside
  `apps/control-plane/` (co-located with the route file). This avoids the dependency issue entirely.
- For ADP-003: sdk-engineer builds the real playbooks in `packages/sdk/src/core/playbooks/` AND adds
  `@estalara/sdk` as a workspace dependency to `apps/control-plane/package.json`, then updates the
  control-plane route to import from `@estalara/sdk` using a deep import path
  `@estalara/sdk/playbooks` (add this to SDK `exports` in `package.json`), OR the sdk-engineer moves
  the stub replacement inline. The preferred approach: add the `playbooks` subpath export to
  `packages/sdk/package.json` so control-plane can do
  `import { getPlaybook } from '@estalara/sdk/playbooks'`.

### Finding 6 — No conflicts with existing code

- `packages/shared/src/directives.ts` is a new file — no conflicts.
- `infra/clickhouse/migrations/0003_*` is new — no conflicts.
- `apps/control-plane/src/app/api/adapt/route.ts` is new (directory does not exist) — no conflicts.
- `packages/sdk/src/core/playbooks/` is new — no conflicts (adapt.ts uses
  `fetchDirectives`/`applyDirectives` which remain untouched).

### No blockers. Backend-engineer may proceed with TICKET-ADP-001.

---

## TICKET-ADP-001 → TICKET-ADP-003

**From:** backend-engineer **To:** sdk-engineer **Date:** 2026-05-11T20:36:18Z **Summary:** ADP-001
merged via PR #67. Decision API is live at `GET /api/adapt` with the full 4-branch decision tree.
New types are in `packages/shared/src/directives.ts` (exported from `@estalara/shared`). A stub
`getPlaybook()` exists in `packages/sdk/src/core/playbooks/index.ts` that returns empty playbooks —
ADP-003 replaces this with the real 18-archetype registry. The control-plane route imports from a
local `playbook-stub.ts` co-located in the adapt directory — ADP-003 replaces that import with the
real SDK playbooks.

**Action required for sdk-engineer (ADP-003):**

1. Build all 18 playbook files in `packages/sdk/src/core/playbooks/archetypes/` per the spec in
   `backlog/sprint-7/TICKET-ADP-003.md`.
2. Replace `packages/sdk/src/core/playbooks/index.ts` stub with the real `PlaybookRegistry`
   exporting `getPlaybook()` and `getAllPlaybooks()`.
3. Replace `packages/sdk/src/core/playbooks/types.ts` (does not exist yet — create it) with the
   `PlaybookEntry`, `SlotDirective`, `ListingClassRule` types.
4. For the control-plane integration:
   - Add `"@estalara/sdk": "workspace:*"` to `apps/control-plane/package.json` dependencies.
   - Add a `"./playbooks"` subpath export to `packages/sdk/package.json` exports pointing to the
     built playbooks index:
     `"./playbooks": { "import": "./dist/core/playbooks/index.js", "types": "./dist/core/playbooks/index.d.ts" }`.
   - Ensure `packages/sdk/tsup.config.ts` (or tsup configuration) includes
     `src/core/playbooks/index.ts` as a separate entry so it gets compiled.
   - Update `apps/control-plane/src/app/api/adapt/route.ts` to replace:
     `import { getPlaybook } from './playbook-stub';` with:
     `import { getPlaybook } from '@estalara/sdk/playbooks';`
   - Delete `apps/control-plane/src/app/api/adapt/playbook-stub.ts` (it's a stub).
5. Run `pnpm install` after adding the workspace dependency.
6. Write integration tests verifying the Decision API + real playbooks produce correct directives
   for yield_hunter (confidence=0.75, similarity=0.90), family_buyer (confidence=0.80,
   similarity=0.88), lifestyle_expat (confidence=0.70, similarity=0.95).

**Files produced by ADP-001:**

- `packages/shared/src/directives.ts` — `ArchetypeId`, `TextDirective`, `ClassDirective`,
  `AdaptationDirectives` interfaces
- `packages/shared/src/index.ts` — added `directives.js` re-export
- `packages/sdk/src/core/playbooks/index.ts` — STUB to be replaced by ADP-003
- `apps/control-plane/src/app/api/adapt/route.ts` — real GET /api/adapt handler
- `apps/control-plane/src/app/api/adapt/playbook-stub.ts` — temporary stub, DELETE in ADP-003
- `apps/control-plane/src/app/api/adapt/route.test.ts` — 25 tests
- `infra/clickhouse/migrations/0003_create_adaptation_decisions.sql` — analytics table DDL

---

## Sprint 7 Phase 2 — Architect review

**From:** pm-orchestrator (architect role) **To:** sdk-engineer (ADP-004), backend-engineer
(ADP-002), data-engineer (DQS-001) **Date:** 2026-05-11T06:00:00Z **Summary:** Pre-implementation
findings for Sprint 7 Phase 2.

### Finding A1 — adapt.ts local Directive type is misaligned with shared directives.ts

`packages/sdk/src/core/adapt.ts` defines a LOCAL `Directive` interface (lines 13-18) with:

- `slot: string`
- `type: 'text' | 'order' | 'visibility' | 'class'`
- `value: string | string[]`

`packages/shared/src/directives.ts` defines `TextDirective` and `ClassDirective` which are
structurally different:

- `TextDirective` has `slot`, `value` (string), `archetype`, `confidence`
- `ClassDirective` has `selector` (NOT `slot`), `add[]`, `remove[]`, `archetype`, `confidence`

The current `applyDirectives()` in adapt.ts operates on local `Directive[]` and handles
ClassDirective via `directive.slot` (wrong) and `directive.value as string[]` (wrong). ADP-004 must
replace the function signature to accept `(TextDirective | ClassDirective)[]` (imported from
`@estalara/shared`) and implement correct logic per each type. The local `Directive` interface
should be removed or kept only for legacy internal use with a deprecation comment.

### Finding A2 — AdaptResponse in adapt.ts uses local Directive, not AdaptationDirectives from shared

`fetchDirectives()` returns `AdaptResponse` which has `directives: Directive[]`. After ADP-004's
work, `fetchDirectives()` should return the shared `AdaptationDirectives` type (or the response
should be unwrapped to pass `directives: (TextDirective | ClassDirective)[]` to
`applyDirectives()`). The safest path: keep `fetchDirectives()` returning a local response type with
the correct directive union, and have `applyDirectives()` accept
`(TextDirective | ClassDirective)[]`. This avoids renaming the entire response type. Confirm the
Decision API now returns `AdaptationDirectives` shape per ADP-001 — the SDK `fetchDirectives()` must
accept that response shape.

### Finding A3 — Event queue for adapt.applied/adapt.skipped events

`packages/sdk/src/core/events.ts` exposes `CollectedEvent` type and `dispatchEvents()` function. The
module-level event collection works via a queue flushed on 5s interval in
`packages/sdk/src/index.ts`. ADP-004 needs to push `adapt.applied` and `adapt.skipped` events into
this same queue. sdk-engineer must import the event queue from `packages/sdk/src/index.ts` (or
expose a `queueEvent()` helper in events.ts) to push into the flush cycle. Do NOT create a separate
flush timer.

### Finding A4 — Idempotency Set must survive session resets

The idempotency `Set<string>` used to track applied directive fingerprints must be reset when
`getOrCreateSession()` returns a fresh session (i.e., `sessionStorage` has no stored session or a
new tab is opened). sdk-engineer should either: (a) tie the Set lifetime to the session by exporting
a `resetAdaptState()` function from adapt.ts that clears the Set, called from session initialization
in `src/index.ts`, OR (b) key the fingerprint Set on session_id so it auto-invalidates across
sessions.

### Finding A5 — DOM ready guard interacts with DOMContentLoaded listener leak

The DOM-ready guard (queue directives if `document.readyState === 'loading'`) must use a one-time
event listener (`{ once: true }` option on addEventListener) to avoid accumulating listeners across
multiple `applyDirectives()` calls before DOM is ready.

### Finding A6 — DQS-001 session integration point

`packages/sdk/src/index.ts` wires the session, event queue, and observer together. DqsTracker from
DQS-001 should be instantiated once in `src/index.ts` (not in dqs.ts itself). The 5th-event trigger
should hook into the event dispatch path — data-engineer should add a counter in the existing event
queue flush logic rather than adding a second observer. Concrete integration: add
`onEventDispatched?: (count: number) => void` callback to the `SdkConfig` or expose a module-level
counter in events.ts.

### Finding A7 — commitlint DQS- prefix missing

`commitlint.config.cjs` at line 104 has regex:
`/\[TICKET-(?:FIX-|INFRA-|DEMO-|ADM-|QUIZ-|DB-|EMB-|ARCH-|ADP-)?\d+\]|\[ESCALATION\]/` DQS- prefix
is NOT present. DQS-001 FIRST commit must add `DQS-` to this regex. If this is not done first, ALL
DQS-001 commits will fail CI commitlint check.

### Finding A8 — ADP-002 ClickHouse cost-cap query

ADP-002 needs to query ClickHouse rolling 24h `cost_usd` sum for the circuit breaker. The existing
ClickHouse client pattern is in `apps/ingest/` or `infra/clickhouse/`. Check how TICKET-014/015
wired the ClickHouse HTTP client — backend-engineer should reuse the same pattern rather than
introducing a new HTTP client library.

### No blockers. sdk-engineer may proceed with ADP-004. ADP-002 and DQS-001 wait for ADP-004 merge.

---

## TICKET-ADP-003 → TICKET-ADP-004, TICKET-ADP-002, TICKET-DQS-001

**From:** sdk-engineer (ADP-003) **To:** sdk-engineer (ADP-004), backend-engineer (ADP-002),
data-engineer (DQS-001) **Date:** 2026-05-11T22:00:00Z **Summary:** ADP-003 merged via PR #68
(commit ecf5d4b). 18 archetype playbooks are live in `packages/sdk/src/core/playbooks/archetypes/`.
The `./playbooks` subpath export is wired in `packages/sdk/package.json` and tsup.config.ts. The
control-plane Decision API now imports from `@estalara/sdk/playbooks` (stub deleted).

**Action required for ADP-004 (sdk-engineer):**

- `applyDirectives()` at `packages/sdk/src/core/adapt.ts:70` has incomplete implementation with
  wrong ClassDirective handling (see Architect Finding A1). Full spec in ticket brief.
- Archetype playbook slot values are in e.g. `yield-hunter.ts` under `slots[]` — use these as the
  expected test values in E2E assertions.

**Action required for ADP-002 (backend-engineer):**

- `PlaybookEntry` type is exported from `@estalara/sdk/playbooks`. Import it for the
  `LlmGatewayInput.basePlaybook` type.
- The Decision API route at `apps/control-plane/src/app/api/adapt/route.ts` is the wiring point.

**Action required for DQS-001 (data-engineer):**

- Read `packages/sdk/src/core/events.ts` for the event queue integration point.
- The ArchetypeId type lives in `packages/shared/src/directives.ts` — import from there, not sdk.

**Files produced by ADP-003:**

- `packages/sdk/src/core/playbooks/archetypes/*.ts` — 18 archetype playbook files
- `packages/sdk/src/core/playbooks/index.ts` — PlaybookRegistry with getPlaybook(),
  getAllPlaybooks()
- `packages/sdk/src/core/playbooks/types.ts` — PlaybookEntry, SlotDirective, ListingClassRule types
- `packages/sdk/tsup.config.ts` — playbooks subpath entry added
- `packages/sdk/package.json` — ./playbooks subpath export added
- `apps/control-plane/src/app/api/adapt/route.ts` — updated to import from @estalara/sdk/playbooks

---

## TICKET-AB-006, TICKET-AB-007 → FOLLOW-009, FOLLOW-014, TICKET-AB-004 (panels 1+3)

**From:** data-engineer **To:** backend-engineer (FOLLOW-014), data-engineer (FOLLOW-009) **Date:**
2026-05-14T21:00:00Z **PR:** #107

**Summary:**

TICKET-AB-006 seeds `ab_bandit_weights` with 18 rows × `variant='default'` × `Beta(1,1)` per tenant.
Migration `0007_seed_ab_bandit_weights.sql` backfills existing tenants. New `POST /api/tenants`
route seeds new tenants at creation time via `seedBanditWeightsForTenant()` in
`apps/control-plane/src/lib/bandit-seed.ts`.

TICKET-AB-007 wires `holdout_group` into every `adaptation_decisions` ClickHouse INSERT.
`logDecisionAsync()` in `apps/control-plane/src/app/api/adapt/route.ts` now accepts a `holdoutGroup`
parameter (default `false`). GET accepts `?holdout_group=true|false`; POST body accepts
`holdout_group: boolean`. The column was added by TICKET-AB-001 migration
`0006_adaptation_decisions_holdout.sql` but was never populated — this PR fixes that.

**Action required:**

- **FOLLOW-014** (backend-engineer): Replace mock `GET /api/ab/weights` with real Drizzle SELECT
  from `abBanditWeights`. The seed rows are now present so the query will return data. See
  `apps/control-plane/src/app/api/ab/weights/route.ts`.

- **FOLLOW-009** (data-engineer): Build the regression-detection cron
  `apps/data-quality/src/crons/ab_regression_detection.py`. Can now query
  `SELECT holdout_group, COUNT(*) FROM adaptation_decisions` and get meaningful results.

- **AB-004 dashboard** (backend-engineer): Panel 1 (Adapted vs Holdout) and Panel 3 (Conversion lift
  vs holdout) will now read real data once live traffic flows. Verify in staging.

**Files produced:**

- `packages/db/migrations/0007_seed_ab_bandit_weights.sql`
- `apps/control-plane/src/lib/bandit-seed.ts` — `seedBanditWeightsForTenant(tenantId)`
- `apps/control-plane/src/app/api/tenants/route.ts` — `POST /api/tenants` with seed hook
- `apps/control-plane/src/app/api/adapt/route.ts` — `logDecisionAsync()` + GET/POST changes

---

## TICKET-AB-005 → TICKET-AB-012 (FOLLOW-017)

**From:** backend-engineer **To:** backend-engineer **Date:** 2026-05-14T20:45:00Z

**Summary:** ab.assignment event emission wired into the decision-api adapt route. The producer
helper lives at `apps/decision-api/src/lib/ab-events.ts` (`publishAbAssignmentEvent`), which
delegates to the new `apps/decision-api/src/lib/redpanda-producer.ts` (mirrors the ingest worker
producer). The call in `route.ts` is fire-and-forget (void IIFE + try/catch + Sentry tag
`ab_assignment_emit_failed`). Guarded by `env.REDPANDA_REST_URL` presence. Skipped assignments
(opted_out / unknown / none consent with consent_mode_enabled=true) never emit an event. 9 new
integration tests verify call-count per scenario and payload schema conformance.

**Action required for FOLLOW-017 (holdout gating on control-plane POST /api/adapt):**

Import and reuse `publishAbAssignmentEvent` from `apps/decision-api/src/lib/ab-events.ts`. Do NOT
duplicate the envelope construction logic. The function accepts `AbAssignmentEventArgs` which
includes the Redpanda env bindings and optional `PushOptions` for test mocking.

**Files:**

- `apps/decision-api/src/app/api/adapt/route.ts` — emission wired at step 4b
- `apps/decision-api/src/lib/ab-events.ts` — `publishAbAssignmentEvent` helper (new file)
- `apps/decision-api/src/lib/redpanda-producer.ts` — edge-compatible producer (new file)
- `apps/decision-api/src/index.ts` — Env interface extended with Redpanda bindings
- `apps/decision-api/src/__tests__/adapt.test.ts` — 9 new TICKET-AB-005 integration tests

---

## TICKET-AB-008, TICKET-AB-009 → FOLLOW-017 (holdout gating on control-plane POST)

**From:** backend-engineer **To:** backend-engineer **Date:** 2026-05-14T23:10:00Z

**Summary:** AB-008 replaced mock `/api/ab/weights` with real Drizzle SELECT from
`ab_bandit_weights`. Auth via `getAuthClaims()` JWT — `tenant_id` from verified claim
(TICKET-FIX-014 compliant). Optional `?archetype=` filter supported. Mock helpers deleted. AB-009
wired `ReorderDirective` into the `decision-api` Worker adapt route. Canonical helpers live at
`apps/decision-api/src/lib/reorder.ts` (`getTenantSchema`, `buildReorderDirective`). The
control-plane adapt route duplicates the helpers with a comment pointing to the canonical source
(cross-app TS imports not supported). `listing_ids` Zod schema is now identical in both routes:
`z.array(z.string().max(64)).max(100).optional()`. Holdout sessions always receive
`reorderDirectives: []`. Demo tenant (`est_demo_tenant`) backward compat preserved. 17 new tests in
`adapt.test.ts`.

**Action for FOLLOW-017:** Import `assignHoldout()` + `publishAbAssignmentEvent()` into
`apps/control-plane/src/app/api/adapt/route.ts` POST handler to add holdout gating (currently only
present in decision-api Worker). `reorder.ts` helpers are already importable from
`apps/decision-api/src/lib/reorder.ts`.

**Files:**

- `apps/decision-api/src/lib/reorder.ts` — NEW canonical module: `getTenantSchema`,
  `buildReorderDirective`
- `apps/decision-api/src/app/api/adapt/route.ts` — imports reorder.ts, emits ReorderDirective
- `apps/decision-api/src/__tests__/adapt.test.ts` — 17 new TICKET-AB-009 integration tests
- `apps/control-plane/src/app/api/ab/weights/route.ts` — real Drizzle reads, JWT auth
- `apps/control-plane/src/app/api/ab/weights/route.test.ts` — full rewrite with mocked DB
- `apps/control-plane/src/app/api/adapt/route.ts` — duplicate reorder helpers, eslint-disable banner

---

## TICKET-AB-010, TICKET-AB-011 → TICKET-NATIVE-001

**From:** backend-engineer **To:** sdk-engineer (NATIVE-001) **Date:** 2026-05-14T23:45:00Z

**Summary:** AB-010 added holdout gating to the control-plane `POST /api/adapt` handler.
`assignHoldout()` now runs at handler entry — consent-skipped sessions return empty directives
without `holdout_group`; holdout sessions return empty directives with `holdout_group: true`;
treatment sessions build directives as before. AB-011 replaced the `est_demo_tenant` hardcode in
`getTenantSchema()` with real DB lookup (`tenant_site_schemas` via Drizzle) + 5-min Upstash Redis
cache (`schema:{tenantId}`). Decision-api uses Redis HTTP + new internal endpoint
`GET /api/internal/schema?tenant_id=<id>` as DB fallback. Control-plane and decision-api are now in
sync. TICKET-NATIVE-001 is unblocked.

**Files:**

- `packages/shared/src/ab-holdout.ts` — new: assignHoldout() for cross-app use
- `apps/control-plane/src/app/api/adapt/route.ts` — holdout gate at POST entry
- `apps/control-plane/src/lib/tenant-schema.ts` — new: getTenantSchema() with DB + Redis
- `apps/control-plane/src/lib/ab-events.ts` — new: publishAbAssignmentEvent() for control-plane
- `apps/control-plane/src/app/api/internal/schema/route.ts` — new: internal schema endpoint
- `apps/decision-api/src/lib/reorder.ts` — getTenantSchema() now async, Redis + API fallback
- `apps/decision-api/src/index.ts` — added UPSTASH_REDIS_URL, SCHEMA_API_URL, SCHEMA_API_TOKEN

---

## TICKET-GDPR-001 → TICKET-GDPR-002, TICKET-GDPR-003, TICKET-GDPR-004

**From:** compliance-engineer **To:** backend-engineer (GDPR-002, GDPR-004) + compliance-engineer
(GDPR-003 docs portion) **Date:** 2026-05-15T00:00:00Z

**Summary:** DPIA v1.0 produced at `docs/compliance/dpia.md`; ROPA v1.0 produced at
`docs/compliance/ropa.md`. Both cover all four operational jurisdictions (EU GDPR, UK GDPR + PECR,
CCPA/CPRA, UAE PDPL + DIFC). The authoritative retention schedule table is at the top of `ropa.md`
and uses exact Postgres and ClickHouse table names (`session_embeddings`, `consent_records`,
`adaptation_decisions`, `llm_calls`, `ab_bandit_weights`, `archetype_embeddings`, `staff_audit_log`,
`answers`). Compliance README at `docs/compliance/README.md`. Cross-module interface registry at
`docs/INTERFACES.md`. CI gate script at `scripts/check-compliance-docs.sh`. IMPORTANT: This PR
requires Piotr Nawrocki sign-off before merge; GDPR-002/003/004 must not merge before GDPR-001 is
approved by Piotr.

**Action required:**

GDPR-002 (backend-engineer — DSR endpoints):

- Use retention periods from `ropa.md` retention table (top of file) as the authoritative source for
  deletion cascade TTLs.
- The DSR endpoint spec: `POST /api/v1/dsr/:tenant_id` with `type`, `identifier`, `requester_proof`,
  `jurisdiction`.
- Deletion cascade must cover: `session_embeddings` (Postgres), `consent_records` (Postgres — retain
  record, mark as revoked), `adaptation_decisions` (ClickHouse — delete rows by session_id),
  `llm_calls` (ClickHouse), Upstash Redis (delete session key), Modal caches.
- DSR token table is `dsr_tokens`; tokens expire 30 days after resolution.
- Audit every DSR action in `staff_audit_log`.

GDPR-003 (compliance-engineer — LIA template docs):

- Produce `docs/compliance/lia-template.md` using the LI analysis framework documented in DPIA
  Section 3 (Necessity and Proportionality) and Section 3.4 (CNIL June 2025 guidance).
- The template must cover the three-part LI balancing test per ICO guidance: (1) legitimate interest
  identified, (2) necessity test, (3) balancing test.

GDPR-004 (backend-engineer — consent state propagation):

- Use the mode definitions from DPIA Section 7 (Consent Strategy) for the consent decision tree.
- Mode A = session_only (ePrivacy 5(3)(b) strictly necessary); Mode B = consented (explicit CMP
  record); Mode C = legitimate_interest (narrow use cases only).
- Add `consent_required` boolean to `tenants` table (default `true` for EU/UK/UAE regions).
- Decision API must return default non-personalized directives if `consent_state !== 'consented'`
  for tenants that have set `consent_required = true`.

**Files:**

- `docs/compliance/dpia.md` — DPIA v1.0 (10 sections, 5 risks, 4 jurisdictions)
- `docs/compliance/ropa.md` — ROPA v1.0 (12 processing activities, 11 sub-processors, authoritative
  retention table)
- `docs/compliance/README.md` — Compliance document index
- `docs/INTERFACES.md` — Cross-module interface registry (new)
- `scripts/check-compliance-docs.sh` — CI gate script (jurisdiction grep checks, retention table
  completeness, sub-processor completeness)

---

## FOLLOW-171 → sdk-engineer (and FOLLOW-172)

**From:** backend-engineer **To:** sdk-engineer **Date:** 2026-06-03T00:00:00Z

**Summary:** The feedback endpoint `POST /api/adapt/feedback` now accepts two OPTIONAL fields —
`prediction_id` and `lead_id` — in addition to the existing
`{session_id, tenant_id, archetype, variant, converted}`. When `prediction_id` is present it
persists a durable `conversion_labels` row (Postgres, RLS) joining the prediction to its outcome
(Conversion Label Loop, MASTER_DESIGN §T). The `prediction_id` MUST be the `adapt_decision_id` the
SDK received in the `/api/adapt` response body (`AdaptationDirectives.adapt_decision_id`). Omitting
it is backward-compatible: the bandit still updates; only the durable label is skipped. The coarse
`converted` boolean maps to `viewing_booked` (true) / `no_response` (false); deeper outcome classes
come from CRM ingest (FOLLOW-172), not the SDK.

**Action required:** sdk-engineer — thread the `adapt_decision_id` from the adapt response into the
feedback ping body as `prediction_id` so warm conversions produce labeled training pairs. (Until
then the column exists and the route works, but `conversion_labels` stays empty in production.)
FOLLOW-172 — the CRM webhook writes the same `conversion_labels` table with `label_source='system'`
and deep `outcome_class` values, keyed by `prediction_id`/`lead_id`.

**Files:** `apps/control-plane/src/app/api/adapt/feedback/route.ts`,
`packages/db/src/schema/conversion_labels.ts`, `packages/shared/src/schemas/conversion-label.ts`,
`packages/db/migrations/0019_conversion_labels.sql`

---

## FOLLOW-172 compliance → backend-engineer

**From:** compliance-engineer **To:** backend-engineer **Date:** 2026-06-03T00:00:00Z

**Summary:** PII-boundary contract for `POST /api/crm/outcome` (CRM deep-outcome ingest). This is
the AC2 deliverable for FOLLOW-172. The contract covers the exact permitted/denied field set, the
lead_id resolution model, authentication, retention/lawful basis, DSR cascade extension, and the
dedup/idempotency recommendation. It also records required ROPA/DPIA updates that must be completed
before this endpoint goes live with a pilot tenant.

---

### A. PII-Boundary Contract

#### A.1 Permitted request body fields (ALLOW-LIST)

The webhook body schema MUST be restricted to exactly these fields. Any field not listed is DENIED
at the Zod schema layer (use `.strict()` on the Zod object so unknown keys are rejected, not
silently stripped).

| Field           | Type                           | Notes                                                                                                                                                                                                                                                                                                                                          |
| --------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prediction_id` | string, NOT NULL, max 256      | = `adapt_decision_id` issued by Estalara. The primary join key. Non-PII by design: it is a server-minted UUID that refers to an adaptation decision, not to a person.                                                                                                                                                                          |
| `lead_id`       | string, NOT NULL, max 256      | Opaque Estalara-issued token (see §A.3). Non-reversible to a natural person from Estalara's side. NOT a CRM contact ID.                                                                                                                                                                                                                        |
| `outcome_class` | `ConversionOutcomeClass` enum  | Must validate against the canonical `ConversionOutcomeClassSchema` from `@estalara/shared`. Accepted values: `offer_made`, `contract_signed`, `purchased`, `lost`. (`viewing_booked` and `no_response` are produced by the SDK feedback ping, not by CRM ingest; the schema SHOULD reject them on this path to enforce the taxonomy boundary.) |
| `outcome_raw`   | object (jsonb-bound), optional | See §A.2.                                                                                                                                                                                                                                                                                                                                      |
| `confidence`    | number (0–1), optional         | 1.0 for hard CRM facts; lower for inferred. Defaults to 1.0 if omitted.                                                                                                                                                                                                                                                                        |
| `labeled_at`    | ISO 8601 string, optional      | CRM event timestamp; defaults to server `now()` if omitted.                                                                                                                                                                                                                                                                                    |

#### A.2 outcome_raw — safety decision

`outcome_raw` stores the normalized inbound payload (after allow-list enforcement) in the
`conversion_labels.outcome_raw jsonb` column. The schema MUST apply allow-list enforcement BEFORE
persisting: only the permitted fields above are written into `outcome_raw`. The raw HTTP request
body is NEVER persisted as-is.

Rationale: if the tenant CRM sends a richer payload (e.g. contact name, email, address alongside the
outcome), and the server persists `JSON.parse(rawBody)` directly into `outcome_raw`, PII enters the
store. The mitigation is structural: parse the body with the strict Zod schema (`.strict()`), then
persist only `parsed.data` (the validated output) in `outcome_raw`. Unknown keys are rejected at 400
before the DB write, so `outcome_raw` can only ever contain fields in §A.1.

No server-side scrubbing pass is required as a secondary step PROVIDED the schema is strictly
enforced on every code path that writes `outcome_raw`. The backend-engineer must ensure there is no
"raw body passthrough" branch.

#### A.3 lead_id resolution model — CHOSEN MODEL: Option (i) Tenant resolves tenant-side

From §T.6, two options exist:

- (i) Tenant resolves the CRM record to the Estalara `lead_id` on their side, sends only the opaque
  token.
- (ii) Tenant-supplied opaque correlation token that Estalara issued earlier.

**Compliance selects Option (i) as the required default.** Justification:

1. Estalara never holds the mapping between `lead_id` and any CRM contact record. Without that
   mapping Estalara cannot perform re-identification; the link lives exclusively in the tenant's
   system.
2. Option (ii) requires Estalara to issue and store a correlation token, which introduces a new
   processing activity (issuing and logging per-lead tokens) without a proportionate benefit over
   (i). That activity would require ROPA/DPIA extension before it could launch.
3. Option (i) is consistent with the precedent set by `inquiry.completed` (§
   `packages/shared/src/ schemas/events/inquiry.ts`): that schema never carries PII; the CRM
   integration at the tenant side is responsible for bridging from the Estalara session context to
   the CRM record.

What makes `lead_id` non-reversible from Estalara's side: Estalara stores only the opaque string
value. The tenant is the only party that holds the mapping from that value to a named person. This
is structurally the same guarantee as the HMAC session fingerprint: Estalara cannot re-identify
without the tenant's private key / CRM mapping. The tenant's DPA and onboarding compliance gate are
the enforcement mechanism for ensuring `lead_id` values sent to Estalara are truly opaque.

The tenant onboarding compliance gate (§U) MUST include a new checkbox: "lead_id values sent to POST
/api/crm/outcome are Estalara-assigned pseudonymous tokens; we do not send CRM contact IDs, email
addresses, phone numbers, or any directly identifying value in this field." This is a contractual
commitment enforced in the DPA, not a technical guarantee Estalara can verify at the boundary.

#### A.4 Explicit DENY-LIST

The following fields, if present in the request body, MUST cause a 400 rejection (via `.strict()`
Zod validation):

- Names: `name`, `full_name`, `first_name`, `last_name`, `contact_name`, `client_name`, `buyer_name`
  and any variant (snake_case, camelCase, kebab-case).
- Email addresses: `email`, `email_address`, `contact_email`, and variants.
- Phone numbers: `phone`, `phone_number`, `mobile`, `tel`, `contact_phone`, and variants.
- Physical addresses: `address`, `street`, `city`, `postcode`, `postal_code`, `zip`, `country` and
  variants.
- CRM-native contact/lead identifiers that are reversible to a person on the CRM side:
  `crm_contact_id`, `crm_lead_id`, `crm_person_id`, `hubspot_contact_id`, `salesforce_lead_id`,
  `salesforce_contact_id`, and equivalents for any named CRM vendor.
- Free-text fields likely to contain PII: `notes`, `description`, `comments`, `message`, `memo`,
  `summary` (any open-ended string field not in the allow-list above).

Note: the `notes` column in the `conversion_labels` DB schema (migration 0019) is an INTERNAL field
populated by `manual_admin` reclassification via the admin UI, not by the CRM webhook. The webhook
MUST NOT accept a `notes` field in its body.

#### A.5 prediction_id handling

`prediction_id` is non-PII. It is a server-minted UUID (`adapt_decision_id`) that refers to an
`adaptation_decisions` row. It has no meaning outside Estalara's internal join. It is safe to store
without restriction. It is the primary key for attribution and must be NOT NULL on this endpoint
(unlike the feedback ping where it is optional for backward-compat). Reject with 400 if absent.

#### A.6 Authentication

HMAC-SHA256 tenant-scoped signature, mirroring `POST /api/adapt/feedback` (FOLLOW-051 threat model,
`apps/control-plane/src/app/api/adapt/feedback/route.ts`):

- Header: `Authorization: Bearer {rawApiKey}` + `X-Estalara-Signature: {hmacSha256OfBodyHex}`
- The HMAC key is the tenant's raw API key; the HMAC data is the raw request body text.
- Constant-time comparison required (copy `constantTimeEqual` from the feedback route).
- The `ADAPT_API_KEY` env-var ops fallback is acceptable for integration testing but MUST be
  documented as ops-only in code comments.
- `tenant_id` is derived from the authenticated API key lookup, NOT from the request body. The
  request body MUST NOT include a `tenant_id` field; the server pins `tenant_id` from auth context.
  This prevents a tenant from writing labels scoped to another tenant's `tenant_id`.

#### A.7 RLS

The `conversion_labels` insert MUST use the admin Supabase client with `app.current_tenant_id` set
to the authenticated tenant's UUID before the insert, so the RLS policy
`conversion_labels_tenant_isolation` (migration 0019) enforces tenant scope at the DB layer in
addition to the application layer.

---

### B. Retention and Lawful Basis

**Lawful basis:** Art. 6(1)(f) Legitimate Interest (model improvement — per-tenant conversion
classifier training corpus, §T.1). The LIA at `docs/compliance/lia-template.md` covers listing
personalization and model improvement. The CRM ingest processing is a direct extension of that
purpose (it adds the deep-outcome dimension to the prediction↔outcome pair). No new lawful basis
assessment is required, but the LIA must be updated to reference deep-outcome labels explicitly (see
§B.2 below).

CCPA: service provider operational necessity (Cal. Civ. Code § 1798.140(ag)); no "sale."

UAE PDPL: Art. 5(1)(c) legitimate interest.

**Retention posture:** `conversion_labels` rows contain `lead_id` (pseudonymous) + `prediction_id`
(non-PII) + `outcome_class` (non-PII) + `outcome_raw` (non-PII post allow-list enforcement). These
are training labels, not behavioral event data. Proposed retention: same 13-month window as
`adaptation_decisions` (the prediction side of the join), to keep the corpus usable for the Y2
fine-tuning cycle and consistent with the AI Act audit trail period already established for
`adaptation_decisions` in ROPA Activity 4.

RETENTION PROMISE IMPLEMENTATION DEPENDENCY: A 13-month TTL on `conversion_labels` does not yet
exist in the codebase. The nightly TTL cron that enforces retention on `session_embeddings` and
`engagement_scores` (ROPA retention table) does not cover `conversion_labels`. Before compliance can
sign off on a ROPA entry asserting "13-month retention enforced," a data-engineer TTL ticket MUST be
filed and merged (Rule N + K.2 join from guardrails). The backend-engineer MUST NOT document a
concrete retention period in any user-facing or tenant-facing disclosure without that TTL ticket
existing. Internal ROPA/DPIA references to "13 months" are permissible as design intent with the TTL
ticket as a prerequisite gate.

**DSR cascade extension:** `lead_id` erasure requests MUST cascade to `conversion_labels` rows
matching that `lead_id` within the same tenant. This extends the existing erasure semantics
documented in DPIA §8 and ROPA Activity 8. The DSR worker (`apps/control-plane/src/dsr/`) MUST be
updated to include `conversion_labels` in its Postgres cascade. This is a required AC for this
ticket to be considered compliant. The absence of this cascade would mean a data subject's erasure
right under GDPR Art. 17 is not honored for their conversion label rows.

---

### C. Required ROPA and DPIA Updates

Both updates are documentation-only deliverables that must be completed before this endpoint is
activated for any pilot tenant. They are NOT blockers for merging the implementation PR (CI/tests
can pass without them), but they ARE blockers for the tenant-facing go-live gate.

**C.1 ROPA — New Activity (Activity 14)**

Add to `docs/compliance/ropa.md` as Activity 14 — CRM Deep-Outcome Ingest:

- Activity name: CRM deep-outcome label ingest
- Controller: Tenant (controller for outcome data on their website) — Time2Show acts as Processor
- Purpose: Ingest deep conversion outcomes from tenant CRM webhooks (offer_made / contract_signed /
  purchased / lost) to build a durable prediction↔outcome training corpus for per-tenant fine-tuning
  (§T.1, §D.5.7)
- Lawful basis: Art. 6(1)(f) LI (model improvement); CCPA service provider; UAE PDPL Art. 5(1)(c)
- Data categories: prediction_id (non-PII), lead_id (pseudonymous), outcome_class (enum), confidence
  (real), labeled_at (timestamp). No names, no emails, no phone numbers, no CRM contact IDs.
- Retention: 13 months (same as adaptation_decisions) — CONDITIONAL on TTL ticket (see §B above)
- DSR cascade: lead_id erasure → conversion_labels rows deleted synchronously in Postgres
  transaction
- Security: HMAC-SHA256 tenant-scoped auth; RLS on tenant_id; allow-list Zod schema; outcome_raw
  contains only allow-listed fields

**C.2 DPIA — Processing Description Update (§2.3 / §2.5)**

Add `conversion_labels` to the System Components table (§2.3) and the Data Types and Retention table
(§2.5) in `docs/compliance/dpia.md`:

- §2.3: New row — "CRM Outcome Ingest | Supabase (Postgres) | Deep-outcome label persistence for
  per-tenant classifier training | prediction_id, lead_id (pseudonymous), outcome_class, confidence"
- §2.5: New row — "`conversion_labels` | Postgres (Supabase, per-region) | 13 months (PENDING TTL
  ticket) | LI (model improvement; AI Act audit trail consistency)"

Neither of these ROPA/DPIA updates requires external DPO sign-off before merge (no new category of
personal data; no new sub-processor; no new lawful basis — this is an extension of Activity 4). They
are required before go-live with a tenant per Appendix C trigger #3 ("new purpose of processing not
covered by existing activity record").

---

### D. Dedup / Idempotency Recommendation (Privacy Lens)

**Context:** Migration 0019 has no UNIQUE constraint on `(tenant_id, prediction_id)`. The feedback
ping (FOLLOW-171) and the CRM webhook (FOLLOW-172) can both write rows for the same `prediction_id`.
Multiple CRM webhook calls for the same outcome (CRM retry logic, at-least-once delivery) could
write duplicate rows.

**Data-minimization analysis:** From a GDPR Art. 5(1)(c) data minimization standpoint, storing
multiple rows for the same `(tenant_id, prediction_id)` with the same `outcome_class` is redundant
personal data. Redundant pseudonymous rows are not a high-risk issue (the data is already
pseudonymous and allow-listed), but they inflate the corpus, complicate DSR erasure (more rows per
`lead_id` to cascade-delete), and increase the attack surface for re-identification through
statistical analysis of label counts.

**Recommendation: upsert on `(tenant_id, prediction_id)` for same-source CRM retries, but allow
append for different `label_source` values.**

Specifically: add a partial unique index
`UNIQUE (tenant_id, prediction_id) WHERE label_source = 'system'` so that CRM webhook retries are
idempotent (upsert using
`ON CONFLICT DO UPDATE SET outcome_class = EXCLUDED.outcome_class, outcome_raw = EXCLUDED.outcome_raw, updated_at = now()`),
while `manual_admin` corrections can still create a new row with an updated outcome (or update
in-place — the backend+architect team should decide the admin UX). This keeps the corpus clean
without losing the manual override audit trail.

This recommendation has a privacy-positive rationale (minimization) but the final decision on the
constraint shape and the admin UX is a backend+architect call. File as a follow-up to the migration
if the constraint is not added in this PR.

---

### E. AC2 Sign-Off Statement

**Compliance signs off on FOLLOW-172 implementation IF AND ONLY IF the following conditions are
satisfied at code review and before go-live with any pilot tenant:**

1. **Schema boundary (MUST):** The Zod request body schema uses `.strict()`. No field outside §A.1
   is accepted. Unknown keys result in a 400, not silent strip.

2. **outcome_raw safety (MUST):** `outcome_raw` is populated exclusively from `parsed.data` (the
   Zod-validated output), never from `JSON.parse(rawBody)` or any partial raw body reference. There
   is no code path that writes unvalidated content to `outcome_raw`.

3. **lead_id semantics (MUST):** `prediction_id` is NOT NULL on this endpoint. `lead_id` is NOT NULL
   and does not accept any of the deny-listed CRM-native identifier patterns from §A.4 at the
   application layer. (Full enforcement relies on tenant DPA; the schema must at least reject empty
   strings — min length 1 — so "no lead_id" is a hard error, not a silently accepted blank.)

4. **tenant_id from auth context (MUST):** `tenant_id` written to `conversion_labels` is extracted
   from the authenticated API key, not from the request body. No `tenant_id` field is present in or
   accepted from the request body.

5. **Authentication (MUST):** HMAC-SHA256 verification mirrors the feedback route exactly:
   `constantTimeEqual`, 64-hex-char enforcement, raw body used as HMAC data, Bearer token as HMAC
   key.

6. **RLS (MUST):** The admin DB client sets `app.current_tenant_id` before the insert so the DB-
   layer RLS policy fires in addition to the application-layer tenant_id pin.

7. **DSR cascade (MUST):** The DSR worker's Postgres erasure transaction includes
   `DELETE FROM conversion_labels WHERE lead_id = $1 AND tenant_id = $2`. Absence of this is a P0
   compliance gap — the `lead_id` erasure right would be unhonored.

8. **ROPA Activity 14 and DPIA §2.3/§2.5 updates (MUST before go-live):** Both documentation updates
   in §C above are merged to main before any tenant is pointed at this endpoint.

9. **TTL ticket for conversion_labels retention (MUST before any tenant-facing retention
   disclosure): ** No documentation, banner, or API response may state a concrete retention period
   for `conversion_labels` rows until a data-engineer TTL enforcement ticket (cron or partition TTL)
   is filed, merged, and the TTL is verified in CI. Interim state: ROPA/DPIA may say "13 months (TTL
   enforcement pending FOLLOW-NNN)."

10. **Tenant onboarding gate update (MUST before first CRM-integrated tenant goes live):** The
    onboarding compliance gate must include the checkbox from §A.3: tenant contractually affirms
    that `lead_id` values are Estalara-assigned pseudonymous tokens, not CRM contact IDs or PII.

Conditions 1–7 are verifiable at code review of the implementation PR. Conditions 8–10 are go-live
gates, not PR-merge gates — but they must be tracked as open items in backlog/FOLLOW_UPS.md if not
satisfied at time of merge.

**Files produced:** This handoff entry in `backlog/HANDOFFS.md`. ROPA and DPIA updates are deferred
to a follow-up compliance PR (conditions 8 above) to be filed as a FOLLOW-NNN by
compliance-engineer.

**Action required (backend-engineer):** Implement
`apps/control-plane/src/app/api/crm/outcome/route.ts` satisfying AC2 conditions 1–7 above. File the
DSR cascade update in the same PR or as a parallel PR against `apps/control-plane/src/dsr/`. Confirm
in the PR description: (a) grep evidence of `.strict()` on the Zod schema, (b) grep evidence that
`outcome_raw` is assigned from `parsed.data` not `rawBody`, (c) grep evidence of
`app.current_tenant_id` set before insert, (d) grep evidence of
`DELETE FROM conversion_labels WHERE lead_id` in the DSR worker.

**Related tickets:** FOLLOW-170 (prediction enrichment, done), FOLLOW-171 (conversion_labels table,
done), FOLLOW-172 (this ticket), FOLLOW-173..175 (aggregation, admin UI, export — downstream
consumers of this corpus).

---

## FOLLOW-196 → FOLLOW-197

**From:** sdk-engineer **To:** sdk-engineer **Date:** 2026-06-06T00:00:00Z

**Summary:** Both CustomEvent payloads in Estalara-app have been extended with `user_uuid` and
`is_agent` identity fields. Changes are committed locally at
`/home/asipi/Projects/Estalara-app/web-master` (no public GitHub for this repo).

### What changed

**ChatBot.svelte** (`src/lib/ui/chatbot/ChatBot.svelte`):

- Added `userUuid: string | null = null` local variable.
- Updated `authStore.subscribe` callback to also capture `state.userUuid`.
- Extended `estalara:chat:message-sent` CustomEvent detail with:
  ```ts
  user_uuid: userUuid ?? null,   // Keycloak UUID — null when not authenticated
  is_agent: isAgent ?? false,    // true for agent-role users
  ```

**LiveSessions.svelte** (`src/lib/ui/listing/LiveSessions.svelte`):

- Added `isAgent: boolean = false` and `userUuid: string | null = null` local variables.
- Updated `authStore.subscribe` callback to also capture `state.isAgent` and `state.userUuid`.
- **Fixed event type**: corrected `'estalara:live:signup'` → `'live.signup'` (dot-separated). This
  matches `registerFeedbackListener` in `packages/sdk/src/core/adapt.ts` which listens for
  `event.type === 'live.signup'`. The previous `'estalara:live:signup'` type was a dead wire — the
  SDK adapter would never have fired the feedback ping even with FOLLOW-195 merged.
- Extended `live.signup` CustomEvent detail with:
  ```ts
  user_uuid: userUuid ?? null,
  is_agent: isAgent ?? false,
  ```

### Action required for FOLLOW-197 (sdk-engineer — SDK listeners)

When implementing the SDK listeners for `estalara:chat:message-sent` and `live.signup`:

1. The `estalara:chat:message-sent` listener receives
   `{ message, listing_id, char_count, locale, timestamp, user_uuid, is_agent }` in `event.detail`.
   Use `user_uuid` as the basis for `lead_id` derivation (hash with session salt, NEVER store raw).
   Filter signals where `is_agent === true` — do not send agent chat interactions to the bandit as
   conversion signals.

2. The `live.signup` listener is already registered by `registerFeedbackListener` in `adapt.ts`
   (lines ~237–283) via `document.addEventListener('live.signup', handleOutcome)`. The feedback ping
   fires automatically. FOLLOW-197 needs to additionally route the `user_uuid` from the event detail
   into the ingest batch as `lead_id` so the Conversion Label Loop can correlate.

3. Both events must be consent-gated — only dispatch to ingest when
   `getConsentState() === 'granted'` (or `'unknown'` with conservative behavior per tenant config).

**Files in Estalara-app (local only):**

- `/home/asipi/Projects/Estalara-app/web-master/src/lib/ui/chatbot/ChatBot.svelte`
- `/home/asipi/Projects/Estalara-app/web-master/src/lib/ui/listing/LiveSessions.svelte`

**SDK files (Adaptive-Listings repo, no changes needed for FOLLOW-196 scope):**

- `packages/sdk/src/core/adapt.ts` — `registerFeedbackListener` already wired for `'live.signup'`

---

## FOLLOW-275 (architect) → backend-engineer

**From:** architect **To:** backend-engineer **Date:** 2026-06-11T00:00:00Z

**Summary:** ADR-0011 (PROPOSED) decides option (b) — SDK runtime GET — as the transport for
post-activation-mutable quiz/widget config fields (`quiz_enabled`, `micro_polls_enabled`,
`language`, `accent_color`). The static embed snippet continues to carry only the immutable tenant
binding (API key, tenant ID, decision URL). The existing `GET /api/quiz/config` route already
returns the right shape; the gap is that the route requires a tenant JWT and the SDK runs in an
anonymous buyer context.

**Action required (backend-engineer):**

1. **New route `GET /api/quiz/public-config`** (preferred per ADR-0011) — API-key-authenticated,
   read-only, CORS-open, returning `{ quiz_enabled, micro_polls_enabled, language, accent_color }`.
   Auth: `Authorization: Bearer <tenant-api-key>` (the `data-api-key` from the embed snippet),
   verified against `tenants.api_key` with a constant-time compare. No `tenant_id` in the response.
   `Cache-Control: max-age=300, stale-while-revalidate=60`. Returns 401 on invalid key, 404 on
   tenant not found, 200 on success. CORS must allow `*` origins (buyer-facing sites, read-only).

2. **Auth model note:** because this is a new mutation-free route with a new auth mechanism
   (API-key-only, no JWT), it needs a Rule H reviewer sign-off on the auth model. The ADR (docs/adr/
   PROPOSED-FOLLOW-275-quiz-config-transport.md) covers the threat model for this surface. Review it
   before implementation. If you choose the alternative auth path (i) — adding an API-key auth
   branch to the existing `GET /api/quiz/config` — document the choice in the PR.

3. **Remove `data-quiz-enabled` and `data-micro-polls-enabled` emission from `buildSnippet()`.** The
   `quizEnabled` and `microPollsEnabled` params should be removed (or nulled) so the retired
   attributes are never emitted. Also remove the dataset reads for these two attributes from
   `readConfig()` in `packages/sdk/src/core/config.ts` — or mark them as DEPRECATED_FALLBACK so they
   serve as the error-path fallback until the SDK fetch succeeds.

4. **Correct over-asserting docstrings** in
   `apps/control-plane/src/components/onboarding/ DetectionPreview.tsx:135/208` and
   `apps/control-plane/src/components/onboarding/ DetectWizard.tsx:259` — update them to reflect
   that quiz/micro-poll config is fetched at SDK runtime, not threaded through the snippet.

5. **Producer test (AC5 / Rule L):** add a test that mocks the new `GET /api/quiz/public-config`
   route, calls the SDK init path that invokes it, and asserts the resulting `SdkConfig` carries
   `quiz.enabled` and `microPollsEnabled` sourced from the server response. Injection into
   `readConfig` directly does NOT satisfy Rule L.

**Nullability constraint (ADR-0011 wire contract):** all five fields in the 200 response
(`quiz_enabled`, `micro_polls_enabled`, `language`, `accent_color`, `tenant_id`) are non-nullable.
The SDK must not treat absence as an error; fall through to local defaults for any missing field. No
field is `string | null` on one side and `string | undefined` on the other — align both sides
explicitly.

**Files to touch:**

- `apps/control-plane/src/app/api/quiz/public-config/route.ts` (NEW)
- `apps/control-plane/src/app/api/quiz/config/route.ts` (no change required unless using path (i))
- `apps/control-plane/src/components/onboarding/DetectionPreview.tsx` (remove retired params from
  buildSnippet; update docstrings)
- `packages/shared/src/schemas/quiz-config.ts` (add `QuizPublicConfigResponseSchema` Zod schema if
  new route is added)

**ADR:** `docs/adr/PROPOSED-FOLLOW-275-quiz-config-transport.md`

---

## FOLLOW-275 (architect) → sdk-engineer

**From:** architect **To:** sdk-engineer **Date:** 2026-06-11T00:00:00Z

**Summary:** ADR-0011 (PROPOSED) decides that the SDK fetches quiz/widget config at runtime via a
new `GET /api/quiz/public-config` endpoint (API-key-authenticated, CORS-open). This replaces the
`data-quiz-enabled` and `data-micro-polls-enabled` snippet attributes as the config transport for
these post-activation-mutable fields.

**Action required (sdk-engineer):**

1. **`fetchQuizConfig()` in `packages/sdk/src/core/`** — new async function that:
   - GETs `${config.decisionApiUrl}/quiz/public-config` (or a dedicated config URL derived from the
     existing `decisionApiUrl`) with `Authorization: Bearer ${config.apiKey}`.
   - 1000 ms timeout; on error/timeout falls back to any snippet-attribute values present, then to
     hardcoded defaults (`quiz.enabled = true`, `microPollsEnabled = false`).
   - Returns
     `{ quizEnabled: boolean, microPollsEnabled: boolean, language: QuizLanguage, accentColor: string }`.

2. **Thread into init sequence** — wire `fetchQuizConfig()` into `init()` in
   `packages/sdk/src/ index.ts` BEFORE `scheduleQuizTrigger()` and the micro-poll 90 s timer. The
   quiz/micro-poll schedulers must `await` this fetch (or its fallback). Do NOT block DOM
   augmentation or archetype detection on the fetch; only the quiz/micro-poll scheduling is
   sequenced after it.

3. **Retire dataset reads** — once the runtime fetch is wired, remove or deprecate
   `dataset.quizEnabled` and `dataset.microPollsEnabled` from `readConfig()` in `config.ts`. Keep
   them as DEPRECATED_FALLBACK for the error path (backward-compat for legacy snippets with these
   attributes present) with a comment explaining they are fallback-only.

4. **Rule R check** — the resolved `microPollsEnabled` and `quizEnabled` values must NOT be
   re-fetched on cross-listing navigation if the SDK is rehydrating an existing session. Gate the
   fetch behind `!intentStateRehydrated` OR ensure the fetch result is persisted in the session
   envelope and restored on rehydrate (so it does not re-fetch needlessly on every page).

5. **Test (AC5 / Rule L):** add a test that mocks `GET /api/quiz/public-config`, drives the full
   `init()` path (via `_initForTest()` seam), and asserts `config.quiz.enabled` and
   `config.microPollsEnabled` reflect the mocked server values — NOT the snippet-attribute defaults.
   This is the Rule L producer test: injection directly into `readConfig` does not satisfy it.

6. **Nullability alignment:** the server response fields are all non-nullable in the 200 case. Model
   them as
   `{ quizEnabled: boolean; microPollsEnabled: boolean; language: string; accentColor: string }` —
   no `| null` fields. The Zod schema for the response (in `packages/shared`) must match; add
   `QuizPublicConfigResponseSchema` to `packages/shared/src/ schemas/quiz-config.ts` (or a sibling
   file) if it does not exist.

**Sequencing:** the backend-engineer must land the new `GET /api/quiz/public-config` route first (or
in a parallel PR) before this SDK change can be integration-tested end-to-end.

**ADR:** `docs/adr/PROPOSED-FOLLOW-275-quiz-config-transport.md`

---

## FOLLOW-173 → FOLLOW-174

**From:** data-engineer **To:** backend-engineer **Date:** 2026-06-07T00:00:00Z

**Summary:** FOLLOW-173 ships the calibration endpoint at `GET /api/pilot/calibration`. It performs
a query-time join between ClickHouse `adaptation_decisions` (adapt_decision_id, confidence,
model_version) and Postgres `conversion_labels` (prediction_id, outcome_class), buckets model
confidence into deciles, and returns a score-vs-actual reliability curve plus per-outcome-class
conversion aggregates, both grouped by `model_version`. The endpoint uses the same Rule K.2
fail-loud pattern as `cta-lift` and `inquiry-starts`: returns `data_source: 'mock'` when
CLICKHOUSE_URL is unset (dev / CI); returns HTTP 500 + Sentry when a configured store fails; never
silently falls back to mock in production.

Sync approach is documented in both route.ts and route-helpers.ts: "query-time join (MVP — fine for
pilot scale <10k decisions/tenant). FOLLOW-175 will migrate to ClickHouse-materialized path for
scale."

**Action required:** FOLLOW-174 (backend-engineer) should render this calibration data in the pilot
dashboard. The response shape is:

```typescript
CalibrationResponse {
  window_days: number;           // 7 | 14 | 30
  tenant_id: string;
  calibration: CalibrationRow[]; // reliability curve per (model_version, confidence_decile)
  conversion_aggregates: ConversionAggRow[]; // conversion rate per (outcome_class, model_version)
  generated_at: string;          // ISO
  data_source: 'clickhouse' | 'mock';
}
```

Import types from `./route-helpers` (same pattern as cta-lift). The endpoint is already auth-gated
(Bearer JWT + tenant_id claim) and returns `window_days=7` by default; accepts
`?window_days=7|14|30`.

**Files:**

- `apps/control-plane/src/app/api/pilot/calibration/route.ts` — GET handler
- `apps/control-plane/src/app/api/pilot/calibration/route-helpers.ts` — types + bucketing + join
  logic
- `apps/control-plane/src/app/api/pilot/calibration/route.test.ts` — 28 tests (all passing)

---

## FOLLOW-221 → FOLLOW-175

**From:** data-engineer **To:** ml-engineer / backend-engineer **Date:** 2026-06-08T00:00:00Z
**Corrected by:** FOLLOW-237 (data-engineer, 2026-06-08)

**CORRECTION (FOLLOW-237 AC5 — LG-1):** The original handoff incorrectly stated that this export
feeds the FOLLOW-175 §D.5.7 LoRA fine-tuning corpus. **This is WRONG.** This export is a calibration
**SUMMARY** (aggregate counts per `outcome_class × model_version × tenant × window`). It contains NO
per-decision features, scores, or prediction IDs. FOLLOW-175 needs a SEPARATE **row-level**
`(features_snapshot, model_version, score) → outcome_class` export with one row per decision.
FOLLOW-175 **CANNOT use this summary shape** for corpus construction. The original claim "FOLLOW-175
may add fields but MUST NOT remove or rename existing ones" was also premature — the shapes are
incompatible and FOLLOW-175 must design its own schema from scratch.

**Summary (corrected):** FOLLOW-221 adds `?format=json` export to `GET /api/pilot/calibration`.
FOLLOW-237 adds: (a) `data_source` provenance to the envelope and every row (Rule K.2), (b) HTTP 400
rejection for unknown `?format=` values, (c) renames `avg_confidence` to `mean_model_predicted_rate`
to clarify it is per-model_version not per-class, (d) corrects this handoff entry. The existing
chart-data response (no `?format=json`) is completely unaffected.

**Export response shape (as of FOLLOW-237):**

```typescript
// Top-level envelope
type CalibrationExportResponse = {
  data_source: 'clickhouse' | 'mock'; // Rule K.2 provenance — MUST be read before corpus ingestion
  rows: CalibrationExportRow[]; // one per (outcome_class × model_version)
};

// Per-row shape (Zod-validated — CalibrationExportRowSchema in route-helpers.ts)
type CalibrationExportRow = {
  outcome_class: string; // e.g. 'offer_made', 'no_response', 'purchased', 'lost'
  model_version: string; // e.g. 'rulebased-bandit-v1', 'lora-tenant-abc-v2'
  tenant: string; // tenant_id from JWT claim
  window: number; // window_days (7 | 14 | 30)
  count: number; // labeled decisions with this (outcome_class, model_version)
  mean_model_predicted_rate: number | null; // mean predicted_rate across all reliability-curve
  //   buckets for this model_version (per-model, NOT per-class).
  //   Rides on raw confidence pending FOLLOW-230 dwell cap (commit b62faae).
  //   null when no calibration rows exist for the model version.
  data_source: 'clickhouse' | 'mock'; // per-row copy of the envelope provenance field
};
```

**Rule K.2 provenance (FOLLOW-237 AC1):** Both the envelope `data_source` and each row's
`data_source` carry the provenance. A consumer MUST reject any file where `data_source === 'mock'`
before using it for model training or go/no-go evaluation — mock fixtures must not contaminate a
training corpus.

**What FOLLOW-175 still needs (separate ticket):** A row-level export with one row per labeled
decision, containing `(prediction_id, features_snapshot, model_version, score, outcome_class, ts)`.
Design that schema in FOLLOW-175; do not extend this summary endpoint.

**Files changed in FOLLOW-221 + FOLLOW-237:**

- `apps/control-plane/src/app/api/pilot/calibration/route.ts`
- `apps/control-plane/src/app/api/pilot/calibration/route-helpers.ts`
- `apps/control-plane/src/app/api/pilot/calibration/route.test.ts`

---

## FOLLOW-266 Phase 1 (data-engineer) → FOLLOW-266 Phase 2 (backend-engineer) → FOLLOW-266 Phase 3 (sdk-engineer)

**From:** pm-orchestrator **To:** backend-engineer + sdk-engineer **Date:** 2026-06-12T12:00:00Z
**Phase 1 DONE:** PR #277 merged 2026-06-12T18:23:36Z (commit 61be83a). RETRO-064 pending.

**Summary:** FOLLOW-266 is a 3-agent co-assigned ticket for the K.3.6 Archetype Identification
Tracer foundation. Work is sequenced to avoid merge conflicts:

- **Phase 1 (data-engineer) — DONE (PR #277):** ClickHouse `intent_events` DDL migration 0014 +
  Supabase `intent_sessions` migration 0028 + Drizzle schema
  `packages/db/src/schema/intent-sessions.ts`. Both on main as of 2026-06-12T18:23:36Z.
- **Phase 2 (backend-engineer) — IN_PROGRESS:** Supabase `intent_weight_configs` migration 0029
  (AC2) + CF Worker ingest dual-write handler for `intent.snapshot` events (AC5). Branch:
  `backend-engineer/FOLLOW-266-k36-ingest-handler`.
- **Phase 3 (sdk-engineer) — BACKLOG (depends on Phase 2):** New `intent.snapshot` Zod event type +
  SDK emission logic in `packages/sdk/src/core/intent.ts` (AC4). Branch:
  `sdk-engineer/FOLLOW-266-k36-intent-snapshot-event`.

**Phase 1 artifacts now on main (read these first):**

- `packages/db/migrations/0028_intent_sessions.sql` — intent_sessions table DDL (RLS, indexes,
  UNIQUE)
- `packages/db/src/schema/intent-sessions.ts` — Drizzle schema definition (all column types)
- `infra/clickhouse/migrations/0014_intent_events.sql` — intent_events ClickHouse MergeTree DDL
- `packages/db/migrations/meta/_journal.json` — idx=28 added (next migration must be idx=29)

**Action required (backend-engineer — Phase 2):** Phase 1 is on main. Implement:

1. Migration `0029_intent_weight_configs.sql`: table with `id uuid PK`,
   `tenant_id uuid NULL REFERENCES tenants(id)`, `is_active bool DEFAULT true`, `weights jsonb`,
   `created_at timestamptz`, `created_by uuid REFERENCES users(id)`. RLS policy:
   `tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant_id', true)::uuid` (match
   existing RLS pattern from intent_sessions). UNIQUE(tenant_id, is_active) WHERE is_active = true.
   Journal entry idx=29 (check \_journal.json — current last is idx=28, when=1781287352000; set new
   when to current epoch ms).
2. In `apps/ingest/src/handlers/events.ts` (or a new `apps/ingest/src/handlers/intent-snapshot.ts`):
   add a handler branch for `event.type === 'intent.snapshot'`. On match: (a) INSERT into ClickHouse
   `intent_events` via existing `clickhouse-producer.ts` pattern, using columns: intent_session_id,
   tenant_id, event_at, event_type, archetype_deltas, confidence_before, confidence_after,
   top_archetype, event_payload; (b) UPSERT into Supabase `intent_sessions` via Drizzle DB client —
   use `intentSessions` export from `packages/db/src/schema/index.ts`.
3. Vitest integration test: mock ClickHouse producer + DB client; assert both writes fire on
   `intent.snapshot` input; assert skipped for other event types; assert `intent_sessions` upsert
   increments `signal_count` and updates `last_event_at`.

**Action required (sdk-engineer — Phase 3 — do NOT start until Phase 2 PR is open):** After Phase 2
PR is open (backend-engineer has confirmed the intent.snapshot event payload shape in the handler),
implement:

1. Add `IntentSnapshotEventSchema` to `packages/shared/src/schemas/events/intent.ts` (new file or
   existing). Schema fields:
   `archetype, confidence, signal_count, probabilities: record<string, number>, quiz_completed: boolean, quiz_leaf: string | null, chat_turns: number, last_signal_delta: { archetype_deltas: record<string, number>, event_type: string }`.
   Add to `EventSchema` discriminated union.
2. In `packages/sdk/src/core/intent.ts`: after every 5th `processSignal()` call AND on
   `window.beforeunload`, emit `intent.snapshot` via the existing `queueEvent()` mechanism.
3. Unit test: 5-signal cycle → snapshot emitted; `beforeunload` → snapshot emitted; re-hydrated
   session → counter resets correctly.

**Files to read before starting (Phase 2):**

- `backlog/FOLLOW_UPS.md` §FOLLOW-266 (full AC spec)
- `docs/MASTER_DESIGN.md` §K.3.6 (schema DDL + design rationale)
- `packages/db/migrations/0028_intent_sessions.sql` (Phase 1 intent_sessions DDL — read columns
  carefully)
- `packages/db/src/schema/intent-sessions.ts` (Drizzle column definitions — use `intentSessions`
  import)
- `infra/clickhouse/migrations/0014_intent_events.sql` (Phase 1 intent_events DDL — use these exact
  column names)
- `packages/db/migrations/meta/_journal.json` (idx=28 is last; your migration must be idx=29)
- `apps/ingest/src/clickhouse-producer.ts` (CH write pattern)
- `apps/ingest/src/handlers/events.ts` (event handler pattern)
- `packages/shared/src/schemas/events/` (event schema pattern)
- `packages/sdk/src/core/intent.ts` (intent engine — add emit here, Phase 3 only)

---

## FOLLOW-374 → Rafał Palak (CTO) — Invoke /api/v1/consent/platform-registration at investor "I agree" click

**From:** backend-engineer (FOLLOW-374, 2026-06-21) **To:** Rafał Palak (CTO / app.estalara.com)
**Priority:** P0 — go-live gate for the mandatory registration consent

### What backend-engineer delivered

`POST /api/v1/consent/platform-registration` is implemented and live on the control-plane
(`admin.estalara.com`). This endpoint writes the `consent_records` row with
`consent_type = 'platform_registration'` that satisfies the compliance go-live gate in
`docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §5.

The endpoint is in `apps/control-plane/src/app/api/v1/consent/platform-registration/route.ts`.

### What Rafał needs to do

**At the "I agree" registration click on app.estalara.com:**

Call `POST https://admin.estalara.com/api/v1/consent/platform-registration` with the following:

**Headers:**

```
Content-Type: application/json
X-Consent-Signature: <HMAC-SHA256(PLATFORM_REGISTRATION_CONSENT_SECRET, body_json_utf8)>
```

where `body_json_utf8` is the exact UTF-8 bytes of the POST body (as a string).

**Body:**

```json
{
  "tenant_id": "<Estalara_tenant_UUID_for_app_estalara>",
  "session_id": "<stable_investor_account_reference_no_PII>",
  "nonce": "<random_UUID_or_32+_char_random_string_per_request>",
  "tos_version": "platform-v1.3-2026-06-21",
  "user_agent": "<investor_browser_user_agent>"
}
```

- `tenant_id` — the Estalara UUID of the app.estalara.com tenant (get from Piotr / Doppler).
- `session_id` — a stable pseudonymous investor reference (e.g. SHA-256 of their Supabase user ID).
  Must be consistent for the investor's lifetime. No raw email / name / phone.
- `nonce` — a fresh UUID per request (prevents accidental double-submit on retry).
- `tos_version` — use `"platform-v1.3-2026-06-21"` to match the DPO-reviewed disclosure text. Update
  when consent text changes and a new DPO-reviewed version is published.
- `consent_text_hash` — optional; omit to use the canonical EN §6.1 SHA-256 hash. Provide a custom
  hash ONLY if you display a translated version of the text.

**Auth secret:** `PLATFORM_REGISTRATION_CONSENT_SECRET` — request from Piotr (to be provisioned in
Doppler). The secret is HMAC-SHA256 shared between app.estalara.com and the control-plane.

**Compute the signature (Node.js example):**

```typescript
import { createHmac } from 'crypto';
const body = JSON.stringify({ tenant_id, session_id, nonce, tos_version, user_agent });
const sig = createHmac('sha256', PLATFORM_REGISTRATION_CONSENT_SECRET)
  .update(body, 'utf8')
  .digest('hex');
```

**Expected response:**

```json
{ "consent_record_id": "uuid" } // 201 Created
```

On 409, the record already exists — this is safe (idempotent); no re-insert needed.

**Critical timing:** Call this endpoint BEFORE creating the investor's account. If the endpoint
returns non-2xx (excluding 409), do NOT proceed with account creation — surface an error to the
investor.

**What NOT to suppress:** The DOM opt-out toggle (`profiling_opt_out` in the SDK) only suspends AL
DOM adaptation. It does NOT affect buying-intent identification, lead ranking, or agent-facing chat
summaries. Those are covered by this registration consent and must continue regardless of the DOM
opt-out state.

### Go-live gate

The compliance DPO gate (`docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §5 item: "§6 registration
consent text reviewed by DPO before go-live on app.estalara.com") requires:

1. This API integration is live on app.estalara.com (verified by Rafał).
2. QA manual verification: real browser investor registration → DB row written (check via Supabase
   dashboard → `consent_records` table, filter `consent_type = 'platform_registration'`).
3. DPO sign-off on the §6.1 disclosure text (PENDING — Compliance Engineering).

Update `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §5 gate item to DONE after steps 1–3 are
complete.

---

## FOLLOW-373 → Rafał Palak (CTO) — App-Side Chat Retention/Deletion Windows

**From:** compliance-engineer **To:** Rafał Palak (CTO) **Date:** 2026-06-21T00:00:00Z

**Summary:** FOLLOW-373 (platform-wide consent umbrella) establishes that Adaptive-Listings owns the
consent layer and disclosure for all six processing purposes (a)–(f). Purposes (b) and (f) involve
raw chat text and agent-facing summaries stored on the APP-SIDE (app.estalara.com), which is Rafał's
responsibility. This HANDOFF specifies the retention and deletion windows that Adaptive-Listings has
disclosed to investors in the registration consent, so that app-side implementation aligns with
disclosed behavior.

**AL-documented retention periods for app-side data (must match app.estalara.com implementation):**

| Data category                                           | Disclosed retention                                                                 | Notes                                                                                                                                                   |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Raw chat message text (LIVE chat + Estalara AI chat)    | Recommended max: 90 days from message creation, or session-end whichever is shorter | C-07 brief recommends ≤30 days for batch NLP retention; 90 days is the outer bound for broader chat log retention (GDPR data minimization Art. 5(1)(e)) |
| Agent-facing chat summaries (purpose f)                 | Same window as source chat messages                                                 | Summaries derived from chat logs; should be deleted when source chat logs are deleted                                                                   |
| Investor account profile / behavioral record (app-side) | Account duration + 30 days after account deletion                                   | Aligns with investor DSR erasure expectations                                                                                                           |

**Deletion on DSR erasure:** When an investor submits a DSR erasure request (forwarded from
Adaptive-Listings via the tenant DSR pathway described in DPIA §8), the app-side system must delete:

1. All raw chat message text for that investor within 30 days of receiving the erasure request.
2. All agent-facing chat summaries for that investor within 30 days.
3. Notify Adaptive-Listings when app-side deletion is complete (coordination mechanism TBD — at
   minimum, a manual confirmation process until an automated webhook is built).

**Action required from Rafał:**

1. Implement a server-side TTL/deletion sweep for chat message text and agent-facing summaries
   aligned with the retention windows above.
2. Implement a deletion handler that fires when an investor's DSR erasure request is received from
   the AL DSR pathway.
3. Confirm to compliance-engineer (compliance@estalara.com) when app-side retention enforcement is
   live. The DPO gate in `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §5 includes a gate item for
   this confirmation.

**C-07 boundary confirmation (for Rafał's reference):** The Adaptive-Listings system stores ONLY a
12-dimensional intent vector (24 h Redis TTL, `redis_writer.py:40`, `ttl_seconds=86400`) — NOT raw
chat text. Raw chat text is entirely app-side. Rafał's implementation must not alter the AL-side
storage (no new raw-text storage introduced into the AL stack without a new C-08 brief and DPO
sign-off).

**Files produced:**

- `docs/compliance/dpia.md` §13.4 (LIA for purposes d and e)
- `docs/compliance/ropa.md` Activity 16 (registration consent ROPA entry)
- `docs/compliance/PRIVACY_NOTICE_TEMPLATE.md` §6 (registration consent disclosure text)
- `packages/sdk/src/ui/consent-banner.ts` (platform-wide disclosure added for registered investors)

---

## 2026-06-22 — SDK production integration: cross-listing adaptation + SoT archetype (→ Rafał)

Two SPA-specific defects were found and fixed this session (the "1st listing adapts, 2nd+ does not"
symptom). Full design + verification:
`docs/adr/ADR-0014-cross-listing-adaptation-and-sot-archetype.md`. **Precise production
requirements: `docs/runbooks/SDK_PRODUCTION_INTEGRATION.md`** — read before deploying the SDK to
`app.estalara.com`.

**Only two items require host/platform action (everything else is already wired):**

1. **[HOST] `data-estalara-listing-id` MUST update in place on SPA navigation.** The SDK detects a
   listing change by watching this attribute for a value change. Binding it to `property.uuid`
   (already done in `(buyer)/[lang]/listing/[slug]/+page.svelte`) satisfies this. If it is ever
   hard-coded/memoized, the 2nd listing silently keeps the 1st listing's adapted copy.
2. **[PLATFORM] Serve the SDK bundle from a versioned/content-hashed URL.** `<script async>` is not
   re-fetched on SPA navigation, so a redeploy otherwise won't reach returning single-page sessions.

**Already correct, do not regress:** `POST /api/adapt` honors `archetype_hint` (drives copy from the
quiz/SoT archetype) and the `neutral` cold-start contract; `GET /api/adapt/description` is
per-listing grounded with the archetype-fit gate (ADR-0009/0010).

**Behavioral guarantee (CEO 2026-06-22):** the resolved archetype drifts only toward _other
non-neutral_ archetypes (chat/sustained navigation revealing a different true need) and never
silently to `neutral`; the quiz can be disabled and the system stays fully functional. See
`[[project_consent_umbrella_optout_decision]]` adjacency for the consent posture.

---

## FOLLOW-372 → backend-engineer: Wire profilingOptOut flag into Decision-API adapt route + skip chat-intent shadow prior in redis_writer.py

**From:** sdk-engineer (FOLLOW-372, 2026-06-21) **To:** backend-engineer **Priority:** P1 (needed
for complete FOLLOW-372 AC-4 and AC-5 go-live)

### What sdk-engineer delivered

1. `apps/decision-api/src/lib/consent-gate.ts` — extended with `profilingOptOut?: boolean` input
   field. When `true`, `consentGate()` returns `{ gated: true, reason: 'profiling_opt_out' }`. Tests
   pass. The gate function is ready.

2. `packages/sdk/src/core/profiling-opt-out.ts` — per-user localStorage state module.

3. `packages/sdk/src/ui/profiling-toggle.ts` — Shadow DOM toggle UI component.

4. `packages/sdk/src/index.ts` — the SDK reads `isProfilingOptedOut(storedLeadId)` and:
   - Skips cold-start archetype hints + intent-weight updates when opted out.
   - Skips `refreshDirectives()` (no DOM adaptation) when opted out.
   - Skips behavioral-signal intent accumulation in the observer callback when opted out.
   - Renders the toggle in Shadow DOM; onChange persists via `setProfilingOptOut()`.

### What backend-engineer needs to complete

**Task 1 — Wire `profilingOptOut` into the GET `/api/adapt` route handler.**

The SDK sends `profilingOptOut` as a query parameter or request header (to be agreed). The adapt
route must read it, pass it to `consentGate()`, and return neutral directives
(`reason: 'profiling_opt_out'`) when gated. Variant logging MUST be suppressed on this gate path
(AC-4: "no variant log").

Suggested transport: add `profiling_opt_out=1` query parameter to the GET `/api/adapt` request (SDK
already controls the request in `fetchDirectives()`). Backend reads
`url.searchParams.get('profiling_opt_out') === '1'`.

**Task 2 — Skip AL chat-intent shadow prior for opted-out sessions.**

`apps/intent-engine/src/redis_writer.py` writes the 12-dim intent vector that feeds the chat-intent
shadow prior. Per §H.9 seams table: when `profilingOptOut = true` for a session, `redis_writer.py`
must NOT apply the AL chat-intent shadow prior (do not write the vector or skip the apply call for
opted-out session_ids).

Transport: the SDK should include the opt-out flag in the `session.started` or `intent.snapshot`
event payload so the ingest pipeline can propagate it to `redis_writer.py`. Alternatively, the
Decision API can block the intent vector write when `profilingOptOut = true`. Coordinate with
ml-engineer on the cleanest seam.

**Boundary reminder (DO NOT change):** This flag suspends AL DOM adaptation ONLY. It MUST NOT
suppress:

- app.estalara.com buying-intent identification
- lead ranking by buying-intent strength
- agent-facing chat-question summaries Those are covered by the mandatory registration consent
  (§H.8) and must continue regardless of the opt-out toggle state.

**Acceptance criteria for this handoff:**

- `GET /api/adapt` returns neutral directives + no variant row written when `profiling_opt_out=1`
  query param is present.
- Test: consent-gate test (already added in FOLLOW-372 PR) covers the gate logic; backend-engineer
  adds an integration test for the route suppressing variant logging.
- `redis_writer.py` skips writing/applying intent vector for opted-out sessions.
- No change to buying-intent / lead-ranking / agent-summary pipelines.

---

## FOLLOW-435 LEG 1 (backend-engineer) → FOLLOW-435 LEG 2 (ml-engineer)

**Date:** 2026-06-30 | **Producer PR:** backend-engineer/FOLLOW-435-listing-embed-seed-producer

### What LEG 1 shipped (contract + producer)

**Topic and env var:**

- Redpanda topic: `estalara.listing-embeddings`
- Env var: `REDPANDA_TOPIC_LISTING_EMBEDDINGS` (default `estalara.listing-embeddings`)
- Auth: same Redpanda REST pattern as descriptions — `REDPANDA_REST_URL`, `REDPANDA_REST_USERNAME`,
  `REDPANDA_REST_PASSWORD` (already in `.env.example`)

**Event schema (`ListingEmbeddingSeedRequestedEvent`):**

```ts
// Source: packages/shared/src/schemas/listing-embed-seed.ts
// Exported from: @estalara/shared
{
  tenant_id: string;   // UUID — RLS scope
  listing_ids: string[]; // non-empty list of listing IDs to embed
}
```

**Shared fixture (cross-language gate SoT):**

- `packages/shared/contracts/listing-embed-seed-event.required.json` →
  `["tenant_id", "listing_ids"]`
- TS gate already added to CI (step "TypeScript contract test — listing-embed seed event schema ⊇
  fixture")

**Producer:**

- `apps/control-plane/src/lib/listing-embed-seed-publisher.ts` →
  `publishListingEmbeddingSeed(event)`
- Called from `seedListingEmbeddingsForActivation` (inside `afterResponse()`) when overflow > 0

### What the Modal consumer (LEG 2) must do

**1. Subscribe to the topic** (`REDPANDA_TOPIC_LISTING_EMBEDDINGS` / `estalara.listing-embeddings`),
consume `ListingEmbeddingSeedRequestedEvent` messages.

**2. For each `listing_id` in `event.listing_ids`, call the embed endpoint:**

```
POST /api/listings/embed
x-internal-api-secret: <INTERNAL_API_SECRET>
Content-Type: application/json

{
  "tenant_id": "<event.tenant_id>",
  "listing_id": "<listing_id>",
  "text_fields": {        // optional — may be omitted if not available
    "title": "...",
    "description": "...",
    "price": "...",
    "location": "..."
  }
}
```

The endpoint is idempotent (upsert semantics) — re-runs are safe.

**3. Mirror the cross-language contract gate:**

The consumer MUST derive its required field set from the shared fixture, NOT hard-code it. Pattern
to mirror from `apps/llm-gateway/src/jobs/generate_description.py`:

```python
import json
from pathlib import Path

_CONTRACT_FIXTURE = (
    Path(__file__).parent / "../../../../packages/shared/contracts/listing-embed-seed-event.required.json"
)
REQUIRED_FIELDS: frozenset[str] = frozenset(json.loads(_CONTRACT_FIXTURE.read_text()))
```

Then create `apps/llm-gateway/src/jobs/test_listing_embed_seed_event_contract.py` that:

- Asserts `REQUIRED_FIELDS == frozenset(["tenant_id", "listing_ids"])`
- Asserts the consumer validates both fields on each incoming message

Add a Python pytest step to the `cross-language-contract` CI job (after the existing description
step, following the same pattern).

**4. Observability:** log successful/failed embed calls per listing_id; capture failures to Sentry
with `tags: { area: "onboarding", sink: "modal-embed-seed", kind: "embed_failed" }`.

**5. Retryability:** the Modal job should be idempotent and retryable — re-processing a message that
already succeeded is safe because `/api/listings/embed` uses upsert.

---

## FOLLOW-437 (ml-engineer) → FOLLOW-436 operator (Piotr / Rafał)

**Date:** 2026-06-30 | **PR:** ml-engineer/FOLLOW-437-consolidate-llm-gateway-modal-app

### What FOLLOW-437 shipped (BUG 1 + BUG 2 fix)

Both ESC-034 code bugs are fixed and merged. The deploy entrypoint is now correct.

**Deploy command (unchanged from the runbook in PR #392):**

```bash
modal deploy apps/llm-gateway/src/main.py
```

This single command now registers ALL three Modal functions under one app:

- `generate_description`
- `consume_description_requests`
- `consume_embed_seed_requests`

**What changed structurally:**

1. `apps/llm-gateway/src/jobs/_app.py` — new shared module that owns the single
   `modal.App("estalara-description-generator")` instance and the shared Docker image.
2. `generate_description.py` and `consume_embed_seed_requests.py` now import `app` and `_image` from
   `_app.py` instead of each constructing their own `modal.App(...)`.
3. `main.py` is no longer a placeholder — it imports both consumer modules (load-bearing
   side-effects that register their `@app.function` decorators) and re-exports `app` so Modal can
   locate the App object.

**App name preserved:** `estalara-description-generator` — the live app identity is unchanged; no
decommissioning of running functions is required.

**Operator: nothing changes in the go-live procedure from PR #392's runbook.** The three-step
runbook (provision secrets → `modal deploy main.py` → smoke verify) is correct as written. The only
difference is that `modal deploy main.py` now actually works (previously it deployed zero
functions).

### Verification proof (from FOLLOW-437 PR description)

- `modal.App("estalara-description-generator")` called exactly **once** at import time (from
  `jobs/_app.py`).
- `generate_description.app is consume_embed_seed_requests.app` → `True`.
- All 104 llm-gateway Python tests pass (including cross-language contract gates).

---

## PM orchestrator (session 10) → data-engineer, FOLLOW-462

**Date:** 2026-07-06 | **Branch:** `data-engineer/FOLLOW-462-clickhouse-dsr-param-binding` (isolated
worktree; branch-first per FOLLOW-448/Rule AA discipline — create the branch as your FIRST action,
before any edit)

**Ticket:** backlog/QUEUE.md → Sprint 22b → `FOLLOW-462` ("ClickHouse DSR SQL: bind session_id as a
param (backslash-safe) so erasure can't silently fail", audit finding F-14, P2, ~2h).

**Read before starting:**

- `docs/MASTER_DESIGN.md` §Snapshot.1 (current implementation status — read per Operating Principle
  1 before any non-trivial task)
- `CONVENTIONS_PATCH.md` (current permanent rules — includes Rule AA CODE-VS-PROD-AXIS and the
  branch-first-worker rule from FOLLOW-448)
- This ticket's full YAML block in `backlog/QUEUE.md` (source F-14, spec, AC checklist)

**The bug:** `clickhouse-dsr.ts` builds its erase/status `ALTER TABLE ... DELETE` SQL by escaping
only `'` in the `session_id`/tenant/mutation-ID values. ClickHouse SQL also treats `\` as an escape
character; a `session_id` ending in a literal backslash malforms the statement, so DSR erasure can
silently fail — a GDPR Art.17 compliance-erasure correctness bug, not merely hardening.

**Required fix (per ticket AC):**

- Use ClickHouse's native `param_*` query-parameter binding (or, if the client library in use
  doesn't support it cleanly for `ALTER ... DELETE`, a strict hex/UUID-shaped allowlist validated
  before interpolation) for `session_id`/tenant/mutation IDs — no raw quote-only escaping.
- Add a test: a `session_id` containing a trailing backslash still produces a well-formed, executed
  DELETE (not a malformed/no-op statement).

**Validation the orchestrator will require before READY_FOR_REVIEW (do not skip):**

- Local: lint, typecheck, targeted data-engineer test suite, and the existing ClickHouse migrations/
  DSR test suites all green.
- CI green on every real gate (`gh pr checks <pr> --watch`, then the `jq` non-success-count check —
  paste the `0`).
- Runtime-wiring grep: a non-test producer (the erase/status route calling into the fixed
  `clickhouse-dsr.ts` binder) AND a non-test consumer (the actual ClickHouse DELETE executing) —
  paste both grep lines per the evidence requirements.
- This is a single-agent ticket, no step-5d co-assignment check needed.

**Open a PR when done; do not merge.** Update `backlog/QUEUE.md` FOLLOW-462 status only via the
orchestrator (single writer) — report back status, PR link, and CI result instead of editing the
queue yourself.

---

## PM orchestrator (session 11) → backend-engineer, FOLLOW-513

**Date:** 2026-07-06 | **Branch:** `backend-engineer/FOLLOW-513-queue-sentry-binding` (isolated
worktree; branch-first per FOLLOW-448/Rule AA discipline — create the branch as your FIRST action,
before any edit, off `main` at `2083e07` or later)

**Ticket:** `backlog/QUEUE.md` → Sprint 22b → `FOLLOW-513` ("the queue() consumer runs outside
withSentry so its retry_reinsert_failed/malformed_retry_message captures likely no-op — bind Sentry
on the queue path", P1, ~2h, `apps/ingest`). Delegation-table row used: "ingest worker,
control-plane, decision-api, Postgres/RLS, auth, onboarding HTTP, billing, webhooks →
backend-engineer".

**Read before starting:**

- `docs/MASTER_DESIGN.md` §Snapshot.1 (current implementation status — Operating Principle 1)
- `CONVENTIONS_PATCH.md` (current permanent rules — Rule K.2/K.2-amendment on fire-and-forget
  observability is directly relevant: "a configured-but-failed store must be observable" — this
  ticket is that same obligation applied to a Cloudflare Queue consumer instead of an HTTP sink)
- This ticket's full YAML block in `backlog/QUEUE.md` (source RETRO-159, AC checklist)
- `backlog/RETROSPECTIVES.md` RETRO-159 §4b BUG-1 / §4c TG-1 / §4a LG-1 / §7 hop-2 for the full
  finding writeup

**The bug (verified in repo, not guessed):**

- `apps/ingest/src/index.ts:39-51` — only `{ fetch }` is passed through `withSentry(...)`
  (`const sentryWrapped = withSentry({ fetch: ... })`); the final default export is
  `{ fetch: instrumentedFetch, queue: handleEventsRetryQueue }` — `queue` is a plain sibling that
  never goes through `withSentry`.
- `apps/ingest/src/observability.ts` — `withSentry` wraps `Sentry.withSentry(configFn, handler)`,
  which is what actually calls `Sentry.init()` per-invocation. Because `queue` bypasses this, no
  Sentry client is ever initialized before `handleEventsRetryQueue` runs.
- `apps/ingest/src/handlers/events-retry-consumer.ts:42,70` calls `Sentry.captureException(...)`
  directly (imported as `import * as Sentry from '@sentry/cloudflare'`) for both
  `malformed_retry_message` and `retry_reinsert_failed` — with no client bound, `@sentry/cloudflare`
  no-ops these calls. Cloudflare Queue consumer invocations frequently run on fresh isolates that
  never served a `fetch`, so this isn't an edge case — it's the structural default. This defeats the
  exact "even the durable retry failed" observability guarantee ADR-0017/FOLLOW-482 exists to
  provide.
- Secondary fold-in (LG-1): `apps/ingest/src/events-retry-queue.ts:35` —
  `schema_version: z.literal(1)`. `events-retry-consumer.ts` ack-drops (not retries) any message
  that fails `EventsRetryMessageSchema` parsing, including a hypothetical future
  `schema_version: 2`. Cloudflare holds in-flight queue messages across deploys, so a version bump
  would silently lose in-flight retries the day it ships.

**Required fix (per ticket AC — see the FOLLOW-513 YAML block in QUEUE.md for the authoritative
list):**

1. Make the `queue` handler run with a bound Sentry client. The straightforward fix is to pass the
   WHOLE `ExportedHandler<Env>` object
   (`{ fetch: instrumentedFetch, queue: handleEventsRetryQueue }`) through `withSentry` once,
   instead of wrapping only `{ fetch }` and re-assembling afterward — confirm `Sentry.withSentry`
   from `@sentry/cloudflare` supports wrapping both `fetch` and `queue` on the same handler object
   (check the installed `@sentry/cloudflare` version's docs/types before assuming; if it does NOT
   support `queue`, the acceptable alternative is an explicit `Sentry.init({...})` call at the top
   of `handleEventsRetryQueue` using the same `env.SENTRY_DSN_INGEST` config shape already in
   `observability.ts`, but prefer the wrap if the library supports it — less duplicated config).
2. Add a test that asserts a Sentry client is BOUND when the queue handler runs via the REAL
   default-export wiring in `index.ts` (i.e. exercise `export default {...}` from `index.ts`, not
   just call `handleEventsRetryQueue` directly — the existing `events-retry-consumer.test.ts` only
   does the latter, which is exactly the blind spot that let this ship). Don't just assert
   `captureException` was called — that call no-ops silently today too and would still pass a naive
   test; assert a client is actually configured/bound (e.g. via `Sentry.getClient()` or equivalent
   `@sentry/cloudflare` API — check what's available in the installed version).
3. Fold in the `schema_version` hardening: replace `z.literal(1)` with a shape that can route by
   version (e.g. a discriminated union keyed on `schema_version`, or at minimum treat an
   unknown-but-higher version as retry-worthy rather than ack-drop) so a future version bump can't
   silently lose in-flight messages. Keep this scoped — don't invent a v2 schema, just make the
   consumer's failure mode for "message doesn't match what I expect" not be "permanent ack-drop, no
   code changes needed".
4. No regression to the existing produce-on-terminal-failure / consumer-re-insert tests from
   FOLLOW-482 (PR #449) — `events-retry-queue.test.ts` and `events-retry-consumer.test.ts`.

**Files most likely touched:** `apps/ingest/src/index.ts`, `apps/ingest/src/observability.ts`,
`apps/ingest/src/handlers/events-retry-consumer.ts`,
`apps/ingest/src/handlers/events-retry-consumer.test.ts`, `apps/ingest/src/events-retry-queue.ts`
(schema_version), `apps/ingest/src/events-retry-queue.test.ts`.

**Validation the orchestrator will require before READY_FOR_REVIEW (do not skip):**

- Local: `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` all green.
- CI green on every real gate (`gh pr checks <pr> --watch`, then the
  `jq '[.[]|select(.state!="SUCCESS")]|length'` check — paste the `0`). Only the pre-existing "Rule
  I — wired-or-dead" red (baseline noise, unrelated to `apps/ingest`) is acceptable.
- Runtime-wiring grep (step 5c): a non-test producer (the real `export default { fetch, queue }` in
  `index.ts` actually passing `queue` through the Sentry-binding path) AND a non-test consumer (the
  bound-client assertion exercised through that real wiring, not a direct handler call) — paste both
  grep lines.
- Single-agent ticket, no step-5d co-assignment check needed.
- Cite RETRO-159 and Rule K.2/its fire-and-forget-observability amendment in the PR description as
  the source pattern.

**Open a PR when done; do not merge.** Update `backlog/QUEUE.md` FOLLOW-513 status only via the
orchestrator (single writer) — report back status, PR link, and CI result instead of editing the
queue yourself.

---

## PM orchestrator (session 17) → backend-engineer, FOLLOW-473

**Date:** 2026-07-08 | **Model:** Opus (justification: this is a live-production auth change on the
two highest-blast-radius routes in the repo — GET /api/adapt and GET /api/adapt/description, hit on
every SDK pageview — with a real prior "SDK-wide outage" risk flagged by FOLLOW-510/RETRO-158; it
also requires reasoning across a cross-file symmetric fix (Rule S) and correctly reproducing an
existing nuanced auth pattern without introducing a regression. This exceeds routine in-scope-ticket
implementation, so per the mandatory model-fit rule this is escalated one tier from the agent's
Sonnet default.) | **Branch:** `backend-engineer/FOLLOW-473-adapt-get-auth-hardening` (branch-first,
FOLLOW-448: `git checkout -b backend-engineer/FOLLOW-473-adapt-get-auth-hardening main` in its own
isolated `git worktree` MUST be your first action, before any file edit)

**Ticket:** `backlog/QUEUE.md` → Sprint 22b → `FOLLOW-473` ("GET /api/adapt auth is presence-only +
spoofable x-tenant-id fallback, now weaker than the hardened POST path", **P1** — elevated from P2
this session per FOLLOW-510/RETRO-158, see the ticket's full `notes:` block in QUEUE.md for the
complete rationale, the pm-orchestrator-run `vercel env ls production` preflight finding, and the
full AC checklist). Delegation-table row used: "ingest worker, control-plane, decision-api,
Postgres/RLS, auth, onboarding HTTP, billing, webhooks -> backend-engineer".

**Read before starting:**

- `docs/MASTER_DESIGN.md` §Snapshot.1 (current implementation status — Operating Principle 1). Note:
  this section is dated 2026-05-24 and is known-stale (tracked separately as FOLLOW-470, P2,
  pm-orchestrator-owned) — do not treat its "next priorities" prose as current; QUEUE.md is the live
  source of truth for ticket state.
- `CONVENTIONS_PATCH.md` — Rule S (a fix to one verb/branch of a symmetric set must be applied to
  ALL siblings at the same tier — directly applicable: GET /api/adapt and GET /api/adapt/description
  have the IDENTICAL fail-open bug and both must be fixed, not just one); Rule Q (a CI/auth gate
  that can soft-skip must emit positive proof, not just green); Rule Y (a test-citation must be
  verified against the real file).
- The full FOLLOW-473 YAML block in `backlog/QUEUE.md` (Sprint 22b) — READ THE ENTIRE `notes:`
  field, it contains the exact fix pattern to mirror and the already-completed provisioning
  preflight (do not re-derive or re-run it).
- `backlog/FOLLOW_UPS.md` FOLLOW-473 and FOLLOW-510 stub entries for additional context (both now
  folded into the QUEUE.md ticket, informational only).

**The bug (verified in repo by pm-orchestrator before delegating, not guessed):**

- `apps/control-plane/src/app/api/adapt/route.ts:703` (GET handler) and
  `apps/control-plane/src/app/api/adapt/description/route.ts:183` (GET handler) both do:
  ```
  const adaptApiKey = process.env.ADAPT_API_KEY;
  if (adaptApiKey && token !== adaptApiKey) { ...401... }
  // When ADAPT_API_KEY is unset: presence-only auth (any non-empty bearer accepted)
  ```
  — a fail-OPEN shape (the exact class FOLLOW-456/FOLLOW-490 already eliminated on 4 other routes).
  Tenant is then resolved from a caller-supplied `x-tenant-id` header (GET /api/adapt) with zero
  verification — fully spoofable.
- The ALREADY-HARDENED reference pattern lives in
  `apps/control-plane/src/app/api/adapt/feedback/route.ts` (FOLLOW-450/ADR-0015): Step 1 —
  `resolveApiKey(req)` (`apps/control-plane/src/lib/api-key-auth.ts`, SHA-256 bearer → `api_keys`
  row → real `tenantId`, the SAME helper `POST /api/adapt` already uses per FOLLOW-451). Step 2
  (fallback only, scoped) — `ADAPT_API_KEY` ops bypass via `secretEquals()`
  (`apps/control-plane/src/lib/secret-compare.ts`, constant-time), requiring `OPS_TENANT_ID` to also
  be set (500 "server misconfiguration" if `ADAPT_API_KEY` is set but `OPS_TENANT_ID` is not).
- The SDK already sends `Bearer ${config.apiKey}` (real per-tenant keys) on these GET calls
  (`packages/sdk/src/core/adapt-description.ts:231`, `packages/sdk/src/core/adapt.ts:169/267/800`),
  so routing GET through `resolveApiKey()` as the PRIMARY path is not a risk to real tenant traffic.

**Preflight already done (do not repeat):** pm-orchestrator ran `vercel env ls production` against
`adaptive-listings-control-plane` 2026-07-08 (read-only, no secret values fetched): `ADAPT_API_KEY`
IS present (Production + Preview). `OPS_TENANT_ID` is ABSENT from the full prod env list. This means
the ops-bypass branch will hit the exact same "OPS_TENANT_ID must be set alongside ADAPT_API_KEY"
500 that `feedback/route.ts` already returns in prod TODAY (FOLLOW-450, live) — no new failure mode
is introduced by this fix versus the already-accepted feedback-route precedent.

**Required fix (per ticket AC — see the FOLLOW-473 YAML block in QUEUE.md for the authoritative
list):**

1. Both GET handlers (`adapt/route.ts` and `adapt/description/route.ts`) adopt the
   `feedback/route.ts` two-step pattern: `resolveApiKey()` first (derives `tenantId` server-side,
   replacing the `x-tenant-id` header trust), `ADAPT_API_KEY`/`OPS_TENANT_ID` scoped ops-bypass
   second, fail CLOSED (401) when `ADAPT_API_KEY` is set and the token doesn't match — never fail
   open when unset.
2. Do not invent a new auth mechanism. If GET truly needs a materially different caller set than
   POST (e.g. a legitimate internal-only caller that can't carry a per-tenant key), that is an
   architecture question — escalate via ESCALATIONS.md rather than guessing.
3. Test matrix parity with `route.follow451.test.ts` (valid key/tenant, missing key, wrong tenant,
   DB error fails loud, ops-bypass valid/invalid/misconfigured) applied to BOTH GET handlers.
4. No regression to any existing GET /api/adapt or GET /api/adapt/description consumer (SDK, demo
   harness, existing tests).

**Files most likely touched:** `apps/control-plane/src/app/api/adapt/route.ts`,
`apps/control-plane/src/app/api/adapt/description/route.ts`, their `.test.ts` files, possibly a
shared helper if the two-step pattern is worth extracting (evaluate — `feedback/route.ts` currently
inlines it; don't force an extraction that isn't clearly justified, per Simplicity First).

**Validation the orchestrator will require before READY_FOR_REVIEW (do not skip):**

- Local: `pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build` (and `next build`
  per FOLLOW-474/RETRO-150 — webpack import-resolution catches defects `tsc`/`vitest` don't) all
  green.
- CI green on every real gate (`gh pr checks <pr> --watch`, then the
  `jq '[.[]|select(.state!="SUCCESS")]|length'` check — paste the `0`). Only the pre-existing "Rule
  I — wired-or-dead" red is acceptable.
- Runtime-wiring grep (step 5c): a non-test producer (the real GET handlers calling
  `resolveApiKey()`) AND a non-test consumer (the `api_keys` DB lookup actually executing) — paste
  both grep lines. Also confirm via grep that `x-tenant-id` is no longer trusted as an authority in
  either GET handler's tenant-resolution branch (only as a documented, narrower fallback if you end
  up keeping it at all — flag explicitly if so).
- Single-agent ticket, no step-5d co-assignment check needed.
- PR description MUST cite: RETRO-158/FOLLOW-510 as the source of the P1 elevation, the
  pm-orchestrator preflight finding (ADAPT_API_KEY present / OPS_TENANT_ID absent in prod — no new
  failure mode), and Rule S (both GET routes fixed at the same tier).

**Open a PR when done; do not merge.** Update `backlog/QUEUE.md` FOLLOW-473 status only via the
orchestrator (single writer) — report back status, PR link, and CI result instead of editing the
queue yourself.

---

## PM orchestrator (session 18) → ml-engineer, FOLLOW-463

**From:** pm-orchestrator (session 18) **To:** ml-engineer **Date:** 2026-07-08 **Branch:**
`ml-engineer/FOLLOW-463-verified-facts-ch-audit` (agent-prefix required or push-CI won't run).

**Why you (reassigned from the originally-filed data-engineer):** the ticket reads like a
CH-schema/writer task, but repo verification shows the CH table `description_generations` already
exists (migration 0007) and the durable-write path is `generate_description.py` →
`POST /api/internal/description-cache` — both of which YOU authored (FOLLOW-460/464/465). This is an
add-a-sink on your existing path, not new schema. Continuity + file ownership → ml-engineer.

**The gap (F-17):** `description_generations` has zero writers. `generate_description.py` produces
`verified_facts`, writes them to Redis, and POSTs to the internal endpoint (which persists a
Postgres `description_cache_persistent` row) — but the POST payload OMITS `verified_facts_used` and
the endpoint never writes ClickHouse. So the §E.7.5 anti-hallucination audit trail is not durable.

**Do (surgical):**

1. `apps/llm-gateway/src/jobs/generate_description.py` — add `"verified_facts_used": verified_facts`
   to the POST `payload` (~line 1650); keep the write non-fatal (Rule K.2). Update the docstring +
   `test_generate_description.py` payload assertions.
2. `apps/control-plane/src/app/api/internal/description-cache/route.ts` — extend the Zod schema
   (~L62-69) with `verified_facts_used: z.array(z.string()).optional().default([])` (backward
   compatible); after the existing `insertPgCachedDescriptionStrict(...)`, insert one
   `description_generations` row via the existing `clickhouse-http.ts` client (see
   `clickhouse-tracer.ts`/`clickhouse-dsr.ts` for usage — no new client). Map:
   `description_chars = description.length`, `source = "modal_generation"`, `tier = 0` (NO-Tiers,
   §E.7 — don't invent a tier), `generated_at`/`created_at = now`. **Skip the CH row when
   `description === ""`** (NEUTRAL — nothing to audit); test it. CH-write failure → Sentry
   (`kind: 'description_generations_write_failed'`), do NOT fail the PG-durable POST; if emitting
   after the response, wrap in `next/server` `after()` (repo lost-write rule) — else inline before
   return.
3. `route.test.ts` — prove AC2: a FIT POST triggers the CH insert with the right row; a NEUTRAL POST
   does not.

**Standards:** prettier on every touched file, `tsc --noEmit` + eslint clean, no new migration, keep
the full control-plane adapt/internal suites green. Commit
`feat(data): persist verified_facts_used to description_generations CH audit trail [FOLLOW-463]`.

**Escalate (backlog/ESCALATIONS.md) if:** prod CH user lacks INSERT grant on
`description_generations`; or another non-test consumer of `/api/internal/description-cache` breaks
on the payload extension (grep first).

**Open a PR when done; do not merge.** Report status, PR link, NEUTRAL-handling decision, durability
proof, and CI result. Do NOT edit `backlog/QUEUE.md` (orchestrator is the single writer).

---

## PM orchestrator (session 18) → sdk-engineer, FOLLOW-461

**From:** pm-orchestrator (session 18) **To:** sdk-engineer **Date:** 2026-07-08 **Branch:**
`sdk-engineer/FOLLOW-461-event-schema-reconcile` (agent-prefix required or push-CI won't run).

**Ticket:** Reconcile the event schema to reality (audit F-04). Two distinct sub-problems — treat
the first as MUST (it fixes a LIVE data-loss) and the second as bounded reconciliation, NOT a
build-25-producers project.

**MUST (the live bug):** the SDK emits `adapt.description.*` events that are NOT in the shared
`EventSchema`, so ingest silently rejects them — description-adaptation observability is blind in
prod right now.

- First step: enumerate the exact `adapt.description.*` type strings the SDK actually emits from
  `packages/sdk/src/index.ts` (adapt-description emit sites — at least `applied`, `skipped`,
  `reapplied`, `error`; confirm the real strings, don't guess).
- Add those types to the shared schema under `packages/shared/src/schemas/events/` (new
  `adapt-description.ts` following the existing per-domain file pattern — see `chat.ts`, `live.ts`,
  `floorplan.ts`) and register them in the central `packages/shared/src/schemas/event.ts` union.
  Payload fields: match what the SDK actually sends at each emit site (verify, Zod-validate).
- **Round-trip test (AC3):** assert every defined event type validates at ingest — i.e. each
  `adapt.description.*` payload the SDK emits passes the shared schema. Extend the existing
  cross-runtime event-contract test if one covers this.

**BOUNDED reconciliation (Rule H — no schema type without a producer/consumer):** 25 of 46 defined
types have no SDK producer (floorplan, mouse.\*, photo open/zoom, search/sort, tour,
inquiry.completed, ab.assignment, sidebar.closed, …).

- Produce a documented **defined-vs-producible matrix** (each defined type → has-SDK-producer? y/n).
- Do NOT implement new producers — that's out of scope (each would be its own ticket). For the
  unproduced set: **prune only the types that are clearly dead** (no producer, no consumer, no
  roadmap reference). For any type that looks reserved/planned (referenced in Master_Design, an ADR,
  or an open ticket), leave it and mark it "reserved — <ref>" in the matrix rather than deleting.
- **Escalate (backlog/ESCALATIONS.md), do not unilaterally delete,** if pruning a type would change
  a contract another module/agent relies on, or if you can't tell reserved-vs-dead — list those
  types and ask. Removing an ingest event type is a public-contract change (CLAUDE.md escalation
  boundary); the schema reconciliation itself is in-scope, but ambiguous deletions are not.

**Standards:** prettier every touched file; `tsc --noEmit` + eslint clean; zero `any` without inline
reason; keep `packages/shared` + `packages/sdk` suites green; coverage ≥80% for packages. Commit
`fix(sdk): register adapt.description.* events + reconcile defined-vs-producible schema [FOLLOW-461]`
(or `feat`/`refactor` scope as fits). Reference FOLLOW-461.

**Open a PR when done; do not merge.** Report: the exact adapt.description.\* types registered, the
defined-vs-producible matrix, what you pruned vs left-reserved, any escalation, and CI result (a red
`Rule I — wired-or-dead check` is the known pre-existing non-blocking baseline — confirm none of
your new symbols appear in its `--log-failed`). Do NOT edit `backlog/QUEUE.md` (orchestrator single
writer).

---

## PM orchestrator (session 18) → data-engineer, FOLLOW-535

**From:** pm-orchestrator (session 18) **To:** data-engineer **Date:** 2026-07-08 **Branch:**
`data-engineer/FOLLOW-535-description-generations-ttl` (agent-prefix required or push-CI won't run).

**Why now:** tight continuation of FOLLOW-463 — that ticket added the FIRST writer to
`description_generations`, and RETRO-165 flagged (load-bearing) that the table has **no TTL**, so it
now grows unbounded (amplified by the RETRO-163/FOLLOW-528 model-toggle re-dispatch that appends a
row per toggle). Every sibling has retention (`events` 13 MONTH `0001:46`; `intent_events` 90-day
`0014`); this one has none.

**Do:** add a NEW migration (**next number 0020** — dir tops out at `0019_...`),
`ALTER TABLE description_generations MODIFY TTL <expr>`. `created_at` is `DateTime64(3,'UTC')` —
mirror the events pattern (`toDateTime(created_at) + INTERVAL 13 MONTH`; verify the exact DateTime64
TTL syntax). **Retention = 13 MONTH** default (anti-hallucination audit trail → align with the
longer `events` audit sibling, not intent_events' 90 days); treat as a reasoned default, escalate
ONLY on concrete compliance evidence for a different value — don't block. Do NOT alter 0007. Follow
`0007`/`0001` conventions (LOCAL=1 MergeTree note, idempotency, journal/numbering). Must pass the
**"ClickHouse migrations smoke"** CI gate.

**Operator note (put in the PR body):** CH migrations don't auto-apply to prod — this lands
CODE_COMPLETE; a CH admin applies it, ideally BUNDLED with the pending FOLLOW-463
`GRANT INSERT ON default.description_generations TO ingest_worker;` so the TTL is in place before
the table receives its first prod write.

**Open a PR when done; do not merge.** Report the migration filename, exact TTL expression, chosen
retention, migrations-smoke gate result, and any escalation. Do NOT edit `backlog/QUEUE.md`
(orchestrator single writer).

---

## PM orchestrator (session 21) → architect, FOLLOW-470

**From:** pm-orchestrator (session 21) **To:** architect **Date:** 2026-07-09 **Branch:**
`architect/FOLLOW-470-snapshot1-doc-refresh` (agent-prefix required or push-CI won't run — see
project memory `project_follow105_branch_ci_trigger`). **Model: Opus** — this is a whole-repo,
cross-module verification/reconciliation task (re-derive ~25 Snapshot.1 row verdicts against actual
current code, not a single-domain implementation), closer to an architecture audit than routine doc
editing; per CLAUDE.md's mandatory model-fit rule this earns Opus even though the deliverable is
prose, because the failure mode of getting it wrong (a stale/inaccurate SoT) is exactly what caused
the 2026-05-20 six-hour-duplicated-work incident documented in CLAUDE.md's Document Versioning
Policy.

**Read first (in this order, per CLAUDE.md/OPERATING_PRINCIPLES):**

1. `docs/MASTER_DESIGN.md` §Snapshot.1 (`### §Snapshot.1 — Per-section verdict (collapsed)`, line
   ~426) — the table you are correcting. Note the table currently shows things like "SDK IIFE 93.3
   KB (over-budget)" which is itself stale (FOLLOW-469's 2026-07-01 audit measured 39.86KB against a
   42KB budget) — a live example of the drift you're fixing.
2. `docs/ops/OPERATING_PRINCIPLES.md` Rule 1 (Master_Design = SoT).
3. `CONVENTIONS_PATCH.md` current rules (cite any that apply to your changes).
4. `backlog/FOLLOW_UPS.md` the full `FOLLOW-380` entry (search `## FOLLOW-380 —`, ~line 10403) — the
   orphaned P1 ticket you must promote into a real `backlog/QUEUE.md` entry as part of this ticket.
5. The 2026-07-01 audit findings referenced across Sprint 22b tickets (FOLLOW-449 through FOLLOW-471
   in `backlog/QUEUE.md`) — these are your primary source for "what does §6.4 mean by 5-weeks-stale
   and 25 rules vs claimed 8" and for the current real per-section state (intent-engine real/Modal,
   21/46 SDK event types produced, chat NLP code-complete-but-dead-in-prod [CEO Q2 shadow-only
   decision], bandit loop, etc.). Do NOT re-run the audit — the Sprint 22b ticket bodies + their
   `notes:`/`source:` fields already contain the verified current-state facts; your job is
   reconciliation, not re-discovery, though spot-verify anything you cite with a grep before writing
   it down (verify-not-guess, Operating Principle 5).

**Ticket:** FOLLOW-470 (`backlog/QUEUE.md`, Sprint 22b, P2). Full AC is in the ticket block — three
parts:

1. **§Snapshot.1 re-date + per-section verdict reconciliation.** Header currently dated 2026-05-24.
   Walk every row (A.1…, through whatever the table currently enumerates) and correct any verdict
   that no longer matches shipped code — grep the actual symbol/file for each row before changing
   its verdict (do not eyeball). Where a row is genuinely unchanged, leave it. Where
   CONVENTIONS_PATCH rule-count is cited as "8 rules A–H" vs the actual current count, correct it
   (count the actual rules in `CONVENTIONS_PATCH.md` — expect ~25, per the ticket source, but verify
   the true count yourself rather than trusting that number).
2. **README.md + CLAUDE.md correction.** README currently says "Sprint 0" — fix to reflect actual
   current sprint state (Sprint 22b, in progress, per `backlog/QUEUE.md`). CLAUDE.md still describes
   Tiers 1/2/3 as if live — the CEO ruling (memory `project_no_tiers_single_model`, 2026-06-05,
   MASTER_DESIGN §E.7) retired Tiers entirely; find every Tier 1/Tier 2/Tier 3 reference in
   `CLAUDE.md` and either remove it or flag it explicitly as historical/retired language (do not
   silently rewrite CLAUDE.md's `## Three integration tiers` framing without flagging the
   discrepancy — CLAUDE.md is also read as ground truth by every future session, so get this one
   right; if genuinely ambiguous whether a Tier reference is describing history vs. current
   architecture, note it rather than guessing).
3. **Promote FOLLOW-380 into QUEUE.md.** Copy/adapt the full `FOLLOW-380` stub from
   `backlog/FOLLOW_UPS.md` into a real `backlog/QUEUE.md` ticket block (`status: READY`,
   `depends_on: []`, `recommended_agent: sdk-engineer` per the stub — keep as
   `agent: sdk-engineer`), placed in whichever sprint/section is the current convention for
   freshly-promoted P1 follow-ups (Sprint 22b tail, matching how FOLLOW-467/468/469/472/474 were
   promoted — same pattern). Mark `promoted_to_queue: true` on the FOLLOW_UPS.md stub (do not delete
   the stub — leave it as a cross-reference per existing convention).

**Do NOT:**

- Touch any `.ts`/`.py`/`.sql` file — this ticket is docs-only.
- Silently rename any Master_Design section (§Y.2 propagation rule — if a rename is genuinely
  warranted, flag it in the PR description instead of doing it unilaterally).
- Re-run the 2026-07-01 audit yourself (that's FOLLOW-471's job, later, after the whole epic is
  done) — you are reconciling docs against ALREADY-VERIFIED Sprint 22b ticket facts, not
  re-verifying prod state from scratch.
- Edit `backlog/QUEUE.md`'s `## ▶️ START HERE` banner (orchestrator-owned) — you may add/edit the
  FOLLOW-380 ticket block and FOLLOW-470's own `notes:`/`status:` progress, but leave the top banner
  to the orchestrator.

**Bump Master Design version** per your own findings (this is a real content change, not a
mechanical one) — add a `Changelog v4.3` line following the existing changelog convention seen at
the top of the file, dated 2026-07-09, summarizing what you corrected. Do not invent new decisions —
this is a truth-reconciliation pass, not a ratification of anything new.

**Open a PR when done; do not merge.** Report: the exact §Snapshot.1 rows you changed (before/after
verdict) with the grep/file evidence for each, the README/CLAUDE.md Tier-language findings + your
resolution, confirmation FOLLOW-380 is now a real QUEUE.md ticket block, and any place you found
something genuinely ambiguous and left a note instead of guessing. Do NOT edit `backlog/QUEUE.md`'s
banner (orchestrator single writer for that section) — your ticket-status/FOLLOW-380 promotion edits
inside the ticket bodies are fine and expected.

---

---

## Delegation brief — FOLLOW-559 (backend-engineer) — server-side consent gate for profiling-class events

**From:** pm-orchestrator (session 30) **To:** backend-engineer **Date:** 2026-07-16

**Ticket:** `backlog/QUEUE.md` id `FOLLOW-559` (P2, Sprint 23, audit finding A3-F-08). **Branch:**
`backend-engineer/FOLLOW-559-consent-gate` (branch-first — create it before any Edit; never commit
to `main`).

**Model: Opus** — policy-shaped, not mechanical. It needs a correct event-class → allowed-
consent-states matrix over the whole taxonomy, must not break a CEO ruling, and carries a real
placement decision (see §Open decision). Per model-fit table: "complex single-domain reasoning …
security-sensitive changes" → Opus, not the Sonnet implementation row.

**Context — read first (Operating Principle 1):**

- `docs/MASTER_DESIGN.md` §Snapshot.1, then §H.8 (:2870) and §H.9 (:2907).
- **The load-bearing constraint (do NOT get this wrong):** the CEO 2026-06-23 §H.9 scope ruling says
  opt-out suppresses **client-side** AL profiling + quiz archetype persistence ONLY — **the ingest
  stream rides §H.8 and must keep flowing**. So this gate keys on `consent_state`, NOT on opt-out
  status. An opted-out user still sends events carrying a valid `consent_state` (they consented at
  registration under §H.8); those events MUST still pass. Do not reach for opt-out state anywhere in
  this gate. (Memory: `project_optout_enforcement_h9_scope`.)

**Verified starting facts (I checked these against HEAD; re-verify before editing):**

- `packages/shared/src/schemas/event.ts:29-34` —
  `ConsentStateSchema = z.enum(['none', 'session-only', 'legitimate-interest', 'consented'])`. Today
  it validates **shape only**; nothing gates on the value. That is the whole bug (A3-F-08):
  `apps/ingest` stores whatever parses.
- The event taxonomy is a discriminated union spread across
  `packages/shared/src/schemas/events/*.ts` (~49 `type: z.literal(...)` members at HEAD — I counted
  49; the ticket says 52 and the audit said 46, so **derive the canonical set from the union type at
  build time, do NOT hardcode a count or a list**; that drift is exactly what AC3 exists to catch).
- `consent.granted` / `consent.denied` are audit events, not profiling — they MUST always ingest
  (you cannot record a consent-denial through a gate that rejects on consent-denial).

**Deliverable — the consent-class matrix.** Every event type must be classified. At minimum:
`profiling` (behavioral: `scroll.depth`, `mouse.dwell`, `page.view`, `chat.*`, `quiz.*`, `photo.*`,
`floorplan.*`, `listing.*`, `price.*`, `search.query`, `filter.*`, etc. — §H.8(a) behavioral
tracking) vs `audit`/`operational` (`consent.granted`, `consent.denied`, `adapt.*` server-outcome
events, `ab.assignment`, `session.quality.snapshot`). You decide the exact classes; profiling-class
is the one that gets gated. Profiling events with `consent_state` NOT in {`consented`,
`legitimate-interest`} are rejected.

**AC (verbatim from the ticket):**

- [ ] Profiling-class events with `consent_state` not in {consented, legitimate-interest} are
      rejected (or quarantined) at validation, with a structured Sentry counter.
- [ ] `consent.granted`/`consent.denied` audit events + §H.9 opt-out-flagged events still ingest
      (explicit tests — do not regress the CEO 2026-06-23 §H.9 ruling).
- [ ] Contract test enumerates every event type into a consent-class map so a new event type must
      declare its class (no unclassified type ships — Rule H-adjacent). Derive the enumeration from
      the union, so an unclassified new type fails the test rather than silently defaulting.

**⚠️ Open decision — RESOLVE EXPLICITLY, escalate if it's a contract change:** the ticket spec cites
`event.ts` (shared schema) but the title says the `apps/ingest` **storage boundary**. These differ:
a Zod refinement in the shared envelope enforces for **every** consumer (SDK, decision-api, ingest),
which is stronger defense-in-depth but **mutates the shared ingest event contract** — and CLAUDE.md
lists "ingest event schema" as a public API surface that requires escalation BEFORE the PR. A gate
layered at the `apps/ingest` boundary (a separate validation pass after `safeParse`) keeps the
shared shape contract untouched. **Prefer the ingest-boundary placement** unless you can show the
shared-schema refinement is non-breaking (it rejects only inputs that were already policy-invalid).
State your choice and reasoning in the PR body; if you land on mutating the shared envelope shape,
write `backlog/ESCALATIONS.md` and escalate to architect BEFORE opening the PR (per CLAUDE.md
"change a public API surface" rule).

**reject vs quarantine:** CEO preference unknown. Default = **reject with 4xx + structured Sentry
counter** (sanctioned in the ticket). If during implementation quarantine turns out materially
better (e.g. you find a legitimate replay path that would lose data on reject), stop and escalate
rather than silently choosing (agent coding standards §1).

**Scope discipline (§3):** touch the gate + its tests + the class map. Do not refactor the event
union, the ingest pipeline, or unrelated validation. If you spot the taxonomy-count drift (49/52/46)
as a real doc bug, mention it — don't fix it here.

**On completion:** open a PR from the branch, run local
`pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, report back. Do not mark
your own ticket DONE — PM validates (CI green + runtime wiring + AC + the §H.9 non-regression)
before READY_FOR_REVIEW.

---

## Delegation brief — FOLLOW-574 (compliance-engineer) — close the ClickHouse axis of the DSR disclosure union

**From:** pm-orchestrator (session 30) **To:** compliance-engineer **Date:** 2026-07-17

**Ticket:** `backlog/FOLLOW_UPS.md` FOLLOW-574 (P1, Sprint 23 Wave 2, audit RETRO-176 §LG-1).
**Branch:** `compliance-engineer/FOLLOW-574-clickhouse-disclosure` (branch-first — create it before
any Edit; never commit to `main`). Read the full stub in FOLLOW_UPS.md — it has the complete AC set
(a)–(e); this brief grounds it and must not contradict it.

**Model: Opus** — P1 GDPR compliance, security-sensitive, a cross-runtime id-resolution correctness
trap, and a volume-safe delivery design. Per model-fit: "security-sensitive changes, non-trivial
design" → Opus.

**⚠️ COMMIT YOUR WORK BEFORE YOU FINISH.** A prior session hung with completed work stranded
uncommitted in a worktree and two sessions wrongly concluded the agent never ran.
`git add && git commit` as soon as the implementation works, then continue. An uncommitted diff is
indistinguishable from no work.

**The CEO ruling that unblocked this ticket (ESC-037 RESOLVED 2026-07-17) — do NOT re-open it:**

1. **`events` = FULL ROW EXPORT, not an aggregate.** The current
   `events_summary: {count, first_at, last_at}` does not satisfy Art. 15(3) "a copy of the personal
   data". Export the actual rows.
2. **Volume-safe delivery is required** (`events` is high-volume per session): pagination /
   streaming / a size cap with a documented continuation token — NOT one unbounded in-memory
   response. This is YOUR engineering design; the completeness requirement is fixed.
3. This ticket sequences **before FOLLOW-570**.

**Verified starting facts (checked against HEAD 2026-07-17; re-verify before editing):**

- **The canonical 5 tables** — `DSR_CLICKHOUSE_TABLES`
  (`apps/control-plane/src/lib/clickhouse-dsr.ts:71-78`): `events`, `adaptation_decisions`,
  `llm_calls`, `session_quality` (all keyed on `session_id`), and `intent_events` (keyed on
  **`intent_session_id`**, `idSource: 'intent_session_id'`). AC-(a) requires the disclosure set be
  **derived from this constant**, never hand-typed (that is the FOLLOW-576 defect one storage-class
  over — do not repeat it).
- **Today's disclosure** is only `getSessionEventSummary()` (`clickhouse-dsr.ts:304`) → an aggregate
  over `events` alone, emitted as `events_summary` at `access/route.ts:326` and
  `portability/route.ts:321`. The other four tables are erased-but-undisclosed. **Both routes
  disclose identically** — fix both, keep them in parity.
- **⚠️ The `intent_events` correctness trap:** it is filtered by `intent_session_id`, NOT the SDK
  `session_id`. The erase side resolves this via `resolveIntentSessionId()`
  (`@/lib/intent-session-lookup`, used in `erase/route.ts:63`). Your disclosure query for
  `intent_events` MUST do the same resolution — a raw `session_id` filter returns the wrong data
  (empty or cross-session). Mirror the erase side exactly.
- **`getSessionEventSummary` is your query template** — extend its param-bound pattern (FOLLOW-462:
  `{tenant_id:String}` params, `escapeClickHouseParamValue`, never string-concat) for the new
  row-export queries.

**AC(d) — the `engagement_scores` phantom (verify, don't assume):** repo-wide grep for an
`engagement_scores` writer (INSERT/UPSERT/.values) finds ZERO code hits — only the Drizzle type
`$inferInsert` in `packages/db/src/schema/engagement_scores.ts`. BUT the stub warns this grep class
under-reports: `intent_sessions` has a real PostgREST/Supabase-client UPSERT producer invisible to a
Drizzle-shaped grep. So before declaring it a phantom, also check PostgREST/Supabase-client writers
and note the out-of-repo actors (ingest Worker, local-only Estalara-app). Then do exactly one of:
identify the producer, file its absence as an unbuilt-producer ticket, or retire the table — and
reconcile `ropa.md:408` + `dpia.md:198` to whichever is true. Record the verdict in the PR body
(AC-e: it arms/disarms RETRO-176's PHANTOM-STORE pattern).

**AC(c) — Rule N / DPIA:** `docs/compliance/dpia.md` §8 step 5 ships updated in the SAME PR.
**Coordinate with FOLLOW-575** (same DPIA paragraph — two PRs will conflict; cf. RETRO-173's
#504/#506 sprawl). If FOLLOW-575 has not shipped, fold its §8 corrections into this PR or explicitly
note the boundary.

**Escape hatch (agent coding standards §1):** if the volume-safe pagination design turns into a
backend-depth blocker you can't cleanly resolve, STOP and write `backlog/ESCALATIONS.md` / hand off
rather than guessing a fragile export — a wrong DSR export shape is a compliance defect.

**Scope discipline (§3):** touch the CH disclosure path (new row-export fns in clickhouse-dsr.ts +
both routes' CH legs + tests) + the DPIA + the phantom reconciliation. Do NOT refactor the Postgres
disclosure legs (FOLLOW-558, already shipped) or the erase route.

**On completion:** open a PR, run local
`pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, report back. Do not mark
the ticket DONE — PM validates (CI + AC + the intent_session_id resolution + the DPIA sync) before
READY_FOR_REVIEW.

---

## Delegation brief — FOLLOW-581 (backend-engineer) — fix the latent intent_events erase no-op (Art. 17)

**From:** pm-orchestrator (session 30) **To:** backend-engineer **Date:** 2026-07-17

**Ticket:** `backlog/FOLLOW_UPS.md` FOLLOW-581 (P1, discovered during FOLLOW-574). **Branch:**
`backend-engineer/FOLLOW-581-intent-events-erase-key` (branch-first — create it before any Edit;
never commit to `main`). Read the full stub — it has the fix options + AC; this brief grounds the
blast radius.

**Model: Opus** — P1 GDPR Art. 17 correctness, security-sensitive, cross-cutting (touches a shared
constant consumed by three call sites). Per model-fit: "security-sensitive changes, non-trivial
design" → Opus.

**⚠️ COMMIT YOUR WORK BEFORE YOU FINISH.** A prior session hung with completed work stranded
uncommitted in a worktree; two later sessions wrongly concluded the agent never ran.
`git add && git commit` as soon as it works. An uncommitted diff is indistinguishable from no work.

**The bug (verified against HEAD):** `POST /api/dsr/erase` deletes `intent_events` with
`ALTER TABLE intent_events DELETE WHERE intent_session_id IN (resolveIntentSessionId())`, but real
rows are written with `intent_session_id` at its **zero-UUID default** (the ingest writer
`apps/ingest/src/handlers/intent-snapshot.ts` omits it) and the SDK fingerprint in the String
`session_id` column (migrations 0015/0016). `resolveIntentSessionId()` returns the Postgres
`intent_sessions.id` UUID — which matches NO real row. So **erase never deletes intent_events** for
any subject — a latent Art. 17 completeness bug. The authoritative reader `clickhouse-tracer.ts:8-9`
confirms: "Join key: session_id … Do NOT use intent_session_id." FOLLOW-574 already discloses
intent_events on `session_id` (the correct key); this ticket makes erase agree.

**The fix (stub's preferred option) + its FULL blast radius (I traced it — the stub understated
it):**

1. **`DSR_CLICKHOUSE_TABLES`** (`apps/control-plane/src/lib/clickhouse-dsr.ts:73-78`): change the
   `intent_events` entry to `{ table: 'intent_events', column: 'session_id' }` — drop
   `idSource: 'intent_session_id'`. This is the shared constant BOTH erase and disclosure derive
   from, so fixing it here is the root fix.
2. **`erase/route.ts`** — remove the now-unnecessary `idSource === 'intent_session_id'` special
   path: the skip-guard (~:228), the filter-value pick (~:247), the `resolveIntentSessionId()` call
   (~:353), and the `intentSessionId` plumbing (~:159-160). intent_events now filters on
   `session_id` like the other four tables.
3. **⚠️ `mutation-poll/route.ts` — the stub MISSED this consumer.** It ALSO special-cases the
   column: `resolveIntentSessionId()` at :176 and `column = 'intent_session_id'` at :191. The poller
   re-issues / tracks mutations by (table, column), so it must be updated in lockstep or a re-issued
   intent_events mutation will still target the wrong column. Fix both.
4. **⚠️ Rule I — `resolveIntentSessionId` may become DEAD.** Its ONLY two callers are erase/route.ts
   and mutation-poll/route.ts (I grepped — no others). If your fix removes both, the function +
   `@/lib/intent-session-lookup` export is now unused → remove it (and both imports) rather than
   leaving a new dead export. Run `scripts/check-rule-i.sh` and confirm you did NOT add violations
   (baseline is now **180** on main — do not regress it; net-zero or better).
5. **FOLLOW-574's disclosure special-case** — `getClickHouseDisclosure` in `clickhouse-dsr.ts` has
   an `intent_events` note + branch that queries `session_id` DESPITE the constant saying
   `intent_session_id`. Once the constant IS `session_id`, that special-case is redundant: simplify
   it so intent_events derives from the constant like the others (AC-b: "remove the divergence note
   once erase + disclosure key agree").

**AC (from the stub):**

- [ ] Erase of intent_events matches + deletes the subject's real rows — route-driven/mutation-SQL
      test seeding rows with `session_id` populated + `intent_session_id` at zero-UUID, asserting
      the DELETE targets `session_id` and empties them. (Harness: `clickhouse-dsr.test.ts` for the
      mutation SQL, `dsr-routes.test.ts` for route behavior.)
- [ ] FOLLOW-574's disclosure divergence note for intent_events removed (erase + disclosure now
      agree).
- [ ] DPIA §8 step 5 divergence note updated (it currently says intent_events disclosure diverges
      from erase — that's now resolved).

**Escape hatch (agent coding standards §1):** if removing the idSource machinery turns out to have a
consumer I didn't find, or the ClickHouse ORDER BY constraint (migration 0016 — intent_session_id is
in the ORDER BY key) blocks something, STOP and escalate rather than guessing. A DELETE-WHERE on the
non-key `session_id` column is fine (the stub confirms), but flag anything unexpected.

**Scope discipline:** touch the intent_events keying across the three consumers + the constant +
tests + DPIA. Do NOT change how the other four tables are erased, or the ingest writer, or the
tracer.

**On completion:** open a PR, run local
`pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build`, confirm
`scripts/check-rule-i.sh` ≤ 180, report back. Do not mark DONE — PM validates.

---

## Delegation brief — FOLLOW-579 (backend-engineer) — strip session.quality.snapshot derived-intent fields for unconsented users

**From:** pm-orchestrator (session 30) **To:** backend-engineer **Date:** 2026-07-17

**Ticket:** `backlog/FOLLOW_UPS.md` FOLLOW-579 (P2, RETRO-177 §LG-1). **Branch:**
`backend-engineer/FOLLOW-579-quality-snapshot-strip` (branch-first — before any Edit; never `main`).
Read the full stub — the CEO ruling banner + AC set. This brief grounds the persistence path.

**Model: Opus** — §H.8(d) GDPR-sensitive, and a conditional payload-redaction at the ingest boundary
that must NOT regress the operational always-ingest posture. Per model-fit: security-sensitive.

**⚠️ COMMIT BEFORE YOU FINISH.** A prior session hung with completed work stranded uncommitted in a
worktree; `git add && git commit` as soon as it works.

**The ruling (CEO 2026-07-17 — decided, do NOT re-open):** `session.quality.snapshot` STAYS
`operational`/always-ingest (its aggregate data-quality-score metric is a lawful operational
record). But strip the §H.8(d) derived-intent fields — `final_archetype`, `final_confidence`,
`prediction_stability_score` — from the persisted record when
`consent_state ∉ {consented, legitimate-interest}`. Consented / legitimate-interest users keep them.

**Verified persistence path (this simplifies the fix — the stub's "ClickHouse session_quality sink"
phrasing was aspirational):**

- The ingest ClickHouse producer (`apps/ingest/src/clickhouse-producer.ts:146`) writes **every**
  event to the generic **`events`** table (`INSERT INTO events FORMAT JSONEachRow`), payload as
  JSON.
- The dedicated `session_quality` ClickHouse table (migration 0005, a DSR-erase target) has **NO
  writer anywhere** — grep for `INSERT INTO session_quality` = zero. It is forward-designed.
- So `session.quality.snapshot` lands in `events` with `final_archetype` etc. inside its JSON
  `payload`. **The strip is therefore a payload-key deletion** (`delete payload.final_archetype`,
  `final_confidence`, `prediction_stability_score`) before the event reaches the sinks — NOT a
  ClickHouse column concern (no dedicated typed columns are written today).

**Verified starting facts:**

- Gate: `apps/ingest/src/consent-gate.ts:120` — `'session.quality.snapshot': 'operational'`. Leave
  the CLASS as `operational` (ruling option ii — do NOT reclassify to profiling).
- Payload schema: `packages/shared/src/schemas/events/session-quality.ts` — the three fields at
  `:37,46,48`; the rest of the payload (DQS metrics) stays.
- The handler `apps/ingest/src/handlers/events.ts` already has a per-event
  `for (const evt of validated)` loop with a per-type special-case for `intent.snapshot` (~:272) —
  the natural place to add the session.quality.snapshot conditional strip (or a redaction step right
  after `evaluateConsent`). Your design choice; keep it localized and near the existing pattern.

**AC (from the stub — (a) is already DONE, the ruling is recorded):**

- [ ] **(b)** Strip `final_archetype` / `final_confidence` / `prediction_stability_score` from a
      `session.quality.snapshot` payload when `consent_state ∉ {consented, legitimate-interest}`,
      before the sinks. Event still ingests (operational); the other payload fields survive; for
      consented/LI users nothing changes.
- [ ] **(c)** **Golden per-type classification fixture** in `consent-gate.test.ts`: assert the
      expected `ConsentClass` for EVERY union member (not just that it is classified). This closes
      RETRO-177 §TG-1 (exhaustiveness ≠ correctness) — a future reclassification becomes a
      deliberate fixture edit. This is the load-bearing test-quality AC; do not skip it.
- [ ] **(d)** End-to-end test (route-driven through `handlers/events.ts`, `index.test.ts` style): a
      `consent_state='none'` `session.quality.snapshot` ingests but its persisted payload has the
      three derived fields removed; a `consent_state='consented'` one keeps them.
- [ ] **(a-docs)** Record the ruling in the consent-gate module doc header. Check whether the ROPA
      (`docs/compliance/ropa.md`) / DPIA (`docs/compliance/dpia.md`) posture for session_quality
      changes (derived intent now conditionally omitted) — if a compliance doc of record enumerates
      what session_quality holds, update it (Rule N). If none does, state so in the PR body.

**Note for the PR body (not in scope to fix):** the `session_quality` dedicated table is a phantom
write-path (no producer). If one is ever built, it must apply the same strip — flag this so the
assumption is visible (ties to FOLLOW-582's phantom-store theme).

**Rule I:** baseline is **180** on main — run `scripts/check-rule-i.sh`, land ≤ 180 (net-zero). If
you add a helper, keep it module-internal unless a route imports it.

**Scope discipline:** touch the strip logic + the gate/handler + the fixture + tests + the doc. Do
NOT reclassify other event types or change the other 51 classifications.

**On completion:** PR + local `pnpm install && lint && typecheck && test && build`, Rule I ≤ 180,
prettier on every touched file. Do not mark DONE — PM validates.

## Delegation brief — FOLLOW-563 (qa-engineer) — smoke-ingest soft-skip + mutation-poll comment fix

**From:** pm-orchestrator (session 31) **To:** qa-engineer **Date:** 2026-07-17

**Ticket:** `backlog/QUEUE.md` id `FOLLOW-563` (P3, Sprint 23 Wave 3, source: 2026-07-11 audit
finding A3-F-18). **Branch:** `qa-engineer/FOLLOW-563-smoke-ingest-soft-skip` (branch-first — create
it before any Edit/Write, never commit to `main`).

**Delegation-table row used:** "E2E/integration/load/a11y tests, fixtures, golden harness" ->
`qa-engineer`.

**Model: Sonnet** — routine test-hygiene fix mirroring an existing in-repo pattern, fully-specified
AC, no open design question (model-fit table: "routine implementation inside a well-defined ticket
scope, tests... mechanical refactors" row).

**Context (read first):**

- `docs/MASTER_DESIGN.md` §Snapshot.1 (Implementation Status Snapshot) before any non-trivial task
  per Operating Principle 1.
- `CONVENTIONS_PATCH.md` Rule Q (env-gated soft-skip with positive proof, not a silent no-op) — this
  ticket is a direct instance of the Rule Q pattern. Mirror
  `tests/integration/redis-shadow-round-trip.smoke.test.ts` (already in-repo, `REQUIRE_*` env-gate +
  `::notice::` emission on skip) — do not invent a new soft-skip shape.
- No open HANDOFFS note blocks this; independent of FOLLOW-561/562/564 (same Sprint 23 Wave 3 pool,
  different files, no shared state).

**Problem (verified directly by PM, not taken on the ticket's word):**
`tests/e2e/smoke-ingest.test.ts` unconditionally `fetch`es `http://localhost:8787` (ingest) and
`http://localhost:8123` (ClickHouse) with no env-gate — on any machine without
`docker-compose up`/`wrangler dev` running, `pnpm test` hard-fails with a raw "fetch failed" instead
of soft-skipping with positive proof. Separately,
`apps/control-plane/src/app/api/dsr/mutation-poll/ route.ts:7`'s comment claims a 5-min cron while
`vercel.json:8-11` schedules `*/10` — fix the stale comment to match the actual schedule.

**AC:**

- [ ] `pnpm test` passes on a clean machine with no live services (smoke-ingest soft-skips, emitting
      positive proof it did so intentionally — Rule Q, mirror the redis-shadow-smoke contract:
      env-gated `REQUIRE_*` flag, `::notice::` on skip).
- [ ] CI (which sets the live-service env/secrets) still hard-fails on a real regression — do not
      make the assertion itself skippable in CI, only the "no live endpoint available" branch.
- [ ] `mutation-poll/route.ts:7` comment corrected to match `vercel.json`'s actual `*/10` schedule.

**Scope discipline:** touch only `tests/e2e/smoke-ingest.test.ts` (+ its CI workflow env if the
soft-skip needs a new `REQUIRE_*` var wired into `.github/workflows/e2e-smoke.yml`) and the one
stale comment line. Do not touch FOLLOW-561/562/564's files.

**On completion:** open a PR (never commit to `main`). Run locally BEFORE push:
`pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Run
`scripts/check-rule-i.sh` if you add any new exported helper (net-zero against the current baseline
— check current count on `main` first). Prettier on every touched file. Do not mark DONE — PM
validates CI green + runtime wiring before READY_FOR_REVIEW.

## Delegation brief — FOLLOW-561 (qa-engineer) — Archetype-ID parity guard for the Python and DB-seed literal copies (A3-F-10)

**From:** pm-orchestrator (session 32) **To:** qa-engineer **Date:** 2026-07-17

**Ticket:** `backlog/QUEUE.md` id `FOLLOW-561` (P3, Sprint 23 Wave 3, source: 2026-07-11 audit
finding A3-F-10). **Branch:** `qa-engineer/FOLLOW-561-archetype-parity-guard` (branch-first — create
it before any Edit; never commit to `main`).

**Delegation-table row used:** "E2E/integration/load/a11y tests, fixtures, golden harness" ->
`qa-engineer`.

**Model: Sonnet** — routine implementation inside a well-defined ticket scope (write one vitest
drift/parity test against existing literals); no open design question, no ambiguous AC. Model-fit
table row: "routine implementation inside a well-defined ticket scope ... tests" -> Sonnet.

**Context (read first):**

- `docs/MASTER_DESIGN.md` §Snapshot.1 (v4.3, §D — 18-archetype set confirmed consistent across code,
  not "3 divergent places" as a stale 2026-05 audit once wrongly alleged). Read before any
  non-trivial task per Operating Principle 1.
- `CONVENTIONS_PATCH.md` **Rule J — Mirror-code sync gate for cross-runtime duplicates** (line 382)
  is the directly-governing rule: any hand-maintained literal copy of a canonical set across
  runtimes (Python/TS/SQL) needs an automated parity/drift test, not eyeballing.
- Canonical source of truth: `packages/sdk/src/core/intent.ts:49`
  `export const ARCHETYPE_NAMES: readonly Archetype[] = [...]`.
- The three hand-maintained copies this ticket must guard:
  - `apps/intent-engine/src/nlp.py:58-77` `_ARCHETYPES: tuple[str, ...] = (...)` (Python).
  - `packages/db/src/seed/archetype-seeds.ts` (TS seed literal).
  - Migration `0005` (SQL) — locate via `packages/db` migrations directory; find the archetype
    enum/seed values it originally inserted.
  - Existing precedent test to mirror the pattern of:
    `packages/sdk/src/__tests__/intent-weights-drift.test.ts` (already guards sdk<->shared; this
    ticket extends the same style of guard to nlp.py/archetype-seeds.ts/migration 0005).
- **Exemption to encode, per AC(b):** `packages/sdk/src/__tests__/intent-archetype-hints.test.ts` /
  `archetype-hints.ts` is a deliberate SUBSET of `ARCHETYPE_NAMES`, not a full-parity copy — the new
  drift test must explicitly document/skip it as exempt, not fail on it.
- No HANDOFFS note exists for this ticket beyond this brief (first dispatch).

**Task:** Write a vitest that parses `nlp.py`'s `_ARCHETYPES` literal (regex or a small Python-JSON
export fixture — your call, document which) and `archetype-seeds.ts`'s literal, plus migration
0005's inserted values, and asserts set-equality with `ARCHETYPE_NAMES` from
`packages/sdk/src/core/intent.ts`. On any future addition/removal of an archetype in one copy but
not the others, this test must fail loudly (Rule J).

**AC (from QUEUE.md, verbatim):**

- [ ] Drift test covers nlp.py + archetype-seeds.ts + migration 0005 against ARCHETYPE_NAMES.
- [ ] Deliberate-subset archetype-hints.ts documented as exempt in the test.

**Scope discipline:** touch only the new test file (+ a tiny parsing helper if truly needed) and, if
absolutely required, an inline comment on `archetype-hints.ts` noting the exemption. Do not touch
FOLLOW-562/564's files (dashboard Panel 5, SLA docs) — those are separate Wave-3 tickets awaiting
dispatch.

**On completion:** open a PR (never commit to `main`). Run locally BEFORE push:
`pnpm install && pnpm lint && pnpm typecheck && pnpm test && pnpm build`. Prettier on every touched
file. Do not mark DONE — PM validates CI green + runtime wiring (in this case: the test itself IS
the "wiring" — the drift check must actually import/parse all three real files, not fixture-only
copies of their content, or it is not evidence per Rule Z's spirit) before READY_FOR_REVIEW.
