# Retrospective-Analyst — meta-lessons (self-improvement loop)

## 2026-06-02 · RETRO-027 (PR #172, TICKET-DESC-PIVOT-001 v1.8 — Sonnet prompt rewrite)

- **A finding I almost missed and why:** the audit-block truncation chain (LG-1). The diff _looks_
  contract-neutral — "prompt body replaced, anti-hallucination contract unchanged, max*tokens
  unchanged." The trap is that two unchanged things (max_tokens=450/600) plus one changed thing
  (length now tracks original_description) combine into a runtime regression: a long original eats
  the token budget before `<verified_facts_used>` closes, and `_parse_verified_facts` silently
  degrades to `[]` while shipping a dangling tag to the buyer. Lesson: when a PR says "X unchanged,
  Y changed," always check whether the \_interaction* of X and Y is what moved — the gap lives in
  the coupling, not in either symbol alone.
- **An axis/chain I had to trace twice:** the producer→consumer→render chain for the audit block. On
  first pass it reads "clean ✅" (parser untouched, wire intact). Only on tracing the _payload_
  under the new length policy did the truncation failure mode appear. I recorded it as a §4a logic
  gap (wire connected, payload at risk), not a §3 wiring gap — kept the wiring audit honest while
  still surfacing the P1.
- **A meta-pattern in how gaps recur across agents:** "behavioural/contract change shipped as a
  refactor, with zero new assertions because the existing suite mocks the changed surface away." The
  17-test suite mocks Sonnet output, so a full prompt rewrite is invisible to it — same shape as
  Rule H ("scaffold without a runtime-wired consumer"): an artifact ships without anything that
  verifies its new shape. Count is 1 for the prompt/output-contract variant; logged as a watch-item
  for a future Rule. If this recurs (next time an LLM prompt / external contract is rewritten with
  green CI and no shape assertion), promote it.

## 2026-06-03 · RETRO-028 (PR #182, TICKET-DESC-001 — per-listing LLM headline + ESC-018 original_description threading)

- **A finding I almost missed and why:** that ESC-018 was a **consumer-only half-wire that this PR
  closed**, not a new gap. The diff is huge and headline-centric, so the instinct is to audit the
  headline. But the load-bearing change is the schema field `original_description` becoming required
  - a producer being added — and the only reason that's safe is the Python consumer at
    `generate_description.py:1095` already required it. I had to grep the consumer's `required` set
    to confirm the wire is now connected rather than just asserting it from the PR body. The CHECK B
    classification (consumer-only = P0-class, now resolved-in-PR) only fell out after reading both
    ends.
- **An axis/chain I had to trace twice:** the anti-hallucination contract. First pass: "headline is
  grounded — the prompt says 'do not invent' and includes both sources." Second pass against the
  _description_ path revealed the asymmetry — the description has a system prompt + fact whitelist +
  parsed `<verified_facts_used>` audit block; the headline has none of that. The gap is comparative,
  not absolute: the headline isn't ungrounded, it's _less_ grounded than its sibling on the same
  surface, and it has no audit trail at all. Lesson: when two sibling LLM calls share a file, diff
  their _contracts_, not just their prompts.
- **A meta-pattern in how gaps recur across agents:** the producer↔consumer parity gap keeps
  reappearing on new axes. The `inquiry_submit_selector` chain (RETRO-017/021/022/024) was SDK/TS
  intra-runtime; ESC-018 is the same shape across the **TS→Python language boundary**, where there's
  no shared schema so each side's tests pass against its own copy. Rule J gates TS↔TS _duplicates_;
  Rule H gates same-runtime Zod-scaffold-without-consumer. Neither covers a cross-language
  non-duplicated producer/consumer pair. Count is 1 — watch-item, FOLLOW-168 is the first concrete
  verification. If a second TS↔Python (or TS↔Worker-divergent-validation) contract drift lands,
  promote a Rule requiring a shared/generated contract fixture asserted by both runtimes.
- **One thing I did right to record:** I resisted re-counting RETRO-027's "no-shape-assertion"
  candidate against this PR — #182 actually pins every new branch with 24 assertions, so it's the
  counter-example, not a recurrence. Noting positive cases keeps the promotion counter honest.

## 2026-06-08 · RETRO-035 (PR #224, FOLLOW-219 — collapse 4 cold-start guards into one block)

- **A finding I almost missed and why:** the local checkout's `main` had DIVERGED and did not
  contain the merge commit `569d3ce` (`git merge-base --is-ancestor … HEAD` → NO). My step-3 grep
  against the working tree showed FOUR `!intentStateRehydrated` guards still present and I nearly
  wrote that up as a P1 "consolidation reverted / never landed" finding. The reconcile step saved
  it: `git show origin/main:…` and `rev-list --left-right` showed origin/main was the real merged
  line (#224 → #225) and the local tree was stale. **Lesson: never trust the local working tree for
  post-merge analysis. Resolve the merge commit's reachability FIRST
  (`merge-base --is-ancestor <sha> origin/main`), then read every file via
  `git show origin/main:<path>`, not the checkout.** A divergent local main can fabricate phantom
  findings.
- **An axis/chain I had to trace twice:** the LG-2 persist. First read (local, stale) showed a
  persist at `:464` AND `:638` inside a `:637` guard — looked like the old un-consolidated shape. On
  origin/main it's persist at `:401` (inside the single cold-start block) + `:474` (the
  `onIntentUpdate` behavioral path — a legitimately separate site, NOT a duplicate cold-start
  guard). I had to trace which persist was the cold-start one vs the behavioral one before I could
  confirm "4→1". The behavioral persist is an easy false-positive for "you missed a guard."
- **A meta-pattern in how gaps recur across agents:** the loop's OWN bookkeeping is a gap source.
  RETRO-032/033/034 generated 10 FOLLOW stubs + a Rule Q amendment but their BODIES were never
  written to RETROSPECTIVES.md (log jumps 031→035). My prior-occurrence grep and rule-promotion
  counter both silently under-count because the evidence lives in stub prose, not the log. The
  "scattered-guard footgun" pattern is probably already at
  written-threshold-2-minus-the-missing-bodies. **Step-0 for every future run: verify my OWN last
  1-3 entries actually landed in RETROSPECTIVES.md before trusting the file as the prior-occurrence
  source.** Filed FOLLOW-226 to backfill.

- **2026-06-08 / RETRO-037 (FOLLOW-190, dwell-time lift)** · **A finding I almost missed and why:**
  The 41 tests + the PR's "pure, no side effects, AC-complete" framing are entirely true — for the
  HELPER axis (`applyDwellSignal`). I almost echoed "clean." EVERY real finding lives in the
  index.ts WIRING axis the tests never touch: the boost is persisted via
  `onIntentUpdate→persistIntentState` and re-accrues on the rehydrated state on the next page
  (LG-1). The lesson: a thoroughly-tested PURE helper is the strongest possible decoy — the side
  effects it disclaims ("no globals, no persistence") are exactly what its CALLER does. Always read
  the caller, not just the unit under test.
- **An axis/chain I had to trace twice:** the persist→rehydrate→re-apply chain. First pass I saw the
  dwell timer reset on archetype switch (AC4, genuinely closed) and almost moved on. Second pass:
  followed `onIntentUpdate` → `persistIntentState` (`:464`) → next-page `rehydrateIntentState`
  (`:338`) → `startDwellTimer` restarts because `previousArchetype` starts null (`:541-545`) → boost
  compounds. The chain only closes when you trace it ACROSS the page-navigation boundary, not within
  one init().
- **A meta-pattern in how gaps recur across agents:** This is the THIRD consecutive SDK retro in the
  rehydrate-boundary family (RETRO-032 FOLLOW-207 priors, RETRO-034 the untested seam, RETRO-037 the
  dwell boost). Each agent "wires its signal" correctly in isolation and forgets the FOLLOW-176
  persistence boundary that turns every per-page mutation into a per-session accumulator. I promoted
  Rule R for exactly this. Also a process gap: FOLLOW-216 declared `blocks FOLLOW-190` / "sequence
  BEFORE FOLLOW-190" and FOLLOW-190 merged first anyway — declared-blocker ordering is not enforced
  at the PM/merge gate. Watch-item (count 1) for a future ordering Rule.
- **My own blind spot (carried from last run):** Re-confirmed the RETRO-032/033/034 bodies are STILL
  absent from RETROSPECTIVES.md and Rule Q's body is absent from CONVENTIONS_PATCH.md, though both
  are referenced everywhere. I grepped FOLLOW_UPS + the QUEUE footer (not just RETROSPECTIVES.md) to
  get the true RETRO/FOLLOW/Rule numbering — relying on RETROSPECTIVES.md alone would have numbered
  this RETRO-032 and collided. Promoted my new rule as Rule R (not Q) to avoid the
  dangling-reference collision. FOLLOW-226 (backfill) remains the right fix; until it lands, ALWAYS
  cross-check the FOLLOW_UPS footer + QUEUE for the real high-water marks.

## 2026-06-08 · RETRO-038 (FOLLOW-182 / PR #222)

- **A finding I almost missed and why:** The PR ships a test literally named the "CI gate for the
  Rule K.1 amendment" and the PR body asserts the parity gate exists. I almost recorded the gap as
  CLOSED on that claim. Reading the test source revealed it is TAUTOLOGICAL: `allRankEntries()`
  computes each entry's `rank` by calling `conversionLabelRank()`, then the test asserts
  `entry.rank === conversionLabelRank(samePair)` — `x === x`. It never executes the generated SQL.
  Lesson: a test named a "parity gate" is not a parity gate; trace what the asserted value is
  DERIVED from before crediting coverage. The genuine SQL-vs-TS path stayed untested (still
  FOLLOW-183).
- **An axis/chain I had to trace twice:** The local working tree was STALE (`git show <merge-sha>`
  failed; local `main` was several commits behind origin and the file on disk was the pre-merge
  version). I first read the OLD `conversion-label.ts` (unexported map, no `allRankEntries`) and
  nearly analyzed the wrong code. Had to re-fetch and run all greps against the commit object
  (`git grep <pattern> d7b9de7`, `git show d7b9de7:<path>`) rather than the checkout. Build the
  habit: when `git show <sha>` fails, fetch and pin EVERY read to the commit object, not the
  worktree.
- **A meta-pattern in how gaps recur across agents:** "test theater" — a refactor edits the exact
  load-bearing artifact a prior retro flagged as untested (RETRO-030 TG-1: the SQL WHERE clause),
  and the new tests cover the _sibling_ TS function or assert a value against itself, leaving the
  deliverable still unexecuted. The gap doesn't move one hop downstream (the RETRO-024 failure mode)
  — it stays exactly put while _looking_ closed. The fix-PR even raises the risk (static literal ->
  generated SQL). Watch for this whenever a remediation PR claims to satisfy a coverage/parity rule:
  verify the new test EXECUTES the changed code path, not a proxy for it.
- **Process gap in my own loop:** RETROSPECTIVES.md is under heavy concurrent append by parallel
  retro runs — RETRO-032/033/034 are referenced-but-unwritten (other tickets reserved the numbers),
  and RETRO-035/036/037 were written by other runs WHILE I was composing. The `Edit` tool kept
  failing ("file modified since read"). Resolution: compute the next-free RETRO number with a
  guarded shell `cat >>` heredoc that re-checks for collision atomically right before append, and
  key idempotency on a unique header pattern (`^## RETRO-NNN — FOLLOW-182`) rather than a bare
  number. Don't trust the number computed at the start of the run.

## 2026-06-08 · RETRO-044 (PR #233, FOLLOW-184 — DSR durable_lead_id closes the Art. 17 CRM erasure gap)

- **A finding I almost missed and why:** the Art. 15/20 (access + portability) symmetric gap. The PR
  is a textbook clean closure — it directly resolves RETRO-031 §4a LG-1, ships a real PGlite harness
  (not mocks), guards the empty-key boundary at two layers, and the wire is end-to-end. Every signal
  said "clean ✅, parent gap closed." The trap: a DSR has THREE verbs and the fix touched ONE. I
  only caught it because step 8 (multi-axis) forced me to grep `conversion_labels` across ALL
  dsr/\*/route.ts — and access/portability returned 0 hits. The lesson: "the parent gap is closed"
  is necessary but not sufficient — ask "closed on which AXIS, and what are the siblings of that
  axis?" A completeness/erasure concern almost always has symmetric verbs (access/erase/portability;
  read/write; variant/holdout; per-locale) and a fix to one is a yellow flag for the others.
- **An axis/chain I had to trace twice:** the `durable_lead_id` wire. First pass: producer
  (initiate) → consumer (erase Pass B) → render(delete), proven by PGlite AC-1 — genuinely
  end-to-end, NOT a half-wire. I almost stopped there. Second pass: I asked "who ELSE should consume
  this column?" and found access/portability are the missing consumers — reclassified from "CHECK B
  clean" to an incomplete-fan-out logic gap (one upstream fact, 3 sibling consumers, only 1 wired).
  The wire IS complete; the FAN-OUT is not. New sub-distinction worth keeping: HALF_WIRE = no
  consumer; INCOMPLETE_FAN_OUT = some-but-not-all of the N consumers that need the fact.
- **A meta-pattern in how gaps recur across agents:** DSR completeness is a per-VERB, per-STORE
  property and the verbs drift every time a new PII store is added — FOLLOW-039 wired ClickHouse
  into erase, FOLLOW-184 wired the CRM namespace into erase, but access/portability were last
  meaningfully touched before `conversion_labels` even existed and silently fell behind. The
  recurring shape: when a NEW store/identifier is added, the agent wires it into the verb the TICKET
  names (erase) and the sibling verbs are out of the ticket's scope so they rot. A single shared
  "DSR data inventory" consumed by all three verbs would structurally prevent it — flagged in §5d
  for the PM. Watch for a SECOND instance of "fix one of a symmetric set" to promote the §6 lesson
  candidate to a rule.
- **Own blind-spot logged:** the live `erase/route.ts` carried FOLLOW-238/239 capability code merged
  AFTER #233; I nearly attributed `crm_tenant_unverifiable` to FOLLOW-184. Always scope to
  `git show <mergeCommit>`, never the working-tree file. (Same family as RETRO-038's stale-main
  note.)

## 2026-06-09 · RETRO-046 (PR #243, FOLLOW-185 — PGlite CRM+DSR harness)

- **A finding I almost missed and why:** the PR's "golden-query regression test" claim. The PR body
  asserted that any production WHERE-clause divergence would break scenario (a). I almost accepted
  it because the harness IS real PGlite SQL (looks rigorous). Reading `runEraseTransaction` showed
  it is a HAND-COPY of the erase route, not an import — so a production divergence would leave it
  green. The lesson: "real-SQL harness" ≠ "tests the production route." Always check whether the
  integration test IMPORTS the route/handler or RE-TYPES its query. Bypass/mirror = the gap moved
  one hop (mocked-route → bypassed-route), not closed.
- **An axis/chain I had to trace twice:** the RETRO numbering + body-existence chain. RETRO-044 is
  the last body in RETROSPECTIVES.md, but CONVENTIONS_PATCH Rule S cites "RETRO-045 §6". Tracing it:
  RETRO-045 WAS committed (`b280197`, ancestor of HEAD) and added 276 lines to RETROSPECTIVES.md —
  but PR #242 was SQUASH-merged (`cde10e7`) which dropped the body; the canonical file has no
  RETRO-045. Same loss-shape as RETRO-032/033/034 (FOLLOW-226) and RETRO-039–043 (no bodies). I had
  to reconcile Rule S against the authoring COMMIT, not the (missing) in-file §6. Filed FOLLOW-251 +
  a CI-lint AC.
- **A meta-pattern in how gaps recur across agents:** "test-theater that re-implements/bypasses the
  production path" now spans data-engineer (this PR + FOLLOW-184's `dsr-crm-erasure.test.ts` both
  re-type the WHERE) and backend-engineer (FOLLOW-246 disclosure verbs shipped mock-only,
  RETRO-045). Real-SQL coverage is improving but the ROUTE↔helper↔DB binding is covered nowhere —
  coverage drifts per-LAYER the way RETRO-044 showed DSR completeness drifts per-VERB. A single
  route-driven harness would retire both drifts; flagged in §5d + FOLLOW-250.
- **Process integrity note:** squash-merging retro-bearing branches is silently truncating the
  learning loop (the very loop I am). This is the third+ instance. It is a tooling defect, NOT a
  CONVENTIONS coding rule — so I filed FOLLOW-251 rather than promoting a rule. Watch for the
  retrospective-analyst's OWN outputs being dropped this way next time.

## 2026-06-09 · RETRO-046 RECOVERY RUN (PR #243, FOLLOW-185) — the prediction came true on my own output

- **What happened:** the RETRO-046 entry I authored above (and its lessons note, immediately
  preceding) was LOST when PR #243's branch was reconciled with main — merge-conflict resolution on
  `backlog/RETROSPECTIVES.md` dropped the RETRO-046 BODY while the FOLLOW-249/250/251 stubs in
  `FOLLOW_UPS.md` survived. This is the EXACT failure I had flagged one entry up ("watch for the
  retrospective-analyst's OWN outputs being dropped this way next time"). It happened on the very
  next merge. The process note in §6/§4d DG-2 was not paranoia — it is the dominant integrity risk
  to this agent's work product.
- **The recovery pattern (codify it):** when re-authoring a lost retro, (1) re-author the BODY only
  — do NOT re-file the follow-ups if they survived in `FOLLOW_UPS.md` (re-appending would double
  them and corrupt the `next free FOLLOW number` ledger); grep `FOLLOW_UPS.md` for the stub IDs
  FIRST and confirm before writing. (2) Verify the sibling retro that was reported missing is
  actually restored now (`grep "^## RETRO-045"`) before referencing it as present — state state, do
  not assume it. (3) Keep the same RETRO number; do NOT renumber. (4) Add a one-paragraph recovery
  banner at the top of the re-authored entry so a future reader knows the entry is a reconstruction,
  not the original.
- **An axis I had to re-trace:** the FOLLOW-ledger axis. The lost run had already incremented the
  "next free FOLLOW number" comment to 252 and written the 249/250/251 stubs. A naive recovery that
  re-emits stubs would have produced FOLLOW-249'/250'/251' duplicates or, worse, reused 252+. The
  discipline: a recovery run is RETROSPECTIVES-only unless a stub is verified ABSENT.
- **Meta-pattern (now confirmed, not just predicted):** the learning loop's single biggest blind
  spot is its OWN persistence layer, not the code it analyses. A finding that improves agents is
  worthless if the merge strategy silently deletes it. Until FOLLOW-251's CI-lint lands (fails on a
  cited-but-bodiless RETRO-NNN), I MUST end every run by re-grepping that the body I just wrote is
  on disk AND that every RETRO-NNN I cited has a body — treat citation-without-body as a P2 finding
  every single run, because squash/conflict loss is now demonstrably recurrent (RETRO-032/033/034,
  039–043, 045, and 046 itself).
