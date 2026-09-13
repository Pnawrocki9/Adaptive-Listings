/**
 * Server-side holdout configuration for `/api/adapt` — the two values a caller must never choose.
 * [FOLLOW-1201 / audit SEC-4, absorbs FOLLOW-1102]
 *
 * 1. `HOLDOUT_ASSIGNMENT_SECRET` — the HMAC key `assignHoldout()` buckets sessions with. Before
 *    FOLLOW-1201 the key was the public `tenant_id`, so the arm was computable offline by anyone
 *    holding the page. REQUIRED: a missing secret is a 500 (`holdout_secret_unconfigured`), never a
 *    silent fallback to public keying — Rule K.2, "configured but failed" and "not configured"
 *    both fail loud here because there is no safe default for a key.
 *    Rotation re-buckets every session; do it only at a measurement-window boundary (ESC-079).
 *
 * 2. `HOLDOUT_PCT` — the configured assignment rate. Before FOLLOW-1201 `body.holdout_pct` was
 *    persisted as if it were configuration (FOLLOW-1102). Unset → `DEFAULT_HOLDOUT_PCT`; set but
 *    not a number in [0, 1] → throws (`holdout_config_invalid`), because a typo that silently
 *    became 0.1 would change the experiment without anyone seeing it. The single-tenant pilot
 *    (memory: one tenant, clients are re-brands) makes an env var THE tenant's configuration; a
 *    per-tenant `tenants.holdout_pct` column is the upgrade path (deferred, see PR body).
 *
 * @module apps/control-plane/src/lib/holdout-config
 */

import { DEFAULT_HOLDOUT_PCT } from '@estalara/shared';

/** Shortest accepted `HOLDOUT_ASSIGNMENT_SECRET`. 32 chars of a CSPRNG-derived string. */
const MIN_HOLDOUT_SECRET_LENGTH = 32;

export class HoldoutSecretMissingError extends Error {
  constructor() {
    super(
      `HOLDOUT_ASSIGNMENT_SECRET is unset or shorter than ${String(MIN_HOLDOUT_SECRET_LENGTH)} chars — ` +
        'holdout assignment refuses to run keyed on a public value [FOLLOW-1201]',
    );
    this.name = 'HoldoutSecretMissingError';
  }
}

export class HoldoutPctInvalidError extends Error {
  constructor(raw: string) {
    super(`HOLDOUT_PCT must be a number in [0, 1]; got ${JSON.stringify(raw)} [FOLLOW-1201]`);
    this.name = 'HoldoutPctInvalidError';
  }
}

/** The assignment secret, or throws {@link HoldoutSecretMissingError}. */
export function getHoldoutAssignmentSecret(): string {
  const secret = process.env.HOLDOUT_ASSIGNMENT_SECRET ?? '';
  if (secret.length < MIN_HOLDOUT_SECRET_LENGTH) throw new HoldoutSecretMissingError();
  return secret;
}

/** The configured holdout rate, or throws {@link HoldoutPctInvalidError}. */
export function getConfiguredHoldoutPct(): number {
  const raw = process.env.HOLDOUT_PCT;
  if (raw === undefined || raw.trim() === '') return DEFAULT_HOLDOUT_PCT;
  const pct = Number(raw);
  if (!Number.isFinite(pct) || pct < 0 || pct > 1) throw new HoldoutPctInvalidError(raw);
  return pct;
}
