# retrospective-analyst — RETRO-259 (2026-08-07, PR #690 / FOLLOW-816)

Per-agent fragment (Rule AG). A devops-engineer was running FOLLOW-817 in
`.claude/worktrees/follow-817` while I wrote this, so this is a fragment and not an append to
`lessons.md`.

## A finding I almost missed, and why

**The hop-10 gate misattribution — and I almost missed it because the PR was too good.** The
evidence discipline in #690 is the best I have reviewed: pasted observations, an _executed_ negative
control, a `PASSES=4` re-run producing a bit-identical peak, a single-variable `best_effort`
isolation, and an AC reported BLOCKED rather than quietly re-scoped. My first pass through §9 read
it as settled — the number was measured twice, the mock's behaviour was probed both ways, and the
SDK's DOM-apply path was cited as green in CI. Everything about the paragraph signalled "verified".

What broke it was a habit, not an insight: before writing a §5 cascade about a constant, I open the
file that defines it. `adapt-floor.ts` exports **two** constants, and the second one's docblock says
_"regardless of confidence level"_. One grep later
(`grep -rn "DOM_ADAPT_MIN_SIGNAL_COUNT" packages/sdk/src`) the gate turned out to be a disjunction
whose other branch was true all session, and one grep after that (`CONFIDENCE_THRESHOLD` in
`route.ts`) the deciding threshold turned out to be a different number in a different service —
stated, verbatim, in a comment the worker had read, because it sits 90 lines above the code it was
reasoning about.

**The lesson for me: evidence density is not the same as attribution correctness, and it disguises
it.** A PR that shows its work invites me to audit the _work_ and skips me past the _claim_. The
transferable rule I am giving myself: **when a PR concludes "X is red because of threshold T", I
open the code that reads T before I read anything else the PR says about it.** Not the constant's
definition — the constant's _consumers_.

## An axis/chain I had to trace twice

**The consent pre-grant, and I was wrong the first time.** `local-pilot-session.mjs` writes
`localStorage['estalara_consent'] = 'granted'` in an init script and comments that a failure will
show the banner and fail the run loudly. My first read flagged it as an uncontrolled variable: if
the raw string does not match what the SDK expects, the whole behavioral session runs unconsented, a
restricted event set is emitted, and the 0.3655 is confounded — which would have been a spectacular
finding, and would have been false. `session.ts:26,35-37` accepts exactly `'granted'` / `'denied'`
as raw strings. The pre-grant is correct.

I kept the axis in the entry anyway, but as what it actually is: the value is right **today** and
nothing asserts it, so a future key change downgrades every run to `pending` silently (§4c TG-2).
**Tracing it twice cost four minutes and saved me from filing a P1 that a single `grep` would have
retracted.** The second trace is the cheap one; it is the first one that is expensive to skip.

The chain I traced twice in the other direction — and should have trusted sooner — was
`adaptation_decisions`. I assumed the zero was collateral from the Code-27 defect (as the runbook
says) and only re-checked when writing §4d. `grep -rn "INSERT INTO" apps packages scripts infra`
returns five writers, and exactly one targets that table: the control-plane, which was never
running. The runbook's own explanation cannot produce the number it explains.

## A meta-pattern in how gaps recur across agents

**Findings are being rediscovered because nobody greps the backlog before publishing one.** Two of
this PR's four headline findings were already filed tickets — the ClickHouse Code-27 is FOLLOW-853
(from FOLLOW-845, same session, same root cause, prod probe already run) and "staging does not
exist" is FOLLOW-810 (DONE, 2026-08-04, same DNS/bindings evidence). Neither is cited by the PR, by
ESC-052, or by FOLLOW-873. Rule P's own Verification block is a two-line grep that returns both.

The meta-pattern is sharper than "someone forgot Rule P": **rediscovery is invisible to the worker
and expensive only to the reader.** The worker experiences it as a genuine finding and writes it up
with real evidence; the cost lands three artefacts later, when a merged runbook tells an operator to
go answer a P0 question the estate closed last week, and points them at the wrong owner. That is the
same class as FOLLOW-832 / FOLLOW-837 / FOLLOW-739 / ESC-052 — a control the repo documents and does
not have — except here the missing control is _reading its own record_.

**What I will do differently:** for every finding a PR presents as new, I now run Rule P's grep
myself, against the finding's keywords, before I decide whether it is a §4 gap or a §5 cascade. It
took two greps this time and it changed the grading of two of the four findings.

**Second meta-pattern, recorded because it is now eight retros old:** the model tier keeps catching
reasoning the AC did not ask for, and keeps missing the one axis nobody named. Opus found five
things here that no acceptance criterion mentioned; the thing it missed was which of two gates was
binding — an axis the ticket never named, in a file it had open. I no longer read that as a tier
failure. **The brief names the axes; the tier fills them in.**
