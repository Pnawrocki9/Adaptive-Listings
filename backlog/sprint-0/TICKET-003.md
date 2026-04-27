---
id: TICKET-003
title: Sentry + OpenTelemetry baseline instrumentation
sprint: 0
priority: P0
agent: devops-engineer
status: READY
estimated_hours: 4
depends_on: [TICKET-001]
produces: [TICKET-018]
affects_files:
  - 'packages/shared/src/observability/**'
  - 'apps/control-plane/sentry.client.config.ts'
  - 'apps/control-plane/sentry.server.config.ts'
  - 'apps/control-plane/sentry.edge.config.ts'
  - 'apps/ingest/src/observability.ts'
  - 'infra/observability/otel-collector.yaml'
  - 'package.json'
  - 'docs/runbooks/observability.md'
context_files:
  - docs/MASTER_DESIGN.md (section I — observability stack)
  - docs/CONVENTIONS.md (logging, error handling)
  - .claude/agents/devops-engineer.md
labels: [foundation, p0, infra, observability]
---

# TICKET-003: Sentry + OpenTelemetry baseline instrumentation

## Summary

Wire Sentry SDK and OpenTelemetry into the monorepo so every app emits structured traces, metrics,
and errors from day 1. This ticket installs the libraries, sets up shared instrumentation utilities
in `packages/shared/src/observability/`, and configures Sentry for the two TS apps that exist
(`apps/control-plane`, `apps/ingest`). No dashboards or alerts yet — just plumbing.

## Context

Master Design section I lists Sentry + OpenTelemetry + Grafana as our observability stack. Standard
tags on every span/log per `.claude/agents/devops-engineer.md`:

- `service.name` (e.g., `apps/ingest`)
- `service.version` (git SHA at build time)
- `region` (where workload runs)
- `tenant_id` (when applicable; low-cardinality alternative)
- `trace_id` propagated end-to-end

This ticket establishes the libraries and shared utilities. Real instrumentation of business logic
happens per-app in later tickets (TICKET-018 for ingest specifically).

## Scope

### In scope

- Install in monorepo workspace dependencies:
  - `@sentry/nextjs` for control-plane
  - `@sentry/cloudflare` for ingest worker (NOT `@sentry/node` — it's a Worker)
  - `@opentelemetry/api`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/sdk-trace-node`
    (apps/control-plane Node runtime)
  - `@opentelemetry/sdk-trace-web` for any browser-side instrumentation later
  - Pino logger (`pino`, `pino-pretty` for dev) in `packages/shared`
- Create `packages/shared/src/observability/`:
  - `logger.ts` — Pino factory `createLogger(serviceName)` returning a pre-tagged logger
  - `tracer.ts` — OpenTelemetry tracer factory `createTracer(serviceName)`
  - `error.ts` — typed error class `EstalaraError` with `code`, `message`, `details`, `request_id`
  - `index.ts` — re-exports
- Configure Sentry for `apps/control-plane`:
  - `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`
  - DSN read from `SENTRY_DSN_CONTROL_PLANE` env var
  - Configure `tracesSampleRate: 0.1` for dev, `0.05` for prod
- Configure Sentry for `apps/ingest`:
  - `apps/ingest/src/observability.ts` — wraps Hono fetch handler with Sentry
  - DSN read from `SENTRY_DSN_INGEST` env var
- Add OTel collector config skeleton at `infra/observability/otel-collector.yaml`
- Write `docs/runbooks/observability.md` covering: how to read Sentry, how to query logs, what tags
  mean
- All Sentry/OTel imports gated by env var presence — if env var missing, no-op (don't crash app)

### Out of scope

- Configuring real Sentry projects (need org account creation first — assume DSNs provisioned later)
- Grafana dashboards / Loki / Tempo setup — Sprint 1+
- Custom span instrumentation for business logic — per-app tickets
- Alerts / SLO tracking — Sprint 9 / 10

## Acceptance criteria

- [ ] AC1: `packages/shared/src/observability/logger.ts` exports
      `createLogger(serviceName: string): Logger` returning Pino instance pre-tagged with
      `service.name`, `service.version` (from `process.env.GIT_SHA ?? 'dev'`)
- [ ] AC2: `packages/shared/src/observability/tracer.ts` exports `createTracer(serviceName: string)`
      using OpenTelemetry SDK, propagating W3C TraceContext headers
- [ ] AC3: `packages/shared/src/observability/error.ts` exports `EstalaraError` class with stable
      `code` field, `toJSON()` method, `request_id` getter
- [ ] AC4: `apps/control-plane` has `sentry.client.config.ts` etc. — Sentry initializes only if
      `SENTRY_DSN_CONTROL_PLANE` is set
- [ ] AC5: `apps/ingest` has `src/observability.ts` — Sentry wraps Hono handler only if
      `SENTRY_DSN_INGEST` is set
- [ ] AC6: `infra/observability/otel-collector.yaml` is valid YAML and references at least:
      receivers (otlp), processors (batch, memory_limiter), exporters (logging for now, will swap to
      Tempo/Prometheus later)
- [ ] AC7: `docs/runbooks/observability.md` covers: standard tags, how to add a span, how to log
      structured data, how to find traces by request_id; minimum 250 words
- [ ] AC8: All apps still build, lint, typecheck, test pass with new dependencies
- [ ] AC9: Bundle size for `apps/ingest` Worker stays under existing budget (Sentry/Cloudflare adds
      ~15KB; if it pushes over, escalate)
- [ ] AC10: PR title `feat(infra): sentry + otel baseline [TICKET-003]`

## Implementation guidance

For Cloudflare Workers, do NOT use `@sentry/node`. Use `@sentry/cloudflare` which is purpose-built
for Workers. Example:

```typescript
// apps/ingest/src/observability.ts
import * as Sentry from '@sentry/cloudflare';

export function withSentry<T extends (...args: any[]) => any>(handler: T, env: Env): T {
  if (!env.SENTRY_DSN_INGEST) return handler;

  return Sentry.withSentry(
    () => ({
      dsn: env.SENTRY_DSN_INGEST,
      tracesSampleRate: env.ENVIRONMENT === 'production' ? 0.05 : 0.1,
      release: env.GIT_SHA,
    }),
    handler,
  );
}
```

For Pino logger:

```typescript
// packages/shared/src/observability/logger.ts
import pino from 'pino';

export function createLogger(serviceName: string) {
  return pino({
    base: {
      service: { name: serviceName, version: process.env.GIT_SHA ?? 'dev' },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    level: process.env.LOG_LEVEL ?? 'info',
    transport: process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
  });
}
```

The `EstalaraError` class:

```typescript
// packages/shared/src/observability/error.ts
export class EstalaraError extends Error {
  code: string;
  details?: Record<string, unknown>;
  request_id: string;

  constructor(args: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
    request_id?: string;
  }) {
    super(args.message);
    this.code = args.code;
    this.details = args.details;
    this.request_id = args.request_id ?? crypto.randomUUID();
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      request_id: this.request_id,
    };
  }
}
```

## Test plan

- Unit: `packages/shared/src/observability/*.test.ts` — at least 5 tests:
  1. `createLogger` returns Pino with correct base tags
  2. `createTracer` returns valid OTel Tracer (mock spans)
  3. `EstalaraError.toJSON()` produces expected shape
  4. Sentry init is no-op when DSN env var missing
  5. Sentry init succeeds when DSN env var present
- Integration: smoke test that `apps/control-plane` builds and `apps/ingest` builds with new deps
- Bundle size: verify ingest Worker stays under (TBD — current budget set in TICKET-001 ~50KB
  target)

## Definition of Done

- [ ] Branch `devops-engineer/TICKET-003-sentry-otel-baseline`
- [ ] Conventional commits with TICKET-003 reference
- [ ] PR opened with correct title
- [ ] All ACs verified
- [ ] CI fully green via `gh pr checks <pr> --watch`
- [ ] `pnpm exec prettier --check .` returns clean
- [ ] No new top-level deps in root `package.json` (deps go in `packages/shared` and per-app
      `package.json`)
- [ ] `docs/runbooks/observability.md` discoverable from `docs/CONVENTIONS.md`

## Notes

- DSNs (the actual Sentry endpoint URLs) come later when Anthropic Sentry org is created. For now,
  dev defaults to undefined → Sentry is no-op, which is fine.
- Escalate if `@sentry/cloudflare` bundle size pushes ingest Worker over budget.
