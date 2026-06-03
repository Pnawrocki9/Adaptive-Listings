/**
 * Unit tests for the conversion-label taxonomy (FOLLOW-171, §T.4).
 *
 * @module @estalara/shared/schemas/conversion-label.test
 */

import { describe, expect, it } from 'vitest';

import {
  ConversionLabelSourceSchema,
  ConversionOutcomeClassSchema,
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
