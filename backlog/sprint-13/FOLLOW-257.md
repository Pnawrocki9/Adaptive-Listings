# FOLLOW-257 — Resolve Rule-L half-wire: quiz.trigger_after_n_listings

**Sprint:** 13b hardening **Priority:** P1 **Estimated:** 3h **Agent:** sdk-engineer **Depends on:**
FOLLOW-102, reconcile with FOLLOW-199 (QUIZ_TRIGGER_DELAY_MS) **Source:** RETRO-049 §4a LG-1 + §4c
TG-1

## Problem

`packages/sdk/src/core/config.ts` parses `data-quiz-trigger` into
`SdkConfig.quiz.triggerAfterNListings`, but:

1. `buildSnippet()` in `DetectionPreview.tsx` never emits `data-quiz-trigger`
2. The SDK runtime never reads `config.quiz?.triggerAfterNListings` — the actual quiz timer uses the
   hardcoded constant `QUIZ_TRIGGER_DELAY_MS = 30_000` (see FOLLOW-199)

This is a Rule-H half-wire: parsed consumer exists, but no producer emits the attribute and no
runtime path reads the parsed value. The field is dead end-to-end.

## Fix options

**Option A (recommended — remove):** Delete `triggerAfterNListings` from `SdkConfig.quiz`, remove
the `data-quiz-trigger` parse from `readConfig()`, remove the attribute from the `buildSnippet` emit
list (it was never there but document the decision). This is the lower-complexity path — FOLLOW-199
already tracks making the timer configurable if needed.

**Option B (wire end-to-end):** Emit `data-quiz-trigger="N"` from `buildSnippet` when
`quiz.triggerAfterNListings` is set, and replace the `QUIZ_TRIGGER_DELAY_MS` hardcode with
`config.quiz?.triggerAfterNListings ?? DEFAULT_DELAY`. This is the larger change and requires
FOLLOW-199 coordination — do not pursue without PM approval.

Default to Option A unless the PM explicitly approves Option B.

## Acceptance Criteria

- [ ] **AC1:** Either `data-quiz-trigger` is emitted by `buildSnippet` AND consumed by the SDK timer
      (Option B) — OR the field is removed from `SdkConfig`, `readConfig()`, and all tests (Option
      A). No half-wire state after this PR.
- [ ] **AC2:** `showQuizTrigger()` gate test added: with `config.quiz?.enabled === false`, no quiz
      trigger/widget/quiz events fire; with `enabled !== false` (default), the trigger schedules
      normally.
- [ ] **AC3:** If Option A: `QUIZ_TRIGGER_DELAY_MS` stays and a comment notes that per-tenant
      configurability is tracked in FOLLOW-199. If Option B: FOLLOW-199 is closed or superseded.
- [ ] **AC4:** A `// Rule L:` comment at the resolution point explains the decision.
- [ ] **AC5:** CI green on Lint, Typecheck, Test (Node 22), Format, Build (control-plane), Rule H.

## Key files

- `packages/sdk/src/core/config.ts` — `readConfig()`, `SdkConfig.quiz.triggerAfterNListings`
- `packages/sdk/src/index.ts` — `showQuizTrigger()`, `QUIZ_TRIGGER_DELAY_MS`
- `apps/control-plane/src/components/onboarding/DetectionPreview.tsx` — `buildSnippet()`
- `packages/sdk/src/__tests__/follow-102.test.ts` — existing quiz gate tests

## Branch

`sdk-engineer/FOLLOW-257-quiz-trigger-rule-l-halfwire`
