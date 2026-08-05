# Retrospective-analyst lessons — RETRO-248 (FOLLOW-832 / PR #678)

**Date:** 2026-08-05 · **RETRO-248** · analyst: Opus, worktree `.claude/worktrees/retro-248-249`

## A finding I almost missed, and why

**The gitleaks lesson was already in the repo — twice — and I nearly wrote it up as a new finding.**
The brief asked me to "check whether either has a prior sighting," which I read as "grep
RETROSPECTIVES.md." That grep returns nothing on the commit-range fact, and I was one keystroke from
recording "no prior sighting, count 1." What saved it was greping `--include="*.toml"` as well:
`.gitleaks.toml:254-266` (FOLLOW-774) states the commit-range behaviour verbatim, and — worse —
commit `244e03bf`, the very commit that created this ticket's false control **one day earlier**,
states it _and_ the corrected length-AND-entropy explanation in its message.

**Lesson for the next analyst: "prior sighting" is not a synonym for "prior retro."** They are two
different questions and the retro corpus answers only one of them. The rule-promotion bar counts
retros; the _cost_ question — "did we already pay for this?" — has to be asked against
`.gitleaks.toml`, `git log --format=%B -S<term>`, and code comments. In this case the two answers
diverged completely: zero prior retros (so no promotion) and two prior recordings (so Rule P fires
and the finding is a discoverability ticket, not a rule). Getting both right is what made the
adjudication defensible instead of arbitrary.

## An axis / chain I had to trace twice

**The sibling sweep, because my first pass was scoped by the wrong noun.** I began by grepping for
the _mechanism_ (`_neutral_payload`, tests calling a production private helper to build an expected
value) and got **zero hits** outside the ticket. I was about to report "the sweep comes back thin,"
which the brief explicitly invited. Second pass, scoped by the _confession_ instead — the words
authors use when they know they are doing it (`replica`, `mirrors the production`,
`built exactly as`, `replicates`) — returned five candidates in two packages and two languages, two
of them confirmed, one of them (`follow-383.test.ts`) with an explicitly false non-vacuity claim
guarding a CEO-ruled privacy control.

**The generalisable bit: this defect class is reliably self-documented.** Nobody writes a replica
without a comment apologising for it. Grep the apology, not the mechanism.

**Second thing I traced twice:** I nearly reported `follow-383.test.ts` as "the §H.9 opt-out control
has no real-path coverage." False — `follow-389` and `follow-409` both import `_initForTest` from
`../index.js`. The true statement is narrower and took a third read of `follow-389`'s own header:
those cover the `:1646` and micro-poll arms, and the `:1137` arm is the unpinned one. **The
narrow-true claim is worth more than the broad-nearly-true one**, and it is exactly what RETRO-247
§4a LG-1 was filed against on the other side (a sink-wide negative on branch-wide evidence). I was
one paragraph from committing the same error inside the retro that inherited it.

## A meta-pattern in how gaps recur across agents

**Three consecutive retros (246, 247, 248) have ended at the same sentence: the rule exists, the
enforcement does not.** RETRO-246 declined to amend Rule S because Rule S already fired. RETRO-247
declined again, for the same reason, and filed a gate instead. RETRO-248 declines to promote the
gitleaks pattern because Rule P already fires. That is now a stable property of this estate, not
three coincidences, and it changes what a retro is _for_: the marginal value of a new rule here is
close to zero, and the marginal value of a mechanical check or a greppable runbook is high.

**Corollary I want the next analyst to inherit: resist the pull to promote.** Four separate rule
candidates crossed my desk this session (P-32 replica assertions, P-33 incidental ordering, P-34
un-greppable knowledge, and the FOLLOW-739/832/837 "documented control that does not exist" trio the
brief specifically asked me to weigh). All four came back below the bar or already-covered. Writing
"NO PROMOTION" four times in one session feels like under-delivering. It is not — the bar is the
only thing keeping `CONVENTIONS_PATCH.md` readable at 3,600 lines, and my predecessor held the same
line at the same count on Rule S. **The deliverable of a rule adjudication is the reasoning, not the
rule.**
