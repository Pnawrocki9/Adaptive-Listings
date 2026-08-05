# RETRO-247 — FOLLOW-812 (PR #677) — 2026-08-05

**A finding I almost missed and why.** I nearly closed §4c with "the new test is non-vacuous, the
worker proved it by perturbation." That is true — for sink 3. It is false for sink 2, and I only
caught it because I asked a mechanical question instead of a narrative one: _"which object does each
assertion actually hold?"_ Sink 2 holds a payload the TEST builds by copying `nlp.py:504`'s
expression, and its own comment at `:228` says so out loud — "built exactly as `nlp.py`'s
primary-failure branch builds it". The docstring two paragraphs up claims perturbing the production
side would fail it. The lesson for me: **a PR that adds a proven-non-vacuous assertion is the most
dangerous place to stop looking**, because the demonstrated rigour on the new lines launders the
inherited lines. The general form of the question that found it: for every assertion in a test the
docs cite as a pin, name the object under assertion and ask whether production produced it or the
test did.

**An axis/chain I had to trace twice.** The Rule S verdict. My first pass had the shape "two
consecutive sightings, both PM-caught, therefore amend Rule S" — which is exactly the reasoning
RETRO-246 warned against when it reconciled the session-101 note. So I re-ran it the way RETRO-246
did: open the rule's TEXT, run it verbatim against the PR, and ask whether it would have reported
clean. It would not — bullets 1 and 3 both fire on PR #677. That flips the verdict entirely: the
rule is adequate and was simply not applied, so amending it would be count-inflation on an
already-promoted rule and would produce noise instead of a control. The second trace also produced
the better follow-up (a gate, FOLLOW-834, instead of more prose). **"Would the rule, run verbatim,
have caught this?" is now my first question on every promotion candidate, not my last.**

The second thing I traced twice was the sibling set itself. My first sweep of "prints that could
leak" stopped at `nlp.py` because that is where the ticket pointed. The second sweep —
`grep -rn "print(" apps/*/src/*.py apps/*/src/jobs/*.py` — found `batch_enrich.py:72` wrapping
`extract_intent(session["messages"], …)`, i.e. the batch tier's own buyer conversations, plus
`nlp.py:344` and `observability.py:175`. None is a proven leak and I said so plainly rather than
inflating three unassessed sites into three findings; but the doc sentence the PR shipped quantifies
over the whole sink, and that is where the real gap is. **The scope word in a compliance sentence is
the assertion. Diff the scope word against the fixture, not against the fix.**

**A meta-pattern in how gaps recur across agents.** Two consecutive tickets were saved by the PM
reading a worker's honest "here is what I did NOT do" paragraph — FOLLOW-813's worker flagged the
agent-definition set, FOLLOW-812's worker flagged the retry branch and the retention gap. In both
cases the flag was correct and the deferral defensible on the ticket's literal wording. The honesty
is working; the mechanism behind it is **one human reading one paragraph**, which is the same single
point of failure P-30 describes for blocked `.claude/` writes. That equivalence is why I promoted
the P-30 half that codifies the PM's landing obligation (Rule AG amendment) and filed a gate rather
than a rule for the Rule S half. The pattern to watch next: workers are getting better at naming
their own residuals, which shifts the failure mode from "the gap was invisible" to "the gap was
visible in prose and nothing consumed the prose." That is a HALF_WIRE with a human in the consumer
slot, and it will recur until the consumer is mechanical.

**Process note for my own successor.** The perturbation that proved TG-1 was run in a `cp -r` of
`apps/intent-engine` under the scratchpad, never in the working tree (Rule AM). It cost about ninety
seconds and converted "this test looks weak" into "this test is provably a false control, here is
the transcript." Do it every time the claim is about whether a test can fail. Also: `git diff --stat

<base> <merge>` was wrong for this PR by a factor of two (12 files vs the real 5) because other
commits landed on `main` in between — `gh pr view <n> --json files` is the measurement, and I checked
rather than repeating the number I was handed.
