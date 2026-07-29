# Retrospective-Analyst — meta-lessons (self-improvement loop)

## 2026-07-22 · RETRO-204 (PR #605, FOLLOW-613 — bypass 6 [barrel re-export] on the staff-write-atomicity guard; NO PROMOTION [Rule AE already covers], filed FOLLOW-619)

- **A finding I almost missed and why:** the task named three axes to check — depth-3 bound, renamed
  re-export, type-only re-export. All three came back CLEAN (renamed `export {x as y} from` →
  caught/FAIL; star→star chain → caught; depth-3 → caught; depth-4 → the documented bound). Had I
  stopped there I'd have written "clean ✅, only the known depth bound." The real live-relevant gap
  was NONE of the three: it was the namespace×barrel INTERSECTION
  (`import * as db from '@estalara/db'; db.upsertX(tx)`), which I only found by enumerating the full
  CROSS-PRODUCT {named, namespace, default} × {concrete, barrel} instead of testing the suggested
  axes in isolation. Lesson: when a fix closes shape N and enumerates N+1..N+3, the next gap is
  often the INTERSECTION of two ALREADY-CLOSED shapes, not a brand-new one beyond the last — test
  the matrix, not the list.
- **An axis/chain I had to trace twice:** whether the barrel or the namespace was the
  differentiator. A namespace-of-barrel SKIP could have meant "namespace imports are broken"
  (contradicting FOLLOW-612/bypass-5 "closed"). I had to build the controlled a/b —
  namespace-of-CONCRETE (caught, FAIL) vs namespace-of-BARREL (SKIP) — to prove bypass 5 is
  genuinely intact and the barrel re-export is the sole cause. Never report an intersection bug
  without the single-variable-isolated control, or you risk contradicting a prior "clean" verdict
  that was actually correct.
- **A meta-pattern in how gaps recur across agents:** this guard is now 4 hops deep (bypass 4→5→6→7)
  and each hardening pass got MORE disciplined (613 enumerated 3 future shapes, a real improvement)
  yet STILL missed one — because the enumeration reasoned "beyond the last closed shape" and the gap
  sat BETWEEN two closed shapes. The durable fix is Rule AE point 3 (resolve to the concrete module
  in the identifier-resolution step, don't special-case syntax): the namespace branch was literally
  the one call-classification path NOT upgraded to the per-name barrel resolver. When a PR upgrades
  a resolver on SOME import kinds, always check it upgraded ALL of them
  (named/default/namespace/dynamic).

## 2026-07-21 · RETRO-192 (PR #592, FOLLOW-607 — the staff-write audit-atomicity CI guard; NO PROMOTION, filed FOLLOW-608)

- **A finding I almost missed and why:** the sharpest false-negative bypass. The guard PASSES on
  mere `.transaction(` presence, and the obvious "clean ✅" read is tempting because it IS red-first
  and catches the naive regression. What made bypass (1) concrete was grepping the 605 REFERENCE
  route itself — it already contains an in-tx `.update` (:217) AND an out-of-tx agency `.update`
  (:258) in the same file and passes purely on presence. So the guard demonstrably cannot tell an
  in-tx from an out-of-tx mutation ON THE VERY FILE IT WAS BUILT AGAINST. Lesson: for a grep-based
  SECURITY guard, always test the guard's discriminating power against a file that legitimately
  contains BOTH the compliant and a non-compliant instance of the pattern — presence checks look
  clean until you find a file where presence and correctness diverge.
- **An axis/chain I had to trace twice:** the CONVENTIONS_PATCH decision. First pass: "the anti-
  pattern now has 3 sightings (190/191/192) → promote?" Second pass corrected it: 190/191/192 are
  ONE gap→fix→mechanize ARC on the SAME FOLLOW-595 write, not 3 INDEPENDENT ports — and RETRO-191 §6
  had ALREADY pre-authorized "the guard IS the codification, no prose Rule." Reading the prior
  retro's explicit promotion condition BEFORE counting saved a double-codification. The count of
  independent sightings, not the count of retros mentioning the pattern, is what the ≥2 bar
  measures.
- **A meta-pattern in how gaps recur across agents:** a mechanical guard that "closes" a gap often
  just MOVES it one hop — here from "no §3a enforcement" to "presence-not-scope enforcement." This
  is the SAME one-hop-relocation shape the step-7 prior-follow-up-closure check exists to catch (cf.
  the `inquiry_submit_selector` chain). The guard is a legitimate net-positive, but declaring
  FOLLOW-607 a full closure would have repeated exactly the failure the retro system is built to
  prevent. When a ticket ships a GUARD, always run the closure check ON THE GUARD ITSELF: what does
  it NOT catch, and does that residual land on the highest-blast inheritor (here FOLLOW-598)?

## 2026-06-14 · RETRO-075 (PR #291, FOLLOW-305 — the fix for the double-`/api` prod 404 RETRO-074 CB-1 caught; `buildEndpoint` helper; PROMOTED Rule X)

- **A finding I almost missed and why:** the FIFTH `decisionApiUrl` fetch site,
  `adapt-description.ts:227`. The PR fixed exactly the four sites RETRO-074 and the task enumerated,
  and all four checked out — so the easy verdict was "fix complete, clean ✅." The catch was running
  the completeness grep from the SYMBOL (`grep decisionApiUrl` across all SDK src) instead of the
  ticket's list, which surfaced a sixth URL site the PR never touched and RETRO-074 never named (the
  description endpoint predates the intent/quiz wave). I almost mis-flagged it as a residual
  double-`/api` bug; tracing `${decisionApiUrl}/adapt/description` against the `host/api` base (→
  single `/api`) + confirming the route exists correctly downgraded it to P3 hygiene (FOLLOW-306).
  This is the RETRO-001→RETRO-004 under-count shape on a FIX retro: "fixed every site the report
  named" ≠ "fixed every site." Lesson locked: on any fix/wiring retro, re-derive the site list from
  the symbol, never trust the ticket's enumeration — the grep finds N+1.
- **An axis/chain I had to trace twice — the deprecated bare-host `DECISION_API_URL`.** The task
  explicitly asked whether any deployment uses a bare-host `decisionApiUrl` that the fix would now
  break by NOT adding `/api`. `shared/domains.ts` DOES define
  `DECISION_API_URL = decision.estalara.com` (bare host) — which looked like a live CB-4 break.
  Second pass followed the `@deprecated` chain (ADR-0006/FOLLOW-105, retired Worker) and grepped ALL
  references: zero functional consumers, the only mention is a comment saying "NOT this one." So the
  bare-host axis is dead and the helper's `host+/api` assumption holds for every LIVE
  `decisionApiUrl`. A scary-looking constant is not a live axis until you prove a producer feeds it
  — verify the deprecation, don't assume it.
- **A meta-pattern in how gaps recur across agents.** RETRO-074's promote-on-confirmation condition
  worked exactly as designed: it deferred the Rule at count 1 (single axis, distinct root from Rule
  L) and named the precise trigger ("a SECOND fetch site OR independent confirmation of the quiz
  sibling"). This retro met it cleanly — four independent sites, not one inherited bug — so Rule X
  promoted without ambiguity. The deferred-promotion-with-explicit-trigger mechanism (also seen Rule
  S RETRO-044→045) is the right way to handle a count-1 finding that is clearly going to recur: name
  the trigger in §6 so the NEXT retro can promote mechanically. BUT a residual meta-gap: the new
  prod-URL tests hard-COPY the snippet string `'https://admin.estalara.com/api'` rather than
  importing it from `CONTROL_PLANE_URL`/`buildSnippet` — so the fixture can still drift from the
  producer silently. The deeper "derive the fixture from the real producer" remedy is still
  unadopted; if a THIRD field shows a hand-copied-producer-fixture divergence, that is its own
  promotable pattern.

## 2026-06-13 · RETRO-070 (PR #284, FOLLOW-294 — ADR-0012 Ticket A: authenticated GET /api/intent/config + shared IntentWeightsSchema)

- **A finding I almost missed and why:** the `data_source:'error'` enum drift (CB-1/§3). The auth
  axis — the ticket's entire headline — is flawless (real-SHA-256 tests, correct constant-time
  compare, correct 503/500/401/404 ladder), so the obvious verdict was "Wiring Audit clean, model
  Rule-H close-out." The catch came from applying the RETRO-058 discipline to EVERY emittable value,
  not the headline one: the route emits THREE `data_source` values (`live`/`mock`/`error`) but the
  shared `IntentConfigResponseSchema` enum lists only TWO, and the `'error'` body is an UNTYPED
  object literal on the 500 path so `tsc` is blind to the disagreement. The gap is one axis over
  from the ticket's focus — exactly where RETRO-058 found the identical shape on the sibling
  `quiz/public-config` route. Lesson reinforced: enumerate a route's emit sites BY HAND and diff
  against the response enum; a provenance value on an untyped error-literal will never be caught by
  the typechecker.
- **An axis/chain I had to trace twice — the RETRO number itself.** The prompt asserted "RETRO-061
  (immediately prior, on PR #283)" and the log's last header is RETRO-058. First instinct: take 059.
  Wrong. The K.3.6 wave (PRs #274–#283) consumed/reserved RETRO-059–069 — their FOLLOW stubs, STATUS
  §Pending-Retros markers, QUEUE "complete" notes, and a promoted Rule W all reference those
  numbers, but the retro BODIES were never appended to RETROSPECTIVES.md (a Wave-2 backfill debt).
  The genuinely next-free number is 070. The prompt's "RETRO-061 on PR #283" is ALSO internally
  inconsistent with STATUS.md (which maps 061→PR #274 and #283→the 062–066 cluster). Lesson: NEVER
  take a referenced retro number at face value — reconcile against the STATUS/QUEUE pending-ledger
  AND the source_retro tags in FOLLOW_UPS before picking, because the bookkeeping itself can be
  wrong and the prompt can be a decoy. Same trap on FOLLOW numbers: 293/294/295/296/297 are
  ADR-reserved out of sequence (294 = this ticket), so retro stubs start at 298, not 293.
- **A meta-pattern in how gaps recur across agents:** TWO learning-loop-integrity recurrences in one
  retro. (1) The `data_source`-enum-incompleteness HALF_WIRE_C is now count 2 across two SIBLING
  fail-soft routes built by the same agent family (RETRO-058 quiz, RETRO-070 intent) — the
  structural magnet is "a route author adds a K.2 provenance value for observability but forgets to
  add it to the SHARED response schema, because the schema lives in a different package and the
  error body is untyped." (2) The Wave-2 retro-body backfill debt (059–069 bodies missing) is the
  SAME gap FOLLOW-185 (RETRO-035/046) already filed a CI lint for — under merge pressure the wave
  shipped the actionable stubs+markers but skipped the durable narrative. Both confirm: the surfaces
  that escape are the ones OUTSIDE the typecheck/test/diff attention window (cross-package schema
  enums; prose retro bodies). My own discipline that worked: grep the token repo-wide, and reconcile
  every referenced number against the authoritative ledger before trusting it.

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

---

## 2026-06-12 / RETRO-058 — FOLLOW-275 (wire micro_polls_enabled + quizEnabled via SDK runtime GET, ADR-0011 path ii; two PRs #270+#271)

- **A finding I almost missed and why.** The headline `micro_polls_enabled`/`quiz_enabled` wire is
  GENUINELY closed end-to-end this time (transport-swap from snippet-attr to runtime fetch), and the
  PRs are meticulous (Rule-L producer test drives the real route handler; Rule-L SDK test drives the
  real `init()`). I nearly stamped CHECK B fully CLEAN on the strength of the headline wire. The
  catch was applying CHECK B to EVERY new wire field, not just the headline:
  `data_source: 'fallback'` is PRODUCED on the route's degraded paths (Rule K.2) but the SDK's Zod
  `safeParse` is non-strict and silently drops the extra key → a producer with NO consumer
  (HALF_WIRE_C). It hid because it degrades SAFELY (fallback values are valid) — but "nothing
  breaks" is precisely the HALF_WIRE_C signature, and it defeats the very observability the route
  author added.
- **An axis/chain I had to trace twice — the init TIME axis for `language`/`accent_color`.** First
  pass: `mergeQuizConfig` overlays `language`/`accentColor` AND quiz surfaces read
  `config.accentColor`/ `config.language` → looked fully closed. Tracing the ORDER of `init()`
  (consent banner rendered at line 276 vs the merge at line 744) showed the consent banner — the
  FIRST surface a buyer sees — reads the PRE-merge config and never gets the server locale/accent.
  The merge is real; the consumer ordering strands one surface. Lesson: "field is merged AND a
  surface reads it" is NOT closure — you must check whether the read happens BEFORE or AFTER the
  merge in the init sequence. Multi-axis analysis (step 8) includes the TIME axis, not only the
  field/variant/locale axes.
- **A meta-pattern in how gaps recur across agents.** THIRD consecutive `quiz_config` retro where
  the wire itself is closed/improved but a docstring (and now USER-FACING dashboard copy) is left
  asserting the OLD wire (RETRO-056 §4d, RETRO-057 §4d, RETRO-058 §4d — four stale "buildSnippet
  emits data-micro-polls-enabled" strings AFTER the emission was retired). Structural magnet:
  docstrings describing a cross-file wire live in files OTHER than the one the agent edits, so they
  fall outside the diff's attention window AND outside every gate (prose is not type-checked or
  tested). The logic axis of the eight-retro lineage finally closed cleanly via the transport swap,
  yet the PROSE axis decayed identically a third time. This is a genuine ≥2-occurrence (now 3)
  pattern, but I did NOT promote a rule: the three prior instances were each filed under a DIFFERENT
  parent rule (L/U doc-hygiene), so RETRO-058 is the FIRST to name "stale cross-file wire docstring
  after a transport/wire change" as a distinct pattern under its own name — count 1 under its own
  name. Promoting by re-labelling three loosely-related doc misses into one umbrella to clear the ≥2
  gate would be exactly the premature codification the threshold guards against. Logged the
  candidate; promote at the next independent occurrence (FOLLOW-276 is the close-out).
- **Discipline that paid off — verifying ADR alignment instead of flagging a false divergence.** The
  ADR-0011 Decision body §1/§3 says "SDK calls GET /api/quiz/config" / "no new backend route
  required," but the implementation built a NEW /api/quiz/public-config route. My first read flagged
  this as a divergence. Reading the ADR's OWN §Implementation-Notes (lines 204-249) showed it lays
  out path (i) vs path (ii), marks (ii) PREFERRED, and explicitly delegates the sub-decision — the
  implementation chose the ADR's preferred path. So it is ADR-ALIGNED, and the Decision-body text is
  merely stale relative to the Implementation Notes (logged P3 DG-2 on the ADR, not a divergence
  finding). Lesson: read the WHOLE ADR (Implementation Notes / Alternatives can supersede the
  Decision body) before recording a "diverges from design" finding — Rule P (check prior art fully)
  applies to reading ADRs too.
- **The retro-N → retro-N+1 scope-driving track record held.** RETRO-056 §8-meta and RETRO-057 §5d
  both named "the SDK does not GET quiz config at runtime" as the load-bearing architectural root
  cause and routed the (a)-vs-(b) choice to architect input; ADR-0011 ACCEPTED option (b)/path (ii)
  and FOLLOW-275 shipped exactly that. This is the first retro in the eight-entry `quiz_config`
  lineage to declare a TRUE end-to-end closure (producer→consumer→render verified) rather than a
  one-hop move — because I traced all three hops (route DB read via AC5 test, SDK fetch/merge,
  render via the Rule-L init() quiz-trigger test), not just the route's existence.

---

## 2026-06-13 / RETRO-072 — FOLLOW-297 (PR #286, tracer route + clickhouse-tracer unit tests; TEST-ONLY + 1 docstring fix)

- **A finding I almost missed and why.** A test-only PR with no new symbol and one docstring edit
  invites a reflexive "Wiring Audit — clean ✅ (test-only)". The real finding was not in the PR's
  changed lines at all — it was a PRE-EXISTING producer drift (`data_source:'error'` on the tracer
  `sessions/[id]` route, absent from `TracerSessionDetailResponseSchema`) that the NEW tests SURFACE
  and then CODIFY by asserting the literal value without a schema round-trip. The lesson for
  test-only PRs: run step-8 (multi-axis) on the TESTS THEMSELVES — read what each assertion pins,
  then check that pinned value against the schema whose type the test already imports. A test-only
  PR can both surface a half-wire AND lock it in. The audit question shifts from "did the PR add a
  producer/consumer" to "does every value these tests pin exist in the schema the tests validate
  against."
- **An axis/chain I had to trace twice — the AC3.7 MAX_POLLS boundary test.** First read: a clean
  regression guard for the DG-1 fix ("after 100 polls the stream closes"). Second read, asking the
  falsification question "what assertion here would FAIL if MAX_POLLS were 300?": nothing —
  `runAllTimersAsync` exhausts any finite loop and the close-signal assertion fires either way. The
  test's NAME ("MAX_POLLS is 100, not 300") over-promises what its body proves. Same twin as
  RETRO-071's AC5 "wiring" trap: a test's name/comment claiming it pins a value is not evidence;
  check what would actually break if the value changed. New count-1 lesson candidate logged
  (boundary/limit test that asserts termination, not the bound).
- **A meta-pattern in how gaps recur across agents.** The `data_source:'error'`/`'fallback'`
  enum-incompleteness now spans THREE route families authored independently across the K.3.6 wave
  (quiz/public-config, intent/config, tracer). Each agent did the RIGHT thing (fail loud with an
  honest provenance value per Rule K.2) and each made the SAME schema/test omission. It took the
  3rd, TEST-ONLY sighting — where the test had the schema's own type in scope and STILL didn't
  round-trip — to make the Rule K.2 amendment unavoidable. PROMOTED the amendment this run
  (enum-completeness + round-trip-test sub-shape). The deferred "promote on next sighting" note from
  RETRO-058/RETRO-070 paid off exactly as designed: the learning loop carried the count across three
  retros and fired on the threshold.
- **A reconciliation I had to be careful with.** FOLLOW-295/296 are ADR-0012 tickets that live ONLY
  in the ADR (not yet FOLLOW_UPS.md stubs), so "are they covered?" required reading the ADR, not the
  follow-ups file. FOLLOW-296 split cleanly into two halves — docstring (DONE by this PR's DG-1) and
  Zod-validation (still open) — so the correct verdict was PARTIALLY CLOSED + re-scope, not "still
  open" and not "closed". Resisting the binary was the right call; recorded as a re-scope NOTE, not
  a duplicate stub.

## 2026-06-13 · RETRO-073 (FOLLOW-301 / PR #289 — one-active-row invariant + GET ORDER BY)

- **A finding I almost missed and why.** I nearly recorded the GET `ORDER BY created_at DESC` as a
  clean closure of RETRO-071's LG-3, because ORD-1 passes and the docstring confidently claims
  determinism "even if the invariant is transiently breached." The catch was constructing the breach
  MYSELF rather than trusting the one ORD-1 tests: ORD-1 breaches the TENANT scope (2 tenant rows),
  where `find(tenantId !== null)` still works. The dangerous breach is the GLOBAL scope (2 global
  rows newer than the tenant row), where the cross-scope `.limit(2)` starves the tenant override and
  `find` returns undefined → tenant silently served the global config. The test picks the SAFE
  partition to breach. Lesson: when a fix is sold as "robust under breach," enumerate WHICH
  partition breaks — a test that breaches the convenient scope is not evidence the inconvenient
  scope is safe. This is the same "fix closes the convenient sibling, leaves the inconvenient one"
  one-hop-decay RETRO-057 named for wiring, now appearing in query-determinism.
- **An axis/chain I had to trace twice — the mid-swap GET concurrency question.** The task flagged
  "could a concurrent GET see ZERO active rows mid-swap → return data_source:'mock'?" First pass I
  was inclined to file it. Second pass I reasoned through Postgres READ COMMITTED: the
  deactivate-then-insert is ONE transaction, invisible to other sessions until COMMIT, so a
  concurrent single-statement SELECT sees old-or-new, never both-off. CLEAN — and I had to carefully
  SEPARATE that (the atomic POST/PUT swap, safe) from the manual two-API-CALL admin workflow (PUT
  old→false, then a separate PUT/POST new→true), which DOES have a zero window but is not the
  supported path. Two superficially-identical "zero-active window" concerns, opposite verdicts,
  hinging on one-transaction-vs-two-calls. Recorded TG-C as an explicit non-gap so a future retro
  doesn't file the phantom.
- **A lineage mis-citation I had to correct from source.** RETRO-071 §6/§8 cited
  "RETRO-027/FOLLOW-179" as instance 1 of the constraint-violation-handling pattern. Grepping the
  actual retro bodies showed RETRO-027 is the description-prompt rewrite (TICKET-DESC-PIVOT-001) —
  the conversion_labels missing-UNIQUE finding is RETRO-029/FOLLOW-179. Promotion math MUST be
  re-derived from the source retros, never inherited from a citing retro's prose. New count-1
  meta-pattern logged (retro mis-cites a prior instance's RETRO number → propagates wrong promotion
  lineage).
- **A meta-pattern in how gaps recur across agents.** The recurring shape across RETRO-071→073: a
  fix closes the HEADLINE gap impeccably (atomic swap, 23505→409, real POST→GET round-trip — all
  genuinely done and verified end-to-end, not just claimed) while leaving a NARROWER sibling of the
  SAME gap one scope/axis over. The worker fixed exactly the literal instruction ("add ORDER BY
  desc(createdAt)") and the instruction under-specified the partition granularity + tiebreak
  uniqueness. Lesson for the retro→follow-up handoff: when a follow-up names a determinism fix,
  specify the PARTITION granularity (per-scope LIMIT 1 / DISTINCT ON) and the tiebreak uniqueness
  (unique secondary sort key) IN the AC, or the worker closes the literal gap and leaves the
  sibling. I wrote FOLLOW-304's ACs that way (AC1 names the cross-scope starvation explicitly; AC2
  names the unique secondary key) to avoid re-spawning the same decay.
- **A promotion I deliberately did NOT make.** The constraint-violation-handling pattern reached its
  natural promotion moment — but this PR REMEDIATED the RETRO-071 instance rather than RECURRING it.
  Promoting a Rule off a FIX inverts the threshold's purpose. Held at count-2-as-symptom; sharpened
  the carry-forward to "promote on the next NEW write route that ships an UNHANDLED 23505/23503 into
  a generic 500." Resisting the promotion was the right call.

## 2026-06-13 / RETRO-074 — FOLLOW-268-sdk (PR #290) — the FINAL K.3.6 D-1 leg

- **A finding I almost missed and why.** The whole wire looked clean: the GET route exists, the
  Bearer transport matches, and the integration test literally asserts `/api/intent/config` was
  called. I nearly stamped "Wiring Audit clean." The catch came from the task's steer to trace the
  `decisionApiUrl` VALUE, not its presence — `buildSnippet` emits `${CONTROL_PLANE_URL}/api` (=
  host + `/api`), `readConfig` passes it verbatim, and `fetchIntentWeights` then PREPENDS another
  `/api` → `…/api/api/intent/config` → 404 in production. Invisible if you only check "is the arg
  set" (yes) or "does the test hit the right path" (yes — against a bare-host FIXTURE). The fixture
  (`https://admin.estalara.com`) is the bare host; production emits host+`/api`. The test masked the
  bug. **Lesson: when verifying an SDK fetch consumer, derive the producer's EXACT output string
  (the real `buildSnippet`) and run the consumer's URL construction against THAT, never against the
  test fixture — the fixture is the consumer author's assumption, not the producer's reality.**
- **An axis/chain I had to trace twice.** First pass found the double-`/api` and I almost filed it
  as a single-ticket find. Second pass: "but `fetchQuizConfig` does the identical thing and SHIPPED
  in FOLLOW-275 — is it really broken too, or is there a strip/rewrite I missed?" Grepping for any
  trailing-`/api` strip (none), Next rewrite (none), and the `adapt.ts` convention (appends `/adapt`
  WITHOUT `/api` — the ONE consumer matching the snippet) confirmed the split is real and
  quiz-config is a co-victim. The second trace turned a one-ticket find into a broader production
  gap (quiz config ALSO doesn't reach the SDK in prod) and a structural §5d finding (no single
  base-URL convention).
- **A meta-pattern in how gaps recur across agents.** The install-snippet HALF_WIRE family
  (RETRO-056/057/275) recurs HERE on a NEW axis: those were a MISSING `data-*` attribute; this is a
  MIS-FORMED base URL that IS present. Both share one root: **the test fabricates the producer's
  output instead of deriving it from the real producer.** The agents keep writing correct logic
  against fixtures that lie. The structural remedy (a shared `buildEndpoint` helper / a shared
  producer→consumer fixture from the actual `buildSnippet`) is the same one RETRO-275 §8 hinted —
  surfaced again for the architect.
- **A promotion I deliberately did NOT make.** The base-URL-form mismatch is count-1 on its own
  axis; the prior install-snippet instances are missing-attribute (a different root remedy under
  Rule L), so I held the new pattern at count-1 and folded the quiz-config sibling into FOLLOW-305
  under the already-codified Rule S rather than minting a rule. Sharpened the carry-forward: promote
  a "construct via shared `buildEndpoint` + assert against the PRODUCTION snippet value" rule on the
  SECOND independent base-URL-form mismatch.
- **The end-to-end verdict I had to state plainly.** All five D-1 legs are individually correct and
  merged, yet the prod wire is severed at the SDK URL-form seam → D-1 is code-complete but NOT
  production-live. The temptation was to call D-1 "closed" because every PR merged green; the
  discipline was to trace the prod URL and say "no — it 404s in prod." Step 7 (closure END-TO-END,
  not one hop) is exactly what caught it: the producer→consumer→apply chain breaks at the very first
  production hop.

### 2026-06-14 · RETRO-076 (FOLLOW-266 Phase 2 + FOLLOW-302 / PR #293 — K.3.6 D-1 global-default weight seed)

- **A finding I almost missed and why.** I nearly recorded the seed wire `clean ✅ — producer (0030)
  - consumer (GET globalRow) + SDK apply all
    present`and stopped: the CODE chain genuinely closes end-to-end and the idempotency/tenant-priority/empty-weights checks all came back clean. The catch was the task's check #1 ("auto-apply on deploy, or operator-run?"), which pushed me from "the seed SQL is correct" to "does the seed SQL ever RUN in prod?" Grep of`.github/workflows/`for`db:migrate`= ZERO;`post-migrate-seed.yml` seeds archetype_embeddings ONLY; the only auto-DDL is ClickHouse (`ci.yml`). So a MERGED Postgres seed is NOT-LIVE until an operator runs `db:migrate`.
    Lesson sharpened: for a DATA-signal producer, the real producer is the APPLIED row, not the
    merged SQL — a seed wire closes at "applied in the target env," never at "INSERT is correct."
- **An axis/chain I had to trace twice — idempotency-vs-overwrite.** First pass "WHERE NOT EXISTS →
  re-run-safe, done." Second pass (task's "operator seeds a DIFFERENT global later") forced me to
  split THREE scenarios the one guard handles differently: 0030 re-run (no-op), later operator
  INSERT (guard SKIPS 0030 → never overwrites the tuned row, bootstrap-only), concurrent
  double-apply (both pass the guard, the 0029 partial-unique index `23505` saves one). The guard
  (best-effort skip) and the index (hard invariant) do DIFFERENT jobs and only compose correctly
  when traced across all three axes — "WHERE NOT EXISTS" alone reads as mere dedup.
- **A meta-pattern in how gaps recur across agents.** The K.3.6 D-1 closure wave's end-to-end "does
  it ACT in prod" verdict slips ONE infra hop downstream each retro: RETRO-074 = SDK URL severed the
  wire → RETRO-075 = fixed URL but "needs a seed" → RETRO-076 = ships the seed but "needs the seed
  APPLIED, and apply isn't automatic." Same one-hop-decay shape RETRO-057 named, now walking from
  code into deploy/infra (code → URL → data-row → data-row-APPLY). Step 7 catches it every time only
  if "closure" is traced to the LAST REAL-ENVIRONMENT hop, never the last CODE hop. Handoff rule for
  the next retro: a "data-wire closed" claim must name the ENVIRONMENT the data lands in, not just
  the code that would land it — and a new "no-auto-Postgres-apply" deploy gap is now watched at
  count 1 (promote on a 2nd merged-but-unapplied Postgres migration).

### 2026-06-14 · RETRO-077 (FOLLOW-269 / PR #298 — K.3.6 tracer admin UI, 4 consumer pages)

- **A finding I almost missed and why.** The Weight Editor page is internally clean,
  Rule-K.2-conscious, and its 23 tests are green — I nearly logged "consumer contract conformance
  ✅" off the task's framing (which centered the `data_source` cast). The catch came from grepping
  the ACTUAL route exports instead of trusting the page docstring: `admin/intent/config/route.ts`
  exports POST only, so the page's `GET /api/admin/intent/config` is a 405, and the GET that DOES
  exist (`/api/intent/config`) drops the `id` the page needs to ever PUT. Both bugs were invisible
  to CI because the test mocks `global.fetch` with a fabricated 200-GET carrying a fabricated `id`.
  Lesson: for a CONSUMER ticket, the first move is `grep "export async function" <each route>` +
  diff the real response body against what the page reads — never audit the page against its own
  docstring or its own mocked fixture.
- **An axis/chain I had to trace twice — the SSE auth seam.** First pass: "EventSource opened +
  closed on unmount, onerror present → SSE handling clean ✅." Second pass (task item 2 forced "does
  the stream actually authenticate?"): the page passes the token as `?token=` (EventSource can't set
  headers) but `verifyTracerAdminAuth` reads the Authorization header ONLY — so every stream 401s.
  The SSE plumbing (lifecycle/heartbeat/data/closed/error frames) is genuinely correct; the AUTH leg
  one level down is severed. "SSE handled correctly" has two layers — frame handling AND the auth
  the connection rides on — and only the first was clean.
- **A meta-pattern in how gaps recur across agents.** Same one-hop-decay shape the K.3.6 data-plane
  wave showed (RETRO-074→076), now on the admin/UI plane: every page is correct against the contract
  the worker IMAGINED, and the tests endorse that imagined contract, so the wire severs precisely at
  the page↔route seam that no test crosses. The fixture-lies family is now count-3 (RETRO-072
  schema-round-trip, RETRO-074/075 bare-host base, RETRO-077 fabricated GET+id) but each instance is
  a DIFFERENT seam (schema enum / base-URL form / endpoint-method+field), which is why I held off
  promoting a single rule — the common remedy ("the test must cross the real seam, not a mock of
  it") is real but spans Rule L's producer axis AND a new consumer axis. Carry-forward: on the NEXT
  independent "consumer test mocks a fabricated server response" sighting, promote a consumer-side
  companion to Rule L ("a consumer test MUST drive the real handler or a route-derived fixture,
  never a hand-authored response shape") — count is at 1 on that specific consumer-UI axis even
  though the family is at 3.

---

## 2026-06-14 · RETRO-078 — FOLLOW-315 (qualify `event_at` in tracer ClickHouse queries; Code 386)

- **A finding I almost missed and why — the regression test re-creates the blind spot it "closes."**
  First instinct on a +74-line test addition with 4 named regression cases (CH-315a–d) + a negative
  regex guard was "coverage gap = N/A, well-tested ✅." Wrong frame. The tests assert the SQL
  _string on the wire_, but the original bug (Code 386) is raised only by a real ClickHouse engine
  at query-analysis time — a mock-`fetch` test CANNOT reach it. So the very tests added to fix the
  bug could not have caught the bug, and the suite remains blind to its entire defect class. The
  tell: the PR body itself said "no live ClickHouse required" and "found via local end-to-end Stack
  B verification" — i.e. CI did not find it and structurally can't. The lesson: when a fix's own
  regression test runs at the SAME mock boundary that let the bug ship, that is a coverage finding,
  not a coverage win. "It added tests" ≠ "it added tests that can catch this bug shape."
- **An axis/chain I had to trace twice — does the CI guard already exist?** First pass: "no live-CH
  job, so the gap is 'add one' — easy." Second pass (grep `clickhouse` in `.github/workflows/`): a
  `clickhouse-smoke` job ALREADY boots a real `clickhouse-server` container and sets a CH URL — but
  only to run the migrations smoke script, and the vitest integration tests self-skip because
  `CLICKHOUSE_URL` is never exported to them (`test.skipIf` at 4 sites). The gap is not "no
  container" but "the existing container is never pointed at the query builders, and the integration
  tests self-skip SILENTLY in CI." That reshaped FOLLOW-316 from "stand up CH in CI" (big) to "wire
  CLICKHOUSE_URL into the job that already has CH + stop the silent self-skip" (cheap). Always grep
  for the existing job before scoping a new one.
- **An axis I had to trace twice — is this only a tracer bug?** The diff touched one file, so the
  lazy verdict is "scoped, no cascade." Forcing the sibling-audit grep (`f(col) AS col`) surfaced a
  confirmed second instance in `clickhouse-dsr.ts:271,275` — same alias-shadow mechanism, but it
  does NOT throw (no date comparison) and instead silently sorts a DateTime lexicographically under
  `ORDER BY` + `LIMIT 1` → can return the wrong mutation row. The SAME root pattern manifests as a
  THROW in one place and a SILENT wrong-answer in another; the throw is what got it noticed, the
  silent one would have rotted indefinitely. One-file diffs still warrant the pattern grep.
- **A meta-pattern in how gaps recur across agents.** Same shape as the K.3.6 wave (RETRO-076/077):
  prod-acting data-plane code whose correctness depends on a REAL backend (ClickHouse/Postgres) that
  CI never exercises — 076 = no auto-migrate, 077 = page↔route seam no test crosses, 078 = no
  live-CH query-analysis test. The recurring remedy is identical: close the real-backend
  verification hop in automation; mock boundaries (HTTP, fetch, schema) keep proving the agent's
  IMAGINED contract, not the engine's actual one. The fixture-lies family I tracked in RETRO-077 now
  has a sibling family — "mock-test can't catch a real-BACKEND rejection" — distinct because the
  rejecting authority is a SQL engine, not an HTTP route or a Zod schema. Held both below the
  promotion threshold (alias-shadow = count-1; live-backend-rejection axis = count-1) per
  RETRO-077's same discipline. Carry-forward: the NEXT live-backend-rejection-vs-mock-test sighting
  trips a rule ("a fix for a bug a real backend rejected MUST ship with a spec driving a real
  instance of that backend, or a non-self-skipping CI integration job"); and the NEXT
  `f(col) AS col` alias-shadow sighting trips a ClickHouse-query rule distinct from Rule W.

## 2026-06-14 · RETRO-079 (PR #305, FOLLOW-316 — live-ClickHouse `tracer-query-smoke` CI guard; the remediation RETRO-078 §4c TG-2 prescribed; NO Rule promoted)

- **A finding I almost missed and why:** The AC2 negative-control assertion
  `/Code: 386|NO_COMMON_TYPE|HTTP 500/` LOOKS rigorous — it names the exact bug class. I nearly
  rubber-stamped it as "guard proven." The `|HTTP 500` arm is the trap: because `chTracerQuery`
  stringifies EVERY non-2xx as `HTTP 500: <body>`, that arm is a catch-all that greens on any 500.
  Lesson for next time: when a test claims to prove a SPECIFIC failure class, read the matcher's
  WEAKEST alternative, not its strongest — an OR-regex is only as precise as its loosest arm. This
  is the matcher-precision cousin of the RETRO-072 tautological-assertion family.
- **An axis/chain I had to trace twice:** The "is this a NEW sighting that trips Rule promotion?"
  question. First pass I almost counted FOLLOW-316 as the 2nd sighting of RETRO-078's Pattern B
  (live-backend-vs-mock) → would have falsely hit threshold 2 → premature rule. Second pass: a
  REMEDIATION of a named gap is NOT a second independent OCCURRENCE of that gap. The cure and the
  disease are the same axis, count-1. Codify this distinction: a follow-up that BUILDS the thing a
  prior retro asked for never advances that pattern's promotion count — only an independent fresh
  bug does.
- **An axis I had to verify, not assume:** the negative-control SQL ACTUALLY reproduces the
  FOLLOW-315 broken shape. I diffed `brokenSql` (`toString(event_at) AS event_at` + bare
  `event_at >= parseDateTimeBestEffort(...)`) against the 4 FIXED builders (all
  `intent_events.event_at` qualified) and the migration column set (0014+0015) before trusting the
  guard. A guard that submits a query is only as good as whether that query is the real bug shape —
  worth the two greps.
- **Meta-pattern in how gaps recur across agents:** the K.3.6 arc keeps surfacing the SAME meta-gap
  from different doors — "prod-acting code whose correctness depends on a real backend CI never
  exercises" (RETRO-076 no-auto-migrate, RETRO-078 mock-only CH test, now RETRO-079 closing the CH
  half). The remediation always has a residual deferred to the next ticket (here: the DSR spec stays
  self-skipping, inherited by FOLLOW-317). Watch for the "we fixed the guard but the sibling path is
  still uncovered" shape — closure of one hop routinely leaves the adjacent hop open, exactly the
  half-wire-moves-downstream pattern the agent spec warns about.

## 2026-06-15 · RETRO-080 (PR #299, FOLLOW-309/310/311/312 — the four RETRO-077 wiring-bug fixes; ALL closed end-to-end, ONE residual one-hop; fixture-lies family held at count-3, NO promotion)

- **A finding I almost missed and why:** RETRO-077 LG-3 (datetime-local→ISO ambiguity) was "folded
  into FOLLOW-312," and the PR title + body confidently claimed FOLLOW-312 done. The easy verdict
  was "FOLLOW-312 closed." The catch was the step-7 closure discipline: I read FOLLOW-312's FULL
  RETRO-077 scope (LG-2 selector AND LG-3 datetime) and grepped the actual sink —
  `handleExportCsv` + the JSONL builder + the history table-load all still pass the raw
  `filterFrom`/`filterTo` (datetime-local) to a route validating only `z.string().min(1)`. The PR
  fixed the LG-2 selector and STOPPED. A "ticket done" claim covered only the most-visible half of a
  two-part finding. Lesson locked: when a prior RETRO folds N findings into ONE follow-up, the
  closure check must enumerate ALL N and grep each — "the PR fixed the headline bug" ≠ "the PR
  closed the follow-up."

- **An axis/chain I had to trace twice:** the SSE cookie-auth closure. The page just deletes
  `?token=` — that alone is necessary-not-sufficient. I had to trace the POSITIVE leg: EventSource
  (same-origin) → browser sends `sb-access-token` cookie → `verifyTracerAdminAuth` Path 2 →
  `getAuthClaims` → `packages/auth/src/middleware.ts:46-49` actually parses that cookie. THEN a
  second trace I almost skipped: does the control-plane `middleware.ts` matcher (matches
  `/api/admin/*`) REDIRECT the SSE to an HTML login page before the route's own auth runs? It does
  not — the redirect branch keys on `pathname.startsWith('/admin')`, and `/api/admin/...` has a
  different prefix, so it falls through to `NextResponse.next()`. Removing a broken auth param is
  only half a fix; the working path has to be proven reachable AND un-intercepted.

- **A meta-pattern in how gaps recur across agents:** the deferral-discipline distinction between a
  REMEDIATION and an independent SIGHTING is now load-bearing for rule-promotion accounting. PR #299
  is the FIX of the RETRO-077 fixture-lies sighting (schema-derived fixtures + real-handler tests),
  so it does NOT increment the count — exactly as RETRO-068/078/079 held their remediations
  non-incrementing. Without this rule, a "fixed it correctly" PR would falsely tip a family over the
  threshold and mint a premature rule. The corollary I'm internalizing: a fix can leave the SAME
  pattern's last narrow corner open (here, the un-grounded PUT/POST save-response fixture, because
  no shared write-response schema exists) — file it as a concrete coverage gap, but it's a residual
  of the SAME sighting, so it also does not advance the count.

---

## 2026-06-18 · RETRO-089 (FOLLOW-331 / PR #317 — intent-weights drift guard)

- **A finding I almost missed and why:** I almost recorded a clean §4d (DG-2: RETRO-084 DG-1
  genuinely fixed — the false `intent-weights.ts:155` docstring is now accurate and the cited drift
  test now exists). It IS fixed. But the PR also TOUCHED the sibling header docstring in
  `packages/shared/src/schemas/intent-weights.test.ts:28-30`, which now points the
  ARCHETYPE_KEYS↔ARCHETYPE_NAMES parity guard at the NEW drift file — and that file never imports
  ARCHETYPE_NAMES. The real parity guard is in a third file (`intent-weights.test.ts:784`,
  FOLLOW-305). I only caught it because step-7 forced me to read the cited file's ACTUAL imports
  (`grep ARCHETYPE_NAMES intent-weights-drift.test.ts` → NONE) instead of trusting the docstring's
  prose. Lesson reinforced: when a PR "fixes a false docstring," verify the REPLACEMENT pointer too
  — a fix can relocate the same anti-pattern one file over.
- **An axis/chain I had to trace twice:** the closure verification. First pass I confirmed the new
  drift test imports BOTH copies and asserts real per-key equality (true closure of RETRO-084 LG-1,
  not a one-hop move). Second pass I had to verify the WIRE was actually live in CI — that the new
  `__tests__/intent-weights-drift.test.ts` is matched by
  `vitest.config.ts include: src/**/*.test.ts` and not in the exclude list, AND that
  `@estalara/shared` resolves from the SDK package (package.json workspace dep + barrel chain). A
  drift test that isn't picked up by the runner is a dead guard — same shape as RETRO-084's original
  gap, just relocated to config. Both passed.
- **A meta-pattern in how gaps recur across agents:** the over-claimed-verification pattern
  (P-OVERCLAIMED-VERIFICATION, now Rule Y) is the documentation-pointer cousin of the fixture-lies /
  mock-can't-catch-real families. It keeps recurring because the FIX for one instance is itself a
  docstring edit, and docstring edits are not themselves guarded by anything — so the fix introduces
  a fresh untested claim. This is the second time (RETRO-084 → RETRO-089) a remediation PR planted a
  new instance of the very pattern it closed. Rule Y's third clause (a retro for any "asserted in
  CI" docstring touch MUST open the cited file) is the loop-closer. Promotion accounting note: this
  was a GENUINELY independent sighting (distinct file, introduced by the fix, not the fix itself),
  so unlike RETRO-080's non-incrementing remediation, it correctly tipped the count 1→2. The
  discriminator I applied: did the PR fix-in-place (non-incrementing) or fix-here-and-break-there
  (new sighting)? Here it was the latter.

---

## 2026-06-23 · RETRO-102 → RETRO-106 (FOLLOW-373/372/374/375/376 batch)

- **A finding I almost missed and why (RETRO-103 HW-1):** PR #339 LOOKS like a clean, well-tested
  server gate — 8 tests, neutral-directive + no-variant-log assertions, fail-before/pass-after
  framing. I almost recorded it as wired. The catch came from running the wiring grep from the
  SYMBOL, not the ticket: `grep profiling_opt_out` for a NON-TEST producer returned ZERO. The SDK
  reads its own opt-out boolean and CLIENT-short-circuits `refreshDirectives()` — so the server gate
  is reached by no real traffic at all. Every #339 test INJECTS the query param into the URL by hand
  (the Rule L / RETRO-009/010/011 self-injecting-consumer shape). Lesson restated: a green test that
  constructs the consumer's OWN input is never evidence the producer emits it. Always grep the
  producer side of any new consumer.
- **The 410-dead-input trap (RETRO-103 HW-2):** `consentGate` got a shiny new `profilingOptOut`
  input + a new reason union member — but its ONLY call site is the decision-api `/api/adapt` route,
  which is `410 Gone` (the route file's OWN header says "consent-gate … is now unreachable from
  production"). I had to read that 410 header to realize the addition is cosmetic. New reflex: when
  a PR adds an input/branch to a shared function, grep its call sites AND check whether any of them
  is a retired/410/deprecated path before crediting the wire.
- **An axis I had to trace twice (RETRO-105 headline restore):** the "restore original headline on
  non-fitting listing" code reads clean until you ask: captured WHEN, applied to WHICH slots? It
  captures ONCE (first listing) and restores to ALL headline slots. The comment asserts "placeholder
  identical across listings" — true for a generic tenant placeholder, FALSE for real per-listing
  titles. I had to re-read the capture site (`:927`, once, global) against the restore site
  (`:1047`, every listing change) to see the stale-title bug. Capture-once-apply-many is a smell I
  should flag on sight.
- **Same-wave entanglement:** FOLLOW-372 (#337/#339), FOLLOW-374 (#338), FOLLOW-375 (#340) all
  merged in ~36h and all three touch `index.ts` init / `refreshDirectives` / `consent_records`. The
  multi-axis discipline had to include "does this PR's hot-path edit collide with the sibling PR's
  hot-path edit?" — they don't conflict here, but the opt-out skip and the SoT restore now both live
  in the same async init and both are load-bearing. Cross-referencing same-wave PRs in §5a is now
  routine.
- **A meta-pattern in how gaps recur across agents:** the compliance/consent work
  (RETRO-102/103/104) keeps producing the SAME shape — a disclosure/contract is DOCUMENTED and the
  schema vocabulary is added, but the PRODUCER (consent_records INSERT, the SDK opt-out param) lags
  in a separate PR, and the CONSUMER set (DSR verbs that must erase the new consent_type) is never
  enumerated in the same wave. It's Rule H deferral + Rule S sibling-completeness + Rule L
  producer-absence, all on the consent surface, all at once. The umbrella PR DID file FOLLOW-374
  correctly (good deferral discipline) but left the DSR-sibling axis (FOLLOW-378) and the SDK→server
  opt-out producer (FOLLOW-376) implicit. The retro's job here was to make the implicit explicit
  BEFORE the producer goes live app-side and a withdrawn user's platform-consent row turns out to be
  un-erasable.

---

## 2026-06-23 · RETRO-107 (FOLLOW-383 / PR #342 — the remediation PR for RETRO-103)

- **A finding I almost missed and why (the GET-vs-POST framing slip):** RETRO-103 HW-1 named the
  control-plane **GET** `/api/adapt` gate as the dead consumer, and FOLLOW-383's stub repeats
  "GET-URL builder." I nearly recorded the closure against the GET gate. The catch: I grepped
  `method:` in `fetchDirectives` and saw `method: 'POST'` (`adapt.ts:746`) — the SDK never issues a
  GET to `/adapt`. So the GET gate RETRO-103 flagged was never on the real path AT ALL; the real
  wire is POST. #342 correctly gated the POST handler (`route.ts:915`) AND added the producer, so
  the closure IS real — but the prior retro's framing was off by one HTTP method. Lesson: when
  verifying a closure, re-derive the actual transport (method/path) from the producer code, never
  trust the prior retro's or the stub's verbal description of WHICH handler is the consumer. The
  closure can be genuine even when the prior finding's framing was wrong — say so explicitly and
  reconcile (I logged it in §7 + DG-1).
- **The "resolved-by-documentation" closure I had to think twice about (HW-2):** FOLLOW-383's AC for
  the 410-dead `consentGate.profilingOptOut` was "remove OR make canonical." The PR did NEITHER in
  code — it added a JSDoc block calling the input "reserved, do-not-remove-without-FOLLOW-107." My
  first instinct was "still dead → still a finding." On reflection: an EXPLICITLY-reserved interface
  with a sign-off gate is a deferred-by-design contract, not an accidental cosmetic add — which is
  exactly what RETRO-103 HW-2 asked for ("decide"). So I classified it RESOLVED-BY-DOCUMENTATION,
  not OPEN. Discriminator to keep: a dead symbol that is DOCUMENTED-as-reserved-with-a-revival-gate
  is not the same finding as a dead symbol added silently. Grep still confirms zero live consumers,
  so I carried the dormant-default-false caveat to §5b rather than dropping it.
- **An axis/chain I traced twice (the sibling set + the temporal recurrence):** the three
  pre-existing leaks (quiz/favorites/micro-poll) were handed to me pre-identified (FOLLOW-385), so
  the risk was RESTATING instead of VERIFYING. I re-grepped each guard site (`:1101`, `:1392`,
  `:1228`) and the `/api/quiz/completion` route (grep exit 1 = no gate) to corroborate independently
  before crediting them — and confirmed FOLLOW-385's AC already enumerates the full set incl. the
  server gate, so NO new stub. The second trace was the rule-promotion axis: "guard added to one
  path, siblings left ungated" LOOKS like a fresh pattern worth promoting, but it IS Rule S (already
  codified RETRO-044/045, reinforced 6×). Promoting it would have been duplicate codification. The
  brief even hinted "candidate rule IF ≥2 prior" — the honest answer was "it's already a rule,
  threshold not applicable." Resisting the urge to mint a new rule for an old pattern is itself the
  discipline.
- **A meta-pattern in how gaps recur across agents:** the §H.9 opt-out surface has now produced the
  SAME incomplete-sibling-set gap across TWO consecutive remediation PRs (FOLLOW-372 fixed one event
  path's ordering but introduced LG-2; FOLLOW-383 fixed the producer + reversed the drop; BOTH waves
  left quiz/favorites/micro-poll ungated). Rule S manifests TEMPORALLY here, not just within one PR.
  The process fix is at the PLANNING layer: a remediation PR for an incomplete-sibling-set finding
  should enumerate the FULL sibling set in its AC (FOLLOW-385 finally does). The retro can't make a
  PR fix more than its scope, but it CAN make sure the NEXT ticket's AC carries the whole set —
  which is what closed the chain here. Watch for this on any "fix one path" PR: ask "what are the
  siblings, and does a filed follow-up cover ALL of them or just the next one downstream?"

---

## 2026-06-24 · RETRO-108 (FOLLOW-384 / PR #347)

- **A finding I almost missed and why:** FOLLOW-384's two unit tests both PASS and look like clean
  AC coverage — they call `write_shadow_intent(payload, profiling_opt_out=True/False)` DIRECTLY with
  an explicit value. That structure is seductive: green tests + a real guard read like a closed
  wire. The leak only surfaced when I refused to trust the consumer-direct test and asked "who in
  PRODUCTION sets this flag True?" — grepping `fn.spawn(` in stream-consumer revealed
  `_spawn_chat_nlp` omits it entirely, and the `chat.message.sent` schema has no opt-out field. A
  consumer-direct unit test can NEVER reveal a missing producer — that is its blind spot, and mine
  almost was too. Lesson: for any SUPPRESSION flag that defaults to the leaky value (False = write),
  trace the PRODUCER chain to a real production call site, never stop at the guard + its unit test.
- **An axis/chain I had to trace twice:** the real-time vs batch axes. First pass I nearly filed the
  batch `session.get(..., False)` as the main leak — but `read_recent_chat_sessions` is a stub
  returning [], so the batch default is unreached TODAY (latent, P2). The LIVE leak is the real-time
  axis (`_spawn_chat_nlp` → `process_chat_message`), which the PR's own tests bypass. Had to
  separate "live now" (LG-1/FOLLOW-387) from "latent on FOLLOW-101 landing" (LG-2/FOLLOW-388). Also
  traced the request-path confusion twice: the FOLLOW-384 stub assumed "the SDK now sends
  profiling_opt_out=1 in the adapt URL" closes it — but the ADAPT-URL path and the CHAT-event path
  are different requests; the Modal chat spawn never sees the adapt query param. RETRO-107 §5a
  inherited that same conflation.
- **A meta-pattern in how gaps recur across agents:** the "consumer guard ships, production producer
  never sets the flag, consumer-direct test can't see it" shape is the production-code mirror of
  Rule L (self-injecting test) and the inverse of Rule H (scaffold-without-consumer). It has now
  appeared on the SAME §H.9 epic twice (FOLLOW-372 consumer-only gate → fixed by 383's producer;
  FOLLOW-384 consumer-only guard → producer still missing). I held it at count 2 rather than
  promoting, because both are one epic recurring temporally — promoting on single-epic recurrence is
  the noise RETRO-104 warned about. The DEEPER meta-pattern: a remediation ticket split off by AC
  ("AC-4 → FOLLOW-384") inherits an UNDER-SCOPED AC — the split optimizes for "the smallest
  mergeable unit" and the end-to-end behavior falls between the splits. Watch every AC-split
  follow-up: does the split AC encode the full end-to-end behavior the parent finding demanded, or
  just one hop of it?

---

- **2026-06-24 / RETRO-109 (FOLLOW-385, PR #348)**
  - **A finding I almost missed and why:** A concurrent first pass of RETRO-109 had ALREADY been
    written (sections 1–8) and recorded §3 CHECK B as "No half-wire found", §4c as a P3
    inspection-only note, and §4d as N/A. The trap was to accept the existing entry as done. Running
    CHECK B properly anyway — by tracing the `/api/quiz/completion` PRODUCER
    (`postQuizCompletionPing` in adapt.ts) rather than the consumer route — surfaced HW-1: the
    server gate has NO producer (the SDK never appends `profiling_opt_out=1` to the quiz-completion
    URL; only to `/adapt`), and the call site is unreachable anyway because Guard 1 short-circuits
    earlier. The first pass diffed only the route and saw a "complete" gate. LESSON: a half-wire
    CHECK B is only valid if you grep the OTHER side of the wire in the OTHER package — reading the
    changed file alone (the consumer) structurally cannot reveal a missing producer. This is the
    same blind spot RETRO-108 §3 hit on the Python side; it recurred on the TS side and a peer pass
    missed it.
  - **An axis/chain I had to trace twice:** The micro-poll vs favorites ingest asymmetry. First read
    it as a leak (micro-poll suppresses its `quiz.event` ingest push while favorites preserves
    `listing.bookmarked`). Re-traced against the §H.8 protected set (memory:
    `chat`/`snapshot`/`live.signup` ONLY) and the quiz-completion path (also suppressed via Guard 1)
    — concluded it's IN SCOPE and consistent, NOT a leak. But the in-code comment was copy-pasted
    and FALSE on that path. The axis had to be walked twice to separate "wrong behavior" from "right
    behavior, wrong comment." Multi-axis discipline (step 8) is what flipped the verdict.
  - **The test trap, again:** All 9 SDK tests were `modeled*` re-implementations of the guards
    (never imported `init`), so green CI proves the PATTERN, not the real guards. The first pass
    said "no SDK unit test" and rated it P3; the truth is worse — there ARE tests, and they actively
    create false confidence (Rule L production-test shape). LESSON: when a retro says "verified by
    inspection, low severity," check whether a test EXISTS that merely looks like coverage. A
    self-injecting test is worse than no test because it turns the wire green.
  - **Meta-pattern across agents:** The consumer-guard-without-producer + self-injecting-test shape
    has now appeared THREE consecutive times on the §H.9 epic (FOLLOW-372 / 384 / 385), each time on
    a different surface (adapt route / redis_writer / quiz-completion route). Independent-context
    count is still 1 (one epic) so I correctly held promotion — but the recurrence is now strong
    enough that a §H.9-SCOPED checklist item would have caught all three at planning time: "every
    opt-out CONSUMER gate must name its production PRODUCER and ship a test that does NOT inject the
    flag itself." When an epic produces the same wiring shape 3x, the fix is a per-epic planning
    gate, not a global Rule.
  - **Process note:** When a peer pass already exists, do NOT overwrite — append a clearly-marked
    ADDENDUM that corrects the specific sections, preserves the correct verdicts, and reconciles.
    Keeps the learning loop honest about who found what.

---

### 2026-06-24 · RETRO-110 (FOLLOW-387 / PR #349)

- **A finding I almost missed and why:** the `profiling_opt_out` value appears at BOTH
  `events.py:107` (the `fn.spawn` kwarg) AND `:113` (the structured-log field). On a fast diff read
  this looks like a possible double-spawn/duplicate-arg bug. It is two legitimate distinct uses —
  caught only by reading the surrounding lines, not the grep. Lesson: when a symbol appears 2x
  within ~6 lines of a Python diff, read the enclosing statements before flagging — log-field vs
  call-arg is a common false-positive shape.
- **An axis/chain I had to trace twice:** the producer-uniqueness check. First pass I confirmed the
  SDK is the sole `chat.message.sent` producer (`index.ts:1306`). But the contract that actually
  matters for the leak is the sole `process_chat_message.spawn` INVOKER, which is a different grep
  (`\.spawn(` + `process_chat_message` in apps/\*.py). Had to re-trace at the spawn layer, not the
  event-emit layer, to be sure no replay/backfill/synthetic-chat producer also needs the flag.
  Confirmed only `_spawn_chat_nlp` (real-time) + `batch_enrich` (stubbed reader). Lesson: "is the
  wire fully enumerated?" must be answered at the CONSUMER-of-the-flag layer, not the event-name
  layer — they can diverge.
- **A meta-pattern in how gaps recur across agents:** the §H.9 epic shows the canonical "remediation
  closes one hop, gap moves upstream" shape across FOUR consecutive retros (103→108→109→this), but
  the CLOSING PR finally broke it by adding a real un-mocked end-to-end test (patch only the
  external boundary, drive the real loop). The meta-pattern: a HALF_WIRE is only truly closed when a
  test exercises the chain WITHOUT the test itself supplying the value the consumer reads. The
  fix-PRs that merely add a consumer-direct unit test (FOLLOW-384) recurred as gaps; the one that
  added a real-chain test (FOLLOW-387) closed clean. I should weight "does the new test
  self-inject?" as the single strongest closure signal in future §7 checks.
- **Self blind-spot:** I correctly resisted promoting the pattern to a Rule despite surface-count 4
  — the discipline of "independent-context, not temporal-recurrence" held. The standing risk is that
  a future retro forgets these are all one epic and promotes prematurely; the count-bump-with-HOLD
  record in §6 is the guard against that.

## 2026-06-25 · RETRO-111/112/113 (FOLLOW-359 / FOLLOW-363 / FOLLOW-341)

- **A finding I almost missed and why:** RETRO-111 (FOLLOW-359) looked like a clean one-line
  HALF_WIRE_P closure — the GET response now carries `variant`, AC2 proves response==ClickHouse log,
  real-handler test, done. I almost wrote "Wiring Audit — clean ✅." The miss: the SDK NEVER calls
  GET `/api/adapt` — `fetchDirectives` is POST-only (`adapt.ts:746`), GET is the LEGACY surface
  (`adapt-schema.ts:122`). So the field has a producer but no in-repo consumer ON THAT SURFACE. The
  grep `grep -rn "method:\s*GET" packages/sdk/src apps/*/src | grep -i adapt → 0 hits` is what
  caught it. Lesson: when a PR "closes a HALF_WIRE_P by adding the response field," always grep for
  who reads it ON THE SPECIFIC SURFACE the field was added to — the existing consumer often rides
  the SIBLING surface (POST), which makes the wire LOOK complete.
- **An axis/chain I had to trace twice:** FOLLOW-341 "self-populates on merge." First read: true,
  post-migrate-seed.yml runs `pnpm seed:archetypes` on push:main. Second read of the workflow body:
  `doppler run --config dev` — DEV ONLY, plus a soft-skip on missing `DOPPLER_TOKEN_DEV`. There is
  no prod seeder. So the merge activates cosine in dev only; prod silently runs djb2. The PR-prose
  claim and the workflow header both over-claim. Always read the actual `--config`/env scope of a
  seed/migrate workflow, never trust "runs on merge" prose.
- **A meta-pattern in how gaps recur across agents:** the same "merged ≠ live in prod for
  Postgres/data" trap keeps surfacing across DIFFERENT agents and tickets (RETRO-076 ml/data
  migration, now RETRO-113 ml-engineer embedding seed). That's now 2 independent contexts → I
  flagged a candidate disclosure rule to the human (do NOT claim "self-populates on merge" unless a
  workflow hits PROD), while noting FOLLOW-308 already owns the MECHANISM so the rule may be moot —
  codify-now vs wait-for-308 is a human call. Also recurring: Rule S closures that are GENUINELY
  complete (FOLLOW-363 enumerated all 13 sites + justified exemptions) are the rare non-one-hop
  closures — worth citing as the template, and the "add a call-site inventory comment" remediation
  is itself a Rule S amendment candidate. Discipline held: do NOT promote single-epic/single-context
  recurrences; flag amendments to EXISTING rules (grounded in their own evidence chain) separately
  from brand-new rules (2 independent contexts required).

## 2026-06-26 — RETRO-118 (FOLLOW-358 / PR #357)

- **A finding I almost missed and why:** the headline CB-1 (fail-CLOSED migration-ordering hazard)
  is invisible from the test suite — all 4 new tests mock `fetch` and assert the INSERT _string_, so
  they PASS regardless of whether the prod table has the column. I almost rated the PR "clean, one
  safe additive column" like the diff invites. The catch was tracing the INSERT column-list change
  against the _fire-and-forget `.catch`_ (route.ts:501-504): adding a column NAME to an explicit
  INSERT list is fail-CLOSED against an un-migrated table — the inverse of the usual
  safe-additive-column intuition and of Rule M's fail-OPEN degrade. Lesson: when an INSERT/UPDATE
  column-list grows, always ask "does the target schema have this column in PROD yet, and what
  happens to the write if not?" — not just "is the new value correct?"
- **An axis/chain I had to trace twice:** the scope. `gh pr diff 357` showed 9 files (+342)
  including 200+ lines of bandit-seed work; I started analyzing it as FOLLOW-358 scope-creep.
  `git log -- <path>` then showed the bandit files' last-touch commits are `[FOLLOW-361]` (PR #356,
  merged 32 min earlier) and `git show --stat cdda69a` (the FOLLOW-358 commit) touches only 3 files.
  The PR diff was an unrebased-branch three-dot artifact. Had to re-derive the true footprint from
  `git`, not from `gh pr diff`. Meta-takeaway: NEVER trust `gh pr diff` as the change footprint when
  sibling tickets merged close together — confirm each file's attributing commit with
  `git log -- <path>`.
- **A meta-pattern in how gaps recur across agents:** the "merged ≠ live in prod" trap keeps
  re-surfacing (RETRO-076 Postgres, RETRO-113 CH seed → Rule M, now RETRO-118 CH column), but each
  instance has a DIFFERENT failure mode: silent capability-inactive (fail-open, safe) vs silent
  total-write-failure (fail-closed, data loss). Rule M covers the fail-open shape only. The
  fail-closed variant (INSERT names a not-yet-migrated column) is a genuinely new sub-shape — held
  at count 1, watch-listed for promotion. Backend agents treat "add column + reference it" as
  atomic; in this repo migrations are manual and code auto-deploys, so the two halves arrive out of
  order by default.
- **Numbering note:** RETROSPECTIVES.md ends at RETRO-113 but FOLLOW_UPS ledger maps 114–117 to
  #353–#356; I honored the PM-assigned RETRO-118 and documented the gap rather than renumbering.
  Watch for the same race if 114–117 land out of order.

## 2026-06-26 · RETRO-117 (PR #356, FOLLOW-361 — reconcile bandit seed convention `'default'`→control/v1/v2; export `SEED_VARIANTS`, migration 0031 strips `'default'`, parity test)

- **A finding I almost missed and why:** the THIRD copy of the variant list — `VARIANT_INDEX` at
  `route.ts:241`. The ticket's headline ("single source of truth for the three-arm variant list") +
  a clean SEED-side parity test made the easy verdict "SoT achieved, clean ✅." The catch was
  running the completeness grep from the SYMBOL the change semantically owns (`grep VARIANT_INDEX` +
  the variant-list literals) rather than from the two files the PR touched. That surfaced the
  consumer-side index map the PR never unified — the same RETRO-074→075 "fixed every site the ticket
  named ≠ every site" shape, but applied to an SoT-consolidation instead of a fix. Lesson: on any
  "consolidate the duplicates / single source of truth" PR, grep ALL copies of the value (producers
  AND consumers/index-maps/enums), not just the ones the diff edited; "unified the writers"
  routinely leaves a reader literal behind.
- **An axis/chain I had to trace twice:** the prod-apply path for migration 0031. My first instinct
  was to reuse RETRO-113's verdict (its HW-1: "Postgres merged ≠ prod-applied → file an operator
  stub," per memory `project_postgres_migrations_no_autoapply`). That would have been WRONG here:
  RETRO-113's gap was a dev-only SEED job; this is a Drizzle MIGRATION, which rides `db-migrate.yml`
  — and ESC-023 (the secret-provisioning blocker) is RESOLVED, so it auto-applies staging→prod. I
  verified by reading the workflow header + `ESCALATIONS.md:1131` +
  `gh run list --workflow=db-migrate.yml` (a real run fired 3s after merge). Meta-takeaway: classify
  a "merged ≠ live" finding by ARTIFACT TYPE (migration vs seed vs CH) and CHECK THE ACTUAL WORKFLOW
  RUN before reusing a prior retro's prod-gap verdict — the blanket memory is now split (migrations
  auto-apply post-ESC-023; seeds + ClickHouse do not).
- **A meta-pattern in how gaps recur across agents:** "consolidate to a single source of truth"
  tickets reliably leave an un-unified tail at the CONSUMER end (RETRO-095 P-2 two-producer split →
  FOLLOW-361 unifies producers → leaves VARIANT_INDEX). The write side gets the attention because
  that's where the bug manifested; the read/index side is treated as "just a lookup table" and
  forgotten. Same single-feature context so no rule promotion (count 1), but it's the structural
  cousin of Rule S sibling-incompleteness — worth watching for a genuinely independent 2nd instance
  to promote a "consolidate ALL copies incl. consumer index maps" rule.
- **Numbering note:** RETROSPECTIVES.md ended at RETRO-113 when I ran; per the merge cadence #356 =
  RETRO-117 (114/115/116 = #353/#354/#355, not yet in-file). FOLLOW_UPS was being mutated
  concurrently by the RETRO-118 run — FOLLOW-394 got taken mid-run, so my stub moved to FOLLOW-397.
  Re-scanned the next-free number AFTER the concurrent writes landed rather than trusting my initial
  read. Watch for this race when multiple retros run in parallel: always re-grep the highest FOLLOW
  number immediately before writing the stub.

## 2026-06-26 · RETRO-119 (PR #358, FOLLOW-354 — test+document the confidence floor's real axis; closed RETRO-091 TG-1/DG-1/LG-1)

- **A finding I almost missed and why:** the `SIDEBAR_SHOW_THRESHOLD` rung of the new gating-ladder
  note (DG-1). A test+docs PR whose JSDoc/§E.7 text _looks_ authoritative and whose first two rungs
  I verified (`DOM_ADAPT_CONFIDENCE_FLOOR` ✅, server `CONFIDENCE_THRESHOLD` ✅) tempts an "accurate
  doc, clean ✅" verdict after 2 of 3 checks pass. The catch was grepping the THIRD cited symbol
  (`SIDEBAR_SHOW_THRESHOLD`) repo-wide instead of trusting it by association — it exists nowhere as
  a const; the cited `index.ts` actually says the sidebar is admin-only/no-op. Lesson: when a doc
  cites N symbols, verify ALL N against their named files (Rule Y), not a representative sample —
  the irony-trap here is that the PR's own MISSION was to fix a stale citation, yet it shipped a new
  one.
- **An axis/chain I had to trace twice:** the floor's `confidence >= 0.5 || signal_count >= 2`
  OR-branch. First pass: AC tests look complete (below-floor → no fetch, above → fetch). Second
  pass: realized both arms of the OR are an AXIS — the tests only drive the confidence arm; the
  signal_count arm on the description path is untested (FOLLOW-399). A two-condition gate is two
  axes, not one.
- **A meta-pattern in how gaps recur across agents:** "remediation PR closes the named gap genuinely
  but introduces a smaller same-family defect" — here, FOLLOW-354 correctly closes RETRO-091's
  description-axis test gap AND correctly fixes one stale cross-ref, while planting a new stale
  citation (DG-1) and a new untested axis (TG-1). This is the softer cousin of the
  `inquiry_submit_selector` one-hop-move: not the SAME gap relocating, but the closure act spawning
  an adjacent fresh gap. Always diff what the closure ADDED, not just whether it closed.

## 2026-06-26 · RETRO-120 (FOLLOW-362 / PR #359)

- **A finding I almost missed and why:** The headline change (suppress non-`en` sampling so logged
  == served) is clean and well-tested, which almost let me stop at "LG-2 closed ✅". The real action
  was one hop downstream on the **reward leg**: `getBanditArms`/`updateBanditArm` key on
  `(tenant, archetype, variant)` with NO locale, so non-`en` now silently feeds the SHARED control
  arm. The fix removed treatment-arm pollution but moved the gap to control-arm locale-conflation.
  Lesson: when a fix "routes everything to control," always ask where `control` is then consumed
  (the reward/feedback loop), not just where it is logged.
- **An axis/chain I had to trace twice:** The GET-vs-POST condition asymmetry
  (`holdoutGroup || locale !== 'en'` vs bare `postLocale === 'en'`) looked like a Rule-S violation
  on first read. Tracing POST showed `assignHoldout()` early-returns control at `route.ts:1098`
  BEFORE the sampling site, so POST structurally cannot need the inline holdout term — correct, not
  a bug. Had to verify the early-return ordering before writing it up; the parity is at the
  _invariant_ level, not the _expression_ level.
- **A meta-pattern in how gaps recur across agents:** Two instances now (RETRO-095 FOLLOW-347
  carry-over; RETRO-120 FOLLOW-354/PR#358 carry-over) of `gh pr view/diff` showing already-merged
  sibling-ticket files because the diff base predates the sibling merge. This is a retro-READING
  discipline, not a worker coding rule, so it stays here, NOT in CONVENTIONS*PATCH: **always confirm
  the true changed set via `git show <mergeCommit> --stat` / `git log --oneline -- <file>` before
  classifying scope.** Also recurring: this variant-logging family (RETRO-095→111/117/118/120) keeps
  surfacing "fix logs control / fixes the obvious axis, but a downstream consumer (GET response,
  seed convention, reward arm, page_context) was keyed without the new dimension" — the durable
  failure shape is \_a shared key that omits the axis the fix introduces*. Worth watching for a Rule
  K.1 amendment if a 6th instance lands.

---

## 2026-06-26 · RETRO-121 (FOLLOW-394 / PR #360 — CH migration-ordering contract test + runbook)

- **A finding I almost missed and why:** the contract test LOOKS like a generic "any future column"
  guard (the runbook even claims it), but it is hard-coded to `page_context_source`/0019 and applies
  only `0001`–`0019` — a future column PASSES it unchanged. I almost recorded TG-1 as "fully closed"
  on the headline. Caught it by asking "what does this test do for column 0020?" The runbook's own
  "Extending" section (manual per-column add) was the tell that contradicts its headline — DG-1.
- **An axis/chain I had to trace twice:** the gitleaks change. First read: "another file-wide
  allowlist, same as RETRO-118 DG-1 → flag it." Second read of `.gitleaks.toml:177` vs `:185`: this
  PR added a **token-scoped `regexes`** entry (the GOOD shape), and that entry now makes PR #357's
  **file-wide `paths`** entry REDUNDANT. So it's not a new sin — it's the fix that lets the OPEN
  FOLLOW-396 finally DELETE the broad allowlist (Rule-U strip-superseded). Reconciled instead of
  double-flagging.
- **A meta-pattern in how gaps recur across agents:** the "remediation PR closes the CI/code leg but
  only DOCUMENTS the prod-state leg" shape (Pattern C) — same as RETRO-113/FOLLOW-392 (seed in code,
  prod NULL). A retro finding's follow-up keeps shipping the DETECTION + DOC and deferring the
  actual prod mutation/verification to the standing FOLLOW-308 gate, so the original prod gap is
  never retro-closed, only relocated. Watch: when a follow-up's deliverable is a test+runbook for an
  incident, the incident's prod root-cause is almost always still unverified — always emit the
  one-time prod attestation stub (here FOLLOW-404).
- **Process note:** the ticket said FOLLOW-394 but RETRO-118 PROSE called it "FOLLOW-397"; the
  FOLLOW_UPS.md footer (`394 = RETRO-118 …`) was authoritative and resolved the collision. Trust the
  ledger footer over retro prose for ID reconciliation. RETRO-114/115/116 still un-committed in-file
  — recurring numbering debt the PM keeps deferring.

## 2026-06-26 · RETRO-122 (FOLLOW-397 / PR #361 — derive VARIANT_INDEX from SEED_VARIANTS)

- **A finding I almost missed and why:** The PR _looks_ like a clean SoT win (third hardcoded list →
  derived), and the explicit test for the stray-variant case made it tempting to stamp "closure ✅"
  on AC-3 too. I almost did. The catch: AC-3 said "a future arm added WITHOUT a copy slot fails CI,"
  but the delivered Part-A test only asserts `VARIANT_INDEX` is internally consistent — it never
  indexes a REAL playbook `variants.en` array. So a 4th arm would derive fine and silently serve
  base copy with CI green. The deconsolidation didn't disappear; it relocated from a same-file
  literal to a CROSS-PACKAGE positional coupling (control-plane `SEED_VARIANTS` order ↔ SDK
  `variants.en` index). Reading the stub's exact AC wording against the delivered assertions (not
  just "is there a test for this?") is what surfaced it.
- **An axis/chain I had to trace twice:** The served-vs-logged value for the stray arm. First pass I
  read the fix as "serve control (per stub AC-2)"; second pass against the diff showed the
  implementer dropped `?? 0` and serves `s.en` (base) instead — a DEVIATION from the stub that is
  actually an IMPROVEMENT. Had to reconcile: it's not a bug, it's a better choice, but it left the
  "pin the logged-value contract" sub-AC implicit (logs raw `v3`, serves base). Easy to misfile an
  improvement as a deviation-defect or vice-versa.
- **Meta-pattern in how gaps recur across agents:** This is now the THIRD hop of the SAME
  variant-list lineage (RETRO-095 two-seeders-disagree → RETRO-117 consumer-literal-third-copy →
  RETRO-122 cross-package-order-coupling). Each "fix" closes the named site and births the next-hop
  site one layer out. The durable tell: when a consolidation replaces an EXPLICIT mapping with a
  DERIVED/positional one, ask "what now silently binds the derivation's output to its consumer's
  shape?" — that binding is the new untested contract. Also reaffirmed the ledger discipline: a
  remediation of a count-1 finding does NOT advance the promotion count (same feature/context), even
  when it's the 3rd temporal recurrence — only INDEPENDENT contexts count. Resisted a premature rule
  here.

## 2026-06-26 · RETRO-123 (FOLLOW-396 / PR #362 — restore gitleaks route.ts scanning; PROMOTED Rule V)

- **A finding I almost missed and why:** The PR is a 5-line config deletion that does exactly what
  RETRO-121 predicted — textbook "clean ✅, close it." The catch was running the MULTI-AXIS check on
  the rest of `.gitleaks.toml`, not just the line that changed: one allowlist-entry UP (`:172`), the
  FOLLOW-374 consent `platform-registration/` exemption is the SAME bad-shape file-wide `paths`
  exemption on a secret-handling prod route (64-char `CANONICAL_CONSENT_TEXT_HASH`), still LIVE. The
  act of promoting Rule V is what gave me the lens to see it — promoting a rule and then immediately
  scanning the repo for OTHER live violations of that exact rule is the highest-leverage move a
  retro can make. Lesson: when you promote a rule, grep for its violations in the same pass; the
  promotion isn't done until you've found (or cleared) the next instance.
- **The promotion-count judgment I had to reason through twice:** First instinct mirrored
  RETRO-122's discipline — "this PR is a remediation of RETRO-118, and remediations don't advance
  the count, so NO promotion." Second pass corrected it: the ≥2-prior-retro threshold is about how
  many PRIOR retros carry the pattern, NOT whether the CURRENT PR is a fresh occurrence. RETRO-121
  had ALREADY adjudicated 118 and 121 as two INDEPENDENT occurrences (different trigger sites +
  remediation shapes) and deferred SOLELY on "only 1 prior retro at the time," explicitly
  pre-authorizing "promote on the NEXT sighting." At RETRO-123 there are 2 prior retros → threshold
  met. The remediation-doesn't-inflate rule and the promote-now decision are BOTH true and not in
  tension: the count came from 118+121, the current PR just fired the pre-set trigger.
  Distinguishing "a remediation can't be the 2nd occurrence" (RETRO-122, correct) from "a
  remediation can be the moment a 2-already-banked threshold is acted on" (RETRO-123, correct) is
  the subtle line.
- **An axis/chain I had to trace twice:** "Gitleaks CI passes" as evidence of restoration. First
  read: AC-2 satisfied (CI green). Second read: green proves the FP is GONE, not that real-secret
  DETECTION is back — those are different claims, and the dummy-token negative control (the half of
  AC-2 that disambiguates) wasn't run. A removed suppression's restoration is
  asserted-by-construction until a true-positive is demonstrated. → FOLLOW-406.
- **A meta-pattern in how gaps recur across agents:** the gitleaks-allowlist saga (RETRO-118
  bad-shape add → RETRO-121 good-shape add + flag-redundant → RETRO-123 strip-superseded + promote)
  is the same multi-hop lineage shape as the variant-list saga (095→117→122) and the
  migration-ordering saga (118→121) — a finding doesn't close in one PR, it walks outward one hop
  per retro, and the retro's job is to NAME the next hop before it's a surprise. The durable tell
  for config-hygiene findings: "a suppression added to silence THIS PR's own noise" is almost always
  over-broad on first attempt and almost always has a sibling instance elsewhere in the same config
  file. Also reaffirmed: trust the FOLLOW_UPS.md footer ledger over retro prose for ID/threshold
  reconciliation; and the RETRO-114/115/116 in-file hole is now 6 retros old — escalated its
  visibility this round (it degrades every "last N retros" pattern scan).

## 2026-06-26 — RETRO-124 (FOLLOW-403 / PR #363, CH-migrations runbook correction)

- **A finding I almost missed and why:** This is a 1-file, +9/−4 doc PR that did exactly what
  RETRO-121 §4d DG-1/DG-2 asked — the lazy verdict is "runbook fixed, clean ✅, close it." The catch
  came from treating the corrected CLAIM as a string with multiple homes, not as a line number: I
  grepped the corrected phrasing ("for future migrations" / "catches any future") across the repo
  and found the IDENTICAL overstatement still live in `migration-contract-test.sh:11-12` — the
  SOURCE FILE the runbook describes. FOLLOW-403 corrected the runbook's copy of the claim and left
  the script's copy untouched. The author who EXTENDS the test reads the script header, not the
  runbook, so the false "future migrations" coverage signal survives exactly where it does the most
  damage. Lesson (now the §6 watch-item): a correction ticket spawned from a retro-QUOTED string
  must grep that string repo-wide and fix every surface — the retro quotes ONE line for evidence;
  the worker must not treat that one line as the whole scope.
- **An axis/chain I had to trace twice:** the migrate.sh CAPTION fix. First read: DG-2 satisfied
  (caption now says "Apply ALL pending migrations idempotently"). Second read: the fix corrected the
  caption but the SENTENCE that introduces the block (`:72-73`, "for files with multiple statements,
  use migrate.sh's \_apply_file helper") still frames the same `bash migrate.sh` command as a
  single-file applier — so fixing the caption created a NEW intra-doc contradiction. A caption and
  the prose that introduces it are two surfaces of one claim; fixing one without the other moves the
  gap one hop rather than closing it. → FOLLOW-408.
- **A judgment I had to reason through twice (promotion discipline, inverse of RETRO-123):** the
  "doc-correction fixes the quoted line but leaves an identical sibling claim" pattern LOOKS like
  RETRO-123's "fixed route.ts, missed consent — second live instance" — tempting to bank them as 2
  occurrences and promote a rule. Held back: RETRO-123's instance is CONFIG-domain (gitleaks
  allowlist shape) and was promoted under Rule V; THIS is DOC-domain (a prose/comment claim about
  coverage). Same META-shape ("the named fix lands, an identical instance survives one hop over")
  but different enough domains that banking them as one promotable pattern would be the
  count-inflation RETRO-122 warned against. Kept count 1, no rule, explicit watch-item. The line: a
  shared meta-shape across two domains is a LESSON, not yet a RULE — a rule needs ≥2 prior
  occurrences in a coherent-enough domain that the rule's verification step is concrete.
- **A meta-pattern in how gaps recur across agents:** doc/comment-correction tickets are the highest
  under-fix risk in the whole loop — they are scoped to "fix the wording the retro quoted," and
  workers (correctly, per the surgical-changes guardrail) touch only that. But a CLAIM about a
  system (test coverage, what a script does, which file an allowlist guards — cf. RETRO-123 §4d
  DG-2's "keys in route.ts" copy-paste comment on the consent block) is almost always replicated
  across the runbook + the source file + an intro sentence + a References header. The retro's
  durable job on any doc-correction merge: grep the corrected string repo-wide and enumerate EVERY
  surface before declaring the claim closed. Also: a doc that points forward to an unlanded ticket
  ("wait for FOLLOW-402 / Once FOLLOW-402 lands") creates a doc-update-BACK obligation on that
  ticket — flag it on the ticket, or the fix that lands later silently re-stales the doc this PR
  just corrected.

## 2026-06-26 — RETRO-114 (FOLLOW-342 / PR #353, back-filled out of order; test-only AC-2 completion)

- **A finding I almost missed and why:** PR #353 is a +43-line test-only PR over ground already
  exhaustively retro'd in RETRO-095. The lazy verdict is "test added, wiring clean, close it." The
  real story was buried in the FOLLOW_UPS.md FOOTER ledger, not the diff: a FOLLOW-393 already
  existed attributed to "RETRO-114 / PR #353," meaning a prior run had analyzed this merge,
  generated the follow-ups, and never committed the RETRO entry. The headline finding was PROCESS,
  not code — FOLLOW-342 was a STALE ticket delegated for variant-indexing that PR #327 shipped 6
  days earlier (~2h after the AUDIT-2026-06-19 F-03 it derived from was written). The diff tells you
  nothing; the git-log + footer ledger tell you everything. Durable tell: when a "completion" PR is
  tiny and over already-retro'd code, check `git log --all --grep <TICKET>` and the FOLLOW_UPS
  footer BEFORE writing — the gap is upstream of the diff (was this ticket even real?), not in it.
- **An axis/chain I had to trace twice:** the "correct end-to-end in prod regardless of path" claim
  in the PR body. First pass: the en-axis variant chain (sample→`variants.en[idx]`→log) is intact,
  so the claim reads true. Second pass against RETRO-095 §4a LG-2: at #353's merge MINUTE the
  `pl`/`es` locale precedence still sampled+logged v1/v2 while serving control copy — the claim was
  false on the non-en axis until FOLLOW-362 landed a day later. A "clean ✅" on the axis a PR tests
  is not a "clean ✅" on the expression — the copy-selection precedence has three branches and the
  AC-2 test asserts only the third.
- **A judgment I had to reason through (promotion discipline):** the stale-finding-delegation
  pattern is count 1 and maps to existing Rule P as a DELEGATION-time analogue — resisted minting a
  new rule (FOLLOW-393 already records "amend Rule P on 2nd occurrence," which is the right call).
  Also resisted minting any new FOLLOW number: 393/392 pre-existed; a back-fill retro's job is to
  MATCH the existing ledger, not re-grow it.
- **A meta-pattern in how gaps recur across agents:** the most expensive gaps in this loop aren't
  code half-wires, they're STALE WORK — an audit finding self-invalidates the day it's written, then
  walks through promotion → delegation → a burned worker run → a no-op completion PR, because no
  step re-verifies the finding against current main. Same family as the "Postgres/data merged ≠
  live" trap (RETRO-076/113): both are "the artifact says X, but the world already moved." The
  retro's durable job: trace the ticket's PROVENANCE (when was the finding written vs. when did the
  fix merge?), not just its diff. And: the RETRO-114/115/116 in-file hole — now PARTIALLY closed
  (114 filled this run); 115 (#354) and 116 (#355) still missing and still degrading every "last N
  retros" scan. Escalate to PM to back-fill those two.

## 2026-06-26 · RETRO-116 (FOLLOW-389 / PR #355, out-of-order back-fill)

- **A finding I almost missed and why:** The micro-poll `onAnswer` guard (`index.ts:1243`) being
  left TEST-ORPHANED. The PR ships 7 "real-handler" tests and crows "Rule L compliant," which reads
  as a clean TG-1 closure. I almost accepted it — but RETRO-109 TG-1 said "all THREE guards," so I
  enumerated guard-site → test and found only 2 of 3 covered. The tell was buried in the mock:
  `buildMockFetch()` returns `micro_polls_enabled: false`, which silently makes the third path
  undrivable. Lesson: when a remediation claims to close a MULTI-SITE finding, re-list every site
  from the SOURCE retro and tick them off individually — do not trust the test COUNT or a "Rule L
  compliant" banner.
- **An axis/chain I had to trace twice:** The HW-1 producer wire. First pass: "producer at :1148 →
  fn appends param → route gate reads it = closed." Second pass: I followed the call site UPWARD and
  realized it lives inside the quiz-completion callback, which is downstream of Guard 1's early
  return at :1103 — so `profilingOptedOut` at the call site is ALWAYS false in normal flow. The wire
  is connected but dormant; the PR's "reachable by real SDK traffic" is false. Lesson: for a
  "producer now wired" claim, trace whether the producer call site is REACHABLE with the value that
  matters, not just whether the arg is syntactically passed.
- **A meta-pattern in how gaps recur across agents:** "Fix the retro-quoted string, miss the sibling
  twin." DG-1 fixed the micro-poll comment but left the identical false line at `showQuizTrigger`
  :1102 — the EXACT shape RETRO-124 logged for the clickhouse runbook (FOLLOW-403 → sibling
  `migration-contract-test.sh`). Two different agents (data-engineer, sdk-engineer), two domains,
  same failure: correcting the flagged copy without grepping the string repo-wide. This is now 2
  independent contexts but only 1 PRIOR retro, so I HELD promotion (RETRO-123's ≥2-prior / 3rd-
  sighting precedent) and banked RETRO-124 as occurrence 1. Watch for the 3rd; it should become a
  Rule. My own blind-spot risk: the temptation to promote at count-2-total when the convention here
  is count-2-PRIOR.

---

### 2026-06-26 · RETRO-115 (FOLLOW-357/356 / PR #354 — tier→page_context rename; OUT-OF-ORDER back-fill, last of the 114/115/116 gap)

- **A finding I almost missed and why:** The migration-number citation bug (DG-1). The PR's wiring
  was clean and all gates green, so the lazy read is "rename PR, low risk, Wiring Audit clean ✅,
  done." The gap only surfaced because I grepped the `tier` provenance comments against the ACTUAL
  migrations directory and found three comments saying "migration 0017" while the PR's own file is
  0018 — and 0017 is a REAL, unrelated migration (follow371 holdout-contamination), which makes the
  misdirection worse than a dangling reference. Lesson: on any rename/migration PR, grep every
  in-code "migration NNNN" / provenance citation against `ls infra/.../migrations/` — renumber-drift
  between a planned slot and the merged slot is invisible to every CI gate (schema-drift, rule-h,
  journal-monotonicity all passed) and only a citation-vs-artifact cross-check catches it.
- **An axis/chain I had to trace twice:** FOLLOW-358. PR #354 DEFERRED it (GET echoes caller `tier`
  1|2|3 into the same `page_context` CH column POST fills with page-type 1|2). First pass I almost
  logged it as this PR's open HALF_WIRE/LG. Second pass (step 7 end-to-end) showed it was already
  CLOSED downstream by RETRO-118 / migration 0019's `page_context_source` discriminator — a slot
  ABOVE this PR's 0018. So the right treatment was reconciliation (deferred-here, closed-there,
  verified producer→sink→attestation), not a re-open. The two-PR rename arc (0018 column rename in
  #354, 0019 source discriminator in #357) is only legible if you read BOTH retros' migration slots.
- **A meta-pattern in how gaps recur across agents:** "Delete the guard to admit the new field"
  (CB-1) — to let the GET-only `tier` survive after it left `AdaptationDirectives`, the worker
  STRIPPED `satisfies AdaptationDirectives` from two early-return literals instead of widening to
  `T & { tier }` (which they DID use on the main path). Same Rule-S "treat all symmetric siblings at
  equal tier" failure I keep seeing across agents (RETRO-117/122 VARIANT_INDEX 3rd-literal,
  RETRO-112 13-call-site dwell/view). The recurring shape: a contract change is applied completely
  on the "obvious" branch and degraded (or dropped) on the early-return / fallback / non-en
  siblings. Audit habit reinforced: enumerate ALL return/branch sites of a touched handler and diff
  their completeness tier, never just the happy path.
- **My own blind-spot logged:** the concurrent RETRO-116 run minted FOLLOW-409 while I was
  mid-write, forcing my stub to 410 and the counter to 411. Lesson for back-fill/concurrent runs:
  re-read the FOLLOW next-free counter AND the retros tail IMMEDIATELY before writing, not just at
  the start — a parallel retro can claim a number and append a heading between my first read and my
  append.

---

### 2026-06-26 · RETRO-125 (FOLLOW-407 / PR #364 — Rule V applied to the consent gitleaks exemption)

- **A finding I almost missed and why:** the new token-scoped `regexes` entry is REDUNDANT with a
  PRE-EXISTING inline `// gitleaks:allow` on `lib.ts:46`. I nearly recorded the PR as a clean Rule-V
  application and stopped. What saved it: I grepped for the literal VALUE (not the symbol) and found
  it lives at exactly ONE site — which already carried an inline allow. The lesson: for a
  gitleaks-config retro, ALWAYS grep the suppressed literal's actual value repo-wide and check for a
  co-located inline `gitleaks:allow`; a token-scoped allowlist entry that duplicates an inline allow
  is unproven/dead config, and "CI green" hides it completely.
- **An axis/chain I had to trace twice:** the 38-vs-40-char window math. My first instinct ("38 < 40
  so it's contained, fine") was too shallow — the real question is WHICH of the hash's 25 possible
  40-char windows the prefix sits in, and which window gitleaks actually REPORTS. I scripted it:
  gitleaks reports the LEFTMOST window only ([0,39]), and the 38-char prefix is contained in window
  [0] alone. So it works, but it is leftmost-anchored, not robustly "inside the capture." Trace the
  regex-engine match semantics, not just substring length.
- **A meta-pattern in how gaps recur across agents:** the SAME deferred-negative-control gap
  recurred verbatim across two Rule-V remediation PRs (route.ts/FOLLOW-396 → FOLLOW-406, then
  consent/FOLLOW-407 → FOLLOW-411). The interesting part: the governing rule (Rule V) ALREADY
  mandates the negative control — this is not a missing-rule pattern, it is a rule-COMPLIANCE
  pattern (the mandated proof keeps getting deferred at PR time). My discipline note to self: when a
  recurring gap is already covered by an existing rule's text, resist minting a new rule
  (count-inflation); instead flag it as an execution-discipline compliance gap and make the
  follow-up carry the proof. Also: a retro that spawns FOLLOW-N+k should re-check whether an EARLIER
  open follow (here FOLLOW-406) is now under-scoped by the new merge, rather than blindly filing a
  parallel stub — cross-ref-and-widen beats duplicate.

## 2026-06-26 · RETRO-126 (PR #365, FOLLOW-398 — phantom SIDEBAR_SHOW_THRESHOLD removal; AMENDED Rule Y, scope-broadening)

- **A finding I almost missed and why:** the FOLLOW-398 fix LOOKED clean (it deleted the phantom
  from all 4 sites and even fixed a test title), so the easy verdict was "closed ✅, no findings." I
  almost recorded that. Forcing myself to diff the REPLACEMENT prose against `index.ts:720-724`
  source — not against the prior doc — surfaced that the new line-728 text says "`adapt-floor`
  returns `[]`" when `adapt-floor.ts` is const-only (no function), and that it drops the
  `|| signal_count >= 2` OR-branch. The fix for a Rule-Y citation introduced a fresh Rule-Y citation
  IN THE SAME SENTENCE. Lesson: a doc-fix PR is exactly where the next inaccuracy hides; verify the
  NEW text against code, never against the text it replaced.
- **An axis/chain I had to trace twice:** "does the constant exist?" had to be traced through git
  HISTORY, not just current HEAD. The FOLLOW-398 stub (and RETRO-119) framed it as "never existed as
  a real const." `git log -S` proved it WAS real (TICKET-037) and was DELETED by PR #340/FOLLOW-375
  on 2026-06-23 — which reframes the whole thing from "typo phantom" to "Operating-Principle-2
  propagation failure: a symbol removed from code, citations left behind." The stale
  `.claude/worktrees/*` checkouts (which still DEFINE the const at index.ts:178/660) were the tell —
  I almost dismissed them as noise. The real root cause only emerged from history.
- **A meta-pattern in how gaps recur across agents:** the §E.7 confidence-gating-ladder paragraph
  has now needed THREE PRs (FOLLOW-354 introduced the phantom rung while fixing a cross-ref →
  FOLLOW-398 introduced "returns []" while fixing the phantom rung). Each editor diffed against the
  prose, not the source, so each fix re-injected a sibling inaccuracy. This is the SAME shape as the
  broadened Rule Y, and it is why I executed the amendment two prior retros (115, 119) had each
  recommended/pre-authorized but deferred to the human — when ≥2 prior retros independently tee up
  an amendment to an EXISTING rule, deferring again is just letting the gap recur a 4th time.
  Amending (not minting a new letter) respected the RETRO-122 count-inflation discipline while
  finally closing the loop.

## 2026-06-26 · RETRO-127 (PR #366, FOLLOW-410 — the "0017"→"0018" migration-citation + GET `satisfies` fix; closes RETRO-115 §4d DG-1/§4b CB-1)

- **A finding I almost missed and why:** I drafted this entire retro AS RETRO-126 and was about to
  PROMOTE the Rule-Y broadening myself — then my first Edit failed with "file modified since read."
  A CONCURRENT retro run had appended RETRO-126 for a DIFFERENT ticket (FOLLOW-398/PR #365) and had
  ALREADY broadened Rule Y, citing my own FOLLOW-410 instance as its evidence. Had the Edit not
  raced, I would have (a) collided on the RETRO-126 number, (b) DOUBLE-PROMOTED the same Rule-Y
  amendment, and (c) double-cited RETRO-115/119 as evidence for two separate amendments — textbook
  count-inflation. **Meta-takeaway: when the harness reports "file modified since read," do NOT just
  re-read the anchor and retry — re-grep the RETRO/FOLLOW/Rule headers to detect a concurrent writer
  before re-appending.** Numbering and rule-promotion are shared-mutable state; a stale snapshot is
  a correctness hazard, not just a merge nuisance. The brief saying "RETRO-127" (not 126) was the
  tell I under-weighted at the start — I assumed the brief miscounted; it actually knew 126 was
  taken.
- **An axis/chain I had to trace twice:** the closure of RETRO-115's DG-1. First pass I called it
  "CLOSED" on the grep (zero `migration 0017`). Second pass I asked the harder question the role
  demands — is it closed END-TO-END or did the gap move one hop? It moved: the VALUE is right but
  the bare-ordinal STYLE that CAUSED the miscount survives, and the PG/CH trees collide on
  0017/0018/0019 so a bare ordinal is structurally unverifiable. That reframed a "clean closure"
  into a closed-with-moved-hop residual (FOLLOW-413). Also re-traced the CB-1 leg: the brief claimed
  the main GET return "had satisfies" — the diff showed it had an EXPLICIT `:` annotation that the
  PR CONVERTED to satisfies. Trusting the brief's premise would have mis-recorded the provenance in
  a retro whose whole subject is provenance accuracy.
- **A meta-pattern in how gaps recur across agents:** a remediation that fixes the VALUE a retro
  quoted but leaves the STYLE/SHAPE that produced it. RETRO-127's bare-ordinal residual is the same
  family as RETRO-124's "fix the quoted string, leave the sibling surface" and RETRO-126's "fix the
  phantom rung, re-inject an inaccuracy in the replacement sentence." The durable fix is always the
  CONVENTION (full-filename citation, diff-against-source) not the one-site value edit — which is
  exactly what the broadened Rule Y now governs.
- **Guardrail note:** the brief's step 5 asked me to mark FOLLOW-410 DONE in QUEUE.md. I did NOT —
  the role is QUEUE-read-only ("Never QUEUE.md"). Surfaced the DONE action for the PM in the
  FOLLOW-413 ledger note and the final summary instead.

---

### 2026-06-26 · RETRO-128 (FOLLOW-409 / PR #367)

- **A finding I almost missed and why:** The headline win was real — the micro-poll `onAnswer`
  real-handler test (RETRO-116's "load-bearing residual") is genuinely closed. It would have been
  easy to stamp the whole thing CLOSED and move on. The near-miss was reading the AC-3 JSDoc fix
  (`adapt.ts:186-193`), seeing it correctly reworded, and NOT scrolling 20 lines down into the
  FUNCTION BODY where the inline comment at `:212-213` still said the exact opposite ("reachable by
  real SDK traffic") — an internal contradiction within one function. The lesson: when an AC claims
  to fix "the JSDoc," read the WHOLE symbol (JSDoc + body comments), because the same false claim
  often lives in both and the fixer touches only the one the retro quoted by line number.
- **An axis/chain I had to trace twice:** The "Ingest stream left flowing" string. First pass: the
  three PRODUCTION sites are now symmetric (showQuizTrigger fixed, micro-poll fixed, favorites
  TRUE+annotated) → looked clean. Only the literal repo-wide grep (`grep -rn ... packages/`)
  surfaced the four TEST-file hits, two of which (`follow-385.test.ts:211/:225`, the micro-poll
  model) carry the same falsehood. AC-2 ITSELF said "grep repo-wide and fix every occurrence" — so
  the test was literally whether the worker ran the grep the AC mandated. They did not. Always run
  the exact grep the AC prescribes; never trust the production-site survey alone.
- **A meta-pattern in how gaps recur across agents:** This is the sharpest instance yet of the
  "fix-one-copy-leave-the-twin" pattern (RETRO-124 → RETRO-116 → here) — because it recurred INSIDE
  the PR chartered to close the prior twin, and across TWO distinct strings, despite an explicit
  repo-wide-grep AC. Yet I held promotion: both RETRO-128 instances are the SAME strings / SAME §H.9
  lineage RETRO-116 already flagged → same-lineage moved-hops, not fresh independent sightings, so
  anti-count-inflation (RETRO-122/125/126) keeps the independent count at 2. The discipline tension
  I felt: the EVIDENCE is overwhelming, but the COUNTING rule is strict; the right move was HOLD + a
  loud human-flag (promote-now-if-you-judge-it) rather than self-authorizing the rule. Worth
  watching: when an AC explicitly encodes the very discipline a candidate rule would codify, and the
  worker still violates it, that may justify a "compliance-failure" promotion track distinct from
  the independent-sighting-count track.
- **Test-construction meta-pattern (new, banked as Pattern B):** negative-assertion tests ("event X
  ABSENT after flush") silently false-green if nothing proves the flush fired. The opted-out REAL-4
  half depends on the opted-IN half as an invisible flush canary. This is the test-harness cousin of
  the RETRO-095/122 "served=base, logged green" family — assert the positive control (the harness
  ran) before the negative (the guard suppressed).
- **Guardrail note:** brief step 5 asked me to mark FOLLOW-409 DONE in QUEUE.md. I did NOT — role is
  QUEUE-read-only ("Never QUEUE.md"). Surfaced the DONE action for the PM in the FOLLOW-414 ledger
  note and the final summary.

---

## 2026-06-26 · RETRO-129 (FOLLOW-402 / PR #368 — generalize the CH migration-ordering contract test)

- **A finding I almost missed and why:** the headline of the PR was "self-maintaining — no manual
  update needed," which is seductive and easy to rubber-stamp. The load-bearing finding (LG-1) only
  surfaced when I asked "what does step 2 assume?" — it asserts the INSERT is REJECTED before the
  _last_ migration, which silently assumes the last migration adds an `adaptation_decisions` INSERT
  column. The repo's own migration history (0014–0017 are intent*events / note migrations, NOT
  adaptation_decisions column-adds) makes the false-alarm imminent, not theoretical. Lesson: when a
  PR replaces a \_manual* step with an _automatic heuristic_, enumerate the heuristic's hidden
  preconditions against the REAL input distribution (here: the actual migration filenames), not the
  happy-path example the PR author chose.
- **An axis/chain I had to trace twice:** the fail-OPEN-vs-fail-CLOSED direction of the `grep`/`sed`
  extractor (LG-2). My first instinct was "multi-line reformat → silent truncation → fail-OPEN." On
  second pass I worked through `sed`'s requirement for a literal `)`: most reformats actually
  fail-CLOSED (cryptic red), with only a NARROW silent fail-OPEN window (a complete `(…)` subset on
  the matched line). The correct framing changed the severity story and the fix (a column-COUNT
  assertion catches both directions) — so I traced it twice and reported the nuance rather than the
  first-pass scare.
- **A meta-pattern in how gaps recur across agents:** this is the SECOND time in this lineage that a
  fix for an overstated coverage claim introduced a NEW overstated coverage claim (RETRO-121 §4d
  DG-1 "catches any future PR" → this PR's "self-maintaining guarantee"). The over-claim is sticky
  because each author writes the aspiration, not the implementation's limits. It is governed by the
  broadened Rule Y (a named guard cited as performing a check it does not fully perform) — I logged
  it as a confirming instance, NOT a new rule, holding the anti-count-inflation line.
- **Disjoint-axis discipline:** the brief asked whether FOLLOW-404 (prod attestation) is superseded.
  Easy to wave away as "the contract test covers it now." It does NOT — CI runs against a throwaway
  container; CH migrations don't auto-apply to prod (RETRO-076/FOLLOW-307/FOLLOW-308). I reconciled
  this explicitly (§5a) instead of letting a CI-axis win imply a prod-axis win.
- **Guardrail note:** brief steps 5 asked me to mark FOLLOW-402 DONE in QUEUE.md. I did NOT — role
  is QUEUE-read-only ("Never QUEUE.md"). Surfaced the DONE action + the "confirm PR #368 formally
  closed on GitHub (gh shows OPEN but the commit is on main)" note for the PM in the §7 verdict and
  the final summary.

## 2026-06-26 — RETRO-130 (FOLLOW-414 / PR #369)

- **A finding I almost missed and why:** The third-hop "reachable by real SDK traffic" twin at
  `follow-389.test.ts:12`. FOLLOW-414's AC-1 grep was scoped to `adapt.ts` and returned 0 — the
  closure looked clean. I only caught the surviving twin by running the grep REPO-WIDE myself
  (`grep -rn "reachable by real SDK traffic" packages/sdk/src/`) AND then a paraphrase sweep
  (`grep -rniE "reachable" … | grep -iE "sdk traffic|opt|defense"`), which surfaced BOTH the false
  test header AND the qualified-correct `index.ts:1144` sibling I had to distinguish. Lesson: when a
  retro charters a string-correction, NEVER trust the PR's own narrowly-scoped grep — re-run it
  repo-wide AND with paraphrase variants, because the whole failure mode IS the narrow grep.
- **An axis/chain I had to trace twice:** RETRO-128 itself declared (implicitly) that FOLLOW-414
  would close the doc residuals — but RETRO-128's own enumeration of "reachable by real SDK traffic"
  copies was incomplete (it listed the adapt.ts inline twin, not the follow-389.test.ts:12 sibling).
  So I had to reconcile against a PRIOR RETRO's audit, not just the PR: the closure is genuine for
  the instances RETRO-128 NAMED, incomplete for the sibling it didn't. The chain is now adapt.ts
  JSDoc → adapt.ts inline → follow-389.test.ts:12 — three hops, two of which slipped past retro
  audits, not just worker fixes.
- **A meta-pattern in how gaps recur across agents:** The same string has now survived THREE PRs and
  TWO retros on one §H.9 lineage because every grep (worker AND analyst) was file-scoped. The
  anti-count- inflation discipline correctly keeps this from auto-promoting Rule (still 2
  independent domains: RETRO-124 + RETRO-116), but the recurrence-density is now strong enough that
  I escalated the meta-flag to the human a second time. Also NEW: noted Rule I (wired-or-dead)
  STRUCTURALLY BLOCKS the obvious "export the constant for tests" hygiene fix — a real rule-vs-rule
  tension worth carrying forward so I don't file "just export it" follow-ups that can't pass CI.
  Watch: when an AC is correctly SKIPPED for a CI-gate reason, verify the skip reasoning rather than
  scoring it as an incomplete closure.

---

## 2026-06-26 / RETRO-131 (FOLLOW-415 / PR #370 — harden CH migration-contract-test boundary detection + column-count floor)

- **A finding I almost missed and why:** The headline finding (LG-1) is that the new reverse
  boundary walk recognizes ONLY `ADD COLUMN`, so a `RENAME COLUMN`-introduced INSERT column is
  invisible to the ESC-031 guard. I almost scored the boundary fix as cleanly closed (the PR's
  dry-run transcripts are convincing and the false-alarm IS genuinely fixed). What caught it: I
  refused to trust the "boundary works today" transcript and grepped the ACTUAL migration that
  introduced each INSERT column — and `page_context` (literally in the INSERT list) entered via
  `RENAME COLUMN tier TO page_context` in 0018, which the new grep can't see. It's masked today only
  because 0019's ADD COLUMN is newer. The live evidence sat ONE migration below the current
  boundary. Lesson: when a guard filters by a DDL verb, always map each guarded symbol back to the
  EXACT verb that introduced it — don't assume "column added" == "ADD COLUMN."

- **An axis/chain I had to trace twice:** The `>= 17` floor. First pass I read it as a clean win
  (truncation now fails loud). Second pass — checking the OTHER axis per step 8 — I realized 17 ==
  today's exact full count, so it's a today-only guard: the dangerous subset-fail-OPEN window
  RETRO-129 flagged reopens the moment the INSERT grows to 18 columns without the literal being
  bumped. The floor didn't eliminate the manual-maintenance coupling RETRO-129 said the
  generalization removed; it moved it from "the column name" to "the column count." Both axes
  (under-count caught / over-count subset NOT caught) had to be walked separately.

- **A meta-pattern in how gaps recur across agents:** "Each hardening pass of a parse-and-heuristic
  CI guard RELOCATES the unasserted assumption rather than eliminating it." FOLLOW-402 traded
  manual-pin for two implicit assumptions; FOLLOW-415 closed one of those and introduced two MORE of
  the same family (magic-number count; verb-blind boundary). This is the same FOLLOW-402→415
  lineage, so I held the rule (anti-count-inflation) — but the meta-shape is now strong enough that
  the durable fix is schema-DERIVATION (verbs from the DDL grammar, counts from DESCRIBE TABLE), not
  another pinned literal. If a THIRD independent guard shows the relocate-don't-eliminate shape,
  that's a rule. Also reinforced: a CI guard that strengthens the CI axis says NOTHING about the
  prod axis — FOLLOW-404 (prod attestation) got MORE relevant, not less, because the RENAME column
  it attests is exactly the one the hardened guard is blind to.

## 2026-06-26 · RETRO-132 (FOLLOW-405 / PR #371)

- **A finding I almost missed and why:** The PR reads as a clean test+doc ticket (a parity GATE, no
  behavior change), which biases toward "Wiring Audit clean, done." I almost stopped there. The real
  findings only surfaced by asking what the gate does NOT cover: it asserts array LENGTH + in-range
  INDEX but never element CONTENT — and `route.ts:320`'s `?? s.en` fallback does NOT fire on an
  empty string, so a hole at a valid index serves blank copy. A "gate" PR lulls you; always diff the
  gate's assertions against the runtime fallthroughs it claims to protect.
- **An axis/chain I had to trace twice:** The locale axis. First pass I read
  `variants: { en; pl?; es? }` in the type and assumed the gate's `en`-only scope matched a
  deliberate en-only design. Second pass through `route.ts:319-320` showed the variant branch
  HARDCODES `.en` regardless of session locale, so `variants.pl`/`variants.es` are a dead type
  surface (grep: zero populated). And the src-vs-dist axis: the vitest alias → `src` looked like
  "real source, good," until I checked `sdk/package.json` exports → prod loads `dist`. The gate
  validates a different artifact than production loads. Both required going one hop past the obvious
  read.
- **A meta-pattern in how gaps recur across agents:** "Gate ships, gate is trusted, gate is
  partial." Three of this retro's four follow-ups are _the gate not covering an axis it visually
  appears to cover_ (content vs length, en vs all-locales, src vs dist) — plus the gate has no
  committed negative-control proving it reds, unlike the repo's own Rule O (`--self-test`) and Rule
  V (dummy-token) exemplars. The recurring agent blind spot: authors prove the steady state is
  consistent and call the gate done, without proving the gate FIRES or enumerating every axis the
  asserted invariant should span (this is exactly the Rule S "every sibling/locale/arm" discipline
  applied to a CI gate's coverage rather than to a behavior change). Watch for a 2nd sighting of
  "structural gate validates `src` while prod loads `dist`" and of "gate with no committed
  negative-control" — both are count 1 today and would warrant promotion at count 2.

## 2026-06-26 · RETRO-133 (FOLLOW-404 / PR #372 — one-time prod attestation for CH migration 0019 page_context_source)

- **A finding I almost missed and why:** The PR is a doc-only attestation that reads "schema
  confirmed, grant confirmed, done" — and the zero-row `SELECT DISTINCT` is pre-explained in the PR
  body as "consistent with ESC-031," which is a very convincing hand-wave. I almost accepted it.
  What caught it: I checked the chartered AC text in FOLLOW_UPS.md:11159, which says AC-2 must
  return the EXPECTED VALUES "confirming the producer is writing it post-deploy." Zero rows confirms
  NOTHING about writes. Then I tested the ESC-031 explanation against its own facts: ESC-031 was an
  80-MINUTE window after which writes were restored — so an 80-minute outage cannot explain an
  ALL-TIME-EMPTY table. The explanation only covers the window, not the emptiness. The attestation
  closed the schema half and silently re-labeled the write half as closed. Lesson: when an
  attestation's result is an EMPTY/zero read, never let "consistent with a prior incident" stand in
  for "the thing we were chartered to verify" — map the result back to the literal AC and to the
  incident's actual time-bounds.

- **An axis/chain I had to trace twice:** The grant. First pass: `INSERT ON default.*` → "INSERT
  present, AC-3 satisfied, clean." Second pass (step-8 multi-axis): the grant has a SCOPE axis too —
  `default.*` is a wildcard, and `MASTER_DESIGN.md:44` documents the intended scope as
  `default.events`. So the same line that satisfies AC-3 also reveals (a) an over-broad security
  posture and (b) a design-doc divergence — and the wildcard is the ONLY reason the
  `adaptation_decisions` write is even legal under a doc that says `events`-only. One grant line,
  three findings, only visible on the second read.

- **A meta-pattern in how gaps recur across agents:** "Schema/CI/code leg closed, prod-EFFECT leg
  unverified, and the closure ticket quietly counts the unverified leg as done." This is the same
  family as RETRO-113 (seeder ran but prod archetype_embeddings stayed NULL) and RETRO-121 §7
  (migration applied per docs, prod-state not asserted) — Pattern C. The recurring agent blind spot:
  an attestation/seed/migration proves the STATIC half (column exists / grant exists / journal
  monotonic) and treats the DYNAMIC half (a row is actually written / a value is actually populated)
  as implied. The durable tell is an EMPTY result that gets narrated rather than flagged. This is
  now count ~3 across the prod-effect-unverified family but the SPECIFIC sub-shape "zero-row read
  recorded as write-verification" is count 1 — I held the rule and pre-registered the 2nd-sighting
  trigger in §6. Also reinforced RETRO-131's note that FOLLOW-404 "got more relevant, not less": it
  did — and it still didn't close the leg it was relevant to, because schema attestation and write
  attestation are different axes.

---

## 2026-06-28 · RETRO-135 (FOLLOW-425 / PR #374 — CH INSERT fail-loud in logDecisionAsync)

- **A finding I almost missed and why:** The PR is a _behaviour-only_ 2-file diff with no contract
  change — the kind that tempts a "Wiring Audit clean ✅, N/A everywhere" entry. The real value was
  OUTSIDE the diff: grepping `await fetch(` / `void …catch(` across `apps/control-plane` surfaced
  that FOLLOW-425 fixed **1 of 3** fire-and-forget HTTP sinks. The two Redpanda siblings
  (`publishAbAssignmentEvent`, `publishDescriptionRequested`) carry the byte-identical
  `res.ok`-blind hole. Lesson: when a PR fixes a _class_ of bug ("`.catch()` is blind to HTTP
  rejection"), the mandatory move is to grep the WHOLE app for the same shape — the fix is rarely
  complete across siblings (Rule S spirit), and the most useful retro finding is the un-fixed
  sibling, not the fixed diff.

- **An axis/chain I had to trace twice:** Whether the ClickHouse precedent (RETRO-118 §4 CB-1)
  legitimately counts toward the promotion threshold. First pass: "RETRO-118's headline was
  migration-ordering (Pattern A), so the `.catch`-silent-swallow was incidental — maybe count 1."
  Second pass: RETRO-118 explicitly named the `.catch`-only swallow as the _mechanism_ of the silent
  failure, and FOLLOW-425 is its direct remediation — so it IS a sighting of THIS pattern, in a
  DIFFERENT backend (CH HTTP) than RETRO-135's (Redpanda REST). 2 independent backend contexts →
  threshold met. Also had to re-verify the contrast: decision-api's `pushToRedpanda`
  (redpanda-producer.ts:102) DOES check `response.ok`, so this is a real control-plane↔decision-api
  divergence, not a repo-wide convention I was misreading.

- **A meta-pattern in how gaps recur across agents:** "Fix one sink, leave the siblings" keeps
  happening on the SILENT-FAILURE family (RETRO-085 summary-vs-lift, RETRO-117 producer-vs-consumer
  list, now RETRO-135 CH-vs-Redpanda). The durable fix is never the single-site patch — it's a
  grep-derived sweep across all siblings of the SAME shape. The promoted K.2 fire-and-forget
  amendment ships a verification grep specifically because the parent K.2 grep (`catch(() =>`) was
  itself blind to the bare-`await fetch()` / fire-and-forget-`.catch()` form — i.e. a RULE can have
  the same blind spot as the code it governs. Watch for rules whose verification command can't see
  their own newest sub-shape.

## 2026-06-28 · RETRO-137 (PR #376, FOLLOW-426 — harden the 2 control-plane Redpanda fire-and-forget publishers; STRENGTHENED Rule K.2 verification)

- **A finding I almost missed and why:** the SDK beacon `dispatchEvents`
  (`packages/sdk/src/core/events.ts:85`). FOLLOW-426 was the remediation of the family RETRO-135
  named, and the obvious completeness sweep is "grep `await fetch` in `apps/`" — which is _exactly_
  the scope of the Rule K.2 amendment's own verification grep. Running that grep would have greened
  cleanly and I'd have written "family closed." The catch: I deliberately re-ran the sweep over
  `apps/` **AND `packages/`**, because the rule I was about to cite only scans `apps/` — and the SDK
  browser beacon (a fire-and-forget ingest POST with no `res.ok` check, where a 401 silently drops
  every event even in debug) lives in `packages/`. The rule's own blind spot would have become my
  blind spot. Lesson banked into the rule itself: widened the verification scope + added an
  enumerated sink registry so the next analyst checks a list, not a re-derivation.
- **An axis/chain I had to trace twice:** the `async Promise<void>` → sync `void` signature flip.
  The first trace (production call sites) was clean — all three `void fn().catch()` chains correctly
  became bare `fn()` with the dead `.catch()` removed, both holdout AND treatment axes. But the
  signature change has a SECOND axis I nearly skipped: the **11 sibling test files** still mock the
  publisher with `.mockResolvedValue(undefined)` — modeling the dead async contract. Harmless today
  (return value unused) so I folded it (anti-inflation), but it's a fixture-lies twin set that would
  mask a future re-introduced `.catch()`. A return-type change has a test-fixture axis, not just a
  call-site axis.
- **A meta-pattern in how gaps recur across agents:** the "lateral hop, Nth consecutive time." This
  silent fire-and-forget family has now moved sideways across FOUR backends without ever closing
  (ClickHouse → Redpanda×2 → CH llm/dsr → Redis + SDK-beacon). Each retro closes the named sinks and
  the next retro finds the next backend's copy of the identical shape. The durable fix is NEVER
  another point-fix follow-up — it is the mechanical guard (registry + widened grep). When I see a
  3rd consecutive lateral residual in the same family, the highest-value output is hardening the
  _verification_, not just filing the next two stubs. Filed the stubs (FOLLOW-429/430) AND
  strengthened the rule — but the rule strengthening is the load-bearing half.

---

## 2026-06-29 · RETRO-138 (FOLLOW-431 / PR #379 — ESC-033, Vercel after() fire-and-forget flush)

- **A finding I almost missed and why:** I nearly accepted the PR's AC-1 ("no remaining un-awaited
  bare fetch sink in apps/control-plane/src") at face value because the PR was a tightly-scoped P1
  hotfix with green prod verification. A step-8 multi-axis grep (`void <sink>` / `void (async`) on
  the SAME app surfaced ≥5 OTHER request-path fire-and-forget sinks (seed-listing-embeddings,
  tenant-schema redisSet, two description-cache sinks, checkPilotFrozenAsync) with the identical
  drop hazard — none wrapped. Lesson: when a fix's AC contains an absolute ("no remaining X"),
  re-run the AC's own grep myself; a scoped hotfix almost always closes only the named instances.
- **An axis/chain I had to trace twice:** the FLUSH vs OBSERVABILITY axes of the fire-and-forget
  family. RETRO-135/137 declared the `.then(res.ok)→Sentry` fail-loud captures "real end-to-end
  closure" — but those captures are THEMSELVES post-response fire-and-forget and were being dropped
  on suspend. So the prior closures were code-correct but flush-incomplete; #379 is the missing hop.
  I had to re-trace to confirm this is a _completion_, not a _contradiction_ (RETRO-135/137 simply
  never analyzed the flush axis — ESC-033 was a later field escalation). The "gap" here moved
  UPSTREAM (the delivery mechanism of an already-correct producer), the inverse of the usual
  one-hop-downstream shape.
- **A meta-pattern in how gaps recur across agents:** "fire-and-forget after the response" is a
  runtime-specific contract (Vercel after() / CF-Worker waitUntil / browser sendBeacon), and every
  agent treats it as a portable idiom. The SAME family now spans observability (K.2 amendment) AND
  flush (this) AND durability (RETRO-137 no-retry) — three orthogonal preconditions on one idiom,
  each discovered in a separate retro. The flush axis is the precondition that makes the other two
  moot if absent. I held the flush pattern at count-1 (first retro sighting) per anti-inflation, but
  pre-registered the likely count-2 (FOLLOW-429 decision-api waitUntil gap) so the K.2 registry gets
  the flush requirement on the next sighting rather than a fresh rule letter.

---

- **Date / RETRO-139** (FOLLOW-432 / PR #381 — the sweep that was supposed to finish FOLLOW-431's
  over-claim)
- **A finding I almost missed and why:** the sweep ticket FOLLOW-432 carried the _same_ absolute AC
  as FOLLOW-431 ("no remaining un-awaited `void (async`/`void fetch` sink … verify by grep"), and it
  is tempting to trust a ticket whose explicit job was to be the completeness sweep. I almost took
  "this IS the sweep" at face value. Re-running the AC's own grep MYSELF (the RETRO-138 lesson)
  immediately surfaced 3 sinks neither RETRO-138 nor FOLLOW-432 enumerated — feedback/route.ts
  `updateArmAsync` + `upsertConversionLabelAsync` and dsr/erase `deleteSessionFromRedis`.
  Meta-lesson reinforced and SHARPENED: a "completeness sweep" ticket is exactly where an over-claim
  is most likely (the author believes the prior over-claim was the floor), so the grep-self-rerun is
  MANDATORY there, and RETRO-138's "≥5" was a floor not a count — I corrected it to ≥8.
- **The single most load-bearing catch:** `updateArmAsync` is the bandit-REWARD write. The whole
  RETRO-133/138/ESC-031 saga was about the PREDICTION write (adaptation*decisions). Nobody — not the
  escalation, not RETRO-138, not FOLLOW-432 — connected that the \_reward* half of the same bandit
  loop sits in a different route (feedback) with the identical bare-`void` drop hazard. The learning
  loop was half-secured and everyone thought it was done. Lesson: when a pipeline has a
  write-in/write-out shape (decision→reward, request→response, produce→consume), securing one end is
  a tell to go hunt the other end in a DIFFERENT file.
- **An axis/chain I had to trace twice:** the budget axis of the seed leg. FOLLOW-432's code comment
  asserted "real tenants exit early (no-op)" to justify `afterResponse()` over Modal — but the
  function's discovery-source #1 IS `schema.listing_ids` and its JSDoc says "100+ listings." Had to
  open seed-listing-embeddings.ts to confirm the comment's premise contradicts the function's own
  design → the RETRO-138 §4a #2 Modal caveat is NOT discharged. Lesson: a self-justifying code
  comment that asserts a budget/edge-case is safe must be checked against the called function's
  actual loop bound, not trusted.
- **A meta-pattern in how gaps recur across agents:** the COMPLETENESS-SWEEP OVER-CLAIM is now
  count-2 in occurrences (FOLLOW-431, FOLLOW-432) but it is the SAME remediation saga, so I HELD it
  (and held the FLUSH axis at count 1) rather than promote — RETRO-138 pre-designated the
  independent count-2 as the cross-runtime FOLLOW-429 waitUntil gap, which hasn't shipped, and
  promoting on one saga split across PRs is the premature-codification the threshold exists to
  prevent. BUT the durable fix doesn't need a rule: a human "verify by grep" AC failed twice, so I
  drove an _executing_ CI grep-guard into FOLLOW-433's AC. Lesson for myself: when a process pattern
  recurs but is the same instance, the right lever is often an enforced guard in the next FOLLOW,
  not a CONVENTIONS rule — the guard prevents recurrence without the count-inflation debt.

## 2026-07-01 · RETRO-145 (PR #403, FOLLOW-446 — un-blind the archetype-embeddings-not-null CI gate; PROMOTED Rule Q, INERT-GATE)

- **A finding I almost missed and why:** the promotion itself. The recent-5 retros (140–144) were a
  run of DELIBERATE non-promotions ("the guard is the enforcement", "count stays 1", saga-split), so
  my prior on any new pattern was "hold, don't promote." I nearly let INERT-GATE ride at "count 1
  (this retro)". The catch was NOT trusting the recent window: the task hint pointed at "gate
  silently stopped verifying", so I grepped the WHOLE file for the family and found RETRO-006
  §Pattern C ("test exists but is opt-in behind a flag CI never sets") AND RETRO-007 §4b CB-1
  ("soft-skip inception — structurally present but never actually runs"). Two genuine PRIOR
  sightings — and RETRO-006 had _pre-authorized_ promotion on a 2nd sighting. Lesson: a string of
  recent non-promotions is not evidence the next one should be held; count against the FULL history,
  not the window I just read.
- **An axis/chain I had to trace twice:** the closure axis vs the residual axis. It was tempting to
  record FOLLOW-446 as "closed — gate now green in 41s." But the PR closes only the EXECUTION axis
  (assertion now runs); the FAILURE-VISIBILITY axis (continue-on-error swallows all failures) is
  still open and is the explicitly-deferred part of FOLLOW-446. I traced build→resolve→execute→
  assert→exit to confirm the execution fix is end-to-end (not one-hop), then separately confirmed
  the visibility residual is a distinct named axis, not a downstream hop. Two axes, one ticket —
  record both or mis-credit the fix.
- **A meta-pattern in how gaps recur across agents:** "a soft-skip / continue-on-error is written to
  handle ONE benign condition (missing dev token) and silently grows into a universal failure
  swallower." RETRO-007's demo-integration gate and RETRO-145's archetype gate are the same shape,
  two years/sprints apart, in different subsystems — the soft-skip is the reusable footgun. And the
  discovery vector is always external: nobody notices an inert gate from the gate itself; it
  surfaces only when someone independently exercises the invariant (here, FOLLOW-392 validation).
  The retro-analyst is often that external exerciser — so when a PR "fixes a gate", my default
  question is now "was this gate EVER proven to run its assertion, or only proven to be green?"

---

## 2026-07-01 · RETRO-146 (FOLLOW-442, PR #406 — holdout logDecisionAsync)

- **A finding I almost missed and why:** the fix looked trivially correct (mirror the treatment
  arm), so the temptation was to stamp it clean. The real value was in the SIBLING-ARM audit: the
  POST handler has THREE early-return arms (opt-out, consent-skip, holdout), and I had to prove that
  omitting logDecisionAsync on opt-out/consent-skip is BY DESIGN (route.ts:398) while omitting it on
  holdout was the bug. Without that reconciliation I'd have either flagged the two by-design arms as
  false gaps or missed why only holdout mattered. The general reflex: when a fix adds a side-effect
  to ONE branch, enumerate ALL sibling branches and classify each as by-design-absent vs bug-absent.
- **An axis/chain I had to trace twice:** the GET-vs-POST handler axis. GET was never broken
  (unified logging call at :943 passes holdoutGroup as a variable, so both arms log); POST used a
  SEPARATE early-return branch that skipped logging. Analyzing only the "cleaner" handler (GET)
  would have concluded no bug. I had to trace the holdout_group=1 producer set on BOTH handlers to
  see the POST producer was the sole gap — an in-practice half-wire (consumer cta-lift present, POST
  producer absent) even though CHECK-B is technically clean (GET produces the same value).
- **A meta-pattern in how gaps recur across agents:** the adaptation_decisions table is a recurring
  silent-write magnet, but each recurrence has a DIFFERENT mechanism — ESC-031/033 was a flush drop
  (all arms), RETRO-132 was an arm MISLABEL (wrong value), RETRO-146 is an arm OMISSION (missing
  write on one branch). Same table, same "silent analytics corruption" outcome, three distinct root
  causes. Do NOT collapse them into one count — but DO treat "any handler that writes to a measured
  telemetry table" as a standing audit target for arm-symmetry.
- **My OWN blind spot (process, count 1):** I nearly under-weighted the stalled-worker /
  uncommitted- on-main / never-ran-checkout-b episode as "recovered fine, move on." It was a
  near-miss on silent cross-ticket contamination (a later branch-from-main would absorb the stranded
  diff). The prompt forced a dedicated section; my default should include a process-hygiene axis
  whenever the PR's provenance (not just its diff) reveals a workflow footgun. Filed FOLLOW-448;
  held at count 1 (no prior corpus instance — grepped checkout-b/uncommitted/wrong-branch/stalled →
  none). If a second stranded-work-on-main episode appears, promote a branch-first Rule.

## 2026-07-06 · RETRO-162 (FOLLOW-465 — negative-cache NEUTRAL verdicts, audit F-18)

- **A finding I almost missed and why:** the P1 was NOT in the diff — it was in the INTERACTION
  between the diff and an ADJACENT open ticket (FOLLOW-464). The PR's Redis key comment says
  `:{model}` and its tests pass, so on the diff alone the negative cache looks model-correct. The
  bug only appears when you trace WHICH read fires FIRST: Postgres Step-1 (`getPgCachedDescription`,
  no model filter — the open FOLLOW-464 bug) returns the NEUTRAL row BEFORE the model-scoped Redis
  Step-2 is ever consulted. A negative cache AMPLIFIES a pre-existing cache-key-scoping bug from a
  quality bug (serve wrong-model description) into a correctness bug (suppress re-generation across
  models + break the demo switcher). Lesson: when a PR ADDS a cache/short-circuit, always trace the
  FULL read-precedence order and check the FIRST hop's key scoping against the write key — and
  ALWAYS read the deferred sibling ticket the PR names, because "we shipped X over Y" often means X
  now depends on Y's bug.
- **An axis/chain I had to trace twice:** the model axis. First pass I accepted "Redis key includes
  model ⇒ model-scoped." Second pass (reading route.ts:305 vs :365) showed Step-1 PG precedes and
  ignores model — reversing the verdict. Also the demo axis: `getPgCachedDescription` takes the same
  4 args regardless of `demoActive`, so a non-demo NEUTRAL defeats a DEMO override_model preview —
  only visible by reading the arg list, not the happy-path test.
- **A meta-pattern in how gaps recur across agents:** the FOLLOW-097→141 sentinel-render class
  showed up AGAIN — a new marker row (verdict='NEUTRAL', description='') handled by the hot read but
  NOT by the secondary table reader (`listPgDescriptionCache`). Caught it ONE HOP EARLY this time
  (the render consumer isn't built yet — listPgDescriptionCache is currently dead). The grep
  discipline "who ELSE reads this table/key?" is what surfaces these; the diff never shows the
  unwired reader.
- **My OWN blind spot (process, count 2 — arming a Rule):** the crash-before-commit near-loss is the
  SECOND provenance-footgun episode I've logged (RETRO-146 was stranded-work-on-main; this is
  work-lost-to-crash-because-never-committed). Different mechanism, same class: "the PR's
  provenance, not its diff, reveals a workflow footgun." Filed FOLLOW-527 (periodic WIP autosave in
  worktrees). Still distinct enough from RETRO-146's branch-first issue that I held both at count 1
  of their own sub-shapes — but "worktree/commit-hygiene footguns" is now a standing provenance axis
  I check on every retro regardless of the diff.
- **Rule-promotion restraint I'm proud of:** the "log is not observability" family is at ≥2 prior
  numbered retros (156/159/160/161) and I had a fresh sighting (DG-1, cache-effectiveness metric) —
  but those retros DELIBERATELY held it as heterogeneous with a per-surface follow-up as the
  vehicle. Promoting would contradict the corpus's own accumulated reasoning. Held; filed FOLLOW-526
  instead. Consistency with prior held-verdicts > count-mechanical promotion.

## 2026-07-08 · RETRO-163 (FOLLOW-464 — model-key the Postgres description cache read)

- **A finding I almost missed and why:** the PR's diff is entirely on the READ leg
  (`getPgCachedDescription` WHERE gains `eq(model)`) and it is CORRECT — every test passes, F-15's
  stale-read is genuinely closed. A read-leg-only review would have declared closure. The
  load-bearing catch (LG-1) lives in two files the PR NEVER TOUCHED: the pre-insert invalidation
  (`insertPgCachedDescriptionStrict`, model-blind WHERE) and the partial UNIQUE INDEX from migration
  0023 (`(tenant,listing,archetype,locale)`, no `model`). The DB constraint physically forbids two
  active model rows per 4-tuple — so the read's new `model` filter can never observe more than one
  row. The gap moved ONE HOP from the read the PR fixed to the store's active-row key. Lesson that's
  now a standing check: **when a PR adds a scoping dimension to a cache READ, immediately open the
  store's WRITE-side invalidation AND its unique/uniqueness constraint — a read key more specific
  than the store's active-row key is inert for caching.** Read the migration, not just the diff.
- **An axis/chain I had to trace twice:** the demo axis. First pass I credited FOLLOW-464 with
  closing the DEMO-switcher (it threads `override_model`). Second pass, chasing "does demo persist
  to Postgres?", I found `_write_to_postgres_cache` posts NO demo flag while the Redis key
  namespaces demo via `:demo:` — so an equal-model demo/prod Postgres collision survives (LG-2). The
  Redis namespace lulled me; Postgres has a different, coarser key. Always check each store's key
  INDEPENDENTLY — two caches for the "same" value can key differently.
- **A meta-pattern in how gaps recur across agents:** the read/write-key asymmetry is a fresh
  instance of the ALREADY-PROMOTED Rule S (symmetric-sibling-set). I resisted minting a new rule and
  instead cited Rule S — and noted a Rule-S review of FOLLOW-464's read/write sibling set WOULD have
  caught it. The learning loop is working when an existing rule already names the class; the job is
  to APPLY it, not re-coin it. Same restraint on the stale-turbo-cache-defeats-reverification
  finding (Rule Q/T family, count-1 on the local-cache surface → checklist amendment FOLLOW-530, not
  prose).
- **Rule-promotion restraint (continuing the corpus's posture):** the stalled-worker recovered-work
  family is now ≥4 sightings (RETRO-146/150/162/163) — arithmetically past threshold — but
  RETRO-146/150 deliberately vehicled it as an EXECUTABLE checklist (FOLLOW-448 →
  AGENT_WORKFLOW.md), that checklist now EXISTS and was FOLLOWED cleanly here, and RETRO-162 filed
  FOLLOW-527 for the residual crash-loss window. Promoting a prose rule would duplicate a working
  checklist and contradict the accumulated RETRO-146/150 reasoning. The sharp NEW increment this
  episode adds — the re-verification itself can be defeated by a stale turbo cache — I captured as a
  targeted checklist amendment (FOLLOW-530), the one edge step 3 was missing. Count-past-threshold
  does NOT override a corpus's deliberate vehicle choice.

---

## 2026-07-08 · RETRO-164 (FOLLOW-473 — fail-closed two-step auth on GET /api/adapt + description)

- **A finding I almost missed and why:** the cross-consumer grep (step 2) is what caught the
  load-bearing finding, NOT the diff. The PR diff is clean and correct for its stated scope (the two
  control-plane GET routes). Had I retro'd only the diff, I'd have recorded a clean sweep. Grepping
  every `ADAPT_API_KEY` consumer across ALL apps surfaced that the `estalara-decision-api` Worker's
  `POST /api/adapt` sibling enforces NO inbound auth at all and its `ADAPT_API_KEY` env var is a
  declared-but-never-consumed phantom — the fail-open CLASS hopped one app over (SIBLING-NOT-SWEPT).
  Lesson reinforced: for any auth/secret hardening, the mandatory move is
  `grep <symbol> across ALL apps` — the gap loves to sit in a sibling app the ticket's scope didn't
  name. Then bound the blast radius BEFORE assigning severity (checked deploy-staging.yml =
  staging-only, and the SDK endpoint = control-plane not the Worker → P2 not P0). Severity without
  the deploy/target check would have been wrong in either direction.
- **An axis/chain I had to trace twice:** the "thinner-helper" design axis. First pass I saw both
  call sites wrap `resolveAdaptGetAuth` in an identical try/catch→Sentry→401 and called it
  symmetric. Second pass, asking "what ENFORCES that symmetry?", I found the fail-loud DB-throw
  contract lives OUTSIDE the shared helper as a docstring "MUST" with no test/lint pin — so the
  helper does NOT guarantee both routes fail-loud symmetrically; a future edit to one catch would
  silently 500 that route only. The discarded fork (fatter, owned the try/catch) would have made
  this structurally impossible. "Currently identical" is not "cannot drift" — always ask what pins a
  symmetry, not just whether it holds today (TG-1 → FOLLOW-532).
- **A meta-pattern in how gaps recur across agents:** two families collided this episode and both
  correctly resolved to HOLD/no-new-rule, for DIFFERENT reasons — worth keeping distinct. (1) The
  SIBLING-NOT-SWEPT code pattern is count-2-across-retros but only 1 PRIOR (RETRO-153), so the
  algorithm's ≥2-PRIOR bar genuinely isn't met — a numeric hold. (2) The stalled-worker
  recovered-work PROCESS family is now 5 sightings (RETRO-146/150/162/163 + this) — arithmetically
  way past threshold — but the corpus deliberately vehicles it as an executable checklist, so the
  hold is a VEHICLE-CHOICE hold, not a numeric one. The new wrinkle here (TWO divergent uncommitted
  worktrees, a silent duplicate) is a genuinely new sub-shape the checklist didn't cover → I filed a
  checklist amendment (FOLLOW-534), same vehicle as FOLLOW-530, NOT a prose rule. Meta-lesson: when
  deciding to promote, name WHICH kind of hold applies — "not enough priors" vs "the corpus already
  chose a better vehicle" — they look identical on the counter but reason differently, and
  conflating them would eventually mis-promote.

- **2026-07-08 / RETRO-165 (FOLLOW-463 — verified_facts_used → description_generations CH audit
  trail)** · **A finding I almost missed:** the retention/TTL gap. The escalation, the PR body, and
  the parent brief all pulled attention to the GRANT blocker (already filed) and the DSR question
  (the parent's headlined "high-value finding"). The genuinely NEW load-bearing gap was quieter:
  migration 0007 ships NO `TTL`, and the whole reason it never mattered is that the table had zero
  writers — the exact fact this PR changes. The meta-move: when a PR "adds the first writer to a
  pre-existing table," re-read the CREATE TABLE for everything that was inert-because-unwritten
  (TTL, RLS-equivalent, partitioning, dedup) — those become live the instant a writer lands. · **An
  axis I had to trace twice:** the DSR/erasure axis. The parent framed it as a probable Art.17
  obligation ("high-value finding"). First pass I nearly wrote it up as a gap; second pass I
  actually read the row columns + `clickhouse-dsr.ts:44` and found NO session/user key ⇒ non-PII ⇒
  DSR-exempt ⇒ the existing exclusion is correct. The valuable output was the RECONCILIATION
  (analyzed-and- cleared with evidence) PLUS the tripwire (add session*id ⇒ instantly an erase
  target) PLUS catching that `AUDIT_RISK_MATRIX#3` already contradicts `clickhouse-dsr.ts`. Lesson:
  a parent's "this is probably a big finding" is a hypothesis to TEST, not a conclusion to
  transcribe — and "clean, here's why" can be more valuable than a false-positive ticket. · **A
  meta-pattern in how gaps recur across agents:** the "inert-until-provisioned" family keeps
  mutating one hop outward — RETRO-152 (Modal flag), RETRO-156 (Modal secret never provisioned),
  RETRO-159 (Cloudflare queue not created), and now RETRO-165 (CH grant DELIBERATELY narrowed away
  then re-needed). Rule AA already governs the STATUS discipline for all of them. The NEW sub-shape
  here — a prior \_deliberate scope-narrowing* invalidated by a later writer — is distinct from
  "never provisioned" and from RETRO-021 "missing seed"; I held it at count 1 (no prior numbered
  retro matches) rather than inflate the counter by lumping it with the never-provisioned cases.
  Meta-lesson: resist merging superficially-similar operator-pending shapes into one count —
  "removed then re-needed" reasons differently from "never existed," and conflating them would
  mis-promote. Named the exact count-2 trigger to watch.

- **2026-07-08 / RETRO-166 (FOLLOW-461 — register 6 `adapt.description.*` event types; audit F-04
  ingest-drop)** · **A finding I almost missed and why:** the parent HEADLINED the accept-but-no-
  consumer gap as "likely the key finding" and explicitly primed me to classify it HALF_WIRE by
  analogy to RETRO-165 FOLLOW-536. First pass I nearly transcribed that verdict. Second pass I
  traced where an accepted event actually GOES — `pushToClickHouse` → the canonical `events` table —
  and read its readers (`session_summary_mv` fires on every INSERT, `clickhouse-dsr.ts` erases by
  session, type-filtered analytics whitelist other types). The honest call is NOT a strict
  HALF_WIRE_P: the wire connects to a heavily-read, TTL-bounded, DSR-covered sink. The RIGHT finding
  was the SOFTER one — no purpose-built reader realizes the RATE the observability goal implied —
  filed P3, not P1. Meta-move confirmed again (same as RETRO-165's DSR axis): a parent's "this is
  the key finding, it's a HALF_WIRE" is a hypothesis to TEST by tracing the sink, not a verdict to
  transcribe. The discriminating variable turned out to be the SINK TYPE (dedicated-zero-reader
  table vs canonical-generically-read table) — I made that the explicit reconciliation so the two
  retros don't read as contradictory. · **An axis/chain I had to trace twice:** payload fidelity. I
  verified all 6 emit sites by hand against the Zod schemas (clean), THEN almost filed a "no test
  cross-validates emit-vs-schema" coverage gap — until I actually opened the SDK test and found a
  REAL-emit-path round-trip (`adapt-description.test.ts:889` captures from the emit paths and
  `safeParse`s against the shared `EventSchema`). The would-be gap was already closed, and better
  than I'd have asked (real emit path, not a hand-built fixture). Lesson: before filing a
  coverage-gap ticket, open the test file — the guard the parent's framing implies is missing may
  already exist. · **A meta-pattern in how gaps recur across agents:** the DEFINED-VS-PRODUCIBLE
  contract rots in BOTH directions and CI catches NEITHER — F-04 was produced-but-unregistered
  (silent ingest reject), and the 23 "reserved" types are registered-but-unproduced. Rule I only
  guards exported-symbol importers, so a type-literal-vs-producer mismatch is invisible until a
  manual audit rediscovers it (exactly how F-04 surfaced). That's a genuine blind spot in the
  wiring-audit toolchain, not just this ticket — filed FOLLOW-540 to formalize the reserved category
  - a Rule-H carve-out. Watch: if a 3rd "registered/accepted-but-no-realized-consumer" or a 2nd
    "produced-but-unregistered" surfaces, the reserved-list-plus-carve-out may deserve promotion to
    a Rule-H amendment rather than staying a per-ticket follow-up. · **Rule-count discipline held:**
    the accepted-but-no-reader shape is 2nd sighting but 1 PRIOR (RETRO-165) — HELD, and I named
    BOTH hold reasons (count AND vehicle-is-a-follow-up), per my own RETRO-165 note to distinguish
    "not enough priors" from "corpus already chose a better vehicle." No rule promoted.

- **2026-07-09 / RETRO-167 (FOLLOW-535 — 13-month TTL on `description_generations`)**
  - **A finding I almost missed and why:** the LOAD-BEARING finding here is not the TTL itself
    (clean, idempotent, well-tested) but the OPERATOR-SEQUENCING coupling — migration 0020's TTL and
    FOLLOW-463's `GRANT INSERT` are two DDL actions in the SAME prod CH-admin session, and a
    grant-FIRST apply reopens the exact unbounded-growth gap FOLLOW-535 closes. I nearly filed this
    as a routine Rule-AA operator-pending case and moved on; the second look was realizing Rule AA
    covers ONE leg's status, not the ORDERING of two coupled legs, and that the "bundle them"
    mitigation lives only in ephemeral PR/QUEUE prose, not the durable runbook. That is a genuinely
    new sub-shape (COUPLED-OPERATOR-LEGS, held at count 1).
  - **An axis/chain I had to trace twice:** the parent's explicit question — "does any consumer
    assume the TTL is active?" I first reasoned about correctness risk abstractly, then re-grepped
    and realized `description_generations` has ZERO in-repo consumers (write-only, FOLLOW-536) —
    which is exactly what BOUNDS the risk to operational-growth-only, no correctness exposure. The
    write-only property (a RETRO-165 negative) became the reconciling evidence for RETRO-167's
    parent question. Also had to trace the table-EXISTENCE dependency (0020 ALTER needs 0007 applied
    in prod) that the local golden test masks by applying both to a fresh container — a
    CI-green-hides-a-prod-precondition trap.
  - **A meta-pattern in how gaps recur across agents:** the ClickHouse-doesn't-auto-apply reality
    (Rule M) keeps generating operator-pending tails that CI cannot see, and each one tempts a
    "code-green ⇒ done" read — here it even leaked into a DATA_DICTIONARY Status column ("Enforced
    (0020)" when prod is unapplied). The durable fix is always a runbook/doc that splits code-axis
    from prod-axis; the ephemeral PR-body mitigation is where these gaps hide. Watch for a 2nd
    COUPLED-OPERATOR-LEGS sighting to promote past Rule AA.

## 2026-07-09 · RETRO-168 (PR #488, FOLLOW-470 — truth-reconciliation of the ~5-week-stale SoT §Snapshot.1; docs-only; NO rule promoted)

- **A finding I almost missed and why:** the load-bearing finding (DG-1) was NOT in any code and NOT
  in the reconciled table — it was in the reconciliation doc's OWN Changelog v4.3, which durably
  states CLAUDE.md was "flagged not edited" while the same PR edited it. On a docs-only ticket the
  reflex is to spot-check the reconciled CLAIMS against HEAD (which I did — all 5 matched exactly)
  and call it clean. The defect was one meta-level up: the changelog's self-description of what the
  PR did contradicted the diff. Lesson: on a truth-reconciliation ticket, verify the changelog
  against the diff, not just the reconciled facts against the code — the doc can be right about the
  world and wrong about itself.
- **An axis/chain I had to trace twice:** the freshness axis WITHIN the one document. First read:
  "§Snapshot.1 refreshed ⇒ SoT accurate." Second read: the header still says 2026-05-24 and
  §Snapshot.2/.3/.5 still cite `archetype-pipeline`/`adaptation-engine` apps that `ls apps/` proves
  gone — so the doc is at MIXED freshness under one date, which is worse than uniform staleness
  because a future session can't tell which axis to trust. A partial reconciliation is a distinct
  hazard class from a stale one.
- **A meta-pattern in how gaps recur across agents:** the SoT-drift the retro loop exists to prevent
  recurred INSIDE the very ticket that fixes it — a plan-vs-executed divergence (architect planned
  to flag; orchestrator edited) got caught in the TRANSIENT QUEUE note but leaked, permanent, into
  the DURABLE changelog. Root cause was an agent-tooling-capability gap (architect has no Bash tool,
  so the orchestrator became a silent second author). This is the same shape as the verify-not-trust
  family (OP5 / RETRO-149/150/164) but one level deeper: the self-report doesn't just need
  re-verifying at handoff — it can live on WRONG in the SoT forever unless someone reconciles the
  deviation across the durable artifacts, not just the queue. Held all 3 candidates at count-1 (no
  ≥2 bar); filed FOLLOW-544 (fix the changelog) + FOLLOW-545 (close the bashless-agent author-blur).

## 2026-07-10 · RETRO-171 (FOLLOW-548 — 3rd/final hop of the async-interleave class)

- **A finding I almost missed and why:** I nearly recorded the headline RESTORE at
  `index.ts:1126-1132` as a possible 4th hop because it's a `textContent` write reachable from a nav
  event. It is NOT in-class: it runs SYNCHRONOUSLY inside the `navMutObs` callback and writes the
  NEW listing's OWN captured original (teardown-ordered), never a stale archetype's adapted copy.
  Lesson: "is it a DOM write reachable from a nav?" is the wrong filter — the class filter is "is it
  a DEFERRED write that could paint a SUPERSEDED archetype's ADAPTED copy onto a newer listing?"
  Synchronous own-original restores fail that test. I confirmed the distinction by tracing
  capture→teardown→restore→guarded-refresh ordering, not by pattern-matching the write primitive.
- **An axis/chain I had to trace twice:** the eager-argument-evaluation point. RETRO-170 (and the
  stub) cited `:323`/`:333` `requestAnimationFrame(applyAndObserveSlot(...))` as the deferred write;
  I had to re-derive that `f(g())` evaluates `g()` synchronously BEFORE the rAF schedules `f`, so
  the real deferred write is the `reapply` closure re-invoked via the observer's OWN internal rAF —
  a different indirection entirely. The principle (guard the deferred write) was right in the source
  retro; only the line pointer was off by one indirection. Verify the ACTUAL mutation instant, never
  the scheduler expression that looks deferred.
- **A meta-pattern in how gaps recur across agents:** serial single-hop relocation
  (RETRO-105→169→170→171, mirroring FOLLOW-097→114→127→141). Each fix genuinely closed its named
  window but left the guard one continuation too early relative to the true mutation instant. The
  termination signal this time: an EXHAUSTIVE deferred-primitive grep + per-writer
  in-class/out-of-class adjudication returned NEGATIVE for a next hop, AND the fix made the guard
  param REQUIRED (compiler-enforced) so a future caller can't silently re-open it. A class is only
  safely declarable "closed" when BOTH the current instant is guarded AND the footgun that would
  re-open it is structurally removed.
- **My own blind-spot watch:** I banked the citation-precision meta at count 1 and REFUSED to
  promote (the imprecise `:323`/`:333` citation appears 3x but all within ONE retro's analysis = one
  episode, not ≥2 independent). Resisting the temptation to inflate a single-episode observation
  into a rule is the same discipline Rule AB/AA/V enforce on the count. Pre-authorized a 3rd
  INDEPENDENT-subsystem sighting as the real trigger.

---

## 2026-07-10 / RETRO-172 (FOLLOW-532 — fold DB-throw parity into resolveAdaptGetAuth)

- **A finding I almost missed and why:** I nearly wrote off angle (a) as "under-observability
  regression" at face value. The trap: the brief framed `dbError` as "now invisible to production
  branching — only Sentry `tags.kind` remains observable," which READS like a loss. The verify step
  (diffing the two DELETED per-route catch blocks against the folded helper block) showed the Sentry
  capture is byte-identical — same `tags.area`, same `tags.kind`, same `console.error` prefix — so
  the discriminant is a NET-NEW test-only capability, not a lost one. Lesson: when a brief phrases a
  change as a loss, diff the before/after emission sites literally before agreeing; "invisible to
  production branching" is only a regression if production EVER branched on it (it never did — no
  in-repo alert config reads `tags.kind` anywhere, confirmed by grep).
- **An axis/chain I had to trace twice:** the one-hop closure check (§7). First pass said "seam
  closed, done." Second pass forced the question the async-interleave family (RETRO-169/170/171)
  trained me to ask — "did the fix RELOCATE the gap?" — and yes, it did introduce a thin new
  obligation (the per-call-site `area` literal, unpinned by any test). The nuance I had to get
  right: it is NOT the SAME class relocating at equal severity (that would be the RETRO-105 failure
  mode); the severity DROPPED from P2-correctness (silent 500 on DB outage) to P3-cosmetic (Sentry
  tag mislabel). Naming that severity-drop explicitly (rather than either "fully closed" or
  "relocated one hop") is the honest verdict → FOLLOW-549.
- **A meta-pattern in how gaps recur across agents:** the "fold the obligation into the shared
  helper so drift is impossible-by-construction" move (FOLLOW-532) is the CODE-level twin of the
  process family's "an executable guard/checklist beats a prose rule" (RETRO-146/150/163/164). Same
  underlying principle — structural impossibility beats after-the-fact detection — surfacing in a
  new domain (a TS helper). I deliberately did NOT let that kinship inflate the count: the process
  family cannot lend its ≥2 count to a fresh code-domain pattern. HELD at count 1 with a
  2nd-code-sighting trigger. This is the recurring temptation I keep having to resist (cf. RETRO-171
  note): a strong ANALOGY to an existing promoted rule is not a second OCCURRENCE of the new
  pattern.
- **On the fold being the right call:** the source stub (FOLLOW-532) co-assigned qa-engineer and
  offered option-1 (parity-test-only) OR option-2 (fold). The worker dropped qa and chose option-2.
  I independently judged this SOUND — the change is entirely within backend-engineer's two route
  files + one lib (no QA harness surface), and option-2 is strictly stronger than option-1
  (construction vs detection). Recording that I checked the override rather than rubber-stamping it.

## 2026-07-10 · RETRO-173 (FOLLOW-549 — area-literal pin, test/docs-only fast-follow off RETRO-172)

- **A finding I almost missed and why:** the CODE is trivially clean (2 test assertions + 1
  docstring, zero prod logic) — the temptation was to write a 3-line "clean, closes TG-1/DG-1" retro
  and move on. The actual load-bearing finding was entirely in the PROCESS: a 1h ticket spawned 3
  PRs (#504/#505/#506) and #506 died on a QUEUE.md conflict because the redundant dispatch-record
  #504 was MERGED, not closed-superseded. The brief flagged it, but the lesson for me is that a
  test/docs-only diff does NOT mean a low-signal retro — the signal migrated from the code axis to
  the process axis. Always ask "what happened AROUND this merge," not just "what's in the diff."
- **An axis/chain I had to trace twice — the occurrence count:** the two-PRs-in-flight shape
  recurred ~4x THIS session (#490/#492, #494/#496, #498/#500, #504/#506), which FELT like an obvious
  ≥2 → promote. I had to stop and separate (a) raw in-session recurrence at the PM/QUEUE -notes
  level from (b) documentation as a finding in ≥2 PRIOR NUMBERED retros. Only (b) counts for
  RULE_PROMOTION_THRESHOLD. Grepped RETROSPECTIVES for #490/#494/#498/#506 + "two PR"/"conflict"/
  "cut before": the only prior hits were RETRO-067/117's code-DIFF-bundling notes — a RELATED but
  DISTINCT phenomenon (diff attribution, not QUEUE.md bookkeeping-PR conflict). So this is count 1
  as a numbered-retro finding → HELD/ARMED, not promoted. Same discipline as RETRO-158/153. The
  in-session count is a trap that inflates the promotion count if you don't gate on "numbered
  retro."
- **The distinct-sub-mode distinction:** three of the four in-session occurrences resolved cleanly
  (stale PR CLOSED); only #504/#506 is the merged-not-closed → downstream-conflict sub-mode. Naming
  the sub-mode (not just "another two-PR case") is what made the a/b/c verdict crisp and kept me
  from either over-counting (calling it the 4th of a class) or under-counting (calling it a
  one-off).
- **A meta-pattern in how gaps recur across agents:** the PM's fragile default ("merge OR close —
  either is safe") is the SAME shape as the async-interleave code arc's own lesson
  (RETRO-169/170/171: "a single checkpoint / one of two sanctioned paths is insufficient — the safe
  path must be mandatory, not optional"). Process defects and concurrency defects rhyme: presenting
  a risky option as co-equal-safe is the process analog of guarding only the first await boundary.
  Worth watching whether other close-out conventions carry the same "either order is safe" framing.

- **Date / RETRO-174** (FOLLOW-550 — codify bookkeeping-PR sequencing into docs/AGENT_WORKFLOW.md;
  the META-ticket RETRO-173 §9 spun out).
  - **A finding I almost missed and why (DG-1):** the naive read of a docs-codification ticket is
    "is the new section CORRECT?" — and it was, so I nearly wrote a clean §3/§4 and moved on. The
    real gap only surfaced when I ran the wiring-audit analog on a DOC convention: producer (new
    §Bookkeeping-PR sequencing at :163) exists, but I forced myself to ask "who is ROUTED to it?"
    Grepping for inbound cross-references + reading the pre-existing recovery playbook
    (`### "Two PRs conflict on the same files"` :350) revealed it (i) never links to :163 and (ii)
    says "Close the later PR" — which is exactly BACKWARDS for the bookkeeping sub-case rule (a)
    governs (the LATER validation PR #506 was the casualty; the EARLIER #504 should have been
    closed). The gap relocated one hop (RETRO-173 "convention ambiguous" → RETRO-174 "convention
    unambiguous but un-wired + locally contradicted"). LESSON: for a docs/convention ticket, CHECK
    A/B means "does the new convention have an inbound consumer entry point, and does that entry
    point AGREE with it?" — not just "is the prose right?" Analyzing only the producer axis would
    have missed it.
  - **An axis/chain I had to trace twice:** rule (d)'s dogfooding. First pass I wrote "FOLLOW-550
    obeyed rule (d)." Second pass I checked #508's actual commits and saw the validation was folded
    into the PROMOTION PR (#508 commit 2e2a486), not the DONE+RETRO bundle rule (d) literally names.
    Had to re-classify from "clean" to "harmless generalization of (d)'s spirit" (DG-2, folded) — a
    reminder to verify the ACTUAL PR/commit shape against the rule's LETTER, not just its intent,
    before grading a self-dogfooding meta-ticket.
  - **A meta-pattern in how gaps recur across agents:** convention/doc gaps rhyme with concurrency
    gaps in the SAME way RETRO-169/170/171's async arc did — a safeguard (guard, or convention) is
    only effective where the actor actually ARRIVES. The async arc: guard must sit at the last sync
    instant before EVERY deferred write. The doc arc: the convention must sit at (or link from) the
    recovery/close-out section a PM actually reads mid-incident, not 187 lines up under its own
    heading. Both failure modes are "correct-but-not-where-it's-needed." Watch for this whenever a
    fix/convention is ADDED rather than wired into the existing hot path.
  - **On the ARMED trigger (angle c) — the trap I avoided:** it was tempting to treat "FOLLOW-550
    codified the pattern" as movement toward promotion. It is NOT — codifying guidance is not a NEW
    SIGHTING of the runtime pattern recurring. I independently verified FOLLOW-550's own lifecycle
    was clean (no merged-not-closed bookkeeping PR) before affirming count stays 1. A clean fix / a
    codification landing is not a bug sighting — same discipline as RETRO-170's "a clean fix is not
    a 3rd sighting" note on Rule AB.

## 2026-07-15 — RETRO-175 (FOLLOW-557, PR #528, DSR erase → shadow Redis key)

**A finding I almost missed and why.** The headline (§5a) was invisible from inside the ticket. PR
#528 is a clean, correct, well-tested fix; reading it against its own AC yields a clean retro. The
gap only exists in the **3-second gap between two merge commits**: #528 added a Redis store to the
Art. 17 erase set, and #529 (merged 3s later) asserts access-set == erase-set but scopes that
invariant to Postgres. Both authors were right; nobody owned the union. **Lesson: when two PRs merge
in the same window, diff them against EACH OTHER, not just each against `main`.**
`git log --oneline` adjacency is a cascade signal in its own right — I should read the sibling
merge's test invariants before writing any §5. Near-miss: I nearly recorded §4d "DPIA correctly not
updated (erase ≠ disclosure)" as a clean note — that framing is exactly the trap that produced the
bug.

**An axis/chain I had to trace twice.** Two. (1) The `session:*` SCAN. First pass I read it as
pre-existing background. Second pass — grepping for the namespace's PRODUCER rather than its
consumers — returned six hits, all inside the erase route itself, **not one a write**. That reframed
the whole retro: the audit finding's root isn't a forgotten namespace, it's that the erase path was
written against an ASSUMED namespace list (the leg that existed matched nothing; the leg that
mattered was absent), and it made LG-1 land — the phantom leg can THROW and veto the real one.
**Always grep the producer, not just the consumers, of any namespace/key/topic a diff touches.** (2)
The Rule Z regex. First pass: "regex-parsing another runtime's source is fragile" — the obvious
take, and mostly wrong. The regex is fine and beats hand-typing. Tracing it twice found the real
issue one layer down (the file is outside the package → turbo doesn't hash it → remote cache replays
the assertion green on the drift commit) AND the honest mitigation (the shared `shadowChatIntentKey`
builder means the live FOLLOW-368 smoke already covers it transitively — so P3, not P1). **Both
passes were load-bearing: the second found the real mechanism, the third found why it barely
matters.** Severity honesty is part of the finding, not a softening of it.

**A meta-pattern in how gaps recur across agents.** Three surfaces in ONE merge showed the same
shape: _the obligation is documented/enforced somewhere other than where the actor arrives._ Rule
K.2 is cited at `erase/route.ts:520` and violated at `:604` in the same file. The disclosure
obligation is pinned in a Postgres-scoped parity test, not over the union. The worktree-detection
lesson is in a 169KB private `lessons.md` + an explicitly-superseded QUEUE banner, not in the
playbook a PM reads. This rhymes with RETRO-174 §5d — but I deliberately did NOT count it as a
promotion, because family resemblance across three different rules is not a repeat sighting of one
pattern. **Watch that temptation: "this rhymes" is how count-inflation starts.**

**My own blind spot, recorded.** I came within one paragraph of promoting a merged "crashed worker"
rule at count 3 (RETRO-146 + 150 + 175). What stopped it was reading RETRO-150 §6 closely enough to
notice it had faced the identical fusion question against RETRO-146 and **explicitly refused** —
promoting now would have overturned a prior adjudication _in order to_ promote. **The corpus's own
prior refusals are evidence, and they bind. Check whether a prior retro already declined the exact
merge you're contemplating before you count.** Second-order: the prior session's "possibly
promotion-grade" flag created real pull toward a decision it had explicitly deferred to me — a
handoff note's framing is not evidence, and I should discount it to zero rather than treat it as a
prior.

**Process note for the next retro.** The `next free FOLLOW number` markers at the bottom of
RETROSPECTIVES.md are STALE (they say 448 / 474; actual next free was 570). I derived the real
number by grepping max FOLLOW-NNN across QUEUE.md + FOLLOW_UPS.md and confirming 570-573 unused.
Don't trust those trailers.

---

## 2026-07-15 · RETRO-176 (FOLLOW-558 / PR #529 — DSR access+portability disclosure; sibling of RETRO-175)

**A finding I almost missed, and why.** The ClickHouse axis (§4a LG-1 — four erased PII tables
disclosed to nobody, `events` disclosed as a count not a copy). I almost missed it because
**RETRO-175 had already framed the union as a two-axis problem** (Postgres closed / Redis open), and
that framing is _complete-sounding_. Inheriting a sibling retro's axis list is the same error as
inheriting a PR's own framing — it just feels more authoritative because a peer did the work. What
saved it: I enumerated storage classes from the **erase route's code** rather than from RETRO-175's
prose, and `erase/route.ts:32-40` has a fifth step nobody's narrative mentioned. **Lesson: when a
prior retro hands you an axis list, treat it as a hypothesis and re-derive the list from the
artifact. A sibling retro is a source, not an inventory.**

**An axis/chain I had to trace twice.** Two, and both mattered.

1. **The parity test.** First pass I read its docstring — accurate, honest, even self-deprecating
   ("must be updated by hand") — and nearly recorded "parity test present, scope-limited per
   RETRO-175". Second pass I read the **assertion body** and the **import list**, and the test never
   imports `erase/route.ts` at all: it asserts `disclosure ⊇ {6 hardcoded literals}`, not
   `access-set == erase-set`. **The docstring was honest and the test was inert; I had to read the
   code to learn the code was better-described than it was implemented.** This is exactly Rule Y's
   third clause pointed at me, and it is the single highest-yield instruction in
   `CONVENTIONS_PATCH.md` for a retro: _open the cited file and confirm it performs the cited
   assertion._ RETRO-175 didn't, and it QUOTED the disproof of its own claim in the same sentence
   ("a parity test that fails when the sets diverge — and its own header concedes … must be updated
   by hand"). **Two clauses, mutually exclusive, one sentence, unnoticed.** That is what
   reading-for-gist does to a retro. Read assertions, not docstrings.
2. **The producer sweep.** `grep "insert(intentSessions)"` → zero hits. I was one keystroke from
   recording a second phantom store. The real producer UPSERTs via **PostgREST**
   (`intent-snapshot.ts:249`) and is invisible to any Drizzle-shaped grep. **This directly changed a
   promotion decision** (§6): it proved the grep class that produced _both_ phantom sightings
   under-reports, which is why PHANTOM-STORE is held at count 1 as unconfirmed rather than promoted
   at 2. **A negative grep is not evidence of absence until you know what the writers look like.**

**A meta-pattern in how gaps recur across agents.** _The honest statement and the false statement
ship in the same PR, and the false one lands where the decision-maker reads._ The #529 author wrote
an accurate, self-limiting docstring in the test — and then claimed the opposite in the commit
message, the DPIA §8, and the AC checkbox. Note the structure: **the truth went where engineers look
after CI is green; the falsehood went where the DPO, the auditor and the PM look instead.** This is
RETRO-174 §5d's "the guard must sit where the actor arrives" re-rendered on the _claim_ rather than
the _guard_, and it rhymes precisely with RETRO-175's CB-1 (a Rule K.2 violation 80 lines below a
Rule K.2 citation in the same file). I recorded the rhyme and **did not count it** — three different
rules with a family resemblance is not one pattern, and matching at that altitude is how the bar
rots. But as a _search heuristic_ for future retros it is excellent: **when a PR's code is honest
about a limitation, go read what its doc/commit/AC say about the same thing — the gap between them
is where the finding is.**

**My own blind spot, recorded.** I had a genuinely strong case for promoting PHANTOM-STORE at count
2: two different stores, two storage classes, two originating tickets, two independent discoveries —
emphatically _not_ one incident (unlike the parity pattern, where #528/#529 are one incident viewed
twice and the "one incident cannot self-promote by being retro'd twice" test disposes of it
cleanly). The pull was real, and it was _sharpened_ by having just spent an hour proving RETRO-175
wrong on a different point — **being right once creates appetite to be right again, and that
appetite looks exactly like evidence.** What stopped it was asking "what if this rule is wrong?"
rather than "does it clear the bar?": both sightings are explicitly _unconfirmed_ (out-of-repo
writers possible; see the PostgREST trap above), and a rule promoted on two hypotheses lands in
`CONVENTIONS_PATCH.md` **actively wrong**, which is worse than absent. Second-order: RETRO-175 held
that phantom in its hand and _chose_ not to register it as a pattern — registering it on its behalf
**and** promoting on it in one stroke would have been the re-labelling-to-reach-threshold move
RETRO-175 itself refused against RETRO-150. **New rule for me: the count is necessary, not
sufficient. Before promoting, ask what the rule would say and whether the evidence could be false.
An unconfirmed observation is not a sighting — it is a lead.**

**Where I disagreed with a sibling retro, and how it went.** RETRO-175 is excellent and its headline
(§5a, the Redis disclosure cascade) is **correct** — I re-verified it independently rather than
inheriting it, which was the right call in both directions: it confirmed the finding _and_ it was
the habit that made me re-verify §5d, which turned out to be wrong. **Verify the claims you agree
with too; that's where the habit is built.** Two corrections landed (§5d's "parity test that fails
when the sets diverge"; §4d's "FOLLOW-557 had no Rule N obligation" — false, because DPIA §8 **step
6** enumerates _erased_ stores and RETRO-175 only checked step 5). Both were framed as refinements,
both cite the evidence, and neither disturbs RETRO-175's conclusions — its "the union is unowned"
verdict gets _stronger_, not weaker. **A retro that silently inherits a sibling's "checked and
cleared" is not doing the job.** But note the asymmetry that made this possible: I had RETRO-175 to
check and it had nothing. The corpus compounds; my advantage was structural, not personal. **Say
so.**

**Process note (carried forward and re-verified).** The previous entry warned the
`next free FOLLOW number` trailers are stale. RETRO-175 derived 570 and left a trailer saying
**574**. I verified it independently rather than trusting it — max `FOLLOW-NNN` across QUEUE.md
(569) + FOLLOW_UPS.md (573)

- RETROSPECTIVES.md (573) → **574 correct**. Allocated 574-577; trailer now says **578.** The
  trailer written by the immediately-preceding retro is the one trailer that _is_ reliable — but
  check it anyway; it costs one grep.

- **2026-07-17 / RETRO-177 (FOLLOW-559)** · **Almost missed:** the whole gap lived INSIDE a taxonomy
  that looked exhaustively verified. The map is a `Record<EventType,ConsentClass>` with a runtime
  contract test over the union — a picture-of-completeness that reads as "done." I nearly wrote
  "classification correct" off the exhaustiveness proof. The catch came from reading the ACTUAL
  payload schema of a borderline `operational` member (`session.quality.snapshot`) and seeing
  `final_archetype`/`final_confidence` — the same derived-intent data its `intent.snapshot` sibling
  is gated for. Lesson: an exhaustiveness gate (every-member-classified) is NOT a correctness gate
  (every-member-classified-RIGHTLY); when a PR authors a classification, read the hardest 2-3
  members' actual data, don't trust the "every type has a class" green.
- **Chain/axis I had to trace twice:** whether the gate is a REAL block or just a Sentry counter.
  First pass I saw `rejected.push()` + counter and nearly logged it as observability-only. Second
  pass I followed `validated[]` and found BOTH the sinks AND the `intent.snapshot` side-effect loop
  iterate it — so a gated snapshot never reaches `handleIntentSnapshot`'s ClickHouse+Supabase
  dual-write. The block is real end-to-end; the counter is the observable, not the mechanism. Always
  trace the drop path to the actual writer, not to the log line next to it.
- **Meta-pattern across agents:** the "test/type checks LESS than it advertises" family is now three
  retros deep in different disguises — RETRO-175 (a mock-return-shape unit test), RETRO-176 (a
  "PARITY" test that hand-types the set it claims to derive), RETRO-177 (an exhaustiveness contract
  test that can't see a wrong verdict). They are NOT one promotable pattern: the mechanisms differ
  (green-without-executing vs list-posing-as-invariant vs executing-without-discriminating), and
  collapsing them to "the test is weak" is exactly the altitude that corrupts the ≥2 bar. But the
  FAMILY is a standing retro-radar target: whenever a PR claims a test ENFORCES an invariant, read
  the assertion body and ask "what edit would keep this green while breaking the claim?" · **Blind
  spot to watch:** I affirmed the PM's validation as sound this time (behavior-verified) — but the
  PM asked me to check that specifically, which primes a confirmation lean. I forced the check by
  reading the e2e assertion bodies (`stub.callCount()`) myself rather than the PM's prose about
  them. Keep doing that; the PM's self-report is an input to verify, never the verdict.

- **Date / RETRO:** 2026-07-19 / RETRO-180 (FOLLOW-584 — archetype-ID canonical consolidation)
- **A finding I almost missed and why:** `intent-weights.ts` `ARCHETYPE_KEYS` — a 4th full 18-entry
  hand copy sitting INSIDE `packages/shared` itself, which none of RETRO-178, RETRO-179, or the
  FOLLOW-584 ticket ever enumerated. I only caught it because I refused to trust the ticket's "3
  named copies + 1 deferred 5th copy" framing and re-ran the raw `golden_visa_buyer` anchor grep
  myself — it was line 39, in plain sight, the whole time. Lesson: when a consolidation ticket hands
  me its own scope list, re-run the canonical anchor grep and diff MY hits against THEIR scope; the
  gap is always the hit they saw and dropped, not the one nobody could see.
- **An axis/chain I had to trace twice:** the Rule-promotion count. The task brief told me the
  multi-anchor sub-pattern was "its 2nd sighting" per RETRO-179 and to check for a 3rd. Reading
  RETRO-179 §6 literally, that "2nd sighting" was **Rule AC** (failure-mode b, already promoted),
  not the multi-anchor gap (failure-mode a), which RETRO-179 called its 1st. And both my findings
  turned out to CONTAIN the anchor (grep-visible) → failure-mode (b), not (a) → they add ZERO to the
  multi-anchor count. So the "3rd sighting" the brief hinted at does not exist. Had I taken the
  brief's paraphrase at face value I'd have wrongly promoted a Rule AD below threshold. Always
  re-derive the count from the cited retros' own text, not the launching agent's summary of it.
- **A meta-pattern in how gaps recur across agents:** "the ticket that closes a class re-commits the
  class's own defining sin." FOLLOW-583 dropped a grep-visible copy (bandit-seed) → RETRO-179 caught
  it → FOLLOW-584 (the fix) then dropped ANOTHER grep-visible copy (intent-weights) in the exact
  same way. The consolidation that installs the SoT is itself the highest-risk site for an
  incomplete inventory, because everyone (PM, worker, prior retro) is anchored on the SoT-creation
  mechanics and stops enumerating. Retro discipline: for any "consolidate/guard a class" ticket, the
  LAST check before writing the entry is a fresh repo-wide grep of the class signature minus the
  files the ticket touched — whatever remains is the finding.

---

## 2026-07-19 / RETRO-181 (FOLLOW-585)

- **A finding I almost missed and why:** the merge itself was a clean, correct 3-file fix and it
  would have been easy to write a `Wiring Audit — clean ✅ / gaps N/A` entry and stop — the two
  named `'investor'` instances ARE genuinely closed end-to-end. The real finding was one
  search-radius wider: a `top_archetype: 'family_nester'` inline mock field in a route
  (`admin/tracer/sessions`) the ticket never touched, invalid the same way, invisible to BOTH
  anchors used so far (`golden_visa_buyer` full-parity anchor AND the `MOCK_ARCHETYPES`-name grep).
  It only surfaced because I ran a construct-agnostic sweep — a Python regex over EVERY
  `top_archetype|archetype:'…'` literal in non-test control-plane routes diffed against the
  canonical 18 — instead of trusting the ticket's own array-name search. Lesson reinforced: for a
  "fix an invalid literal of class X" ticket, the mandatory last step is a repo-wide sweep for the
  SEMANTIC class (any field that holds an X), not the syntactic construct the ticket happened to fix
  (a named array). The bug hid in a different construct (object field) precisely because the prior
  sweeps were construct-shaped.
- **An axis/chain I had to trace twice — the multi-anchor sighting COUNT.** The task brief invited
  me to treat this as possibly the threshold-crossing sighting for a Rule AD. I had to trace the
  count carefully across RETRO-179 (which conflated "Rule AC 2nd sighting" with "multi-anchor 1st
  sighting") and RETRO-180 (which authoritatively disentangled them: multi-anchor failure-mode (a)
  had exactly 1 prior sighting, RETRO-179; RETRO-180 was NOT one). So RETRO-181's `family_nester` is
  the 2nd TOTAL sighting = only 1 PRIOR = below the ≥2-prior threshold. It is the pivotal one, not
  the crossing one. I nearly mis-promoted by anchoring on the brief's framing rather than
  re-deriving the count from the two prior entries. Discipline held: cite the PRIOR count, not the
  total.
- **A meta-pattern in how gaps recur across agents:** the "closed a class" claim is systematically
  over-scoped by ONE construct-shape at a time. FOLLOW-561 guarded arrays/dicts → RETRO-178 found a
  4th array. FOLLOW-583 guarded 2 more arrays → RETRO-179 found 2 subset arrays. FOLLOW-585 fixed
  the subset arrays → RETRO-181 found an inline OBJECT field. Each remediation closes the shape it
  can SEE; the next instance hides in the next shape. The durable exit is not another reactive guard
  but a TYPE tightening at the hand-authored-constant boundary (now possible via FOLLOW-584's
  exported `CANONICAL_ARCHETYPE_IDS`) — recommended in FOLLOW-587, not codified as a rule (blanket
  retyping is wrong for DB-hydrated fields; only hand-authored constants are safe). Watch for the
  3rd genuine anchor-invisible sighting → that promotes Rule AD.

---

## 2026-07-20 / RETRO-182 (FOLLOW-587, PR #563)

- **A finding I almost missed and why:** the 5th live invalid literal (`history/route.ts:56`
  `family_nester` inside `JSON.stringify({ … })`) is an UNQUOTED object KEY — my first two sweep
  regexes (`archetype:\s*'[a-z_]+'` value-position, and the `MOCK_ARCHETYPES` name grep) both
  structurally miss it, exactly like FOLLOW-587's own sweep did. I only caught it by deliberately
  adding a THIRD grep shape — `JSON.stringify(\{[^}]*(hunter|_buyer|nester|…)` — as a separate pass.
  Lesson banked: when a bug class has already relocated across shapes twice, do not trust a
  value-position regex; enumerate object-KEY and JSON-blob shapes as first-class passes.
- **An axis/chain I had to trace twice:** the Rule AD promotion COUNT. RETRO-181 §6 and RETRO-180 §6
  had already locked the failure-mode-(a) tally (179 = #1, 181 = #2, both PRIOR) and pre-authorized
  "the next anchor-invisible find crosses the threshold." I re-derived it from scratch before
  trusting it — verified RETRO-182's find is genuinely anchor-INVISIBLE (failure-mode (a)), not
  hit-dropped-from-scope (failure-mode (b), which would NOT count), because a literal that never
  appears in ANY anchor's output cannot have been "dropped." 2 PRIOR (179+181) ≥ 2 → promoted. The
  discipline: distinguish "invisible to the anchor" (counts toward AD) from "visible but dropped"
  (counts toward AC, already promoted) — conflating them would have either over- or under-counted.
- **A meta-pattern in how gaps recur across agents:** the reactive per-shape runtime grep-guard is a
  TREADMILL — 561→583→585→587 each closed the one shape its regex saw and the gap hopped to the next
  shape 3× running. The exit is a compile-time TYPE at the hand-authored-constant boundary (this
  PR's `readonly ArchetypeId[]` retype — the first real installment). Rule AD now codifies "prefer
  the type over the next grep." Meta-note for MY OWN loop: I flagged "watch for the 3rd sighting →
  Rule AD" in my LAST lessons entry — and it landed exactly there. The forward-flag-to-next-retro
  mechanism worked; keep doing it (each retro should name the specific next-sighting that would
  cross a pending threshold).

## 2026-07-20 / RETRO-183 (FOLLOW-589 — chain-closure verdict)

- **A finding I almost missed and why:** my first two sweep scripts flagged 44 "non-canonical
  archetype-shaped tokens" — nearly all were `.venv/site-packages` third-party noise
  (`construction_worker`, `same_process_as_parent`, `transparent`) that I had NOT excluded. Almost
  let that volume obscure the two real hits. Lesson: for a Python-app monorepo, ALWAYS exclude
  `.venv`/`site-packages` in a token sweep before reading the count, or the signal drowns. After
  exclusion the true live-invalid count was 0 (the two survivors were a JSDoc example and a
  `test_*.py` fake).
- **An axis/chain I had to trace twice:** the closure claim. First pass I was ready to accept "prior
  worker says closed." That is not auditable. Second pass I mapped all 12 `it()` assertions to a
  specific file+structural-shape and re-ran the suite (12/12) — only THEN could I say CLOSED with
  the coverage table, not just assert it. A closure verdict without a per-assertion coverage map is
  an opinion, not a finding.
- **A meta-pattern in how gaps recur across agents:** the "closable vs CLOSED" distinction matters.
  RETRO-182 correctly said "closable" (1 live sub-shape left); the temptation as the terminal retro
  is to rubber-stamp. The discipline that earned the CLOSED verdict was doing my OWN independent
  all-shapes sweep and getting an EMPTY result — closure must be proven by a fresh negative sweep,
  never inherited from the predecessor retro. Also worth carrying forward: distinguishing the
  invalidity class (CLOSED) from the sibling duplicate-but-valid (FOLLOW-586) and parser-robustness
  (FOLLOW-588) classes prevented a false "everything archetype is now done" over-claim.

---

## 2026-07-20 / RETRO-184 (FOLLOW-588 — parser comment-strip hardening)

- **A finding I almost missed and why:** the task framed the risk as false-NEGATIVE/over-strip, and
  the lazy check is "all 12 real assertions are green → safe." But green is only self-evidencing for
  the 5 EXACT-parity parsers (over-strip → `missing` → fail); the SUBSET-validity parsers would pass
  VACUOUSLY under an over-strip (smaller-but-still-valid proper subset). I nearly rubber-stamped on
  the green suite alone. The leg that actually clears the subset parsers is a file-level grep
  proving no real archetype id is co-located after a `//`/`#` marker — mechanism, not just outcome.
  Lesson: when a guard can pass vacuously, "the suite is green" is necessary but NOT sufficient;
  find the input-level reason the bad case cannot arise.
- **An axis/chain I had to trace twice:** the block-comment (`/* */`) direction. First pass I only
  reasoned about line comments; then realized the 3 whole-source parsers strip the ENTIRE file,
  which contains JSDoc `/* */`, so a non-greedy strip COULD in principle swallow a real id across an
  unbalanced/open `/*`. Had to go back and count `/*`↔`*/` balance per file (18/18, 15/15, 2/2) to
  close it. Whole-source-scan parsers have a strictly larger over-strip surface than captured-block
  ones — check them separately.
- **A meta-pattern in how gaps recur across agents:** the "neuter the mechanism and confirm exactly
  the intended tests flip" move (here: identity-no-op stripper → exactly the 2 regression tests red,
  12 real green) is a high-value dual proof — it establishes BOTH that the new test is load-bearing
  AND that the change is inert on existing real data (nothing to over-strip). Worth
  requesting/looking for this two-sided neuter evidence on every "hardening/guard" ticket, not just
  the one-sided red→green the worker usually reports.

## 2026-07-20 · RETRO-185 (PR #569, FOLLOW-586 — finish the archetype-ID consolidation; filed FOLLOW-590 for the last copy; NO rule promoted)

- **A finding I almost missed and why:** whether the 3rd copy (`adapt-schema.ts`) was
  parity-GUARDED. The easy path was "grep found it, file FOLLOW-590, done." But the load-bearing
  detail for the follow-up's AC was that `tests/integration/archetype-id-parity.test.ts` (14
  assertions) does NOT cover `adapt-schema.ts`, and `adapt-schema.test.ts` only tests parse
  behaviour, not 18-entry parity — so the ONE surviving copy is precisely the one that can drift
  silently. I only caught it by grepping the parity suite + the SDK test for `archetypeIdSchema`
  rather than assuming "there's a parity suite, so it's covered." Lesson: when a copy is left
  behind, always separately verify whether it's GUARDED, not just whether it EXISTS — "guarded" and
  "consolidated" are different axes.
- **An axis/chain I had to trace twice:** the derivation recommendation. The task note leaned toward
  in-package `ARCHETYPE_NAMES` derivation as "cleaner." First pass I nearly echoed that. Second pass
  I checked the actual type of `ARCHETYPE_NAMES` (`readonly Archetype[]`, NOT `as const`) against
  `z.enum()`'s tuple requirement (`[string, ...string[]]`) — which flips the recommendation to
  Option B (import shared's `ArchetypeIdSchema`, no cast, matches the route.ts precedent this very
  PR set). A "cleaner" architectural suggestion can be blocked by a concrete typing constraint;
  verify the type, don't trust the prose.
- **A meta-pattern in how gaps recur across agents:** the "in-grep-but-out-of-this-ticket's-scope"
  copy is now on its 3rd sighting (FOLLOW-561/583 → 584 → 586) and my reflex was to ask "is this
  promotable?" It is NOT — it's the CORE of already-promoted Rule AC, and (unlike FOLLOW-584 which
  silently dropped) FOLLOW-586 SURFACED-and-DEFERRED across an ownership boundary, i.e. Rule AC
  WORKING. The meta-lesson: a recurring pattern that is ALREADY codified as a rule should be scored
  as CONFIRM-the-rule, not promote-a-new-rule; and distinguish "failure of the rule" (silent drop)
  from "the rule operating" (grep-scoped, surfaced forward) before counting it as a failure
  sighting. Also: separate the ownership-boundary defer (correct) from a scope-drop (incorrect) —
  same surface, opposite verdict.

## 2026-07-20 / RETRO-186 (FOLLOW-590 — importable-copy class CLOSED, arc capstone)

- **A finding I almost missed and why:** Almost declared closure purely from the PR body's claim.
  The load-bearing move was RE-RUNNING the `golden_visa_buyer` closure grep myself and confirming
  `adapt-schema.ts:33` had DISAPPEARED from the output (not just "changed") — a closure verdict on a
  multi-ticket class must be proven by the ABSENCE of the target signature in a fresh grep, never by
  the merge note. Also nearly filed a follow-up for the two test-only fixtures; caught that they're
  test-internal and self-failing → a note, not a ticket (guardrail: 1–8h scoped, no make-work).
- **An axis/chain I had to trace twice:** the derivation chain from the SDK re-export up to the SoT
  — `archetypeIdSchema = ArchetypeIdSchema` (shared) → `z.enum([...CANONICAL_ARCHETYPE_IDS])`
  (`schemas/description.ts`) → `CANONICAL_ARCHETYPE_IDS` (`archetypes.ts`) → guarded vs
  `ARCHETYPE_NAMES` (`intent.ts`). I verified BOTH that shared re-exports `ArchetypeIdSchema` (index
  → schemas/index → description) AND that the new in-SDK `.options` test closes the loop, so the
  alias is double-guarded, not one-hop.
- **A meta-pattern in how gaps recur across agents:** the whole arc = one value domain hand-copied
  into ~a dozen parallel places with no single source; the durable fix was ONE exported const +
  derivations + a SHAPE-COMPLETE guard suite (every structural sub-shape parsed from the REAL file
  with a non-vacuity "matched 0 → regex broken" check). The residual risk that outlives the arc is
  the cross-runtime (Python/SQL) copies that CAN'T import the TS SoT — the parity guard's
  non-vacuity assertions are the only thing between them and silent drift. Watch that invariant on
  any future edit to those parsers.

## 2026-07-20 · RETRO-187 (FOLLOW-592, ADR-0018 superadmin-tenant-access foundation)

- **A finding I almost missed and why:** The suite has a test literally named `RLS-TRAP-LEAK-DEMO`
  mapped to INV-5 (the ADR's single load-bearing security invariant), and FOLLOW-592's AC lists
  `staff-query-is-tenant-filtered`. Surface-reading the test NAME + AC = "invariant 5 covered,
  clean." Only reading the test BODY (it builds a local `allRows` literal and asserts
  `Array.prototype.filter` behavior — it never invokes a route query, because the helper by design
  runs no query) revealed it is DEMONSTRATIVE, not enforcing. Lesson: a test's name/AC-label proves
  intent, never coverage — for the highest-risk invariant, read the body and ask "what production
  code does this assertion actually bind?" Here: none.
- **An axis/chain I had to trace twice:** The RLS-trap ENFORCEMENT chain. First trace: helper →
  returns `access.tenantId` (the fence) → OK. Second trace (the one that mattered): where does the
  fence get APPLIED, and is that application tested? → deferred to FOLLOW-594..600 → read each of
  the 7 downstream stub ACs → NONE carried a per-route leak-test. The gap wasn't in what shipped; it
  was in whether the obligation TRAVELS with the tickets that discharge it. It didn't. Fixed by
  editing the stubs, not by filing a new ticket.
- **A meta-pattern in how gaps recur across agents:** This is Rule AC's shape ("gap moves one hop
  downstream / dropped from the next scope") reappearing in a NEW domain — a security TEST
  obligation crossing a ticket boundary rather than a code literal crossing a grep anchor. A
  foundation ticket can pass its own AC with a demonstrative test while pushing the real enforcement
  into consumer tickets whose ACs quietly omit it. 1st sighting in this domain (count 1) — did NOT
  promote, but flagged the 2nd-sighting trigger for widening Rule AC to test-obligation propagation.
- **Blind-spot on the harness itself:** started on a DIRTY non-worktree checkout (branch
  `backend-engineer/FOLLOW-584-...`, 5 modified/untracked files from a DIFFERENT ticket) while
  retro'ing FOLLOW-592. Read-only on code so no contamination risk to my output, but a reminder to
  `git show <sha>` the MERGED commit rather than trust the working tree when the tree is dirty from
  a concurrent agent sharing the checkout.

## 2026-07-20 · RETRO-188 (FOLLOW-593, PR #581 — tenant hub + mock→real-Supabase)

- **A finding I almost missed:** the 8 new `data.ts` return-type interfaces are Rule-I "dead" but
  are actually WIRED via return-type inference (the page destructures the loader's return, never a
  named `import type`). I nearly filed them as the same class as RETRO-187's dead
  `resolveTenantAccess`. They are the OPPOSITE: RETRO-187 = code genuinely dead, detector correct;
  RETRO-188 = code wired, detector wrong. Fusing them into one "Rule-I-new-export" promotion
  candidate (which the dispatch brief nudged toward as the ≥2 threshold-crosser) would have been the
  exact premature-fusion error RETRO-150/176 refused. The distinction also produced the real
  deliverable: FOLLOW-602, because FOLLOW-591's Option B would false-block these 8.
- **An axis I had to trace twice:** whether INV-5 (RETRO-187's mandatory tenant-filter test) applies
  here. First pass said "staff querying a specific tenant via createAdminClient = INV-5 applies."
  Second pass corrected it: these are cross-tenant staff LIST views (staff MAY read all tenants) and
  `getTenantById` reads the tenant's OWN identity row — there is no foreign-tenant fence, so INV-5
  does NOT apply and RETRO-187's placement on FOLLOW-594+ (the per-tenant DATA surfaces) was already
  correct. Reconciling rather than contradicting a prior retro is itself the step-8 discipline.
- **Verify-not-guess paid off (numbering):** the brief asserted "max is 275, use RETRO-276." The
  file's true max heading is RETRO-187; the only RETRO-275 token is prose inside RETRO-063. Used
  RETRO-188 and flagged it. Also caught FOLLOW-600's "the dropped FOLLOW-601" reference → filed my
  stub as 602, not 601, to avoid an id collision. Two numbering traps, both caught by reading the
  file instead of trusting the brief.
- **A cleared-not-confirmed discipline:** three plausible logic gaps (pending-only registrations
  filter, UUID-gate, deriveStatus) all dissolved on inspection — the pending filter matched prior
  page behavior, the env-var check is an EXACT mirror of createAdminClient. Recording "checked and
  cleared" is as valuable as recording a gap; it stops the next retro re-litigating.
- **Meta-pattern across agents:** stranded-worktree recovery is now 2 distinct incidents
  (RETRO-175/176 + this). But this one's recovery SUCCEEDED, validating FOLLOW-573's detection step
  — a rare case where the recurrence is evidence the remedy works, not that it's missing. Resisted
  filing a redundant stub.

## 2026-07-20 · RETRO-189 (FOLLOW-594 — first real consumer of the RLS-bypassed staff path)

- **A finding I almost missed and why:** the INV-5 tenant-filter tests were so thorough (real
  fetch-intercept + real `.where()` capture on all 3 endpoints) that I nearly signed off "coverage
  complete" — the actual gap was one layer up: the SPY on `resolveTenantAccess` re-greened the
  agency tests but silently dropped any assertion that the ROUTE passes `allowStaffOverride:true` +
  `minAgencyRole`. The leak-test proves the fence works GIVEN the resolved access; nothing proves
  the route CONFIGURED resolve correctly. The strong test masked the weak one. Lesson: when a route
  delegates auth to a spied helper, always grep `toHaveBeenCalledWith` — the delegation's OPTIONS
  are a distinct, security-relevant surface the helper's own suite cannot cover.
- **An axis/chain I had to trace twice:** whether the staff SURFACE was fully covered — had to
  enumerate every `fetch()` in `AnalyticsView` (4: summary/lift/ab-weights + the PATCH) and confirm
  the PATCH is `allowResume`-gated OFF on the staff page, i.e. no un-ported staff read path. Also
  chased a phantom "transient broken main" (tenantExists imported before exported between #581/#582)
  — turned out the data.ts/[id]/page.tsx hits were COMMENT references, not imports. Verify-not-guess
  paid off both times.
- **Meta-pattern in how gaps recur across agents:** RETRO-187 §6 pre-registered a 2nd-sighting watch
  ("a ported route ships without the INV-5 test despite the AC"). It DIDN'T recur — the AC held. But
  a NEIGHBOR of the same shape appeared: not the test class relocating across a TICKET boundary, but
  an EXISTING test's assertion surface SHRINKING within a spy-based port. Gaps don't just move one
  hop downstream — they also move one LAYER up (from "does the fence work" to "did we wire the
  fence's config"). Registered as a new count-1 pattern; watching the write ports (595/598) for
  sighting 2.

## 2026-07-20 · RETRO-190 (FOLLOW-595 — first staff WRITE port)

- **A finding I almost missed and why:** the `staff_audit_log` HALF_WIRE_P. The audit insert looks
  fully wired within the PR (producer + schema + tests), so CHECK B nearly read "clean" — but the
  CONSUMER (`/api/audit`) still serves MOCK_ENTRIES, so nothing reads the rows yet. Caught it by
  remembering RETRO-189 §5a explicitly PRE-REGISTERED this as a coming wire. Lesson: a producer that
  is internally complete + tested is still a half-wire until the READER exists; check the prior
  retro's cascade predictions as a HALF_WIRE checklist.
- **An axis/chain I had to trace twice:** the hub-linkage claim. RETRO-189 §8 stated "the `[id]`
  page links to `/analytics`" — I nearly inherited it as fact. Grepping the landing `page.tsx` (and
  `git show 08a5d1e:`) proved it links ONLY to tracer/\*; the analytics AND quiz staff pages are
  direct-URL-only. A prior retro's "satisfied" verdict is NOT evidence — re-run the grep. Step 8
  (reconcile contradictions with prior retros) paid off directly.
- **A meta-pattern in how gaps recur across agents:** the "gap moves one hop / one surface
  downstream" motif again — 593 shipped the hub, 594 shipped analytics unlinked, 595 shipped quiz
  unlinked; each agent closed its own slice and left the CROSS-surface wiring (hub link) for
  "someone." Same shape as the classic producer→consumer→render chain, but on the NAV axis. Watching
  for the 3rd recorded sighting (596/597/600) to promote a "wire your surface into the hub in the
  same PR" rule. Also: the worker PROACTIVELY applied FOLLOW-603's option-wiring assertions —
  evidence the retro→FOLLOW→AC learning loop actually propagates into implementation, not just
  backlog.

- **2026-07-20 / RETRO-191 (FOLLOW-605)** · **A finding I almost missed and why:** the
  mock↔production boundary. The `.transaction()` harness mock is so faithful (snapshot → stage →
  commit-on-resolve / discard-on-throw) that it's easy to record the green rollback test as PROOF of
  atomicity and move on. It isn't — it proves the ROUTE's control flow + the mock's contract, never
  the real postgres.js/pgBouncer BEGIN/COMMIT/ROLLBACK. The load-bearing evidence for real-DB
  atomicity is ELSEWHERE: the 4 production precedents on the same session-pool client (I
  grep-confirmed quiz/completion:236 and dsr/erase:317). Lesson: for any test that mocks a
  transactional/atomic primitive, explicitly separate "what the mock proves" from "what de-risks the
  real primitive," and name the latter — otherwise a green over-promises. · **An axis/chain I had to
  trace twice:** the cascade propagation. First pass I saw ADR §3a names 596/597/598 and thought the
  obligation was fully carried. Second pass (grepping the actual stub blocks) showed the inline
  sequence-note landed ONLY in 598; 596/597 have zero atomicity refs and lean solely on the ADR
  scope line. Prose obligations propagate ASYMMETRICALLY — verify the note is IN each downstream
  stub, don't assume a scope-line-naming covers it. That asymmetry is precisely what tipped
  FOLLOW-607 (a mechanical guard covers all ports uniformly) from "nice-to-have" to "worth filing."
  · **A meta-pattern in how gaps recur across agents:** the gap→fix ARC vs independent-sighting
  distinction. RETRO-190 flagged the non-transactional write; RETRO-191 fixed the SAME write. That
  is ONE arc, NOT two rule-promotion sightings — resisting the urge to promote a Rule off a single
  remediated instance is the discipline the ≥2-INDEPENDENT bar exists to protect. The right move was
  to set the explicit promotion TRIGGER (first 2nd independent port found non-transactional) rather
  than codify prematurely. This mirrors the RETRO-180..186 archetype arc where I repeatedly had to
  distinguish "confirms an existing rule" from "new independent sighting."

## 2026-07-21 · RETRO-193 (FOLLOW-596, demo-override staff-write port + /admin/tenants/[id]/demo)

- **A finding I almost missed and why:** the INLINE-vs-DELEGATED write duplication (LG-1). The PR
  body frames the inline upsert as a clean, well-justified choice ("mirrors quiz/config, keeps the
  guard engaged") and the atomicity guard PASSES — so the reflex is to record it as clean and move
  on. What I almost missed is the SECOND-ORDER cost: inlining duplicates `upsertDemoOverride`'s
  exact write shape with NO parity guard, and it's not a one-off — the FOLLOW-607 presence-check
  STRUCTURALLY forces every staff-write port (597/598) to do the same. The guard I retro'd LAST
  cycle (RETRO-192) is now shaping the code structure of the tickets that land under it. Lesson:
  when a prior-cycle mechanical guard is in play, don't just check "does the new code PASS it" —
  check "what did passing it COST / what shape did it force," because a guard's presence-check can
  push authors into a worse pattern (duplication) than the one it prevents.
- **An axis/chain I had to trace twice:** the hub-linkage PROMOTION count. First pass I read
  FOLLOW-606's AC ("prevents the 3rd recorded sighting → the promotion trigger") and RETRO-190
  framing analytics+quiz as two surfaces, and nearly promoted a Rule (demo = "3rd sighting"). Second
  pass I applied the house BANKING convention strictly: the unit is PRIOR RETROS, not
  surfaces-within-a-retro, and RETRO-190 §6 had ALREADY adjudicated "count 1 HELD" (explicitly NOT
  counting RETRO-188's prospective note, and RETRO-189 recorded the OPPOSITE). So there is only ONE
  prior banked retro → below the ≥2-PRIOR bar → HOLD. Two counting schemes (surfaces vs
  banked-retros) genuinely disagreed; the banked-retro scheme is the one every existing Rule
  footnote uses, so it wins. Lesson: "N surfaces observed" ≠ "N prior retros banked" — always
  resolve promotion against the same banking unit the CONVENTIONS_PATCH footnotes use, and let the
  guardrail (don't promote below threshold) break ties toward HOLD.
- **A meta-pattern in how gaps recur across agents:** a remediation ticket that DEFERS wiring to a
  perpetually-unlanded sibling. 596 scoped its own hub link OUT "because FOLLOW-606 owns it" — the
  third surface in a row to do so. Each surface ticket is individually reasonable, but the aggregate
  is a standing gap that never closes because ownership is always one ticket away. This is the
  inverse of the gap→fix arc: not "a fix moves the gap one hop downstream" but "each new producer
  defers its own wiring to a shared follow-up that keeps not landing." Worth watching whether 606
  actually lands before 597/600 add sightings 4/5 — that's the real promotion trigger, and if 606
  keeps slipping the pattern is a PROCESS gap (deferral-to-a-non-landing-ticket), not just a coding
  one.

- **2026-07-21 / RETRO-198 (FOLLOW-597, PR #599)** · **A finding I almost missed and why:** the
  guard's SKIP on `labels/[id]` is reported by `check-staff-write-atomicity.cjs` as
  `insert(staffAuditLog) present but no other data mutation (audit-of-a-read/export)` — the SAME
  phrasing it uses for genuinely-benign audit-of-a-read routes (`labels/export`). I nearly read it
  as "clean, nothing to see." The tell that it was actually a ZERO-ENFORCEMENT bypass, not a benign
  read, was reading the ROUTE body (a real `upsertConversionLabel` mutation inside the tx) — the
  guard's OUTPUT STRING is identical for "safe audit-of-a-read" and "dangerous mutation the guard
  can't see." Lesson: never trust the guard's SKIP classification text; always diff it against the
  route's actual mutation surface. · **An axis/chain I had to trace twice:** the intent-weights PUT
  → SDK render chain. First pass I assumed the PUT needed to set an `is_tenant_specific` COLUMN for
  the SDK to pick it up (the route header says "is_tenant_specific: true"). Tracing it again against
  `intent/config/route.ts` + `schema/intent-weight-configs.ts` showed `is_tenant_specific` is a
  DERIVED RESPONSE field (`tenantId !== null`), NOT a column — the PUT setting `tenantId` non-null
  IS sufficient, and the SDK's `tenantRow ?? globalRow` preference closes the wire end-to-end.
  Almost filed a phantom HALF_WIRE on a column that doesn't exist. · **A meta-pattern in how gaps
  recur across agents:** the "documented deferral vs live gap" distinction is doing a LOT of
  load-bearing work in this epic (596/597/598/606/613). Three different retros now (193, 197, 198)
  have had to explicitly separate "this is a NEW independent finding (file/promote)" from "this is
  the PREDICTED materialization of an already-tracked latent ticket (reference, don't re-file, don't
  re-promote)." The failure mode to guard against is DOUBLE-COUNTING a predicted-and-confirmed risk
  as a fresh sighting (would wrongly trip a rule promotion or spawn a duplicate FOLLOW). The
  discipline that worked: for every finding, grep the existing FOLLOW_UPS/RETROs for the exact
  symbol/shape BEFORE deciding file-vs-reference, and state the adjudication (prediction-confirmed
  vs independent) explicitly in §6. · **Sequencing insight worth reusing:** "highest-blast-radius
  ticket must go last/most-guarded" is a good instinct but VERIFY the mechanism — I assumed
  613-before-598 was needed until I grepped and found 598's bandit write is INLINE (no barrel helper
  exists), so the barrel-SKIP simply can't fire for it. The guard-coverage risk only exists where a
  route DELEGATES through a package barrel; inline mutations are always visible. Check the actual
  call-shape before recommending a sequencing constraint.

## 2026-07-21 · RETRO-199 (FOLLOW-598, PR #600)

- **A finding I almost missed and why:** I nearly conflated two DIFFERENT wires for the same write.
  The bandit resume IS wired end-to-end on the _business_ axis (`paused=false` → `getBanditArms` →
  `/api/adapt`), which felt like "wiring clean" — but the _audit_ of that write is NOT wired
  (consumer `/api/audit` is still `MOCK_ENTRIES`). Had to force myself to record producer→consumer
  separately for the business wire vs the audit wire. Lesson: "the write is wired" ≠ "the audit of
  the write is wired" — always split them in §3.
- **An axis/chain I had to trace twice:** the superadmin-gate ordering. First pass I confirmed the
  gate sits before the mock path structurally in the diff; second pass I went to the TEST to confirm
  it's ASSERTED (`DATABASE_URL=''` + ops-staff→403). Structure alone doesn't prove a
  below-superadmin caller can't get a mock-200; the test does. Don't declare ordering-safe from the
  diff without the negative test.
- **A meta-pattern in how gaps recur across agents:** the "inline vs barrel-delegated staff
  mutation" guard-coverage fork now appears in two consecutive retros (597 barrel→SKIP, 598
  inline→OK). It LOOKS promotable at count 2, but it's a transient artifact of FOLLOW-613 (guard
  can't follow `export *`) — the moment 613 lands, the fork disappears. Meta-lesson: a pattern that
  only exists because a known open ticket hasn't landed is NOT a durable convention; resist
  promoting it. Rule AE + FOLLOW-613 already own it.

## 2026-07-22 · RETRO-201 (FOLLOW-599 / PR #602 — audit-read consumer + x-tenant-id hole)

- **A finding I almost missed and why:** I nearly wrote up the `/api/config` `x-tenant-id` auth hole
  as a NEW one-off security finding. It is not — RETRO-153/163 had ALREADY filed it (with
  `/api/audit`) as FOLLOW-491, which was then SKIPPED per a QUEUE.md "both are stubs, defer" note.
  Grepping the retro history (step 3) BEFORE writing §4 turned a duplicate stub into the correct
  NARROWED SUCCESSOR (FOLLOW-614, config leg only) and reframed the whole headline from "closed a
  hole" to "closed ONE leg of a known 2-leg class; the other leg is still live." Lesson: always grep
  prior FOLLOW/RETRO history for a finding's signature before minting a stub — a "new" security hole
  is often a re-sighting of a deferred one, and the right output is to re-scope, not duplicate.
- **An axis/chain I had to trace twice:** the mock-branch reachability. First pass I accepted the
  worker's "unreachable" flag at face value; second pass I actually followed `resolveTenantAccess` →
  `tenantExists` (session-auth.ts:446) → `createAdminClient` (client.ts:188 `throw`) and confirmed
  the throw uses the SAME two env vars as the route's `dbConfigured` check, so `!dbConfigured` ⟺
  createAdminClient-throws — the mock branch is provably unreachable in a real no-DB env. But the
  SECOND trace also delivered the VERDICT that matters: this is Rule-K.2-COMPLIANT (fails loud,
  never fabricates), so it's a benign dead branch, NOT a ticket. Tracing the chain twice is what
  separated "dead code, file a stub" from "dead but correct, don't."
- **Meta-pattern in how gaps recur across agents:** the "close leg A of a multi-leg class and let
  legs B/C ride an OPEN deferral" pattern keeps producing HALF-discharged tickets (FOLLOW-491 audit
  vs config here; the FOLLOW-473/491 fail-open family before it; the FOLLOW-613 barrel-bypass before
  that). Each write-port/hardening PR closes exactly its named route and the sibling of the SAME
  class stays open under a "defer, it's a stub" note that never gets re-examined until the next
  retro re-greps. The retro's job is to be the periodic re-grep that keeps the residual leg from
  being silently forgotten — Rule AC (sweep by repo-wide grep, not the files the audit named) is the
  durable answer, and this is another confirming instance of WHY it exists.
- **Positive confirmation worth recording:** FOLLOW-599 is the FIRST per-tenant surface after the
  FOLLOW-606 same-PR-link template (RETRO-200 armed the trigger). It SELF-WIRED its hub link
  correctly → the trigger stays un-fired and the template is CONFIRMED working. Recording the
  compliant instance is as important as recording failures — it's what keeps a premature rule
  promotion from firing on a pattern that's now self-correcting.

## 2026-07-22 · RETRO-202 (FOLLOW-614 / PR #603 — /api/config spoofable-header sweep)

- **A finding I almost missed and why:** the missing staff write-rank gate on PATCH. The diff LOOKS
  complete — headers removed, `resolveTenantAccess` with the right `minAgencyRole` floors, spoof
  tests, even unprompted FOLLOW-603 option-wiring assertions — and every check the AC named passes.
  The gap only appears when you diff the route against its SIBLINGS rather than against its AC: a
  grep for `canWrite|isSuperadmin` across `app/api` showed every other staff write carries a
  post-resolve rank gate and this one doesn't. Lesson: for any port that instantiates a codified
  template, §step-2 symbol-mapping must include a SIBLING-CONFORMANCE grep (compare against the
  other instances of the template), not just a consumer grep — the AC is not the spec, the template
  is.
- **An axis/chain I had to trace twice:** whether `minAgencyRole: 'agency:admin'` protects the staff
  path (it reads like a write floor). First pass I assumed it did; second pass through
  `session-auth.ts` showed `minAgencyRole` is consumed ONLY in the agency branch (:404) — the staff
  branch's only outputs are `canWrite`/`isSuperadmin`, which the CALLER must enforce. Then a third
  hop into `tracer-auth.ts` confirmed there is no role floor at the verification layer either (any
  `estalara_staff:true` passes). Three layers, each of which LOOKS like it might gate, none of which
  does for staff writes — the enforcement point is the route, full stop.
- **A meta-pattern in how gaps recur across agents:** AC-faithful workers ship AC-shaped holes. The
  2nd sighting (RETRO-198: FOLLOW-606's AC missing `/intent`; now RETRO-202: FOLLOW-614's AC missing
  the write-rank gate) of "the stub AC under-enumerates a codified template and the worker
  implements the AC exactly." Both times the AC author was… the retrospective-analyst (me). The
  loop's own stubs are becoming the propagation vector: when I file a FOLLOW that is an INSTANCE of
  a template (port, hub link), the AC must point at the template checklist (RETRO-190 items a-g,
  FOLLOW-603 note) instead of re-deriving a subset. Banked at 1 prior; promote to a rule on the next
  sighting.

---

**2026-07-22 / RETRO-203** (FOLLOW-615 / PR #604 — staff write-rank gate on PATCH /api/config)

- **A finding I almost missed and why:** I nearly recorded the "staff write-rank port template"
  pattern as promotable because the launch brief pointed me at RETRO-190/199/201/202 and said "this
  may already be at or past the threshold." It is NOT. Those first three are POSITIVE-compliance
  instances (ports that correctly shipped the gate) — and rules are promoted from recurring FAILURE
  sightings, not from a convention being followed. The actual failure (a port MISSING the gate) has
  been seen exactly once (RETRO-202). FOLLOW-615 is the FIX of that one instance, and a clean fix
  landing is not a new sighting (the Rule AB / RETRO-170 adjudication). Count 1 → no promotion. The
  brief's framing is exactly the kind of "count the compliant instances too" inflation the charter
  warns against. Lesson: when a brief suggests a threshold is met, re-derive the count from FAILURE
  sightings only and discount the promoting/fixing PR itself.
- **An axis/chain I had to trace twice:** the `via` axis. First pass I confirmed agency + staff are
  gated. Second pass I asked "is there an `admin_secret` via that bypasses `via==='staff'`?" — and
  had to go read the `TenantAccess` union (`session-auth.ts:261-290`, only agency|staff) AND confirm
  the route passes no `allowAdminSecret` opt before I could call the gate axis-complete. RETRO-199
  had to make the exact same `admin_secret`-exemption call on the bandit route; I should keep a
  standing "enumerate every `via` value + which opts the route enables" checklist for any
  `resolveTenantAccess` port so I don't re-derive it each time.
- **A meta-pattern in how gaps recur across agents:** the retro→FOLLOW→fix loop closed a
  security-class gap in EXACTLY the predicted shape (RETRO-202 said "copy quiz/config:154, land
  before FOLLOW-600"; the PR did precisely that + a PM perturbation proof). When the FOLLOW AC is
  well-specified and names the reference implementation, the fix is mechanical and clean — the
  CONTRAST with the AC-under-enumeration pattern (banked at 1 prior) is instructive: a stub AC that
  names the template shape produces clean closures; one that under-enumerates produces the next gap.
  Same lever, opposite outcomes. This strengthens the banked AC-under-enumeration candidate without
  adding a sighting (615's AC was well-specified, so it does not count against it).

## 2026-07-23 — RETRO-205 (FOLLOW-600 / PR #606)

- **A finding I almost missed and why:** the entire headline. The PR body, the PM's post-merge
  audit, and my own first pass all traced the SAME chain — hub link → page → editor → `/api/config`
  → real `tenants` columns → `staff_audit_log` — and it is genuinely intact, so I nearly wrote
  "wiring clean". What saved it was asking the question one hop FURTHER than the audit's terminus:
  the audit stopped at "the column is real". A column being real is a PRODUCER fact. I only found
  the two HALF_WIRE_Ps when I grepped `allowed_origins` / `primary_color` for a READER and got
  nothing but hardcoded env lists. **Standing correction: "wired to a real column" is the START of
  CHECK B, not the end of it. For any staff/admin surface, the terminus is a runtime effect (a
  request refused, a pixel rendered), never a row written.** A settings page is the highest-risk
  shape for this because its round-trip (PATCH → GET → re-render) is self-consistent and looks alive
  even when nothing downstream reads the value.
- **An axis/chain I had to trace twice:** the client READ path. My first pass on
  `tenant-config-editor.tsx` saw `if (!r.ok) throw` and I mentally ticked "checks status — Rule K.2
  consumer side satisfied". Only on the second pass did I follow the throw into `.catch(() => {})`
  sixteen lines later and then ask what `handleSave` sends (a FULL body, always) — which turns a
  swallowed READ error into a destructive WRITE. **`res.ok` being present is not the same as the
  failure being handled; read the catch AND the subsequent write shape before crediting a
  consumer.** Also worth banking: three sibling editors carried the identical block and three prior
  retros passed over them, because every one of us analysed the surface on the axis its ticket was
  about (staff write) and not on the axis nobody's ticket was about (client read).
- **A meta-pattern in how gaps recur across agents:** rules keep outrunning their enforcement. Rule
  K.2 already forbids the consumer-side swallow and its Verification block already ships the exact
  grep that finds all three instances — and it shipped three times anyway. That is the same shape
  RETRO-204 found for Rule AE (the rule enumerated the bypass; the enforcement didn't). And Rule I
  is the third instance of the same meta-failure at the CI layer: the check exists, runs, reports,
  and is ignored. **Working hypothesis for the next retro: when I find a defect, check FIRST whether
  an existing rule already covers it — if it does, the finding is an enforcement gap and the correct
  output is a mechanical guard (FOLLOW), NOT a new rule.** Promoting a second rule over the same
  ground would have been the easy, wrong move here; the one rule I did promote (AF) covers something
  no existing rule addressed — what to do when a gate itself stops carrying information.
- **On my own blind spot (the brief named it, and it was right):** I was handed a PM audit that said
  "no gap found" and a green-modulo-Rule-I CI. Both were locally true and jointly misleading. The
  audit verified the things a ticket's AC lists; nobody's AC says "and something must read this".
  **A prior audit's clean verdict is an input to re-derive, never a section I can skip.**

---

## 2026-07-24 · RETRO-206 (FOLLOW-624 / PR #608)

- **A finding I almost missed and why.** FOLLOW-624's PR body was persuasive: red-first tests, three
  editors fixed, and an explicit grep `grep -rn "catch(() => {" apps/control-plane/src/app/admin`
  returning "0 matches after this PR." I nearly accepted "the swallow is closed." The tell was that
  the grep was scoped to `/app/admin` — but Rule K.2's OWN Verification block specifies the
  repo-wide `grep -rn "catch(() =>" apps/`. Running the rule's actual (wide) grep surfaced three
  byte-identical twins outside `/admin`: `dashboard/quiz/page.tsx`,
  `dashboard/demo/override/page.tsx`, and the shared `components/generation-model-settings.tsx`.
  **Lesson: when a PR cites a grep as proof, re-run the RULE's grep verbatim, not the PR's narrowed
  copy. A narrowed proof-grep is the fix inheriting the audit's blind spot.**
- **An axis/chain I had to trace twice.** The route axis. Two of the twins (`/api/quiz/config`,
  `/api/demo/override`) write the EXACT SAME routes the fixed admin editors write — so the routes
  each have two client consumers, one safe and one clobbering. I had to map
  consumer→route→sibling-consumer, not just consumer→route, to see that the fix covered one consumer
  per route and left the other. The admin editors were the LATE copies (FOLLOW-595/596/600); the
  dashboard pages are the ORIGINALS the swallow was copied FROM — so the fix chased the copies and
  left the source.
- **A meta-pattern in how gaps recur across agents.** "Scope the fix to the surfaces the retro
  NAMED, not to the pattern's full grep." RETRO-205 named three admin editors (the surfaces IT was
  auditing); FOLLOW-624 fixed exactly those three and no more. The finding's real boundary was the
  grep, not the enumeration. Same shape as RETRO-001→004 (5 Rule-H instances missed in one PR).
  Also: a SHARED component (`generation-model-settings.tsx`, one file → two zones) concentrates a
  consumer-side defect and removes the "one surface fixed, one not" signal that would otherwise flag
  the miss — and it sits in `src/components/`, outside the `src/app/**` scope FOLLOW-625's guard was
  drafted against, so I had to widen the mechanization's scope too or it would ship blind to the
  very instance that motivated it.

- **2026-07-24 / RETRO-207 + RETRO-208 (ESC-039 close-out chain, PRs #609/#610)**
  - **A finding I almost missed and why:** RETRO-208's block-form gap. The guard's Rule-AE header
    honestly lists `try/catch{}` as a documented residual, and it's tempting to accept a documented
    residual as clean. But I cross-read it against FOLLOW-625's OWN AC (bullets 1+4 named `catch {}`
    in scope) and found the shipped guard under-delivered against its own ticket — a residual that
    is also an AC miss is a genuine finding, not a benign Rule-AE note. The tell: "documented" ≠ "in
    scope by the ticket that shipped it." Always diff the guard's covered-set against the ticket AC,
    not just the guard's self-declared residuals.
  - **An axis/chain I had to trace twice:** whether the load-failure guard is defeated by the routes
    returning 200-with-defaults. I first worried the quiz/demo/generation-model GETs fabricate
    config on a missing row (which would sail through as `loadStatus='loaded'` and re-open the
    clobber). Had to open all three routes: they fail LOUD (500) on real DB error and only
    200-default on a genuinely-absent row (legit first-setup state) — so the guard fires exactly
    when it should. The distinction (DB-error vs empty-row) is the whole ballgame; contrast
    /api/config (FOLLOW-627) which DOES fabricate. Don't assume a load-failure guard is complete
    without checking the producer can't hand it a fabricated success.
  - **A meta-pattern in how gaps recur across agents:** the "enforcement-not-text" loop reached its
    terminus here (K.2's grep is finally a CI gate) — but the same shape immediately generalised one
    level up: ~30 Rules ship Verification greps and only a handful run in CI. The recurring failure
    is not "the rule was wrong," it's "the rule's own check was never wired." I resisted promoting a
    blanket rule (count 1 as a cross-rule observation; the K.2-specific precedents don't evidence
    the generalisation recurs) and filed the audit (FOLLOW-632) instead — the discipline is:
    mechanise the check, don't codify more prose that also won't be run.
  - **P-5 arming discipline:** RETRO-207 was the counter-example that KEEPS P-5 at count 1 —
    FOLLOW-630 ran the rule's FULL repo-wide grep (I re-ran it myself: 9 hits, 0 swallows). A clean
    closure that _disarms_ a candidate is as important to record as a recurrence that arms one.

## 2026-07-24 / RETRO-209..211 (PRs #614/#615/#616, session-58)

- **A finding I almost missed and why:** RETRO-211 LG-1 — the #616 GET notice "Saving will create
  its config" DIRECTLY contradicts the PATCH 0-row-404 the SAME PR ships (UPDATE, not upsert). I
  nearly passed it as a clean K.2-provenance closure because both halves are individually correct
  and well-tested; the contradiction only surfaces when you hold the GET-render and the
  PATCH-behavior for the identical no-row state in your head at once. Lesson: when a PR adds BOTH a
  "state X is special" read-signal AND a "state X is rejected" write-path, always check the two
  agree about state X.
- **An axis/chain I had to trace twice:** #614's `session_id` — the fix is a no-op if the demo JWT
  doesn't actually CARRY session_id (the `if (jwtClaims.session_id)` guard would be vacuously
  false). The PR diff does NOT touch the mint side, so I had to go read
  `/api/demo/sessions/route.ts:157-176` to confirm the producer already mints
  `session_id = demo_sessions.id`. It does → genuine closure. This is the inquiry_submit_selector
  one-hop trap: a consumer-side "fix" is only real if the producer feeds it. Always verify the
  producer for a claimed-closed wire, even when the PR doesn't touch it.
- **A meta-pattern in how gaps recur across agents:** the stranded-worktree failure mode moved ONE
  HOP past its own guard. FOLLOW-448 (DONE) closed the HEAD==main mode; session-58 stranded
  #615/#616 in the isolated-worktree mode the guard doesn't watch. This is the same "the fix
  relocates the gap one hop downstream" shape I chase in code (K.2 swallow: admin editors →
  dashboard twins; staff-write guard: bypass 4→5→6→...) — it applies to PROCESS guards too. A
  guard's scope boundary IS a future gap; name it explicitly when a guard ships (RETRO-208 already
  does this for the K.2 block-form residual).
- **Blind-spot I'm watching:** the "producer-only lifecycle-column facade" (revoked_at/al_enabled/
  allowed_origins written, never read/enforced) is at count 1 prior (RETRO-205) and keeps generating
  closures (633/636/637/627). The moment a NEW prior retro sights it, promote — but as a READ-side
  extension of the Rule-H lint (guard), not prose. Don't let the steady stream of CLOSURES trick me
  into thinking the PATTERN is being counted (closures are not new sightings).

---

### 2026-07-24 · RETRO-212 (PR #617 / FOLLOW-638 — cross-brand analytics rollup)

- **A finding I almost missed and why:** DRIFT-1 — the rollup counts `adapted`/`holdout` with
  `countDistinctIf(session_id)` while the mirrored `summary` route counts `countIf(rows)`. The PR
  loudly advertised "mirrors summary/lift" and the `sessions` count DID match (both DISTINCT), which
  nearly lulled me into passing the mirror as faithful. Only reading the two query bodies side by
  side line-for-line — not the JSDoc claim — exposed that `adapted`/`holdout` diverge. **Lesson: a
  PR's own "this mirrors X" claim is a hypothesis to falsify by diffing the actual SQL, never
  evidence.**
- **An axis/chain I had to trace twice:** the roster-join undercount (LG-1). First pass I saw
  "tenant in Postgres but absent from ClickHouse → real 0, honest" and almost moved on. Second pass
  on the REVERSE axis (CH tenant_id absent from the `deletedAt IS NULL` roster) revealed the totals
  accumulate INSIDE the `tenantRoster.map`, so orphan/soft-deleted sessions vanish from the platform
  total, not just the table. The "platform-wide" honesty gap only appears when you trace the
  direction the code does NOT iterate. Multi-axis discipline (step 8) paid out on a JOIN, not a
  contract field.
- **A meta-pattern in how gaps recur across agents:** two DIFFERENT "silent 0 / silent omission"
  honesty gaps this session both trace to the SAME root as RETRO-205/FOLLOW-637 — an analytics
  surface that shows a number without disclosing WHY it's 0 (feature-off vs no-data vs dropped-row).
  This honesty axis is becoming the dominant recurring class on staff/analytics surfaces. I flagged
  it forward into FOLLOW-647's escalation trigger rather than promoting a rule (still count 1 as a
  named _retro_ pattern) — but if the white-label epic surfaces it a third time, this is the
  promotion.
- **Restraint note:** resisted promoting the "same-runtime ClickHouse query fork drift" pattern to a
  Rule despite it feeling real (FOLLOW-093 is a prior sighting) — FOLLOW-093 was a follow-up, not a
  citable prior RETRO ID, so count = 0–1 of the required 2. Held. Guard-over-prose + threshold
  discipline both held.

## 2026-07-25 / RETRO-213 + RETRO-214 (PR #618 FOLLOW-622 de-scope + PR #619 FOLLOW-623 brand slice)

- **A finding I almost missed and why:** `white_label` in PR #619. The color and logo legs were so
  cleanly wired end-to-end (real-init-path e2e proving a rendered pixel — genuinely exemplary) that
  it was tempting to write "brand slice — clean ✅." But CHECK B is per-FIELD, not per-slice:
  `white_label` is emitted by the route and surfaced into `SdkConfig.brand.whiteLabel` at
  `index.ts:124` and read by NOTHING. A slice can be 2/3 wired. The "documented deviation" framing
  in the PR nearly disarmed me — honesty about a facade does not un-make the facade (RETRO-205's
  exact lesson). Grep of the CONSUMER side (`packages/sdk/src` excl tests) is what caught it: three
  hits, all producer/type/comment, zero read.
- **An axis/chain I had to trace twice:** the RETRO-205 closure chain. First pass: "#618+#619 close
  the two facades RETRO-205 filed — done." Second pass (step-7 discipline): #619 closes color+logo
  _end-to-end_ (pixel-verified, NOT one-hop) but the `white_label` leg's gap MOVED ONE HOP
  (DB→/api/config→editor now ALSO →public-config→SdkConfig). Same PR, two legs, opposite verdicts.
  And I had to trace whether `white_label` even HAS a definable consumer — grepping for "Powered by
  Estalara" and finding none means its semantics are UNDEFINED, not unimplemented, which changes the
  follow-up from "wire it" to "define it."
- **A meta-pattern in how gaps recur across agents:** the producer-only-facade honesty axis
  (RETRO-205 → 209 → 210 → now 214) is the dominant recurring class on staff/config/analytics
  surfaces — a control that a human can toggle but that changes nothing downstream. Every session it
  appears one layer deeper: first the DB column (205), then the analytics render (210), now the SDK
  config object (214 white_label). The rules that name it (H/K/L/U) already exist; the discipline
  that catches it is grepping the CONSUMER side and refusing "documented deviation" as a closure.
  Counted, not promoted.
- **Restraint / count-precision note:** the PM framed the `lessons.md` append collision as "the
  SECOND shared-file collision this week." Verified the exact mechanism instead of accepting the
  count: FOLLOW-644 (RETRO-211) is a semantic CODE-CONTRACT rebase collision (route.ts); this is a
  TEXTUAL append-only-log collision (lessons.md). Different root, different remedy → they do NOT
  compose one rule; the append-only variant is at count 1. Held. Filed FOLLOW-650 for the structural
  fix so the pattern is tracked without a premature promotion. Same restraint on the prettier miss
  (Rule B already exists — a compliance failure, not a new rule).

- **2026-07-25 / RETRO-215..219 (batch of 5, session 58).**
  - **A finding I almost missed and why:** #623 read like a clean CHECK B — the origin-gate consumer
    is well-tested and the semantics table is elegant, so my first pass wanted to write "producer +
    consumer both present." The catch was refusing to accept "provisioning writes it" from the PR
    prose and actually grepping for the WRITE: `grep -rn KV_API_KEYS` across the repo returns ZERO
    code writes — the KV record is operator-seeded out-of-band. The consumer's FAIL-SAFE (absent →
    inherit) is exactly what hides the gap: nothing breaks, enforcement just silently no-ops. Lesson
    (bank): when a PR says "seeded/projected at provisioning," grep for the actual writer; a
    fail-safe consumer + an absent producer is an invisible half-wire, not a clean wire. #624 was
    the SAME shape (brand_config.brand_name has no writer, fails honest to "Estalara") — I only
    caught it because #623 had trained me to grep the write side. Two PRs, one meta-shape:
    "external-brand go-live features add live consumers for operator-seeded tenant-config fields."
  - **An axis/chain I had to trace twice:** #620's PL/ES "no-network → EN fallback." First read I
    almost flagged it as an untested degradation (the ADR deviates from byte-identical PL/ES).
    Second trace: `resolveLabel` (`bag[lang] ?? bag.en ?? Object.values(bag)[0]`) IS unit-tested for
    the en-fallback AND first-value fallback, and follow-639.test proves absent-slice → built-in
    default. Honest and tested — downgraded from "gap" to "note." The parity claim needed the same
    discipline: I verified quiz-widget.test.ts actually walks all 17 leaves + the set assertion, not
    just the 2 leaves in follow-639.test. "The parity test exists" ≠ "the parity test pins all 17."
  - **A meta-pattern in how gaps recur across agents:** the append-only `lessons.md` collision is
    now the mechanical mirror of my own restraint — I banked it at count 1 in RETRO-213, held at 2
    in RETRO-218, promoted at 3 (RETRO-219, Rule AG) with strictly PRIOR priors. The disciplined
    count (don't let the promoting retro inflate) is what made the promotion defensible. Also: three
    prior audits missed the profiling-toggle because they all grepped `optOut|OptOut` and the symbol
    shipped as `ProfilingToggle`/`OptedOut` — absence-proofs need ≥2 independent search strategies.
    I HELD that at count 1 (distinct axis from AC/AD) and pre-authorized rather than forcing a
    promotion the same session I'd just promoted AG — resist the urge to promote two rules in one
    batch on thin counts.

---

- **2026-07-26 / RETRO-223 (PR #628, FOLLOW-658).**
  - **A finding I almost missed and why:** the PM handed me a framed question ("did the
    second-generation over-claim ship?"), and answering it consumed my attention while the _real_ P1
    sat one function away. `isUnprovisionedExternalTenant` reads as obviously safe — it trims, it
    returns `false` on blank, it has five tests, and four docstrings say a forgotten env can never
    black-hole first-party traffic. I nearly wrote "clean". What caught it was asking the question
    the tests did NOT ask: the suite pins UNSET, BLANK, WHITESPACE — three flavours of _absent_ —
    and nothing at all about _present but wrong_. A test suite that enumerates one axis exhaustively
    is a strong suggestion that the author only thought about that axis. Second-order lesson: the
    docstring's safety claim was itself the tell. "Can NEVER X" is a universal quantifier; I should
    reflexively look for the counter-example rather than reading it as reassurance — and here the
    counter-example (case-shifted UUID paste, across three unsynced stores) also flipped a fail-safe
    into total silent data loss, because the SDK never reads the response.
  - **An axis/chain I had to trace twice:** the ESC-040 doc-truth chain. First trace followed the
    two sites the ticket text named (tenants.ts, MASTER*DESIGN §V.3.4) → both corrected → "answer is
    (a), done". Second trace, forced by my own under-count guardrail (RETRO-001 missed 5 instances
    of one pattern), used `git log -L` on the \_third* file ESC-040's resolution table named but the
    FOLLOW-658 ticket did not — `api_keys.ts` — and proved the same claim entered at `d631a08` and
    left at `95a8492`. Three instances, not two. Lesson: when a ticket enumerates the sites of a
    defect, the enumeration is a _claim_, not a census — re-derive it from the escalation and from
    git history. I also had to trace the closure question twice in the other direction: the PM's
    grep hit was AC3 _quoting_ the defect, so the honest answer had to separate "live surfaces" from
    "append-only backlog history", and refuse to file the latter (rewriting dated backlog would
    destroy the very audit trail that let me trace the chain).
  - **A meta-pattern in how gaps recur across agents:** three consecutive retros (221 → 222 → 223)
    have found the _same shape at a different layer_: a guard whose UNSET branch is designed,
    documented and tested, and whose MIS-SET / partially-set branch is analysed by nobody. RETRO-222
    adjudicated the unset asymmetry of `FIRST_PARTY_TENANT_ID` as justified — correctly — and that
    verdict then functioned as a "this var has been reviewed" signal I had to consciously refuse. An
    adjacent retro's _clean_ verdict on axis A is not evidence about axis B; I now write the
    reconciliation sentence explicitly ("upheld and extended, not contradicted") so the next retro
    can see which axis was actually covered. Related: I held a new pattern at count 1 (multi-store
    identity value, asymmetric mis-set failure) rather than promoting on the PM's suggestion that
    the doc-truth pattern "may already qualify" — it did qualify, and was already Rule AH; the right
    answer to "should this be a rule?" was "it is one, here is its number, here is sighting five",
    not a second rule with a new letter. Resisting a promotion request is as much a part of the job
    as making one.

_(The RETRO-223 and RETRO-224 entries above were staged in `.retro-tmp/` because direct writes to
this file were permission-blocked in session 61; folded in by the RETRO-225 run, 2026-07-27, and
`.retro-tmp/` cleared.)_

---

- **2026-07-26 / RETRO-224 (PR #629, FOLLOW-659)**
  - **A finding I almost missed and why:** the consent **POST**. The brief framed the day's question
    as "is the GET-refuses / DSR-alerts asymmetry correct?", and both halves _are_ correct — I
    verified the DSR premise in code (neither the `dsrVerifications` insert nor the ClickHouse audit
    write persists a brand, so that path really creates no wrong record). Answering the question as
    posed would have produced a clean retro. What the framing hid is that the pair is not a pair:
    there is a **third** consumer of the same predicate class, and it is the only one that WRITES
    the attestation. The POST calls neither gate, and its two existing gates are satisfied by any
    valid hash — including the canonical Estalara hash the handoff still advertises as the default.
    Lesson: when a PR justifies an _asymmetry_, enumerate the full consumer set from the code (grep
    the predicate, then grep the write), not the set the rationale names. A two-row decision table
    is itself a claim that there are only two rows.
  - **An axis/chain I had to trace twice:** the 409's consumer. First pass I was about to apply
    RETRO-222's precedent verbatim ("a new status code whose only consumer is out-of-repo =
    contract-doc gap, not a half-wire") and move on. Second pass I grepped for the consumer instead
    of assuming the precedent's premise: `grep -n "GET /api/v1/consent" backlog/HANDOFFS.md` →
    **zero hits**, and the canonical go-live spec instructs the caller to compute its own hash, i.e.
    never to call the GET at all. That inverts the classification (HALF_WIRE_P, P1) and falsifies
    RETRO-219's "end-to-end within the consent flow" verdict. Precedents transfer only with their
    premises; the premise here was "the consumer exists AND was told", and only the first half was
    true.
  - **A meta-pattern in how gaps recur across agents:** this is the third consecutive retro in which
    a _closure_ was really a _relocation_ — FOLLOW-097→114→127→141 is the archived shape, and this
    wave reproduced it inside a single day: #624 built the consumer, #627 gated the omitted-hash
    path, #629 gated the GET, and the fabrication now sits on the POST. Each step was verified one
    hop and declared closed — including by me, in RETRO-222. The habit that catches it is
    mechanical: for every "closed" claim, grep the **terminal writer** of the state the gap
    corrupts, not the surface the ticket touched. Also banked: two new patterns HELD at count 1
    (gate-on-the-unused-door; cross-module round-trip assertion as a Rule Z _amendment_ axis) with
    no promotion — and the doc-over-claim axis the PM asked me to evaluate had already been promoted
    twice the same day (AH, AI), so "already codified, here are the sightings" was the more useful
    answer than minting a duplicate third rule.

---

- **2026-07-27 / RETRO-225 (PR #630, FOLLOW-678).**
  - **A finding I almost missed and why:** the alarm's _consumer_. I had already written CHECK B as
    "clean — no new env var, column, topic or SDK signal" when I re-read my own charter's list and
    noticed it says _SDK-signal_, not _signal_. The PR introduces a brand-new runtime signal
    (`first_party_tenant_id_malformed`) that is the entire point of one of its five ACs, and my
    category list had no slot for it, so it slid past. What caught it was the habit of grepping the
    thing rather than reasoning about it: `grep -rn "first_party_tenant_id_malformed"` returned two
    producers and two tests and nothing else. Then the second-order find, which is the one that
    mattered: `INGEST_WORKER_DEPLOY.md:123` — _in the very file this PR edited, four lines above the
    note it added_ — says `SENTRY_DSN_INGEST` is unset in prod and the channel is mute. The PR
    author read that file, wrote below that line, and did not read up. I nearly did the same,
    because I opened the file at the diff hunk instead of at the top of the section. **Lesson: when
    a PR edits a "known follow-ups / limitations" list, read the WHOLE list, not the hunk — that
    list is where the repo keeps the reasons your new mechanism will not work.**
  - **An axis/chain I had to trace twice:** Rule I's verdict. First pass I did what RETRO-222 taught
    me — compare the symbol/violation delta against `main`'s baseline (627/192 vs 618/192, +9
    symbols, +0 violations) — and concluded the new exports were wired. Second pass, forced by the
    charter's "every new export needs ≥1 **non-test** importer" wording, I grepped by hand and found
    the control-plane copy has none. Then I had to trace a _third_ time to explain the
    contradiction, and the answer was in `scripts/check-rule-i.sh:95-105`: the gate matches symbol
    **names** globally across `packages/ + apps/`, so the ingest twin of a deliberately duplicated
    name satisfies the control-plane copy — and it matches inside comments, so a docstring mention
    would have sufficed on its own. **Four consecutive retros (222-225) have cited that delta as
    non-regression evidence. A mechanical gate's output is evidence about the gate as much as about
    the code, and I had been reading it as only the latter.** Note for the next run: I under-called
    the DEAD_CODE severity to P2 against the charter's P1 default, deliberately and with the reason
    written down — the logic is live in-module, only the `export` keyword is unwired. If a future
    retro disagrees, the disagreement is with a stated argument, not a silent downgrade.
  - **A meta-pattern in how gaps recur across agents:** the "closure was really a relocation" chain
    (097→114→127→141; 627→629→684) reached its **fourth** consecutive retro — but changed character,
    and I had to be careful not to score that as a plain repeat. Here the residual (a well-formed
    but WRONG UUID) is _labelled_ in four merged surfaces, given a diagnostic procedure, and
    explicitly excluded from the safety claim. That is a genuine improvement and saying so is part
    of the job; an analyst who only ever finds decay teaches nobody. What keeps it inside the
    pattern is subtler and is the thing I want to carry forward: **the deferral's detector was
    itself unwired**, so the label is doing all the work. Two independent gaps composed into one —
    an honest deferral plus a producer-only alarm equals a silent failure with good documentation.
    Related discipline: I checked RETRO-222's pattern P-4 against its own written pre-authorization
    and **refused** to fire it, because both consumers _were_ fixed here and what remains open is
    another axis, not a second consumer. Bending a held pattern's premise to catch a nearby fact is
    exactly the error RETRO-224 caught itself making with the 409 precedent. The rule I did promote
    (AJ) I first tested against K.2, Q, AA and AI to be sure it was a new axis rather than a fifth
    rule on the doc-truth axis.
  - **Charter friction worth recording:** the dispatch brief asked me to update `backlog/QUEUE.md`'s
    session head and `backlog/HANDOFFS.md`. Both are outside this agent's write scope and QUEUE.md
    is named as forbidden, so I declined and surfaced the two items the PM actually needs (the QUEUE
    §session-63 class-closure over-claim, and the FOLLOW-680 P2→P1 recommendation) in §5a/§7
    instead. Second friction: the branch guard fired because HEAD was `main`. I did **not** create a
    branch — displacing HEAD under a running parent is the documented worse failure (session-41
    collision) — and instead left the three files modified in the working tree with an explicit
    hand-back note.

- **2026-07-28 / RETRO-228** (PR #633, FOLLOW-705 — canonical-consent-text ruling + doc/renderer
  sync gate)
  - **A finding I almost missed and why.** The white-label axis (§4a LG-3: `compliance@estalara.com`
    hardcoded in a text now ruled canonical for _every_ brand). I almost missed it because the PR's
    own argument was so good — "the renderer is brand-parameterized, therefore it is the only
    artifact that exists for a white-label brand" is correct, persuasive, and it made me stop
    checking the axis it was about. **The lesson is specific: when a PR wins an argument BY citing a
    property (parameterized, versioned, gated, idempotent), that property is the first thing to
    verify, not the last — it is load-bearing precisely because it was persuasive.** Reading
    `renderPlatformConsentText()`'s body line by line instead of its docblock took thirty seconds
    and showed the parameterization stops at the identity fields. The corollary caught the docblock
    contradiction too (`lib.ts:86-88` vs `resend.ts:17-22`), which no grep for the ticket's own
    keywords would have surfaced.
  - **An axis/chain I had to trace twice.** The DSR withdrawal channel. First pass concluded "the
    text names no address" — true, and one hop short, which is exactly the failure mode this charter
    exists to prevent. The second pass asked the question that mattered: does a channel exist that
    the text merely fails to _name_? That took four independent probes (the compliance corpus, the
    DSR routes' auth model, the app router's public surface, the DPIA's stated intake procedure) and
    inverted the finding's weight — `POST /api/dsr/initiate` is JWT-gated to tenant **staff**, so
    there is nothing for the text to name, and the DPIA's documented intake endpoint
    (`POST /api/v1/dsr/request`) does not exist at all. A missing address is a copy defect; a
    missing mechanism plus a phantom endpoint is an Art. 7(3) gap. Same evidence, different ticket,
    different priority. **Do not stop at "the disclosure is wrong" — establish what is true, then
    price the disclosure against it.**
  - **A meta-pattern in how gaps recur across agents.** Every ticket in this chain scopes its doc
    surfaces by **in-repo enumeration**, and `backlog/HANDOFFS.md` — the one document the only
    consumer reads — has now been missed by three consecutive merges (Rule AI, RETRO-226 → 227 →
    228). RETRO-227 predicted verbatim that a third sighting would make it "structural rather than a
    worker's miss"; the prediction fired, which is evidence the prediction mechanism works and that
    nothing consumes the predictions. The generalization worth carrying: **a ticket's "which
    documents assert this?" step is performed with a repo-scoped grep, so the artifacts that live at
    the system boundary are systematically invisible to it.** The counter-move is cheap and belongs
    in the delegation brief, not the retro: for any contract change, name the out-of-repo consumer
    and its document explicitly in the AC.
  - **Arithmetic discipline, applied against my own interest.** I declined to score RETRO-227's P-13
    (derived constant with no derivation test) as a second sighting: §4a LG-1 is the same constant
    in the same file, and counting a follow-up PR's failure to finish the same instance would be one
    defect wearing two dates. Held P-15 (the new pattern) at 1 prior retro for the same reason
    RETRO-227 held P-12/P-14. **Two retros running now hold patterns at count 2 with
    pre-authorisations — if the skill-upgrade run wants a faster rule pipeline, the lever is the
    prior-count definition, not analyst leniency.**
  - **Charter friction.** The brief asked me to investigate a finding, which I did, and the finding
    belongs in ESC-044's CEO/DPO conversation. I did not write `ESCALATIONS.md`, `QUEUE.md` or
    `HANDOFFS.md`; the escalation candidate is surfaced in §5b with severity for the PM. Also
    recorded a limit rather than guessing past it: branch protection is unreadable from here (403,
    private repo without Pro), so "hard CI gate" could be verified as _reporting_ but not as
    _merge-blocking_ — and #633 merged with 2 red checks, which is the observation that keeps that
    caveat honest.

---

## 2026-07-29 / RETRO-231 — FOLLOW-720 (#639), both consent gates' self-test fixtures

- **A finding I almost missed and why.** I nearly accepted the PM's verification wholesale, and it
  was accurate on every claim it made — the trap was that its claims were about the
  **contract-sync** repro (a GET `429` both-sides addition, which I reproduced and which genuinely
  passes 5/5 now). The ticket's headline was "unblocks FOLLOW-704/710/711", and the only way to test
  _that_ was to stop re-running the repro the ticket quotes and instead **run the fix against the
  next queued ticket that will exercise it.** I read FOLLOW-710's AC set, saw its fix rewrites the
  "contacting the agency's DSR contact" sentence, noticed that phrase is also the `bracketDrift`
  self-test anchor, and simulated it. It reddened — `FAIL`, with the exact misleading banner
  FOLLOW-720 exists to delete. Generalising: **when a ticket claims to unblock a named downstream
  ticket, the verification is the downstream ticket's diff, not the upstream ticket's repro.** Two
  consecutive retros in this chain now (RETRO-230 §4a DG-1, this §4a LG-1) found the gap by leaving
  the ticket's own scenario.
- **An axis/chain I had to trace twice.** Twice, both productive. (1) I first assumed the anchor
  would go `STALE` (the correct, new behaviour) and only found `FAIL` by actually running it — the
  cause was that `mustReplace` checks `str.includes(anchor)` **file-wide** while the gate compares a
  **sentinel-delimited slice**, and the phrase survives at `:263` and `:352` outside the block. I
  had to re-read the fix twice before seeing that the _same PR_ solved this correctly in the sibling
  script (`insertDocContractLine` is region-scoped by construction) — the asymmetry is the finding,
  and I'd have missed it if I had audited the two scripts as one unit instead of as two. (2) The
  P-16 promotion arithmetic: RETRO-230 pre-authorised promotion "on the 2nd numbered-retro
  sighting", which is _this_ retro. I nearly honoured it. Re-derived it against RETRO-227's
  P-12/P-14 and RETRO-229's P-15 wording ("promotion on the NEXT sighting", from count 2) and found
  RETRO-230's clause is drafted **one hop early** relative to the charter's ≥2-PRIOR bar. Declined,
  and recorded the drift instead of quietly resolving it. **A prior retro's pre-authorisation is not
  an authorisation — re-derive the arithmetic every time, including against my own predecessors.**
- **A meta-pattern in how gaps recur across agents.** The consent-gate chain has now displaced four
  times — prose (226–229) → tuple gate (230) → fixture anchor (720/#639) → **fixture anchor region**
  (this) — and every hop was closed by an agent that verified the _named_ scenario and shipped. The
  recurring shape is not carelessness; it is that **the remediation inherits the original's region
  assumption.** RETRO-230 §3 found Rule AK's `grep -rln` inert for the same reason (a predicate
  satisfied by matter outside the region it means to inspect); I filed that as P-17 REGION-BLIND
  ASSERTION with RETRO-230 as its prior. Second meta-note, more uncomfortable: the repo _already
  solved this class_ — the three shell gates synthesize fixtures in `mktemp -d` and never touch live
  sources — so the answer was in `scripts/` the whole time, one directory over, and neither the
  worker nor RETRO-230 nor I looked there until the repo-wide P-16 scan the PM explicitly asked for.
  **Before filing a fix-the-symptom follow-up, grep the repo for a sibling that does not have the
  problem; the structural answer is often already a precedent rather than a proposal.**
