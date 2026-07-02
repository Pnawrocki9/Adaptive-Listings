/**
 * Anti email-bomb rate limiting for POST /api/dsr/initiate (FOLLOW-455 / audit F-20).
 *
 * Without a limit, `POST /api/dsr/initiate` sends one OTP email per request —
 * an attacker who knows (or enumerates) a valid `session_id` could spam a
 * data subject's inbox indefinitely, or use the endpoint as a free email
 * relay.
 *
 * Reuses the existing `dsr_verifications` Postgres table (already the
 * source of truth for pending/consumed requests) instead of introducing a
 * new store — per FOLLOW-455 scope note, a new external store (e.g. a new
 * Upstash/Redis dependency) requires an ESCALATIONS.md entry; counting rows
 * already being written to an existing table does not.
 *
 * @module apps/control-plane/src/lib/dsr-rate-limit
 */

import { and, eq, gte, sql } from 'drizzle-orm';
import type { createAdminClient } from '@estalara/db';
import { dsrVerifications } from '@estalara/db';

/** Rolling window over which initiate attempts are counted. */
export const INITIATE_RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

/**
 * Maximum number of DSR-initiate requests (any dsr_type combined) accepted
 * for a single (tenant_id, email) pair within the rolling window. A
 * legitimate data subject or tenant admin retrying a lost email should
 * comfortably fit within this; a scripted email-bomb will not.
 */
export const INITIATE_RATE_LIMIT_MAX = 5;

export interface InitiateRateLimitResult {
  allowed: boolean;
  /** Number of initiate requests already recorded in the current window. */
  count: number;
}

/**
 * Count how many `dsr_verifications` rows already exist for
 * (tenant_id, email) within the rolling window, and report whether a new
 * request should be allowed.
 *
 * This is a read-only check — the caller is responsible for inserting the
 * new row (as `POST /api/dsr/initiate` already does) only when
 * `allowed === true`.
 */
export async function checkInitiateRateLimit(
  db: ReturnType<typeof createAdminClient>,
  tenantId: string,
  email: string,
): Promise<InitiateRateLimitResult> {
  const windowStart = new Date(Date.now() - INITIATE_RATE_LIMIT_WINDOW_MS);

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dsrVerifications)
    .where(
      and(
        eq(dsrVerifications.tenantId, tenantId),
        eq(dsrVerifications.email, email),
        gte(dsrVerifications.createdAt, windowStart),
      ),
    );

  const count = row?.count ?? 0;
  return { allowed: count < INITIATE_RATE_LIMIT_MAX, count };
}
