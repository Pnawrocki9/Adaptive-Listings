/**
 * DSR OTP helpers — generate, hash, and verify 6-digit one-time passwords for
 * Data Subject Rights request verification.
 *
 * Security notes (FOLLOW-455 / audit F-20):
 *   - The raw OTP is NEVER stored. Only its SHA-256 hash is persisted in the DB.
 *   - `verifyOtp()` uses timingSafeEqual from Node crypto to prevent timing attacks.
 *   - `generateOtp()` uses `randomInt` from `node:crypto` — a CSPRNG — instead of
 *     `Math.random()` (which is NOT cryptographically secure and must never be
 *     used to generate an authentication secret). See
 *     `apps/control-plane/src/lib/dsr-verify.ts` for the request-scoped lookup +
 *     attempt-cap/lockout that close the remaining brute-force surface.
 *
 * @module apps/control-plane/src/lib/dsr-otp
 */

import { createHash, randomInt, timingSafeEqual } from 'crypto';

/**
 * Generate a 6-digit OTP string, zero-padded (e.g. '042813').
 *
 * Uses `crypto.randomInt` (CSPRNG) — NOT `Math.random()` — because this value
 * is an authentication secret (FOLLOW-455 / audit F-20).
 *
 * @returns A string of exactly 6 decimal digits.
 */
export function generateOtp(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

/**
 * SHA-256 hash the given OTP.
 * Store this hash in the DB — never the raw OTP.
 *
 * @param otp - The 6-digit OTP string.
 * @returns A 64-character lowercase hex string.
 */
export function hashOtp(otp: string): string {
  return createHash('sha256').update(otp).digest('hex');
}

/**
 * Verify a submitted OTP against a stored hash.
 *
 * Uses a Buffer comparison that avoids branching on content to mitigate timing attacks.
 *
 * @param otp  - The OTP submitted by the user.
 * @param hash - The SHA-256 hash stored in the DB.
 * @returns `true` if the OTP matches the stored hash, `false` otherwise.
 */
export function verifyOtp(otp: string, hash: string): boolean {
  const computedHash = hashOtp(otp);
  const a = Buffer.from(computedHash, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
