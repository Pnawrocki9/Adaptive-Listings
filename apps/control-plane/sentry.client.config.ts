/**
 * Sentry client-side (browser) initialisation for apps/control-plane.
 *
 * Loaded automatically by `@sentry/nextjs` via `withSentryConfig` in
 * `next.config.ts`. Sentry initialises only when `SENTRY_DSN_CONTROL_PLANE`
 * is present — absent env var = graceful no-op.
 *
 * @see https://docs.sentry.io/platforms/javascript/guides/nextjs/
 */

import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN_CONTROL_PLANE;
const release = process.env.NEXT_PUBLIC_GIT_SHA;
const environment = process.env.NODE_ENV;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: environment === 'production' ? 0.05 : 0.1,
    /**
     * Replay is opt-in and disabled here to stay under budget.
     * Enable in a later ticket with replaysSessionSampleRate.
     */
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    release,
    environment,
    // Capture unhandled promise rejections
    integrations: [Sentry.replayIntegration()],
  });
}
