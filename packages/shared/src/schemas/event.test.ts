import { describe, it, expect } from 'vitest';

import { ConsentStateSchema, EventEnvelopeSchema, RegionSchema } from './event.js';

const validEnvelope = {
  event_id: '01928f00-7000-7000-8000-123456789abc',
  tenant_id: '01928f00-7000-7000-8000-aaaaaaaaaaaa',
  session_id: 'a'.repeat(40),
  ts: 1714180000000,
  region: 'eu' as const,
  consent_state: 'legitimate-interest' as const,
  schema_version: 1 as const,
  type: 'page.view',
  payload: { url: 'https://example.com' },
};

describe('EventEnvelopeSchema', () => {
  it('parses a valid envelope', () => {
    expect(() => EventEnvelopeSchema.parse(validEnvelope)).not.toThrow();
  });

  it('accepts optional listing_id and archetype_hint', () => {
    expect(() =>
      EventEnvelopeSchema.parse({
        ...validEnvelope,
        listing_id: 'l_1',
        archetype_hint: 'luxury_investor',
      }),
    ).not.toThrow();
  });

  it('rejects non-UUID event_id', () => {
    expect(() => EventEnvelopeSchema.parse({ ...validEnvelope, event_id: 'nope' })).toThrow();
  });

  it('rejects non-UUID tenant_id', () => {
    expect(() => EventEnvelopeSchema.parse({ ...validEnvelope, tenant_id: 'nope' })).toThrow();
  });

  it('rejects session_id shorter than 32 chars', () => {
    expect(() =>
      EventEnvelopeSchema.parse({ ...validEnvelope, session_id: 'a'.repeat(8) }),
    ).toThrow();
  });

  it('rejects session_id longer than 64 chars', () => {
    expect(() =>
      EventEnvelopeSchema.parse({ ...validEnvelope, session_id: 'a'.repeat(80) }),
    ).toThrow();
  });

  it('rejects negative or zero ts', () => {
    expect(() => EventEnvelopeSchema.parse({ ...validEnvelope, ts: 0 })).toThrow();
    expect(() => EventEnvelopeSchema.parse({ ...validEnvelope, ts: -1 })).toThrow();
  });

  it('rejects unknown region', () => {
    expect(() => EventEnvelopeSchema.parse({ ...validEnvelope, region: 'antarctica' })).toThrow();
  });

  it('accepts all four regions', () => {
    for (const region of ['eu', 'us', 'uk', 'uae'] as const) {
      expect(() => EventEnvelopeSchema.parse({ ...validEnvelope, region })).not.toThrow();
    }
  });

  it('rejects unknown consent_state', () => {
    expect(() => EventEnvelopeSchema.parse({ ...validEnvelope, consent_state: 'maybe' })).toThrow();
  });

  it('accepts all four consent_state values', () => {
    for (const consent of ['none', 'session-only', 'legitimate-interest', 'consented'] as const) {
      expect(() =>
        EventEnvelopeSchema.parse({ ...validEnvelope, consent_state: consent }),
      ).not.toThrow();
    }
  });

  it('rejects schema_version other than literal 1', () => {
    expect(() => EventEnvelopeSchema.parse({ ...validEnvelope, schema_version: 2 })).toThrow();
  });

  it('rejects empty type', () => {
    expect(() => EventEnvelopeSchema.parse({ ...validEnvelope, type: '' })).toThrow();
  });

  it('rejects missing payload', () => {
    const { payload: _omit, ...withoutPayload } = validEnvelope;
    void _omit;
    expect(() => EventEnvelopeSchema.parse(withoutPayload)).toThrow();
  });

  it('exposes RegionSchema and ConsentStateSchema enums', () => {
    expect(RegionSchema.options).toEqual(['eu', 'us', 'uk', 'uae']);
    expect(ConsentStateSchema.options).toEqual([
      'none',
      'session-only',
      'legitimate-interest',
      'consented',
    ]);
  });
});
