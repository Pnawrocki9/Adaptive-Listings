/**
 * POST /api/internal/listings/embed-seed — the control-plane embed-seed requeue hop
 * (FOLLOW-1297, ADR-0023 §6 G-06; replaces the Modal overflow job when `MODAL_EMBED_SEED_URL` is
 * unset).
 *
 * Body: `ListingEmbeddingSeedRequestedEventSchema` — `{ tenant_id, listing_ids }` plus the additive
 * optional `requeue_depth` (0..20, hops already taken) and `retry_listing_ids` (ids on their single
 * retry). Answers 202 at once and runs `runEmbedSeedHop` in `after()`: embeds what fits the hop's
 * budget with bounded concurrency, requeues the remainder to this same route with
 * `requeue_depth + 1`, reports a listing that fails its retry. The embed endpoint it calls
 * (`POST /api/listings/embed`) is an idempotent upsert, so a duplicated hop is safe.
 *
 * Auth: `Authorization: Bearer <INTERNAL_API_SECRET>`, constant-time compare, fail-closed when the
 * secret is unset. Internal only — never called by tenants or the SDK.
 *
 * Responses: 202 `{ accepted: true, requeue_depth, listing_count }` · 400 · 401.
 *
 * @module apps/control-plane/src/app/api/internal/listings/embed-seed/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ListingEmbeddingSeedRequestedEventSchema } from '@estalara/shared';
import { afterResponse } from '@/lib/after-response';
import { secretEquals } from '@/lib/secret-compare';
import { runEmbedSeedHop } from '@/lib/seed-listing-embeddings';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const auth = req.headers.get('Authorization') ?? req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const expected = process.env.INTERNAL_API_SECRET;
  if (!token || !expected || !secretEquals(expected, token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = ListingEmbeddingSeedRequestedEventSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { tenant_id, listing_ids, requeue_depth, retry_listing_ids } = parsed.data;
  const requeueDepth = requeue_depth ?? 0;

  afterResponse(() =>
    runEmbedSeedHop({
      tenantId: tenant_id,
      listings: listing_ids.map((listing_id) => ({ listing_id })),
      retryIds: new Set(retry_listing_ids ?? []),
      requeueDepth,
    }),
  );

  return NextResponse.json(
    { accepted: true, requeue_depth: requeueDepth, listing_count: listing_ids.length },
    { status: 202 },
  );
}
