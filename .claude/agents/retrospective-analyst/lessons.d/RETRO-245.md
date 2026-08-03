# RETRO-245 — 2026-08-03 — FOLLOW-792 (#662) + FOLLOW-795 (#663) + FOLLOW-796 (#664), combined

**A finding I almost missed, and why.** The P1 (§4a LG-1) came from asking the wrong-feeling
question. Three PRs, two of which were filed by my own predecessor to close a gap it had proven, and
the natural retro shape was "did they close it?" — a closure check. I ran that, and it produced two
good findings (FOLLOW-792 closed one of two consequences; FOLLOW-796's chain has one unverifiable
hop upstream). But the P1 came from the **opposite** direction: not "does the wire now reach the
consumer?" but **"now that it reaches, what ELSE flows down it?"** `cta_primary → cta` is a one-line
table entry that changes no type, no schema, no export signature, and no `packages/shared` file — so
every mechanical gate in this repo is structurally blind to it. I only found it because I went and
read what the 11 auto-detect techniques actually emit for `cta_primary`, and two of them emit
`a[href*="contact"]`. If I had trusted the PR's own (excellent, three-reason,
independently-verifiable) analysis of the `features_list` axis and moved on, I would have written a
retro praising the merge. **The PR reasoned rigorously about the key it did NOT map and not at all
about the blast radius of the key it DID.** That asymmetry is the thing to look for next time: when
a PR's doc block spends 20 lines justifying an exclusion, check whether the same rigour was applied
to the inclusion.

**An axis/chain I had to trace twice.** §4a LG-2's reachability. First pass I concluded the
`headline_owned_by_description` skip was unreachable: the fingerprint guard returns early, so
`applyTextDirective` never gets to the loop. That would have downgraded a P2 to a "latent, no
action". Second pass I asked what clears the fingerprint (`resetAdaptState()` on archetype change)
and then whether the same call clears the **ownership** — and found it structurally cannot:
`teardownAdaptObservers()` iterates `_textResilienceMap`, but hand-off **deletes** the element from
that map, so a `'description'` entry is unreachable from the generic side, and `index.ts:788` calls
`resetAdaptState()` alone. The two state machines have different lifetimes and only one teardown
path knows about both. **Lesson: when a fix introduces a shared registry between two modules, trace
its lifetime against EVERY teardown call site, not the one the tests use** — #663's two teardown
tests cover the destroy path and the cross-listing path, and the reachable one (same-page archetype
change) is the third, which neither test and no reviewer named.

**A meta-pattern in how gaps recur across agents.** Two, and they point the same way.

1. **The remediation inherits the original's frame.** RETRO-244 found LG-2 (a positive event emitted
   on a path with no write) and filed FOLLOW-793 with an AC scoped to _the one door it saw_ ("when
   `attachResilience` declines because `isStale()` is true"). One day later a different ticket, in
   the same function, added a **second** door with the same shape — and the stub that exists to fix
   the class would not have caught it. This is the same displacement the consent-gate chain showed
   (prose → tuple → fixture → fixture region) and the same one my own predecessor documented for
   FOLLOW-097→114→127→141. **When I file a stub for a defect class, the AC must name the class, not
   the instance.** I wrote FOLLOW-802's AC1 as "regardless of which early return prevented the
   write" for exactly this reason, and put the scope warning in the stub's first paragraph where a
   dispatching PM cannot miss it.
2. **The correct behaviour was written down the whole time, in two places, and nothing reads
   documents.** `ADR-0008:46` and `MASTER_DESIGN.md:17` both specified `cta_primary → cta` AND
   unique-match, from 2026-06-01. FOLLOW-340's rewrite dropped both; RETRO-093 caught one and its
   ticket was never written; 45 days later FOLLOW-796 restored that one and PR #664's doc edit
   **codified the loss of the other as intent**. The repo has gates for code↔code drift (Rule J),
   code↔fixture drift (Rule AM), doc↔code claims (Rule AH, Rule AI) — and nothing that compares an
   **ADR's decision clauses** against the code implementing them. That is the structural reason a P1
   could live for six weeks next to two documents stating the fix.

**On my own process, recorded because the brief asked and because it is the uncomfortable one.** The
PM handed me three observations to verify. Two confirmed exactly ((a) Rule I 193 vs 192, (b) the
bundle arithmetic) and I could have banked both as findings. But (a) turned out to be **already Rule
AF clause 2, promoted at RETRO-205 on a four-retro history** — the right output was not a new rule
but the observation that this is the first time that clause CAUGHT something rather than documenting
drift, plus the two residuals (clause 1 still violated; `check-rule-i.sh` has no baseline mechanism,
so clause 2 is hand-enforced). And (c) was an **undercount** — fourth sighting, not second, with the
mechanical mitigation already filed as FOLLOW-645 and mis-priced at P3 through two recurrences.
**Searching `CONVENTIONS_PATCH.md` and the retro register BEFORE writing a finding turned two "new
rule" candidates into one positive-compliance note and one pricing correction.** That is a better
result than two rules would have been, and it is only reachable by reading the existing rules' TEXT
rather than their reputations.
