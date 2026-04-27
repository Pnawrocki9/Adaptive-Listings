/**
 * OpenTelemetry tracer factory for Estalara services.
 *
 * Uses the W3C TraceContext propagation format so `traceparent` headers flow
 * end-to-end across all services. Exporters (OTLP → Grafana Tempo) are
 * configured at the application level; this factory only creates a named
 * tracer scoped to the calling service.
 *
 * @module @estalara/shared/observability/tracer
 */

import { trace, type Tracer } from '@opentelemetry/api';

export type { Tracer };

/**
 * Returns an OpenTelemetry `Tracer` scoped to `serviceName`.
 *
 * The tracer uses the global OTel provider — call this after your app has
 * called `NodeSDK.start()` (or registered a provider in tests). If no
 * provider is registered the SDK silently returns a no-op tracer, so no
 * crash occurs in environments where OTel has not been initialised.
 *
 * @param serviceName - Identifies the service in traces, e.g. `apps/ingest`.
 * @returns An OTel `Tracer` instance.
 *
 * @example
 * ```ts
 * import { createTracer } from '@estalara/shared/observability';
 * const tracer = createTracer('apps/ingest');
 * const span = tracer.startSpan('handle-event');
 * // ... do work ...
 * span.end();
 * ```
 */
export function createTracer(serviceName: string): Tracer {
  return trace.getTracer(serviceName, process.env.GIT_SHA ?? 'dev');
}
