/**
 * FOLLOW-1359 — Faza Q package Q4: the fold (MASTER_DESIGN §E.4.4 / §E.4.5 v3.0).
 *
 * Arithmetic pins for `applyQuizLeaf(state, leaf, evidence)` (0.72 / 0.90 / 0.90, confidence = the
 * posterior, no bonus), the neutral leaf, the confirmed-leaf anchor shared by every behavioural
 * recompute site (incl. the 0.005 floor), chat τ = 0.5 while confirmed (3 contrary dimensions hold,
 * 4 flip), the chat-only confidence scale (AC(8) G-04 value unchanged) and `applyDriftCandidate`.
 * The intent-loop wiring is pinned through the real init() in `follow-1357-init.test.ts`, the
 * follow-up consequences in `follow-1306.test.ts`.
 *
 * @module packages/sdk/src/__tests__/follow-1359
 */

import { describe, expect, it } from 'vitest';

import {
  ARCHETYPE_NAMES,
  applyBehavioralSignal,
  applyChatIntentPrior,
  applyDriftCandidate,
  applyDwellSignal,
  applyListingViewRate,
  applyQuizLeaf,
  applyReferrerHints,
  initIntentState,
  type IntentState,
} from '../core/intent.js';

const sum = (s: IntentState): number => ARCHETYPE_NAMES.reduce((a, k) => a + s.probabilities[k], 0);

describe('applyQuizLeaf — masses by evidence (§E.4.4)', () => {
  it('completed (the default): leaf 0.72, every other 0.28 / 17, confidence 0.72, unconfirmed', () => {
    const s = applyQuizLeaf(initIntentState(), 'yield_hunter');
    expect(s.probabilities.yield_hunter).toBe(0.72);
    for (const k of ARCHETYPE_NAMES) {
      if (k !== 'yield_hunter') expect(s.probabilities[k]).toBeCloseTo(0.28 / 17, 12);
    }
    expect(s.confidence).toBe(0.72);
    expect(s.quiz_confirmed).toBe(false);
    expect(sum(s)).toBeCloseTo(1, 12);
  });

  it('confirmed: leaf 0.90, every other 0.10 / 17, confidence 0.90, confirmed', () => {
    const s = applyQuizLeaf(initIntentState(), 'family_buyer', 'confirmed');
    expect(s.probabilities.family_buyer).toBe(0.9);
    for (const k of ARCHETYPE_NAMES) {
      if (k !== 'family_buyer') expect(s.probabilities[k]).toBeCloseTo(0.1 / 17, 12);
    }
    expect(s.confidence).toBe(0.9);
    expect(s.quiz_confirmed).toBe(true);
    expect(sum(s)).toBeCloseTo(1, 12);
  });

  it('corrected: 0.90 on the corrected archetype; the walked leaf keeps only the rest share', () => {
    const s = applyQuizLeaf(initIntentState(), 'flip_investor', 'corrected');
    expect(s.archetype).toBe('flip_investor');
    expect(s.probabilities.flip_investor).toBe(0.9);
    expect(s.probabilities.yield_hunter).toBeCloseTo(0.1 / 17, 12);
    expect(s.quiz_confirmed).toBe(true);
  });

  it('every fold mass is at or above the 0.005 Cromwell floor', () => {
    for (const ev of ['completed', 'confirmed', 'corrected'] as const) {
      const s = applyQuizLeaf(initIntentState(), 'downsizer', ev);
      for (const k of ARCHETYPE_NAMES) expect(s.probabilities[k]).toBeGreaterThanOrEqual(0.005);
    }
  });

  it('a neutral leaf sets quiz_answered and pins nothing', () => {
    let base = initIntentState();
    base = applyBehavioralSignal(base, 'cta.clicked');
    const s = applyQuizLeaf(base, 'neutral');
    expect(s.quiz_answered).toBe(true);
    expect(s.archetype).toBe(base.archetype);
    expect(s.confidence).toBe(base.confidence);
    expect(s.probabilities).toEqual(base.probabilities);
    expect(s.quiz_confirmed).toBeUndefined();
  });
});

describe('confirmed-leaf anchor — behaviour never moves a confirmed leaf (§E.4.4)', () => {
  const confirmed = applyQuizLeaf(initIntentState(), 'yield_hunter', 'confirmed');

  const sites: [string, (s: IntentState) => IntentState][] = [
    [
      'listing.bookmarked (3-bed)',
      (s) => applyBehavioralSignal(s, 'listing.bookmarked', { bedroomCount: 3 }),
    ],
    ['feature.expanded', (s) => applyBehavioralSignal(s, 'feature.expanded', { feature: 'visa' })],
    ['filter.applied', (s) => applyBehavioralSignal(s, 'filter.applied', { facet: 'commercial' })],
    ['mortgage_calc.used', (s) => applyBehavioralSignal(s, 'mortgage_calc.used')],
    ['referrer', (s) => applyReferrerHints(s, 'https://example.com/family', '')],
    ['listing-view rate (slow, own-use)', (s) => applyListingViewRate(s, 2, 600_000)],
    ['dwell', (s) => applyDwellSignal(s, 120_000)],
  ];

  it.each(sites)('%s: the leaf keeps 0.90 exactly, the rest renormalise to 0.10', (_n, fn) => {
    let s = confirmed;
    for (let i = 0; i < 5; i++) s = fn(s);
    expect(s.archetype).toBe('yield_hunter');
    expect(s.probabilities.yield_hunter).toBe(0.9);
    expect(s.confidence).toBe(0.9);
    expect(sum(s)).toBeCloseTo(1, 12);
  });

  it('no other archetype drops below the 0.005 Cromwell floor', () => {
    let s = confirmed;
    for (let i = 0; i < 20; i++) {
      s = applyBehavioralSignal(s, 'listing.bookmarked', { listingType: 'commercial' });
    }
    // 0.10 rest = 17 × 0.005 floor + 0.015 shared in proportion (commercial_investor takes it).
    for (const k of ARCHETYPE_NAMES)
      expect(s.probabilities[k]).toBeGreaterThanOrEqual(0.005 - 1e-15);
    expect(s.probabilities.commercial_investor).toBeLessThanOrEqual(0.02);
    expect(s.probabilities.yield_hunter).toBe(0.9);
  });

  it('a mass above 1 − 17 × 0.005 is held at 0.915 so the floor holds (concordant chat → 0.97)', () => {
    const chatted = applyChatIntentPrior(confirmed, {
      purchase_purpose: 'investment',
      tax_aware: 'true',
    });
    expect(chatted.probabilities.yield_hunter).toBeGreaterThan(0.915);
    const s = applyBehavioralSignal(chatted, 'cta.clicked');
    expect(s.probabilities.yield_hunter).toBeCloseTo(0.915, 12);
    for (const k of ARCHETYPE_NAMES)
      expect(s.probabilities[k]).toBeGreaterThanOrEqual(0.005 - 1e-15);
    expect(sum(s)).toBeCloseTo(1, 12);
  });

  it('an unconfirmed leaf is updated normally: two 3-bed bookmarks take 0.72 to ~0.46', () => {
    let s = applyQuizLeaf(initIntentState(), 'yield_hunter');
    s = applyBehavioralSignal(s, 'listing.bookmarked', { bedroomCount: 3 });
    expect(s.probabilities.yield_hunter).toBeCloseTo(0.577, 3); // one bookmark
    s = applyBehavioralSignal(s, 'listing.bookmarked', { bedroomCount: 3 });
    expect(s.archetype).toBe('yield_hunter');
    expect(s.confidence).toBeCloseTo(0.462, 3); // below the server gate (> 0.6)
  });

  it('behaviour carries no quiz bonus: confidence is the posterior', () => {
    const s = applyBehavioralSignal(
      applyQuizLeaf(initIntentState(), 'yield_hunter'),
      'cta.clicked',
    );
    expect(s.confidence).toBe(s.probabilities.yield_hunter);
  });
});

describe('chat after a confirmed leaf — τ = 0.5 (§E.4.4)', () => {
  // Each message carries both retiree dimensions: two contrary dimensions per message.
  const RETIREE = { purchase_purpose: 'retirement', family_stage: 'retiree' };

  it('three contrary dimensions do not flip a confirmed leaf', () => {
    let s = applyQuizLeaf(initIntentState(), 'family_buyer', 'confirmed');
    s = applyChatIntentPrior(s, RETIREE);
    s = applyChatIntentPrior(s, { purchase_purpose: 'retirement' });
    expect(s.archetype).toBe('family_buyer');
    expect(s.confidence).toBeCloseTo(0.561, 3); // held, though below the server gate
  });

  it('four contrary dimensions do', () => {
    let s = applyQuizLeaf(initIntentState(), 'family_buyer', 'confirmed');
    s = applyChatIntentPrior(s, RETIREE);
    s = applyChatIntentPrior(s, RETIREE);
    expect(s.archetype).toBe('retiree_relocator');
  });

  it('the same three dimensions flip an unconfirmed (completed) leaf — τ is confirmed-only', () => {
    let s = applyQuizLeaf(initIntentState(), 'family_buyer');
    s = applyChatIntentPrior(s, RETIREE);
    s = applyChatIntentPrior(s, { purchase_purpose: 'retirement' });
    expect(s.archetype).toBe('retiree_relocator');
  });

  it('after a chat flip, behaviour protects the NEW leaf mass', () => {
    let s = applyQuizLeaf(initIntentState(), 'family_buyer', 'confirmed');
    s = applyChatIntentPrior(applyChatIntentPrior(s, RETIREE), RETIREE);
    const mass = s.probabilities.retiree_relocator;
    s = applyBehavioralSignal(s, 'listing.bookmarked', { bedroomCount: 3 });
    expect(s.archetype).toBe('retiree_relocator');
    expect(s.probabilities.retiree_relocator).toBe(mass);
  });
});

describe('chat confidence scale — only without a quiz (CEO decision Q-G)', () => {
  const DIMS = { purchase_purpose: 'investment', tax_aware: 'true' };

  it('no quiz: confidence = min(posterior × 1.2, 1)', () => {
    const s = applyChatIntentPrior(initIntentState(), DIMS);
    expect(s.quiz_answered).toBe(false);
    expect(s.confidence).toBe(Math.min(s.probabilities[s.archetype] * 1.2, 1));
  });

  it('after a quiz: confidence = the posterior, no scale', () => {
    const s = applyChatIntentPrior(applyQuizLeaf(initIntentState(), 'yield_hunter'), DIMS);
    expect(s.confidence).toBe(s.probabilities.yield_hunter);
  });

  it('after "None of these" (pre-quiz state, quiz_rejected) the chat-only scale applies', () => {
    const rejected: IntentState = { ...initIntentState(), quiz_rejected: true };
    const s = applyChatIntentPrior(rejected, DIMS);
    expect(s.confidence).toBe(Math.min(s.probabilities[s.archetype] * 1.2, 1));
    expect(s.quiz_rejected).toBe(true);
  });
});

describe('applyDriftCandidate (§E.4.5)', () => {
  it('re-pins at the completed mass, marked source: drift, unconfirmed', () => {
    const s = applyDriftCandidate(applyQuizLeaf(initIntentState(), 'yield_hunter'), 'family_buyer');
    expect(s.archetype).toBe('family_buyer');
    expect(s.probabilities.family_buyer).toBe(0.72);
    expect(s.confidence).toBe(0.72);
    expect(s.source).toBe('drift');
    expect(s.quiz_confirmed).toBe(false);
    expect(s.quiz_answered).toBe(true);
  });
});
