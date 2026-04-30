/**
 * `POST /v1/events` handler — accepts a batch of events, validates each against
 * `EventSchema` (from `@estalara/shared`), enriches with server-side annotations, pushes to
 * Redpanda. Per ADR-0003: envelope is validated strictly, payload is per-type discriminated.
 *
 * Limits (Master Design C.2 + ticket spec):
 * - Max 1MB request body
 * - Max 1000 events per batch
 *
 * @module apps/ingest/src/handlers/events
 */

import { EventSchema } from '@estalara/shared';
import { Hono } from 'hono';

import type { Env } from '../types.js';
import { authenticateRequest } from '../auth.js';
import { pushToRedpanda } from '../redpanda-producer.js';
import { mapCountryToRegion } from '../region.js';

const MAX_BODY_BYTES = 1_000_000;
const MAX_BATCH_SIZE = 1000;

interface RejectedEvent {
  index: number;
  errors: unknown;
}

export const events = new Hono<{ Bindings: Env }>();

events.post('/', async (c) => {
  // 1. Auth — read API key + signature headers + body together (we need raw body for HMAC)
  const apiKey = c.req.header('X-Estalara-API-Key');
  const signature = c.req.header('X-Estalara-Signature');

  // 2. Body size check (early reject via Content-Length, then re-check after read)
  const contentLength = c.req.header('Content-Length');
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return c.json({ error: 'body_too_large', limit_bytes: MAX_BODY_BYTES }, 413);
  }

  let rawBody: string;
  try {
    rawBody = await c.req.text();
  } catch {
    return c.json({ error: 'body_unreadable' }, 400);
  }
  if (rawBody.length > MAX_BODY_BYTES) {
    return c.json({ error: 'body_too_large', limit_bytes: MAX_BODY_BYTES }, 413);
  }

  const auth = await authenticateRequest(apiKey, signature, rawBody, c.env.KV_API_KEYS);
  if (!auth.ok) {
    return c.json({ error: 'unauthorized', reason: auth.reason }, 401);
  }

  // 3. Parse JSON
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (typeof body !== 'object' || body === null || !('events' in body)) {
    return c.json({ error: 'events_field_required' }, 400);
  }
  const eventsField = body.events;
  if (!Array.isArray(eventsField)) {
    return c.json({ error: 'events_must_be_array' }, 400);
  }
  if (eventsField.length === 0) {
    return c.json({ error: 'events_empty' }, 400);
  }
  if (eventsField.length > MAX_BATCH_SIZE) {
    return c.json({ error: 'batch_too_large', limit: MAX_BATCH_SIZE }, 413);
  }

  // 4. Validate + enrich each event
  const region = mapCountryToRegion(c.req.header('CF-IPCountry'));
  const ingestReceivedAt = Date.now();
  const tenantId = auth.tenant_id;

  const validated: Record<string, unknown>[] = [];
  const rejected: RejectedEvent[] = [];

  for (let i = 0; i < eventsField.length; i++) {
    const incoming: unknown = eventsField[i];
    const parsed = EventSchema.safeParse(incoming);
    if (!parsed.success) {
      rejected.push({ index: i, errors: parsed.error.flatten() });
      continue;
    }
    // Server-side overrides — these fields are not trusted from the client.
    validated.push({
      ...parsed.data,
      tenant_id: tenantId,
      region,
      ingest_received_at: ingestReceivedAt,
    });
  }

  // 5. Push to Redpanda (skip if everything was rejected)
  const batchId = crypto.randomUUID();
  if (validated.length > 0) {
    const push = await pushToRedpanda(validated, c.env);
    if (!push.ok) {
      return c.json(
        {
          error: 'redpanda_unavailable',
          attempts: push.attempts,
          ...(push.status !== undefined ? { upstream_status: push.status } : {}),
        },
        503,
      );
    }
  }

  return c.json(
    {
      accepted: validated.length,
      rejected: rejected.length,
      batch_id: batchId,
      ...(rejected.length > 0 ? { errors: rejected } : {}),
    },
    200,
  );
});
