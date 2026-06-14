/**
 * Top-level Hono app + routes. Health check + `/v1/events` POST. Worker `fetch` entry-point in
 * `index.ts` re-exports this.
 *
 * Middleware registration order (outermost → innermost):
 * 1. `secureHeaders` — sets HSTS, nosniff, Referrer-Policy, Permissions-Policy on every response.
 * 2. CORS — answers OPTIONS preflight and sets `Access-Control-Allow-Origin` on every response
 *    for requests originating from the allow-listed pilot/control-plane hosts. [ESC-016]
 *    In dev (`ENVIRONMENT !== 'production'`) localhost origins are also permitted so the
 *    browser SDK running on http://localhost:5173 (Estalara-app SvelteKit) can reach the
 *    Worker running on http://localhost:8787. Production behavior is unchanged.
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

/**
 * Browser origins permitted to call the ingest API directly from the SDK in production.
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
const PROD_ALLOWED_ORIGINS: readonly string[] = [
  'https://app.estalara.com',
  'https://admin.estalara.com',
];

/**
 * Additional localhost origins permitted in NON-production environments only.
 *
 * Gated on `ENVIRONMENT !== 'production'` (read from the Worker binding at request time).
 * These origins are NEVER added in the [env.production] wrangler environment. This allows
 * the browser SDK running on the local Estalara-app SvelteKit dev server
 * (http://localhost:5173) and the local control-plane (http://localhost:3000) to call the
 * Worker at http://localhost:8787 without CORS rejections during local E2E testing.
 */
const DEV_EXTRA_ORIGINS: readonly string[] = ['http://localhost:5173', 'http://localhost:3000'];

/**
 * Build the effective CORS allow-list for the current request, gated on
 * `env.ENVIRONMENT`.
 *
 * Returns only `PROD_ALLOWED_ORIGINS` when `ENVIRONMENT === 'production'`.
 * Returns `PROD_ALLOWED_ORIGINS + DEV_EXTRA_ORIGINS` for all other env values
 * (development, staging, test, …).
 */
function allowedOriginsForEnv(environment: string): readonly string[] {
  return environment === 'production'
    ? PROD_ALLOWED_ORIGINS
    : [...PROD_ALLOWED_ORIGINS, ...DEV_EXTRA_ORIGINS];
}

/** Shared CORS header values that don't change per request. */
const CORS_ALLOW_METHODS = 'GET, POST, OPTIONS';
const CORS_ALLOW_HEADERS =
  'Content-Type, X-Estalara-API-Key, X-Estalara-Signature, X-Session-ID, Idempotency-Key';
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
   * Manual CORS middleware — dynamic allow-list gated on `c.env.ENVIRONMENT`.
   *
   * We implement CORS manually rather than using `hono/cors` because the allow-list
   * must be computed at request time from `c.env.ENVIRONMENT` (a Worker runtime
   * binding). Using `cors()` with a static list wouldn't cover the dev-vs-prod
   * distinction. Nesting a `cors()` call inside an outer middleware creates a Hono
   * context generic mismatch that the strict TypeScript config rejects.
   *
   * This middleware replicates the behaviour of `hono/cors` exactly:
   *  - OPTIONS preflight → 204 + CORS headers (no route handler invoked).
   *  - Other methods → CORS headers added to the route handler response.
   *  - Unlisted origin → no `Access-Control-Allow-Origin` header (browser blocks).
   */
  app.use('*', async (c, next) => {
    const requestOrigin = c.req.header('Origin') ?? '';
    const allowed = allowedOriginsForEnv(c.env.ENVIRONMENT);
    const isAllowed = (allowed as string[]).includes(requestOrigin);

    // OPTIONS preflight: respond immediately without invoking route handlers.
    if (c.req.method === 'OPTIONS') {
      c.res = new Response(null, { status: 204 });
      if (isAllowed) c.res.headers.set('Access-Control-Allow-Origin', requestOrigin);
      c.res.headers.set('Access-Control-Allow-Methods', CORS_ALLOW_METHODS);
      c.res.headers.set('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
      c.res.headers.set('Access-Control-Max-Age', CORS_MAX_AGE);
      return;
    }

    // Non-preflight: run the route handler first, then decorate the response.
    await next();

    if (isAllowed) {
      c.res.headers.set('Access-Control-Allow-Origin', requestOrigin);
      c.res.headers.set('Access-Control-Expose-Headers', CORS_EXPOSE_HEADERS);
    }
  });

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
