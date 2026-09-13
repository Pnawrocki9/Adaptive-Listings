# RETRO-324 — 2026-09-13 — #892 (FOLLOW-1191, the embedding seed path)

Written as a fragment, not appended to `lessons.md`, per Rule AG — and because this entry's own §4d
DG-3 files the same violation against the PR under review.

## A finding I almost missed, and why

**That the manifest's second consumer is a route, not a script.** I had already written LG-1 from
the PR's own out-of-scope note (fixture id ≠ `listing-001…012`) and was about to file the follow-up
against `seed-estalara-listings.ts` alone. `DEMO_LISTING_MANIFEST` is also read by
`seedListingEmbeddingsForActivation()`, which `POST /api/schema/activate` calls on three separate
paths. A follow-up scoped to the CLI would have "fixed" the id join and left the activation path
seeding the same twelve — the FOLLOW-097 → 114 → 127 → 141 shape, one hop further on.

The grep that saved it was the plain one —
`grep -rn DEMO_LISTING_MANIFEST --include="*.ts" apps/control-plane/src` — run only because step 2
of my own algorithm says map EVERY changed symbol, and the manifest is a symbol the PR did not
change. **Symbols the diff does not touch but the finding depends on are still cascade points.** I
do not currently run step 2 over those; I should.

## An axis/chain I had to trace twice

**"Does the hosted axis still work?"** The PR's evidence is all localhost, by necessity. My first
pass accepted the unit tests (a hosted `DATABASE_URL_ADMIN` stays on PostgREST) as the answer. That
is a test asserting a resolver's return value, which is the thing #892's own author correctly
distrusted when they unexported `resolveSeedTarget`. The real answer was one `gh api` away: the
post-merge run's log on `main` prints `[archetype-seeder] target: PostgREST https://…` — the
transport that RAN, not the one a resolver returned. The pre/post step-conclusion table (step 11
`failure` → `success`, run conclusion `success` in BOTH) is the strongest paragraph in the entry and
it cost three commands.

**Generalisable:** for any merge that changes WHERE something writes, the retro's own evidence
should come from the environment the PR could not test, and GitHub's job/step API is usually the
cheapest place to find it. `gh api .../runs/<id>/jobs` gives per-step conclusions, which is how "the
run says success while the step says failure" becomes visible at all.

## A meta-pattern in how gaps recur across agents

**The estate keeps re-deriving Rule Q instead of finding it.** The gate at the centre of this merge
is the gate that PROMOTED Rule Q (RETRO-145/FOLLOW-446). Rule Q's clause 1 cites, as its model of a
good positive-execution line, the exact string that turned out to be vacuous. Clause 2 forbids
precisely the job-level `continue-on-error` that survived above it for another 11 weeks. And #892's
author wrote the same guardrail again, in their own words, in `lessons.md`, as something they had
learned.

Three agents, one rule, no reader. `CONVENTIONS_PATCH.md` is 5131 lines and 55 rules with no index
from artefact → governing rule, so "which rules apply to a `.github/workflows` diff?" has no cheap
answer. I recorded that as Candidate I (count 1) rather than filing a ticket, because the fix is a
process change and I am not its owner — but if it recurs, the ticket is an index, not another rule.

**Second meta-pattern, banked as Candidate H:** a residual named in the PR that CLOSES a ticket, and
homed onto that same ticket, dies at DONE. `288484d` said "Residual … tracked in FOLLOW-446" and
FOLLOW-446 went DONE in the same breath; the QUEUE note then claimed the residual was the thing
fixed. Rule AW covers `blocks:`; nothing covers this. I pre-committed the grading criterion in §6 so
the next retro can count it instead of re-discovering it.

## Process note worth carrying

**Check whether the pattern is already a rule BEFORE drafting a new one.** I had a clean
three-sighting case for "a registered gate that cannot go red" and was one paragraph into a Rule BD
when I read Rule Q's body and found the pattern, the mechanism and the very gate already there. The
correct output was an amendment repairing Rule Q's own exemplar. A 56th rule restating the 17th
would have been exactly the noise the ≥2 threshold exists to prevent — the threshold guards against
premature codification, not against duplicate codification, and only reading the register guards
against that.
