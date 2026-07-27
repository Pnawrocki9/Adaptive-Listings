# RETRO-227 — FOLLOW-697/698 / PR #632 — 2026-07-27

Fragment file, not a `lessons.md` append (Rule AG — no trailing writes to the shared monotonic log
while other agents may be in flight; a serial job rolls fragments up).

## A finding I almost missed, and why

**That the constant is a placeholder was handed to me; that the gate is therefore un-triggerable was
not, and I almost stopped one step short.** The PM's brief gave me a well-formed hypothesis (the hex
looks hand-typed) and asked me to verify it and file a ticket for whichever of (a)/(b)/(c) is true.
Verifying it took twenty minutes and produced a clean P1 doc/compliance finding. I was drafting §4a
when I asked the question the brief did not ask: _if the constant is not the hash of Estalara's
text, what happens to a caller who submits the hash that IS?_ That single question converted the
finding from "a wrong value in an audit column" into "the four-PR refusal gate cannot fire on the
realistic fabrication, because it compares against a string no hashing procedure produces." **A
verified hypothesis is not a finished analysis — the next question is always what ELSE the verified
fact makes true.** Concretely: I had already computed `821216cd…`; the work was tracing that value
back through `route.ts:495` and `:609` to see which branch it lands in (alert-only, write proceeds).
Ten more minutes, and it moved the severity from P1 to P0.

Two corollaries I want to keep:

- **A brief that arrives with a hypothesis is the most dangerous kind of input**, because verifying
  it feels like completing the task. The hypothesis defines a floor for the investigation, never a
  ceiling.
- **The proof I built (60 normalisations, nibble structure, `git log -S`) was over-engineered for
  the claim and under-engineered for the consequence.** Next time, spend proof effort proportional
  to what the fact _unlocks_, not to how contestable it is.

## An axis / chain I had to trace twice

**The omitted-hash axis (§4a LG-3).** First pass I read `route.ts:493`
(`body.consent_text_hash !== undefined && …`) as a cheap fast-path guard and moved on — the PR
documents it as a cost optimisation and the reasoning is sound. Second pass, while writing the
cascade section, I asked what the DEFAULT write does for a tenant that skips the whole block, and
found `:703` still hardcoding the canonical constant with `expectedHash` sitting in scope eleven
lines above. **The guard is correct as a cost argument and wrong as a coverage argument, and the PR
only made the cost argument.** Reachability then took a third pass, because my first trace said
"only reachable in an odd config" — until I remembered the CEO's single-tenant private-label
re-brand model, under which the FIRST-PARTY tenant is exactly the tenant that gets provisioned with
someone else's brand. That flipped it from an edge case to the documented go-live shape.

Generalisable check I did not have and now do: **for every `if (x !== undefined)` guard on a
validation branch, find the code that supplies the default when `x` IS undefined, and ask whether
the validation would have passed on that default.** A validator that only runs on supplied values is
half a validator.

**Second double-trace: the promotion arithmetic.** Two independent patterns (P-12 from RETRO-226,
P-14 from RETRO-147) both hit count 2 in this retro, and both carried explicit prior-retro
pre-authorisations reading "promote on a 2nd sighting". My charter says "≥2 **prior** retros" and
the house adjudication (RETRO-145 Rule Q, RETRO-226's K.2 amendment) agrees that the promoting retro
does not inflate the count. I traced it twice because I wanted to promote — the findings are good
and codifying them would look like value. I held both, and wrote the conflict into §6 instead.
**When two readings of a threshold exist and one of them lets me do the more impressive thing, that
is the reading to distrust.** Surfacing the ambiguity is a better contribution than resolving it in
my own favour, and it is now on the record for the skill-upgrade run.

## A meta-pattern in how gaps recur across agents

**The "closure was really a relocation" chain reached its fifth consecutive retro — and for the
first time the relocation was DOWNWARD rather than sideways.** 627 → 629 → 631 → 632: each merge
genuinely closed the layer above it and inherited the layer below. RETRO-226 found the gap had moved
sideways (`unprovisioned` → `provisioned` cell); #632 closed that cell properly, and the residue
turned out to be one level beneath every cell — the constant all of them compare against, untouched
since 2026-06-21 and never in scope for any of the four tickets. **Four agents, four correct fixes,
each one measured against a fixture drawn from the same unexamined value.** The generalisable lesson
for the whole agent pool: when a ticket says "the gate must refuse X", someone has to ask what X
_is_, and no reviewer of a diff ever will, because X is not in the diff.

Second meta-pattern, sharper than last run's: **tests that draw their fixtures from the
implementation's own constants cannot falsify those constants.** Eleven references to
`CANONICAL_CONSENT_TEXT_HASH` across 52 route tests, every one of them
`expect(written).toBe( CANONICAL_CONSENT_TEXT_HASH)` — the constant compared to itself, green
forever. This is a distinct failure mode from Rule L (self-injecting mocks) and from Rule S (test
mechanics): the test drives the real handler and asserts a real write, and is still tautological.
Worth watching for a second sighting under the name I gave it in §6 (P-13, derived constant with no
derivation test); the one-line remedy — recompute the derivation in a test — is cheap enough that it
should probably become a rule the moment it recurs.

Third, and a correction to my own prior run's scoring: **RETRO-226 scored the ABSENCE of a
`lessons.md` append as a negative ("the 5-PR streak breaks here"), while Rule AG restricts appends
to exactly that file.** #632 appended 30 lines to it. I recorded this factually without scoring it a
violation (Rule AG's antecedent is parallel-worktree agents, and #632 ran alone), but the deeper
point is that **this analyst rewarded, one retro earlier, the behaviour a codified rule
discourages.** The learning loop can teach the wrong lesson as efficiently as the right one. I now
check any praise I am about to hand out against the rule set, not only any criticism.
