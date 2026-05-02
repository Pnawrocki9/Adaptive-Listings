/**
 * Estalara ingest — Cloudflare Worker entry point.
 *
 * `POST /v1/events` accepts batched behavioral events from the SDK, validates each via
 * `EventSchema` from `@estalara/shared`, authenticates the tenant via API key (HMAC-signed for
 * server-side adapters), enriches with server timestamp + region, and pushes to Redpanda.
 *
 * `GET /health` returns liveness for uptime checks.
 *
 * Latency target: p95 < 50ms in production. Bundle stays <200 KB after observability.
 *
 * Observability stack (TICKET-018):
 * - OTel spans via `@microlabs/otel-cf-workers` — wraps the entire handler at the outermost layer
 * - Sentry error capture via `@sentry/cloudflare` — wraps the Hono app fetch
 * - Structured logs via Pino (see `./observability/logger.ts`)
 *
 * @module apps/ingest/src/index
 */

import { instrument } from '@microlabs/otel-cf-workers';

import { withSentry } from './observability.js';
import { otelConfig } from './observability/spans.js';
import { createApp } from './router.js';

const app = createApp();

/**
 * The Hono app is wrapped first with Sentry (innermost), then with OTel
 * `instrument()` (outermost).  OTel creates the root span for the entire
 * request lifecycle; Sentry operates inside that span so the Sentry transaction
 * trace_id matches the OTel trace_id.
 */
const sentryWrapped = withSentry({ fetch: (request, env, ctx) => app.fetch(request, env, ctx) });

export default instrument(sentryWrapped, otelConfig);

/**
 * Re-exported so Cloudflare can register the binding declared in `wrangler.toml`. The DO runtime
 * imports the class by name from the Worker's exports.
 */
export { RateLimiter } from './rate-limiter.js';

/** Re-export `Env` for tests and downstream typing. */
export type { Env } from './types.js';
