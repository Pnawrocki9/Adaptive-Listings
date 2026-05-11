import { describe, expect, it } from 'vitest';

import {
  applyBehavioralSignal,
  applyDecay,
  applyQuizPrior,
  classifyFromProbabilities,
  initIntentState,
  normalize,
} from '../core/intent.js';
import type { ArchetypeProbabilities, IntentState } from '../core/intent.js';

function sumProbs(p: ArchetypeProbabilities): number {
  return p.investor + p.family + p.neutral;
}

describe('initIntentState', () => {
  it('initializes with BASE_PRIOR probabilities', () => {
    const s = initIntentState();
    expect(s.probabilities.investor).toBeCloseTo(0.25, 5);
    expect(s.probabilities.family).toBeCloseTo(0.35, 5);
    expect(s.probabilities.neutral).toBeCloseTo(0.4, 5);
  });

  it('probabilities sum to 1.0', () => {
    const s = initIntentState();
    expect(sumProbs(s.probabilities)).toBeCloseTo(1.0, 5);
  });

  it('archetype is "neutral" (highest base prior)', () => {
    const s = initIntentState();
    expect(s.archetype).toBe('neutral');
  });

  it('signal_count is 0', () => {
    expect(initIntentState().signal_count).toBe(0);
  });

  it('quiz_answered is false', () => {
    expect(initIntentState().quiz_answered).toBe(false);
  });

  it('confidence equals max probability initially (no quiz bonus)', () => {
    const s = initIntentState();
    expect(s.confidence).toBeCloseTo(0.4, 5);
  });
});

describe('applyQuizPrior', () => {
  it('purpose=investment shifts strongly toward investor (>0.6)', () => {
    const s = applyQuizPrior(initIntentState(), 'investment', 'short');
    expect(s.probabilities.investor).toBeGreaterThan(0.6);
  });

  it('purpose=personal shifts toward family (>0.5)', () => {
    const s = applyQuizPrior(initIntentState(), 'personal', 'long');
    expect(s.probabilities.family).toBeGreaterThan(0.5);
  });

  it('horizon=short with investment further boosts investor over horizon=long', () => {
    const short = applyQuizPrior(initIntentState(), 'investment', 'short');
    const long = applyQuizPrior(initIntentState(), 'investment', 'long');
    expect(short.probabilities.investor).toBeGreaterThan(long.probabilities.investor);
  });

  it('quiz_answered is true after applying', () => {
    const s = applyQuizPrior(initIntentState(), 'investment', 'short');
    expect(s.quiz_answered).toBe(true);
  });

  it('probabilities sum to 1.0 after quiz update', () => {
    const s = applyQuizPrior(initIntentState(), 'investment', 'short');
    expect(sumProbs(s.probabilities)).toBeCloseTo(1.0, 5);
  });

  it('confidence > 0.5 after a strong quiz signal', () => {
    const s = applyQuizPrior(initIntentState(), 'investment', 'short');
    expect(s.confidence).toBeGreaterThan(0.5);
  });

  it('confidence bonus caps at 1.0', () => {
    const s = applyQuizPrior(initIntentState(), 'investment', 'short');
    expect(s.confidence).toBeLessThanOrEqual(1.0);
  });

  it('archetype switches to investor for investment+short quiz', () => {
    const s = applyQuizPrior(initIntentState(), 'investment', 'short');
    expect(s.archetype).toBe('investor');
  });

  it('archetype switches to family for personal+long quiz', () => {
    const s = applyQuizPrior(initIntentState(), 'personal', 'long');
    expect(s.archetype).toBe('family');
  });
});

describe('applyBehavioralSignal', () => {
  it('listing.viewed increases investor and family probabilities', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'listing.viewed');
    expect(after.probabilities.investor).toBeGreaterThan(before.probabilities.investor);
    expect(after.probabilities.family).toBeGreaterThan(before.probabilities.family);
  });

  it('multiple signals accumulate (signal_count increases)', () => {
    let s = initIntentState();
    s = applyBehavioralSignal(s, 'listing.viewed');
    s = applyBehavioralSignal(s, 'cta.clicked');
    s = applyBehavioralSignal(s, 'scroll.depth');
    expect(s.signal_count).toBe(3);
  });

  it('unknown event type returns unchanged state (same reference)', () => {
    const s = initIntentState();
    const after = applyBehavioralSignal(s, 'unknown.event');
    expect(after).toBe(s);
    expect(after.signal_count).toBe(0);
  });

  it('probabilities sum to 1.0 after behavioral update', () => {
    const s = applyBehavioralSignal(initIntentState(), 'cta.clicked');
    expect(sumProbs(s.probabilities)).toBeCloseTo(1.0, 5);
  });

  it('single behavioral signal effect is weaker than a quiz answer', () => {
    const quiz = applyQuizPrior(initIntentState(), 'investment', 'short');
    const oneSignal = applyBehavioralSignal(initIntentState(), 'cta.clicked');
    expect(quiz.probabilities.investor).toBeGreaterThan(oneSignal.probabilities.investor);
  });

  it('quiz.event signal does not change probabilities (no-op)', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'quiz.event');
    // signal_count increments but probabilities are unchanged
    expect(after.probabilities.investor).toBeCloseTo(before.probabilities.investor, 5);
    expect(after.probabilities.family).toBeCloseTo(before.probabilities.family, 5);
    expect(after.probabilities.neutral).toBeCloseTo(before.probabilities.neutral, 5);
    expect(after.signal_count).toBe(1);
  });
});

describe('applyDecay', () => {
  it('0ms elapsed returns state unchanged', () => {
    const s = applyQuizPrior(initIntentState(), 'investment', 'short');
    const after = applyDecay(s, 0);
    expect(after).toBe(s);
  });

  it('10 minutes elapsed moves probabilities toward uniform (1/3)', () => {
    const investor = applyQuizPrior(initIntentState(), 'investment', 'short');
    const decayed = applyDecay(investor, 600_000);
    // investor probability drops, neutral/family rise toward 1/3
    expect(decayed.probabilities.investor).toBeLessThan(investor.probabilities.investor);
    expect(decayed.probabilities.neutral).toBeGreaterThan(investor.probabilities.neutral);
  });

  it('probabilities sum to 1.0 after decay', () => {
    const s = applyQuizPrior(initIntentState(), 'investment', 'short');
    const decayed = applyDecay(s, 600_000);
    expect(sumProbs(decayed.probabilities)).toBeCloseTo(1.0, 5);
  });

  it('highly confident investor decays toward neutral over 30 minutes', () => {
    const investor = applyQuizPrior(initIntentState(), 'investment', 'short');
    const decayed30 = applyDecay(investor, 30 * 60_000);
    // Confidence (with quiz bonus) should drop notably from the original
    expect(decayed30.confidence).toBeLessThan(investor.confidence);
    // Investor probability should drop noticeably
    expect(decayed30.probabilities.investor).toBeLessThan(0.7);
  });

  it('decay factor clamps at 1.0 — extreme elapsedMs results in uniform distribution', () => {
    const s = applyQuizPrior(initIntentState(), 'investment', 'short');
    const decayed = applyDecay(s, 100 * 60_000); // 100 minutes → factor would be 2.0, clamped to 1.0
    expect(decayed.probabilities.investor).toBeCloseTo(UNIFORM_VALUE, 4);
    expect(decayed.probabilities.family).toBeCloseTo(UNIFORM_VALUE, 4);
    expect(decayed.probabilities.neutral).toBeCloseTo(UNIFORM_VALUE, 4);
  });
});

const UNIFORM_VALUE = 1 / 3;

describe('classifyFromProbabilities', () => {
  it('investor majority: { 0.7, 0.2, 0.1 } → investor, confidence 0.7', () => {
    const r = classifyFromProbabilities({ investor: 0.7, family: 0.2, neutral: 0.1 });
    expect(r.archetype).toBe('investor');
    expect(r.confidence).toBeCloseTo(0.7, 5);
  });

  it('family majority: { 0.33, 0.34, 0.33 } → family', () => {
    const r = classifyFromProbabilities({ investor: 0.33, family: 0.34, neutral: 0.33 });
    expect(r.archetype).toBe('family');
  });

  it('uniform distribution → archetype "neutral", confidence ~0.33', () => {
    const r = classifyFromProbabilities({
      investor: UNIFORM_VALUE,
      family: UNIFORM_VALUE,
      neutral: UNIFORM_VALUE,
    });
    expect(r.archetype).toBe('neutral');
    expect(r.confidence).toBeCloseTo(UNIFORM_VALUE, 5);
  });

  it('three-way tie breaks toward neutral', () => {
    const r = classifyFromProbabilities({ investor: 0.4, family: 0.4, neutral: 0.4 });
    expect(r.archetype).toBe('neutral');
  });
});

describe('normalize', () => {
  it('{ 2, 1, 1 } normalizes to { 0.5, 0.25, 0.25 }', () => {
    const r = normalize({ investor: 2, family: 1, neutral: 1 });
    expect(r.investor).toBeCloseTo(0.5, 5);
    expect(r.family).toBeCloseTo(0.25, 5);
    expect(r.neutral).toBeCloseTo(0.25, 5);
  });

  it('all values are in [0, 1] after normalization', () => {
    const r = normalize({ investor: 10, family: 5, neutral: 5 });
    expect(r.investor).toBeGreaterThanOrEqual(0);
    expect(r.investor).toBeLessThanOrEqual(1);
    expect(r.family).toBeGreaterThanOrEqual(0);
    expect(r.family).toBeLessThanOrEqual(1);
    expect(r.neutral).toBeGreaterThanOrEqual(0);
    expect(r.neutral).toBeLessThanOrEqual(1);
  });

  it('result sums to 1.0', () => {
    const r = normalize({ investor: 3.7, family: 2.1, neutral: 0.5 });
    expect(sumProbs(r)).toBeCloseTo(1.0, 5);
  });

  it('NaN inputs fall back to uniform distribution', () => {
    const r = normalize({ investor: NaN, family: 1, neutral: 1 });
    expect(r.investor).toBeCloseTo(UNIFORM_VALUE, 5);
    expect(r.family).toBeCloseTo(UNIFORM_VALUE, 5);
    expect(r.neutral).toBeCloseTo(UNIFORM_VALUE, 5);
  });

  it('all-zero inputs fall back to uniform distribution', () => {
    const r = normalize({ investor: 0, family: 0, neutral: 0 });
    expect(r.investor).toBeCloseTo(UNIFORM_VALUE, 5);
    expect(r.family).toBeCloseTo(UNIFORM_VALUE, 5);
    expect(r.neutral).toBeCloseTo(UNIFORM_VALUE, 5);
  });

  it('negative inputs are clamped to 0 before normalization', () => {
    const r = normalize({ investor: -1, family: 1, neutral: 1 });
    expect(r.investor).toBeCloseTo(0, 5);
    expect(r.family).toBeCloseTo(0.5, 5);
    expect(r.neutral).toBeCloseTo(0.5, 5);
  });
});

describe('full classification flow', () => {
  it('investor journey: quiz(investment, short) + 3×listing + 2×cta → investor, confidence > 0.7', () => {
    let s: IntentState = initIntentState();
    s = applyQuizPrior(s, 'investment', 'short');
    s = applyBehavioralSignal(s, 'listing.viewed');
    s = applyBehavioralSignal(s, 'listing.viewed');
    s = applyBehavioralSignal(s, 'listing.viewed');
    s = applyBehavioralSignal(s, 'cta.clicked');
    s = applyBehavioralSignal(s, 'cta.clicked');

    expect(s.archetype).toBe('investor');
    expect(s.confidence).toBeGreaterThan(0.7);
    expect(s.signal_count).toBe(5);
    expect(s.quiz_answered).toBe(true);
  });

  it('family journey: quiz(personal, long) + listings → family, confidence > 0.6', () => {
    let s: IntentState = initIntentState();
    s = applyQuizPrior(s, 'personal', 'long');
    s = applyBehavioralSignal(s, 'listing.viewed');
    s = applyBehavioralSignal(s, 'listing.viewed');

    expect(s.archetype).toBe('family');
    expect(s.confidence).toBeGreaterThan(0.6);
  });

  it('decay reduces confidence over 30 minutes after strong investor classification', () => {
    let s: IntentState = initIntentState();
    s = applyQuizPrior(s, 'investment', 'short');
    s = applyBehavioralSignal(s, 'cta.clicked');
    s = applyBehavioralSignal(s, 'listing.viewed');
    const before = s.confidence;
    s = applyDecay(s, 30 * 60_000);
    expect(s.confidence).toBeLessThan(before);
  });
});
