# Observability Runbook — Estalara Adaptive Listings

**Owner:** devops-engineer  
**Last updated:** 2026-04-27  
**Related tickets:** TICKET-003

---

## Overview

Every Estalara service emits three signals via OpenTelemetry and Sentry:

| Signal  | Destination        | Tooling                           |
| ------- | ------------------ | --------------------------------- |
| Traces  | Grafana Tempo      | OTel SDK → Collector → Tempo      |
| Metrics | Grafana Prometheus | OTel SDK → Collector → Prometheus |
| Errors  | Sentry             | Sentry SDK (per-app)              |

This runbook explains the standard tags, how to add instrumentation, and how to find a trace given a
`request_id`.

---

## Standard tags

Every span, log line, and Sentry event carries these fields. **Never omit `service.name`.**

| Tag               | Where set                                        | Example        |
| ----------------- | ------------------------------------------------ | -------------- |
| `service.name`    | `createLogger()` / `createTracer()`              | `apps/ingest`  |
| `service.version` | Set from `GIT_SHA` env var at build time         | `a1b2c3d`      |
| `region`          | Injected by OTel Collector resource processor    | `eu-frankfurt` |
| `tenant_id`       | Application code (when request is tenant-scoped) | `uuid-v4`      |
| `trace_id`        | W3C `traceparent` header, propagated end-to-end  | (hex string)   |
| `request_id`      | `EstalaraError.request_id` or HTTP middleware    | `uuid-v4`      |

---

## How to create a structured log

Use `createLogger()` from `@estalara/shared/observability`. Never use `console.log` in production
services.

```typescript
import { createLogger } from '@estalara/shared/observability';

const logger = createLogger('apps/ingest');

// Info — lifecycle events
logger.info({ tenant_id: req.tenantId }, 'event received');

// Warn — recoverable issues
logger.warn({ event_id: id }, 'duplicate event; skipping');

// Error — failed operations
logger.error({ err, request_id: requestId }, 'failed to publish to Redpanda');
```

Log output is JSON in production (parsed by Grafana Loki) and pretty-printed in development
(`NODE_ENV=development`).

**Log level budget:** `debug` in dev only. `info` for request lifecycle, `warn` for recoverable
issues, `error` for failures, `fatal` for process death.

---

## How to add a span

Use `createTracer()` from `@estalara/shared/observability`:

```typescript
import { createTracer } from '@estalara/shared/observability';

const tracer = createTracer('apps/control-plane');

async function processListing(id: string) {
  return tracer.startActiveSpan('process-listing', async (span) => {
    span.setAttribute('listing.id', id);
    try {
      const result = await doWork(id);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err as Error);
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}
```

The tracer uses the global OTel provider. If no provider is registered (e.g. in unit tests), the SDK
returns a no-op tracer — no crash.

---

## How to throw and catch typed errors

```typescript
import { EstalaraError } from '@estalara/shared/observability';

// Throw
throw new EstalaraError({
  code: 'ERR_TENANT_NOT_FOUND',
  message: 'Tenant not found',
  details: { tenant_id: id },
  request_id: requestId,
});

// Catch at HTTP boundary
try {
  await handler(req, env);
} catch (err) {
  if (err instanceof EstalaraError) {
    return Response.json(err.toJSON(), { status: 404 });
  }
  throw err; // Let Sentry catch unexpected errors
}
```

`toJSON()` returns `{ code, message, details, request_id }` — safe to send to clients. Never include
secrets or PII in `details`.

---

## How to find a trace by request_id

1. Open Grafana → Explore → select **Tempo** datasource.
2. Query by tag: `request_id = "<uuid>"` or `trace_id = "<hex>"`.
3. Alternatively, search Sentry (estalara.sentry.io) by `request_id` in the issue search bar.

---

## Sentry — DSN configuration

| App                  | Env var                    | Runtime                                                                  |
| -------------------- | -------------------------- | ------------------------------------------------------------------------ |
| `apps/control-plane` | `SENTRY_DSN_CONTROL_PLANE` | Node.js (server), Edge, Browser (`NEXT_PUBLIC_SENTRY_DSN_CONTROL_PLANE`) |
| `apps/ingest`        | `SENTRY_DSN_INGEST`        | Cloudflare Worker V8 isolate                                             |

DSNs are stored in Doppler (project `estalara`, config `production`). When absent, Sentry is
silently disabled — no crash.

Sample rates: `tracesSampleRate: 0.05` in production, `0.1` in all other environments.

---

## OTel Collector

The skeleton collector config lives at `infra/observability/otel-collector.yaml`.

Local development:

```bash
docker run --rm -p 4317:4317 -p 4318:4318 \
  -v ./infra/observability/otel-collector.yaml:/etc/otel-collector.yaml \
  otel/opentelemetry-collector-contrib:latest \
  --config /etc/otel-collector.yaml
```

Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` in your service environment to send
telemetry to the local collector.

Sprint 1 will wire the Tempo and Prometheus exporters.

---

## Runbook — "I see no traces"

1. Check `OTEL_EXPORTER_OTLP_ENDPOINT` is set in the service's env.
2. Verify the OTel Collector is running and healthy: `curl http://localhost:13133`.
3. Confirm `GIT_SHA` is set — used as the release tag in Sentry and as the tracer version.
4. In Cloudflare Workers, confirm the `nodejs_compat` compatibility flag is enabled in
   `wrangler.toml` (required for OTel APIs).
5. Check Sentry → Project Settings → SDK Setup to verify DSN is active.
