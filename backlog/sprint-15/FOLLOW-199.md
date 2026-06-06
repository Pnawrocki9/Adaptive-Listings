# FOLLOW-199 — Quiz widget v2.0: cascading decision tree

**Sprint:** 15 **Agent:** sdk-engineer **Priority:** P1 **Estimated hours:** 12 **Status:** READY
**Source:** Audit §10.1, Master_Design §E.4 v4.0 **Promoted:** 2026-06-05

---

## Context

The current quiz widget (`packages/sdk/src/ui/quiz-widget.ts`) is a flat 2-step widget asking
`purpose` (investment/personal) and `horizon` (short/long). This produces only 4 classification
cells for 18 archetypes — entirely ambiguous (5 archetypes share the `investment + long horizon`
cell with posteriors within 9% of each other).

**Master_Design v4.0 §E.4 (CEO decision 2026-06-05) replaces this with a branching decision tree:**

- Q1 (gate): 4 options → routes to INWESTOR / WŁASNY UŻYTEK / CROSS-BORDER branch, or skip (neutral)
- Each branch has its own Q2, and some have a Q3 (variable length: 2–3 questions)
- Every path ends at exactly ONE archetype leaf (17 non-neutral archetypes, all reachable)
- Q3 override rule: in WŁASNY UŻYTEK branch, Q3 = luxury/remote overrides Q2 base

The current trigger (3 listing views, listing detail page only) is also replaced: trigger is now
**30-second setTimeout on any page** where the SDK is loaded. This ensures cold-start context is
gathered before users are anchored to a specific property.

Full tree structure is specified in Master_Design v4.0 §E.4.2 and in the audit at §10.1.

## Scope

- **Full rewrite of `packages/sdk/src/ui/quiz-widget.ts`**: implement the branching state machine
  from §E.4.2. Three branch renderers (INWESTOR, WŁASNY_UZYTKU, CROSS_BORDER). Variable step count
  shown as `X / 2` or `X / 3` dynamically. `resolvedArchetype` leaf result passed to callback. All
  question/answer strings in `en`, `pl`, `es` (existing translations should cover most content; fill
  in new questions following existing patterns).

- **Update `packages/sdk/src/ui/quiz-trigger.ts`**:
  - Change trigger from "3 listing views on listing detail page" to
    `setTimeout(() => triggerQuiz(), 30_000)` on SDK init.
  - Trigger works on both listing list page AND listing detail page.
  - 24h dismissal cooldown via localStorage remains unchanged.
  - Update `QUIZ_LABELS` trigger button text if needed to match new quiz framing.

- **Add `'es'` to `QuizConfig.language` schema** in
  `apps/control-plane/src/app/api/quiz/config/route.ts:25,41`: change `z.enum(['en', 'pl'])` to
  `z.enum(['en', 'pl', 'es'])` in both interface and Zod schema.

- **Rewrite tests** in `packages/sdk/src/__tests__/quiz-widget.test.ts` to cover all 17 leaf paths
  and the neutral (Q1→D) skip path.

## Acceptance criteria

- [ ] AC1: All 17 non-neutral archetype leaf paths are reachable through the decision tree. Each
      path terminates at exactly one archetype.
- [ ] AC2: Q1→D (skip) results in `resolvedArchetype: 'neutral'` with no further questions.
- [ ] AC3: Q3 override rule in WŁASNY UŻYTEK branch: selecting `luxury_buyer` or `remote_worker` at
      Q3 overrides Q2 base. Unit test covers both override cases.
- [ ] AC4: Progress indicator shows `1 / 2` or `1 / 3` correctly for each path length.
- [ ] AC5: Quiz trigger fires after 30 seconds on any page type (listing list AND listing detail).
      24h cooldown unchanged.
- [ ] AC6: `QuizConfig.language` schema accepts `'es'` in both interface and Zod schema.
- [ ] AC7: Tests cover all 17 leaf paths + skip + Q3 override. CI green.

## Definition of Done

- [ ] Branch `sdk-engineer/FOLLOW-199-quiz-v2-decision-tree`; commits referencing [FOLLOW-199]; PR
      opened; CI green.
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`.

**depends_on:** [] · **produces:** [FOLLOW-200 (quiz_completions DB), FOLLOW-201 (applyQuizLeaf +
drift detection)]
