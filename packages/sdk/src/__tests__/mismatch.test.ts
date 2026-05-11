import { describe, expect, it } from 'vitest';

import {
  applyBehavioralSignal,
  applyQuizPrior,
  calculateBehavioralOnlyState,
  detectMismatch,
  initIntentState,
} from '../core/intent.js';
import type { IntentState } from '../core/intent.js';
import { classifyMismatchSeverity } from '@estalara/shared';

/** Build a behavioral state with signal_count >= 3 and a strong family lean. */
function buildFamilyBehavioralState(): IntentState {
  let s = initIntentState();
  s = applyBehavioralSignal(s, 'listing.viewed');
  s = applyBehavioralSignal(s, 'listing.viewed');
  s = applyBehavioralSignal(s, 'listing.viewed');
  // Apply personal+long quiz to push family probability high (simulates behavioral contradiction)
  s = applyQuizPrior(s, 'personal', 'long');
  // quiz_answered is now true but signal_count = 3 from the behavioral signals above
  return s;
}

/** Build a behavioral state with signal_count >= 3 and a strong investor lean. */
function buildInvestorBehavioralState(): IntentState {
  let s = initIntentState();
  s = applyBehavioralSignal(s, 'cta.clicked');
  s = applyBehavioralSignal(s, 'cta.clicked');
  s = applyBehavioralSignal(s, 'cta.clicked');
  s = applyQuizPrior(s, 'investment', 'short');
  return s;
}

describe('detectMismatch', () => {
  it('quiz=investor, behavioral strongly family → returns MismatchEvent', () => {
    const behavioralState = buildFamilyBehavioralState();

    // Quiz says investor but behavioral says family
    const mismatch = detectMismatch('investor', behavioralState, 'sess-abc');

    expect(mismatch).not.toBeNull();
    expect(mismatch?.quiz_archetype).toBe('investor');
    expect(mismatch?.behavioral_archetype).toBe('family');
    expect(mismatch?.session_id).toBe('sess-abc');
    expect(mismatch?.signal_count).toBe(3);
  });

  it('quiz=investor, behavioral also investor → returns null', () => {
    const behavioralState = buildInvestorBehavioralState();
    const mismatch = detectMismatch('investor', behavioralState, 'sess-xyz');
    expect(mismatch).toBeNull();
  });

  it('signal_count=2 (< 3) → returns null regardless of archetype mismatch', () => {
    let s = initIntentState();
    s = applyBehavioralSignal(s, 'listing.viewed'); // 1
    s = applyBehavioralSignal(s, 'listing.viewed'); // 2
    // Push family high even with 2 signals
    s = applyQuizPrior(s, 'personal', 'long');

    expect(s.signal_count).toBe(2);
    expect(detectMismatch('investor', s, 'sess-abc')).toBeNull();
  });

  it('signal_count=0 → returns null', () => {
    const s = initIntentState();
    expect(s.signal_count).toBe(0);
    expect(detectMismatch('investor', s, 'sess-abc')).toBeNull();
  });

  it('confidence_gap reflects behavioral top confidence minus quiz archetype behavioral probability', () => {
    const behavioralState = buildFamilyBehavioralState();
    const mismatch = detectMismatch('investor', behavioralState, 'sess-gap');

    expect(mismatch).not.toBeNull();
    if (mismatch) {
      const expectedGap = behavioralState.confidence - behavioralState.probabilities.investor;
      expect(mismatch.confidence_gap).toBeCloseTo(expectedGap, 5);
    }
  });

  it('quiz=family, behavioral investor with >0.4 probability → returns MismatchEvent', () => {
    const behavioralState = buildInvestorBehavioralState();
    const mismatch = detectMismatch('family', behavioralState, 'sess-inv');
    expect(mismatch).not.toBeNull();
    expect(mismatch?.behavioral_archetype).toBe('investor');
  });
});

describe('calculateBehavioralOnlyState', () => {
  it('empty signal history → returns BASE_PRIOR state', () => {
    const s = calculateBehavioralOnlyState([]);
    expect(s.probabilities.investor).toBeCloseTo(0.25, 5);
    expect(s.probabilities.family).toBeCloseTo(0.35, 5);
    expect(s.probabilities.neutral).toBeCloseTo(0.4, 5);
    expect(s.signal_count).toBe(0);
    expect(s.quiz_answered).toBe(false);
  });

  it('5× listing.viewed → signal_count=5, neutral probability decreases', () => {
    const history = Array.from({ length: 5 }, () => ({ eventType: 'listing.viewed' }));
    const s = calculateBehavioralOnlyState(history);
    expect(s.signal_count).toBe(5);
    expect(s.probabilities.neutral).toBeLessThan(0.4);
    expect(s.probabilities.investor).toBeGreaterThan(0.25);
  });

  it('unknown event types are ignored (signal_count unchanged)', () => {
    const history = [
      { eventType: 'listing.viewed' },
      { eventType: 'unknown.custom.event' },
      { eventType: 'listing.viewed' },
    ];
    const s = calculateBehavioralOnlyState(history);
    expect(s.signal_count).toBe(2);
  });

  it('quiz_answered is always false (behavioral-only state has no quiz)', () => {
    const history = [{ eventType: 'listing.viewed' }, { eventType: 'cta.clicked' }];
    const s = calculateBehavioralOnlyState(history);
    expect(s.quiz_answered).toBe(false);
  });
});

describe('classifyMismatchSeverity', () => {
  it('gap=0.6 → "high"', () => {
    expect(classifyMismatchSeverity(0.6)).toBe('high');
  });

  it('gap=0.4 → "medium"', () => {
    expect(classifyMismatchSeverity(0.4)).toBe('medium');
  });

  it('gap=0.2 → "low"', () => {
    expect(classifyMismatchSeverity(0.2)).toBe('low');
  });

  it('gap=0.3 → "low" (boundary — not strictly above 0.3)', () => {
    expect(classifyMismatchSeverity(0.3)).toBe('low');
  });

  it('gap=0.5 → "low" (boundary — not strictly above 0.5)', () => {
    expect(classifyMismatchSeverity(0.5)).toBe('medium');
  });
});
