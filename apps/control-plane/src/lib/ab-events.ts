/**
 * A/B assignment event publisher — control-plane version.
 *
 * Mirrors the fire-and-forget pattern in apps/decision-api/src/lib/ab-events.ts.
 * Cannot import from decision-api directly due to cross-app import restrictions.
 * Changes to the ab.assignment envelope format must be applied here AND in
 * apps/decision-api/src/lib/ab-events.ts simultaneously.
 *
 * Sends the ab.assignment event to Redpanda via the REST proxy (same pattern
 * as decision-api). When REDPANDA_REST_URL is not configured (local dev, tests),
 * the function is a no-op — returns immediately without throwing.
 *
 * @module apps/control-plane/src/lib/ab-events
 */

import * as Sentry from '@sentry/nextjs';

/** Arguments required to build and publish an `ab.assignment` event. */
export interface AbAssignmentEventArgs {
  session_id: string;
  tenant_id: string;
  holdout_group: boolean;
  holdout_pct: number;
  assigned_at: string;
}

/**
 * Publishes an `ab.assignment` event to Redpanda via the HTTP REST proxy.
 *
 * Fire-and-forget: the HTTP request runs in the background; this function returns
 * immediately and never throws. Both HTTP-rejection (non-ok response) and network
 * failures are captured to Sentry with distinguishing `kind` tags
 * (`insert_rejected` vs `network`) so dashboards can group them.
 *
 * @param args - Assignment event fields.
 */
export function publishAbAssignmentEvent(args: AbAssignmentEventArgs): Promise<void> {
  // Returns a promise so callers can register it via after() and guarantee
  // completion after the response is sent (FOLLOW-431 / ESC-033).
  const redpandaUrl = process.env.REDPANDA_REST_URL;
  if (!redpandaUrl) return Promise.resolve();

  const topic = process.env.REDPANDA_TOPIC_EVENTS ?? 'estalara.events';

  const envelopeSessionId =
    args.session_id.length < 32 ? args.session_id.padEnd(32, '0') : args.session_id;

  const envelope = {
    event_id: crypto.randomUUID(),
    tenant_id: args.tenant_id,
    session_id: envelopeSessionId,
    ts: Date.now(),
    region: 'eu',
    consent_state: 'consented',
    schema_version: 1,
    type: 'ab.assignment',
    payload: {
      session_id: args.session_id,
      tenant_id: args.tenant_id,
      holdout_group: args.holdout_group,
      holdout_pct: args.holdout_pct,
      assigned_at: args.assigned_at,
    },
  };

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

  // Returns the fetch promise so after() can await it for guaranteed completion
  // (FOLLOW-431 / ESC-033). Both failure paths capture to Sentry so a Redpanda
  // auth / missing-topic / quota rejection is observable (FOLLOW-426 /
  // Rule K.2 fire-and-forget amendment). The .catch() handler covers network-layer
  // failures; the .then() handler covers HTTP-level rejections (4xx/5xx), which
  // `fetch` resolves (not rejects) and a bare `.catch()` would be blind to.
  return fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ records: [{ value: envelope }] }),
  })
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text().catch(() => '<unreadable body>');
        const msg = `[ab-events] Redpanda publish rejected: HTTP ${String(res.status)} — ${body.slice(0, 500)}`;
        console.error(msg);
        Sentry.captureException(new Error(msg), {
          tags: { area: 'adapt', sink: 'redpanda', kind: 'insert_rejected' },
          extra: { status: res.status },
        });
      }
    })
    .catch((err: unknown) => {
      // Network-layer failure (DNS, connection refused, malformed URL, timeout).
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ab-events] Redpanda publish failed:', msg);
      Sentry.captureException(err instanceof Error ? err : new Error(msg), {
        tags: { area: 'adapt', sink: 'redpanda', kind: 'network' },
      });
    });
}
