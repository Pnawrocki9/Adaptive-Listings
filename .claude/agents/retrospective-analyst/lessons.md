# Retrospective-Analyst — meta-lessons (self-improvement loop)

## 2026-06-10 · RETRO-047 (PR #256, FOLLOW-101 — chat.intent.detected → Bayesian prior bridge)

- **A finding I almost missed and why:** the Rule R reload-reapply double-count (LG-1). Both the PR
  body AND the ml-engineer lesson explicitly LABEL the `_chatPriorAppliedSessionId` guard as "Rule R
  idempotency," and there is a passing AC-5 "Rule R" test. The trap: the guard IS once-per-session
  in memory and the test IS green — but the guard is the WRONG KIND for the boundary Rule R actually
  governs. Rule R is about the PERSISTED rehydrate boundary (sessionStorage survives reload); an
  in-memory module variable resets on reload while the persisted (already-applied) state + the 24h
  shadow Redis key both survive → the chat likelihoods re-multiply onto the rehydrated distribution.
  Lesson: when a PR CLAIMS to satisfy an existing Rule, re-derive the rule's literal invariant
  against the code; never accept the label. The "Rule R" test was the decoy — it tested the path
  that works.
- **An axis/chain I had to trace twice:** the `quiz.mismatch` consumer. First pass it looked like a
  HALF_WIRE_P (event produced, no obvious consumer — and the whole ticket purpose is
  "disagreement-rate analytics," which has no query). Second pass: ingest is GENERIC
  (`EventSchema.safeParse` → Redpanda + ClickHouse `events` table with generic `type`+`payload`
  columns), so the event DOES reach durable storage end-to-end — NOT a half-wire. The "no dedicated
  disagreement-rate query" is a real but PRE-EXISTING (FOLLOW-100 producer) +
  deliberately-post-pilot gap, so it's a §4a logic note, not a CHECK-B P0. The discipline: trace the
  event to durable storage before classifying a missing dedicated query as a missing consumer. Also
  had to trace the SECOND `quiz.mismatch` producer (index.ts:838, FOLLOW-100) to catch the semantic
  overloading (`behavioral_archetype` reused for chat archetype + `confidence_gap:0` placeholder).
- **A meta-pattern in how gaps recur across agents:** the SAME rule (Rule R) has now been violated
  in THREE consecutive intent-engine PRs from TWO agents (RETRO-032 sdk, RETRO-037 sdk, RETRO-047
  ml). The rule exists; the verification grep (`grep "currentIntentState = apply" index.ts`) is
  BLIND to this instance because the mutation happens in `adapt.ts:fetchDirectives` and is folded
  into `currentIntentState` via a DESTRUCTURE at the index.ts call site, not a literal assignment.
  Meta-lesson for the skill-upgrade run: rules with an index.ts-shaped verification grep silently
  fail when the mutation moves into a helper that RETURNS the new state — the grep needs to follow
  the return-value fold-in, not just direct assignment. Filed as a §6 count-1 candidate to broaden
  Rule R's grep.

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

---

## 2026-06-10 · RETRO-048 (FOLLOW-252 + FOLLOW-253 / PR #258 — chat-prior Rule R fix + rehydrate test)

- **A finding I almost missed and why:** the `chatPriorApplied` JSDoc reset-path drift (LG-1). The
  field's doc confidently states `resetAdaptState()` clears it — and the PR self-check separately
  (and correctly) says `eraseIntentState` clears it. I almost accepted the JSDoc at face value
  because it READS authoritative and the functional behaviour is correct. Only by opening
  `resetAdaptState()` itself (`adapt.ts:327-331`) did I see it touches ONLY the in-memory
  `_chatPriorAppliedSessionId`, never the persisted flag. Lesson: when a field is guarded in TWO
  storage locations (in-memory + persisted), the doc almost always names ONE lifecycle and silently
  attributes it to the other store. Always open the cited reset function and confirm which store it
  actually mutates — never trust a "cleared by X" JSDoc on a dual-storage field.
- **An axis/chain I had to trace twice:** the rehydrate-VALIDITY hop. A flag-based closure is most
  likely to silently fail not at the producer or consumer, but at the validity gate in between —
  `isValidIntentState` could have been a shape-REBUILD that drops unknown fields, which would strip
  `chatPriorApplied` on every rehydrate and silently re-open the exact bug FOLLOW-252 fixed. I had
  to read `isValidIntentState` (`index.ts:169-181`) directly to confirm it is a shape-CHECK (returns
  a boolean, returns the original object) and NOT a rebuild. This is the FOLLOW-097→114→127→141
  "gap-moves-one-hop" discipline: a persisted-flag fix can fail at the validity hop or the
  rehydrate-read hop, and "the flag is written" is NOT closure until you prove the flag SURVIVES the
  round-trip.
- **A meta-pattern in how gaps recur across agents:** the SAME chat-prior chain has now produced the
  SAME blind spot for the Rule R verification grep TWICE — the bug (RETRO-047) and the fix
  (RETRO-048) BOTH live in `adapt.ts:fetchDirectives`, which the `index.ts`-shaped Rule R grep
  cannot see. The recurring meta-pattern: a verification grep written against the FIRST place a
  pattern appeared (index.ts priors) goes blind the moment the same pattern moves to a SECOND module
  (adapt.ts folds). Verification greps must be RE-DERIVED against each new instance's actual code
  location, not reused verbatim — a passing grep on the wrong file is worse than no grep (false
  confidence). I promoted the Rule R verification-clause amendment at count 2 specifically because a
  blind grep is an enforcement hole that will keep letting Rule R violations through `adapt.ts`.
- **A discipline win to keep:** the focus area handed me four leading questions (schema bump? two
  guards? new rule? test placement?). I answered each against the CODE rather than the question's
  framing: schema bump = correctly NOT done (verified the version guard would invalidate live
  envelopes); two guards = real debt but provably redundant (the in-tab test already runs on the
  persisted path alone); new rule = NO (Rule R exists; promoting a duplicate would be noise — but
  the VERIFICATION CLAUSE warranted amending at count 2); test placement = dedicated file is correct
  but leaves an orphaned stale AC-5 in the feature file. Three of four "should we?" questions
  resolved to "the shipped choice is right, here's the residual" — resist the pull to manufacture a
  P1 just because the question implied one.

---

**Date / RETRO:** 2026-06-10 / RETRO-049 (FOLLOW-102, PR #257 — quiz ON/OFF toggle)

- **A finding I almost missed and why:** the `SdkConfig.quiz` sub-object's
  `trigger_after_n_listings` field is double-dead (no `buildSnippet` producer for
  `data-quiz-trigger` AND no SDK runtime reader of the parsed value), while its SIBLING field
  `enabled` IS fully wired end-to-end with 10 green tests. The green tests + the fully-wired sibling
  almost made me stamp the sub-object "clean." The fix: audit EACH field of a new config shape
  independently — a sub-object is not wired because ONE field is. Run the producer grep AND the
  parsed-value-reader grep SEPARATELY per field. (Same family as RETRO-047's "guard looks correct in
  isolation but is the wrong kind for the boundary.")
- **An axis/chain I had to trace twice:** the pilot-freeze Lane-C guard. First pass: "guard exists,
  watches `enabled`, FOLLOW-117 fixed it — clean." Re-tracing against FOLLOW-102's own HANDOFFS note
  ("use the NEW `tenants.quiz_enabled` column, not `quizConfig.enabled`") revealed the guard still
  reads the OLD JSONB field while FOLLOW-102 moved the SoT — FOLLOW-117/RETRO-012's closure is
  partially re-opened (the gap moved one hop to a new column). Trusting the "DONE" label on
  FOLLOW-117 would have buried it. Always re-derive a prior closure against the NEW ticket's SoT
  declaration.
- **A meta-pattern in how gaps recur across agents:** "a previously-closed consumer↔field alignment
  is silently re-broken when a later ticket introduces a NEW authoritative field and doesn't repoint
  the old reader." This is the contract-side twin of the SDK-side step-7 closure-moves-one-hop
  pattern (inquiry_submit_selector chain). When a PR declares a NEW SoT column/field, grep for EVERY
  existing reader of the field it supersedes and verify each was repointed — the producing agent
  rarely owns all the consumers. (Count 1 as its own shape; watch for instance 2 to promote a Rule S
  sub-shape.)
- **Process note:** the Vitest v2 `vi.fn` type-arg → CI-only-typecheck escape recurred (RETRO-047
  then RETRO-049) and reached threshold 2 → promoted Rule T. Kept the rule NARROW (a green
  pre-commit ≠ a typecheck pass; run `tsc --noEmit`) and explicitly did NOT auto-mandate adding
  typecheck to the hook (that is a devops speed/DX tradeoff = escalation, not a convention to
  codify). Discipline: promote the LESSON at threshold without over-reaching into an infra decision
  the retro can't own.
- **Numbering hazard observed:** a concurrent retro authored RETRO-048 for a DIFFERENT PR (#258) and
  consumed FOLLOW 254-256 while this run was in flight. I detected the collision by grepping RETRO/
  FOLLOW headers right before writing and shifted to RETRO-049 / FOLLOW-257-258. Always re-grep the
  next free RETRO and FOLLOW numbers IMMEDIATELY before the append, not at the start of the run —
  parallel retros race on these counters.

## 2026-06-10 · RETRO-051 (PR #260, FOLLOW-263 — repoint pilot-freeze guard at typed tenants.quiz_enabled)

- **A finding I almost missed and why:** the guard NARROWING (§4a LG-1). The ticket title and source
  finding (RETRO-049 §4a LG-2) framed this as a single-axis "repoint the quiz flag to the typed
  column" — and the quiz axis WAS cleanly fixed end-to-end (8 green tests). The obvious verdict was
  "clean, closure restored." The catch came from auditing the DIFF's DELETION, not its addition: the
  rewrite removed `LANE_C_FLAG_KEYS`, a 4-element set, and the ticket only named 1 element. Grepping
  the other 3 keys' producers (zero — Rule-L dead config, so no LIVE loss) AND reading the design
  doc (PILOT_FREEZE_RULE.md still lists all 4 + the old quizConfig/active_lane_c_flags mechanism)
  revealed the guard was narrowed and its ratified Decision-3 contract orphaned. Lesson: when a fix
  DELETES a SET (flag list, key array, enum), enumerate every member's fate AND check the contract
  doc that names the set — the gap is in the members the ticket didn't name and in a doc the diff
  didn't touch.
- **An axis/chain I had to trace twice:** the quiz-axis closure. First read accepted "repointed,
  closed." I re-traced the PRODUCER side specifically — does anything WRITE tenants.quizEnabled? —
  and confirmed PATCH /api/tenants/:id:129 does, so producer→consumer→render is real (not a guard
  reading a column nothing populates). Step-7 discipline: confirm the new SoT column has a live
  writer before declaring the consumer-repoint a genuine closure; otherwise you've moved the gap to
  a never-produced field (the inverse of what FOLLOW-263 itself was fixing).
- **A meta-pattern in how gaps recur across agents:** three consecutive retros on the same
  quiz_config surface (049 guard-SoT-move, 050 producer-limb-orphan, 051 guard-flag-set-narrow +
  doc-orphan) all stem from "fix the limb/axis/key the ticket NAMES; ship green; don't enumerate the
  set, the other limb, or the contract doc describing the whole." Structural magnets for this: (a)
  multi-key JSONB blobs and (b) guards/checks over flag SETS. Both invite single-member fixes that
  pass CI. This is Rule S territory (apply to ALL siblings) — I treated LG-1 as a confirming Rule S
  application, not a new rule. When auditing ANY guard/check/multi-key store, list every member up
  front and demand each one's fate before accepting the verdict.
- **Numbering:** concurrent FOLLOW-257 retro claimed RETRO-050 + FOLLOW-264 mid-flight. I re-grepped
  RETRO/FOLLOW headers immediately before writing and took RETRO-051 / FOLLOW-265. (Confirms the
  RETRO-049 lesson: re-grep counters right before the append, parallel retros race them.)

---

## 2026-06-11 · RETRO-053 (FOLLOW-264 / PR #263 — Option-A removal complete across all 3 limbs)

- **A finding I almost missed:** the honest verdict was "clean closure — all three limbs of
  trigger_after_n_listings removed, RETRO-050 LG-1 + TG-1 both closed end-to-end, Wiring Audit
  clean, no gaps." That verdict is CORRECT for the field the ticket names. The miss would have been
  stopping there. Step-8 (analyze EVERY axis of the contract change) applied to the SURVIVING
  `QuizConfig` shape — not the removed field — surfaced MX-1: the PR edited the hand-duplicated
  `QuizConfig` interface in TWO files (route.ts + page.tsx) and the copies have drifted on
  `language` (`'en'|'pl'|'es'` API/Zod vs `'en'|'pl'` dashboard). Reading BOTH copies side-by-side,
  not just the diff hunks, is what caught it. Lesson: when a PR edits a duplicated shape, read every
  copy in full, not the diff — the drift is on the field the diff DOESN'T touch.
- **A chain I had to trace twice:** the hotfix (BUG-1). The PR body said "control-plane
  `tsc --noEmit` clean" → first read: "no test breakage." The git commit list showed a SEPARATE
  commit `0820282` ("update quiz config tests after removal") AFTER the impl commit — so tsc-clean
  AND tests-red were simultaneously true. Re-reading `route.test.ts:23-24,45` showed WHY:
  `parseBody<T>` casts `unknown`→`T` and `makePostRequest(body: unknown)`, so stale `.toBe(3)`
  assertions on the removed field COMPILE but fail at the vitest run. "tsc clean" was technically
  true and practically misleading. Lesson: never read "tsc clean" in a PR body as "tests pass" —
  check the commit list for test-fixup commits and check whether the test helpers are loosely typed
  (generic-cast `unknown`).
- **An axis I had to trace twice → became a Rule promotion:** this is the 2nd occurrence (RETRO-010
  §6 was the 1st, explicitly deferred at count 1) of "a shared-type field SHAPE change breaks
  test/fixture data OUTSIDE what `pnpm typecheck` validates." RETRO-010 = ADD direction reaching
  HTML/JSON string fixtures; RETRO-053 = REMOVE direction reaching loosely-typed TS test helpers.
  Same meta-shape → promoted a Rule G amendment (grep test/fixture data on field add AND remove; run
  the suite, tsc is not enough). I had to consciously recognize the ADD-vs-REMOVE difference is
  surface, not substance, before counting them together — the temptation was to call them two
  separate count-1 shapes and not promote. The unifying test: "does the break escape `tsc`?" Both
  yes → same rule.
- **A meta-pattern in how gaps recur across agents:** the quiz lineage (049→050→051→053) shows the
  typecheck gate manufacturing false confidence — agents fix the named limb, `tsc` passes, ship
  green, and the recurring escapes are (a) the sibling axis/other copy of a duplicated shape and (b)
  test data that COMPILES but is semantically stale. Both share the same root: "compiles = correct"
  is false for multi-copy shapes and loosely-typed (`unknown`-casting) test helpers. The Rule G
  amendment targets this seam directly. Going forward: whenever a PR's evidence rests on
  `tsc --noEmit`, ask what the typechecker cannot see (duplicated shapes,
  `parseBody<T>`/`route.fulfill`, string/JSON fixtures).
- **Numbering:** FOLLOW-266–269 are RESERVED for the Archetype Identification Tracer (QUEUE.md:13,
  CEO-directed). I grepped backlog/docs for 266–270 before filing and took FOLLOW-270 to avoid the
  reservation. Confirms the standing lesson: re-grep the counter against ALL reservations (not just
  the last sequential number) right before the append.

## 2026-06-11 · RETRO-052 (PR #262, FOLLOW-265 — ratify quiz-only freeze guard + sync PILOT_FREEZE_RULE.md + annotate orphaned quizConfig.enabled)

- **A finding I almost missed and why:** the ANNOTATE-vs-ELIMINATE half-close (§4a LG-1). FOLLOW-265
  AC4 "resolved third-consecutive retro JSONB-blob-decay flag" by adding a clean JSDoc to
  `quizConfig.enabled` declaring it orphaned. The PR body, the schema annotation, and three prior
  retros all framed this as the close-out. The obvious verdict was "AC4 done, blob decay resolved,
  clean." The trap: an annotation closes the READ-side mislead (a future reader won't trust the
  wrong store) but does NOT close the WRITE-side divergence channel. I had to grep the WRITER
  (`POST /api/quiz/config` `route.ts:142` `.set({ quizConfig: updated })`) to see it still merges
  client input — so the orphaned key can still be persisted and diverge. Standing lesson reinforced:
  when a fix "resolves" a finding by DOCUMENTING/ANNOTATING rather than DELETING, always grep the
  write path — annotation ≠ elimination, and the residual write channel is the real gap.
- **An axis/chain I had to trace twice:** the prior-closure check on RETRO-051's FOUR claimed-closed
  gaps (LG-1/LG-2/DG-1/DG-2 + TG-1). I did not trust the "FOLLOW-265 closes them" label. Tracing
  each end-to-end: 3 are genuinely closed (guard reads `quizEnabled` only + doc rewritten to match;
  citation fixed; 4-flag list gone), and 1 (the orphaned key) moved
  undocumented→documented-but-still- writable — a real hop FORWARD, not a one-hop shuffle, but not a
  full close → FOLLOW-271. The step-7 discipline (trace producer→consumer→render / write→persist
  before declaring closure) is exactly what separated "3 closed + 1 half-closed" from the "all 4
  closed" the label asserted.
- **A meta-pattern in how gaps recur across agents:** FIVE retro touches (049/050/051/053/052) on
  the SAME `tenants.quiz_config` blob, each correctly fixing the key/limb the ticket named, none
  setting a blob-level policy — so the decay recurred key-by-key. THIS is the run where the
  meta-loop did its job: rather than file a 4th per-key follow-up alone, I PROMOTED Rule U (gating
  state = typed column; eliminate superseded blob keys, don't annotate) because the recurrence count
  (3 across 049/050/051) long exceeded threshold and the prior retros had each only left a "PM note"
  instead of a standing rule. Lesson: when consecutive retros keep filing per-instance follow-ups
  for the same structural magnet (here: a shared multi-key JSONB blob), the correct move is to
  PROMOTE the policy — a follow-up fixes one key, a Rule stops the next key from accreting.
- **Concurrency note:** RETRO-053 (FOLLOW-264) was appended by a concurrent run mid-task, taking
  number 053 and consuming FOLLOW-270; this entry took the still-free RETRO-052 + FOLLOW-271.
  Re-read the file tail AFTER the Edit-failed-file-modified signal before re-appending — the
  concurrent write changed both the RETRO tail and the FOLLOW counter. Standing lesson: on any "file
  modified since read" error, re-grep the RETRO headers AND the FOLLOW next-number marker AND the
  Rule-letter sequence before writing — a concurrent retro may have already consumed the slot you
  planned to use.

## 2026-06-11 · RETRO-054 (FOLLOW-169 / PR #264 — headline anti-hallucination grounding)

- **A finding I almost missed and why:** the easy verdict was "FOLLOW-169 added a system prompt + a
  fact check + 11 tests → RETRO-028 §4a fully closed, done." I nearly logged the fact check as full
  grounding parity. The catch came from reading `_check_headline_facts` LITERALLY — its membership
  test is `token.lower() not in grounding`, a BARE SUBSTRING containment, not a tokenised/whitelist
  match. That admits a digit-coincidence false-negative (a bare "5" matching any "5" in the
  serialised JSON) and a first-word-proper-name escape (`words[1:]` skips `words[0]`). So the
  asymmetry went from "absent" to "present-but-lower-precision" → §4a LG-1 / FOLLOW-272. Lesson: for
  a "bring X to the bar of Y" ticket, READ THE DETECTOR — verify the CHECK is as strong as Y's, not
  merely PRESENT.
- **An axis/chain I had to trace twice:** the `verified_facts` provenance. I first read AC1 as "the
  headline now grounds against a verified whitelist → strictly safer." Tracing the variable back
  (`:325` ← `:291` `_generate_with_sonnet` ← `_parse_verified_facts:824`) showed the whitelist is
  the description MODEL'S SELF-REPORT — a description-side hallucination written into its own
  `<verified_facts_used>` block becomes a "verified" headline input. Pre-existing (not introduced
  here), but I had to trace it to confirm the PR doesn't WORSEN it (it doesn't — empty self-report
  falls back to raw-text grounding, the prior behavior). Lesson: "grounds against verified_facts" is
  only as strong as how verified_facts itself was produced — always trace the whitelist's origin.
- **A meta-pattern in how gaps recur across agents:** the SAME shape as the Rule-U `quiz_config`
  lineage and the inquiry-selector chain — an agent closes the limb the ticket names ("add a fact
  check") at a SHALLOWER tier than the sibling it's meant to match, leaving the residue (detector
  precision; self-reported-whitelist trust) one hop down. The ml-engineer did the RIGHT minimal
  thing (real mechanism + 11 tests = a model Rule-S close-out). The aggregate lesson: "bring X to
  the bar of Y" tickets need the retro to confirm the DETECTOR is at Y's VERIFICATION tier (Rule S
  clause), not just that the mechanism exists. This was a hop FORWARD
  (absent→present-but-imprecise), not a one-hop shuffle — step-7 discipline distinguishing "added
  the mechanism" from "the mechanism is as strong as its sibling's."

## 2026-06-11 · RETRO-055 (FOLLOW-270 / PR #265 — extract canonical QuizConfig + fix language enum skew)

- **A finding I almost missed and why:** the easy verdict was "FOLLOW-270 extracted the canonical
  QuizConfig to @estalara/shared, both control-plane copies import it, 'es' is UI-reachable, 4 new
  tests → RETRO-053 MX-1 closed, Wiring clean, done." Correct for the control-plane axis. The catch
  came from step-8 applied to the WORD "de-duplicate": a de-dup ticket's success metric is "how many
  copies of this shape REMAIN?", so I grepped the literal `'en'|'pl'|'es'` set REPO-WIDE (not just
  the two diff files) — surfacing 4 SDK source copies + the SDK's own `SUPPORTED_LANGUAGES` + a
  PRE-EXISTING canonical `LocaleSchema` in the same shared package. The schema's OWN docstring
  (quiz-config.ts:28) names the gap ("API, dashboard, AND SDK must all reference this constant")
  while the code leaves the SDK out. Lesson: for a "de-duplicate / extract canonical" ticket, the
  audit is a REPO-WIDE grep of the unified shape, not a diff review — COUNT the surviving copies AND
  check whether a canonical source ALREADY existed (it did).
- **An axis/chain I had to trace twice:** the SDK quiz-language render chain. I first dismissed the
  SDK `'en'|'pl'|'es'` as an unrelated SDK constant. Tracing it (index.ts:700
  `language: config.language` → renderQuizWidget(..., quizConfig.language):820 → QUIZ_CONTENT[lang]
  quiz-widget.ts:50 / QUIZ_LABELS[lang] quiz-trigger.ts:15) plus Master Design §E.4.7 (priority-1
  source = quizConfig.language from /api/quiz/config) confirmed the SDK enum is the SAME contract's
  RENDER end — the value the dashboard produces is rendered by the SDK against a DIFFERENT
  hand-typed copy. A true Rule-S sibling, not noise. Lesson: a "config enum" finding must trace the
  enum to its RUNTIME RENDERER before deciding it's out of scope — the consumer is a sibling of the
  producer's type.
- **A meta-pattern in how gaps recur across agents:** the quiz lineage
  (049/050/051/053/052/054/this) keeps showing the SAME shape — the agent fixes the copies the
  ticket NAMES and ships green, while the recurring escape is a sibling in ANOTHER package (the SDK
  render path) or a pre-existing canonical source (LocaleSchema) the ticket's scope never
  enumerated. KEY realization this run: the under-scoping was in the ACs, which were filed by
  RETRO-053 — and RETRO-053 only examined the control-plane axis. So a follow-up's blast radius is
  only as wide as the RETRO that filed it looked. When I file a "de-duplicate" follow-up, I must
  enumerate the full cross-package sibling set IN THE STUB SCOPE (I did this for FOLLOW-273 AC3) so
  the next agent isn't handed a too-narrow scope the way FOLLOW-270 was.
- **Rule-promotion discipline:** the cross-package-de-dup-leaves-a-sibling shape hit count 2
  (RETRO-053 control-plane + RETRO-055 cross-package), but I did NOT promote a new rule — it is
  already Rule S ("apply to ALL siblings of the symmetric set; enumerate the full set first").
  Premature codification of a near-duplicate of an existing rule is noise. I recorded a concrete
  Rule-S sub-shape amendment and set the promote-on-3rd-instance condition instead. Lesson: before
  promoting, check whether an existing rule already OWNS the shape — if so, record a confirming
  instance + an amendment-on-next-recurrence condition, don't fork a new rule.
- **Version caveat I had to disentangle:** the live `quiz-config.ts` already carries FOLLOW-271's
  `.omit({ enabled: true })` + `parseStoredQuizConfig` (PR #266 merged AFTER #265). `gh pr view`
  reported a mergeCommit oid not in local history. I analyzed ONLY `git show 5b4f1c1` (the
  FOLLOW-270 impl commit, which still carries `enabled`) and explicitly scoped the `enabled`
  stripping out to RETRO-052/FOLLOW-271. Standing lesson: when the merge commit isn't local and a
  later sibling PR touched the same NEW file, pin the analysis to the ticket's OWN commit via
  `git show <impl-sha>:<path>`, not the on-disk file — the disk may contain a successor's work that
  was already retro'd.

---

## 2026-06-11 · RETRO-056 (FOLLOW-271 / PR #266 — strip `quizConfig.enabled` blob key + backfill, the model Rule-U close-out)

- **A finding I almost missed and why.** The headline verdict was airtight: FOLLOW-271 is the
  textbook Rule-U close-out — `.omit({ enabled: true })` strips on write, `parseStoredQuizConfig()`
  strips on read, migration 0026 backfills, the typed `quiz_enabled` column is the SoT, 918 tests
  pass, journal monotonic, RETRO-052 §4a LG-1 closed end-to-end, Wiring Audit clean on the `enabled`
  axis. I nearly recorded a clean retro. The catch came from Rule U's OWN mandated clause — the rule
  I'm enforcing literally says "a retro for any change that touches such a blob MUST grep EVERY key
  of the blob for writer/reader parity, not just the one the ticket names." Executing that on the
  four REMAINING keys surfaced `sticky_widget` (zero SDK consumer) and `micro_polls_enabled` (SDK
  reads `config.micro_polls_enabled` but `buildSnippet` never emits the attribute and the SDK never
  fetches `/api/quiz/config`) — two write-only orphans the rewritten docstring now blesses as
  "valid." Standing lesson: when a ticket CLOSES one orphan under a rule, the rule itself often
  prescribes the audit that finds the NEXT orphan — run the rule's verification clause on the
  close-out PR, don't treat "the named key is gone" as lineage-closed.
- **An axis/chain I had to trace twice — the `micro_polls_enabled` consumer.** First grep showed
  `index.ts:888,965` reading `(config as Record).micro_polls_enabled` and I almost classified the
  key WIRED ("the SDK reads it"). The second trace asked the right question: where does `config.X`
  come FROM? The SDK builds `config` from `data-*` snippet attributes; `buildSnippet`
  (`DetectionPreview.tsx:132-147`) emits no `data-micro-polls-enabled`; no SDK runtime GET of
  `/api/quiz/config`. So the SDK reads a field the production install path never populates — a
  consumer-exists-but-disconnected-from-producer half-wire that looks wired at a single-grep glance.
  Lesson (recurring across the quiz lineage): "the SDK reads `config.X`" is NOT proof of wiring —
  trace `config.X` to the SNIPPET PRODUCER (does `buildSnippet` emit it?) before declaring a blob
  key end-to-end. A consumer in one package + a producer in another that doesn't carry the value is
  the cross-package magnet this whole lineage keeps tripping on.
- **A meta-pattern in how gaps recur across agents.** SEVENTH consecutive retro on
  `tenants.quiz_config` (049→056). The invariant: an agent correctly eliminates the ONE key the
  ticket names (here `enabled`, the model Rule-U execution) and ships green, while the blob still
  carries the next orphan one hop down (`trigger_after_n_listings` → `enabled` → now
  `sticky_widget`/`micro_polls_enabled`). The structural magnet is a shared multi-key JSONB blob
  whose producer (dashboard) and consumer (SDK via a snippet that doesn't carry the keys) live in
  different packages — same cross-package-sibling blind spot Rule S / RETRO-055 names from the other
  direction. NEW realization this run: a close-out PR's own DOCSTRING REWRITE is a place the next
  orphan hides — FOLLOW-271 removed the `enabled`-orphaned annotation (good) but over-corrected to
  imply all four remaining keys are live, masking two that aren't. Recorded that as a Rule-U
  application caveat in §6 (re-grep ALL sibling keys before a close-out's docstring blesses them).
- **Rule-promotion discipline (held the line).** The one new finding (§4a LG-1) is a 4th instance of
  the ALREADY-codified Rule U — I did NOT promote anything (no fork of a near-duplicate rule, no
  re-promotion of an existing one). The threshold exists to prevent premature codification; an
  existing rule already owning the shape means "record a confirming instance + an application
  caveat," not a new rule. No CONVENTIONS_PATCH.md edit this run — correct.
- **Verification hygiene that paid off.** Confirmed `de94873` is on `main` before analyzing (it was,
  this time — local history, unlike RETRO-055's off-disk successor). Independently re-verified
  journal monotonicity (entry 25 → 26 strictly increasing) rather than trusting the PR body.
  Confirmed the SDK never read `quizConfig.enabled` (empty grep) so the `enabled` removal is
  genuinely de-wired both ends.

---

## 2026-06-11 · RETRO-057 (FOLLOW-274 / PR #267, squash `ca4da90`)

- **A finding I almost missed and why.** The PR is a textbook "Rule L evidence" presentation: a
  table with a real non-test PRODUCER (`buildSnippet` `DetectionPreview.tsx:163`) + a real non-test
  CONSUMER (`config.ts:193` → `index.ts:888,965`) + 7 new green tests, plus it CORRECTLY and fully
  retires `sticky_widget`. The single-grep view ("emits it, reads it") reads as a closed wire, and I
  nearly recorded `micro_polls_enabled` CLEAN. The catch: trace the PRODUCER'S PRODUCER — WHO CALLS
  `buildSnippet` with `microPollsEnabled=true`? `<DetectionPreview` non-test grep → ONE render site
  (`DetectWizard.tsx:259`) that supplies neither flag and has zero `quiz_config` access. The
  "producer" in the PR table is the EMITTER, not the SUPPLIER of its argument — and the supplier is
  absent. The lesson RETRO-056 itself named ("buildSnippet never emits data-micro-polls-enabled")
  was closed, but the gap moved one hop UP. This is precisely the prior-follow-up-closure trap
  (algorithm step 7) — closure was declared at the one hop the prior retro named.
- **An axis/chain I had to trace twice — the DetectionPreview prop chain.** I first saw
  `DetectionPreview.tsx:219` forwarding `microPollsEnabled` into `buildSnippet` and almost called
  the prop "threaded." A prop is only WIRED if its RENDER SITE supplies a real value — forwarding a
  possibly-undefined prop within a component is not the same as the render site passing one. Going
  UP to `<DetectionPreview .../>` in `DetectWizard.tsx:259` showed the omission. Trailing-optional
  params/props are the structural enabler: each hop typechecks clean even when the value is never
  supplied.
- **A reconciliation I had to make (algorithm step 8).** RETRO-049 §3 (`RETROSPECTIVES.md:12626`)
  recorded the symmetric `quizEnabled` arm as "threaded from `DetectionPreview.tsx:197` (non-test).
  NOT dead." — STOPPING at the prop-definition site. That verdict was correct at the symbol/import
  level but INCOMPLETE at the production-producer level; `DetectWizard.tsx:259` supplies neither
  flag. I had to explicitly contradict a prior "NOT dead" verdict and file the `quizEnabled` arm
  alongside the new one (Rule S, one root cause). Meta-lesson for myself: a "NOT dead / wired"
  verdict on a SNIPPET ATTRIBUTE must trace to the SINGLE production renderer that SUPPLIES the
  value, never the prop-definition or emitter site.
- **A meta-pattern in how gaps recur across agents.** EIGHTH consecutive `tenants.quiz_config`
  retro, but the AXIS shifted: the first seven were blob-content decay (which keys live in the blob;
  now Rule-U-clean after FOLLOW-271/274); this one is snippet-DELIVERY decay (do the blob's keys
  reach the SDK). The invariant across both axes: an agent closes the exact hop the prior retro
  named and ships green while the NEXT hop stays open. The structural magnet is a cross-package
  multi-surface chain (dashboard blob → control-plane snippet producer → SDK consumer) where each
  hop is in a different file/package and typechecks in isolation. Root cause RETRO-056 §8-meta
  already flagged ("the SDK does not GET /api/quiz/config at runtime") is the SAME one surfacing
  again — there is no post-onboarding snippet re-emission surface, so post-activation config changes
  cannot propagate at all. The robust fix is architectural (SDK runtime config fetch), which I
  flagged for architect input in FOLLOW-275 rather than presuming the snippet-threading approach.
- **Rule discipline.** Both findings are confirming instances of already-codified Rule L (with a NEW
  call-site application caveat recorded in §6) and Rule S (the `quizEnabled`/`microPollsEnabled`
  pair). Nothing crossed a fresh ≥2 threshold on a NEW pattern → NO CONVENTIONS_PATCH.md edit. The
  single-hop closure trust is a retro-PROCESS discipline note, not a code rule — recorded here, not
  codified.
- **Verification hygiene that paid off.** `gh pr view` reported `mergedAt:null` / `mergeCommit:null`
  (squash-merge does not back-link) — I did NOT take that as "not merged"; confirmed via `git log` +
  `git show ca4da90`. Independently re-verified journal monotonicity (idx 27 `1781208120531` > idx
  26 `1781202418234`) rather than trusting the PR body, and grepped
  `<DetectionPreview`/`buildSnippet` non-test to confirm the SOLE production render/call sites
  rather than trusting the PR's "producer exists" table.
