import { describe, expect, it } from 'vitest';

import { buildIntentStateEnvelope, readIntentStateEnvelope } from './intent-state-envelope.js';

const payload = {
  archetype: 'family_buyer',
  confidence: 0.74,
  probabilities: { family_buyer: 0.74, yield_hunter: 0.12, neutral: 0.14 },
};

describe('intent_state envelope — one contract for writer and readers [FOLLOW-1310, F-07]', () => {
  it('builds the documented { weights, topArchetype, confidence } object', () => {
    expect(buildIntentStateEnvelope(payload)).toEqual({
      weights: payload.probabilities,
      topArchetype: 'family_buyer',
      confidence: 0.74,
    });
  });

  it('reads back what it built after a JSONB round trip', () => {
    const stored: unknown = JSON.parse(JSON.stringify(buildIntentStateEnvelope(payload)));
    expect(readIntentStateEnvelope(stored)).toEqual({
      weights: payload.probabilities,
      topArchetype: 'family_buyer',
      confidence: 0.74,
      legacy: false,
    });
  });

  it('reads a legacy double-serialised row: real weights, no invented archetype or confidence', () => {
    // What the pre-FOLLOW-1310 writer stored: a JSONB STRING holding the probability map.
    const legacy: unknown = JSON.stringify(payload.probabilities);
    expect(readIntentStateEnvelope(legacy)).toEqual({
      weights: payload.probabilities,
      topArchetype: null,
      confidence: null,
      legacy: true,
    });
  });

  it('reads a legacy bare probability map the same way', () => {
    expect(readIntentStateEnvelope({ ...payload.probabilities })).toMatchObject({
      weights: payload.probabilities,
      topArchetype: null,
      legacy: true,
    });
  });

  it('returns all-null for null, garbage, and out-of-range values', () => {
    const empty = { weights: null, topArchetype: null, confidence: null, legacy: false };
    expect(readIntentStateEnvelope(null)).toEqual(empty);
    expect(readIntentStateEnvelope(undefined)).toEqual(empty);
    expect(readIntentStateEnvelope('not json')).toEqual({ ...empty, legacy: true });
    expect(readIntentStateEnvelope(42)).toEqual(empty);
    expect(
      readIntentStateEnvelope({ weights: { a: 'x' }, topArchetype: 7, confidence: 3 }),
    ).toEqual({ weights: {}, topArchetype: null, confidence: null, legacy: false });
  });
});
