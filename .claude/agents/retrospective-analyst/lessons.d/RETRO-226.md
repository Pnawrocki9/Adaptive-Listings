# RETRO-226 — FOLLOW-684 / PR #631 — 2026-07-27

Fragment file, not a `lessons.md` append (Rule AG — no trailing writes to the shared monotonic log
while other agents may be in flight; a serial job rolls fragments up).

## A finding I almost missed, and why

**The `provisioned external brand × canonical Estalara hash` cell (§4a LG-1).** I nearly signed off
the AC-4 matrix as complete because it had four cases and all four passed. The matrix _looked_
exhaustive; it was a **diagonal** of a 2×2 grid (`provisioned?` × `hash-kind`). What saved it was
mechanically writing the grid out instead of reading the test names: the moment the four cells were
on paper, the empty one was obvious — and it turned out to be the cell where the fabrication is
_most_ provable, because for a provisioned brand we render the text ourselves and can compute the
correct hash.

The deeper lesson is worse for me than for the implementer: the hole came from **RETRO-224's own AC
wording**, which I wrote — "unprovisioned external brand AND the canonical hash" — keying the gate
on the _diagnosis_ rather than on the _evidence_. The worker implemented my AC exactly. **When I
write an AC that names a predicate, I am writing code by proxy, and it deserves the same
counterexample search I give shipped code.** New habit: for every AC I file that contains a boolean
condition, enumerate the truth table before filing, not at the next retro.

## An axis / chain I had to trace twice

**The fail-closed count probe, traced twice in opposite directions.** First pass: "does the guard
fire when it should?" — yes. Second pass, only because algorithm step 8 forces every axis: "**for
whom else does it fire?**" `isTreatedAsExternalBrand` fails closed, Estalara's own tenant carries
`isFallbackIdentity === true`, therefore the new 422 fires for **Estalara** — discarding a real
consent — in a state the repo's own runbook documents as expected. I had read
`brand-identity.ts:304-313` twice in previous retros and both times classified it as a _false
message_ problem. It became a _data destruction_ problem the instant a caller used it to gate a
write, and nothing about the helper changed. **Fail-closed is not a property of a predicate; it is a
property of the predicate × the caller's consequence.** That reframing is what made the Rule K.2
amendment mintable after three retros of filing tickets instead.

Second trace-twice: I checked the "omitted hash" axis, concluded 7b protects 7c, then re-derived it
from the shared predicate rather than from the reading order — the conclusion held, but only the
second derivation was evidence.

## A meta-pattern in how gaps recur across agents

**Priors filed as tickets are not priors closed — and an open ticket is an active hazard multiplier,
not a parked one.** FOLLOW-674/686/695 are three open tickets on one helper across three retros.
Because none landed, the fourth PR built a _write gate_ on top of the un-fixed helper and turned a
lying 4xx into data loss. The retro loop kept doing its job (find → file) and the class kept getting
worse. My correction: when a pattern reaches a third _unclosed_ ticket on the same symbol, that is
itself the promotion trigger — codify, and say plainly in §5 that the class needs one fix in the
helper, not a fifth at a fifth call site.

**Second meta-pattern: a rule codified yesterday did not reach today's brief.** Rule AJ was merged
in `a2106cfa`, hours before this PR's implementation commit; the delegation brief
(`QUEUE.md:104-107`) named Rules K.2 and AA but not AJ, and the PR duly shipped a producer-only
alarm as its sole compensating control. The learning loop's weakest hop is not detection or
codification — it is **rule → next dispatch brief**. Worth saying out loud to the PM every time a
rule is <7 days old.

**Third: the doc-free 2-file PR.** A diff that changes a public error contract and touches zero
documentation is now a reliable Rule AI tell. Cheap heuristic for future runs: if
`gh pr view --json files` shows only `route.ts` + `route.test.ts` while the diff adds a new status
code or error `code:`, open HANDOFFS/runbooks/the helper docblock **before** anything else.
