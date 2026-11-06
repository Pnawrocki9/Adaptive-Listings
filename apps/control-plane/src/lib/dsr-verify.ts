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
 *   4. **The cap is enforced in the UPDATE, not in a prior read** (FOLLOW-1308, Codex R-02). A
 *      wrong guess increments only `WHERE attempt_count < MAX_OTP_ATTEMPTS`; a guess whose
 *      increment matched no row is `locked`. A correct guess re-checks the cap with a guarded
 *      UPDATE before it resolves, and the consume carries the same guard. Before this, every
 *      parallel guess read the count first, so eight parallel wrong codes left `attempt_count = 8`
 *      against a cap of 5 and a correct code in the same burst still succeeded.
 *
 * @module apps/control-plane/src/lib/dsr-verify
 */

import { and, eq, isNull, lt, sql } from 'drizzle-orm';
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
 * Verify a submitted `(requestId, token)` pair for the given DSR capability: lockout, used,
 * expired, the code, and the attempt counter on a wrong code. The request stays unspent until
 * {@link consumeVerifiedOtp}, so every route spends it only once its work is done and a failure
 * can be retried with the same code (FOLLOW-1316: erase; FOLLOW-1308: access and portability,
 * which spend it only on a complete export). FOLLOW-1308 removed the combined
 * `verifyAndConsumeOtp`, whose last callers were those two routes.
 *
 * @param db - Admin Drizzle client (RLS-bypassing; OTP possession is the authorisation mechanism
 *   for these routes).
 * @param args.requestId - The `request_id` returned by `POST /api/dsr/initiate`.
 * @param args.token - The 6-digit OTP submitted by the caller.
 * @param args.dsrType - The capability this route serves ('access' | 'erase' | 'portability').
 */
export async function verifyOtpWithoutConsuming(
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
    // Atomically take one guess from the budget. Guarded on used_at IS NULL so a losing racer's
    // increment never touches a consumed request, and on attempt_count < cap so a burst of
    // parallel guesses can never take the counter past the cap (FOLLOW-1308, R-02).
    const counted = await db
      .update(dsrVerifications)
      .set({ attemptCount: sql`${dsrVerifications.attemptCount} + 1` })
      .where(underCapAndUnused(args.requestId))
      .returning({ id: dsrVerifications.id });
    return { ok: false, reason: counted.length > 0 ? 'invalid_code' : 'locked' };
  }

  // The resolving step re-checks the cap against the row as it is NOW: the row lock orders this
  // UPDATE after any concurrent increment, so a correct code that arrives behind the guesses that
  // exhausted the budget is refused (FOLLOW-1308, R-02). It changes nothing (`id = id`).
  const stillOpen = await db
    .update(dsrVerifications)
    .set({ id: sql`${dsrVerifications.id}` })
    .where(underCapAndUnused(args.requestId))
    .returning({ id: dsrVerifications.id });
  if (stillOpen.length === 0) {
    return { ok: false, reason: 'locked' };
  }

  return { ok: true, record };
}

/** The request is unspent and has guesses left. */
function underCapAndUnused(requestId: string): ReturnType<typeof and> {
  return and(
    eq(dsrVerifications.id, requestId),
    isNull(dsrVerifications.usedAt),
    lt(dsrVerifications.attemptCount, MAX_OTP_ATTEMPTS),
  );
}

/**
 * Atomically mark a verified request consumed. Inside a transaction, a rollback leaves it unspent.
 *
 * @param db - The admin client or a transaction on it.
 * @param requestId - The verified request.
 * @returns false when another request consumed it first (WHERE used_at IS NULL guards against two
 *   concurrent requests that both passed the used_at check in verification), or when the request
 *   was locked in the meantime (the same cap guard as a wrong guess, FOLLOW-1308).
 */
export async function consumeVerifiedOtp(
  db: Pick<ReturnType<typeof createAdminClient>, 'update'>,
  requestId: string,
): Promise<boolean> {
  const consumed = await db
    .update(dsrVerifications)
    .set({ usedAt: new Date() })
    .where(underCapAndUnused(requestId))
    .returning({ id: dsrVerifications.id });
  return consumed.length > 0;
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
