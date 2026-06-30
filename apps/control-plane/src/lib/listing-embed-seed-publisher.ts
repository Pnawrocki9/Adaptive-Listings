/**
 * Redpanda publisher for `listing-embed-seed.requested` events — FOLLOW-435 LEG 1.
 *
 * Publishes to topic `estalara.listing-embeddings` (env REDPANDA_TOPIC_LISTING_EMBEDDINGS)
 * via the Pandaproxy REST interface, mirroring the pattern used by
 * `publishDescriptionRequested` in `apps/control-plane/src/app/api/adapt/description/route.ts`.
 *
 * Fire-and-forget contract:
 *   - Returns a Promise that resolves when the publish attempt completes.
 *   - Never rejects — both HTTP-level rejections (non-ok response) and network
 *     failures are captured to Sentry with distinguishing `kind` tags so dashboards
 *     can group them (Rule K.2 fire-and-forget amendment).
 *   - When REDPANDA_REST_URL is absent (local dev / CI without Redpanda), the
 *     function resolves immediately as a no-op without capturing to Sentry.
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
 * Publish a `listing-embed-seed.requested` event to the Redpanda topic
 * `estalara.listing-embeddings`.
 *
 * The Modal consumer (ml-engineer, FOLLOW-435 LEG 2) subscribes to this topic
 * and calls `POST /api/listings/embed` for each listing_id in the payload.
 *
 * @param event - The event payload (tenant_id + listing_ids[]).
 * @returns A Promise that resolves when the publish attempt completes (never rejects).
 */
export function publishListingEmbeddingSeed(
  event: ListingEmbeddingSeedRequestedEvent,
): Promise<void> {
  const redpandaUrl = process.env.REDPANDA_REST_URL;
  // When Redpanda is not configured (local dev / CI without a broker), skip silently.
  if (!redpandaUrl) return Promise.resolve();

  const topic = process.env.REDPANDA_TOPIC_LISTING_EMBEDDINGS ?? 'estalara.listing-embeddings';
  const url = `${redpandaUrl.replace(/\/$/, '')}/topics/${topic}`;

  const username = process.env.REDPANDA_REST_USERNAME;
  const password = process.env.REDPANDA_REST_PASSWORD;

  const headers: Record<string, string> = {
    'Content-Type': 'application/vnd.kafka.json.v2+json',
    Accept: 'application/vnd.kafka.v2+json',
  };
  if (username && password) {
    headers.Authorization = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
  }

  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ records: [{ value: event }] }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => '<unreadable body>');
        const msg =
          `[listing-embed-seed] Redpanda publish rejected: HTTP ${String(res.status)} — ` +
          body.slice(0, 500);
        console.error(msg);
        Sentry.captureException(new Error(msg), {
          tags: { area: 'onboarding', sink: 'redpanda', kind: 'insert_rejected' },
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
      console.error('[listing-embed-seed] Redpanda publish failed:', msg);
      Sentry.captureException(err instanceof Error ? err : new Error(msg), {
        tags: { area: 'onboarding', sink: 'redpanda', kind: 'network' },
        extra: {
          tenant_id: event.tenant_id,
          listing_count: event.listing_ids.length,
        },
      });
    });
}
