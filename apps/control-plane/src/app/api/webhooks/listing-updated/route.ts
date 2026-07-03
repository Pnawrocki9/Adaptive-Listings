/**
 * POST /api/webhooks/listing-updated
 *
 * Internal webhook that invalidates the Upstash Redis description cache for a given
 * (tenant_id, listing_id) pair when a listing is updated.
 *
 * Per TICKET-DESC-001 AC-7 and Master Design E.7.
 *
 * Option A (MVP simplicity): This HTTP endpoint is the cache invalidation consumer.
 * Option B (deferred to FOLLOW-NNN): stream-consumer reads listing.updated from Redpanda.
 *
 * Invalidation strategy:
 *   SCAN 0 MATCH desc:{tenant_id}:{listing_id}:* → DEL all matched keys
 *
 * This endpoint is idempotent: calling it twice for the same listing is safe.
 * DEL on non-existent keys is a Redis no-op.
 *
 * Auth:
 *   Requires the `X-Webhook-Secret` header to match `LISTING_UPDATED_WEBHOOK_SECRET`
 *   env var, compared constant-time via `secretEquals`.
 *
 *   Fail-closed (FOLLOW-456 / audit F-13): when the env var is unset, every
 *   request is rejected with 401 — previously an unset secret skipped auth
 *   entirely, allowing anyone to invalidate any tenant's description cache.
 *
 * @module apps/control-plane/src/app/api/webhooks/listing-updated/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { invalidateDescriptionCache } from '@/lib/description-cache';
import { invalidatePgDescriptionCache } from '@/lib/description-pg-cache';
import { secretEquals } from '@/lib/secret-compare';

// ─── Request body schema ──────────────────────────────────────────────────────

const ListingUpdatedBodySchema = z.object({
  /** Tenant UUID. */
  tenant_id: z.string().uuid(),
  /** The tenant's listing identifier. */
  listing_id: z.string().min(1).max(256),
});

// ─── POST handler ─────────────────────────────────────────────────────────────

/**
 * POST /api/webhooks/listing-updated
 *
 * Body: { tenant_id: string (UUID), listing_id: string }
 *
 * @returns 200 { invalidated: true } on success.
 * @returns 400 on invalid body.
 * @returns 401 when webhook secret is present but header is missing/wrong.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Webhook secret auth ───────────────────────────────────────────────────
  // Fail CLOSED: an unset LISTING_UPDATED_WEBHOOK_SECRET denies every request
  // rather than skipping auth (FOLLOW-456 / audit F-13).
  const expectedSecret = process.env.LISTING_UPDATED_WEBHOOK_SECRET;
  const providedSecret = req.headers.get('X-Webhook-Secret');
  if (!expectedSecret || !providedSecret || !secretEquals(expectedSecret, providedSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // ── Parse body ────────────────────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = ListingUpdatedBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { tenant_id, listing_id } = parsed.data;

  // ── Cache invalidation ────────────────────────────────────────────────────
  // 1. Redis hot-cache invalidation — fail-open (errors swallowed internally).
  await invalidateDescriptionCache(tenant_id, listing_id);

  // 2. Postgres permanent cache invalidation (FOLLOW-204 / Master Design §E.7).
  //    SET invalidated_at = NOW() on all active rows for this (tenant, listing).
  //    invalidatePgDescriptionCache throws on configured-DB error — we capture that
  //    here and return 500 so the caller (or Sentry) knows invalidation was partial.
  try {
    await invalidatePgDescriptionCache(tenant_id, listing_id);
  } catch (err: unknown) {
    console.error(
      '[webhooks/listing-updated] Postgres cache invalidation failed:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: 'Postgres invalidation failed — Redis cache cleared, Postgres was not.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ invalidated: true }, { status: 200 });
}
