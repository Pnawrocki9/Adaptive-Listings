/**
 * Unit tests for Thompson sampling bandit.
 *
 * @module apps/decision-api/src/lib/__tests__/bandit.test
 */

import { describe, expect, it } from 'vitest';

import type { BanditArm } from '../bandit.js';
import { sampleBeta, thompsonSample, updateBanditArm } from '../bandit.js';

// ─── sampleBeta ───────────────────────────────────────────────────────────────

describe('sampleBeta', () => {
  it('returns a value in (0, 1)', () => {
    for (let i = 0; i < 100; i++) {
      const s = sampleBeta(1, 1);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(1);
    }
  });

  it('throws on alpha <= 0', () => {
    expect(() => sampleBeta(0, 1)).toThrow(RangeError);
    expect(() => sampleBeta(-1, 1)).toThrow(RangeError);
  });

  it('throws on beta <= 0', () => {
    expect(() => sampleBeta(1, 0)).toThrow(RangeError);
    expect(() => sampleBeta(1, -2)).toThrow(RangeError);
  });

  it('Beta(100, 1) mean ≈ 0.99 — samples should be high', () => {
    let sum = 0;
    for (let i = 0; i < 1000; i++) {
      sum += sampleBeta(100, 1);
    }
    const mean = sum / 1000;
    expect(mean).toBeGreaterThan(0.95);
  });

  it('Beta(1, 100) mean ≈ 0.01 — samples should be low', () => {
    let sum = 0;
    for (let i = 0; i < 1000; i++) {
      sum += sampleBeta(1, 100);
    }
    const mean = sum / 1000;
    expect(mean).toBeLessThan(0.05);
  });

  it('handles large shape parameters (normal approximation path)', () => {
    // alpha + beta > 200 triggers normal approximation
    for (let i = 0; i < 100; i++) {
      const s = sampleBeta(100, 110);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(1);
    }
  });

  it('handles fractional shape parameters', () => {
    for (let i = 0; i < 50; i++) {
      const s = sampleBeta(0.5, 0.5);
      expect(s).toBeGreaterThan(0);
      expect(s).toBeLessThan(1);
    }
  });
});

// ─── thompsonSample ───────────────────────────────────────────────────────────

describe('thompsonSample', () => {
  it('returns null when all arms are paused', () => {
    const arms: BanditArm[] = [
      { variant: 'v1', alpha: 10, beta: 1, paused: true },
      { variant: 'v2', alpha: 1, beta: 10, paused: true },
    ];
    expect(thompsonSample(arms)).toBeNull();
  });

  it('returns null for empty arm array', () => {
    expect(thompsonSample([])).toBeNull();
  });

  it('returns the only non-paused variant directly', () => {
    const arms: BanditArm[] = [
      { variant: 'v1', alpha: 1, beta: 1, paused: true },
      { variant: 'v2', alpha: 1, beta: 1, paused: false },
    ];
    expect(thompsonSample(arms)).toBe('v2');
  });

  it('strongly favors the arm with high alpha (high success rate)', () => {
    // v1: Beta(90, 10) mean=0.9, v2: Beta(10, 90) mean=0.1
    // Over 1000 samples, v1 should win > 90% of the time
    const arms: BanditArm[] = [
      { variant: 'v1', alpha: 90, beta: 10 },
      { variant: 'v2', alpha: 10, beta: 90 },
    ];
    let v1Count = 0;
    for (let i = 0; i < 1000; i++) {
      if (thompsonSample(arms) === 'v1') v1Count++;
    }
    expect(v1Count / 1000).toBeGreaterThan(0.85);
  });

  it('with equal arms, samples all variants over many calls', () => {
    const arms: BanditArm[] = [
      { variant: 'v1', alpha: 1, beta: 1 },
      { variant: 'v2', alpha: 1, beta: 1 },
      { variant: 'v3', alpha: 1, beta: 1 },
    ];
    const counts = { v1: 0, v2: 0, v3: 0 };
    for (let i = 0; i < 3000; i++) {
      const v = thompsonSample(arms);
      // All arms are active so thompsonSample never returns null here.
      if (v === 'v1' || v === 'v2' || v === 'v3') counts[v]++;
    }
    // Each variant should appear in roughly 33% of draws; tolerance 15%
    expect(counts.v1 / 3000).toBeGreaterThan(0.18);
    expect(counts.v2 / 3000).toBeGreaterThan(0.18);
    expect(counts.v3 / 3000).toBeGreaterThan(0.18);
  });
});

// ─── updateBanditArm ──────────────────────────────────────────────────────────

describe('updateBanditArm', () => {
  it('increments alpha on conversion', () => {
    const { alpha, beta } = updateBanditArm(1, 1, true);
    expect(alpha).toBe(2);
    expect(beta).toBe(1);
  });

  it('increments beta on non-conversion', () => {
    const { alpha, beta } = updateBanditArm(1, 1, false);
    expect(alpha).toBe(1);
    expect(beta).toBe(2);
  });

  it('preserves unchanged parameter on conversion', () => {
    const { alpha, beta } = updateBanditArm(5, 10, true);
    expect(alpha).toBe(6);
    expect(beta).toBe(10);
  });

  it('preserves unchanged parameter on non-conversion', () => {
    const { alpha, beta } = updateBanditArm(5, 10, false);
    expect(alpha).toBe(5);
    expect(beta).toBe(11);
  });
});
