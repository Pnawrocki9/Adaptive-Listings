/**
 * Top-level Hono app + routes. Health check + `/v1/events` POST. Worker `fetch` entry-point in
 * `index.ts` re-exports this.
 *
 * Middleware registration order (outermost → innermost):
 * 1. `secureHeaders` — sets HSTS, nosniff, Referrer-Policy, Permissions-Policy on every response.
 * 2. `errorHandler` — sets `request_id` in context + `X-Request-ID` response header.
 * 3. `idempotency` — reads `Idempotency-Key` header; returns cached response on hit.
 * 4. Route handlers (health, events).
 *
 * `app.onError(handleError)` formats any thrown error into the canonical JSON shape.
 *
 * @module apps/ingest/src/router
 */

import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

import type { Env } from './types.js';
import { events } from './handlers/events.js';
import { errorHandler, handleError } from './middleware/error-handler.js';
import { idempotency } from './middleware/idempotency.js';

export function createApp(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.use(
    '*',
    secureHeaders({
      strictTransportSecurity: 'max-age=63072000; includeSubDomains; preload',
      xContentTypeOptions: 'nosniff',
      referrerPolicy: 'strict-origin-when-cross-origin',
      permissionsPolicy: {
        camera: [],
        microphone: [],
        geolocation: [],
        payment: [],
      },
      contentSecurityPolicy: false as never,
      xFrameOptions: false,
    }),
  );
  app.use('*', errorHandler);
  app.use('/v1/events/*', idempotency);

  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      service: 'estalara-ingest',
      environment: c.env.ENVIRONMENT,
    }),
  );

  app.route('/v1/events', events);

  app.notFound((c) =>
    c.json(
      {
        error: {
          code: 'not_found',
          message: `No route for ${new URL(c.req.url).pathname}`,
          request_id: (c.get('requestId' as never) as string | undefined) ?? crypto.randomUUID(),
        },
      },
      404,
    ),
  );

  app.onError(handleError);

  return app;
}
