/**
 * A/B holdout assignment — shared implementation for use in packages that cannot
 * import from apps/decision-api directly (e.g. apps/control-plane).
 *
 * Canonical logic lives in apps/decision-api/src/lib/ab-assignment.ts.
 * This module is a verbatim copy of the pure-computation exports so that
 * the control-plane can share the same algorithm without cross-app imports.
 *
 * DO NOT add side-effects here. This module is a pure-function library.
 * Any change to assignment logic MUST be applied to both this file and
 * apps/decision-api/src/lib/ab-assignment.ts simultaneously.
 *
 * @module @estalara/shared/ab-holdout
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
  /**
   * Server-side secret the assignment HMAC is keyed on. [FOLLOW-1201 / audit SEC-4]
   *
   * REQUIRED, ≥ {@link MIN_ASSIGNMENT_SECRET_LENGTH} chars, and NEVER a value present on the
   * page. Before FOLLOW-1201 the key was `tenant_id`, which the SDK exposes in
   * `script.dataset.tenantId`, so anyone could grind `session_id`s into the adapted arm offline
   * and convert only those. The control plane derives this from `HOLDOUT_ASSIGNMENT_SECRET`
   * (`apps/control-plane/src/lib/holdout-config.ts`); rotating it re-buckets every session.
   */
  assignment_secret: string;
}

/** Shortest `assignment_secret` accepted. The control plane enforces 32 on the env var. */
export const MIN_ASSIGNMENT_SECRET_LENGTH = 16;

/**
 * Deterministically assigns a session to the holdout or treatment group using
 * HMAC-SHA-256 keyed on a server-side secret over (tenant_id, session_id).
 *
 * This function is a pure computation — it does NOT write to any database or
 * emit any events. Callers are responsible for event emission and DB upserts.
 *
 * Algorithm:
 *   HMAC-SHA-256(key = assignment_secret, message = tenant_id + "\n" + session_id) → 32 bytes.
 *   Take first 4 bytes as a big-endian uint32.
 *   holdout = (uint32 / 0xFFFFFFFF) < holdout_pct.
 *
 * Properties:
 *   - Deterministic: same (secret, tenant_id, session_id) → same group on every call.
 *   - Uniform: fraction assigned converges to holdout_pct within ±1pp at N=10,000.
 *   - Fair-housing safe: input is purely (tenant_id, session_id) — no user attributes.
 *   - Unpredictable without the secret: `ab-holdout.test.ts` runs the pre-FOLLOW-1201 public
 *     algorithm as an offline grinder and shows its predictions land at chance.
 *   - Idempotent: pure function, no state.
 *
 * @param opts - Assignment options.
 * @returns    AssignmentSkipped when consent blocks assignment, AssignmentResult otherwise.
 * @throws     When `assignment_secret` is missing or too short — never falls back to public keying.
 */
export async function assignHoldout(opts: AssignHoldoutOptions): Promise<AssignmentOutcome> {
  const {
    tenant_id,
    session_id,
    consent_state,
    consent_mode_enabled = false,
    holdout_pct = DEFAULT_HOLDOUT_PCT,
    assignment_secret,
  } = opts;

  if (
    typeof assignment_secret !== 'string' ||
    assignment_secret.length < MIN_ASSIGNMENT_SECRET_LENGTH
  ) {
    throw new Error(
      `assignHoldout: assignment_secret is required (>= ${String(MIN_ASSIGNMENT_SECRET_LENGTH)} chars) — ` +
        'the arm must never be keyed on a page-visible value [FOLLOW-1201]',
    );
  }

  // Consent-aware skip.
  if (consent_mode_enabled && consent_state !== undefined) {
    if (SKIP_CONSENT_STATES.has(consent_state as 'opted_out' | 'unknown' | 'none')) {
      return { skipped: true };
    }
  }

  // Deterministic hash-based assignment.
  // HMAC-SHA-256 with key=assignment_secret, message=tenant_id\nsession_id.
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(assignment_secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    'HMAC',
    keyMaterial,
    encoder.encode(`${tenant_id}\n${session_id}`),
  );

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
