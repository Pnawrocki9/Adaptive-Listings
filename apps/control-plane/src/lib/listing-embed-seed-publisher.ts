/**
 * Modal direct-invocation publisher for `listing-embed-seed.requested` events —
 * ADR-0016 / FOLLOW-485 (supersedes the Redpanda REST publish from FOLLOW-435 LEG 1).
 *
 * ADR-0016: the prod Redpanda cluster is Serverless, whose HTTP Proxy is BYOC/
 * Dedicated-only (out of pilot budget), so this no longer publishes to Redpanda.
 * Instead it POSTs the event JSON straight to the Modal function's authenticated
 * web endpoint (`MODAL_EMBED_SEED_URL`), which validates the payload and calls
 * `consume_embed_seed_requests`'s underlying job `.spawn(...)`, mirroring the
 * pattern used by `publishDescriptionRequested` in
 * `apps/control-plane/src/app/api/adapt/description/route.ts`.
 *
 * Fire-and-forget contract:
 *   - Returns a Promise that resolves when the dispatch attempt completes.
 *   - Never rejects — both HTTP-level rejections (non-ok response) and network
 *     failures are captured to Sentry with `kind: 'dispatch_failed'` so dashboards
 *     can group them (Rule K.2 fire-and-forget amendment).
 *   - When MODAL_EMBED_SEED_URL is absent (local dev / CI without Modal configured),
 *     the function resolves immediately as a no-op (single Sentry breadcrumb, no
 *     capture) — same guard shape the Redpanda version used for an unset URL.
 *
 * Caller contract:
 *   - Callers MUST NOT invoke this with a bare `void publishListingEmbeddingSeed(…)`.
 *   - Callers inside an async function should `await` it directly; callers outside an
 *     async context should register it via `afterResponse(() => publishListingEmbeddingSeed(…))`.
 *   - The seed-listing-embeddings helper already runs inside `afterResponse()` and
 *     `await`s this call — no second wrapper is needed there.
 *
 * @module apps/control-plane/src/lib/listing-embed-seed-publisher
 */

import * as Sentry from '@sentry/nextjs';
import type { ListingEmbeddingSeedRequestedEvent } from '@estalara/shared';

/**
 * Dispatch a `listing-embed-seed.requested` event directly to the Modal HTTPS
 * web endpoint.
 *
 * The Modal endpoint (ml-engineer, FOLLOW-485) validates the payload and calls
 * the embed-seed job's `.spawn(...)` for each listing_id in the payload.
 *
 * @param event - The event payload (tenant_id + listing_ids[]).
 * @returns A Promise that resolves when the dispatch attempt completes (never rejects).
 */
export function publishListingEmbeddingSeed(
  event: ListingEmbeddingSeedRequestedEvent,
): Promise<void> {
  const modalUrl = process.env.MODAL_EMBED_SEED_URL;
  // When Modal is not configured (local dev / CI without it set), skip silently.
  if (!modalUrl) {
    const msg =
      '[listing-embed-seed] MODAL_EMBED_SEED_URL not set — skipping Modal dispatch (ADR-0016)';
    console.warn(msg);
    Sentry.addBreadcrumb({
      category: 'listing-embed-seed',
      message: msg,
      level: 'warning',
    });
    return Promise.resolve();
  }

  const internalApiSecret = process.env.INTERNAL_API_SECRET ?? '';

  return fetch(modalUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${internalApiSecret}`,
    },
    body: JSON.stringify(event),
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => '<unreadable body>');
        const msg =
          `[listing-embed-seed] Modal dispatch rejected: HTTP ${String(res.status)} — ` +
          body.slice(0, 500);
        console.error(msg);
        Sentry.captureException(new Error(msg), {
          tags: { area: 'onboarding', sink: 'modal', kind: 'dispatch_failed' },
          extra: {
            status: res.status,
            tenant_id: event.tenant_id,
            listing_count: event.listing_ids.length,
          },
        });
      }
    })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[listing-embed-seed] Modal dispatch failed:', msg);
      Sentry.captureException(err instanceof Error ? err : new Error(msg), {
        tags: { area: 'onboarding', sink: 'modal', kind: 'dispatch_failed' },
        extra: {
          tenant_id: event.tenant_id,
          listing_count: event.listing_ids.length,
        },
      });
    });
}
