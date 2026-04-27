---
id: TICKET-013
title: Durable Object rate limiting per tenant per minute
sprint: 1
priority: P0
agent: backend-engineer
status: BLOCKED
estimated_hours: 4
depends_on: [TICKET-012]
produces: []
affects_files:
  - "apps/ingest/src/rate-limiter.ts"
  - "apps/ingest/src/handlers/events.ts"
  - "apps/ingest/wrangler.toml"
  - "apps/ingest/tests/rate-limiter.test.ts"
context_files:
  - apps/ingest/src/index.ts (TICKET-012)
  - docs/MASTER_DESIGN.md (section C.2 — rate limits)
  - .claude/agents/backend-engineer.md
labels: [sprint-1, p0, backend, ingest, rate-limiting]
---

# TICKET-013: Durable Object rate limiting per tenant per minute

## Summary

Add per-tenant rate limiting to the ingest endpoint via Cloudflare Durable Objects. Each tenant gets one DO instance acting as a sliding-window counter. Default limit: 50,000 events/minute per tenant (overridable via tenant config field — but for MVP all tenants get default). Returns 429 with `Retry-After` header when exceeded. The DO itself is sharded by tenant_id to keep state regional and avoid global hot spots.

## Context

Master Design C.2 says peak target 70k events/sec across the whole platform. Per-tenant typical is much lower (a busy real estate site might hit 1k events/sec). Setting per-tenant limit at 50k/min (~833/sec) gives generous headroom while preventing abuse / runaway client bugs.

DO choice rationale: alternatives are KV (eventually consistent, bad for rate limit), Workers Analytics (read-only), external Redis (extra latency hop, extra cost). DO is purpose-built for this — strongly consistent, regional, embedded in the Worker.

## Scope

### In scope
- `apps/ingest/src/rate-limiter.ts` — Durable Object class `RateLimiter` with sliding window logic:
  - `incrementAndCheck(count: number): { allowed: boolean; remaining: number; reset_at: number }`
  - 60-second sliding window, 50,000 token capacity
  - Use `state.storage.get/put` for persistence
- Update `apps/ingest/src/handlers/events.ts` to call rate limiter before processing batch
- Update `apps/ingest/wrangler.toml` to declare `RateLimiter` class binding (already stubbed in TICKET-008)
- Tests:
  - Unit: rate limiter logic (allow under limit, reject over limit, reset after window)
  - Integration: 100 sequential 100-event batches succeed; 101st batch with 100 events that pushes over 10k boundary returns 429 (use a lower test limit)

### Out of scope
- Per-tenant overrides (Sprint 2 — when tenant config exists in Postgres)
- IP-based rate limiting (different concern — Cloudflare WAF in Sprint 9)
- Burst tokens (token bucket pattern) — fixed window suffices for MVP
- Cost / quota enforcement (billing concern — Sprint 7)

## Acceptance criteria

- [ ] AC1: `RateLimiter` Durable Object class exists in `apps/ingest/src/rate-limiter.ts`
- [ ] AC2: Class exported from Worker entry point so Cloudflare can register the binding
- [ ] AC3: `incrementAndCheck(count)` method returns `{ allowed, remaining, reset_at }` with correct sliding-window math
- [ ] AC4: Wrangler.toml declares `RateLimiter` as Durable Object class with binding name `RATE_LIMITER`
- [ ] AC5: Events handler calls rate limiter with batch size BEFORE processing; on `allowed: false`, returns 429 with `Retry-After` header set to seconds until window reset
- [ ] AC6: 429 response includes JSON body `{ error: 'rate_limited', limit: 50000, remaining: 0, reset_at: <epoch_ms> }`
- [ ] AC7: Unit tests cover: under limit allowed, exact limit allowed, over limit rejected, partial-batch (e.g. 1500 events when 1000 remaining → reject whole batch, not partial)
- [ ] AC8: Integration test: 50 sequential batches of 100 events under custom 10k limit succeeds; 51st batch returns 429
- [ ] AC9: All TICKET-012 tests still pass
- [ ] AC10: PR title `feat(ingest): durable object rate limiting [TICKET-013]`

## Implementation guidance

```typescript
// apps/ingest/src/rate-limiter.ts
export class RateLimiter {
  private state: DurableObjectState;
  
  constructor(state: DurableObjectState) {
    this.state = state;
  }
  
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/check') {
      const { count } = await request.json<{ count: number }>();
      const result = await this.incrementAndCheck(count);
      return Response.json(result);
    }
    return new Response('Not found', { status: 404 });
  }
  
  private async incrementAndCheck(count: number) {
    const LIMIT = parseInt(this.state.env?.RATE_LIMIT_PER_MIN ?? '50000', 10);
    const WINDOW_MS = 60_000;
    const now = Date.now();
    
    type Entry = { ts: number; count: number };
    const entries = (await this.state.storage.get<Entry[]>('window')) ?? [];
    
    // Drop entries outside window
    const fresh = entries.filter(e => now - e.ts < WINDOW_MS);
    const used = fresh.reduce((sum, e) => sum + e.count, 0);
    
    if (used + count > LIMIT) {
      const oldestTs = fresh.length > 0 ? fresh[0]!.ts : now;
      const reset_at = oldestTs + WINDOW_MS;
      return { allowed: false, remaining: Math.max(0, LIMIT - used), reset_at };
    }
    
    fresh.push({ ts: now, count });
    await this.state.storage.put('window', fresh);
    return { allowed: true, remaining: LIMIT - used - count, reset_at: now + WINDOW_MS };
  }
}
```

In handler:

```typescript
// apps/ingest/src/handlers/events.ts (additions)
const id = c.env.RATE_LIMITER.idFromName(tenant.tenant_id);
const stub = c.env.RATE_LIMITER.get(id);
const rateRes = await stub.fetch('https://internal/check', {
  method: 'POST',
  body: JSON.stringify({ count: body.events.length }),
});
const rate = await rateRes.json<{ allowed: boolean; remaining: number; reset_at: number }>();
if (!rate.allowed) {
  c.header('Retry-After', String(Math.ceil((rate.reset_at - Date.now()) / 1000)));
  return c.json({ error: 'rate_limited', ...rate }, 429);
}
```

In wrangler.toml:

```toml
[[durable_objects.bindings]]
name = "RATE_LIMITER"
class_name = "RateLimiter"

[[migrations]]
tag = "v1"
new_classes = ["RateLimiter"]
```

## Test plan

- Unit: 6 tests covering scenarios in AC7
- Integration: spin up `wrangler dev` with custom env `RATE_LIMIT_PER_MIN=10000`, fire 50 batches of 100 events sequentially with same API key (succeeds), then fire 51st (returns 429)

## Definition of Done

- [ ] Branch `backend-engineer/TICKET-013-do-rate-limiting`
- [ ] PR title above
- [ ] All ACs verified
- [ ] CI green via `gh pr checks <pr> --watch`
- [ ] Prettier clean

## Notes

- DO migration tag (`v1`) is required when introducing a new DO class. Don't forget it or wrangler deploy fails.
- Sliding window via list-of-entries is simple and correct for MVP. For 10x scale, switch to a more efficient ring-buffer in storage. Don't optimize prematurely.
