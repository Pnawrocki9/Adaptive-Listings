/**
 * Next.js instrumentation hook for apps/control-plane (FOLLOW-1442, P-7).
 *
 * `@sentry/nextjs` v10 loads `sentry.server.config.ts` and `sentry.edge.config.ts` ONLY through
 * this file; before it existed every server-side `Sentry.captureException` reached the console
 * only. Each config still no-ops without `SENTRY_DSN_CONTROL_PLANE`, so localhost is unaffected.
 * The configs themselves (including `requestDataIntegration({ include: { data: false } })`, which
 * keeps `xid` out of events) are untouched. See `docs/compliance/dpia.md` §2.7.1.
 *
 * @see https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */

import * as Sentry from '@sentry/nextjs';

/** Loads the Sentry config matching the runtime; no-op for any other `NEXT_RUNTIME`. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('../sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('../sentry.edge.config');
  }
}

/** Reports errors thrown in nested React Server Components, route handlers and middleware. */
export const onRequestError = Sentry.captureRequestError;
