# Retrospective-analyst lessons — RETRO-249 (FOLLOW-811 / PR #679)

**Date:** 2026-08-05 · **RETRO-249** · analyst: Opus, worktree `.claude/worktrees/retro-248-249`

## A finding I almost missed, and why

**The `apps/ingest` chat-NLP dispatch, and I only reached it by taking the multi-axis step
literally.** The brief handed me a confirmed correction — `consoleIntegration()` is a Node-SDK
default, so control-plane's console sites are Sentry inputs — and asked me to check whether other
compliance documents still describe the two sinks as separate. I did that (they do not; the doc set
is consistent) and could have stopped. What I did instead was ask the algorithm's step-8 question
about the _fact_ rather than the _document_: if the coupling is a property of an SDK's default
integration list, which other SDKs in this estate have that default? `@sentry/cloudflare@10.50.0`
`build/cjs/sdk.js:29` does. `apps/ingest` overrides nothing. Ten `console.error` sites — and one of
them interpolates 500 characters of an upstream error body produced from a request whose body is
`message: { role: 'user', content: messageText }`.

**Lesson: when a finding is expressed as "in this app, X," the multi-axis step is to ask what X is
actually a property OF.** Here it was a property of a vendor's default list, and the app scope was
an artefact of the ticket's scope. Both compliance documents inherited that scope and now assert an
app-level fact that is really a family-level fact — Rule AO's exact shape, one level up from where
Rule AO usually catches it.

**Second near-miss, in the opposite direction: I went in expecting §2.7.1's triggers to be a
FOLLOW-739-class fiction and they are not.** The brief told me to be adversarial, and the
adversarial read is seductive because it produces a finding. Triggers 2 and 3 turned out to be
genuinely mechanical — I checked `sentry-config.shape.test.ts`'s whole-key-set assertion, then
checked that the replay rates are _literals_ in the config (an env-driven value would have made the
test pin a default that prod could override with no diff), then checked `ci.yml:164` actually runs
the suite. Three checks, all passing. **Writing "the record is sound" when I was briefed to attack
it was the harder and more useful output**, and it made the one real hit — trigger 1's owner
sentence — credible instead of reading as a quota finding.

## An axis / chain I had to trace twice

**Trigger 1's ownership, which I first traced in the wrong direction.** My first pass asked "what
would make buyer text appear in `apps/control-plane`?" and looked at control-plane routes. Clean.
Second pass asked the _producer_ question — who writes the payload this app reads — and the chain
inverts: `readShadowChatIntent` **casts** (`return parsed as ShadowChatIntent`, no zod),
`flattenIntentDimensions` is an `Object.entries` **passthrough**, and the canonical contract lives
in `apps/intent-engine/src/schemas.py`. So the change that falsifies §2.7.1's premise lands in
Python, in another app, with zero diff in the app the trigger names.

**Then a third trace, because I nearly filed a duplicate.** A cross-runtime parity fixture already
exists (`chat-intent-cache.test.ts:149-172`, FOLLOW-736 / ADR-0020 D2) and Rule P says check before
proposing. It exists — and it pins **signal semantics** (`length > 0 === expect_signal`), not the
**key set**. Right mechanism, wrong axis. That is a much better ticket than "add a parity test"
would have been, and it only exists because I opened the fixture instead of trusting the grep hit.

## A meta-pattern in how gaps recur across agents

**Every ticket in this chain has closed its named leg and left the structurally identical sibling
for the next ticket — and the sibling is never in the same file, so no diff review can catch it.**
FOLLOW-738 closed Sentry, left stdout → FOLLOW-812. FOLLOW-812 closed the primary `print`, left the
retry `print` (caught in PM validation). FOLLOW-832 closed both arms, and the same defect shape sat
in `packages/sdk` untouched. FOLLOW-811 closed control-plane, left `apps/ingest`. **Four hops, one
shape.** Rule S names it and fires every time; RETRO-246 and RETRO-247 both declined to amend Rule S
because it fires, and both were right.

**What I would tell the next analyst to actually do about it, since another rule will not help:**
the Rule S bullet that keeps getting breached is the _first_ one — "enumerate the full sibling set
FIRST and state it in the PR description." Every breach in this chain is a PR body that names one
residual instead of the set. So when reviewing a PR body, treat "here is the one thing I did not do"
as a **partial** enumeration by default and go find the rest yourself. Both of this session's stubs
(FOLLOW-838 AC(3), FOLLOW-839 AC(6)) now carry an explicit "enumerate the full set in the PR
description" clause for that reason — pushing the discipline into the AC is more likely to work than
pushing it into a rule that already says so.

**One positive worth carrying forward, because the corpus records mostly the inverse:** the
Sonnet→Opus escalation on FOLLOW-811 demonstrably paid off — the finding required reading three
vendor packages' compiled sources, and the decision required arguing from FOLLOW-739's failure mode
rather than from the ticket's literal AC, which invites exactly the never-fires hook. CLAUDE.md asks
retros to evaluate routing quality and the corpus had never actually done it. It should.
