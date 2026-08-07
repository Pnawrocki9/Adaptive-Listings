# RETRO-260 — 2026-08-07 — PR #692 (FOLLOW-875 + FOLLOW-877, `e55063b0`) + PR #693 (FOLLOW-881, `dc36740a`)

**A finding I almost missed, and why.** `git status` showed `.claude/agents/architect/lessons.md`
modified, and my first read was "not my file, someone else's uncommitted work, skip it." I only
opened it because I was about to commit and wanted to be sure I did not stage it. **It contained, in
its last sentence, the exact rule amendment I had just spent a full sweep re-deriving** — the
FOLLOW-881 architect had already written "grep the constant's NAME and its VALUE; the fourth
statement was findable only by value." The near-miss was not analytical, it was procedural: **I
treat `git status` as hygiene (what must I avoid staging) rather than as evidence (what did the last
merge fail to carry).** Standing change: on every retro, read the diff of every
modified-but-uncommitted file in the tree before writing §4 — an unlanded file is by construction a
thing the merge dropped, which is the retro's subject matter. Corollary: the artefacts most likely
to be dropped are the ones a no-Bash agent cannot commit itself.

**An axis/chain I had to trace twice.** The undamped-boost class. First pass I accepted #692's "two
paths bypass BEHAVIORAL_DAMPING entirely" because both cited paths checked out — `filter.applied`
genuinely never touches `effectiveDamping`. Second pass, only because I was reading `intent.ts`
linearly for something else, I saw that `feature.expanded`'s step 1 **is** damped and that there are
two more intercepts (`listing.bookmarked`, `micro_poll.answered`). Then one grep found
`packages/shared/src/schemas/intent-weights.ts:110-114` enumerating **all four** — the repo had
written the class down and neither the worker nor my first pass looked. **Verifying the cited
instances is not verifying the claimed class.** A claim of the form "the N paths that do X" needs
the grep for X, not the check of the N cited. That is the sharper statement of Rule P for this
retro: prior-art search is not only "was this filed before", it is "did we already enumerate this
set".

**A meta-pattern in how gaps recur across agents.** Three rounds of competent correction, each
finding more than the last, and the mechanism turned out to be uniform: **every sweep inherits the
vocabulary of the round that found the bug.** Round N speaks in symbols, so round N sweeps symbols,
so round N+1 finds the bare literals. Nobody was lazy — FOLLOW-882's AC(4) is a _good_ control, it
is just monolingual. The generalisation I now carry: **when a retro promotes a "sweep for siblings"
control, ask in what vocabulary the claim can be spelled that the sweep cannot read.** For a
threshold it is name / value / prose. For a flag it will be name / string literal / the behaviour's
description. Second meta-pattern, worth watching: **the same PR contained the correct control and
did not apply it to its own sibling** (`readServerConfidenceGate()` in the harness vs a hardcoded
`0.6` in the test). Twice now — RETRO-259 saw perturbation prove an assertion _can_ fail without
proving it measures the right thing; here a reader that refuses to drift sits ten files from a
literal asserted against itself. **Scope, not knowledge, is the failure mode in a mature estate** —
which is also why the ninth consecutive "the model tier is not the control for enumeration
completeness; the AC is" is not a routing complaint but a brief-template complaint.

**Bar I pre-specified for my successor (do not re-derive):** P-40's three clauses (§6), the
FROZEN-re-pricing bar (a fifth sighting after FOLLOW-849 closes AND no same-session re-pricing), and
P-39 stays at count 1 — I refused this retro's near-miss on clause (a) because P-39 requires the
assertion to _read_ from source and CB-1 hardcodes.
