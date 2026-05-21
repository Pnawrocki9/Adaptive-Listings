/**
 * Tests for computeCosineSimilarity (FOLLOW-019).
 *
 * Coverage:
 *   - Known orthogonal vectors → 0
 *   - Identical vectors → 1
 *   - Opposite vectors → -1
 *   - Length mismatch → RangeError
 *   - Zero-magnitude input → RangeError
 *   - Empty vectors → RangeError
 *   - Non-normalized inputs produce normalized output
 *
 * @module @estalara/shared/embeddings.test
 */

import { describe, expect, it } from 'vitest';

import { computeCosineSimilarity } from './embeddings.js';

describe('computeCosineSimilarity()', () => {
  it('identical unit vectors → 1.0', () => {
    expect(computeCosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1.0, 10);
  });

  it('orthogonal unit vectors → 0.0', () => {
    expect(computeCosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0.0, 10);
  });

  it('opposite vectors → -1.0', () => {
    expect(computeCosineSimilarity([1, 2, 3], [-1, -2, -3])).toBeCloseTo(-1.0, 10);
  });

  it('parallel non-normalized vectors → 1.0', () => {
    // [1,2,3] and [2,4,6] are parallel (latter is 2x former).
    expect(computeCosineSimilarity([1, 2, 3], [2, 4, 6])).toBeCloseTo(1.0, 10);
  });

  it('result is bounded in [-1, 1] for arbitrary equal-length inputs', () => {
    const a = [0.7, -0.2, 0.5, 0.1];
    const b = [0.3, 0.8, -0.4, 0.6];
    const result = computeCosineSimilarity(a, b);
    expect(result).toBeGreaterThanOrEqual(-1);
    expect(result).toBeLessThanOrEqual(1);
  });

  it('matches the closed-form value for known small vectors', () => {
    // dot([1,2], [3,4]) = 11; |a|=sqrt(5); |b|=sqrt(25)=5
    // cos = 11 / (sqrt(5)*5) = 11 / 11.1803... ≈ 0.9838699
    expect(computeCosineSimilarity([1, 2], [3, 4])).toBeCloseTo(0.98386991, 6);
  });

  it('throws RangeError on length mismatch', () => {
    expect(() => computeCosineSimilarity([1, 0, 0], [1, 0])).toThrow(RangeError);
  });

  it('throws RangeError when either vector is empty', () => {
    expect(() => computeCosineSimilarity([], [])).toThrow(RangeError);
  });

  it('throws RangeError when the first vector has zero magnitude', () => {
    expect(() => computeCosineSimilarity([0, 0, 0], [1, 0, 0])).toThrow(RangeError);
  });

  it('throws RangeError when the second vector has zero magnitude', () => {
    expect(() => computeCosineSimilarity([1, 0, 0], [0, 0, 0])).toThrow(RangeError);
  });

  it('handles 1024-dim vectors (production sizing)', () => {
    const a = Array.from({ length: 1024 }, (_, i) => Math.sin(i));
    const b = Array.from({ length: 1024 }, (_, i) => Math.sin(i));
    expect(computeCosineSimilarity(a, b)).toBeCloseTo(1.0, 10);
  });
});
