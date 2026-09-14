# RETRO-332 — 2026-09-14 — #905 (FOLLOW-1192, fixture listing id in the manifest)

Written as a fragment, per Rule AG.

## A finding I almost missed, and why

**The handoff's secret "comes from Doppler dev". It does not.** The PR was honest about AC(4) and
gave exact steps, so I nearly copied those steps into FOLLOW-1185 as the pre-run recipe. A
names-only Doppler listing showed that `INTERNAL_API_SECRET`, `DEMO_TENANT_ID` and
`NEXT_PUBLIC_APP_URL` are all absent from `dev`. Reading `resolveSeedTarget()` then showed that the
archetype step also needs the `env` form, or Doppler's hosted `DATABASE_URL_ADMIN` wins. **A handoff
recipe is a claim. Check each variable it relies on against the secret store and against the code
that reads it, before re-homing the recipe.**

## An axis/chain I had to trace twice

**Hop 3 of the seed chain.** My first model of the gap was the id join, which is fixed, plus the
two-database hazard, which FOLLOW-1193 owns. On the second pass I asked a different question: does
anything on the documented bring-up RUN the seeder at all? Nothing does. `seed:local-tenant` embeds
nothing, the README never names `seed:listings`, and the plane it documents would 401 the seed.
**For a data fix, trace the invocation, not only the producer and the consumer.**

## A meta-pattern in how gaps recur across agents

**A scope that forbids `docs/*` produces a PR body that asserts "no drift introduced".** The worker
could not edit the SoT sentence that its fix made stale, so it declared there was none. The dispatch
brief creates the blind spot, and the worker then reports the blind spot as a clean result
(Candidate P, count 1).
