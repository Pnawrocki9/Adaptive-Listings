/**
 * Sentry server-side (Node.js) initialisation for apps/control-plane.
 *
 * Loaded automatically by `@sentry/nextjs` via `withSentryConfig` in
 * `next.config.ts`. Sentry initialises only when `SENTRY_DSN_CONTROL_PLANE`
 * is present — absent env var = graceful no-op.
 *
 * ## No `beforeSend` redaction hook — deliberate (FOLLOW-811)
 *
 * The decision and its re-review triggers are recorded in
 * `docs/compliance/dpia.md` §2.7.1. Read that section before adding one.
 *
 * Short form: the Python tier's hook (`_scrub_chat_intent_exception_value` in
 * `apps/intent-engine/src/observability.py`) is gated on an `area=chat_intent`
 * tag that no capture site in this app emits, because raw buyer chat text does
 * not enter this application — chat intent arrives already derived
 * (`src/lib/chat-intent-cache.ts`). Mirroring that hook here would add a
 * redaction control that can never fire, which is exactly the "documented
 * control that does not exist" defect FOLLOW-739 had to correct in the DPIA and
 * ROPA. A blanket scrub of the exception `value` is the other option and is
 * worse: this app has ~105 capture sites whose entire diagnostic payload is
 * `err.message`.
 *
 * Pinned by `src/lib/__tests__/sentry-config.shape.test.ts` (init options) and
 * `src/lib/__tests__/sentry-capture-path.test.ts` (real capture path, buyer-text
 * sentinel). If you add a hook, both fail — update §2.7.1 in the same PR.
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
    /**
     * Pinned explicitly even though the SDK default is already falsy. The
     * vendor has flagged intent to change what is attached based on this
     * option: `@sentry/core@10.50.0`, `build/cjs/integrations/requestdata.js:7`
     * carries `TODO(v11): Change defaults based on sendDefaultPii`. Stating it
     * here means a major bump cannot widen `user.ip` / request-header capture
     * without a diff in this file. (FOLLOW-811 / dpia.md §2.7.1.)
     */
    sendDefaultPii: false,
    // Capture all server-side unhandled exceptions
    autoInstrumentServerFunctions: true,
  });
}
