---
id: TICKET-019
title: HTTP error handling + idempotency contract (event_id deduplication)
sprint: 1
priority: P0
agent: backend-engineer
status: BLOCKED
estimated_hours: 3
depends_on: [TICKET-012]
produces: []
affects_files:
  - 'apps/ingest/src/handlers/events.ts'
  - 'apps/ingest/src/middleware/error-handler.ts'
  - 'apps/ingest/src/middleware/idempotency.ts'
  - 'apps/ingest/tests/error-handling.test.ts'
  - 'apps/ingest/tests/idempotency.test.ts'
  - 'docs/runbooks/ingest-errors.md'
context_files:
  - apps/ingest/src/handlers/events.ts (TICKET-012)
  - packages/shared/src/observability/error.ts (TICKET-003)
  - .claude/agents/backend-engineer.md
labels: [sprint-1, p0, backend, ingest, reliability]
---

# TICKET-019: HTTP error handling + idempotency contract

## Summary

Two reliability features bolted onto the ingest endpoint:

1. **Standardized error response shape:** every error response uses
   `{ error: { code, message, request_id, details? } }`. Errors classified by HTTP status. Common
   error codes documented.
2. **Idempotency:** SDK can retry a failed batch safely. Server deduplicates on `event_id` within a
   24h window. We use Cloudflare KV with TTL for dedup state (simple, fast, eventually consistent —
   acceptable for our case since at-least-once delivery via Redpanda already requires consumers to
   dedup on event_id at storage level).

These are small but important reliability features that prevent client retries from causing data
duplication or confusion.

## Context

Without idempotency: SDK times out → retries → server processes batch twice → ClickHouse has
duplicate rows. ClickHouse's `MergeTree` deduplicates on `event_id` during background merges
(eventually), but for analytics queries running in the meantime, duplicates skew counts.

With server-side idempotency at ingest layer: dedup happens at request time, before push to
Redpanda. Cleaner.

Cost: KV write per event_id is expensive at scale (10M events/day = 10M KV writes = $10/day =
$300/month for dedup alone). So we shard: KV write per `batch_id` (the UUID we generate per
request), not per event. SDK retries with same `Idempotency-Key` header → server returns cached
batch response.

## Scope

### In scope

- `apps/ingest/src/middleware/error-handler.ts` — Hono middleware that catches uncaught errors,
  formats response, captures to Sentry (via TICKET-018 setup)
- `apps/ingest/src/middleware/idempotency.ts` — middleware reading `Idempotency-Key` header; on
  duplicate, returns cached response from KV
- Update events handler to:
  - Generate stable `request_id` early in lifecycle
  - Wrap all business logic in try/catch
  - Return standard error shape on every failure
  - Honor `Idempotency-Key` if present
- New CF KV namespace: `KV_IDEMPOTENCY` (cache batch responses, TTL 24h)
- Tests for both error handler and idempotency middleware
- `docs/runbooks/ingest-errors.md` — table of all error codes ingest can emit, with: code, HTTP
  status, when it occurs, what client should do

### Out of scope

- Idempotency for non-event endpoints (just /v1/events for now)
- Idempotency at storage level (Redpanda + ClickHouse handle that)
- Custom retry budgets per tenant (Sprint 7+)

## Acceptance criteria

- [ ] AC1: `error-handler.ts` middleware: catches errors, returns
      `{ error: { code, message, request_id, details? } }`, sets request_id header on response
- [ ] AC2: Defined error codes (at minimum): `validation_failed` (400), `unauthorized` (401),
      `payload_too_large` (413), `rate_limited` (429), `redpanda_unavailable` (503),
      `internal_error` (500)
- [ ] AC3: `idempotency.ts` middleware: reads `Idempotency-Key` header; on hit returns cached
      response with `Idempotency-Replay: true` header; on miss processes request and caches response
      (key, status, body) with 24h TTL
- [ ] AC4: Idempotency Key format: 32-128 chars, ASCII printable; reject malformed with 400
- [ ] AC5: Updated wrangler.toml has `KV_IDEMPOTENCY` binding
- [ ] AC6: Unit tests: 6+ for error handler (each error code), 5+ for idempotency (cache hit, cache
      miss, malformed key, key too long, concurrent requests with same key)
- [ ] AC7: All previous TICKET-012/013 tests still pass
- [ ] AC8: `docs/runbooks/ingest-errors.md` covers all error codes with: status, cause, client
      action; minimum 250 words
- [ ] AC9: PR title `feat(ingest): error handling + idempotency [TICKET-019]`

## Implementation guidance

```typescript
// apps/ingest/src/middleware/error-handler.ts
import type { MiddlewareHandler } from 'hono';
import { EstalaraError } from '@estalara/shared/observability';

export const errorHandler: MiddlewareHandler = async (c, next) => {
  const requestId = crypto.randomUUID();
  c.header('X-Request-ID', requestId);

  try {
    await next();
  } catch (err) {
    const e = err as Error;
    if (e instanceof EstalaraError) {
      return c.json(
        { error: { code: e.code, message: e.message, request_id: requestId, details: e.details } },
        statusFromCode(e.code),
      );
    }

    // Unknown error
    console.error({ requestId, error: e.message, stack: e.stack }, 'unhandled');
    return c.json(
      {
        error: { code: 'internal_error', message: 'Internal server error', request_id: requestId },
      },
      500,
    );
  }
};

function statusFromCode(code: string): number {
  const map: Record<string, number> = {
    validation_failed: 400,
    unauthorized: 401,
    payload_too_large: 413,
    rate_limited: 429,
    redpanda_unavailable: 503,
    internal_error: 500,
  };
  return map[code] ?? 500;
}
```

```typescript
// apps/ingest/src/middleware/idempotency.ts
export const idempotency: MiddlewareHandler<{ Bindings: { KV_IDEMPOTENCY: KVNamespace } }> = async (
  c,
  next,
) => {
  const key = c.req.header('Idempotency-Key');
  if (!key) return next();

  if (key.length < 32 || key.length > 128 || !/^[\x20-\x7e]+$/.test(key)) {
    return c.json(
      { error: { code: 'validation_failed', message: 'Idempotency-Key malformed' } },
      400,
    );
  }

  const cached = await c.env.KV_IDEMPOTENCY.get(`idem:${key}`, 'json');
  if (cached) {
    c.header('Idempotency-Replay', 'true');
    return c.json((cached as any).body, (cached as any).status);
  }

  await next();

  // Cache the response (only successful responses)
  if (c.res.status >= 200 && c.res.status < 300) {
    const body = await c.res.clone().json();
    await c.env.KV_IDEMPOTENCY.put(
      `idem:${key}`,
      JSON.stringify({ status: c.res.status, body }),
      { expirationTtl: 86400 }, // 24h
    );
  }
};
```

## Test plan

- Unit: error handler — every error code returns expected shape & status
- Unit: idempotency — cache hit returns same body, cache miss processes and caches, malformed key
  rejected, key too long rejected
- Integration: same Idempotency-Key sent twice → second call returns same body with
  Idempotency-Replay header
- Race condition test: two concurrent requests with same idempotency key — both should get same
  response (last-writer-wins on cache; acceptable for at-least-once)

## Definition of Done

- [ ] Branch `backend-engineer/TICKET-019-error-handling-idempotency`
- [ ] PR title above
- [ ] All ACs verified
- [ ] CI green via `gh pr checks <pr> --watch`
- [ ] Prettier clean
- [ ] Runbook discoverable from main observability runbook

## Notes

- The race-condition behavior (two concurrent same-key requests) is "best effort": KV is eventually
  consistent. Document this in runbook. For real "exactly-once" you'd need DO-backed idempotency
  (slower, more expensive). Defer.
- Idempotency-Key is RFC 8959 recommended pattern (Stripe et al. use it).
