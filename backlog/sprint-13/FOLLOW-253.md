# FOLLOW-253 — Rehydrate→re-init SDK test for chat-intent prior via \_initForTest seam

**Sprint:** 13b hardening (with FOLLOW-252) **Priority:** P2 **Estimated:** 2h **Agent:**
sdk-engineer + qa-engineer **Depends on:** FOLLOW-252 **Source:** RETRO-047 §4c TG-1

## Problem

`packages/sdk/src/__tests__/follow-101.test.ts` has zero `_initForTest`/rehydrate/re-init coverage.
The existing Rule R test exercises only the in-memory `_chatPriorAppliedSessionId` guard within a
single lifecycle (+ `resetAdaptState()`), which is exactly the path that works. It therefore passes
CI silently even though the reload-reapply hole (FOLLOW-252 LG-1) is live.

Per Rule R's verification clause: "The accompanying test MUST exercise the rehydrate→re-init path
through the `_initForTest()` seam (Rule Q); a pure-function helper test does NOT satisfy this."

## Fix

Add a test (in `follow-101.test.ts` or a new `follow-252.test.ts`) that drives:

```
init() → chat prior applied → persistIntentState() →
re-init via _initForTest (rehydrateIntentState = true) →
second adapt call returns chat_intent_dimensions →
assert: archetype/confidence NOT re-perturbed
assert: applyChatIntentPrior call count = 1 across both inits
```

## Acceptance Criteria

- [ ] **AC1:** A test drives the rehydrate→re-init path via the `_initForTest` seam (not a
      pure-function `applyChatIntentPrior` unit test).
- [ ] **AC2:** Asserts the resumed archetype/confidence is NOT re-perturbed and the chat prior
      applies at most once across the reload boundary. This test would FAIL against the
      pre-FOLLOW-252 in-memory guard — it is a regression guard for the fix.
- [ ] **AC3:** Covers the post-first-adapt chat-arrival case (TG-2) — prior applies exactly once
      when `chat_intent_dimensions` first appear in a rehydrated session that didn't have them.

## Key files

- `packages/sdk/src/__tests__/follow-101.test.ts` (extend) or new `follow-252.test.ts`
- `packages/sdk/src/core/adapt.ts` — `_initForTest` seam
- Pattern: mirror RETRO-032 (FOLLOW-217) and RETRO-037 (FOLLOW-229) seam tests

## Branch

Land on `sdk-engineer/FOLLOW-252-rule-r-chat-prior-rehydrate` (same PR as FOLLOW-252)
