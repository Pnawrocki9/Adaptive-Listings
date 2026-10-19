/**
 * Wilson interval pins — the quiz accuracy criterion of MASTER_DESIGN §E.4.8 (decision Q-J):
 * 372/400 passes the 0.90 lower bound, 371/400 fails.
 */

import { describe, expect, it } from 'vitest';

import { minSampleForObservedRate, minSuccessesForLowerBound, wilsonInterval } from './wilson.js';

describe('wilsonInterval', () => {
  it('pins the pre-registered criterion: 372/400 clears 0.90, 371/400 does not', () => {
    expect(wilsonInterval(372, 400).lo).toBeGreaterThanOrEqual(0.9);
    expect(wilsonInterval(371, 400).lo).toBeLessThan(0.9);
  });

  it('returns the observed proportion and an interval around it', () => {
    const { lo, hi, p } = wilsonInterval(372, 400);
    expect(p).toBeCloseTo(0.93, 10);
    expect(lo).toBeLessThan(p);
    expect(hi).toBeGreaterThan(p);
    expect(lo).toBeCloseTo(0.9007, 4);
    expect(hi).toBeCloseTo(0.9511, 4);
  });

  it('stays inside [0, 1] at the extremes', () => {
    const all = wilsonInterval(50, 50);
    expect(all.hi).toBeCloseTo(1, 10);
    expect(all.lo).toBeGreaterThan(0.9);
    const none = wilsonInterval(0, 50);
    expect(none.lo).toBe(0);
    expect(none.hi).toBeLessThan(0.1);
  });

  it('is uninformative with no trials', () => {
    expect(wilsonInterval(0, 0)).toEqual({ lo: 0, hi: 1, p: 0 });
  });

  it('widens with a larger z', () => {
    const narrow = wilsonInterval(90, 100, 1.645);
    const wide = wilsonInterval(90, 100, 2.576);
    expect(wide.lo).toBeLessThan(narrow.lo);
    expect(wide.hi).toBeGreaterThan(narrow.hi);
  });

  it('rejects impossible counts', () => {
    expect(() => wilsonInterval(5, 4)).toThrow(RangeError);
    expect(() => wilsonInterval(-1, 4)).toThrow(RangeError);
    expect(() => wilsonInterval(1.5, 4)).toThrow(RangeError);
  });
});

describe('minSuccessesForLowerBound', () => {
  it('is 372 for n = 400 at 0.90 (371 = FAIL)', () => {
    expect(minSuccessesForLowerBound(400, 0.9)).toBe(372);
  });

  it('is consistent with wilsonInterval around the threshold', () => {
    for (const n of [50, 130, 200, 400, 1000]) {
      const k = minSuccessesForLowerBound(n, 0.9);
      expect(k).not.toBeNull();
      if (k === null) continue;
      expect(wilsonInterval(k, n).lo).toBeGreaterThanOrEqual(0.9);
      expect(wilsonInterval(k - 1, n).lo).toBeLessThan(0.9);
    }
  });

  it('returns null when even a perfect score cannot clear the bound', () => {
    expect(minSuccessesForLowerBound(10, 0.9)).toBeNull();
  });
});

describe('minSampleForObservedRate', () => {
  // The SMALLEST n at which round(rate * n) / n clears a 0.90 lower bound. Because of the
  // rounding the relation is not monotone in n (e.g. 95 % first clears at 127 but still
  // dips below the bound as late as n = 152), so these are first-clear values, not "n and above".
  it('pins observed 95 % -> 127, 94 % -> 204, 93 % -> 362, 92 % -> 830', () => {
    expect(minSampleForObservedRate(0.95)).toBe(127);
    expect(minSampleForObservedRate(0.94)).toBe(204);
    expect(minSampleForObservedRate(0.93)).toBe(362);
    expect(minSampleForObservedRate(0.92)).toBe(830);
  });

  it('returns null when the rate can never clear the bound within the search limit', () => {
    expect(minSampleForObservedRate(0.9, 0.9, undefined, 500)).toBeNull();
  });
});
