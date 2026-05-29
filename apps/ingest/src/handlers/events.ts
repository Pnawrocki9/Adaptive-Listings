/**
 * `POST /v1/events` handler — accepts a batch of events, validates each against
 * `EventSchema` (from `@estalara/shared`), enriches with server-side annotations, pushes to
 * Redpanda. Per ADR-0003: envelope is validated strictly, payload is per-type discriminated.
 *
 * All error responses use the canonical shape (TICKET-019):
 *   `{ error: { code, message, request_id, details? } }`
 *
 * Observability (TICKET-018):
 * - OTel span attributes set on the active span created by `@microlabs/otel-cf-workers`
 *
 * Limits (Master Design C.2 + ticket spec):
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
import { pushToClickHouse } from '../clickhouse-producer.js';
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

function errorBody(
  requestId: string,
  code: string,
  message: string,
  details?: Record<string, unknown>,
) {
  return {
    error: {
      code,
      message,
      request_id: requestId,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

export const events = new Hono<{ Bindings: Env }>();

events.post('/', async (c) => {
  const span = trace.getActiveSpan();
  const requestId = (c.get('requestId' as never) as string | undefined) ?? crypto.randomUUID();

  // 1. Auth — read API key + signature headers + body together (we need raw body for HMAC)
  const apiKey = c.req.header('X-Estalara-API-Key');
  const signature = c.req.header('X-Estalara-Signature');

  // 2. Body size check (early reject via Content-Length, then re-check after read)
  const contentLength = c.req.header('Content-Length');
  if (contentLength && Number.parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return c.json(
      errorBody(requestId, 'payload_too_large', 'Request body exceeds 1 MB limit', {
        limit_bytes: MAX_BODY_BYTES,
      }),
      413,
    );
  }

  let rawBody: string;
  try {
    rawBody = await c.req.text();
  } catch {
    return c.json(errorBody(requestId, 'validation_failed', 'Request body is unreadable'), 400);
  }
  if (rawBody.length > MAX_BODY_BYTES) {
    return c.json(
      errorBody(requestId, 'payload_too_large', 'Request body exceeds 1 MB limit', {
        limit_bytes: MAX_BODY_BYTES,
      }),
      413,
    );
  }

  const auth = await authenticateRequest(apiKey, signature, rawBody, c.env.KV_API_KEYS);
  if (!auth.ok) {
    return c.json(
      errorBody(requestId, 'unauthorized', 'Authentication failed', { reason: auth.reason }),
      401,
    );
  }

  const tenantId = auth.tenant_id;
  // Make tenant_id available to any Hono middleware/handler downstream via context.
  c.set('tenantId' as never, tenantId);
  span?.setAttribute('estalara.tenant_id', tenantId);

  // 3. Parse JSON
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return c.json(errorBody(requestId, 'validation_failed', 'Request body is not valid JSON'), 400);
  }
  if (typeof body !== 'object' || body === null || !('events' in body)) {
    return c.json(
      errorBody(requestId, 'validation_failed', "Request body must contain an 'events' array"),
      400,
    );
  }
  const eventsField = body.events;
  if (!Array.isArray(eventsField)) {
    return c.json(
      errorBody(requestId, 'validation_failed', "'events' field must be an array"),
      400,
    );
  }
  if (eventsField.length === 0) {
    return c.json(
      errorBody(requestId, 'validation_failed', "'events' array must not be empty"),
      400,
    );
  }
  if (eventsField.length > MAX_BATCH_SIZE) {
    return c.json(
      errorBody(
        requestId,
        'payload_too_large',
        `Batch exceeds ${String(MAX_BATCH_SIZE)}-event limit`,
        { limit: MAX_BATCH_SIZE },
      ),
      413,
    );
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
      errorBody(
        requestId,
        'rate_limited',
        'Rate limit exceeded — retry after the indicated window',
        { limit: rate.limit, remaining: rate.remaining, reset_at: rate.reset_at },
      ),
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

  // 6. Push to downstream sinks (skip if everything was rejected).
  //
  // Two sinks, run in parallel because both no-op when their respective env
  // vars are unset:
  //   - Redpanda Pandaproxy (Phase-3 destination — currently empty URL in
  //     prd, so its producer returns `{ok:true, attempts:0}`).
  //   - ClickHouse Cloud HTTPS interface (ESC-017 pilot path — replaces the
  //     missing Pandaproxy hop on Redpanda Cloud Serverless).
  //
  // 5xx-class failure in EITHER sink that's configured returns 503 so the
  // SDK retries; 4xx fails fast. The Phase-1 no-op return path is `ok:true`
  // for both, so an unconfigured sink can never short-circuit the other.
  const batchId = crypto.randomUUID();
  if (validated.length > 0) {
    const [redpandaPush, clickhousePush] = await Promise.all([
      pushToRedpanda(validated, c.env),
      pushToClickHouse(validated, c.env),
    ]);

    if (!redpandaPush.ok) {
      logger.error(
        {
          tenant_id: tenantId,
          batch_size: eventsField.length,
          attempts: redpandaPush.attempts,
          upstream_status: redpandaPush.status,
        },
        'redpanda_push_failed',
      );
      return c.json(
        errorBody(requestId, 'redpanda_unavailable', 'Failed to publish events to message bus', {
          attempts: redpandaPush.attempts,
          ...(redpandaPush.status !== undefined ? { upstream_status: redpandaPush.status } : {}),
        }),
        503,
      );
    }

    if (!clickhousePush.ok) {
      logger.error(
        {
          tenant_id: tenantId,
          batch_size: eventsField.length,
          attempts: clickhousePush.attempts,
          upstream_status: clickhousePush.status,
          error: clickhousePush.error,
        },
        'clickhouse_push_failed',
      );
      return c.json(
        errorBody(requestId, 'clickhouse_unavailable', 'Failed to persist events to ClickHouse', {
          attempts: clickhousePush.attempts,
          ...(clickhousePush.status !== undefined
            ? { upstream_status: clickhousePush.status }
            : {}),
        }),
        503,
      );
    }
  }

  span?.setAttributes({
    'estalara.tenant_id': tenantId,
    'estalara.batch_size': eventsField.length,
    'estalara.region': region,
    'estalara.validation_failures': rejected.length,
    'estalara.rate_limited': false,
  });

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
