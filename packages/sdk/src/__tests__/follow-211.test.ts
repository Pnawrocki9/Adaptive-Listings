/**
 * FOLLOW-211 — FilterAppliedPayload schema + facet-conditional intent boosts.
 *
 * Tests:
 *  - AC1: FilterAppliedPayloadSchema validates each enum facet value
 *  - AC2: filter.applied + commercial facet boosts commercial_investor
 *  - AC3: filter.applied + bedrooms ≥ 3 boosts family_buyer
 *  - AC4: all 4 facet-conditional cases:
 *      commercial → commercial_investor boosted
 *      investment_yield → yield_hunter + portfolio_builder boosted
 *      bedrooms ≥ 3 → family_buyer boosted
 *      bedrooms < 3 → family_buyer NOT boosted beyond baseline
 *  - price_range → no archetype-specific boost (generic signal)
 *  - Probabilities still sum to 1.0 after each filter boost
 *  - Unknown facet → signal is still counted but no targeted boost
 *  - filter.applied with missing facet → state returned unchanged (no count increment)
 */

import { describe, expect, it } from 'vitest';

import { FILTER_APPLIED_FACETS, FilterAppliedPayloadSchema } from '@estalara/shared';
import { ARCHETYPE_NAMES, applyBehavioralSignal, initIntentState } from '../core/intent.js';
import type { ArchetypeProbabilities } from '../core/intent.js';

/** Sum all 18 archetype probabilities. */
function sumProbs(p: ArchetypeProbabilities): number {
  return ARCHETYPE_NAMES.reduce((sum, k) => sum + p[k], 0);
}

// ─── AC1: FilterAppliedPayloadSchema validates all enum facets ────────────────

describe('FilterAppliedPayloadSchema (AC1)', () => {
  it('accepts every FILTER_APPLIED_FACETS enum value', () => {
    for (const facet of FILTER_APPLIED_FACETS) {
      const result = FilterAppliedPayloadSchema.safeParse({ facet });
      expect(result.success, `facet="${facet}" should be valid`).toBe(true);
    }
  });

  it('accepts facet with a string value', () => {
    const result = FilterAppliedPayloadSchema.safeParse({
      facet: 'property_type',
      value: 'commercial',
    });
    expect(result.success).toBe(true);
  });

  it('accepts facet with a numeric value', () => {
    const result = FilterAppliedPayloadSchema.safeParse({ facet: 'bedrooms', value: 3 });
    expect(result.success).toBe(true);
  });

  it('accepts facet with an array-of-strings value', () => {
    const result = FilterAppliedPayloadSchema.safeParse({
      facet: 'amenities',
      value: ['pool', 'garage'],
    });
    expect(result.success).toBe(true);
  });

  it('accepts facet with no value (optional)', () => {
    const result = FilterAppliedPayloadSchema.safeParse({ facet: 'commercial' });
    expect(result.success).toBe(true);
  });

  it('rejects an unknown facet string', () => {
    const result = FilterAppliedPayloadSchema.safeParse({ facet: 'unknown_facet', value: 1 });
    expect(result.success).toBe(false);
  });

  it('rejects a boolean value (not in the value union)', () => {
    const result = FilterAppliedPayloadSchema.safeParse({ facet: 'bedrooms', value: true });
    expect(result.success).toBe(false);
  });

  it('rejects missing facet field entirely', () => {
    const result = FilterAppliedPayloadSchema.safeParse({ value: 3 });
    expect(result.success).toBe(false);
  });
});

// ─── AC2: commercial facet → commercial_investor boosted ─────────────────────

describe('filter.applied — commercial facet boosts commercial_investor (AC2)', () => {
  it('commercial facet raises commercial_investor above baseline', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', { facet: 'commercial' });

    expect(after.probabilities.commercial_investor).toBeGreaterThan(
      before.probabilities.commercial_investor,
    );
  });

  it('commercial facet: commercial_investor is the top-boosted archetype', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', { facet: 'commercial' });

    // Compute the largest delta across all archetypes
    let maxDelta = -Infinity;
    let maxArchetype = '';
    for (const k of ARCHETYPE_NAMES) {
      const delta = after.probabilities[k] - before.probabilities[k];
      if (delta > maxDelta) {
        maxDelta = delta;
        maxArchetype = k;
      }
    }
    expect(maxArchetype).toBe('commercial_investor');
  });

  it('signal_count increments by 1 on commercial facet', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', { facet: 'commercial' });
    expect(after.signal_count).toBe(before.signal_count + 1);
  });

  it('probabilities still sum to 1.0 after commercial facet boost', () => {
    const after = applyBehavioralSignal(initIntentState(), 'filter.applied', {
      facet: 'commercial',
    });
    expect(sumProbs(after.probabilities)).toBeCloseTo(1.0, 5);
  });
});

// ─── AC3: bedrooms ≥ 3 → family_buyer boosted ────────────────────────────────

describe('filter.applied — bedrooms ≥ 3 boosts family_buyer (AC3)', () => {
  it('bedrooms=3 raises family_buyer above baseline', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', {
      facet: 'bedrooms',
      value: 3,
    });
    expect(after.probabilities.family_buyer).toBeGreaterThan(before.probabilities.family_buyer);
  });

  it('bedrooms=4 raises family_buyer above baseline', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', {
      facet: 'bedrooms',
      value: 4,
    });
    expect(after.probabilities.family_buyer).toBeGreaterThan(before.probabilities.family_buyer);
  });

  it('probabilities still sum to 1.0 after bedrooms boost', () => {
    const after = applyBehavioralSignal(initIntentState(), 'filter.applied', {
      facet: 'bedrooms',
      value: 3,
    });
    expect(sumProbs(after.probabilities)).toBeCloseTo(1.0, 5);
  });
});

// ─── AC4: all 4 facet-conditional cases ──────────────────────────────────────

describe('filter.applied — all 4 facet-conditional cases (AC4)', () => {
  // Case 1: commercial → commercial_investor boosted
  it('Case 1: commercial facet → commercial_investor is the most-boosted archetype', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', { facet: 'commercial' });
    expect(after.probabilities.commercial_investor).toBeGreaterThan(
      before.probabilities.commercial_investor,
    );
  });

  // Case 2: investment_yield → yield_hunter and portfolio_builder boosted
  it('Case 2: investment_yield facet → yield_hunter boosted', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', {
      facet: 'investment_yield',
    });
    expect(after.probabilities.yield_hunter).toBeGreaterThan(before.probabilities.yield_hunter);
  });

  it('Case 2: investment_yield facet → portfolio_builder boosted', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', {
      facet: 'investment_yield',
    });
    expect(after.probabilities.portfolio_builder).toBeGreaterThan(
      before.probabilities.portfolio_builder,
    );
  });

  it('Case 2: investment_yield → yield_hunter boosted more than portfolio_builder (0.12 vs 0.08)', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', {
      facet: 'investment_yield',
    });
    const yieldDelta = after.probabilities.yield_hunter - before.probabilities.yield_hunter;
    const portfolioDelta =
      after.probabilities.portfolio_builder - before.probabilities.portfolio_builder;
    expect(yieldDelta).toBeGreaterThan(portfolioDelta);
  });

  it('Case 2: probabilities sum to 1.0 after investment_yield boost', () => {
    const after = applyBehavioralSignal(initIntentState(), 'filter.applied', {
      facet: 'investment_yield',
    });
    expect(sumProbs(after.probabilities)).toBeCloseTo(1.0, 5);
  });

  // Case 3: bedrooms ≥ 3 → family_buyer boosted
  it('Case 3: bedrooms=3 → family_buyer boosted above baseline', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', {
      facet: 'bedrooms',
      value: 3,
    });
    expect(after.probabilities.family_buyer).toBeGreaterThan(before.probabilities.family_buyer);
  });

  // Case 4: bedrooms < 3 → family_buyer NOT boosted
  it('Case 4: bedrooms=2 → family_buyer NOT boosted (at or below baseline)', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', {
      facet: 'bedrooms',
      value: 2,
    });
    // family_buyer should be unchanged or lower (normalization may shift it slightly)
    expect(after.probabilities.family_buyer).toBeLessThanOrEqual(
      before.probabilities.family_buyer + 1e-9,
    );
  });

  it('Case 4: bedrooms=1 → family_buyer NOT boosted', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', {
      facet: 'bedrooms',
      value: 1,
    });
    expect(after.probabilities.family_buyer).toBeLessThanOrEqual(
      before.probabilities.family_buyer + 1e-9,
    );
  });
});

// ─── price_range: generic signal, no archetype-specific boost ────────────────

describe('filter.applied — price_range facet (no targeted boost)', () => {
  it('price_range facet: no single archetype is notably boosted above baseline', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', {
      facet: 'price_range',
      value: 500000,
    });

    // After normalization with no boost, all deltas should be at or very near 0
    for (const k of ARCHETYPE_NAMES) {
      const delta = Math.abs(after.probabilities[k] - before.probabilities[k]);
      // Each archetype should shift by less than 1% due to normalization artifacts
      expect(delta).toBeLessThan(0.01);
    }
  });

  it('price_range still increments signal_count', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', {
      facet: 'price_range',
      value: 500000,
    });
    expect(after.signal_count).toBe(before.signal_count + 1);
  });

  it('price_range: probabilities still sum to 1.0', () => {
    const after = applyBehavioralSignal(initIntentState(), 'filter.applied', {
      facet: 'price_range',
    });
    expect(sumProbs(after.probabilities)).toBeCloseTo(1.0, 5);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

describe('filter.applied — edge cases', () => {
  it('missing facet in payload → state returned unchanged (no signal_count increment)', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', {});
    expect(after).toBe(before);
    expect(after.signal_count).toBe(0);
  });

  it('missing payload entirely → state returned unchanged', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied');
    expect(after).toBe(before);
  });

  it('bedrooms with string "3" → correctly parsed as number ≥ 3 and boosts family_buyer', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'filter.applied', {
      facet: 'bedrooms',
      value: '3',
    });
    expect(after.probabilities.family_buyer).toBeGreaterThan(before.probabilities.family_buyer);
  });

  it('multiple filter.applied signals accumulate signal_count correctly', () => {
    let state = initIntentState();
    state = applyBehavioralSignal(state, 'filter.applied', { facet: 'commercial' });
    state = applyBehavioralSignal(state, 'filter.applied', { facet: 'investment_yield' });
    state = applyBehavioralSignal(state, 'filter.applied', { facet: 'bedrooms', value: 3 });
    expect(state.signal_count).toBe(3);
  });

  it('commercial then investment_yield: commercial_investor and yield_hunter both boosted vs initial', () => {
    const initial = initIntentState();
    let state = applyBehavioralSignal(initial, 'filter.applied', { facet: 'commercial' });
    state = applyBehavioralSignal(state, 'filter.applied', { facet: 'investment_yield' });

    expect(state.probabilities.commercial_investor).toBeGreaterThan(
      initial.probabilities.commercial_investor,
    );
    expect(state.probabilities.yield_hunter).toBeGreaterThan(initial.probabilities.yield_hunter);
  });

  it('applyBehavioralSignal with filter.applied is a pure function — does not mutate input', () => {
    const before = initIntentState();
    const probsBefore = { ...before.probabilities };
    applyBehavioralSignal(before, 'filter.applied', { facet: 'commercial' });
    expect(before.probabilities.commercial_investor).toBeCloseTo(
      probsBefore.commercial_investor,
      5,
    );
    expect(before.signal_count).toBe(0);
  });
});
