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
  /**
   * Per-user profiling opt-out flag (FOLLOW-372 / Master Design §H.9).
   *
   * When `true` the user has suspended AL DOM adaptation for their account only.
   * The gate returns neutral directives and suppresses variant logging.
   *
   * Scope: AL-DOM only — this flag does NOT affect app.estalara.com
   * buying-intent identification, lead ranking, or agent-facing chat summaries.
   * Those processing purposes are covered by the mandatory registration consent
   * (§H.8) and are outside this flag's scope.
   *
   * ── Status note (RETRO-103 HW-2 / FOLLOW-383) ──────────────────────────────
   * `apps/decision-api` currently returns **410 Gone** for all POST /api/adapt
   * requests (ADR-0006 Phase 1 retirement, since 2026-05-25). While the Worker is
   * in this retired state, `consentGate.profilingOptOut` is NOT evaluated by any
   * production request path in this package.
   *
   * The **active enforcement point** for `profilingOptOut` is:
   *   `apps/control-plane/src/app/api/adapt/route.ts` — GET /api/adapt handler
   *   (FOLLOW-372, PR #337). That handler reads `profiling_opt_out=1` from the
   *   query string and gates the session before any adaptation logic runs.
   *
   * This field and its gate logic are intentionally preserved here so that:
   *   1. The canonical `ConsentGateInput` interface remains the single source of
   *      truth for the opt-out contract (imported by consumers via this module).
   *   2. The implementation and tests are immediately available when decision-api
   *      is revived as a canonical gate (FOLLOW-107 Phase 2 decision point).
   *
   * Do not remove without FOLLOW-107 sign-off.
   * ────────────────────────────────────────────────────────────────────────────
   *
   * Optional — defaults to `false` (opted in) when absent.
   */
  profilingOptOut?: boolean;
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
  reason?: 'consent_required' | 'profiling_opt_out';
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
 *
 * @example
 * // User opted out of AL DOM adaptation (FOLLOW-372)
 * consentGate({ consentRequired: true, consentState: 'granted', profilingOptOut: true })
 * // → { gated: true, reason: 'profiling_opt_out' }
 */
export function consentGate(input: ConsentGateInput): ConsentGateResult {
  // Consent-required gate takes priority over opt-out (belt-and-suspenders).
  if (input.consentRequired && input.consentState !== 'granted') {
    return { gated: true, reason: 'consent_required' };
  }
  // FOLLOW-372 / §H.9: Per-user AL-DOM opt-out.
  // Returns neutral directives; does NOT affect app.estalara.com buying-intent /
  // lead-ranking / agent chat-summary processing (those are outside AL's scope here).
  if (input.profilingOptOut === true) {
    return { gated: true, reason: 'profiling_opt_out' };
  }
  return { gated: false };
}
