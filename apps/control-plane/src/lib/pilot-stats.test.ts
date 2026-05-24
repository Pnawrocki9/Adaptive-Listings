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

import {
  twoProportionZTest,
  classifyConfidence,
  relativeLiftPct,
  normalCDF,
  MIN_SAMPLE_PER_ARM,
} from './pilot-stats.js';

describe('twoProportionZTest', () => {
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

describe('normalCDF', () => {
  it('is 0.5 at 0 and monotonic', () => {
    expect(normalCDF(0)).toBeCloseTo(0.5, 4);
    expect(normalCDF(1.96)).toBeCloseTo(0.975, 2);
    expect(normalCDF(-1.96)).toBeCloseTo(0.025, 2);
  });
});

describe('classifyConfidence', () => {
  it('returns not_significant when either arm < MIN_SAMPLE_PER_ARM regardless of p', () => {
    expect(classifyConfidence(0.0001, MIN_SAMPLE_PER_ARM - 1, 1000)).toBe('not_significant');
    expect(classifyConfidence(0.0001, 1000, MIN_SAMPLE_PER_ARM - 1)).toBe('not_significant');
  });

  it('returns 95% for p < 0.05 with adequate samples', () => {
    expect(classifyConfidence(0.01, 500, 500)).toBe('95%');
  });

  it('returns 90% for 0.05 <= p < 0.10', () => {
    expect(classifyConfidence(0.07, 500, 500)).toBe('90%');
  });

  it('returns not_significant for p >= 0.10', () => {
    expect(classifyConfidence(0.5, 500, 500)).toBe('not_significant');
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
