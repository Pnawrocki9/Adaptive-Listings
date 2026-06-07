/**
 * FOLLOW-210 — listing.bookmarked signal: favorites/bookmark capture.
 *
 * Tests:
 *  - AC2: SDK receives estalara:listing:favorited event and queues listing.bookmarked ingest event
 *  - AC3: applyBehavioralSignal called with 'listing.bookmarked' updates intent state
 *  - AC4: neutral archetype probability decreases after listing.bookmarked signal
 *  - AC5: bedroomCount >= 3 boosts family_buyer and upsizer; listingType 'commercial' boosts commercial_investor
 *  - Schema validation for extended ListingBookmarkedPayloadSchema
 */

import { describe, expect, it } from 'vitest';

import { ListingBookmarkedPayloadSchema } from '@estalara/shared';
import { ARCHETYPE_NAMES, applyBehavioralSignal, initIntentState } from '../core/intent.js';
import type { ArchetypeProbabilities } from '../core/intent.js';

/** Sum all 18 archetype probabilities. */
function sumProbs(p: ArchetypeProbabilities): number {
  return ARCHETYPE_NAMES.reduce((sum, k) => sum + p[k], 0);
}

// ─── Schema validation ────────────────────────────────────────────────────────

describe('ListingBookmarkedPayloadSchema (FOLLOW-210 schema extension)', () => {
  it('accepts the minimal payload (collection only — backward compat)', () => {
    const result = ListingBookmarkedPayloadSchema.safeParse({ collection: 'shortlist' });
    expect(result.success).toBe(true);
  });

  it('accepts the empty payload (all fields optional)', () => {
    const result = ListingBookmarkedPayloadSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts the full FOLLOW-210 payload', () => {
    const result = ListingBookmarkedPayloadSchema.safeParse({
      collection: 'shortlist',
      listingType: 'residential',
      priceRange: '500k-700k',
      bedroomCount: 4,
    });
    expect(result.success).toBe(true);
  });

  it('accepts listingType without collection', () => {
    const result = ListingBookmarkedPayloadSchema.safeParse({
      listingType: 'commercial',
    });
    expect(result.success).toBe(true);
  });

  it('accepts bedroomCount without other fields', () => {
    const result = ListingBookmarkedPayloadSchema.safeParse({ bedroomCount: 3 });
    expect(result.success).toBe(true);
  });

  it('rejects non-numeric bedroomCount', () => {
    const result = ListingBookmarkedPayloadSchema.safeParse({ bedroomCount: 'three' });
    expect(result.success).toBe(false);
  });

  it('rejects non-string listingType', () => {
    const result = ListingBookmarkedPayloadSchema.safeParse({ listingType: 42 });
    expect(result.success).toBe(false);
  });
});

// ─── AC3 + AC4: applyBehavioralSignal with listing.bookmarked ─────────────────

describe('applyBehavioralSignal — listing.bookmarked (AC3 + AC4)', () => {
  it('AC3: signal_count increments by 1', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'listing.bookmarked', {});
    expect(after.signal_count).toBe(before.signal_count + 1);
  });

  it('AC4: neutral probability decreases after listing.bookmarked', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'listing.bookmarked', {});
    expect(after.probabilities.neutral).toBeLessThan(before.probabilities.neutral);
  });

  it('probabilities still sum to 1.0 after listing.bookmarked', () => {
    const after = applyBehavioralSignal(initIntentState(), 'listing.bookmarked', {});
    expect(sumProbs(after.probabilities)).toBeCloseTo(1.0, 5);
  });

  it('is a pure function — does not mutate input state', () => {
    const before = initIntentState();
    const neutralBefore = before.probabilities.neutral;
    const countBefore = before.signal_count;
    applyBehavioralSignal(before, 'listing.bookmarked', {});
    expect(before.probabilities.neutral).toBeCloseTo(neutralBefore, 10);
    expect(before.signal_count).toBe(countBefore);
  });

  it('multiple listing.bookmarked signals accumulate signal_count', () => {
    let state = initIntentState();
    state = applyBehavioralSignal(state, 'listing.bookmarked', {});
    state = applyBehavioralSignal(state, 'listing.bookmarked', {});
    state = applyBehavioralSignal(state, 'listing.bookmarked', {});
    expect(state.signal_count).toBe(3);
  });

  it('neutral decreases more after 3 signals than after 1', () => {
    const initial = initIntentState();
    const after1 = applyBehavioralSignal(initial, 'listing.bookmarked', {});
    let after3 = applyBehavioralSignal(initial, 'listing.bookmarked', {});
    after3 = applyBehavioralSignal(after3, 'listing.bookmarked', {});
    after3 = applyBehavioralSignal(after3, 'listing.bookmarked', {});
    expect(after3.probabilities.neutral).toBeLessThan(after1.probabilities.neutral);
  });
});

// ─── AC5: payload-conditional boosts ─────────────────────────────────────────

describe('applyBehavioralSignal — listing.bookmarked payload boosts (AC5)', () => {
  // bedroomCount >= 3 → family_buyer +0.15, upsizer +0.10
  it('bedroomCount=3 boosts family_buyer above baseline', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'listing.bookmarked', { bedroomCount: 3 });
    expect(after.probabilities.family_buyer).toBeGreaterThan(before.probabilities.family_buyer);
  });

  it('bedroomCount=4 boosts family_buyer above baseline', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'listing.bookmarked', { bedroomCount: 4 });
    expect(after.probabilities.family_buyer).toBeGreaterThan(before.probabilities.family_buyer);
  });

  it('bedroomCount=3 boosts upsizer above baseline', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'listing.bookmarked', { bedroomCount: 3 });
    expect(after.probabilities.upsizer).toBeGreaterThan(before.probabilities.upsizer);
  });

  it('bedroomCount=5 boosts upsizer above baseline', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'listing.bookmarked', { bedroomCount: 5 });
    expect(after.probabilities.upsizer).toBeGreaterThan(before.probabilities.upsizer);
  });

  it('bedroomCount=2 does NOT boost family_buyer beyond neutral-push baseline', () => {
    const before = initIntentState();
    const afterWithout = applyBehavioralSignal(before, 'listing.bookmarked', {});
    const afterWith = applyBehavioralSignal(before, 'listing.bookmarked', { bedroomCount: 2 });
    // family_buyer without bedroom boost should be >= with bedroomCount=2 (no extra push)
    expect(afterWith.probabilities.family_buyer).toBeLessThanOrEqual(
      afterWithout.probabilities.family_buyer + 1e-9,
    );
  });

  it('bedroomCount=1 does NOT boost upsizer beyond neutral-push baseline', () => {
    const before = initIntentState();
    const afterWithout = applyBehavioralSignal(before, 'listing.bookmarked', {});
    const afterWith = applyBehavioralSignal(before, 'listing.bookmarked', { bedroomCount: 1 });
    expect(afterWith.probabilities.upsizer).toBeLessThanOrEqual(
      afterWithout.probabilities.upsizer + 1e-9,
    );
  });

  it("listingType='commercial' boosts commercial_investor above baseline", () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'listing.bookmarked', {
      listingType: 'commercial',
    });
    expect(after.probabilities.commercial_investor).toBeGreaterThan(
      before.probabilities.commercial_investor,
    );
  });

  it("listingType='residential' does NOT boost commercial_investor", () => {
    const before = initIntentState();
    const afterResidential = applyBehavioralSignal(before, 'listing.bookmarked', {
      listingType: 'residential',
    });
    const afterNoType = applyBehavioralSignal(before, 'listing.bookmarked', {});
    // commercial_investor should be the same as the no-type case
    expect(afterResidential.probabilities.commercial_investor).toBeCloseTo(
      afterNoType.probabilities.commercial_investor,
      5,
    );
  });

  it('combined: bedroomCount=4 AND listingType=commercial boosts both family_buyer and commercial_investor', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'listing.bookmarked', {
      bedroomCount: 4,
      listingType: 'commercial',
    });
    expect(after.probabilities.family_buyer).toBeGreaterThan(before.probabilities.family_buyer);
    expect(after.probabilities.commercial_investor).toBeGreaterThan(
      before.probabilities.commercial_investor,
    );
  });

  it('commercial boost: commercial_investor has the largest positive delta', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'listing.bookmarked', {
      listingType: 'commercial',
    });

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

  it('probabilities still sum to 1.0 with bedroomCount=4 boost', () => {
    const after = applyBehavioralSignal(initIntentState(), 'listing.bookmarked', {
      bedroomCount: 4,
    });
    expect(sumProbs(after.probabilities)).toBeCloseTo(1.0, 5);
  });

  it('probabilities still sum to 1.0 with listingType=commercial boost', () => {
    const after = applyBehavioralSignal(initIntentState(), 'listing.bookmarked', {
      listingType: 'commercial',
    });
    expect(sumProbs(after.probabilities)).toBeCloseTo(1.0, 5);
  });

  it('probabilities still sum to 1.0 with all payload fields provided', () => {
    const after = applyBehavioralSignal(initIntentState(), 'listing.bookmarked', {
      bedroomCount: 4,
      listingType: 'commercial',
      priceRange: '700k-1m',
    });
    expect(sumProbs(after.probabilities)).toBeCloseTo(1.0, 5);
  });
});

// ─── AC2: ingest event queuing (via CustomEvent dispatch simulation) ──────────
// Note: AC2 is verified by the integration wiring in index.ts. Unit-level proof:
// the event type 'listing.bookmarked' is a known SIGNAL_LIKELIHOODS key (tested above),
// and the payload type is validated by ListingBookmarkedPayloadSchema (tested above).
// The end-to-end CustomEvent → eventQueue path is covered by the Playwright E2E spec.

describe('listing.bookmarked signal — ingest event type', () => {
  it('listing.bookmarked is handled by applyBehavioralSignal (signal_count > 0)', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'listing.bookmarked', {});
    // Known event type: signal_count must increment
    expect(after.signal_count).toBeGreaterThan(before.signal_count);
  });

  it('unknown event type does NOT increment signal_count (sanity check)', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'listing.something_else', {});
    expect(after.signal_count).toBe(before.signal_count);
  });
});
