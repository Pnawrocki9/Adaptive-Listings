import { describe, expect, it } from 'vitest';

import {
  ARCHETYPE_NAMES,
  INVESTOR_ARCHETYPES,
  OWN_USE_ARCHETYPES,
  applyBehavioralSignal,
  applyDecay,
  applyQuizLeaf,
  applyQuizPrior,
  classifyFromProbabilities,
  initIntentState,
  normalize,
} from '../core/intent.js';
import type { ArchetypeProbabilities, IntentState } from '../core/intent.js';

/** Sum all 18 archetype probabilities. */
function sumProbs(p: ArchetypeProbabilities): number {
  return ARCHETYPE_NAMES.reduce((sum, k) => sum + p[k], 0);
}

/** Build a full ArchetypeProbabilities with zeros for unspecified keys. */
function makeProbs(overrides: Partial<ArchetypeProbabilities> = {}): ArchetypeProbabilities {
  const zeros = Object.fromEntries(ARCHETYPE_NAMES.map((k) => [k, 0])) as ArchetypeProbabilities;
  return { ...zeros, ...overrides };
}

const UNIFORM_18 = 1 / 18;

describe('initIntentState', () => {
  it('initializes with BASE_PRIOR probabilities', () => {
    const s = initIntentState();
    // Sample a few archetype priors
    expect(s.probabilities.yield_hunter).toBeCloseTo(0.04, 5);
    expect(s.probabilities.family_buyer).toBeCloseTo(0.04, 5);
    expect(s.probabilities.neutral).toBeCloseTo(0.37, 5);
  });

  it('probabilities sum to 1.0', () => {
    const s = initIntentState();
    expect(sumProbs(s.probabilities)).toBeCloseTo(1.0, 5);
  });

  it('archetype is "neutral" (highest base prior at 0.37)', () => {
    const s = initIntentState();
    expect(s.archetype).toBe('neutral');
  });

  it('signal_count is 0', () => {
    expect(initIntentState().signal_count).toBe(0);
  });

  it('quiz_answered is false', () => {
    expect(initIntentState().quiz_answered).toBe(false);
  });

  it('confidence equals neutral prior (0.37) initially', () => {
    const s = initIntentState();
    expect(s.confidence).toBeCloseTo(0.37, 5);
  });
});

describe('applyQuizPrior', () => {
  it('investment+short quiz selects flip_investor (highest combined likelihood)', () => {
    // flip_investor has likelihood 0.65 × 0.80 = 0.52 product
    // compared to yield_hunter 0.80 × 0.55 = 0.44 and neutral 0.10 × 0.20 = 0.02
    const s = applyQuizPrior(initIntentState(), 'investment', 'short');
    expect(s.archetype).toBe('flip_investor');
    expect(INVESTOR_ARCHETYPES.has(s.archetype)).toBe(true);
  });

  it('quiz(personal, long) shifts probability mass strongly toward own-use archetypes', () => {
    const s = applyQuizPrior(initIntentState(), 'personal', 'long');
    const ownUseProb = [...OWN_USE_ARCHETYPES].reduce((sum, a) => sum + s.probabilities[a], 0);
    const investorProb = [...INVESTOR_ARCHETYPES].reduce((sum, a) => sum + s.probabilities[a], 0);
    expect(ownUseProb).toBeGreaterThan(investorProb * 4);
    expect(ownUseProb).toBeGreaterThan(0.4);
  });

  it('horizon=short with investment boosts flip_investor over horizon=long', () => {
    const short = applyQuizPrior(initIntentState(), 'investment', 'short');
    const long = applyQuizPrior(initIntentState(), 'investment', 'long');
    expect(short.probabilities.flip_investor).toBeGreaterThan(long.probabilities.flip_investor);
  });

  it('quiz_answered is true after applying', () => {
    const s = applyQuizPrior(initIntentState(), 'investment', 'short');
    expect(s.quiz_answered).toBe(true);
  });

  it('probabilities sum to 1.0 after quiz update', () => {
    const s = applyQuizPrior(initIntentState(), 'investment', 'short');
    expect(sumProbs(s.probabilities)).toBeCloseTo(1.0, 5);
  });

  it('quiz_answered enables confidence bonus (flip_investor > raw max)', () => {
    const s = applyQuizPrior(initIntentState(), 'investment', 'short');
    // raw max probability should be ~ 0.178; with × 1.2 bonus → ~ 0.214
    // confirmed > 0.15
    expect(s.confidence).toBeGreaterThan(0.15);
    expect(s.quiz_answered).toBe(true);
  });

  it('confidence bonus caps at 1.0', () => {
    const s = applyQuizPrior(initIntentState(), 'investment', 'short');
    expect(s.confidence).toBeLessThanOrEqual(1.0);
  });

  it('investment+long quiz selects portfolio_builder (highest combined likelihood for long)', () => {
    // portfolio_builder: 0.75 × 0.70 = 0.525 — highest for (investment, long)
    const s = applyQuizPrior(initIntentState(), 'investment', 'long');
    expect(s.archetype).toBe('portfolio_builder');
    expect(INVESTOR_ARCHETYPES.has(s.archetype)).toBe(true);
  });
});

describe('applyBehavioralSignal', () => {
  it('listing.viewed boosts yield_hunter and portfolio_builder (investor-type signals)', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'listing.viewed');
    expect(after.probabilities.yield_hunter).toBeGreaterThan(before.probabilities.yield_hunter);
    expect(after.probabilities.portfolio_builder).toBeGreaterThan(
      before.probabilities.portfolio_builder,
    );
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

  it('quiz answer shifts flip_investor more than a single cta.clicked', () => {
    const quiz = applyQuizPrior(initIntentState(), 'investment', 'short');
    const oneSignal = applyBehavioralSignal(initIntentState(), 'cta.clicked');
    expect(quiz.probabilities.flip_investor).toBeGreaterThan(oneSignal.probabilities.flip_investor);
  });

  it('quiz.event signal does not change probabilities (no-op)', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'quiz.event');
    expect(after.probabilities.yield_hunter).toBeCloseTo(before.probabilities.yield_hunter, 5);
    expect(after.probabilities.family_buyer).toBeCloseTo(before.probabilities.family_buyer, 5);
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

  it('10 minutes elapsed decays probabilities toward uniform (1/18)', () => {
    const s = applyQuizPrior(initIntentState(), 'investment', 'short');
    const decayed = applyDecay(s, 600_000);
    // flip_investor was boosted above 1/18 → moves down toward 1/18
    expect(decayed.probabilities.flip_investor).toBeLessThan(s.probabilities.flip_investor);
    // family_buyer was suppressed far below 1/18 → moves up toward 1/18
    expect(decayed.probabilities.family_buyer).toBeGreaterThan(s.probabilities.family_buyer);
  });

  it('probabilities sum to 1.0 after decay', () => {
    const s = applyQuizPrior(initIntentState(), 'investment', 'short');
    const decayed = applyDecay(s, 600_000);
    expect(sumProbs(decayed.probabilities)).toBeCloseTo(1.0, 5);
  });

  it('highly confident investor state decays toward neutral over 30 minutes', () => {
    const s = applyQuizPrior(initIntentState(), 'investment', 'short');
    const decayed30 = applyDecay(s, 30 * 60_000);
    expect(decayed30.confidence).toBeLessThan(s.confidence);
    expect(decayed30.probabilities.flip_investor).toBeLessThan(0.7);
  });

  it('extreme elapsedMs results in near-uniform distribution (1/18 per archetype)', () => {
    const s = applyQuizPrior(initIntentState(), 'investment', 'short');
    const decayed = applyDecay(s, 100 * 60_000); // 100 min → clamps to factor 1.0
    expect(decayed.probabilities.flip_investor).toBeCloseTo(UNIFORM_18, 4);
    expect(decayed.probabilities.family_buyer).toBeCloseTo(UNIFORM_18, 4);
    expect(decayed.probabilities.neutral).toBeCloseTo(UNIFORM_18, 4);
  });
});

describe('classifyFromProbabilities', () => {
  it('yield_hunter majority → yield_hunter, confidence 0.7', () => {
    const probs = makeProbs({ yield_hunter: 0.7, family_buyer: 0.2, neutral: 0.1 });
    const r = classifyFromProbabilities(probs);
    expect(r.archetype).toBe('yield_hunter');
    expect(r.confidence).toBeCloseTo(0.7, 5);
  });

  it('family_buyer majority → family_buyer', () => {
    const probs = makeProbs({ yield_hunter: 0.33, family_buyer: 0.34, neutral: 0.33 });
    const r = classifyFromProbabilities(probs);
    expect(r.archetype).toBe('family_buyer');
  });

  it('uniform (1/18 each) → archetype "neutral", confidence ~1/18', () => {
    const probs = makeProbs(Object.fromEntries(ARCHETYPE_NAMES.map((k) => [k, UNIFORM_18])));
    const r = classifyFromProbabilities(probs);
    expect(r.archetype).toBe('neutral');
    expect(r.confidence).toBeCloseTo(UNIFORM_18, 5);
  });

  it('equal-probability tie breaks toward neutral', () => {
    // yield_hunter and neutral both at 0.4, others 0
    const probs = makeProbs({ yield_hunter: 0.4, neutral: 0.4 });
    const r = classifyFromProbabilities(probs);
    expect(r.archetype).toBe('neutral');
  });
});

describe('normalize', () => {
  it('{ yield_hunter: 2, family_buyer: 1, neutral: 1 } → { 0.5, 0.25, 0.25 }', () => {
    const r = normalize(makeProbs({ yield_hunter: 2, family_buyer: 1, neutral: 1 }));
    expect(r.yield_hunter).toBeCloseTo(0.5, 5);
    expect(r.family_buyer).toBeCloseTo(0.25, 5);
    expect(r.neutral).toBeCloseTo(0.25, 5);
  });

  it('all values are in [0, 1] after normalization', () => {
    const r = normalize(makeProbs({ yield_hunter: 10, family_buyer: 5, neutral: 5 }));
    for (const k of ARCHETYPE_NAMES) {
      expect(r[k]).toBeGreaterThanOrEqual(0);
      expect(r[k]).toBeLessThanOrEqual(1);
    }
  });

  it('result sums to 1.0', () => {
    const r = normalize(makeProbs({ yield_hunter: 3.7, family_buyer: 2.1, neutral: 0.5 }));
    expect(sumProbs(r)).toBeCloseTo(1.0, 5);
  });

  it('NaN inputs fall back to uniform (1/18) distribution', () => {
    const r = normalize(makeProbs({ yield_hunter: NaN, family_buyer: 1, neutral: 1 }));
    for (const k of ARCHETYPE_NAMES) {
      expect(r[k]).toBeCloseTo(UNIFORM_18, 5);
    }
  });

  it('all-zero inputs fall back to uniform distribution', () => {
    const r = normalize(makeProbs());
    for (const k of ARCHETYPE_NAMES) {
      expect(r[k]).toBeCloseTo(UNIFORM_18, 5);
    }
  });

  it('negative inputs are clamped to 0 before normalization', () => {
    const r = normalize(makeProbs({ yield_hunter: -1, family_buyer: 1, neutral: 1 }));
    expect(r.yield_hunter).toBeCloseTo(0, 5);
    expect(r.family_buyer).toBeCloseTo(0.5, 5);
    expect(r.neutral).toBeCloseTo(0.5, 5);
  });
});

describe('full classification flow', () => {
  it('investor journey: quiz(investment, short) + 3×listing + 2×cta → investor archetype', () => {
    let s: IntentState = initIntentState();
    s = applyQuizPrior(s, 'investment', 'short');
    s = applyBehavioralSignal(s, 'listing.viewed');
    s = applyBehavioralSignal(s, 'listing.viewed');
    s = applyBehavioralSignal(s, 'listing.viewed');
    s = applyBehavioralSignal(s, 'cta.clicked');
    s = applyBehavioralSignal(s, 'cta.clicked');

    expect(INVESTOR_ARCHETYPES.has(s.archetype)).toBe(true);
    expect(s.signal_count).toBe(5);
    expect(s.quiz_answered).toBe(true);
  });

  it('family journey: quiz(personal, long) + listings → own-use group dominates', () => {
    let s: IntentState = initIntentState();
    s = applyQuizPrior(s, 'personal', 'long');
    s = applyBehavioralSignal(s, 'listing.viewed');
    s = applyBehavioralSignal(s, 'listing.viewed');

    const ownUseProb = [...OWN_USE_ARCHETYPES].reduce((sum, a) => sum + s.probabilities[a], 0);
    const investorProb = [...INVESTOR_ARCHETYPES].reduce((sum, a) => sum + s.probabilities[a], 0);
    expect(ownUseProb).toBeGreaterThan(investorProb * 3);
    expect(s.quiz_answered).toBe(true);
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

describe('applyQuizLeaf (FOLLOW-201)', () => {
  it('sets target archetype to ~0.85 probability', () => {
    const s = applyQuizLeaf(initIntentState(), 'family_buyer');
    expect(s.probabilities.family_buyer).toBeCloseTo(0.85, 5);
  });

  it('all other archetypes share remaining 0.15 uniformly', () => {
    const s = applyQuizLeaf(initIntentState(), 'family_buyer');
    const otherCount = ARCHETYPE_NAMES.length - 1; // 17
    const expectedOtherProb = 0.15 / otherCount;
    for (const k of ARCHETYPE_NAMES) {
      if (k === 'family_buyer') continue;
      expect(s.probabilities[k]).toBeCloseTo(expectedOtherProb, 5);
    }
  });

  it('probabilities still sum to 1.0', () => {
    const s = applyQuizLeaf(initIntentState(), 'yield_hunter');
    const sum = ARCHETYPE_NAMES.reduce((acc, k) => acc + s.probabilities[k], 0);
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it('sets archetype to the resolved leaf', () => {
    const s = applyQuizLeaf(initIntentState(), 'flip_investor');
    expect(s.archetype).toBe('flip_investor');
  });

  it('confidence is Math.min(0.85 * QUIZ_CONFIDENCE_BONUS, 1.0) — approximately 0.95 to 1.0', () => {
    const s = applyQuizLeaf(initIntentState(), 'luxury_buyer');
    // 0.85 * 1.2 = 1.02, capped at 1.0
    expect(s.confidence).toBeCloseTo(1.0, 5);
    expect(s.confidence).toBeLessThanOrEqual(1.0);
  });

  it('sets quiz_answered to true', () => {
    const s = applyQuizLeaf(initIntentState(), 'remote_worker');
    expect(s.quiz_answered).toBe(true);
  });

  it('preserves signal_count from the input state', () => {
    let base = initIntentState();
    base = applyBehavioralSignal(base, 'listing.viewed');
    base = applyBehavioralSignal(base, 'cta.clicked');
    expect(base.signal_count).toBe(2);
    const s = applyQuizLeaf(base, 'retiree_relocator');
    expect(s.signal_count).toBe(2);
  });

  it('is a pure function — does not mutate input state', () => {
    const base = initIntentState();
    const probsBefore = { ...base.probabilities };
    applyQuizLeaf(base, 'yield_hunter');
    // Original state unchanged
    expect(base.probabilities.neutral).toBeCloseTo(probsBefore.neutral, 5);
    expect(base.archetype).toBe('neutral');
    expect(base.quiz_answered).toBe(false);
  });

  it('works for all 18 archetypes without throwing', () => {
    const base = initIntentState();
    for (const archetype of ARCHETYPE_NAMES) {
      const s = applyQuizLeaf(base, archetype);
      expect(s.archetype).toBe(archetype);
      expect(s.probabilities[archetype]).toBeCloseTo(0.85, 5);
    }
  });
});
