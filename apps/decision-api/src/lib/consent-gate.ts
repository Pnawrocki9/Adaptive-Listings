/**
 * Consent gate — blocks personalization when the tenant requires consent
 * and the session has not explicitly granted it.
 *
 * This is a pure function with no I/O side effects. It is invoked early in
 * the adapt route before A/B assignment and archetype detection, so that
 * un-consented sessions never receive personalized directives regardless of
 * their A/B group.
 *
 * The existing A/B consent skip in ab-assignment.ts (TICKET-AB-001) remains
 * unchanged. Both checks apply independently:
 *   - ab-assignment skips assignment for 'opted_out'/'unknown'/'none' states
 *   - consentGate blocks personalization for any non-'granted' state when
 *     the tenant has consent_required = true
 *
 * @module apps/decision-api/src/lib/consent-gate
 */

/**
 * Valid consent state values accepted by the Decision API.
 *
 * 'granted'  — user has explicitly consented; personalization is permitted.
 * 'denied'   — user has explicitly denied consent; no personalization.
 * 'unknown'  — no consent signal received (default for callers that omit the
 *              field); treated as non-granted for conservative compliance.
 */
export type ConsentState = 'granted' | 'denied' | 'unknown';

/**
 * Input to the consent gate check.
 */
export interface ConsentGateInput {
  /**
   * Whether the tenant requires explicit consent before personalization.
   * When false the gate is always open (non-GDPR tenant opt-out).
   */
  consentRequired: boolean;
  /**
   * Consent state from the inbound request.
   */
  consentState: ConsentState;
}

/**
 * Result of the consent gate check.
 */
export interface ConsentGateResult {
  /**
   * true = session is gated; return neutral directives, do not personalize.
   * false = session may proceed through normal personalization flow.
   */
  gated: boolean;
  /**
   * Machine-readable reason when gated. Used for ClickHouse gate_reason column
   * and observability tagging. Absent when gated = false.
   */
  reason?: 'consent_required';
}

/**
 * Determines whether a session should be gated from personalization.
 *
 * Gate fires when:
 *   tenant.consent_required is true
 *   AND consent_state is NOT 'granted'
 *
 * @param input - Gate input containing tenant consent flag and session consent state.
 * @returns     ConsentGateResult — { gated: false } or { gated: true, reason: 'consent_required' }
 *
 * @example
 * // EU tenant, no consent signal
 * consentGate({ consentRequired: true, consentState: 'unknown' })
 * // → { gated: true, reason: 'consent_required' }
 *
 * @example
 * // US tenant, consent not required
 * consentGate({ consentRequired: false, consentState: 'unknown' })
 * // → { gated: false }
 */
export function consentGate(input: ConsentGateInput): ConsentGateResult {
  if (input.consentRequired && input.consentState !== 'granted') {
    return { gated: true, reason: 'consent_required' };
  }
  return { gated: false };
}
