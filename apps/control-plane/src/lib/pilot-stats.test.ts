/**
 * Unit tests for the pilot CTA-lift statistics helpers.
 *
 * Statistical correctness is the headline requirement (opus-4.7-xhigh):
 *   - n < 30 per arm → p-value 1.0 (no significance)
 *   - known significant lift → p < 0.05
 *   - zero standard error → 1.0
 *   - equal rates → high p-value
 *   - the canonical spec fixture: p1=0.15,n1=1000,p2=0.10,n2=1000 → p ≈ 0.0002
 *
 * @module apps/control-plane/src/lib/pilot-stats.test
 */

import { describe, expect, it } from 'vitest';

import { relativeLiftPct, computeArmLift, MIN_SAMPLE_PER_ARM } from './pilot-stats.js';

/** Two-proportion p-value for rates p1/p2 over n1/n2 sessions, via the one public lift function. */
function twoProportionZTest(p1: number, n1: number, p2: number, n2: number): number {
  return computeArmLift({
    adaptedN: n1,
    adaptedConversions: p1 * n1,
    holdoutN: n2,
    holdoutConversions: p2 * n2,
  }).pValue;
}

/** Confidence label for adapted/holdout conversion counts. */
function confidenceOf(n1: number, k1: number, n2: number, k2: number) {
  return computeArmLift({
    adaptedN: n1,
    adaptedConversions: k1,
    holdoutN: n2,
    holdoutConversions: k2,
  }).confidence;
}

describe('two-proportion p-value (via computeArmLift)', () => {
  it('returns 1.0 when either arm has n < 30 (insufficient sample)', () => {
    expect(twoProportionZTest(0.5, 10, 0.1, 1000)).toBe(1.0);
    expect(twoProportionZTest(0.5, 1000, 0.1, 29)).toBe(1.0);
    expect(twoProportionZTest(0.9, 5, 0.1, 5)).toBe(1.0);
  });

  it('returns p < 0.05 for a known large significant lift (0.15 vs 0.10, n=1000)', () => {
    // z = 0.05 / sqrt(0.125*0.875*(2/1000)) ≈ 3.38 → two-tailed p ≈ 0.00072.
    const p = twoProportionZTest(0.15, 1000, 0.1, 1000);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(0.001);
    // Tight check against the analytically-correct two-tailed value for z≈3.38.
    expect(p).toBeCloseTo(0.00072, 4);
  });

  it('returns 1.0 when pooled standard error is zero (both rates 0)', () => {
    // p1 = p2 = 0 with adequate n → pooled p = 0 → se = 0 → guard returns 1.0
    expect(twoProportionZTest(0, 500, 0, 500)).toBe(1.0);
    // both rates 1.0 → pooled p = 1 → se = 0 → 1.0
    expect(twoProportionZTest(1, 500, 1, 500)).toBe(1.0);
  });

  it('returns a high p-value when the two rates are equal', () => {
    // Equal proportions → z = 0 → p-value = 1.0
    const p = twoProportionZTest(0.1, 1000, 0.1, 1000);
    expect(p).toBeCloseTo(1.0, 5);
  });

  it('p-value is always within [0, 1]', () => {
    const cases: [number, number, number, number][] = [
      [0.5, 100, 0.3, 100],
      [0.2, 500, 0.18, 500],
      [0.01, 2000, 0.5, 2000],
      [0.0, 1000, 0.0, 1000],
    ];
    for (const [p1, n1, p2, n2] of cases) {
      const p = twoProportionZTest(p1, n1, p2, n2);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });

  it('a tiny lift on a small (but valid) sample is not significant', () => {
    // 31 vs 31 sessions, rates 0.10 vs 0.097 → nowhere near p < 0.05
    const p = twoProportionZTest(0.1, 31, 0.097, 31);
    expect(p).toBeGreaterThan(0.05);
  });
});

describe('normal CDF (via the p-value)', () => {
  it('gives p = 0.05 at |z| = 1.96 and p = 1 at z = 0', () => {
    // n = 1000 per arm, pooled p = 0.5: se = sqrt(0.25 * 2/1000); diff = 1.96 * se => p ~ 0.05.
    const se = Math.sqrt(0.25 * (2 / 1000));
    expect(
      twoProportionZTest(0.5 + (1.96 * se) / 2, 1000, 0.5 - (1.96 * se) / 2, 1000),
    ).toBeCloseTo(0.05, 3);
    expect(twoProportionZTest(0.5, 1000, 0.5, 1000)).toBeCloseTo(1, 5);
  });
});

describe('confidence classification (via computeArmLift)', () => {
  it('is not_significant when either arm < MIN_SAMPLE_PER_ARM regardless of the rates', () => {
    expect(confidenceOf(MIN_SAMPLE_PER_ARM - 1, 29, 1000, 10)).toBe('not_significant');
    expect(confidenceOf(1000, 500, MIN_SAMPLE_PER_ARM - 1, 0)).toBe('not_significant');
  });

  it('is 95% for p < 0.05 with adequate samples', () => {
    expect(confidenceOf(500, 100, 500, 50)).toBe('95%');
  });

  it('is 90% for 0.05 <= p < 0.10', () => {
    // 60/500 vs 43/500: z ~ 1.77, p ~ 0.077.
    const out = computeArmLift({
      adaptedN: 500,
      adaptedConversions: 60,
      holdoutN: 500,
      holdoutConversions: 43,
    });
    expect(out.pValue).toBeGreaterThanOrEqual(0.05);
    expect(out.pValue).toBeLessThan(0.1);
    expect(out.confidence).toBe('90%');
  });

  it('is not_significant for p >= 0.10', () => {
    expect(confidenceOf(500, 50, 500, 48)).toBe('not_significant');
  });
});

describe('relativeLiftPct', () => {
  it('returns null when holdoutRate is 0 (division-by-zero guard)', () => {
    expect(relativeLiftPct(0.12, 0)).toBeNull();
  });

  it('computes relative lift in percent', () => {
    // (0.15 - 0.10) / 0.10 * 100 = 50
    expect(relativeLiftPct(0.15, 0.1)).toBeCloseTo(50, 6);
  });

  it('returns a negative value for a regression', () => {
    expect(relativeLiftPct(0.08, 0.1)).toBeCloseTo(-20, 6);
  });
});

describe('computeArmLift (FOLLOW-1289 — the single lift computation)', () => {
  it('derives rates, relative lift, p-value and confidence from raw counts', () => {
    const out = computeArmLift({
      adaptedN: 1000,
      adaptedConversions: 150,
      holdoutN: 1000,
      holdoutConversions: 100,
    });
    expect(out.adaptedRate).toBeCloseTo(0.15, 10);
    expect(out.holdoutRate).toBeCloseTo(0.1, 10);
    expect(out.absoluteLift).toBeCloseTo(0.05, 10);
    expect(out.relativeLiftPct).toBeCloseTo(50, 8);
    expect(out.pValue).toBeCloseTo(twoProportionZTest(0.15, 1000, 0.1, 1000), 12);
    expect(out.confidence).toBe('95%');
  });

  it('reports null lift (not 0, not Infinity) when the holdout has no conversions', () => {
    const out = computeArmLift({
      adaptedN: 500,
      adaptedConversions: 75,
      holdoutN: 500,
      holdoutConversions: 0,
    });
    expect(out.relativeLiftPct).toBeNull();
  });

  it('reports null lift and zero rates for an empty holdout arm', () => {
    const out = computeArmLift({
      adaptedN: 50,
      adaptedConversions: 5,
      holdoutN: 0,
      holdoutConversions: 0,
    });
    expect(out.holdoutRate).toBe(0);
    expect(out.relativeLiftPct).toBeNull();
    expect(out.confidence).toBe('not_significant');
  });

  it('reports -100% for an empty adapted arm against a non-zero holdout rate', () => {
    const out = computeArmLift({
      adaptedN: 0,
      adaptedConversions: 0,
      holdoutN: 40,
      holdoutConversions: 10,
    });
    expect(out.adaptedRate).toBe(0);
    expect(out.relativeLiftPct).toBeCloseTo(-100, 10);
  });

  it('is not_significant with p = 1 below the per-arm minimum sample', () => {
    const out = computeArmLift({
      adaptedN: MIN_SAMPLE_PER_ARM - 1,
      adaptedConversions: 20,
      holdoutN: 100,
      holdoutConversions: 1,
    });
    expect(out.pValue).toBe(1);
    expect(out.confidence).toBe('not_significant');
  });
});
