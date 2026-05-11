import { describe, expect, it } from 'vitest';

import {
  INVESTOR_ARCHETYPES,
  OWN_USE_ARCHETYPES,
  applyBehavioralSignal,
  applyQuizPrior,
  calculateBehavioralOnlyState,
  detectMismatch,
  initIntentState,
} from '../core/intent.js';
import type { IntentState } from '../core/intent.js';
import { classifyMismatchSeverity } from '@estalara/shared';

/**
 * Build a behavioral state with signal_count >= 3 and a strong own-use lean.
 * Uses 3 listing.viewed signals + personal+long quiz to push own-use archetypes high.
 */
function buildFamilyBehavioralState(): IntentState {
  let s = initIntentState();
  s = applyBehavioralSignal(s, 'listing.viewed');
  s = applyBehavioralSignal(s, 'listing.viewed');
  s = applyBehavioralSignal(s, 'listing.viewed');
  // Apply personal+long quiz to push own-use probability high (simulates behavioral data)
  s = applyQuizPrior(s, 'personal', 'long');
  // quiz_answered=true, signal_count=3 from the behavioral signals above
  return s;
}

/**
 * Build a behavioral state with signal_count >= 3 and a strong investor lean.
 * Uses 3 cta.clicked signals + investment+short quiz.
 */
function buildInvestorBehavioralState(): IntentState {
  let s = initIntentState();
  s = applyBehavioralSignal(s, 'cta.clicked');
  s = applyBehavioralSignal(s, 'cta.clicked');
  s = applyBehavioralSignal(s, 'cta.clicked');
  s = applyQuizPrior(s, 'investment', 'short');
  return s;
}

describe('detectMismatch', () => {
  it('quiz=yield_hunter, behavioral strongly own-use → returns MismatchEvent', () => {
    const behavioralState = buildFamilyBehavioralState();

    // Quiz says investor (yield_hunter) but behavioral points to own-use group
    const mismatch = detectMismatch('yield_hunter', behavioralState, 'sess-abc');

    expect(mismatch).not.toBeNull();
    expect(mismatch?.quiz_archetype).toBe('yield_hunter');
    expect(mismatch?.session_id).toBe('sess-abc');
    expect(mismatch?.signal_count).toBe(3);
  });

  it('quiz=flip_investor, behavioral also investor → returns null', () => {
    const behavioralState = buildInvestorBehavioralState();
    // Both quiz and behavioral agree on investor group — no mismatch
    const mismatch = detectMismatch('flip_investor', behavioralState, 'sess-xyz');
    expect(mismatch).toBeNull();
  });

  it('signal_count=2 (< 3) → returns null regardless of archetype mismatch', () => {
    let s = initIntentState();
    s = applyBehavioralSignal(s, 'listing.viewed'); // 1
    s = applyBehavioralSignal(s, 'listing.viewed'); // 2
    // Push own-use high even with 2 signals
    s = applyQuizPrior(s, 'personal', 'long');

    expect(s.signal_count).toBe(2);
    expect(detectMismatch('yield_hunter', s, 'sess-abc')).toBeNull();
  });

  it('signal_count=0 → returns null', () => {
    const s = initIntentState();
    expect(s.signal_count).toBe(0);
    expect(detectMismatch('yield_hunter', s, 'sess-abc')).toBeNull();
  });

  it('confidence_gap reflects behavioral top confidence minus quiz archetype behavioral probability', () => {
    const behavioralState = buildFamilyBehavioralState();
    const mismatch = detectMismatch('yield_hunter', behavioralState, 'sess-gap');

    expect(mismatch).not.toBeNull();
    if (mismatch) {
      const expectedGap = behavioralState.confidence - behavioralState.probabilities.yield_hunter;
      expect(mismatch.confidence_gap).toBeCloseTo(expectedGap, 5);
    }
  });

  it('quiz=family_buyer, behavioral investor group dominant → returns MismatchEvent', () => {
    const behavioralState = buildInvestorBehavioralState();
    const mismatch = detectMismatch('family_buyer', behavioralState, 'sess-inv');
    expect(mismatch).not.toBeNull();
    expect(INVESTOR_ARCHETYPES.has(mismatch?.behavioral_archetype ?? 'neutral')).toBe(true);
  });
});

describe('calculateBehavioralOnlyState', () => {
  it('empty signal history → returns BASE_PRIOR state', () => {
    const s = calculateBehavioralOnlyState([]);
    expect(s.probabilities.yield_hunter).toBeCloseTo(0.04, 5);
    expect(s.probabilities.family_buyer).toBeCloseTo(0.04, 5);
    expect(s.probabilities.neutral).toBeCloseTo(0.37, 5);
    expect(s.signal_count).toBe(0);
    expect(s.quiz_answered).toBe(false);
  });

  it('5× listing.viewed → signal_count=5, neutral probability decreases', () => {
    const history = Array.from({ length: 5 }, () => ({ eventType: 'listing.viewed' }));
    const s = calculateBehavioralOnlyState(history);
    expect(s.signal_count).toBe(5);
    expect(s.probabilities.neutral).toBeLessThan(0.37);
    expect(s.probabilities.yield_hunter).toBeGreaterThan(0.04);
  });

  it('investor signals accumulate and own-use stays low', () => {
    const history = Array.from({ length: 5 }, () => ({ eventType: 'cta.clicked' }));
    const s = calculateBehavioralOnlyState(history);
    const investorProb = [...INVESTOR_ARCHETYPES].reduce((sum, a) => sum + s.probabilities[a], 0);
    const ownUseProb = [...OWN_USE_ARCHETYPES].reduce((sum, a) => sum + s.probabilities[a], 0);
    // cta.clicked boosts investor archetypes more than own-use
    expect(investorProb).toBeGreaterThan(ownUseProb);
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

  it('gap=0.5 → "medium" (boundary — not strictly above 0.5)', () => {
    expect(classifyMismatchSeverity(0.5)).toBe('medium');
  });
});
