# RETRO-252 — FOLLOW-846 / PR #683 — 2026-08-06

**A finding I almost missed, and why.** I found the false green by accident. I was building a
fixture to demonstrate the PR-side/baseline provenance asymmetry, got the snapshot JSON shape wrong
(an extra `bucket` key), and the gate printed
`Total checks: 2 | success: 0 | skipped: 0 | neutral: 0 | failing: 0` → `all checks green` → exit 0.
My first instinct was **"my fixture is malformed, fix it and move on"** — and I nearly did. What
stopped me was that the arithmetic on the line was impossible: two checks, none in any bucket. **A
malformed input that produces a confident wrong answer is a finding, not a mistake in my setup.**
Standing correction for me: when a probe misbehaves, read the tool's output for internal consistency
before assuming the probe is at fault. RETRO-250 found its headline the same way (a gate that
blocked a PR while it was being checked); two consecutive retros have now found their sharpest
defect in an accident, which suggests **deliberately feeding gates malformed inputs belongs in the
method**, not only perturbing their source.

**An axis/chain I had to trace twice.** RETRO-250 — my own immediate predecessor — warned FOLLOW-842
not to change `check-rule-i.sh`'s `WARN:` line shape. I was about to repeat that warning. Reading
the actual code, the WARN line is `echo "WARN: '${sym}' in ${file} …"` and is **independent** of the
`grep -oP` extractor 842 is scoped to touch; the real hazard is that the extractor decides _which
symbols_ are emitted, and the PR's Rule I job runs the **PR's** script while the baseline ran
**`main`'s**, so an extractor change makes the two sides different producers and the PR blocks
itself. **Inheriting a predecessor's cascading warning verbatim would have passed on a warning that
points at the wrong line.** A prior retro's finding gets the same re-derivation as a PR body.

**A meta-pattern in how gaps recur across agents.** Rule AI's tier-0 amendment — "update the corpus
that EXECUTES the instruction before the prose that describes it", naming `.claude/agents/*.md`
explicitly — was landed by RETRO-246 on 2026-08-05 and violated by PR #683 on 2026-08-06, by the
same agent class, on the same corpus, about the same script. **Twenty-one hours.** I keep writing
"the rule exists, the enforcement does not" (RETRO-248 §6 said three retros running; RETRO-250 said
it had moved one layer out). This is the sharpest instance yet because the interval is short enough
to exclude every alternative explanation — nobody forgot it, nobody disagreed with it, nobody had
time to. **The corollary for my own output: a rule I decline to promote because "the existing rule
is adequate" is only a real answer if I also name the mechanical slice.** I did that in FOLLOW-854
AC(4). When I cannot name one, I should say the finding has no remedy rather than let "compliance
failure" stand as a conclusion.

**On my own priors.** RETRO-250's P-35 bar demanded _demonstrated_ non-determinism. I found a second
instance of the shape and could not meet clause (b) — I drove the mechanism but never observed a
verdict flip. Holding the pattern at count 1 cost me a promotion I would have liked to make, and
that is the bar working. I wrote the discharge procedure into FOLLOW-855's AC(5) so the next retro
tests rather than re-argues.
