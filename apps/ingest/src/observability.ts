/**
 * Sentry instrumentation wrapper for the Estalara ingest Cloudflare Worker.
 *
 * Uses `@sentry/cloudflare` (NOT `@sentry/node` — Workers run in V8 isolates,
 * not Node.js). Wraps the ExportedHandler object with Sentry error capture
 * and tracing.
 *
 * When `SENTRY_DSN_INGEST` is absent from `env`, the original handler is
 * returned unchanged — graceful no-op.
 *
 * @module apps/ingest/src/observability
 *
 * @example
 * ```ts
 * import { withSentry } from './observability';
 *
 * const handler: ExportedHandler<Env> = { fetch: myFetchFn };
 * export default withSentry(handler);
 * ```
 */

import * as Sentry from '@sentry/cloudflare';

/**
 * Minimum set of environment bindings consumed by the observability wrapper.
 * Extend with additional Cloudflare Workers `env` fields as needed.
 */
export interface ObservabilityEnv {
  /** Sentry DSN for the ingest Worker. Absent = Sentry disabled. */
  SENTRY_DSN_INGEST?: string;
  /** Running environment: `production`, `staging`, or `development`. */
  ENVIRONMENT?: string;
  /** Git SHA injected at build time for release tagging. */
  GIT_SHA?: string;
  /**
   * OTLP HTTP exporter endpoint for OTel traces.
   * e.g. `https://otlp-gateway-prod-eu-west-0.grafana.net/otlp`
   * Absent = no-op exporter (graceful degradation).
   */
  OTEL_EXPORTER_URL?: string;
  /**
   * Comma-separated `key=value` pairs forwarded as HTTP headers to the OTLP
   * exporter. Used for Grafana Cloud authentication.
   * e.g. `Authorization=Basic <base64>`
   */
  OTEL_EXPORTER_HEADERS?: string;
}

/**
 * Wraps a Cloudflare `ExportedHandler` with Sentry error capture and
 * performance tracing.
 *
 * If `env.SENTRY_DSN_INGEST` is falsy when the Worker boots, the original
 * handler is returned untouched so the Worker continues to function without
 * Sentry.
 *
 * @param handler - The `ExportedHandler` object to wrap.
 * @returns The original handler or a Sentry-instrumented wrapper.
 *
 * @example
 * ```ts
 * const handler: ExportedHandler<Env> = {
 *   async fetch(request, env, ctx) { ... },
 * };
 * export default withSentry(handler);
 * ```
 */
export function withSentry<TEnv extends ObservabilityEnv>(
  handler: ExportedHandler<TEnv>,
): ExportedHandler<TEnv> {
  return Sentry.withSentry((env: TEnv) => {
    if (!env.SENTRY_DSN_INGEST) {
      // Return undefined to disable Sentry when DSN is absent.
      //
      // THIS BRANCH IS THE PRODUCTION PATH TODAY. [FOLLOW-937]
      //
      // `SENTRY_DSN_INGEST` is unset in prod, so every `Sentry.captureMessage` in this Worker is
      // a **no-op — not a delayed send**. Five named signals ride on it
      // (`first_party_tenant_id_malformed`, `origin_policy_unconfigured`, `origin_gate_rejected`,
      // `consent_gate_rejected`, `schema_rejected`) plus every `captureException`, and none of
      // them has a consumer. `wrangler.toml` declares neither `logpush` nor `tail_consumers`, so
      // the `logger` fallback reaches only somebody holding a live `wrangler tail`.
      //
      // That is a RECORDED state, not an oversight: the register and the arming procedure are in
      // `docs/runbooks/INGEST_WORKER_DEPLOY.md`, enforced by `observability-signals.test.ts`.
      // **Do not read a `captureMessage` call in this Worker as evidence that anyone is watching.**
      return undefined;
    }
    return {
      dsn: env.SENTRY_DSN_INGEST,
      tracesSampleRate: env.ENVIRONMENT === 'production' ? 0.05 : 0.1,
      release: env.GIT_SHA ?? 'dev',
      environment: env.ENVIRONMENT ?? 'development',
      /**
       * FOLLOW-845 / FOLLOW-811 — pinned explicitly, mirroring the three
       * `apps/control-plane/sentry.*.config.ts` files.
       *
       * A no-op TODAY: `@sentry/cloudflare@10.50.0` reads
       * `options.sendDefaultPii ?? false` (`build/cjs/sdk.js:14`, and again in
       * `build/cjs/request.js:42`), so the effective value was already `false`.
       * It is written down anyway because the vendor's own comment two lines
       * later — "TODO(v11): the `include` object should be defined directly in
       * the integration based on `sendDefaultPii`" — says this default is on
       * their list to change. This app handles raw buyer chat; the setting that
       * governs whether headers/cookies/IP ride along should be a decision in
       * our source, not an inherited default that a minor bump can flip.
       */
      sendDefaultPii: false,
    };
  }, handler);
}
