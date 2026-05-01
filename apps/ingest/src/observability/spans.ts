/**
 * OpenTelemetry instrumentation for the Estalara ingest Cloudflare Worker.
 *
 * Uses `@microlabs/otel-cf-workers` — the standard OTel SDK is NOT compatible
 * with Cloudflare Workers (V8 isolates, no Node.js APIs). This library wraps
 * the `ExportedHandler` with an OTLP HTTP exporter that works within the
 * Workers runtime.
 *
 * When `OTEL_EXPORTER_URL` is absent the library falls back to localhost, but
 * since that URL won't be reachable in production without the env var set the
 * spans will simply be dropped — the Worker continues to function normally.
 *
 * @module apps/ingest/src/observability/spans
 */

import { instrument, type ResolveConfigFn, type TraceConfig } from '@microlabs/otel-cf-workers';

export { instrument };
export type { ResolveConfigFn, TraceConfig };

interface OtelEnv {
  OTEL_EXPORTER_URL?: string;
  OTEL_EXPORTER_HEADERS?: string;
  GIT_SHA?: string;
  [key: string]: unknown;
}

/**
 * OTel trace configuration factory — called once per Worker instantiation by
 * `@microlabs/otel-cf-workers`. Reads runtime env vars so the Worker can be
 * deployed to multiple environments without a code change.
 */
export const otelConfig: ResolveConfigFn<OtelEnv> = (
  env: OtelEnv,
  _trigger: unknown,
): TraceConfig => {
  const url = (env.OTEL_EXPORTER_URL ?? '').trim();
  const headersRaw = (env.OTEL_EXPORTER_HEADERS ?? '').trim();

  const headers: Record<string, string> = {};
  if (headersRaw) {
    for (const pair of headersRaw.split(',')) {
      const eqIdx = pair.indexOf('=');
      if (eqIdx > 0) {
        const k = pair.slice(0, eqIdx).trim();
        const v = pair.slice(eqIdx + 1).trim();
        if (k) headers[k] = v;
      }
    }
  }

  return {
    exporter: {
      url: url || 'http://localhost:4318/v1/traces',
      headers,
    },
    service: {
      name: 'estalara-ingest',
      version: (env.GIT_SHA ?? 'dev').trim() || 'dev',
    },
  };
};
