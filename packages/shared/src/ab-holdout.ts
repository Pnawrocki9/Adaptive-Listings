/**
 * A/B holdout assignment — shared implementation (e.g. for apps/control-plane).
 *
 * This module is the only copy of the assignment logic. It began as a verbatim copy
 * of the retired Decision API Worker's `ab-assignment.ts`; that Worker was removed
 * 2026-09-24 by FOLLOW-1262 (ADR-0006), so there is no second copy to keep in sync.
 *
 * DO NOT add side-effects here. This module is a pure-function library.
 *
 * @module @estalara/shared/ab-holdout
 */

/** Default holdout percentage (10%). */
export const DEFAULT_HOLDOUT_PCT = 0.1 as const;

/**
 * The one consent state under which a session is assigned an arm [FOLLOW-1465, ESC-091 C-1].
 *
 * The holdout, and the decision row that carries its arm, rest on consent only (CEO 2026-11-03).
 * `consented` is what the SDK sends after the banner's grant (`mapConsentState`), and the only value
 * `honourConsentedXid` and `/api/quiz/run` accept. Any other value, and an absent one, is skipped:
 * fail closed. Before FOLLOW-1465 only `opted_out` / `unknown` / `none` were skipped, and only under
 * a caller-sent `consent_mode_enabled` that no SDK sends (record H-13).
 */
const ASSIGNABLE_CONSENT_STATE = 'consented';

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
   * The id to key the arm on instead of `session_id`: a consented, validated xid, so one returning
   * buyer keeps one arm across sessions (FOLLOW-1316, ESC-090 item 2). Absent = keyed per session.
   * Denominators stay per session, so rows of one xid are correlated (MASTER_DESIGN "Decision #5").
   */
  assignment_unit_id?: string;
  /**
   * Consent state from the inbound request. Required, so no caller can leave it out by accident:
   * anything but `consented`, `undefined` included, skips assignment [FOLLOW-1465].
   */
  consent_state: string | undefined;
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
 *   HMAC-SHA-256(key = assignment_secret, message = tenant_id + "\n" + unit) → 32 bytes, where unit
 *   is `assignment_unit_id` when given, else `session_id`.
 *   Take first 4 bytes as a big-endian uint32.
 *   holdout = (uint32 / 0xFFFFFFFF) < holdout_pct.
 *
 * Properties:
 *   - Deterministic: same (secret, tenant_id, session_id) → same group on every call.
 *   - Uniform: fraction assigned converges to holdout_pct within ±1pp at N=10,000.
 *   - Fair-housing safe: input is purely (tenant_id, unit id) — no user attributes.
 *   - Unpredictable without the secret: `ab-holdout.test.ts` runs the pre-FOLLOW-1201 public
 *     algorithm as an offline grinder and shows its predictions land at chance.
 *   - Idempotent: pure function, no state.
 *
 * @param opts - Assignment options.
 * @returns    AssignmentSkipped unless `consent_state` is `consented`, AssignmentResult otherwise.
 * @throws     When `assignment_secret` is missing or too short — never falls back to public keying.
 */
export async function assignHoldout(opts: AssignHoldoutOptions): Promise<AssignmentOutcome> {
  const {
    tenant_id,
    session_id,
    assignment_unit_id,
    consent_state,
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

  // Consent only (ESC-091 C-1): no arm without `consented` [FOLLOW-1465].
  if (consent_state !== ASSIGNABLE_CONSENT_STATE) {
    return { skipped: true };
  }

  // Deterministic hash-based assignment.
  // HMAC-SHA-256 with key=assignment_secret, message=tenant_id\nunit.
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
    encoder.encode(`${tenant_id}\n${assignment_unit_id ?? session_id}`),
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
