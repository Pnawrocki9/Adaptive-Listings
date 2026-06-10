import { describe, expect, it } from 'vitest';

import {
  ARCHETYPE_NAMES,
  CHAT_INTENT_LIKELIHOODS,
  INVESTOR_ARCHETYPES,
  OWN_USE_ARCHETYPES,
  applyBehavioralSignal,
  applyChatIntentPrior,
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

  it('confidence is Math.min(0.85 * QUIZ_CONFIDENCE_BONUS, 1.0) — approximately 1.0', () => {
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

// ─── FOLLOW-100: new SIGNAL_LIKELIHOODS entries ─────────────────────────────────

describe('SIGNAL_LIKELIHOODS new signals (FOLLOW-100)', () => {
  it('photo.dwell shifts probability toward luxury_buyer and second_home_buyer', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'photo.dwell');
    expect(after.probabilities.luxury_buyer).toBeGreaterThan(before.probabilities.luxury_buyer);
    expect(after.probabilities.second_home_buyer).toBeGreaterThan(
      before.probabilities.second_home_buyer,
    );
    expect(after.probabilities.neutral).toBeLessThan(before.probabilities.neutral);
    expect(after.signal_count).toBe(1);
  });

  it('mortgage_calc.used shifts probability toward first_time_buyer and family_buyer', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'mortgage_calc.used');
    expect(after.probabilities.first_time_buyer).toBeGreaterThan(
      before.probabilities.first_time_buyer,
    );
    expect(after.probabilities.family_buyer).toBeGreaterThan(before.probabilities.family_buyer);
    expect(after.probabilities.neutral).toBeLessThan(before.probabilities.neutral);
  });

  it('price.compared shifts probability toward flip_investor and yield_hunter', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'price.compared');
    expect(after.probabilities.flip_investor).toBeGreaterThan(before.probabilities.flip_investor);
    expect(after.probabilities.yield_hunter).toBeGreaterThan(before.probabilities.yield_hunter);
  });

  it('inquiry.started pushes the whole distribution away from neutral (no single archetype)', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'inquiry.started');
    expect(after.probabilities.neutral).toBeLessThan(before.probabilities.neutral);
    expect(sumProbs(after.probabilities)).toBeCloseTo(1.0, 5);
  });

  it('feature.expanded with no payload applies only the base neutral-push', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'feature.expanded');
    expect(after.probabilities.neutral).toBeLessThan(before.probabilities.neutral);
    expect(after.signal_count).toBe(1);
  });
});

// ─── FOLLOW-100: feature.expanded payload-conditional intercept ─────────────────

describe('feature.expanded intercept (FOLLOW-100)', () => {
  it('feature=home_office boosts remote_worker', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'feature.expanded', { feature: 'home_office' });
    expect(after.probabilities.remote_worker).toBeGreaterThan(before.probabilities.remote_worker);
  });

  it('feature=yield boosts vacation_rental_investor and yield_hunter', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'feature.expanded', { feature: 'yield' });
    expect(after.probabilities.vacation_rental_investor).toBeGreaterThan(
      before.probabilities.vacation_rental_investor,
    );
    expect(after.probabilities.yield_hunter).toBeGreaterThan(before.probabilities.yield_hunter);
  });

  it('feature=visa boosts golden_visa_buyer', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'feature.expanded', { feature: 'visa' });
    expect(after.probabilities.golden_visa_buyer).toBeGreaterThan(
      before.probabilities.golden_visa_buyer,
    );
  });

  it('feature=accessibility boosts downsizer and retiree_relocator', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'feature.expanded', { feature: 'accessibility' });
    expect(after.probabilities.downsizer).toBeGreaterThan(before.probabilities.downsizer);
    expect(after.probabilities.retiree_relocator).toBeGreaterThan(
      before.probabilities.retiree_relocator,
    );
  });

  it('feature=international boosts lifestyle_expat and diaspora_buyer', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'feature.expanded', { feature: 'international' });
    expect(after.probabilities.lifestyle_expat).toBeGreaterThan(
      before.probabilities.lifestyle_expat,
    );
    expect(after.probabilities.diaspora_buyer).toBeGreaterThan(before.probabilities.diaspora_buyer);
  });

  it('unrecognized feature value applies base neutral-push only (no targeted boost)', () => {
    const before = initIntentState();
    const base = applyBehavioralSignal(before, 'feature.expanded');
    const after = applyBehavioralSignal(before, 'feature.expanded', { feature: 'mystery_feature' });
    // Same as base (no payload) — no archetype-specific boost was applied.
    for (const k of ARCHETYPE_NAMES) {
      expect(after.probabilities[k]).toBeCloseTo(base.probabilities[k], 6);
    }
  });

  it('feature value is case-insensitive (HOME_OFFICE === home_office)', () => {
    const before = initIntentState();
    const lower = applyBehavioralSignal(before, 'feature.expanded', { feature: 'home_office' });
    const upper = applyBehavioralSignal(before, 'feature.expanded', { feature: 'HOME_OFFICE' });
    expect(upper.probabilities.remote_worker).toBeCloseTo(lower.probabilities.remote_worker, 6);
  });
});

// ─── FOLLOW-100: applyFilterBoosts new facets ───────────────────────────────────

describe('applyFilterBoosts new facets (FOLLOW-100)', () => {
  it('renovation boosts flip_investor', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', { facet: 'renovation' });
    expect(after.probabilities.flip_investor).toBeGreaterThan(before.probabilities.flip_investor);
  });

  it('type=holiday boosts vacation_rental_investor', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', {
      facet: 'type',
      value: 'holiday',
    });
    expect(after.probabilities.vacation_rental_investor).toBeGreaterThan(
      before.probabilities.vacation_rental_investor,
    );
  });

  it('type=apartment (non-holiday) does NOT boost vacation_rental_investor', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', {
      facet: 'type',
      value: 'apartment',
    });
    expect(after.probabilities.vacation_rental_investor).toBeCloseTo(
      before.probabilities.vacation_rental_investor,
      6,
    );
  });

  it('price_max low (numeric ≤ 300_000) boosts first_time_buyer', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', {
      facet: 'price_max',
      value: 250_000,
    });
    expect(after.probabilities.first_time_buyer).toBeGreaterThan(
      before.probabilities.first_time_buyer,
    );
  });

  it('price_max="low" string also boosts first_time_buyer', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', {
      facet: 'price_max',
      value: 'low',
    });
    expect(after.probabilities.first_time_buyer).toBeGreaterThan(
      before.probabilities.first_time_buyer,
    );
  });

  it('price_max high (> 300_000) does NOT boost first_time_buyer', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', {
      facet: 'price_max',
      value: 800_000,
    });
    expect(after.probabilities.first_time_buyer).toBeCloseTo(
      before.probabilities.first_time_buyer,
      6,
    );
  });

  it('bedrooms_min ≥ 4 boosts upsizer', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', {
      facet: 'bedrooms_min',
      value: 4,
    });
    expect(after.probabilities.upsizer).toBeGreaterThan(before.probabilities.upsizer);
  });

  it('bedrooms_max ≤ 2 boosts downsizer', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', {
      facet: 'bedrooms_max',
      value: 2,
    });
    expect(after.probabilities.downsizer).toBeGreaterThan(before.probabilities.downsizer);
  });

  it('near_university boosts student_parent and family_buyer', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', { facet: 'near_university' });
    expect(after.probabilities.student_parent).toBeGreaterThan(before.probabilities.student_parent);
    expect(after.probabilities.family_buyer).toBeGreaterThan(before.probabilities.family_buyer);
  });

  it('school_district boosts student_parent and family_buyer', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', { facet: 'school_district' });
    expect(after.probabilities.student_parent).toBeGreaterThan(before.probabilities.student_parent);
    expect(after.probabilities.family_buyer).toBeGreaterThan(before.probabilities.family_buyer);
  });
});

// ─── FOLLOW-100: CHAT_INTENT_LIKELIHOODS + applyChatIntentPrior ─────────────────

describe('CHAT_INTENT_LIKELIHOODS (FOLLOW-100)', () => {
  it('every entry is a full 18-archetype likelihood with unspecified keys = 1.0', () => {
    for (const key of Object.keys(CHAT_INTENT_LIKELIHOODS)) {
      const entry = CHAT_INTENT_LIKELIHOODS[key];
      expect(entry).toBeDefined();
      for (const a of ARCHETYPE_NAMES) {
        expect(Number.isFinite(entry?.[a])).toBe(true);
      }
    }
  });

  it('contains the decomposed compound urgency keys', () => {
    expect(CHAT_INTENT_LIKELIHOODS['urgency=0-3mo']).toBeDefined();
    expect(CHAT_INTENT_LIKELIHOODS['urgency=12mo+']).toBeDefined();
  });
});

describe('applyChatIntentPrior (FOLLOW-100)', () => {
  it('empty intentDimensions returns state unchanged (same reference)', () => {
    const s = initIntentState();
    const after = applyChatIntentPrior(s, {});
    expect(after).toBe(s);
  });

  it('no matching dimension returns state unchanged (same reference)', () => {
    const s = initIntentState();
    const after = applyChatIntentPrior(s, { unknown_dimension: 'whatever' });
    expect(after).toBe(s);
  });

  it('purchase_purpose=investment increases yield_hunter and portfolio_builder probability', () => {
    const before = initIntentState();
    const after = applyChatIntentPrior(before, { purchase_purpose: 'investment' });
    expect(after.probabilities.yield_hunter).toBeGreaterThan(before.probabilities.yield_hunter);
    expect(after.probabilities.portfolio_builder).toBeGreaterThan(
      before.probabilities.portfolio_builder,
    );
  });

  it('cross_border=expat_returning makes diaspora_buyer dominant', () => {
    const before = initIntentState();
    const after = applyChatIntentPrior(before, { cross_border: 'expat_returning' });
    expect(after.archetype).toBe('diaspora_buyer');
  });

  it('feature_priority=workspace makes remote_worker dominant', () => {
    const before = initIntentState();
    const after = applyChatIntentPrior(before, { feature_priority: 'workspace' });
    expect(after.archetype).toBe('remote_worker');
  });

  it('does NOT set quiz_answered (chat is a separate source)', () => {
    const before = initIntentState();
    const after = applyChatIntentPrior(before, { purchase_purpose: 'vacation_rental' });
    expect(after.quiz_answered).toBe(false);
  });

  it('applies multiple dimensions multiplicatively (compound investment + urgency → flip_investor)', () => {
    const before = initIntentState();
    const after = applyChatIntentPrior(before, {
      purchase_purpose: 'investment',
      urgency: '0-3mo',
    });
    // flip_investor receives boosts from both purchase_purpose=investment and urgency=0-3mo.
    expect(after.probabilities.flip_investor).toBeGreaterThan(before.probabilities.flip_investor);
    expect(INVESTOR_ARCHETYPES.has(after.archetype)).toBe(true);
  });

  it('probabilities sum to 1.0 after chat prior', () => {
    const before = initIntentState();
    const after = applyChatIntentPrior(before, { purchase_purpose: 'retirement' });
    expect(sumProbs(after.probabilities)).toBeCloseTo(1.0, 5);
  });

  it('emits chat_mismatch when quiz-answered state conflicts with confident chat archetype', () => {
    // Quiz declared a family_buyer (own-use). Chat then strongly and repeatedly signals
    // investment across several dimensions, overpowering the quiz prior and flipping the
    // leading archetype to an investor persona — a genuine quiz/chat conflict.
    const quizState = applyQuizLeaf(initIntentState(), 'family_buyer');
    expect(quizState.quiz_answered).toBe(true);
    expect(quizState.archetype).toBe('family_buyer');

    const after = applyChatIntentPrior(quizState, {
      purchase_purpose: 'vacation_rental',
      finance_complexity: 'investment_vehicle',
      tax_aware: 'true',
      urgency: '0-3mo',
    });
    expect(INVESTOR_ARCHETYPES.has(after.archetype)).toBe(true);
    expect(after.archetype).not.toBe('family_buyer');
    expect(after.chat_mismatch).toBeDefined();
    expect(after.chat_mismatch?.quiz_archetype).toBe('family_buyer');
    expect(after.chat_mismatch?.chat_archetype).toBe(after.archetype);
  });

  it('does NOT emit chat_mismatch when chat agrees with quiz archetype', () => {
    const quizState = applyQuizLeaf(initIntentState(), 'vacation_rental_investor');
    const after = applyChatIntentPrior(quizState, { purchase_purpose: 'vacation_rental' });
    expect(after.archetype).toBe('vacation_rental_investor');
    expect(after.chat_mismatch).toBeUndefined();
  });

  it('does NOT emit chat_mismatch when quiz was not answered', () => {
    const before = initIntentState();
    const after = applyChatIntentPrior(before, { purchase_purpose: 'vacation_rental' });
    expect(after.chat_mismatch).toBeUndefined();
  });

  it('is a pure function — does not mutate the input state', () => {
    const before = initIntentState();
    const neutralBefore = before.probabilities.neutral;
    applyChatIntentPrior(before, { purchase_purpose: 'investment' });
    expect(before.probabilities.neutral).toBeCloseTo(neutralBefore, 6);
    expect(before.archetype).toBe('neutral');
  });
});
