import { describe, expect, it } from 'vitest';

import { EventEnvelopeSchema } from '../event.js';

/** Minimal valid envelope — payload is deliberately loose (record) */
function makeEnvelope(payload: Record<string, unknown>) {
  return {
    event_id: '01900000-0000-7000-8000-000000000001',
    tenant_id: '550e8400-e29b-41d4-a716-446655440000',
    session_id: 'a'.repeat(40),
    ts: Date.now(),
    region: 'eu',
    consent_state: 'none',
    schema_version: 1,
    type: 'page.view',
    payload,
  };
}

describe('PII blacklist — EventEnvelopeSchema', () => {
  it.each([
    ['email'],
    ['Email'],
    ['EMAIL'],
    ['e_mail'],
    ['e-mail'],
    ['phone'],
    ['Phone'],
    ['mobile'],
    ['phone_number'],
    ['full_name'],
    ['fullName'],
    ['first_name'],
    ['last_name'],
    ['address'],
    ['ip_address'],
    ['ip'],
    ['ssn'],
    ['date_of_birth'],
    ['credit_card'],
    ['iban'],
  ])('rejects payload containing PII field "%s"', (piiKey) => {
    const result = EventEnvelopeSchema.safeParse(
      makeEnvelope({ [piiKey]: 'should-be-rejected', safe_field: 'ok' }),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((i) => i.message).join(' ');
      expect(messages).toContain('PII field detected');
    }
  });

  it('accepts payload without PII fields', () => {
    const result = EventEnvelopeSchema.safeParse(
      makeEnvelope({ listing_id: 'prop_123', scroll_depth: 75, dwell_ms: 4200 }),
    );
    expect(result.success).toBe(true);
  });

  it('rejects nested PII field', () => {
    const result = EventEnvelopeSchema.safeParse(
      makeEnvelope({ user: { email: 'test@example.com' } }),
    );
    expect(result.success).toBe(false);
  });

  it('rejects PII regardless of separator style', () => {
    for (const variant of ['e_mail', 'e-mail', 'email', 'Email', 'EMAIL']) {
      const result = EventEnvelopeSchema.safeParse(makeEnvelope({ [variant]: 'x' }));
      expect(result.success).toBe(false);
    }
  });
});
