/**
 * Sentry server-side (Node.js) initialisation for apps/control-plane.
 *
 * Loaded automatically by `@sentry/nextjs` via `withSentryConfig` in
 * `next.config.ts`. Sentry initialises only when `SENTRY_DSN_CONTROL_PLANE`
 * is present — absent env var = graceful no-op.
 *
 * @see https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN_CONTROL_PLANE;
const release = process.env.GIT_SHA;
const environment = process.env.NODE_ENV;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: environment === 'production' ? 0.05 : 0.1,
    release,
    environment,
    // Capture all server-side unhandled exceptions
    autoInstrumentServerFunctions: true,
  });
}
