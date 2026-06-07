/**
 * FOLLOW-207 — Referrer URL + device type cold-session priors.
 *
 * Tests:
 *   AC1: applyReferrerHints() is a pure function (no mutation of input state)
 *   AC2: Investment-keyword referrer shifts portfolio_builder + yield_hunter priors by ≥0.03
 *   AC3: Own-use keywords shift family_buyer by ≥0.03
 *   AC4: No matching keywords → state unchanged (same reference)
 *   AC5: device_type.desktop in SIGNAL_LIKELIHOODS boosts investor archetypes
 *   AC6: device_type.mobile boosts own-use archetypes
 *   Sum invariant: probabilities always sum to 1.0 after each transformation
 */

import { describe, expect, it } from 'vitest';

import {
  ARCHETYPE_NAMES,
  applyBehavioralSignal,
  applyReferrerHints,
  initIntentState,
} from '../core/intent.js';
import type { ArchetypeProbabilities } from '../core/intent.js';

/** Sum all 18 archetype probabilities. */
function sumProbs(p: ArchetypeProbabilities): number {
  return ARCHETYPE_NAMES.reduce((sum, k) => sum + p[k], 0);
}

// ─── AC1: applyReferrerHints is a pure function ───────────────────────────────

describe('applyReferrerHints — purity (AC1)', () => {
  it('does not mutate the input state when investment keyword matches', () => {
    const before = initIntentState();
    const portfolioBefore = before.probabilities.portfolio_builder;
    const countBefore = before.signal_count;
    applyReferrerHints(before, 'https://investment-property.example.com/', '');
    expect(before.probabilities.portfolio_builder).toBeCloseTo(portfolioBefore, 10);
    expect(before.signal_count).toBe(countBefore);
  });

  it('does not mutate the input state when own-use keyword matches', () => {
    const before = initIntentState();
    const familyBefore = before.probabilities.family_buyer;
    applyReferrerHints(before, 'https://family-homes.example.com/', '');
    expect(before.probabilities.family_buyer).toBeCloseTo(familyBefore, 10);
  });

  it('does not mutate the input state when no keyword matches', () => {
    const before = initIntentState();
    const neutralBefore = before.probabilities.neutral;
    applyReferrerHints(before, 'https://google.com/', '');
    expect(before.probabilities.neutral).toBeCloseTo(neutralBefore, 10);
  });

  it('returns a fresh object (not the same reference) on keyword match', () => {
    const before = initIntentState();
    const after = applyReferrerHints(before, 'https://investment.example.com/', '');
    expect(after).not.toBe(before);
  });

  it('preserves signal_count and quiz_answered across transformation', () => {
    const before = initIntentState();
    const after = applyReferrerHints(before, 'https://rental-property.example.com/', '');
    expect(after.signal_count).toBe(before.signal_count);
    expect(after.quiz_answered).toBe(before.quiz_answered);
  });
});

// ─── AC2: Investment-keyword referrer shifts investor priors ≥0.03 ────────────

describe('applyReferrerHints — investment keywords (AC2)', () => {
  const investmentCases: { label: string; referrer: string; utmTerm: string }[] = [
    {
      label: 'investment in referrer',
      referrer: 'https://google.com/search?q=investment+property',
      utmTerm: '',
    },
    { label: 'rental in referrer', referrer: 'https://rental-market.example.com/', utmTerm: '' },
    { label: 'yield in referrer', referrer: 'https://yield-calculator.example.com/', utmTerm: '' },
    { label: 'inwestycja in utmTerm', referrer: '', utmTerm: 'inwestycja Warszawa' },
    { label: 'wynajem in utmTerm', referrer: '', utmTerm: 'wynajem mieszkania' },
    {
      label: 'investment in utmTerm',
      referrer: 'https://google.com/',
      utmTerm: 'investment property Warsaw',
    },
  ];

  investmentCases.forEach(({ label, referrer, utmTerm }) => {
    it(`portfolio_builder shifts ≥0.03 — ${label}`, () => {
      const before = initIntentState();
      const after = applyReferrerHints(before, referrer, utmTerm);
      const delta = after.probabilities.portfolio_builder - before.probabilities.portfolio_builder;
      expect(delta).toBeGreaterThanOrEqual(0.03);
    });

    it(`yield_hunter shifts ≥0.03 — ${label}`, () => {
      const before = initIntentState();
      const after = applyReferrerHints(before, referrer, utmTerm);
      const delta = after.probabilities.yield_hunter - before.probabilities.yield_hunter;
      expect(delta).toBeGreaterThanOrEqual(0.03);
    });

    it(`probabilities sum to 1.0 — ${label}`, () => {
      const after = applyReferrerHints(initIntentState(), referrer, utmTerm);
      expect(sumProbs(after.probabilities)).toBeCloseTo(1.0, 5);
    });
  });

  it('commercial_investor is boosted by investment keyword', () => {
    const before = initIntentState();
    const after = applyReferrerHints(before, 'https://investment.example.com/', '');
    const delta =
      after.probabilities.commercial_investor - before.probabilities.commercial_investor;
    expect(delta).toBeGreaterThan(0);
  });
});

// ─── AC3: Own-use keywords shift family_buyer ≥0.03 ──────────────────────────

describe('applyReferrerHints — own-use keywords (AC3)', () => {
  const ownUseCases: { label: string; referrer: string; utmTerm: string }[] = [
    { label: 'family in referrer', referrer: 'https://family-homes.example.com/', utmTerm: '' },
    {
      label: 'apartment in referrer',
      referrer: 'https://best-apartments.example.com/',
      utmTerm: '',
    },
    { label: 'mieszkanie in utmTerm', referrer: '', utmTerm: 'mieszkanie Kraków' },
    { label: 'dom in utmTerm', referrer: '', utmTerm: 'dom z ogrodem' },
    {
      label: 'family in utmTerm',
      referrer: 'https://google.com/',
      utmTerm: 'family apartment Warsaw',
    },
  ];

  ownUseCases.forEach(({ label, referrer, utmTerm }) => {
    it(`family_buyer shifts ≥0.03 — ${label}`, () => {
      const before = initIntentState();
      const after = applyReferrerHints(before, referrer, utmTerm);
      const delta = after.probabilities.family_buyer - before.probabilities.family_buyer;
      expect(delta).toBeGreaterThanOrEqual(0.03);
    });

    it(`probabilities sum to 1.0 — ${label}`, () => {
      const after = applyReferrerHints(initIntentState(), referrer, utmTerm);
      expect(sumProbs(after.probabilities)).toBeCloseTo(1.0, 5);
    });
  });

  it('first_time_buyer is boosted by own-use keyword', () => {
    const before = initIntentState();
    const after = applyReferrerHints(before, 'https://first-apartment.example.com/', '');
    const delta = after.probabilities.first_time_buyer - before.probabilities.first_time_buyer;
    expect(delta).toBeGreaterThan(0);
  });
});

// ─── AC4: No matching keywords → state unchanged ─────────────────────────────

describe('applyReferrerHints — no keyword match (AC4)', () => {
  const noMatchCases: { label: string; referrer: string; utmTerm: string }[] = [
    { label: 'empty referrer and utmTerm', referrer: '', utmTerm: '' },
    { label: 'generic Google referrer, no term', referrer: 'https://google.com/', utmTerm: '' },
    { label: 'direct navigation', referrer: '', utmTerm: 'property search' },
    { label: 'irrelevant UTM term', referrer: '', utmTerm: 'real estate agent' },
  ];

  noMatchCases.forEach(({ label, referrer, utmTerm }) => {
    it(`returns same reference (no-op) — ${label}`, () => {
      const before = initIntentState();
      const after = applyReferrerHints(before, referrer, utmTerm);
      expect(after).toBe(before);
    });
  });

  it('does not change any archetype probability on no match', () => {
    const before = initIntentState();
    const after = applyReferrerHints(before, 'https://google.com/', '');
    for (const k of ARCHETYPE_NAMES) {
      expect(after.probabilities[k]).toBeCloseTo(before.probabilities[k], 10);
    }
  });
});

// ─── AC5: device_type.desktop boosts investor archetypes ─────────────────────

describe('applyBehavioralSignal — device_type.desktop (AC5)', () => {
  const investorArchetypes = [
    'portfolio_builder',
    'yield_hunter',
    'flip_investor',
    'commercial_investor',
  ] as const;

  const ownUseArchetypes = ['family_buyer', 'first_time_buyer', 'upsizer', 'downsizer'] as const;

  it('desktop: signal is recognized (signal_count increments)', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'device_type.desktop');
    expect(after.signal_count).toBeGreaterThan(before.signal_count);
  });

  investorArchetypes.forEach((archetype) => {
    it(`desktop boosts ${archetype} above baseline`, () => {
      const before = initIntentState();
      const after = applyBehavioralSignal(before, 'device_type.desktop');
      expect(after.probabilities[archetype]).toBeGreaterThan(before.probabilities[archetype]);
    });
  });

  ownUseArchetypes.forEach((archetype) => {
    it(`desktop does NOT boost ${archetype}`, () => {
      const before = initIntentState();
      const after = applyBehavioralSignal(before, 'device_type.desktop');
      // Own-use archetypes should be at or below baseline after desktop signal
      expect(after.probabilities[archetype]).toBeLessThanOrEqual(before.probabilities[archetype]);
    });
  });

  it('probabilities sum to 1.0 after device_type.desktop', () => {
    const after = applyBehavioralSignal(initIntentState(), 'device_type.desktop');
    expect(sumProbs(after.probabilities)).toBeCloseTo(1.0, 5);
  });

  it('is a pure function — does not mutate input state', () => {
    const before = initIntentState();
    const portfolioBefore = before.probabilities.portfolio_builder;
    applyBehavioralSignal(before, 'device_type.desktop');
    expect(before.probabilities.portfolio_builder).toBeCloseTo(portfolioBefore, 10);
  });
});

// ─── AC6: device_type.mobile boosts own-use archetypes ───────────────────────

describe('applyBehavioralSignal — device_type.mobile (AC6)', () => {
  const ownUseArchetypes = ['family_buyer', 'first_time_buyer', 'upsizer', 'downsizer'] as const;

  const investorArchetypes = [
    'portfolio_builder',
    'yield_hunter',
    'flip_investor',
    'commercial_investor',
  ] as const;

  it('mobile: signal is recognized (signal_count increments)', () => {
    const before = initIntentState();
    const after = applyBehavioralSignal(before, 'device_type.mobile');
    expect(after.signal_count).toBeGreaterThan(before.signal_count);
  });

  ownUseArchetypes.forEach((archetype) => {
    it(`mobile boosts ${archetype} above baseline`, () => {
      const before = initIntentState();
      const after = applyBehavioralSignal(before, 'device_type.mobile');
      expect(after.probabilities[archetype]).toBeGreaterThan(before.probabilities[archetype]);
    });
  });

  investorArchetypes.forEach((archetype) => {
    it(`mobile does NOT boost ${archetype}`, () => {
      const before = initIntentState();
      const after = applyBehavioralSignal(before, 'device_type.mobile');
      // Investor archetypes should be at or below baseline after mobile signal
      expect(after.probabilities[archetype]).toBeLessThanOrEqual(before.probabilities[archetype]);
    });
  });

  it('probabilities sum to 1.0 after device_type.mobile', () => {
    const after = applyBehavioralSignal(initIntentState(), 'device_type.mobile');
    expect(sumProbs(after.probabilities)).toBeCloseTo(1.0, 5);
  });

  it('is a pure function — does not mutate input state', () => {
    const before = initIntentState();
    const familyBefore = before.probabilities.family_buyer;
    applyBehavioralSignal(before, 'device_type.mobile');
    expect(before.probabilities.family_buyer).toBeCloseTo(familyBefore, 10);
  });
});

// ─── Both keyword groups match simultaneously ─────────────────────────────────

describe('applyReferrerHints — both groups match simultaneously', () => {
  it('boosts both portfolio_builder and family_buyer when referrer has mixed keywords', () => {
    const before = initIntentState();
    // "family investment" triggers both groups
    const after = applyReferrerHints(before, 'https://family-investment.example.com/', '');
    expect(after.probabilities.portfolio_builder).toBeGreaterThan(
      before.probabilities.portfolio_builder,
    );
    expect(after.probabilities.family_buyer).toBeGreaterThan(before.probabilities.family_buyer);
  });

  it('probabilities sum to 1.0 when both groups match', () => {
    const after = applyReferrerHints(
      initIntentState(),
      'https://family-investment.example.com/',
      '',
    );
    expect(sumProbs(after.probabilities)).toBeCloseTo(1.0, 5);
  });
});

// ─── Case-insensitivity ───────────────────────────────────────────────────────

describe('applyReferrerHints — case-insensitive keyword matching', () => {
  it('matches INVESTMENT in uppercase referrer', () => {
    const before = initIntentState();
    const after = applyReferrerHints(before, 'https://INVESTMENT-PROPERTY.example.com/', '');
    const delta = after.probabilities.portfolio_builder - before.probabilities.portfolio_builder;
    expect(delta).toBeGreaterThanOrEqual(0.03);
  });

  it('matches FAMILY in uppercase UTM term', () => {
    const before = initIntentState();
    const after = applyReferrerHints(before, '', 'FAMILY HOME BUYER');
    const delta = after.probabilities.family_buyer - before.probabilities.family_buyer;
    expect(delta).toBeGreaterThanOrEqual(0.03);
  });
});
