/**
 * Sentry Edge Runtime initialisation for apps/control-plane.
 *
 * Used by Next.js middleware and Edge API routes. Runs in the V8 isolate
 * (Edge Runtime) — only a subset of Node.js APIs is available.
 *
 * Sentry initialises only when `SENTRY_DSN_CONTROL_PLANE` is present —
 * absent env var = graceful no-op.
 *
 * No `beforeSend` redaction hook — deliberate (FOLLOW-811). The reasoning and
 * the re-review triggers live in `docs/compliance/dpia.md` §2.7.1; the long-form
 * summary is in `sentry.server.config.ts`'s header. Pinned by
 * `src/lib/__tests__/sentry-config.shape.test.ts`.
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
    // Pinned explicitly — see sentry.server.config.ts for why the SDK default
    // is not relied on (FOLLOW-811 / dpia.md §2.7.1).
    sendDefaultPii: false,
  });
}
