<!-- STAGED FOR MANUAL PLACEMENT at
     .claude/agents/retrospective-analyst/lessons.d/RETRO-237.md
     (this session had no write permission under .claude/; same handling as the
     earlier .retro-tmp/ lessons backlog). Rule AG per-ticket fragment, not an
     append to the shared lessons.md. -->

# RETRO-237 — 2026-07-31 — FOLLOW-743 + FOLLOW-744 (PRs #646/#647, Sentry initialiser, COMBINED)

**A finding I almost missed, and why.** The status contradiction. I had already written most of §5d
agreeing that FOLLOW-744 was a reasonable `DONE` — the QUEUE.md prose is honest ("The DSN itself is
still not provisioned — that stays with Piotr"), the PM had split the axes in words, and the
ticket's AC-2 contains an explicit escape hatch authorising exactly what shipped. Three independent
reasons to nod. What broke it was reading the runbook §11 to the **last line** rather than to the
last instruction — the section ends with the ticket's own author writing _"this ticket ships
`CODE_COMPLETE_OPERATOR_PENDING`, **not `DONE`**"_. I had read §11 twice already, both times for its
operator steps, and stopped at step 5 both times because that is where the executable content ends.

The generalisable bit is not "read to the end." It is that **a document's status self-assessment
lives in its footer, and I read documents for their body.** Every artefact in this repo carries its
verdict where I stop reading: a runbook's Rule AA line at the bottom, a script's exit-code table at
the top, a stub's `cross_ref:` after the ACs. When the question is "does this ticket's own output
agree with its status label", the answer is in the metadata, not the content. Two commits apart (35
seconds of wall clock), one file says not-done and the other says DONE, and neither author was being
careless — they were reading different parts of the same PR.

**An axis/chain I had to trace twice.** Two.

_First, the gate-vs-guard interaction, traced in the wrong direction first._ The brief asked whether
the new CI gate still makes sense now that `init_sentry` can silently no-op. I spent the first pass
answering exactly that question — reading the gate's header, confirming it asserts call-shape not
runtime behaviour, concluding "yes, still sound, minor header drift." That is a true answer and it
is the boring half. The productive question was the inverse one nobody asked: **not "is the gate
still right about the code" but "is the gate right about itself."** So I stopped reasoning about it
and built four throwaway fixtures — a docstring mentioning `init_sentry(`, a trailing comment
mentioning it, a production file named `latest_pricing.py`, a fourth `observability.py` — and ran
the shipped script against each. All four PASS. That converted a plausible reading of a `grep -v`
regex into four measured false negatives, and it took about six minutes. I would not have found #3
or #4 by reading; I did not notice `*test*.py` is a substring glob until the fixture came back
green.

I am borrowing this straight from RETRO-230, which proved its gate finding the same way. Worth
naming so I keep doing it: **for any guard, reading the regex tells me what it catches; only a
fixture tells me what clears it.** The clearance side is where I was weak, and it is the side that
fails silently.

_Second, the promotion arithmetic on Rule AJ, which I had to talk myself back out of._ By the letter
it was count 3 with two prior retros and the amendment text pre-written by RETRO-235 — a free
promotion, already justified by someone else. I drafted it. Then noticed all three sightings are the
same artefact (`SENTRY_DSN`) on one unbroken displacement chain, which is precisely the inflation
RETRO-235 itself refused on the Rule J pattern eleven lines later in its own §6. Declining meant
also saying that RETRO-235's own 1→2 advance was soft, i.e. contradicting the retro whose reasoning
I was using to decline. That is uncomfortable and it is the right call: a rule minted off one
unresolved gap counted four times is a rule with one data point wearing a coat.

The asymmetry I want to remember: **I checked the AE promotion hard because I wanted it, and I
nearly did not check the AJ one because it was handed to me.** A pre-specified amendment from a
prior retro arrives with its evidence already framed, which makes it feel adjudicated. It is not; it
is an argument I inherited and still have to test. The AE one survived that test (three different
guards, three PRs, three subsystems). The AJ one did not.

**A meta-pattern in how gaps recur across agents.** _The remediation inherits the defect class of
the thing it remediates, and nobody looks._ This is now four consecutive links in one chain, and
each link's author had every reason to feel finished:

- RETRO-234 found unhardened `sentry_sdk.init(` sites → FOLLOW-738 built a guard around `init(` →
  the one file needing an init **because it never had one** was invisible to it (RETRO-235).
- FOLLOW-743 built the inverse guard to close that → and reproduced the sibling guard's own
  whole-line-comment bug (RETRO-235 CB-4, still open as FOLLOW-746), inverted from a loud false RED
  to a silent false GREEN.
- FOLLOW-744 made `init_sentry` non-fatal → and left the docstring 60 lines above asserting the
  function's **only** skip condition is the one it just stopped being.

Three fixes, three inherited defects, all inside eight days and one subsystem. What they share is
not carelessness — every one of these PRs is well-written, well-tested and honest in its body. What
they share is that **the author's attention was on the gap being closed, and each defect lived in
the apparatus doing the closing.** The comment filter, the docstring, the exclusion list: the parts
of a fix nobody re-reads because they are not the fix.

The retro-side consequence I am acting on: when a PR's whole purpose is to remediate a prior retro's
finding, **the highest-yield place to look is not the fixed code — it is the new mechanism**, and
the question to ask about the mechanism is the same question the prior retro asked about the
original (what shape does this miss?). Both of this retro's P2 findings came from there. Neither
came from the code that was actually changed.

_Second, smaller, and it is a counting phenomenon I want on record._ Across #644/#646/#647 the
Python tier accumulated three CI gates, five capture sites, one hardened initialiser, three mirror
copies and four unit tests, and has delivered **zero events in any environment**. Each ticket was
correctly scoped and each retro's verdict on its own ticket was defensible — including mine. No
single Rule AA verdict can see this, because Rule AA is per-ticket and this is an accumulation. That
is why I minted P-21 rather than folding it into an existing rule, and why I wrote three explicit
second-sighting criteria: the pattern is only visible by counting across tickets, so the next retro
will need the count handed to it rather than an intuition.

**On the combined-entry format, since it was a first.** Two PRs in one retro was the right call and
not for the reason the brief gave. "Both small, same subsystem, same session" is a convenience
argument. The real justification is that **three of this retro's findings do not exist in either PR
alone** — #646 gates a call-shape, #647 changes what that shape does at runtime, and the docstring
falsification, the overloaded return contract and the "gate as substitute for channel" arithmetic
all live in the seam. Had I written two retros, each would have been individually correct and
jointly blind. Worth keeping as a heuristic: **combine when the seam carries findings, not when the
diffs are small.** And split the verdict inside the combined entry — §5d agrees with one `DONE` and
disputes the other, which a single-verdict entry would have blurred toward the middle.
