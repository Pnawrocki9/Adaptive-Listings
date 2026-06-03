/**
 * Unit tests for the conversion-label taxonomy (FOLLOW-171, §T.4) and
 * the precedence-rank helper (FOLLOW-179).
 *
 * @module @estalara/shared/schemas/conversion-label.test
 */

import { describe, expect, it } from 'vitest';

import {
  ConversionLabelSourceSchema,
  ConversionOutcomeClassSchema,
  conversionLabelRank,
  outcomeClassFromConverted,
} from './conversion-label.js';

describe('ConversionOutcomeClassSchema', () => {
  it('accepts every canonical outcome class', () => {
    for (const v of [
      'viewing_booked',
      'offer_made',
      'contract_signed',
      'purchased',
      'lost',
      'no_response',
    ]) {
      expect(ConversionOutcomeClassSchema.safeParse(v).success).toBe(true);
    }
  });

  it('rejects an unknown outcome class', () => {
    expect(ConversionOutcomeClassSchema.safeParse('inquiry').success).toBe(false);
    expect(ConversionOutcomeClassSchema.safeParse('').success).toBe(false);
  });
});

describe('ConversionLabelSourceSchema', () => {
  it('accepts system and manual_admin only', () => {
    expect(ConversionLabelSourceSchema.safeParse('system').success).toBe(true);
    expect(ConversionLabelSourceSchema.safeParse('manual_admin').success).toBe(true);
    expect(ConversionLabelSourceSchema.safeParse('robot').success).toBe(false);
  });
});

describe('outcomeClassFromConverted', () => {
  it('maps converted=true → viewing_booked (shallowest positive)', () => {
    expect(outcomeClassFromConverted(true)).toBe('viewing_booked');
  });

  it('maps converted=false → no_response', () => {
    expect(outcomeClassFromConverted(false)).toBe('no_response');
  });

  it('always returns a value the enum accepts', () => {
    for (const c of [true, false]) {
      expect(ConversionOutcomeClassSchema.safeParse(outcomeClassFromConverted(c)).success).toBe(
        true,
      );
    }
  });
});

// ─── conversionLabelRank (FOLLOW-179) ────────────────────────────────────────

describe('conversionLabelRank — within system source (funnel/finality ordering)', () => {
  it('no_response has rank 0 (weakest)', () => {
    expect(conversionLabelRank({ outcomeClass: 'no_response', labelSource: 'system' })).toBe(0);
  });

  it('viewing_booked > no_response', () => {
    const vb = conversionLabelRank({ outcomeClass: 'viewing_booked', labelSource: 'system' });
    const nr = conversionLabelRank({ outcomeClass: 'no_response', labelSource: 'system' });
    expect(vb).toBeGreaterThan(nr);
  });

  it('offer_made > viewing_booked', () => {
    const om = conversionLabelRank({ outcomeClass: 'offer_made', labelSource: 'system' });
    const vb = conversionLabelRank({ outcomeClass: 'viewing_booked', labelSource: 'system' });
    expect(om).toBeGreaterThan(vb);
  });

  it('contract_signed > offer_made', () => {
    const cs = conversionLabelRank({ outcomeClass: 'contract_signed', labelSource: 'system' });
    const om = conversionLabelRank({ outcomeClass: 'offer_made', labelSource: 'system' });
    expect(cs).toBeGreaterThan(om);
  });

  it('lost > contract_signed (definitive negative beats open-funnel progress)', () => {
    const lost = conversionLabelRank({ outcomeClass: 'lost', labelSource: 'system' });
    const cs = conversionLabelRank({ outcomeClass: 'contract_signed', labelSource: 'system' });
    expect(lost).toBeGreaterThan(cs);
  });

  it('purchased > lost (strongest terminal positive; a confirmed purchase is never overridden by lost from same source)', () => {
    const purchased = conversionLabelRank({ outcomeClass: 'purchased', labelSource: 'system' });
    const lost = conversionLabelRank({ outcomeClass: 'lost', labelSource: 'system' });
    expect(purchased).toBeGreaterThan(lost);
  });

  it('purchased has the highest system rank', () => {
    const allClasses = [
      'no_response',
      'viewing_booked',
      'offer_made',
      'contract_signed',
      'lost',
    ] as const;
    const purchasedRank = conversionLabelRank({ outcomeClass: 'purchased', labelSource: 'system' });
    for (const cls of allClasses) {
      expect(purchasedRank).toBeGreaterThan(
        conversionLabelRank({ outcomeClass: cls, labelSource: 'system' }),
      );
    }
  });
});

describe('conversionLabelRank — source dominance (manual_admin always > system)', () => {
  it('manual_admin/no_response outranks system/purchased (source trumps class)', () => {
    const manualNoResponse = conversionLabelRank({
      outcomeClass: 'no_response',
      labelSource: 'manual_admin',
    });
    const systemPurchased = conversionLabelRank({
      outcomeClass: 'purchased',
      labelSource: 'system',
    });
    expect(manualNoResponse).toBeGreaterThan(systemPurchased);
  });

  it('manual_admin/no_response outranks system/viewing_booked', () => {
    expect(
      conversionLabelRank({ outcomeClass: 'no_response', labelSource: 'manual_admin' }),
    ).toBeGreaterThan(
      conversionLabelRank({ outcomeClass: 'viewing_booked', labelSource: 'system' }),
    );
  });

  it('manual_admin/purchased outranks manual_admin/no_response (class still matters within same source)', () => {
    const manualPurchased = conversionLabelRank({
      outcomeClass: 'purchased',
      labelSource: 'manual_admin',
    });
    const manualNoResponse = conversionLabelRank({
      outcomeClass: 'no_response',
      labelSource: 'manual_admin',
    });
    expect(manualPurchased).toBeGreaterThan(manualNoResponse);
  });

  it('every manual_admin class outranks every system class', () => {
    const allClasses = [
      'no_response',
      'viewing_booked',
      'offer_made',
      'contract_signed',
      'lost',
      'purchased',
    ] as const;
    for (const manualClass of allClasses) {
      for (const sysClass of allClasses) {
        expect(
          conversionLabelRank({ outcomeClass: manualClass, labelSource: 'manual_admin' }),
        ).toBeGreaterThan(conversionLabelRank({ outcomeClass: sysClass, labelSource: 'system' }));
      }
    }
  });
});

describe('conversionLabelRank — edge cases', () => {
  it('returns a non-negative integer for all valid inputs', () => {
    const sources = ['system', 'manual_admin'] as const;
    const classes = [
      'no_response',
      'viewing_booked',
      'offer_made',
      'contract_signed',
      'lost',
      'purchased',
    ] as const;
    for (const labelSource of sources) {
      for (const outcomeClass of classes) {
        const rank = conversionLabelRank({ outcomeClass, labelSource });
        expect(typeof rank).toBe('number');
        expect(rank).toBeGreaterThanOrEqual(0);
        expect(Number.isFinite(rank)).toBe(true);
      }
    }
  });

  it('rank is deterministic (same input always produces same output)', () => {
    const rank1 = conversionLabelRank({ outcomeClass: 'offer_made', labelSource: 'system' });
    const rank2 = conversionLabelRank({ outcomeClass: 'offer_made', labelSource: 'system' });
    expect(rank1).toBe(rank2);
  });
});
