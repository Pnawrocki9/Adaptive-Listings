/**
 * Unit tests for the conversion-label taxonomy (FOLLOW-171, §T.4),
 * the precedence-rank helper (FOLLOW-179), and the SQL CASE builder exports
 * (FOLLOW-182, Rule K.1 amendment).
 *
 * @module @estalara/shared/schemas/conversion-label.test
 */

import { describe, expect, it } from 'vitest';

import {
  ConversionLabelSourceSchema,
  ConversionOutcomeClassSchema,
  MANUAL_ADMIN_OFFSET,
  OUTCOME_CLASS_RANK,
  allRankEntries,
  conversionLabelRank,
  outcomeClassFromConverted,
  type ConversionLabelSource,
  type ConversionOutcomeClass,
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

// ─── OUTCOME_CLASS_RANK + MANUAL_ADMIN_OFFSET exports (FOLLOW-182) ───────────

describe('OUTCOME_CLASS_RANK export (FOLLOW-182, Rule K.1 amendment)', () => {
  it('covers every member of ConversionOutcomeClass', () => {
    const schemaValues = ConversionOutcomeClassSchema.options as ConversionOutcomeClass[];
    for (const cls of schemaValues) {
      expect(OUTCOME_CLASS_RANK).toHaveProperty(cls);
      expect(typeof OUTCOME_CLASS_RANK[cls]).toBe('number');
    }
  });

  it('has no extra keys beyond ConversionOutcomeClass members', () => {
    const schemaValues = new Set<string>(ConversionOutcomeClassSchema.options);
    for (const key of Object.keys(OUTCOME_CLASS_RANK)) {
      expect(schemaValues.has(key)).toBe(true);
    }
  });

  it('all rank values are unique non-negative integers', () => {
    const values = Object.values(OUTCOME_CLASS_RANK);
    const unique = new Set(values);
    expect(unique.size).toBe(values.length);
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  it('MANUAL_ADMIN_OFFSET is strictly greater than the maximum class rank', () => {
    const maxClassRank = Math.max(...Object.values(OUTCOME_CLASS_RANK));
    expect(MANUAL_ADMIN_OFFSET).toBeGreaterThan(maxClassRank);
  });
});

// ─── allRankEntries parity gate (FOLLOW-182) ─────────────────────────────────
//
// This is the CI gate for the Rule K.1 amendment: it asserts that every entry
// produced by `allRankEntries()` agrees exactly with `conversionLabelRank()`,
// exercising all 12 (class × source) pairs. If a class is added to OUTCOME_CLASS_RANK
// but allRankEntries() or conversionLabelRank() is not updated consistently, this test
// catches the divergence.

describe('allRankEntries — parity with conversionLabelRank (FOLLOW-182)', () => {
  const sources: ConversionLabelSource[] = ['system', 'manual_admin'];
  const classes = Object.keys(OUTCOME_CLASS_RANK) as ConversionOutcomeClass[];
  const expectedCount = sources.length * classes.length;

  it(
    'returns exactly ' +
      String(expectedCount) +
      ' entries (' +
      String(classes.length) +
      ' classes × ' +
      String(sources.length) +
      ' sources)',
    () => {
      const entries = allRankEntries();
      expect(entries).toHaveLength(expectedCount);
    },
  );

  it('every entry rank matches conversionLabelRank() exactly', () => {
    const entries = allRankEntries();
    for (const { outcomeClass, labelSource, rank } of entries) {
      const expected = conversionLabelRank({ outcomeClass, labelSource });
      expect(rank).toBe(expected);
    }
  });

  it('covers every (class, source) pair exactly once', () => {
    const entries = allRankEntries();
    const seen = new Set<string>();
    for (const { outcomeClass, labelSource } of entries) {
      const key = `${labelSource}:${outcomeClass}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBe(expectedCount);
  });

  it('all source values in entries are valid ConversionLabelSource members', () => {
    for (const { labelSource } of allRankEntries()) {
      expect(ConversionLabelSourceSchema.safeParse(labelSource).success).toBe(true);
    }
  });

  it('all outcomeClass values in entries are valid ConversionOutcomeClass members', () => {
    for (const { outcomeClass } of allRankEntries()) {
      expect(ConversionOutcomeClassSchema.safeParse(outcomeClass).success).toBe(true);
    }
  });

  it('system entries all have rank < MANUAL_ADMIN_OFFSET (source dominance holds)', () => {
    for (const { labelSource, rank } of allRankEntries()) {
      if (labelSource === 'system') {
        expect(rank).toBeLessThan(MANUAL_ADMIN_OFFSET);
      }
    }
  });

  it('manual_admin entries all have rank >= MANUAL_ADMIN_OFFSET', () => {
    for (const { labelSource, rank } of allRankEntries()) {
      if (labelSource === 'manual_admin') {
        expect(rank).toBeGreaterThanOrEqual(MANUAL_ADMIN_OFFSET);
      }
    }
  });
});
