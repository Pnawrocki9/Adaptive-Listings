# RETRO-263 — 2026-08-09 — FOLLOW-902 (#699), 903+904 (#700), 849+909 (#701), 915 AC(0) (#702)

## A finding I almost missed, and why

**The floor's ARITHMETIC INTERACTION with a skipped-by-design job.** I nearly stopped at "SKIPPED is
classified as non-failure, therefore the gate is green over it" — which is true, provable by reading
one regex (`:702`), and only half the finding. The brief said _test whether skipped-by-design jobs
interact with the floor safely, rather than assuming they do_, so I measured the peer sample instead
of reasoning about it: `87 → 91` across this merge window, floor `35 → 37`, tolerated absence
`52 → 54`. **A permanently-skipped check-run is a free unit of cardinality: +1 reference, +0.4
floor, +0.6 tolerated absence.** That sign is the finding, and it is invisible unless you take the
number. Reading the regex gives you a defect; taking the number gives you a defect that GREW in this
merge.

**Second near-miss: I ran an invalid probe and it passed.** My first R-F1 test copied
`check-modal-local-imports.py` into a scratch dir and truncated the complementary control there —
but `_repo_root()` shells out to `git rev-parse --show-toplevel`, and my `cd` into the repo made the
self-test check the REAL file. It printed `PASS` and I almost banked it as "existence-only assertion
is fine". A probe that runs in the wrong frame produces a confident, wrong result **in the direction
that ends the investigation**. Re-ran it in an isolated `git init` tree: zero-byte → PASS, deleted →
exit 2. **Before trusting a script-under-test result, ask what the script resolves its own root
from.**

## An axis / chain I had to trace twice

**FOLLOW-902's Sentry channel.** First pass: `init_sentry("SENTRY_DSN")` is DSN-gated, the
data-quality key gate asserts `--required "DATABASE_URL"` only, therefore the re-routed
`zero_coverage`/`config_gap` alerts have no consumer → a P1 HALF_WIRE. That was a clean, plausible,
well-evidenced story and **it was wrong.** I ran the repo's own probe against prod
(`modal run scripts/check-modal-secret-keys.py::check --required "DATABASE_URL,SENTRY_DSN"`) →
`SENTRY_DSN: present`. The finding survived at one third the size (nothing ASSERTS the DSN; no
message has ever been observed to land) and dropped from P1 to P2. **The absence of a gate is not
the absence of the thing the gate would check** — I inferred a negative from a control's silence,
which is the exact error Rule AR was promoted for one retro ago, and I made it against Rule AR.
Measuring took 40 seconds.

**Also traced twice: FOLLOW-849's closure.** One hop looked closed (fix + red-first fixture, both
verified). End-to-end it is not: the guard covers `Edit|Write|MultiEdit`, and the estate's own
operating mode pushes agents to Bash. Step 7 exists for exactly this and it paid.

## A meta-pattern in how gaps recur across agents

**The estate reports the direction it can see, and only that one** — now quantified: six independent
worker reports of the branch guard in one day, all of them the noisy half, zero of the silent half,
and the silent half was the failure the guard exists for. The same asymmetry, on the same day, in a
different subsystem: the merge gate's six cardinality fixtures all vary rollup SIZE and none varies
MEMBERSHIP, because no one has ever filed a bug about a check that was merely skipped. Promoted as
Rule AS, with RETRO-252 §5d ("a changelog cannot fail on a regression in something that never had a
bug filed against it") and RETRO-237 §4b as the two priors. **RETRO-252 predicted this defect class
on this exact artefact and I found it on the next generation of that artefact.** The prediction was
in the log for three days and nobody executed it.

## For my own process

1. **When a PR ships two artefacts that reference each other, perturb the reference, not the pair.**
   `R-F1` is the most interesting thing in #700 and its whole content is `.exists()`.
2. **Two rule promotions in one retro is defensible when both armings were explicit** (RETRO-261
   minted P-41 "at 1 prior — not promoted"; RETRO-252/237 were unbanked but verbatim). What is NOT
   defensible is promoting on a count I did not state — I stated both, including that neither
   promoting retro inflates its own count.
3. **The best evidence in this retro was executed, not read**, in every case: the fixture harness (2
   runs), the pre-fix guard (1 run), the negative control (1 run), the two hooks on one edit (2
   runs), the prod secret probe (1 run), the bundle gzip (1 run), the isolated self-test (2 runs).
   Ten executions, four of which changed a verdict I had already written down.
