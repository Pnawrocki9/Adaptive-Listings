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

import type { ExecutionContext } from '@cloudflare/workers-types';
import { instrument } from '@microlabs/otel-cf-workers';

import { handleEventsRetryQueue } from './handlers/events-retry-consumer.js';
import { withSentry } from './observability.js';
import { otelConfig } from './observability/spans.js';
import { createApp } from './router.js';
import type { Env } from './types.js';

const app = createApp();

/**
 * The Hono app is wrapped first with Sentry (innermost), then with OTel
 * `instrument()` (outermost).  OTel creates the root span for the entire
 * request lifecycle; Sentry operates inside that span so the Sentry transaction
 * trace_id matches the OTel trace_id.
 *
 * `queue` is passed into `withSentry` in the SAME call as `fetch` (FOLLOW-513) —
 * `@sentry/cloudflare`'s `withSentry` instruments `fetch`, `scheduled`, `email`, `queue`, and
 * `tail` on the handler object it's given (verified against the installed `^10.50.0`
 * `instrumentExportedHandlerQueue`; its JSDoc only mentions `fetch` but the implementation
 * also wraps `queue`, initializing a bound Sentry client per invocation before
 * `handleEventsRetryQueue` runs). Passing only `{ fetch }` — as this used to do — left `queue` a
 * plain sibling that never got a bound client, so `Sentry.captureException` inside
 * `handleEventsRetryQueue` silently no-op'd on any isolate that hadn't already served a `fetch`.
 * `queue` is NOT routed through OTel `instrument()` here (unchanged from before FOLLOW-513) —
 * only the Sentry gap is in scope for this fix.
 */
const sentryWrapped = withSentry<Env>({
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => app.fetch(request, env, ctx),
  queue: handleEventsRetryQueue,
});

/**
 * `instrument()` (like `withSentry`) mutates the handler object it's given IN PLACE and, if that
 * object has a `.queue` property, wraps it too (verified against the installed
 * `@microlabs/otel-cf-workers@1.0.0-rc.52` `instrument()` — it wraps `fetch`/`scheduled`/`queue`/
 * `email` on whatever object is passed). Passing `sentryWrapped` directly here would silently add
 * OTel span instrumentation to the queue path as a side effect — out of scope for FOLLOW-513
 * (Sentry-binding only) and not something this fix should introduce. `sentryWrapped.queue` is
 * captured on its own line, and `instrument()` is given a FRESH object containing only `.fetch`,
 * so it can only ever touch the fetch surface — same behavior as before this fix.
 *
 * `assertBound` below replaces a non-null assertion with a real (if-this-ever-fails-fail-loud)
 * runtime check: `sentryWrapped` was constructed from a literal that always defines `fetch` and
 * `queue` (this is the SAME object reference `withSentry`/`instrument` mutate in place — see
 * `@sentry/cloudflare`'s `instrumentExportedHandlerFetch`/`...Queue`, which only ever replace an
 * existing property, never delete one); `ExportedHandler`'s fields are typed optional only because
 * the interface is shared with handlers that don't implement every trigger. If a future library
 * upgrade ever changed that contract, this throws at Worker module-init instead of silently
 * shipping an undefined `queue`/`fetch` handler.
 */
function assertBound<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`FOLLOW-513: withSentry/instrument did not return a ${label} handler`);
  }
  return value;
}

const sentryWrappedQueue = assertBound(sentryWrapped.queue, 'queue');
const instrumentedFetch = assertBound(
  instrument({ fetch: assertBound(sentryWrapped.fetch, 'fetch') }, otelConfig).fetch,
  'instrumented fetch',
);

/** Cloudflare Worker default export. */
export default {
  fetch: instrumentedFetch,
  queue: sentryWrappedQueue,
};

/**
 * Re-exported so Cloudflare can register the binding declared in `wrangler.toml`. The DO runtime
 * imports the class by name from the Worker's exports.
 */
export { RateLimiter } from './rate-limiter.js';

/** Re-export `Env` for tests and downstream typing. */
export type { Env } from './types.js';
