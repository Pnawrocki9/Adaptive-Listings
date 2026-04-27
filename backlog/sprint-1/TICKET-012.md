---
id: TICKET-012
title: Cloudflare Worker ingest MVP (validate + auth + push to Redpanda)
sprint: 1
priority: P0
agent: backend-engineer
status: BLOCKED
estimated_hours: 8
depends_on: [TICKET-011]
produces: [TICKET-013, TICKET-015, TICKET-016, TICKET-017, TICKET-018, TICKET-019]
affects_files:
  - "apps/ingest/src/index.ts"
  - "apps/ingest/src/router.ts"
  - "apps/ingest/src/handlers/events.ts"
  - "apps/ingest/src/auth.ts"
  - "apps/ingest/src/redpanda-producer.ts"
  - "apps/ingest/wrangler.toml"
  - "apps/ingest/tests/**"
context_files:
  - docs/MASTER_DESIGN.md (sections C.2 — ingestion strategy, J.2 — API key)
  - packages/shared/src/schemas/event.ts
  - apps/ingest/wrangler.toml (TICKET-008)
  - .claude/agents/backend-engineer.md
labels: [sprint-1, p0, backend, ingest, cloudflare]
---

# TICKET-012: Cloudflare Worker ingest MVP

## Summary

Implement the actual ingest endpoint as a Cloudflare Worker using Hono framework. Endpoint: `POST /v1/events` accepts a batch of events, validates each against `EventSchema` (from TICKET-011), authenticates via API key (HMAC), enriches with server timestamp + IP-derived region, pushes to Redpanda, returns 200 with batch ack. Latency target: p95 < 50ms. Stateless Worker only — Durable Object rate limiting is TICKET-013, observability is TICKET-018.

This is the first real backend functionality. After this ticket, the system can accept events from a curl command (TICKET-016 smoke test will prove that).

## Context

Master Design C.2: Worker validates, authenticates, rate-limits, pushes. Heavy work happens in stream consumers downstream (TICKET-015). The Worker stays small (target <50KB minified bundle) and fast.

Authentication: tenant sends API key in `X-Estalara-API-Key` header. Worker reads tenant ID from key, looks up HMAC secret (from KV/cache for now — Postgres lookup in Sprint 2), verifies. For MVP use Cloudflare Workers KV for the lookup (acceptable in dev/staging). Production lookup will hit Supabase via cached connection.

For Redpanda: use the `kafkajs` library with TLS connection. **But** kafkajs doesn't run on Workers natively (no Node `net` module). Workaround for MVP: use Redpanda's HTTP REST proxy (Schema Registry/Pandaproxy) and POST events to it. This is slower than native Kafka client but works in Workers. Real solution (native Kafka client) ships in Sprint 4 if perf demands it.

## Scope

### In scope
- `apps/ingest/src/index.ts` — main Worker fetch handler, instantiates Hono app
- `apps/ingest/src/router.ts` — Hono routes: `POST /v1/events`, `GET /health`
- `apps/ingest/src/handlers/events.ts` — POST /v1/events handler:
  1. Parse body (max 1MB, max 1000 events per batch)
  2. Validate API key
  3. Validate each event with `EventSchema.array().parse(...)`
  4. Enrich: add server `ingest_received_at`, IP-derived `region` (from `CF-IPCountry`)
  5. Push batch to Redpanda via REST proxy
  6. Return 200 with `{ accepted: N, rejected: M, errors?: [...] }`
- `apps/ingest/src/auth.ts` — API key validation (HMAC, lookup via env-injected KV)
- `apps/ingest/src/redpanda-producer.ts` — REST proxy producer client, retry with exponential backoff (max 3 attempts)
- Update `apps/ingest/wrangler.toml` to add `KV_API_KEYS` binding, `REDPANDA_REST_URL` env var
- Tests:
  - Unit: handler logic, auth, producer retry
  - Integration: Wrangler dev mode, curl events through end-to-end (mock KV + mock REST proxy)

### Out of scope
- Durable Object rate limiting (TICKET-013)
- Observability (TICKET-018)
- Idempotency dedup (TICKET-019)
- Real Postgres tenant lookup (Sprint 2 will replace KV with cached Postgres)
- Native Kafka client (Sprint 4 if needed)

## Acceptance criteria

- [ ] AC1: `apps/ingest/src/index.ts` exports a Worker fetch handler that returns 200 on `GET /health`
- [ ] AC2: `POST /v1/events` accepts JSON body `{ events: Event[] }`, validates schema, returns 400 with details on schema failure
- [ ] AC3: Returns 401 if `X-Estalara-API-Key` missing or invalid
- [ ] AC4: Returns 413 if body exceeds 1MB or events exceed 1000 in batch
- [ ] AC5: Returns 200 with `{ accepted: N, rejected: 0, batch_id: <uuid> }` on success; rejected events reported individually with index + error reason
- [ ] AC6: Each event enriched with `ingest_received_at` (server time) and `region` (from CF-IPCountry header) before push to Redpanda
- [ ] AC7: Redpanda push retries 3x with exponential backoff (100ms, 500ms, 2.5s), then returns 503
- [ ] AC8: Unit tests cover: valid batch, schema failure, auth failure, body too large, batch too large, Redpanda failure with retry success, Redpanda failure with retry exhaustion
- [ ] AC9: Integration test with `wrangler dev` + mock Redpanda: end-to-end POST → expected response shape
- [ ] AC10: Latency benchmark on `wrangler dev`: 100 sequential POSTs of 10-event batches, p95 < 80ms (will improve to <50ms when Worker runs in real Cloudflare edge)
- [ ] AC11: Bundle size < 100KB minified (Worker limit is 1MB, but we want headroom)
- [ ] AC12: PR title `feat(ingest): worker MVP with validate + auth + redpanda push [TICKET-012]`

## Implementation guidance

Hono is the framework choice. Example structure:

```typescript
// apps/ingest/src/index.ts
import { Hono } from 'hono';
import { events } from './handlers/events.js';

type Env = {
  KV_API_KEYS: KVNamespace;
  REDPANDA_REST_URL: string;
  REDPANDA_API_KEY: string;
};

const app = new Hono<{ Bindings: Env }>();
app.get('/health', c => c.json({ status: 'ok', service: 'estalara-ingest' }));
app.route('/v1/events', events);

export default app;
```

```typescript
// apps/ingest/src/handlers/events.ts
import { Hono } from 'hono';
import { EventSchema } from '@estalara/shared';
import { validateApiKey } from '../auth.js';
import { pushToRedpanda } from '../redpanda-producer.js';

export const events = new Hono<{ Bindings: Env }>();

events.post('/', async c => {
  const apiKey = c.req.header('X-Estalara-API-Key');
  if (!apiKey) return c.json({ error: 'Missing API key' }, 401);
  
  const tenant = await validateApiKey(apiKey, c.env.KV_API_KEYS);
  if (!tenant) return c.json({ error: 'Invalid API key' }, 401);
  
  const body = await c.req.json();
  if (!Array.isArray(body.events) || body.events.length === 0)
    return c.json({ error: 'events array required' }, 400);
  if (body.events.length > 1000)
    return c.json({ error: 'batch too large (max 1000)' }, 413);
  
  const region = c.req.header('CF-IPCountry') ? mapCountryToRegion(c.req.header('CF-IPCountry')!) : 'eu';
  const ingestReceivedAt = Date.now();
  
  const validated = [];
  const rejected = [];
  for (const [i, event] of body.events.entries()) {
    const parsed = EventSchema.safeParse(event);
    if (!parsed.success) {
      rejected.push({ index: i, errors: parsed.error.flatten() });
      continue;
    }
    validated.push({ ...parsed.data, region, ingest_received_at: ingestReceivedAt });
  }
  
  const batchId = crypto.randomUUID();
  
  if (validated.length > 0) {
    const pushResult = await pushToRedpanda(validated, c.env);
    if (!pushResult.ok) return c.json({ error: 'redpanda unavailable' }, 503);
  }
  
  return c.json({ accepted: validated.length, rejected: rejected.length, errors: rejected, batch_id: batchId });
});
```

For Redpanda REST proxy, see https://docs.redpanda.com/current/develop/http-proxy/.

For testing, use `vitest` + `@cloudflare/vitest-pool-workers`:

```typescript
// apps/ingest/tests/handlers/events.test.ts
import { describe, it, expect } from 'vitest';
import { SELF } from 'cloudflare:test';

describe('POST /v1/events', () => {
  it('rejects missing API key', async () => {
    const res = await SELF.fetch('https://test/v1/events', {
      method: 'POST',
      body: JSON.stringify({ events: [] }),
    });
    expect(res.status).toBe(401);
  });
  // ...
});
```

## Test plan

- Unit: 12+ test cases (per AC8)
- Integration: `wrangler dev` + curl flow validates 200 path end-to-end with mock backend
- Manual smoke: deploy to staging, curl with real test API key, verify 200 + Redpanda received message (TICKET-016 formalizes this)

## Definition of Done

- [ ] Branch `backend-engineer/TICKET-012-ingest-worker-mvp`
- [ ] PR title above
- [ ] All ACs verified
- [ ] CI green via `gh pr checks <pr> --watch`
- [ ] Prettier clean
- [ ] HANDOFF: TICKET-012 → TICKET-013 (DO rate limiting), TICKET-015 (consumers can subscribe), TICKET-016 (smoke test), TICKET-018 (observability), TICKET-019 (idempotency)

## Notes

- This is the most ambitious ticket in Sprint 1. Don't scope-creep — leave rate limiting, idempotency, observability for their dedicated tickets.
- If Redpanda REST proxy turns out to be too slow (>30ms latency for push), escalate — we may need to swap to Cloudflare Queues or accept higher latency budget.
