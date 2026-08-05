/**
 * Sentry client-side (browser) initialisation for apps/control-plane.
 *
 * Loaded automatically by `@sentry/nextjs` via `withSentryConfig` in
 * `next.config.ts`. Sentry initialises only when
 * `NEXT_PUBLIC_SENTRY_DSN_CONTROL_PLANE` is present — absent env var = graceful
 * no-op. (This docstring previously named `SENTRY_DSN_CONTROL_PLANE`, which is
 * the SERVER/EDGE var and is not readable from the browser bundle; corrected
 * under FOLLOW-811. `docs/runbooks/observability.md:197` and
 * `docs/ops/DOPPLER_SECRETS_MATRIX.md:73` already named the `NEXT_PUBLIC_`
 * variant correctly — this file was the outlier.)
 *
 * No `beforeSend` redaction hook — deliberate (FOLLOW-811). Reasoning and
 * re-review triggers: `docs/compliance/dpia.md` §2.7.1; long form in
 * `sentry.server.config.ts`'s header. Pinned by
 * `src/lib/__tests__/sentry-config.shape.test.ts`.
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
    // Pinned explicitly — see sentry.server.config.ts for why the SDK default
    // is not relied on (FOLLOW-811 / dpia.md §2.7.1).
    sendDefaultPii: false,
    /**
     * Session Replay, wired but INERT at the sample rates above.
     *
     * The previous comment on this line read "Capture unhandled promise
     * rejections", which this integration does not do — that is
     * `globalHandlersIntegration`, a browser default that is on regardless.
     * Corrected under FOLLOW-811.
     *
     * Verified inert, not assumed: with both rates at 0,
     * `ReplayContainer.initializeSampling()` returns before creating a session
     * or attaching any recorder
     * (`@sentry-internal/replay@10.50.0`, `build/npm/cjs/index.js:8685-8691`) —
     * no DOM is read. What remains is the capability: Session Replay records
     * the admin dashboard's DOM, and it is one sample-rate line away. That is
     * named as an explicit re-review trigger in `docs/compliance/dpia.md` §2.7.1
     * — raising either rate above 0 requires a DPIA amendment first, because it
     * introduces a data category (rendered admin DOM) the DPIA does not cover.
     * Left in place rather than removed: it is pre-existing and deliberately
     * staged, and deleting it is not this ticket's decision to make.
     */
    integrations: [Sentry.replayIntegration()],
  });
}
