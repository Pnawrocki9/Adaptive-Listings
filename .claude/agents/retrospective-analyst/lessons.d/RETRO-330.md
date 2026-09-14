# RETRO-330 — 2026-09-14 — #904 (FOLLOW-1205 + FOLLOW-1206, FOLLOW-1201 harness handoff)

Written as a fragment, per Rule AG.

## A finding I almost missed, and why

**Doppler `dev` has no `OPS_TENANT_ID`.** I verified the handoff in the bytes: `Origin` present, ops
bearer present. Then I nearly closed FOLLOW-1207. What stopped me was asking what the ops path
REQUIRES of the plane that the tenant-key path did not. `route.ts` returns
`500 ops_auth_misconfigured` without `OPS_TENANT_ID`, and a names-only Doppler listing showed it is
not in `dev`. Only README §3.4's override sets it. **When a consumer switches credentials, list the
new credential path's preconditions on the SERVER side, and check where each one is provisioned.**

The same question found the silent tenant mismatch. The old path's 403 was a guard nobody had named,
and #902 removed it without either PR noticing.

## An axis/chain I had to trace twice

**PM fact 5 ("PR CI could not have caught #902 × #904").** On the first pass I read it as "add
`tests/e2e` to PR CI" (FOLLOW-1198). On the second pass I asked what the one handler-importing test
actually sends: `{}`, which stops at body validation, before the ops resolver and the holdout gate.
So even the nightly could not catch the conflict. **A test that imports the real handler protects
only the requests it sends. Match the request, not the import.**

Running the suite from the worktree also gave me a fact the PM had only from memory: the file-level
FAIL counts its 26 cases as "skipped", so "105 passed" with no failure count is what a skim reads.

## A meta-pattern in how gaps recur across agents

**Closure by side effect.** #904 discharged FOLLOW-1207 and three of FOLLOW-1208's ACs without
naming either ticket, because its brief used the names of the handoffs ("the #902 handoff", "the
FOLLOW-1196 amendment"), not the tickets that had since absorbed them. The backlog learns of the
closure only if a retro traces it. That is Candidate O, count 1.

## Process note worth carrying

The worktree sandbox refuses `cd` into the shared checkout. Running the root `vitest` binary with
`--root <main checkout>/<package>` works, and needs no git. Read the checkout's HEAD from its refs
file to state which commit the run executed.
