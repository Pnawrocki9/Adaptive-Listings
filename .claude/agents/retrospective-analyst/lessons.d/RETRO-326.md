# RETRO-326 — 2026-09-13 — #898 (FOLLOW-1200, FOLLOW-819 harness defaults, probe and artefact)

Written as a fragment, per Rule AG.

## A finding I almost missed, and why

**The probe fix could not see L-1.** The PM's question 4 asked whether a 401/403 "could come from a
misconfigured plane". I first read that as a question about which status codes the verdict function
accepts. It is really a question about what the probe sends. `evaluateControlPlaneProbe()` looked
correct against its own table. The table looked correct against README §6.5, the audit and the stub,
because all four say the same thing. Only reading `route.ts` `POST` from the top, in request order,
turned it up: `if (!token) return 401` sits 30 lines before the secret is ever read.

I nearly accepted it because four independent-looking documents agreed. They were not independent.
They were one README paragraph copied four times, one of the copies being a retro that said "every
element verified". **When several backlog artefacts agree on a consequence, trace their citation
chain before counting them as corroboration.**

## An axis/chain I had to trace twice

**The origin question.** My first answer was "yes, `CORS_DEV_EXTRA_ORIGINS` is the list", because
`middleware.ts` imports it. On the second pass I read `sdkCorsAllowedOrigins()` and saw the
`NODE_ENV === 'production'` branch. I also confirmed that `POST /api/adapt` is deliberately NOT in
`ORIGIN_REFLECTING_ROUTES`. The answer depends on `next dev` versus `next start`, and the harness
cannot see which one is running. **A list being imported is not the same as the list being
consulted. Read the function that selects between lists.**

## A meta-pattern in how gaps recur across agents

**Detectors get tested on typed-in inputs.** #894 (AC(1)) replayed a real artefact. #898 (the probe)
typed its fixture from the ticket. Both authors followed Rule AS, and only one had a real producer
output to replay. For any guard whose job is "notice the bad substrate", the one test that matters
is the real producer's response to the guard's exact request. It costs one unit test that imports
the handler. I ran it from a scratchpad vitest config against the main checkout's control-plane
(`route.demo-auth.test.ts`'s mocks, `next/server` aliased) without writing into the repo, in under a
minute. **Executing the handler beats reading it whenever a retro's headline depends on a status
code.**

Also: RETRO-310 had the refuting fact and RETRO-311 missed it the same day. Retro memory is only as
good as the next retro's grep. I now grep RETROSPECTIVES for the literal error code or status string
of any consequence a PR encodes, before reading the PR's rationale.

## Process note worth carrying

The isolation guard refuses compound shell commands (heredocs with paths, `cd && git`). Write
scratch files with the Write tool and keep each Bash call to one plain command. Vitest `mergeConfig`
concatenates `include` arrays, so the first run executed the whole control-plane suite. Spread the
base config and replace `test.include` instead.
