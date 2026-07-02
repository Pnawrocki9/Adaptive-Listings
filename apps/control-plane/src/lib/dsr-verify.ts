/**
 * Request-scoped DSR OTP verification (FOLLOW-455 / audit F-20).
 *
 * Before this module, every DSR capability route (`access`, `erase`,
 * `portability`) looked a submitted OTP up **globally**:
 *
 *   SELECT * FROM dsr_verifications WHERE otp_hash = hash(token) AND dsr_type = X
 *
 * That is a global-by-hash lookup — any 6-digit guess is checked against
 * every pending verification row for every tenant. Combined with
 * `Math.random()` (non-cryptographic) and no attempt cap or lockout, a
 * 6-digit code (1e6 space) was brute-forceable across tenants: an attacker
 * did not need to know WHICH request they were attacking, only that SOME
 * pending request existed somewhere with a matching hash.
 *
 * This module closes that gap:
 *
 *   1. **Request-scoped lookup** — the caller must supply the `request_id`
 *      returned by `POST /api/dsr/initiate` (a 128-bit random UUID) in
 *      addition to the OTP. The lookup is `WHERE id = request_id AND
 *      dsr_type = X` — a single specific row, not a global hash scan. An
 *      attacker who does not already know a specific `request_id` cannot
 *      brute-force ANY other data subject's request, because guessing a
 *      valid UUID is computationally infeasible.
 *   2. **Per-capability attempt cap + lockout** — `attempt_count` on that
 *      SPECIFIC row is incremented atomically on every wrong guess. Once it
 *      reaches `MAX_OTP_ATTEMPTS`, the row is permanently locked — the
 *      6-digit space (1e6) is never fully searchable for a single request.
 *   3. **Atomic mark-used** — the success path issues a single
 *      `UPDATE ... WHERE id = X AND used_at IS NULL RETURNING *`. If a
 *      concurrent request already consumed the token, zero rows are
 *      returned and this call safely reports `already_used` instead of a
 *      double-erasure race.
 *
 * @module apps/control-plane/src/lib/dsr-verify
 */

import { and, eq, isNull, sql } from 'drizzle-orm';
import { dsrVerifications } from '@estalara/db';
import type { DsrVerification, createAdminClient } from '@estalara/db';
import { verifyOtp } from '@/lib/dsr-otp';

/**
 * Maximum number of wrong-code guesses accepted against a single DSR
 * request before the row is locked. At 5 attempts, the probability of
 * guessing a uniformly-random 6-digit code is 5 / 1,000,000 = 0.0005%.
 */
export const MAX_OTP_ATTEMPTS = 5;

export type DsrCapability = 'access' | 'erase' | 'portability';

export type DsrVerifyFailureReason =
  | 'not_found'
  | 'expired'
  | 'already_used'
  | 'locked'
  | 'invalid_code';

export type DsrVerifyResult =
  | { ok: true; record: DsrVerification }
  | { ok: false; reason: DsrVerifyFailureReason };

/**
 * Verify a submitted `(requestId, token)` pair for the given DSR capability
 * and, on success, atomically mark the request consumed.
 *
 * @param db - Admin Drizzle client (RLS-bypassing; OTP possession is the
 *   authorisation mechanism for these routes, mirroring pre-existing DSR
 *   route auth model).
 * @param args.requestId - The `request_id` returned by `POST /api/dsr/initiate`.
 * @param args.token - The 6-digit OTP submitted by the caller.
 * @param args.dsrType - The capability this route serves ('access' | 'erase' | 'portability').
 */
export async function verifyAndConsumeOtp(
  db: ReturnType<typeof createAdminClient>,
  args: { requestId: string; token: string; dsrType: DsrCapability },
): Promise<DsrVerifyResult> {
  const [record] = await db
    .select()
    .from(dsrVerifications)
    .where(and(eq(dsrVerifications.id, args.requestId), eq(dsrVerifications.dsrType, args.dsrType)))
    .limit(1);

  if (!record) {
    return { ok: false, reason: 'not_found' };
  }

  // Lockout check first — a locked row must never disclose expired/used/
  // invalid_code distinctions to an attacker who has exhausted their guesses.
  if (record.attemptCount >= MAX_OTP_ATTEMPTS) {
    return { ok: false, reason: 'locked' };
  }

  if (record.usedAt !== null) {
    return { ok: false, reason: 'already_used' };
  }

  if (record.expiresAt < new Date()) {
    return { ok: false, reason: 'expired' };
  }

  const matches = verifyOtp(args.token, record.otpHash);

  if (!matches) {
    // Atomically increment the attempt counter, guarded on used_at IS NULL so
    // a losing racer's failed-guess increment can never clobber a concurrent
    // successful verification's state.
    await db
      .update(dsrVerifications)
      .set({ attemptCount: sql`${dsrVerifications.attemptCount} + 1` })
      .where(and(eq(dsrVerifications.id, args.requestId), isNull(dsrVerifications.usedAt)));
    return { ok: false, reason: 'invalid_code' };
  }

  // Atomic mark-used: WHERE used_at IS NULL guards against a race where two
  // concurrent requests both passed the used_at check above.
  const [consumed] = await db
    .update(dsrVerifications)
    .set({ usedAt: new Date() })
    .where(and(eq(dsrVerifications.id, args.requestId), isNull(dsrVerifications.usedAt)))
    .returning();

  if (!consumed) {
    // Lost the race — another request already consumed this token between
    // our SELECT and our UPDATE.
    return { ok: false, reason: 'already_used' };
  }

  return { ok: true, record: consumed };
}

/**
 * Map a {@link DsrVerifyFailureReason} to the HTTP status + wire error code
 * the DSR routes have historically returned, extended with the two new
 * FOLLOW-455 reasons.
 */
export function dsrVerifyFailureResponse(reason: DsrVerifyFailureReason): {
  status: number;
  code: string;
  message: string;
} {
  switch (reason) {
    case 'not_found':
      return { status: 404, code: 'NOT_FOUND', message: 'Request not found or invalid type' };
    case 'expired':
      return {
        status: 401,
        code: 'token_expired',
        message: 'This token has expired. Please request a new one.',
      };
    case 'already_used':
      return {
        status: 401,
        code: 'token_already_used',
        message: 'This token has already been used.',
      };
    case 'locked':
      return {
        status: 429,
        code: 'too_many_attempts',
        message: 'Too many incorrect attempts. Please initiate a new request.',
      };
    case 'invalid_code':
      return { status: 401, code: 'invalid_code', message: 'The submitted code is incorrect.' };
  }
}
