# FOLLOW-201 — applyQuizLeaf() + drift detection activation

**Sprint:** 15 **Agent:** sdk-engineer **Priority:** P1 **Estimated hours:** 5 **Status:** READY
**Source:** Audit §10.1, §E.4.4/E.4.5, Master_Design §E.4.4/E.4.5 v4.0 **Promoted:** 2026-06-05

---

## Context

The new quiz decision tree (FOLLOW-199) produces a single unambiguous archetype leaf. The current
`applyQuizPrior()` function multiplies likelihood vectors into the Bayesian prior — designed for the
old flat 2-question quiz where the result was partial information. With a decision tree that
resolves to one specific archetype, **direct assignment at high confidence is correct**.

Additionally, `detectMismatch()` (verified existing at `intent.ts:491`) produces mismatch findings
but the SDK currently discards them — the session archetype stays as the quiz result regardless of
behavioral evidence. Master_Design v4.0 §E.4.5 specifies a `DRIFT_HOLD_COUNT = 3` anti-thrash guard:
a drift archetype must be confirmed across 3 consecutive `refreshDirectives()` cycles before
overriding the session state.

**What exists (verified in code):**

- `detectMismatch()` at `intent.ts:491` — working, produces `MismatchEvent`
- `calculateBehavioralOnlyState()` at `intent.ts:538` — working
- Mismatch detection in `index.ts:379–398` — detected and logged, but action discarded

**What is missing:**

- `applyQuizLeaf()` pure function in `intent.ts`
- `driftCandidateArchetype` / `driftCandidateCount` / `DRIFT_HOLD_COUNT` state in `index.ts`
- Override action when `driftCandidateCount >= DRIFT_HOLD_COUNT`

## Scope

1. **Add `applyQuizLeaf()` pure function** to `packages/sdk/src/core/intent.ts`:

   ```typescript
   export function applyQuizLeaf(state: IntentState, archetype: Archetype): IntentState {
     const probabilities = Object.fromEntries(
       ARCHETYPE_NAMES.map((k) => [
         k,
         k === archetype ? 0.85 : 0.15 / (ARCHETYPE_NAMES.length - 1),
       ]),
     ) as ArchetypeProbabilities;
     return {
       archetype,
       confidence: Math.min(0.85 * QUIZ_CONFIDENCE_BONUS, 1.0), // ~0.95
       probabilities,
       signal_count: state.signal_count,
       last_updated_at: Date.now(),
       quiz_answered: true,
     };
   }
   ```

   Keep `applyQuizPrior()` as a legacy fallback (do not remove).

2. **Update `packages/sdk/src/index.ts`**:
   - In the quiz completion callback: replace `applyQuizPrior(state, purpose, horizon)` call with
     `applyQuizLeaf(state, resolvedArchetype)` from the FOLLOW-199 widget callback.
   - Add module-level state: `let driftCandidateArchetype: Archetype | null = null`,
     `let driftCandidateCount = 0`, `const DRIFT_HOLD_COUNT = 3`.
   - In `refreshDirectives()`, after `detectMismatch()`:
     - If mismatch: increment `driftCandidateCount` for the same candidate archetype (reset to 1 on
       new candidate).
     - If `driftCandidateCount >= DRIFT_HOLD_COUNT`: override `currentIntentState` via
       `applyQuizLeaf(currentIntentState, driftCandidateArchetype)`, reset counters, re-run
       `refreshDirectives()`.
     - If no mismatch: reset both counters to 0/null.

## Acceptance criteria

- [ ] AC1: `applyQuizLeaf()` exported from `intent.ts`. Sets the target archetype to probability
      ~0.85, confidence ~0.95. Pure function (no side effects). Unit tests cover: correct archetype
      set to high probability, all others set to residual, confidence cap at 1.0.
- [ ] AC2: Quiz completion callback in `index.ts` calls `applyQuizLeaf()` not `applyQuizPrior()`.
- [ ] AC3: `DRIFT_HOLD_COUNT = 3` state is module-level in `index.ts`. After 3 consecutive mismatch
      cycles, `currentIntentState.archetype` switches to the drift candidate. Unit test confirms the
      3-cycle threshold (2 mismatches = no change, 3 mismatches = override).
- [ ] AC4: Drift counter resets to 0 when signals realign (no mismatch on a cycle). Unit test covers
      reset.
- [ ] AC5: `description_cache_persistent` is NOT modified by the drift override (session-only
      change). No DB write triggered by drift.
- [ ] AC6: Tests and CI green.

## Definition of Done

- [ ] Branch `sdk-engineer/FOLLOW-201-apply-quiz-leaf-drift-detection`; commits referencing
      [FOLLOW-201]; PR opened; CI green.
- [ ] `promoted_to_queue: true` synced in `backlog/FOLLOW_UPS.md`.

**depends_on:** [FOLLOW-199 (quiz v2.0 decision tree, provides resolvedArchetype)] · **produces:**
[correct high-confidence archetype assignment from quiz, session-level drift correction]
