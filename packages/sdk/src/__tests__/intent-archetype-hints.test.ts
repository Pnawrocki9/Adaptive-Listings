import { describe, expect, it } from 'vitest';

import { ARCHETYPE_NAMES, applyArchetypeHints, initIntentState } from '../core/intent.js';
import type { ArchetypeHintLike } from '../core/intent.js';

function sumProbs(probs: Record<string, number>): number {
  return ARCHETYPE_NAMES.reduce((sum, k) => sum + (probs[k] ?? 0), 0);
}

describe('applyArchetypeHints — basic boost', () => {
  it('returns the input state unchanged when hints array is empty', () => {
    const initial = initIntentState();
    const result = applyArchetypeHints(initial, []);
    expect(result).toBe(initial);
  });

  it('increases the prior probability of the boosted archetype', () => {
    const initial = initIntentState();
    const hints: ArchetypeHintLike[] = [
      { archetype_id: 'golden_visa_buyer', confidence_boost: 0.25, signal: 'test' },
    ];
    const result = applyArchetypeHints(initial, hints);
    expect(result.probabilities.golden_visa_buyer).toBeGreaterThan(
      initial.probabilities.golden_visa_buyer,
    );
  });

  it('re-normalizes probabilities to sum to 1.0', () => {
    const initial = initIntentState();
    const hints: ArchetypeHintLike[] = [
      { archetype_id: 'golden_visa_buyer', confidence_boost: 0.25, signal: 'a' },
      { archetype_id: 'yield_hunter', confidence_boost: 0.15, signal: 'b' },
      { archetype_id: 'vacation_rental_investor', confidence_boost: 0.1, signal: 'c' },
    ];
    const result = applyArchetypeHints(initial, hints);
    expect(sumProbs(result.probabilities)).toBeCloseTo(1.0, 5);
  });

  it('makes the boosted archetypes the strongest non-neutral candidates', () => {
    const initial = initIntentState();
    // Base prior has neutral=0.37 which dominates the 0.04 archetypes; hints lift the
    // boosted archetypes well above the other 16 (but the cap at 0.30 means neutral
    // can still remain top — that's by design, behavioral signals will move it later).
    const hints: ArchetypeHintLike[] = [
      { archetype_id: 'golden_visa_buyer', confidence_boost: 0.3, signal: 'strong' },
      { archetype_id: 'yield_hunter', confidence_boost: 0.3, signal: 'strong' },
    ];
    const result = applyArchetypeHints(initial, hints);
    // Both boosted archetypes should outrank all other non-neutral archetypes.
    const goldenVisa = result.probabilities.golden_visa_buyer;
    const yieldHunter = result.probabilities.yield_hunter;
    expect(goldenVisa).toBeGreaterThan(result.probabilities.family_buyer);
    expect(goldenVisa).toBeGreaterThan(result.probabilities.flip_investor);
    expect(yieldHunter).toBeGreaterThan(result.probabilities.luxury_buyer);
  });

  it('does not boost unaffected archetypes (their probability only changes via normalization)', () => {
    const initial = initIntentState();
    const hints: ArchetypeHintLike[] = [
      { archetype_id: 'golden_visa_buyer', confidence_boost: 0.25, signal: 'a' },
    ];
    const result = applyArchetypeHints(initial, hints);
    // family_buyer was not boosted — its share should decrease relative to the boosted one.
    const beforeRatio =
      initial.probabilities.family_buyer / initial.probabilities.golden_visa_buyer;
    const afterRatio = result.probabilities.family_buyer / result.probabilities.golden_visa_buyer;
    expect(afterRatio).toBeLessThan(beforeRatio);
  });
});

describe('applyArchetypeHints — summing & capping', () => {
  it('sums multiple hints targeting the same archetype', () => {
    const initial = initIntentState();
    const single: ArchetypeHintLike[] = [
      { archetype_id: 'yield_hunter', confidence_boost: 0.1, signal: 's1' },
    ];
    const summed: ArchetypeHintLike[] = [
      { archetype_id: 'yield_hunter', confidence_boost: 0.1, signal: 's1' },
      { archetype_id: 'yield_hunter', confidence_boost: 0.1, signal: 's2' },
    ];
    const singleResult = applyArchetypeHints(initial, single);
    const summedResult = applyArchetypeHints(initial, summed);
    expect(summedResult.probabilities.yield_hunter).toBeGreaterThan(
      singleResult.probabilities.yield_hunter,
    );
  });

  it('caps summed boosts at 0.30 per archetype', () => {
    const initial = initIntentState();
    const cappedHints: ArchetypeHintLike[] = [
      { archetype_id: 'yield_hunter', confidence_boost: 0.3, signal: 's1' },
    ];
    const overflowHints: ArchetypeHintLike[] = [
      { archetype_id: 'yield_hunter', confidence_boost: 0.5, signal: 's1' },
      { archetype_id: 'yield_hunter', confidence_boost: 0.5, signal: 's2' },
    ];
    const cappedResult = applyArchetypeHints(initial, cappedHints);
    const overflowResult = applyArchetypeHints(initial, overflowHints);
    // Both should yield the same final probabilities — overflow is capped to 0.30.
    expect(overflowResult.probabilities.yield_hunter).toBeCloseTo(
      cappedResult.probabilities.yield_hunter,
      5,
    );
  });
});

describe('applyArchetypeHints — edge cases & robustness', () => {
  it('ignores hints with non-finite boost', () => {
    const initial = initIntentState();
    const hints: ArchetypeHintLike[] = [
      { archetype_id: 'yield_hunter', confidence_boost: Number.NaN, signal: 'bad' },
      { archetype_id: 'yield_hunter', confidence_boost: Number.POSITIVE_INFINITY, signal: 'bad' },
    ];
    const result = applyArchetypeHints(initial, hints);
    // Should remain at the base prior values (only normalization is a no-op when no boosts apply).
    expect(result.probabilities.yield_hunter).toBeCloseTo(initial.probabilities.yield_hunter, 5);
  });

  it('ignores hints with zero or negative boost', () => {
    const initial = initIntentState();
    const hints: ArchetypeHintLike[] = [
      { archetype_id: 'yield_hunter', confidence_boost: 0, signal: 'noop' },
      { archetype_id: 'yield_hunter', confidence_boost: -0.5, signal: 'neg' },
    ];
    const result = applyArchetypeHints(initial, hints);
    expect(result.probabilities.yield_hunter).toBeCloseTo(initial.probabilities.yield_hunter, 5);
  });

  it('silently drops hints with unknown archetype ids', () => {
    const initial = initIntentState();
    const hints: ArchetypeHintLike[] = [
      { archetype_id: 'totally_not_a_real_archetype', confidence_boost: 0.25, signal: 'x' },
      { archetype_id: 'yield_hunter', confidence_boost: 0.1, signal: 'y' },
    ];
    const result = applyArchetypeHints(initial, hints);
    expect(sumProbs(result.probabilities)).toBeCloseTo(1.0, 5);
    expect(result.probabilities.yield_hunter).toBeGreaterThan(initial.probabilities.yield_hunter);
  });

  it('preserves signal_count and quiz_answered', () => {
    const initial = { ...initIntentState(), signal_count: 7, quiz_answered: true };
    const hints: ArchetypeHintLike[] = [
      { archetype_id: 'yield_hunter', confidence_boost: 0.1, signal: 'x' },
    ];
    const result = applyArchetypeHints(initial, hints);
    expect(result.signal_count).toBe(7);
    expect(result.quiz_answered).toBe(true);
  });

  it('does not mutate the input state', () => {
    const initial = initIntentState();
    const before = { ...initial.probabilities };
    const hints: ArchetypeHintLike[] = [
      { archetype_id: 'yield_hunter', confidence_boost: 0.15, signal: 'x' },
    ];
    applyArchetypeHints(initial, hints);
    for (const k of ARCHETYPE_NAMES) {
      expect(initial.probabilities[k]).toBeCloseTo(before[k], 10);
    }
  });

  it('zero-boost hint array is effectively a no-op for probability distribution', () => {
    const initial = initIntentState();
    const hints: ArchetypeHintLike[] = [
      { archetype_id: 'yield_hunter', confidence_boost: 0, signal: 'noop' },
    ];
    const result = applyArchetypeHints(initial, hints);
    for (const k of ARCHETYPE_NAMES) {
      expect(result.probabilities[k]).toBeCloseTo(initial.probabilities[k], 5);
    }
  });
});
