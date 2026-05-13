/**
 * A/B holdout assignment — deterministic, consent-aware, fair-housing safe.
 *
 * Implements AC 1–4 from TICKET-AB-001 (Master Design E.3 / E.3.1 / E.3.2).
 *
 * Assignment algorithm:
 *   HMAC-SHA-256(key = tenant_id, message = session_id) → 32-byte digest.
 *   Take first 4 bytes as a big-endian uint32.
 *   holdout = (uint32 / 0xFFFFFFFF) < holdout_pct.
 *
 * Properties:
 *   - Deterministic: same (tenant_id, session_id) → same group on every call.
 *   - Uniform: fraction assigned converges to holdout_pct within ±1pp at N=10,000.
 *   - Fair-housing safe: input is purely (tenant_id, session_id) — no user attributes.
 *   - Idempotent: pure function, no state.
 *
 * @module apps/decision-api/src/lib/ab-assignment
 */

/** Default holdout percentage (10%). */
export const DEFAULT_HOLDOUT_PCT = 0.1 as const;

/**
 * Consent states that require skipping A/B assignment.
 *
 * The existing ConsentStateSchema uses: 'none' | 'session-only' | 'legitimate-interest' | 'consented'.
 * The adapt request also accepts 'opted_out' | 'unknown' for the A/B layer.
 * Any consent state that is NOT 'granted' / 'consented' triggers a skip when the tenant
 * has consent mode enabled.
 */
export const SKIP_CONSENT_STATES = new Set(['opted_out', 'unknown', 'none'] as const);

/**
 * Return value when assignment is skipped due to consent.
 */
export interface AssignmentSkipped {
  readonly skipped: true;
}

/**
 * Return value when assignment succeeds.
 */
export interface AssignmentResult {
  readonly skipped: false;
  /** true = holdout (control), false = treatment. */
  readonly holdout_group: boolean;
  /** holdout_pct used at assignment time. */
  readonly holdout_pct: number;
  /** ISO timestamp of assignment. */
  readonly assigned_at: string;
}

export type AssignmentOutcome = AssignmentSkipped | AssignmentResult;

/**
 * Options for {@link assignHoldout}.
 */
export interface AssignHoldoutOptions {
  /** Tenant UUID. */
  tenant_id: string;
  /** Session fingerprint (32–64 chars). */
  session_id: string;
  /**
   * Consent state from the inbound request.
   * If 'opted_out' | 'unknown' | 'none' AND consent_mode_enabled is true, assignment is skipped.
   */
  consent_state?: string;
  /**
   * Whether the tenant has consent mode enabled.
   * When true, sessions with non-granted consent are skipped.
   * @default false
   */
  consent_mode_enabled?: boolean;
  /**
   * Holdout percentage. Must be in [0, 1].
   * @default DEFAULT_HOLDOUT_PCT (0.10)
   */
  holdout_pct?: number;
}

/**
 * Deterministically assigns a session to the holdout or treatment group using
 * HMAC-SHA-256 keyed on tenant_id with session_id as the message.
 *
 * This function is a pure computation — it does NOT write to any database or
 * emit any events. Callers are responsible for event emission and DB upserts.
 *
 * @param opts - Assignment options.
 * @returns    AssignmentSkipped when consent blocks assignment, AssignmentResult otherwise.
 */
export async function assignHoldout(opts: AssignHoldoutOptions): Promise<AssignmentOutcome> {
  const {
    tenant_id,
    session_id,
    consent_state,
    consent_mode_enabled = false,
    holdout_pct = DEFAULT_HOLDOUT_PCT,
  } = opts;

  // AC-3: Consent-aware skip.
  if (consent_mode_enabled && consent_state !== undefined) {
    if (SKIP_CONSENT_STATES.has(consent_state as 'opted_out' | 'unknown' | 'none')) {
      return { skipped: true };
    }
  }

  // Deterministic hash-based assignment.
  // HMAC-SHA-256 with key=tenant_id, message=session_id.
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(tenant_id),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', keyMaterial, encoder.encode(session_id));

  // Take first 4 bytes as big-endian uint32.
  const view = new DataView(signature);
  const uint32 = view.getUint32(0, false /* big-endian */);
  const ratio = uint32 / 0xffffffff;
  const holdout_group = ratio < holdout_pct;

  return {
    skipped: false,
    holdout_group,
    holdout_pct,
    assigned_at: new Date().toISOString(),
  };
}

/**
 * Two-proportion z-test for regression detection.
 *
 * Returns the two-tailed p-value for the null hypothesis that the two proportions are equal.
 * Uses the normal approximation (valid when n*p and n*(1-p) are both ≥ 5).
 *
 * Used by the regression-detection scheduled job to determine whether adaptation should be
 * auto-paused for an archetype.
 *
 * @param conversions_a - Number of conversions in group A (treatment).
 * @param n_a           - Total sessions in group A.
 * @param conversions_b - Number of conversions in group B (holdout).
 * @param n_b           - Total sessions in group B.
 * @returns             Two-tailed p-value in [0, 1].
 */
export function twoProportionZTestPValue(
  conversions_a: number,
  n_a: number,
  conversions_b: number,
  n_b: number,
): number {
  if (n_a === 0 || n_b === 0) return 1;

  const p_a = conversions_a / n_a;
  const p_b = conversions_b / n_b;
  const p_pool = (conversions_a + conversions_b) / (n_a + n_b);

  const denom = Math.sqrt(p_pool * (1 - p_pool) * (1 / n_a + 1 / n_b));
  if (denom === 0) return 1;

  const z = Math.abs(p_a - p_b) / denom;

  // Two-tailed p-value via complementary error function approximation.
  // Uses the Abramowitz and Stegun approximation for erfc(x).
  const p = 2 * (1 - standardNormalCdf(z));
  return Math.max(0, Math.min(1, p));
}

/**
 * Standard normal CDF via Horner's method approximation (A&S 26.2.17).
 * Error < 7.5e-8 for all x.
 */
function standardNormalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.398942282 * Math.exp((-x * x) / 2);
  const p =
    d * t * (0.3193815 + t * (-0.3565638 + t * (1.7814779 + t * (-1.821256 + t * 1.3302745))));
  return x > 0 ? 1 - p : p;
}

/**
 * Minimum sessions per arm required before regression detection fires.
 * AC-7: must be ≥ 200 sessions per arm.
 */
export const REGRESSION_MIN_SESSIONS_PER_ARM = 200 as const;

/**
 * P-value threshold for regression detection.
 * AC-7: p < 0.05.
 */
export const REGRESSION_P_VALUE_THRESHOLD = 0.05 as const;

/**
 * Determines whether regression detection should auto-pause adaptation for an archetype.
 *
 * Returns true if the treatment group has a statistically significant NEGATIVE delta
 * on a conversion metric compared to the holdout group.
 *
 * @param treatmentConversions - Conversion count in treatment group.
 * @param treatmentSessions    - Total sessions in treatment group.
 * @param holdoutConversions   - Conversion count in holdout group.
 * @param holdoutSessions      - Total sessions in holdout group.
 * @returns                    true = should pause, false = continue.
 */
export function shouldAutoPause(
  treatmentConversions: number,
  treatmentSessions: number,
  holdoutConversions: number,
  holdoutSessions: number,
): boolean {
  // Must have minimum sessions per arm.
  if (
    treatmentSessions < REGRESSION_MIN_SESSIONS_PER_ARM ||
    holdoutSessions < REGRESSION_MIN_SESSIONS_PER_ARM
  ) {
    return false;
  }

  const treatmentRate = treatmentConversions / treatmentSessions;
  const holdoutRate = holdoutConversions / holdoutSessions;

  // Only pause if treatment is WORSE than holdout (negative delta).
  if (treatmentRate >= holdoutRate) return false;

  const pValue = twoProportionZTestPValue(
    treatmentConversions,
    treatmentSessions,
    holdoutConversions,
    holdoutSessions,
  );

  return pValue < REGRESSION_P_VALUE_THRESHOLD;
}
