# RETRO-310 — #849 (FOLLOW-1098 + FOLLOW-1099) — 2026-08-25

**A finding I almost missed, and why.** The headline (§4a LG-1 — the new AC(5) conjunct is a 7-day
whole-substrate count, so it is falsifiable only on a fresh ClickHouse) was sitting in **the PR's
own evidence, phrased as a virtue**: _"the red-first control, executed — not argued. On a FRESH
ClickHouse … zero prior rows — so the 7-day window carried no debris."_ I read that sentence twice
as rigour before I read it as a **precondition**. The tell I should reach for faster: **when a
control specifies the substrate state it was executed on, ask whether it holds on any other state.**
A red-first proof that needs a virgin database is a proof about a database, not about a predicate.
The confirming arithmetic was also already in the artefact (`adaptedN: 7`, `adaptedConversions: 3`,
`syntheticControlRunsInWindow: 7` — so ≥2 of the 3 conversions belonged to earlier runs), and I only
computed it after the SQL told me there was no session filter. **Read the predicate's REGION before
reading its evidence.**

**An axis/chain I had to trace twice.** Two, and both times the second pass overturned the first.

1. **The `preflight writes an adapted row` premise.** I accepted it on the first pass because it
   arrived with RETRO-309's authority and it made the decay narrative tidy. On the second pass I
   read the preflight's actual call — `{}` body, no `Authorization` header — and
   `adapt/route.ts:1360` 401s before schema parsing. The premise had travelled retro prose →
   FOLLOW-1098 stub → **shipped source comment** without anyone opening the function. **My
   predecessor's finding is not evidence; it is a hypothesis with a citation.** I now re-derive any
   inherited premise that a new artefact makes load-bearing.
2. **The Rule AU lineage.** RETRO-309 §6 says "third sighting on this one harness (RETRO-298 §LG-1
   …)". I nearly repeated the count. RETRO-298 §4a LG-1 is about `check-mirror-files.sh`, and #825
   merged **before** the PR that authored the harness — so it cannot be a sighting on it. **A
   lineage claim is a claim; the ordering of the merges falsifies it in one `git log`.**

**A meta-pattern in how gaps recur across agents.** Three turns of one screw, and the interval is
shrinking rather than the defect: RETRO-301 (AC(5) permanently `null`) → RETRO-309 (permanently
non-`null`) → RETRO-310 (satisfiable from a 7-day pool). Each remediation narrowed the window in
which the assertion is vacuous and none of them changed its **region**. The generalisable rule I
want the next retro to apply first: **an assertion about a RUN cannot be evidenced by a query whose
scope is a WINDOW** — and the diagnostic question is not "can this predicate be false?" but "can
this predicate be false **on the substrate the runbook actually produces**?"

Second meta-pattern, minted as **P-86** at count 2: **a finding filed against a document SECTION
survives every regeneration of that section**, because the regeneration is authored from the run and
not from the findings list. README §0 has now inherited FOLLOW-1080 through three rewrites by three
tickets. Nothing links a `FOLLOW_UPS.md` entry to the file it is about, so the link exists only in
whichever retro last mentioned it.

**A discipline that paid, recorded so I keep doing it.** I ran the dissolution test on my own
headline before filing it, and **two** existing letters caught it — Rule AU on the predicate, Rule
AV on the _POINT IN TIME_ axis its own text already names. That is the seventh consecutive retro
with zero promotions, and it is the right outcome: the estate's problem is not a missing rule, it is
that Rule AU was **cited by name in the same comment block that violated it**. Citing a rule is not
complying with it, and a retro that mints a letter instead of saying so is making the corpus longer
and not sharper.

**Guardrail exercised.** The launching agent invited me to file `ESC-073` if anything warranted
escalation. Two findings are escalation-shaped (FOLLOW-820 condition 1's ambiguity; FOLLOW-1122's
blast radius). I did not write `ESCALATIONS.md` — this agent's guardrail forbids escalating on the
PM's behalf, and an agent's instruction is not consent to change my configuration. Both are surfaced
in §5 with severity and ready-to-paste framing; ESC-073 remains free. **Record this as the pattern:
the useful output of a guardrail collision is a finding the PM can act on in one paste, not a
refusal.**
