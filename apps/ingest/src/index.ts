/**
 * Estalara ingest — Cloudflare Worker entry point.
 *
 * `POST /v1/events` accepts batched behavioral events from the SDK, validates each via
 * `EventSchema` from `@estalara/shared`, authenticates the tenant via API key (HMAC-signed for
 * server-side adapters), enriches with server timestamp + region, and pushes to Redpanda.
 *
 * `GET /health` returns liveness for uptime checks.
 *
 * Latency target: p95 < 50ms in production. Bundle stays small (<100 KB) — heavy work is in the
 * Modal stream consumer (TICKET-015).
 *
 * Out of scope here (handled by other tickets):
 * - Structured Sentry / OTel spans on hot path (TICKET-018)
 * - Idempotent batch dedup (TICKET-019)
 *
 * @module apps/ingest/src/index
 */

import type { ExportedHandler } from '@cloudflare/workers-types';

import { withSentry } from './observability.js';
import { createApp } from './router.js';
import type { Env } from './types.js';

const app = createApp();

const handler: ExportedHandler<Env> = {
  fetch: (request, env, ctx) => app.fetch(request, env, ctx),
};

export default withSentry(handler);

/**
 * Re-exported so Cloudflare can register the binding declared in `wrangler.toml`. The DO runtime
 * imports the class by name from the Worker's exports.
 */
export { RateLimiter } from './rate-limiter.js';

/** Re-export `Env` for tests and downstream typing. */
export type { Env } from './types.js';
