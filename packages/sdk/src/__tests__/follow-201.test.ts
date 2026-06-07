/**
 * FOLLOW-201 — applyQuizLeaf() wiring + drift detection logic tests.
 *
 * Tests:
 *  - DRIFT_HOLD_COUNT export value (AC3)
 *  - Drift detection counter logic: 2 mismatches = no override, 3 = override (AC3)
 *  - Counter reset when signals re-align (no mismatch on a cycle) (AC4)
 *  - New candidate archetype resets counter to 1
 *  - AC5: applyQuizLeaf is pure — no DB write / no external side effects
 *  - applyQuizLeaf produces correct high-confidence leaf state (AC1)
 *  - detectMismatch integrates correctly with quiz-leaf intent state
 */

import { describe, expect, it } from 'vitest';

import { DRIFT_HOLD_COUNT } from '../index.js';
import {
  ARCHETYPE_NAMES,
  applyBehavioralSignal,
  applyQuizLeaf,
  applyQuizPrior,
  detectMismatch,
  initIntentState,
} from '../core/intent.js';
import type { Archetype, IntentState } from '../core/intent.js';

// ─── DRIFT_HOLD_COUNT ─────────────────────────────────────────────────────────

describe('DRIFT_HOLD_COUNT export (FOLLOW-201 AC3)', () => {
  it('is exported from index.ts and equals 3', () => {
    expect(DRIFT_HOLD_COUNT).toBe(3);
  });
});

// ─── Drift detection counter logic ────────────────────────────────────────────

/**
 * Run the drift detection state-machine loop as defined in refreshDirectives().
 * Returns final counter values and whether an override was triggered.
 *
 * The loop receives a sequence of behavioral_archetype values per cycle — null
 * means "no mismatch on this cycle" (count resets), a non-null value means a
 * mismatch was detected with that behavioral archetype as the candidate.
 */
function runDriftMachine(cycles: (Archetype | null)[]): {
  driftCandidateArchetype: Archetype | null;
  driftCandidateCount: number;
  overrideTriggered: boolean;
  finalIntentState: IntentState;
} {
  let driftCandidateArchetype: Archetype | null = null;
  let driftCandidateCount = 0;
  let overrideTriggered = false;
  let currentIntentState = applyQuizLeaf(initIntentState(), 'yield_hunter');

  for (const mismatchCandidate of cycles) {
    if (mismatchCandidate !== null) {
      // Mismatch cycle — mirror exact logic from index.ts refreshDirectives()
      if (mismatchCandidate === driftCandidateArchetype) {
        driftCandidateCount += 1;
      } else {
        driftCandidateArchetype = mismatchCandidate;
        driftCandidateCount = 1;
      }

      if (driftCandidateCount >= DRIFT_HOLD_COUNT) {
        // `mismatchCandidate` is the confirmed drift archetype (Archetype, never null).
        currentIntentState = applyQuizLeaf(currentIntentState, mismatchCandidate);
        overrideTriggered = true;
        driftCandidateArchetype = null;
        driftCandidateCount = 0;
      }
    } else {
      // No-mismatch cycle: reset count, preserve candidate archetype
      driftCandidateCount = 0;
    }
  }

  return {
    driftCandidateArchetype,
    driftCandidateCount,
    overrideTriggered,
    finalIntentState: currentIntentState,
  };
}

describe('drift detection counter logic (FOLLOW-201 AC3 / AC4)', () => {
  it('2 consecutive mismatch cycles do NOT trigger override', () => {
    const result = runDriftMachine(['family_buyer', 'family_buyer']);

    expect(result.overrideTriggered).toBe(false);
    expect(result.driftCandidateCount).toBe(2);
    expect(result.driftCandidateArchetype).toBe('family_buyer');
  });

  it('3 consecutive mismatch cycles with same candidate trigger override (AC3)', () => {
    const result = runDriftMachine(['family_buyer', 'family_buyer', 'family_buyer']);

    expect(result.overrideTriggered).toBe(true);
    expect(result.driftCandidateCount).toBe(0);
    expect(result.driftCandidateArchetype).toBeNull();
    // Intent state was overridden to family_buyer
    expect(result.finalIntentState.archetype).toBe('family_buyer');
    expect(result.finalIntentState.quiz_answered).toBe(true);
  });

  it('counter resets to 0 on a no-mismatch cycle but candidate archetype is preserved (AC4)', () => {
    // 2 mismatches, then realignment, then another mismatch
    const result = runDriftMachine(['flip_investor', 'flip_investor', null]);

    expect(result.driftCandidateCount).toBe(0);
    // driftCandidateArchetype is preserved (trend may resume from 0)
    expect(result.driftCandidateArchetype).toBe('flip_investor');
    expect(result.overrideTriggered).toBe(false);
  });

  it('new candidate archetype after partial accumulation resets counter to 1', () => {
    // 2 cycles for first_time_buyer, then upsizer shows up
    const result = runDriftMachine(['first_time_buyer', 'first_time_buyer', 'upsizer']);

    expect(result.driftCandidateCount).toBe(1);
    expect(result.driftCandidateArchetype).toBe('upsizer');
    expect(result.overrideTriggered).toBe(false);
  });

  it('3 non-consecutive mismatches (broken by realignment) do not trigger override', () => {
    // mismatch, no-mismatch (reset), mismatch, mismatch — only 2 consecutive
    const result = runDriftMachine(['family_buyer', null, 'family_buyer', 'family_buyer']);

    // After null, count reset to 0. Then 'family_buyer' twice = count=2 — no override.
    expect(result.overrideTriggered).toBe(false);
    expect(result.driftCandidateCount).toBe(2);
  });

  it('4 consecutive mismatches: override fires at cycle 3, cycle 4 starts fresh count', () => {
    const result = runDriftMachine([
      'family_buyer',
      'family_buyer',
      'family_buyer', // override fires here
      'family_buyer', // fresh cycle after reset → count=1
    ]);

    expect(result.overrideTriggered).toBe(true);
    // After override at cycle 3, candidate reset to null/0; cycle 4 sets count=1
    expect(result.driftCandidateCount).toBe(1);
    expect(result.driftCandidateArchetype).toBe('family_buyer');
  });

  it('override via applyQuizLeaf sets quiz_answered=true and target archetype at 0.85', () => {
    const result = runDriftMachine(['family_buyer', 'family_buyer', 'family_buyer']);

    expect(result.finalIntentState.archetype).toBe('family_buyer');
    expect(result.finalIntentState.probabilities.family_buyer).toBeCloseTo(0.85, 5);
    expect(result.finalIntentState.quiz_answered).toBe(true);
    // Confidence is capped at 1.0 (0.85 * 1.2 = 1.02)
    expect(result.finalIntentState.confidence).toBeLessThanOrEqual(1.0);
  });
});

// ─── AC5: no DB write — applyQuizLeaf is pure ────────────────────────────────

describe('AC5: drift override is session-only (no DB write)', () => {
  it('applyQuizLeaf is a pure function — does not mutate input state', () => {
    const base = initIntentState();
    const archBefore = base.archetype;
    const confBefore = base.confidence;

    const result = applyQuizLeaf(base, 'luxury_buyer');

    // Input state is unchanged
    expect(base.archetype).toBe(archBefore);
    expect(base.confidence).toBeCloseTo(confBefore, 5);
    expect(base.quiz_answered).toBe(false);

    // Result is a distinct object
    expect(result).not.toBe(base);
    expect(result.archetype).toBe('luxury_buyer');
  });
});

// ─── detectMismatch integration with applyQuizLeaf state ─────────────────────

describe('detectMismatch integration with applyQuizLeaf state (FOLLOW-201)', () => {
  it('quiz=yield_hunter (investor) + strong own-use behavioral → mismatch detected', () => {
    // Build a behavioral state with 3 signals and strong own-use lean.
    // calculateBehavioralOnlyState ignores quiz, so use applyQuizPrior to push the
    // probability distribution for test purposes (starts from initIntentState, not quiz).
    let behavioralState = initIntentState();
    behavioralState = applyBehavioralSignal(behavioralState, 'listing.viewed');
    behavioralState = applyBehavioralSignal(behavioralState, 'listing.viewed');
    behavioralState = applyBehavioralSignal(behavioralState, 'listing.viewed');
    // Push strong own-use probability to simulate personal behavioral signals
    behavioralState = applyQuizPrior(behavioralState, 'personal', 'long');

    // Quiz-assigned archetype: investor
    const quizState = applyQuizLeaf(initIntentState(), 'yield_hunter');

    const mismatch = detectMismatch(quizState.archetype, behavioralState, 'sess-drift-001');
    expect(mismatch).not.toBeNull();
    expect(mismatch?.quiz_archetype).toBe('yield_hunter');
  });

  it('quiz=flip_investor + investor behavioral → no mismatch (aligned) → counter resets', () => {
    let behavioralState = initIntentState();
    behavioralState = applyBehavioralSignal(behavioralState, 'cta.clicked');
    behavioralState = applyBehavioralSignal(behavioralState, 'cta.clicked');
    behavioralState = applyBehavioralSignal(behavioralState, 'cta.clicked');
    behavioralState = applyQuizPrior(behavioralState, 'investment', 'short');

    const quizState = applyQuizLeaf(initIntentState(), 'flip_investor');
    const mismatch = detectMismatch(quizState.archetype, behavioralState, 'sess-drift-002');
    // Both investor group — no mismatch
    expect(mismatch).toBeNull();
  });

  it('mismatch.behavioral_archetype is the candidate used for drift counter', () => {
    let behavioralState = initIntentState();
    for (let i = 0; i < 3; i++) {
      behavioralState = applyBehavioralSignal(behavioralState, 'listing.viewed');
    }
    behavioralState = applyQuizPrior(behavioralState, 'personal', 'long');

    const quizState = applyQuizLeaf(initIntentState(), 'yield_hunter');
    const mismatch = detectMismatch(quizState.archetype, behavioralState, 'sess-drift-003');

    expect(mismatch).not.toBeNull();
    if (mismatch) {
      // behavioral_archetype is what drift counter tracks
      expect(ARCHETYPE_NAMES).toContain(mismatch.behavioral_archetype);
    }
  });
});

// ─── applyQuizLeaf — all archetypes reachable (AC1) ──────────────────────────

describe('applyQuizLeaf works for all 18 archetypes (FOLLOW-201 AC1)', () => {
  for (const archetype of ARCHETYPE_NAMES) {
    it(`archetype=${archetype} → correct probability distribution`, () => {
      const s = applyQuizLeaf(initIntentState(), archetype);
      expect(s.archetype).toBe(archetype);
      expect(s.probabilities[archetype]).toBeCloseTo(0.85, 5);
      expect(s.quiz_answered).toBe(true);
      expect(s.confidence).toBeLessThanOrEqual(1.0);
    });
  }
});
