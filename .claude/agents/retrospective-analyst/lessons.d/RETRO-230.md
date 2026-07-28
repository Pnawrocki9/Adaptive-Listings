## 2026-07-28 — RETRO-230 (FOLLOW-716, PR #638, `d77c9b2`)

- **A finding I almost missed, and why.** The PR was, on its face, the _fix_ for four retros' worth
  of my own predecessors' findings — 4 files, +612/−0, zero source changes, self-test 5/5, new CI
  job green. The gravitational pull of "this closes the lineage, write it up as closed" was strong,
  and every artifact in the repo (QUEUE, the PR body, Rule AK's own minting note) pointed that way.
  What broke it was refusing to accept the gate's _passing_ as evidence of the gate's _soundness_
  and building a throwaway harness: copies of `route.ts` / `HANDOFFS.md` / the script under the
  scratchpad (the script derives `REPO_ROOT` from its own path, so a copied tree works unmodified),
  then mutating them. **Three of four mutations exposed a blind spot on the first try** — a
  helper-extracted refusal above the GET handler, a `new NextResponse(...)` refusal inside it, and a
  perfectly-correct status addition that reds the gate's own self-test. None of those are exotic;
  all three are things the next ticket on this route could plausibly do. Generalisation: **when a
  merge ships a detector, the retro's job is not to read the detector, it is to attack it.** Reading
  it would have produced "clean ✅".
- **An axis/chain I had to trace twice.** The closure claim. First pass: "does the gate exist, is it
  wired, does it pass?" → yes, yes, yes. Second pass, forced by the charter's end-to-end rule:
  replay each of the four historical drifts (RETRO-226/227/228/229) against the gate as merged. That
  is when the score came out **2 of 4 fully caught** — RETRO-227's instance is a _second variant of
  an existing `(status, code)` tuple_, which the gate de-dupes away, and RETRO-228's was never a
  status at all. The chain also revealed the displacement: route↔machine-block is now gated, while
  route↔docblock and block↔prose-table (three copies, one gated pair) are not. Same shape as
  `inquiry_submit_selector` 097→114→127→141, caught at hop 1 this time instead of hop 4.
- **A meta-pattern in how gaps recur across agents.** Two of them, both about _the second copy_:
  1. **Every mechanisation in this repo so far has gated exactly one pair and left the human-read
     twin ungated** (#633: renderer↔§6.1 gated, the DPIA's own procedural prose not; #638:
     route↔block gated, the failure tables and the route's own `Responses:` docblock not). The
     worker's scoping instinct is "what can I diff mechanically", and the artifact a _human_
     consumer reads is never that artifact. Worth a rule when a 2nd retro sights it (P-16 is the
     adjacent pattern I opened at count 1).
  2. **A gate's self-test is written against today's literals and is never tested against the change
     the gate exists to police.** I found this in the new gate _and_ in the #633 gate RETRO-228
     scored as exemplary — meaning I also caught my predecessor's miss, on a file it had praised.
     Held at count 1 anyway (two instances, one retro) per RETRO-227/228's arithmetic discipline;
     the pre-authorisation is written into RETRO-230 §6.
- **My own blind spot, recorded.** I nearly failed to notice that **#636 and #637 were never retro'd
  at all** — I only caught it because the RETRO numbering (229 → my 230) did not line up with the PR
  numbering (635 → 638). The learning loop has no gate on its own coverage: nothing in this repo
  detects a skipped retrospective. That is the same "producer with no consumer" shape I file against
  other agents every week, aimed at my own function (→ FOLLOW-722). **Cheap check to run first,
  every time: does the PR number of the last retro's subject sit immediately before this one's?**
- **Charter.** No code written; wrote only `RETROSPECTIVES.md`, `FOLLOW_UPS.md` and this fragment.
  **No rule promoted** — P-16 has zero _prior_ retro sightings, and Rule AK was already minted by
  the PR itself (its arithmetic I re-checked rather than re-derived on trust: valid, 4 prior
  retros). Rule AE fits §4a DG-1 but its title binds it to "a security invariant", so citing it
  there is an analogy, not a hit — recorded as a scope-broadening candidate rather than silently
  stretched.
