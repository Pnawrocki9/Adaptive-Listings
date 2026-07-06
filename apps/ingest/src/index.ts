/**
 * Estalara ingest — Cloudflare Worker entry point.
 *
 * `POST /v1/events` accepts batched behavioral events from the SDK, validates each via
 * `EventSchema` from `@estalara/shared`, authenticates the tenant via API key (HMAC-signed for
 * server-side adapters), enriches with server timestamp + region, and pushes to Redpanda.
 *
 * `GET /health` returns liveness for uptime checks.
 *
 * `queue()` (FOLLOW-482 / ADR-0017) consumes the `estalara-events-retry` Cloudflare Queue —
 * durable retry buffer for a post-ACK ClickHouse insert that failed all its in-process attempts
 * (see `handlers/events.ts` and `handlers/events-retry-consumer.ts`).
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

import { handleEventsRetryQueue } from './handlers/events-retry-consumer.js';
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
const instrumentedFetch = instrument(sentryWrapped, otelConfig).fetch;

/**
 * Cloudflare Worker default export. `queue` is a plain sibling of `fetch` — it is not routed
 * through `withSentry`/`instrument` (both are typed/configured for the fetch surface only in
 * this app); `handleEventsRetryQueue` captures its own Sentry events explicitly (Rule K.2), so
 * observability is not lost by staying outside that wrapper.
 */
export default {
  fetch: instrumentedFetch,
  queue: handleEventsRetryQueue,
};

/**
 * Re-exported so Cloudflare can register the binding declared in `wrangler.toml`. The DO runtime
 * imports the class by name from the Worker's exports.
 */
export { RateLimiter } from './rate-limiter.js';

/** Re-export `Env` for tests and downstream typing. */
export type { Env } from './types.js';
