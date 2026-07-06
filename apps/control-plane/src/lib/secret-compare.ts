/**
 * Constant-time shared-secret comparison for internal/webhook/admin auth checks.
 *
 * Extracted so the same fail-closed, constant-time comparison is used by every
 * route that gates on a single shared-secret env var (FOLLOW-456 / audit F-13):
 * `/api/tenants` (`ADMIN_API_SECRET`), `/api/webhooks/listing-updated`
 * (`LISTING_UPDATED_WEBHOOK_SECRET`), `/api/internal/description-cache`
 * (`DESCRIPTION_CACHE_INTERNAL_SECRET`), and `/api/internal/schema`
 * (`SCHEMA_API_TOKEN`, FOLLOW-490).
 *
 * Both values are SHA-256 hashed before comparison so the two buffers passed to
 * `crypto.timingSafeEqual` always have the same fixed length (32 bytes) —
 * `timingSafeEqual` throws on a length mismatch, and a raw-value length check
 * would itself leak a timing/length signal about the caller-provided secret.
 * Hashing first removes both problems at once. Mirrors the existing pattern in
 * `dsr-otp.ts#verifyOtp`, `tracer-auth.ts#verifyTracerAdminAuth`, and
 * `api/v1/consent/platform-registration/route.ts#verifyHmacSignature`.
 *
 * @module apps/control-plane/src/lib/secret-compare
 */

import { createHash, timingSafeEqual } from 'crypto';

/**
 * Returns true iff `provided` matches `expected`, via a constant-time compare
 * of their SHA-256 digests.
 */
export function secretEquals(expected: string, provided: string): boolean {
  const expectedHash = createHash('sha256').update(expected, 'utf8').digest();
  const providedHash = createHash('sha256').update(provided, 'utf8').digest();
  return timingSafeEqual(expectedHash, providedHash);
}
