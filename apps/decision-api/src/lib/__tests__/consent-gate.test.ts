/**
 * Unit tests for the consent gate function.
 *
 * Covers all acceptance criteria from TICKET-GDPR-004:
 *   1. consentRequired=true + unknown  → gated
 *   2. consentRequired=true + denied   → gated
 *   3. consentRequired=true + granted  → not gated
 *   4. consentRequired=false + unknown → not gated
 *
 * @module apps/decision-api/src/lib/__tests__/consent-gate.test
 */

import { describe, expect, it } from 'vitest';

import { consentGate } from '../consent-gate.js';

describe('consentGate', () => {
  // AC-1: consent_required=true, consent_state='unknown' → gated
  it('gates when consent is required and state is unknown', () => {
    const result = consentGate({ consentRequired: true, consentState: 'unknown' });
    expect(result.gated).toBe(true);
    expect(result.reason).toBe('consent_required');
  });

  // AC-2: consent_required=true, consent_state='denied' → gated
  it('gates when consent is required and state is denied', () => {
    const result = consentGate({ consentRequired: true, consentState: 'denied' });
    expect(result.gated).toBe(true);
    expect(result.reason).toBe('consent_required');
  });

  // AC-3: consent_required=true, consent_state='granted' → not gated
  it('does not gate when consent is required and state is granted', () => {
    const result = consentGate({ consentRequired: true, consentState: 'granted' });
    expect(result.gated).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  // AC-4: consent_required=false, consent_state='unknown' → not gated
  it('does not gate when consent is not required, regardless of state', () => {
    const result = consentGate({ consentRequired: false, consentState: 'unknown' });
    expect(result.gated).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('does not gate when consent is not required and state is denied', () => {
    const result = consentGate({ consentRequired: false, consentState: 'denied' });
    expect(result.gated).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('does not gate when consent is not required and state is granted', () => {
    const result = consentGate({ consentRequired: false, consentState: 'granted' });
    expect(result.gated).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('returns no reason field when not gated', () => {
    const result = consentGate({ consentRequired: true, consentState: 'granted' });
    // Ensure the result object truly has no 'reason' key (not just undefined)
    expect(Object.prototype.hasOwnProperty.call(result, 'reason')).toBe(false);
  });
});
