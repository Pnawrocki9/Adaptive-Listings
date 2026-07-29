# RETRO-233 — 2026-07-29 — FOLLOW-729 (PR #641, local intent-engine dev shim)

**A finding I almost missed, and why.** The whole retro nearly ended at "small, clean, additive PR —
few findings," which the brief explicitly authorised as a valid outcome. What broke it open was
refusing to accept one sentence of the PR's own honest self-report: _"an authenticated POST 500s on
the missing `ANTHROPIC_API_KEY`."_ It was reported openly, not hidden, it appeared in four separate
records, and it was framed as an operator problem — three reasons to nod and move on. I read
`nlp.py` anyway and found `extract_intent` is documented **"Never raises"** and swallows every
exception into a neutral payload. So the Anthropic key cannot produce a 500. The 500 is
`KeyError('UPSTASH_REDIS_REST_URL')` from a completely different dependency. I proved both halves by
executing the merged endpoint twice with different env sets rather than arguing from the source.

The lesson is not "verify claims" — I already do that for claims a PR makes about its _own_ code.
The lesson is narrower and I had not internalised it: **a PR's report about a dependency it did not
write is the least-verified sentence in the whole artifact.** The author observed a 500 and a log
line in the same terminal scroll and inferred causation; the reviewer had no reason to doubt it; the
PM reproduced the 500 (correctly) and thereby _confirmed the symptom while inheriting the wrong
cause_. Reproducing a symptom is not verifying an attribution. That distinction is now something I
check for explicitly.

And the payoff was not pedantic. The correct attribution inverts the operator's risk: the credential
that fails LOUD is Upstash, and the credential that fails **green** — 202, shadow key present, zero
archetype movement — is Anthropic. So the recorded advice pointed the next human at the safe failure
and away from the dangerous one, on the exact loop the CEO named as the standing priority.

**An axis/chain I had to trace twice.** The neutral-write chain. First pass I had it as a P1: a
fabricated payload written into a key that `/api/adapt` reads unconditionally and that the SDK folds
into the Bayesian archetype state — that reads like archetype poisoning plus a burned Rule R
one-per-session gate. I wrote it, then traced the consumer side properly instead of stopping at
"there is a consumer." `flattenIntentDimensions` drops nulls → `{}`; `adapt.ts` gates on
`Object.keys(dims).length > 0`; so the neutral payload is skipped, the archetype is untouched, and
`chatPriorApplied` is never set. Downgraded to P2 with the containment written into the stub as an
explicit "do not over-fix this."

That is the same discipline as my own step 7, applied in the direction I am less practised at. I am
well drilled on tracing a chain forward to find a gap the ticket declared closed. I am less drilled
on tracing forward to find that a gap I just declared **open** is actually contained — and the
failure mode there is inflation, which is quieter and more flattering than under-counting. Two
paragraphs of a P1 finding survived until the third grep. Worth remembering that my incentives point
one way here and the guardrail against manufacturing findings has to do real work.

The second double-trace was the credentials chain (§4a LG-3). I initially wrote "the gap moved one
hop downstream," then built the six-row table and found it moved to **three** hops, two of which
(missing Anthropic key, and a writer/reader Upstash DB mismatch) produce a **byte-identical
symptom** through unrelated causes. "One hop" would have been a true sentence that concealed the
actual shape.

**A meta-pattern in how gaps recur across agents.** Two, and they compose.

_First: honesty about a gap is repeatedly mistaken for tracking of that gap._ This PR did everything
right on disclosure — AC5 answered NO, in the PR body, in QUEUE.md, in the stub. And the disclosure
became the reason nobody escalated it, even though FOLLOW-729's own AC5 pre-authorised an escalation
in writing and Rule AA says an operator-gated ticket is never `DONE` on code alone. QUEUE.md records
`status: DONE`. The prose next to it says the loop does not work. **Candour discharges the reporting
obligation and then quietly substitutes for the tracking obligation** — nobody feels the absence of
a ticket, because the paragraph is right there. This is the same organ as the RETRO-230/231/232
chain I have been writing up for four retros running (the code a PR did not change but did
annotate), one level up the stack: there it was a comment certifying neighbouring code, here it is a
paragraph certifying a neighbouring gap. Certifying is cheap; fixing is not; the certificate is
where the next gap lives. I should stop treating that as a code-comment phenomenon.

_Second: a ticket's option set becomes the retro's option set unless the retro fights it._
FOLLOW-729 AC1 offered a binary — import `main.py`'s logic, or duplicate it with a keep-in-step
comment. The worker verified the first is genuinely impossible (I re-derived this with real `modal`
1.4.2: `modal.functions.Function`, `callable(...) == False`) and took the second, correctly and with
a good comment. I verified the justification, found it sound, and nearly filed the duplication as
"unavoidable, needs a gate." Then noticed the binary omits the obvious third option — **extract the
shared logic into a sibling module both import** — which has nothing to do with Modal decorators and
was foreclosed by AC4 ("don't touch `main.py`"), not by any technical constraint. So the duplication
is a **scoping artifact wearing the costume of a technical necessity**, and it would have entered
the permanent record as the latter. Generalised: _when a ticket says "reuse X or duplicate X",
"extract X" is invisible, because the ticket already named X as the thing to reuse._ I have written
this into FOLLOW-732 so the next editor does not inherit "we had to."

**On promotion discipline (holding, not promoting).** The Rule J / Rule K.1 scope gap is now at
count 2 — RETRO-231's `scripts/*.mjs` helper triplet (FOLLOW-725), and this Python intra-app partial
mirror. Two sightings, but only **one prior retro**, and the house convention (RETRO-232 §6: "count
3, = 2 PRIOR RETROS. THRESHOLD MET") is unambiguous. Held. It was tempting: I had proved
`check-mirror-files.sh` is structurally incapable of Python (comment-strip regexes for `/* */`, a
signature grep for `^(export )?(async )?function`), which felt like enough on its own. Proving a
gate _cannot_ cover a case is evidence about the gate's scope, not a second occurrence of the
pattern — and conflating "I have strong evidence" with "the threshold is met" is exactly how
premature codification gets rationalised. What I did instead, and would do again: write down what
the third sighting must carry so the eventual amendment is not under-scoped (language-agnostic
comparison **and** region-scoped rather than file-scoped — neither instance so far is a whole-file
mirror), and flag the counting question the third sighting will raise (§5b says it will arrive as
llm-gateway copying `local_dev.py` — if one PR's decision is copied N times, is that N occurrences
or one?). Recording the question now costs a paragraph; re-deriving it under promotion pressure
costs judgement.

**One hypothesis falsified, recorded because negative results are load-bearing.** The PM flagged the
terminal-close recovery (worker output surviving uncommitted in the MAIN working tree) as a probable
third undocumented variant, alongside two existing operator memories. It is documented —
`docs/AGENT_WORKFLOW.md:171-181` describes this exact variant, and `:193-212` is a mandatory
"Recovered-work re-verification" procedure the PM followed. No stub. Two retros ago I would have
filed one, because the brief suggested it and a doc stub is cheap and unfalsifiable. **A suggested
finding is still a finding I have to prove.** Reporting "this one is already covered, and the
convention has now been exercised and held" is more useful to the process than a fifth stub, and it
is the only kind of statement that keeps "few findings" credible when I do say it.
