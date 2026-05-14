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
 * Fire-and-forget: callers should `void` this call and handle errors with `.catch()`.
 * Returns without throwing even when the publish fails.
 *
 * @param args - Assignment event fields.
 */
export async function publishAbAssignmentEvent(args: AbAssignmentEventArgs): Promise<void> {
  const redpandaUrl = process.env.REDPANDA_REST_URL;
  if (!redpandaUrl) return;

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

  await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ records: [{ value: envelope }] }),
  });
}
