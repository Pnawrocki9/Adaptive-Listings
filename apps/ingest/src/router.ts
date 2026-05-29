/**
 * Top-level Hono app + routes. Health check + `/v1/events` POST. Worker `fetch` entry-point in
 * `index.ts` re-exports this.
 *
 * Middleware registration order (outermost → innermost):
 * 1. `secureHeaders` — sets HSTS, nosniff, Referrer-Policy, Permissions-Policy on every response.
 * 2. `cors` — answers OPTIONS preflight and sets `Access-Control-Allow-Origin` on every response
 *    for requests originating from the allow-listed pilot/control-plane hosts. [ESC-016]
 * 3. `errorHandler` — sets `request_id` in context + `X-Request-ID` response header.
 * 4. `idempotency` — reads `Idempotency-Key` header; returns cached response on hit.
 * 5. Route handlers (health, events).
 *
 * `app.onError(handleError)` formats any thrown error into the canonical JSON shape.
 *
 * @module apps/ingest/src/router
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { secureHeaders } from 'hono/secure-headers';

import type { Env } from './types.js';
import { events } from './handlers/events.js';
import { errorHandler, handleError } from './middleware/error-handler.js';
import { idempotency } from './middleware/idempotency.js';

/**
 * Browser origins permitted to call the ingest API directly from the SDK.
 *
 * Why this exact list:
 * - `https://app.estalara.com` — the Sprint 13a pilot site. The SDK loads from
 *   `admin.estalara.com/sdk.js` (ESC-015), executes in the app.estalara.com page,
 *   and posts events here.
 * - `https://admin.estalara.com` — the control-plane Next.js host. The Magic
 *   Link wizard's "Test ping" / dashboard previews fire SDK events from this
 *   origin during onboarding.
 *
 * `cdn.estalara.com` is intentionally NOT listed — that host is not yet
 * provisioned (ESC-015) and never originates fetches. When Phase 2 brings up
 * customer-owned tenant domains, those origins join via a tenant-aware lookup,
 * not a hardcoded list. [ESC-016]
 */
const ALLOWED_ORIGINS = ['https://app.estalara.com', 'https://admin.estalara.com'] as const;

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
  app.use(
    '*',
    cors({
      origin: (requestOrigin) =>
        (ALLOWED_ORIGINS as readonly string[]).includes(requestOrigin) ? requestOrigin : null,
      allowMethods: ['GET', 'POST', 'OPTIONS'],
      allowHeaders: [
        'Content-Type',
        'X-Estalara-API-Key',
        'X-Estalara-Signature',
        'Idempotency-Key',
      ],
      exposeHeaders: ['X-Request-ID', 'Retry-After'],
      maxAge: 86400,
      credentials: false,
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
