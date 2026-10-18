/**
 * Top-level Hono app + routes. Health check + `/v1/events` POST. Worker `fetch` entry-point in
 * `index.ts` re-exports this.
 *
 * Middleware registration order (outermost → innermost):
 * 1. `secureHeaders` — sets HSTS, nosniff, Referrer-Policy, Permissions-Policy on every response.
 * 2. CORS — one constant origin list [FOLLOW-642, FOLLOW-1333] (`origin-gate.ts`). The OPTIONS
 *    preflight and every actual response answer `Access-Control-Allow-Origin` for a listed origin
 *    only; `POST /v1/events` additionally refuses an unlisted `Origin` with 403 + zero side
 *    effects (`handlers/events.ts`).
 * 3. `errorHandler` — sets `request_id` in context + `X-Request-ID` response header.
 * 4. `idempotency` — reads `Idempotency-Key` header; returns cached response on hit.
 * 5. Route handlers (health, events).
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
import { isOriginAllowed } from './origin-gate.js';

/** Shared CORS header values that don't change per request. */
const CORS_ALLOW_METHODS = 'GET, POST, OPTIONS';
const CORS_ALLOW_HEADERS =
  'Content-Type, X-Estalara-API-Key, X-Estalara-Signature, X-Estalara-Timestamp, ' +
  'X-Estalara-Nonce, X-Session-ID, Idempotency-Key';
const CORS_EXPOSE_HEADERS = 'X-Request-ID, Retry-After';
const CORS_MAX_AGE = '86400';

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

  /**
   * Manual CORS middleware — one constant origin list. [FOLLOW-642, FOLLOW-1333]
   *
   * `hono/cors` is not used: nesting `cors()` inside an outer middleware creates a Hono context
   * generic mismatch the strict TS config rejects, and the decision is one call either way.
   *
   *  1. OPTIONS PREFLIGHT — answers `Access-Control-Allow-Origin` for a listed origin only. Until
   *     FOLLOW-1333 it REFLECTED any origin, because the api key is not available on a preflight
   *     (browsers strip custom headers such as `X-Estalara-API-Key`) and a per-tenant list could
   *     only be read at the actual request. With one constant list there is nothing to resolve.
   *  2. ACTUAL REQUEST — the route handler runs first (`POST /v1/events` refuses an unlisted
   *     `Origin` with 403 before any side effect), then the response is decorated with the same
   *     listed-origin answer: health, 404, auth failures and the events response alike.
   */
  app.use('*', async (c, next) => {
    const requestOrigin = c.req.header('Origin') ?? '';
    const allowOrigin =
      requestOrigin && isOriginAllowed(requestOrigin, c.env.ENVIRONMENT) ? requestOrigin : null;

    // OPTIONS preflight: respond immediately without invoking route handlers.
    if (c.req.method === 'OPTIONS') {
      c.res = new Response(null, { status: 204 });
      // Never a wildcard '*': the exact listed origin, or nothing.
      if (allowOrigin) c.res.headers.set('Access-Control-Allow-Origin', allowOrigin);
      c.res.headers.set('Access-Control-Allow-Methods', CORS_ALLOW_METHODS);
      c.res.headers.set('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
      c.res.headers.set('Access-Control-Max-Age', CORS_MAX_AGE);
      return;
    }

    // Non-preflight: run the route handler first, then decorate the response.
    await next();

    if (allowOrigin) {
      c.res.headers.set('Access-Control-Allow-Origin', allowOrigin);
      c.res.headers.set('Access-Control-Expose-Headers', CORS_EXPOSE_HEADERS);
    }
  });

  app.use('*', errorHandler);
  app.use('/v1/events/*', idempotency);

  /**
   * Liveness + DEPLOY IDENTITY. [FOLLOW-938]
   *
   * Until now this returned status/service/environment only, so *"is this fix live?"* was
   * unanswerable by any probe, by anyone — two tickets in one merge window closed DONE on
   * identical evidence (merge sha + green CI) with opposite deployment outcomes, because the
   * closure criterion has no deployment axis.
   *
   * Both identity fields are explicitly `null` rather than omitted when unknown: an ABSENT key
   * reads as "old shape" and invites a retry against the wrong assumption, while `null` says
   * "asked, and the answer is nothing" — which for `git_sha` is the honest permanent answer until
   * something sets it.
   */
  app.get('/health', (c) =>
    c.json({
      status: 'ok',
      service: 'estalara-ingest',
      environment: c.env.ENVIRONMENT,
      /** Cloudflare deploy id — correlate with `wrangler deployments list`. */
      version_id: c.env.CF_VERSION_METADATA?.id ?? null,
      /** Build-time git sha. `null` until a deploy path injects it (none does today). */
      git_sha: c.env.GIT_SHA ?? null,
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
