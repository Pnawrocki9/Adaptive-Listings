---
id: TICKET-018
title: Ingest observability (OTel traces + Sentry + structured logs)
sprint: 1
priority: P0
agent: devops-engineer
status: BLOCKED
estimated_hours: 4
depends_on: [TICKET-012, TICKET-003]
produces: []
affects_files:
  - "apps/ingest/src/observability/spans.ts"
  - "apps/ingest/src/observability/logger.ts"
  - "apps/ingest/src/index.ts"
  - "apps/ingest/src/handlers/events.ts"
  - "apps/ingest/wrangler.toml"
  - "infra/observability/dashboards/ingest.json"
context_files:
  - apps/ingest/* (TICKET-012)
  - packages/shared/src/observability/* (TICKET-003)
  - .claude/agents/devops-engineer.md
labels: [sprint-1, p0, infra, observability]
---

# TICKET-018: Ingest observability

## Summary

Wire OpenTelemetry traces, Sentry error reporting, and structured logging into the ingest Worker. Every request emits a span tree with attributes (tenant_id, batch_size, latency, region). Failures emit Sentry events with context. Structured logs flow to Cloudflare's logs pipeline. Plus a Grafana dashboard JSON checked into the repo.

## Context

TICKET-003 set up the shared observability primitives in `packages/shared`. TICKET-012 implemented ingest. This ticket connects the two: every request through ingest emits a trace, every error emits a Sentry event, every important business event (rate-limited tenant, schema failure) emits a metric.

`@sentry/cloudflare` is the chosen Sentry integration for Workers. OpenTelemetry on Workers requires `@microlabs/otel-cf-workers` because the standard SDK isn't Worker-compatible.

## Scope

### In scope
- Install `@microlabs/otel-cf-workers` and `@sentry/cloudflare` in `apps/ingest`
- `apps/ingest/src/observability/spans.ts` — wraps Hono handler with OTel `instrument()` from microlabs library; configures OTLP HTTP exporter to Grafana Cloud (URL via env var)
- `apps/ingest/src/observability/logger.ts` — re-exports configured logger from packages/shared with service name set
- Update handlers to: emit spans with attributes (tenant_id, batch_size, region, validation_failures), log structured JSON, capture errors with Sentry
- Update `apps/ingest/wrangler.toml` to add env vars: `SENTRY_DSN_INGEST`, `OTEL_EXPORTER_URL`, `OTEL_EXPORTER_HEADERS`
- `infra/observability/dashboards/ingest.json` — Grafana dashboard JSON (importable) showing: req/sec, p50/p95/p99 latency, error rate, rate-limited tenants, schema-failure rate
- Document in `docs/runbooks/observability.md` (extends TICKET-003): how to find a request in traces, how to search logs, where ingest dashboard lives

### Out of scope
- Other apps' observability (their own tickets)
- Alerting / SLO tracking (Sprint 9)
- Custom metrics emission to Prometheus (use OTel metrics; Prometheus comes from Grafana Cloud aggregation)
- Cardinality controls beyond standard practice

## Acceptance criteria

- [ ] AC1: `apps/ingest/src/observability/spans.ts` exports `instrument(handler)` wrapper using @microlabs/otel-cf-workers
- [ ] AC2: Every POST /v1/events request emits a span with attributes: `tenant_id`, `batch_size`, `region`, `validation_failures`, `rate_limited` (boolean)
- [ ] AC3: Errors caught by handler logged to Sentry with: request context, tenant_id, error.code (if EstalaraError), trace_id propagation
- [ ] AC4: Structured logs emitted via Pino: every request → one info log with same attributes; failures → error log
- [ ] AC5: All observability gracefully degrades when env vars missing (no Sentry DSN → no Sentry init; no OTEL URL → no-op exporter)
- [ ] AC6: `infra/observability/dashboards/ingest.json` is valid Grafana dashboard JSON v8+, with at least 6 panels: req rate, latency histogram, error rate, p95 latency by tenant, rate-limit rejections, schema-failure rate
- [ ] AC7: Bundle size of ingest Worker after observability addition: < 200KB (was <100KB; observability adds ~50-100KB acceptable)
- [ ] AC8: All existing tests still pass; a new test verifies span is created with expected attributes (using `@microlabs/otel-cf-workers` test utilities or mock)
- [ ] AC9: PR title `feat(ingest): observability — otel + sentry + logs [TICKET-018]`

## Implementation guidance

For OTel:

```typescript
// apps/ingest/src/observability/spans.ts
import { instrument } from '@microlabs/otel-cf-workers';
import type { ResolveConfigFn, TraceConfigFn } from '@microlabs/otel-cf-workers';

const config: TraceConfigFn = (env: Env) => ({
  exporter: {
    url: env.OTEL_EXPORTER_URL ?? '',
    headers: env.OTEL_EXPORTER_HEADERS 
      ? Object.fromEntries(env.OTEL_EXPORTER_HEADERS.split(',').map(s => s.split('='))) 
      : {},
  },
  service: {
    name: 'estalara-ingest',
    version: env.GIT_SHA ?? 'dev',
  },
});

export { instrument, config };
```

In `index.ts`:

```typescript
import app from './app.js';
import { instrument, config } from './observability/spans.js';

export default instrument(app, config);
```

In handler, add span attributes:

```typescript
import { trace } from '@opentelemetry/api';

events.post('/', async c => {
  const span = trace.getActiveSpan();
  // ... existing logic ...
  span?.setAttributes({
    'estalara.tenant_id': tenant.tenant_id,
    'estalara.batch_size': body.events.length,
    'estalara.region': region,
    'estalara.validation_failures': rejected.length,
  });
  // ...
});
```

For Sentry:

```typescript
import { withSentry } from '@sentry/cloudflare';

export default {
  async fetch(request, env, ctx) {
    return withSentry(
      env => ({ dsn: env.SENTRY_DSN_INGEST, tracesSampleRate: 0.05 }),
      app.fetch
    )(request, env, ctx);
  },
};
```

(Order matters: instrument with OTel first, then Sentry; or vice versa per docs. Read both libraries' integration guides.)

## Test plan

- Unit: mock OTel exporter, verify span created with attributes for a successful request
- Unit: mock Sentry, verify error captured for a failing request
- Integration: verify Worker still functions with observability wrapping (existing TICKET-012 tests pass)
- Manual: deploy to staging, send curl request, verify span appears in Grafana Tempo within 30s

## Definition of Done

- [ ] Branch `devops-engineer/TICKET-018-ingest-observability`
- [ ] PR title above
- [ ] All ACs verified
- [ ] CI green via `gh pr checks <pr> --watch`
- [ ] Prettier clean
- [ ] Bundle size verified within budget

## Notes

- @microlabs/otel-cf-workers is the standard library for Worker OTel — actively maintained, used by Cloudflare itself.
- If bundle size blows budget, options: (1) tree-shake more aggressively, (2) lazy-load Sentry only on errors (manual trigger), (3) drop Sentry, just use OTel error events. Escalate before doing (2) or (3).
