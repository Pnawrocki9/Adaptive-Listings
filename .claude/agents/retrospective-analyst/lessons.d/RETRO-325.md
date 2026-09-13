# RETRO-325 — 2026-09-13 — #894 (FOLLOW-1186, FOLLOW-819 AC(1) grades an adapted response)

Written as a fragment, per Rule AG.

## A finding I almost missed, and why

**That AC(7)'s adapted-side conjunct is not merely weak but a tautology on this substrate.** The
worker reported the pooled `totalDirectives > 0` shape, and my first draft of LG-1 said a template
or refused arm "can satisfy it". That is true and much weaker than the real finding. The real
finding is the `reorder` the POST handler appends after `runDecisionTree()` on EVERY non-holdout
source, including the below-gate `default`. I only saw it because I printed each body's directive
TYPES from the on-disk artefact instead of reading `directivesTotal`. The
`default neutral 0.3655 ['reorder']` line is what turned "can pass" into "cannot fail".

The shared type's docblock says the opposite (`'default'` is ALWAYS `[]`). Reading it would have
closed the question in the wrong direction. **Print the elements, not the count, whenever the claim
is about what a count stands for.**

## An axis/chain I had to trace twice

**Which recorded greens the retired predicate graded.** On my first pass I treated the single
on-disk artefact as "some run from 2026-08-25" and nearly filed a generic "old greens are suspect"
follow-up. On the second pass I matched its recorded fields (control 0/0, adapted 4, mirrored
profile `yield_hunter/1/0.85`, 5/6 with AC(2) red) against the README sections one by one. It is the
§5.6 run: the one headlined "ESC-073 clause 2 discharged for the first time". That turned a vague
caveat into a named contradiction of RETRO-312 §4a LG-2.

Two more things came out of the same pass. The artefact holds more bodies than the live verdict saw
(`decided[]` keeps growing after AC(1) runs), and §5.8/§5.9 survive because the README recorded
`llm_tweaked`. **Before re-grading history, establish WHICH run the artefact is, and say how
confident the attribution is.**

## A meta-pattern in how gaps recur across agents

**A fix to one predicate leaves its siblings, and the documents that grade by it, one hop behind.**
This arc has now done it three times on one file:

- FOLLOW-1098 → FOLLOW-1124: AC(5), pool vs run.
- FOLLOW-1131 → this retro: AC(7), control side fixed, adapted side pooled.
- FOLLOW-1186: AC(1) fixed, AC(7) and the grader docs not.

Each author scoped correctly to the stub, and each stub named one AC. Nobody owns the question
"which other predicates in this harness share the shape". The retro is the only step that asks it,
and it asks it only if it greps every `record(` call. I now do that as a matter of course for any
harness merge.

The grading chain (harness field → README §0 → FOLLOW-820 text → CEO) is the render hop that
producer→consumer tracing misses. It is prose, so no wiring check sees it.

## Process note worth carrying

**Replaying a verdict function over a stored artefact is cheap, executable evidence even with the
substrate down.** It needs only the import guard the PR itself added, and the main checkout's
`node_modules` when the worktree has none (verify byte-identity with `diff -q` first). Check the
artefact's mtime afterwards to prove the import did not overwrite it.
