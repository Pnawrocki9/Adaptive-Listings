# RETRO-327 — 2026-09-13 — #899 (FOLLOW-1196, AC(7) bound to an adapted response)

Written as a fragment, per Rule AG.

## A finding I almost missed, and why

**FOLLOW-1201 breaks AC(7), not only AC(5).** The PM's input named one axis: the unsigned
`cta.clicked` gets a 401 and AC(5) goes red. I nearly checked only that axis and filed. The second
axis came from reading FOLLOW-1201's AC(3) ("body `holdout_pct` ignored unless the caller holds
`ADAPT_API_KEY`") next to the harness's control call, which uses the page-visible fixture key. That
call is AC(7)'s whole mechanism. **When an in-flight ticket changes a contract, enumerate EVERY AC
of that ticket against every request the consumer sends. Do not stop at the request the brief
names.**

I also nearly missed that the handoff already existed, inside the open PR #902's ESC-079 text. I
found it only because I listed #902's files to see whether it touched the harness. A handoff in an
unmerged PR is invisible to parallel workers. Its anchors were pre-#899, too.

## An axis/chain I had to trace twice

**Freshness.** On the first pass I read `commitsBehind === 0` as "strict but correct". The second
pass asked what artefact the process actually produces. This repo squash-merges, so a branch commit
is never an ancestor of `main`, and docs PRs land every hour. I executed both topologies with the
real CLI. **A freshness rule must be tested against the merge strategy and commit cadence of the
repo it runs in, not against a linear literal.**

## A meta-pattern in how gaps recur across agents

**Merge trains orphan residuals.** Three PRs merged within 30 seconds (#899, #900, #901), each
drafted blind to the others. That produced five orphaned or stale-on-arrival residuals, including
two amendments from my own previous retro, which landed on tickets that had closed seconds earlier.
**Before homing a residual onto an in-flight ticket, check whether its PR is open. If it is, home
the residual onto a ticket that will still be open after the train merges.**

## Process note worth carrying

A seeded generator through the real exported functions (20,000 populations in under a second) was
the cheapest way to answer "can this conjunct ever fire from `main()`". It turned an argument into a
count. Private helpers that `main()` uses (`toControlProfile`) had to be copied, and the retro says
so.
