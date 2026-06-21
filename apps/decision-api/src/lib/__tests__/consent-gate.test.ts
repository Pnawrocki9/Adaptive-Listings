/**
 * Unit tests for the consent gate function.
 *
 * Covers all acceptance criteria from TICKET-GDPR-004:
 *   1. consentRequired=true + unknown  → gated
 *   2. consentRequired=true + denied   → gated
 *   3. consentRequired=true + granted  → not gated
 *   4. consentRequired=false + unknown → not gated
 *
 * FOLLOW-372 additions — profilingOptOut flag:
 *   5. profilingOptOut=true + granted  → gated (reason: profiling_opt_out)
 *   6. profilingOptOut=false + granted → not gated
 *   7. profilingOptOut=true + denied   → gated (consent_required takes priority)
 *   8. app.estalara.com buying-intent / lead-ranking / chat-summaries NOT gated by
 *      this flag (asserted by boundary docs + profilingOptOut absence → gated:false)
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

  // ─── FOLLOW-372: profilingOptOut (per-user AL-DOM opt-out) ───────────────────

  // AC-5: profilingOptOut=true, consent granted → gated with profiling_opt_out reason
  it('gates when profilingOptOut is true and consent is granted', () => {
    const result = consentGate({
      consentRequired: true,
      consentState: 'granted',
      profilingOptOut: true,
    });
    expect(result.gated).toBe(true);
    expect(result.reason).toBe('profiling_opt_out');
  });

  // AC-6: profilingOptOut=false, consent granted → not gated (adaptation resumes)
  it('does not gate when profilingOptOut is false and consent is granted', () => {
    const result = consentGate({
      consentRequired: true,
      consentState: 'granted',
      profilingOptOut: false,
    });
    expect(result.gated).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  // AC-7: profilingOptOut=true + denied → consent_required takes priority (belt-and-suspenders)
  it('returns consent_required reason when both consent denied and profilingOptOut true', () => {
    const result = consentGate({
      consentRequired: true,
      consentState: 'denied',
      profilingOptOut: true,
    });
    expect(result.gated).toBe(true);
    expect(result.reason).toBe('consent_required');
  });

  // AC-8 (boundary assertion): profilingOptOut absent → behaves identically to false (no gate).
  // app.estalara.com buying-intent / lead-ranking / agent chat-summary callers omit this field;
  // the gate must not block them. (Those purposes ride §H.8 registration consent, not this gate.)
  it('does not gate when profilingOptOut is absent (boundary: non-AL callers unaffected)', () => {
    const result = consentGate({ consentRequired: true, consentState: 'granted' });
    expect(result.gated).toBe(false);
  });

  // AC-8b: profilingOptOut=true on a non-consent-required tenant → still gated (opt-out applies)
  it('gates with profiling_opt_out even when consentRequired=false', () => {
    const result = consentGate({
      consentRequired: false,
      consentState: 'unknown',
      profilingOptOut: true,
    });
    expect(result.gated).toBe(true);
    expect(result.reason).toBe('profiling_opt_out');
  });

  // Variant log: neutral directives on opt-out (no variant log).
  // This is an integration concern; the unit assertion is that gated=true is returned
  // which makes the adapt route skip variant logging (verified in adapt route tests).
  it('returns gated:true for profilingOptOut to suppress variant logging', () => {
    const result = consentGate({
      consentRequired: false,
      consentState: 'granted',
      profilingOptOut: true,
    });
    expect(result.gated).toBe(true);
    expect(result.reason).toBe('profiling_opt_out');
  });
});
