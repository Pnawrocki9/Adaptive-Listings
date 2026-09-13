/**
 * Top-level Hono app + routes. Health check + `/v1/events` POST. Worker `fetch` entry-point in
 * `index.ts` re-exports this.
 *
 * Middleware registration order (outermost → innermost):
 * 1. `secureHeaders` — sets HSTS, nosniff, Referrer-Policy, Permissions-Policy on every response.
 * 2. CORS — PER-TENANT origin enforcement [FOLLOW-642]. OPTIONS preflight reflects the
 *    requested origin (permissive — the api key isn't available on preflight); the ACTUAL
 *    `POST /v1/events` resolves the tenant from the api key and matches the browser `Origin`
 *    against that tenant's `allowed_origins`, returning 403 + zero side effects on a mismatch
 *    (see `origin-gate.ts` + `handlers/events.ts`). A tenant with NO configured origins inherits
 *    the env allow-list (Estalara pilot/control-plane hosts + dev localhost), so first-party
 *    behavior is unchanged. Supersedes the ESC-016 hardcoded-env-only model.
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
// FOLLOW-642: the env allow-list constants + helper moved to `origin-gate.ts`, the single home
// for all origin logic (per-tenant matcher + normalizer live there too). Re-imported here for
// the fallback CORS decoration on non-tenant-scoped responses (health, 404, pre-auth errors).
import { allowedOriginsForEnv } from './origin-gate.js';

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
   * Manual CORS middleware — per-tenant origin enforcement. [FOLLOW-642]
   *
   * We implement CORS manually rather than using `hono/cors` because the allow decision is
   * PER-TENANT and data-driven: the effective `Access-Control-Allow-Origin` depends on the
   * tenant resolved from the api key, not on a static list. (Nesting `cors()` inside an outer
   * middleware also creates a Hono context generic mismatch the strict TS config rejects.)
   *
   * TWO-LAYER MODEL (see `origin-gate.ts` + `handlers/events.ts`):
   *
   *  1. OPTIONS PREFLIGHT — the api key is NOT available (browsers strip custom headers such as
   *     `X-Estalara-API-Key` from preflight), so the tenant CANNOT be resolved here. Preflight
   *     is therefore a permissive browser-negotiation step: it REFLECTS the requested `Origin`
   *     so the browser proceeds to the actual request. This grants nothing — a stolen key used
   *     from a non-allow-listed origin is rejected at the POST below (403, zero side effects).
   *     This is the DOMAIN-INDEPENDENCE requirement: an external client's own domain (unknown
   *     to this Worker up front) must clear preflight before its tenant config can be consulted.
   *
   *  2. ACTUAL REQUEST — the events handler runs the per-tenant origin gate (it has the api key)
   *     and records its decision in context under `corsAllowOrigin`:
   *       - a non-empty string → the origin was allow-listed for the resolved tenant; echo it.
   *       - `''` (empty string) → the origin was present but DENIED (the handler already
   *         returned 403 `forbidden_origin`); omit `Access-Control-Allow-Origin`.
   *       - `undefined` (gate never ran: health, 404, auth failure, or a server-side no-`Origin`
   *         caller) → fall back to the env allow-list (unchanged legacy behavior, so Estalara's
   *         own tooling still gets CORS headers on error/health responses).
   */
  app.use('*', async (c, next) => {
    const requestOrigin = c.req.header('Origin') ?? '';

    // OPTIONS preflight: respond immediately without invoking route handlers.
    if (c.req.method === 'OPTIONS') {
      c.res = new Response(null, { status: 204 });
      // Reflect the requested origin (permissive by design — see layer 1 above). Never a
      // wildcard '*': we echo the exact origin or nothing.
      if (requestOrigin) c.res.headers.set('Access-Control-Allow-Origin', requestOrigin);
      c.res.headers.set('Access-Control-Allow-Methods', CORS_ALLOW_METHODS);
      c.res.headers.set('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS);
      c.res.headers.set('Access-Control-Max-Age', CORS_MAX_AGE);
      return;
    }

    // Non-preflight: run the route handler first, then decorate the response.
    await next();

    const perTenantDecision = c.get('corsAllowOrigin' as never) as string | undefined;
    if (perTenantDecision !== undefined) {
      // The per-tenant gate ran. A non-empty string is the (allow-listed) origin to echo; an
      // empty string means DENIED — omit the header so the browser blocks the response read.
      if (perTenantDecision) {
        c.res.headers.set('Access-Control-Allow-Origin', perTenantDecision);
        c.res.headers.set('Access-Control-Expose-Headers', CORS_EXPOSE_HEADERS);
      }
      return;
    }

    // Fallback (gate never ran): env allow-list — unchanged legacy behavior for non-tenant
    // responses (health, 404) and pre-auth error responses.
    const allowed = allowedOriginsForEnv(c.env.ENVIRONMENT);
    if (requestOrigin && (allowed as string[]).includes(requestOrigin)) {
      c.res.headers.set('Access-Control-Allow-Origin', requestOrigin);
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
