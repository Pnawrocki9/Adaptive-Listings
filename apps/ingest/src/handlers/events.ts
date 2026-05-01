/**
 * `POST /v1/events` handler — accepts a batch of events, validates each against
 * `EventSchema` (from `@estalara/shared`), enriches with server-side annotations, pushes to
 * Redpanda. Per ADR-0003: envelope is validated strictly, payload is per-type discriminated.
 *
 * Observability (TICKET-018):
 * - OTel span attributes set on the active span created by `@microlabs/otel-cf-workers`
 * - Structured Pino logs emitted per-request (info) and on failures (error/warn)
 * - Sentry error capture for unexpected errors via the `withSentry` wrapper in index.ts
 *
 * Limits (Master Design C.2):
 * - Max 1MB request body
 * - Max 1000 events per batch
 *
 * @module apps/ingest/src/handlers/events
 */

import { trace } from '@opentelemetry/api';
import { EventSchema } from '@estalara/shared';
import { Hono } from 'hono';

import type { Env } from '../types.js';
import { authenticateRequest } from '../auth.js';
import { logger } from '../observability/logger.js';
import { checkRateLimit } from '../rate-limiter.js';
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
  const span = trace.getActiveSpan();

  // 1. Auth — read API key + signature headers + body together (we need raw body for HMAC)
  const apiKey = c.req.header('X-Estalara-API-Key');
  const signature = c.req.header('X-Estalara-Signature');

  // 2. Body size check (early reject via Content-Length, then re-check after read)
  const contentLength = c.req.header('Content-Length');
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    logger.warn({ limit_bytes: MAX_BODY_BYTES }, 'body_too_large rejected via content-length');
    return c.json({ error: 'body_too_large', limit_bytes: MAX_BODY_BYTES }, 413);
  }

  let rawBody: string;
  try {
    rawBody = await c.req.text();
  } catch {
    logger.warn({}, 'body_unreadable');
    return c.json({ error: 'body_unreadable' }, 400);
  }
  if (rawBody.length > MAX_BODY_BYTES) {
    logger.warn({ limit_bytes: MAX_BODY_BYTES }, 'body_too_large rejected after read');
    return c.json({ error: 'body_too_large', limit_bytes: MAX_BODY_BYTES }, 413);
  }

  const auth = await authenticateRequest(apiKey, signature, rawBody, c.env.KV_API_KEYS);
  if (!auth.ok) {
    logger.warn({ reason: auth.reason }, 'auth_failed');
    return c.json({ error: 'unauthorized', reason: auth.reason }, 401);
  }

  const tenantId = auth.tenant_id;
  span?.setAttribute('estalara.tenant_id', tenantId);

  // 3. Parse JSON
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    logger.warn({ tenant_id: tenantId }, 'invalid_json');
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (typeof body !== 'object' || body === null || !('events' in body)) {
    return c.json({ error: 'events_field_required' }, 400);
  }
  const eventsField = (body).events;
  if (!Array.isArray(eventsField)) {
    return c.json({ error: 'events_must_be_array' }, 400);
  }
  if (eventsField.length === 0) {
    return c.json({ error: 'events_empty' }, 400);
  }
  if (eventsField.length > MAX_BATCH_SIZE) {
    logger.warn({ tenant_id: tenantId, batch_size: eventsField.length }, 'batch_too_large');
    return c.json({ error: 'batch_too_large', limit: MAX_BATCH_SIZE }, 413);
  }

  // 4. Per-tenant rate limit
  const rate = await checkRateLimit(c.env.RATE_LIMITER, tenantId, eventsField.length);
  if (!rate.allowed) {
    const retryAfterSeconds = Math.max(1, Math.ceil((rate.reset_at - Date.now()) / 1000));
    span?.setAttributes({
      'estalara.tenant_id': tenantId,
      'estalara.batch_size': eventsField.length,
      'estalara.rate_limited': true,
    });
    logger.warn(
      {
        tenant_id: tenantId,
        batch_size: eventsField.length,
        remaining: rate.remaining,
        reset_at: rate.reset_at,
      },
      'rate_limited',
    );
    c.header('Retry-After', String(retryAfterSeconds));
    return c.json(
      {
        error: 'rate_limited',
        limit: rate.limit,
        remaining: rate.remaining,
        reset_at: rate.reset_at,
      },
      429,
    );
  }

  // 5. Validate + enrich each event
  const region = mapCountryToRegion(c.req.header('CF-IPCountry'));
  const ingestReceivedAt = Date.now();

  const validated: Record<string, unknown>[] = [];
  const rejected: RejectedEvent[] = [];

  for (let i = 0; i < eventsField.length; i++) {
    const incoming: unknown = eventsField[i];
    const parsed = EventSchema.safeParse(incoming);
    if (!parsed.success) {
      rejected.push({ index: i, errors: parsed.error.flatten() });
      continue;
    }
    validated.push({
      ...parsed.data,
      tenant_id: tenantId,
      region,
      ingest_received_at: ingestReceivedAt,
    });
  }

  span?.setAttributes({
    'estalara.tenant_id': tenantId,
    'estalara.batch_size': eventsField.length,
    'estalara.region': region,
    'estalara.validation_failures': rejected.length,
    'estalara.rate_limited': false,
  });

  // 6. Push to Redpanda
  const batchId = crypto.randomUUID();
  if (validated.length > 0) {
    const push = await pushToRedpanda(validated, c.env);
    if (!push.ok) {
      logger.error(
        {
          tenant_id: tenantId,
          batch_size: eventsField.length,
          attempts: push.attempts,
          upstream_status: push.status,
        },
        'redpanda_push_failed',
      );
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

  logger.info(
    {
      tenant_id: tenantId,
      batch_id: batchId,
      batch_size: eventsField.length,
      accepted: validated.length,
      rejected: rejected.length,
      region,
    },
    'events_accepted',
  );

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
