# FOLLOW-252 — Gate chat-intent prior idempotency on rehydrate boundary (Rule R fix)

**Sprint:** 13b hardening **Priority:** P1 **Estimated:** 4h **Agent:** sdk-engineer + ml-engineer
**Depends on:** FOLLOW-101 **Pairs with:** FOLLOW-253 (the test) **Source:** RETRO-047 §4a LG-1 (3rd
Rule R violation: RETRO-032, RETRO-037, RETRO-047)

## Problem

`_chatPriorAppliedSessionId` in `packages/sdk/src/core/adapt.ts:309` is an in-memory module variable
reset by `resetAdaptState()`. This works within one page-tab lifecycle, but:

1. User visits a listing page → chat prior applied → IntentState persisted to sessionStorage
2. User reloads the page → `rehydrateIntentState` restores the already-prior-applied IntentState
3. The 24h Redis shadow key still exists → `/api/adapt` returns `chat_intent_dimensions` again
4. `_chatPriorAppliedSessionId` is null → `applyChatIntentPrior` re-folds likelihoods onto the
   already-applied distribution → **double-count on every reload within the 24h window**

`applyChatIntentPrior` is multiplicative and undamped (`intent.ts:1082`), so each reload compounds
the perturbation further from the true archetype distribution.

## Fix

Replace the in-memory guard with a Rule-R-compliant persistent mechanism. Two acceptable approaches:

**Option A (recommended):** Add a `chatPriorApplied: boolean` field to the `IntentState` envelope
(in `packages/sdk/src/core/intent.ts`). Set it true when `applyChatIntentPrior` runs. Check it in
the apply guard. It survives reload via sessionStorage because `persistIntentState` already
serializes the full envelope. `resetAdaptState()` must clear it (set to false) on session teardown.

**Option B:** Combine `!intentStateRehydrated` with an existing gate — only apply the prior if the
state was NOT rehydrated (fresh session) OR if `chat_intent_dimensions` are arriving for the first
time in a rehydrated session that never had them.

Option A is simpler and directly mirrors the `!intentStateRehydrated` pattern already consolidated
by FOLLOW-219.

## Acceptance Criteria

- [ ] **AC1:** The chat-intent prior is applied AT MOST ONCE across a hard page reload within the
      24h shadow-key window. The rehydrated distribution is NOT re-perturbed.
- [ ] **AC2:** A chat signal that arrives AFTER the first adapt call (first call returned no
      `chat_intent_dimensions`, a later call returns them for the first time) STILL applies exactly
      once. No regression on the TG-2 scenario.
- [ ] **AC3:** The idempotency marker is persisted in the IntentState envelope (or equivalent
      sessionStorage-backed mechanism), NOT an in-memory module variable. `resetAdaptState()` /
      session teardown clears it.
- [ ] **AC4:** A test through the `_initForTest` rehydrate→re-init seam proves AC1 and AC2 (see
      FOLLOW-253 — must land together or in the same PR).
- [ ] **AC5:** A `// Rule R:` comment in the guard code cites Rule R and the `intentStateRehydrated`
      gate family; aligns with patterns from FOLLOW-219/RETRO-032/RETRO-037.

## Key files

- `packages/sdk/src/core/adapt.ts` — `_chatPriorAppliedSessionId`, `applyChatIntentPrior`,
  `resetAdaptState`
- `packages/sdk/src/core/intent.ts` — `IntentState` type, `persistIntentState`,
  `rehydrateIntentState`
- `packages/sdk/src/index.ts` — `rehydrateIntentState` call at line ~349-353
- `packages/sdk/src/__tests__/follow-101.test.ts` — existing Rule R tests (extend or add seam tests
  here, or add a new follow-252.test.ts)

## Branch

`sdk-engineer/FOLLOW-252-rule-r-chat-prior-rehydrate`
