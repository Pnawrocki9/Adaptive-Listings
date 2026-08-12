# Observability Runbook — Estalara Adaptive Listings

**Owner:** devops-engineer  
**Last updated:** 2026-05-01  
**Related tickets:** TICKET-003, TICKET-018

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

## Ingest Worker observability (TICKET-018)

The ingest Worker emits spans via `@microlabs/otel-cf-workers` (the standard OTel SDK is not
compatible with Cloudflare Workers). Every `POST /v1/events` request creates a span with these
custom attributes:

| Attribute                      | Type    | Description                               |
| ------------------------------ | ------- | ----------------------------------------- |
| `estalara.tenant_id`           | string  | Authenticated tenant UUID                 |
| `estalara.batch_size`          | integer | Number of events in the batch             |
| `estalara.region`              | string  | Region derived from `CF-IPCountry` header |
| `estalara.validation_failures` | integer | Events that failed `EventSchema` parsing  |
| `estalara.rate_limited`        | boolean | `true` if the batch was rate-limited      |

### How to find an ingest request in traces

1. Open Grafana → Explore → select **Tempo** datasource.
2. Search by tag: `estalara.tenant_id = "<uuid>"` or `service.name = "estalara-ingest"`.
3. Filter by time range matching when the request was received.
4. Click a trace to see the full span tree including auth, rate-limit check, validation, and push.

### How to search ingest logs

Logs are emitted as structured JSON via Pino to Cloudflare's log pipeline (Workers Logpush → Grafana
Loki).

1. Open Grafana → Explore → select **Loki** datasource.
2. Query: `{service_name="apps/ingest"}` — returns all ingest logs.
3. Filter by tenant: `{service_name="apps/ingest"} | json | tenant_id = "<uuid>"`.
4. Find failures: `{service_name="apps/ingest"} | json | level = "error"`.

Key log events:

| `msg` field            | Level | When emitted                                |
| ---------------------- | ----- | ------------------------------------------- |
| `events_accepted`      | info  | Batch successfully pushed to Redpanda       |
| `rate_limited`         | warn  | Batch rejected by rate limiter              |
| `auth_failed`          | warn  | API key missing or HMAC verification failed |
| `redpanda_push_failed` | error | All retry attempts to Redpanda exhausted    |
| `body_too_large`       | warn  | Request body exceeds 1 MB limit             |

### Grafana dashboard

Import `infra/observability/dashboards/ingest.json` into Grafana (Dashboards → Import → Upload
JSON). The dashboard requires a Prometheus and a Tempo datasource configured in Grafana Cloud.

Panels:

1. **Request Rate** — req/s over time
2. **Latency Histogram** — p50 / p95 / p99 in ms
3. **Error Rate** — 4xx + 5xx as a percentage of total requests
4. **p95 Latency by Tenant** — per-tenant breakdown for SLO tracking
5. **Rate-Limit Rejections** — 429 responses per second
6. **Schema-Failure Rate** — fraction of events that fail `EventSchema` validation

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

When absent, Sentry is silently disabled — **no crash, and no delayed send**: `Sentry.init()` is
never called, so every `captureMessage` / `captureException` in that app is a no-op.

**Where the value has to live is NOT Doppler.** Corrected 2026-08-12 (FOLLOW-965) — the previous
wording here said "DSNs are stored in Doppler (project `estalara`, config `production`)", which is
where a human puts them but **not** what either runtime reads:

| app                  | store read at runtime                            | proved by                                         |
| -------------------- | ------------------------------------------------ | ------------------------------------------------- |
| `apps/control-plane` | **Vercel project env** (`vercel env ls`)         | it is a Next.js app deployed on Vercel            |
| `apps/ingest`        | **Cloudflare Worker secret** (`wrangler secret`) | `docs/runbooks/INGEST_WORKER_DEPLOY.md` §register |

A Doppler read therefore proves nothing about either. The two stores have drifted before — see
`BRAND_PROVISIONING.md` §Step 0 on `FIRST_PARTY_TENANT_ID`.

Sample rates: `tracesSampleRate: 0.05` in production, `0.1` in all other environments.

---

## Control-plane Sentry signals — register and delivery status (FOLLOW-965)

**Read this before assuming the control plane is observable.** All **96 `Sentry.capture*` sites
across 55 files** in `apps/control-plane/src` are **INERT in production as of 2026-08-12**, for one
sufficient reason: no control-plane DSN exists in any Vercel environment, so `Sentry.init()` never
runs (`sentry.server.config.ts:33`, `sentry.edge.config.ts:20`, `sentry.client.config.ts:23`).

Measured, not inferred — `apps/control-plane`, 2026-08-12 (RETRO-269 / FOLLOW-965):

```
$ vercel env ls production        # 33 rows, none of them Sentry
$ vercel env ls | grep -ci sentry
0
```

### How to check it yourself — this is the part that was missing

The FOLLOW-965 failure was **not** that the DSN was absent. It was that nothing in the repo said
what to check, so two green CI gates (`Sentry init singleton guard` FOLLOW-738,
`Sentry capture-has-init guard` FOLLOW-743 — both assert an `init` call EXISTS in the repo) were
read as "signals are delivered". Run:

```bash
cd apps/control-plane
vercel env ls production  | grep -i sentry   # expect: SENTRY_DSN_CONTROL_PLANE  Encrypted  Production
vercel env ls preview     | grep -i sentry
vercel env ls development | grep -i sentry
```

| environment | `SENTRY_DSN_CONTROL_PLANE` | `NEXT_PUBLIC_SENTRY_DSN_CONTROL_PLANE` | measured   |
| ----------- | -------------------------- | -------------------------------------- | ---------- |
| Production  | **absent**                 | **absent**                             | 2026-08-12 |
| Preview     | **absent**                 | **absent**                             | 2026-08-12 |
| Development | **absent**                 | **absent**                             | 2026-08-12 |

**Presence is not delivery.** An `Encrypted` row proves the var exists, never that its value is a
working DSN pointing at a project somebody watches. To prove delivery you must **observe one event
arrive in the Sentry UI** — see "To arm the channel" below.

### Named signals (string-literal `captureMessage`)

Only these two carry a stable name, and both are cited **by name** in shipped documents — which is
why this register exists: those documents promised a Sentry event that could not be delivered.

| signal                             | fires when                                                                                                                                               | consumer |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `first_party_tenant_id_malformed`  | `FIRST_PARTY_TENANT_ID` is set but unparseable — the control-plane origin gate is degrading (FOLLOW-678)                                                 | **none** |
| `first_party_tenant_id_unresolved` | an AUTHORISATION decision was taken with no resolvable first-party identity, so platform-origin grants refuse with `first_party_unverified` (FOLLOW-957) | **none** |

The other 94 sites build their message at runtime (`captureMessage(msg, …)`) or are
`captureException`, so they cannot be named here. They are registered **by file and exact count** in
`apps/control-plane/src/observability-signals.test.ts`, each with a stated meaning — a new capture
site anywhere in the app fails that gate until somebody writes down what it means.

**"Consumer: none" is a recorded decision, not an oversight.** Naming it is what keeps the next
reader from mistaking a producer for observability (Rule AJ).

### To arm the channel

1. Create/choose the Sentry project and copy its DSN.
2. `vercel env add SENTRY_DSN_CONTROL_PLANE production` (and `preview`), plus
   `NEXT_PUBLIC_SENTRY_DSN_CONTROL_PLANE` if browser-side capture is wanted.
3. Redeploy — env changes do **not** apply to an existing deployment.
4. **Verify by OBSERVING a signal arrive**, not by concluding from the code that it would. Cheapest
   real one: request a control-plane route that captures on failure and confirm the event in the
   Sentry issue stream, then paste the transcript here with a date.
5. Re-derive every `consumer` cell above and in the register file. "The DSN is set" does not make a
   producer into observability; it only makes the channel exist.

### Re-verification trigger

Re-run the checks above whenever: a DSN is set or rotated; a Vercel project/environment is added;
any document or PR claims a control-plane failure is "visible in Sentry"; or 90 days pass while a
signal above is being cited as a diagnostic.

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

Set `OTEL_EXPORTER_URL=http://localhost:4318/v1/traces` in your service environment to send
telemetry to the local collector.

---

## Runbook — "I see no traces"

1. Check `OTEL_EXPORTER_URL` is set in the service's env (ingest uses this var; not the generic
   `OTEL_EXPORTER_OTLP_ENDPOINT`).
2. Verify the OTel Collector is running and healthy: `curl http://localhost:13133`.
3. Confirm `GIT_SHA` is set — used as the release tag in Sentry and as the tracer version.
4. In Cloudflare Workers, confirm the `nodejs_compat` compatibility flag is enabled in
   `wrangler.toml` (required for OTel APIs).
5. Check Sentry → Project Settings → SDK Setup to verify DSN is active.
