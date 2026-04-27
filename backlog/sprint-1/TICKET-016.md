---
id: TICKET-016
title: End-to-end smoke test (curl ingest → ClickHouse query)
sprint: 1
priority: P0
agent: qa-engineer
status: BLOCKED
estimated_hours: 3
depends_on: [TICKET-015]
produces: [TICKET-017]
affects_files:
  - "tests/e2e/smoke-ingest.test.ts"
  - "tests/e2e/fixtures/sample-events.json"
  - "tests/e2e/docker-compose.yml"
  - "tests/e2e/README.md"
  - ".github/workflows/e2e-smoke.yml"
context_files:
  - apps/ingest/* (TICKET-012, 013)
  - apps/stream-consumer/* (TICKET-015)
  - infra/clickhouse/* (TICKET-014)
  - .claude/agents/qa-engineer.md
labels: [sprint-1, p0, qa, e2e]
---

# TICKET-016: End-to-end smoke test

## Summary

First real end-to-end test of the ingest pipeline: spin up Worker (via Wrangler dev) + Redpanda + ClickHouse + stream-consumer in docker-compose, fire a curl POST against ingest endpoint with 50 sample events, assert all 50 events land in ClickHouse `events` table within 10 seconds. This validates the entire Sprint 1 stack works together.

## Context

After TICKET-012 (ingest Worker), TICKET-013 (rate limiting), TICKET-014 (ClickHouse), TICKET-015 (consumer), each component has unit + integration tests. But none of them test the whole pipeline end-to-end. That's this ticket. It's the proof Sprint 1 is shippable.

QA engineer pattern: write the test, make it run in CI nightly (not on every PR — too heavy), document how to run locally for debugging.

## Scope

### In scope
- `tests/e2e/docker-compose.yml` — orchestrate ingest Worker (via wrangler dev), Redpanda single-node, ClickHouse single-node, stream-consumer
- `tests/e2e/fixtures/sample-events.json` — 50 sample events covering 5+ event types, valid schema
- `tests/e2e/smoke-ingest.test.ts` — single test that:
  1. POSTs sample-events.json to ingest endpoint with valid API key
  2. Asserts response 200 with `accepted: 50`
  3. Polls ClickHouse for up to 10s waiting for `SELECT count(*) FROM events WHERE batch_id = ?` to equal 50
  4. Asserts session_summary has correct row count for the test session_ids
- `.github/workflows/e2e-smoke.yml` — nightly schedule + on-demand workflow_dispatch trigger
- README in tests/e2e/ explaining: how to run locally, how to debug failures, how to update fixtures

### Out of scope
- Load testing (TICKET-017)
- Full E2E with real cloud resources — local docker-compose suffices
- Browser-based SDK testing (Sprint 3)
- Auth flow E2E (Sprint 2)

## Acceptance criteria

- [ ] AC1: `tests/e2e/docker-compose.yml` brings up: Redpanda, ClickHouse, stream-consumer (uses local source, not Modal); Worker is run via wrangler dev as a sibling process
- [ ] AC2: `tests/e2e/fixtures/sample-events.json` contains 50 events covering at least: page.view, photo.opened, scroll.depth, chat.message.sent, inquiry.started
- [ ] AC3: `smoke-ingest.test.ts` is a single passing test that completes in <60s end-to-end
- [ ] AC4: Test asserts 200 response from ingest, asserts 50 rows in ClickHouse `events`, asserts correct sessions in session_summary
- [ ] AC5: GitHub Action `e2e-smoke.yml` runs nightly at 03:00 UTC + on demand; failures alert via Slack (skip Slack if no webhook URL configured — graceful degradation)
- [ ] AC6: README covers: prerequisites (Docker, pnpm, wrangler), step-by-step `pnpm e2e:smoke`, troubleshooting common failures (Redpanda not ready, ClickHouse migrations missing)
- [ ] AC7: Clean teardown: docker-compose down on test exit, no orphaned containers
- [ ] AC8: Test runs locally via `pnpm e2e:smoke` (root script) within 90s on a typical dev machine
- [ ] AC9: PR title `test(e2e): smoke test ingest → clickhouse [TICKET-016]`

## Implementation guidance

For docker-compose:

```yaml
# tests/e2e/docker-compose.yml
services:
  redpanda:
    image: redpandadata/redpanda:latest
    command:
      - redpanda
      - start
      - --kafka-addr=internal://0.0.0.0:9092,external://0.0.0.0:19092
      - --advertise-kafka-addr=internal://redpanda:9092,external://localhost:19092
      - --pandaproxy-addr=internal://0.0.0.0:8082,external://0.0.0.0:18082
    ports:
      - "19092:19092"
      - "18082:18082"
    healthcheck:
      test: ["CMD", "rpk", "cluster", "info"]
      interval: 5s
  
  clickhouse:
    image: clickhouse/clickhouse-server:latest
    ports:
      - "8123:8123"
    volumes:
      - ../../infra/clickhouse/migrations:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8123/ping"]
      interval: 5s
  
  stream-consumer:
    build: ../../apps/stream-consumer
    depends_on:
      redpanda:
        condition: service_healthy
      clickhouse:
        condition: service_healthy
    environment:
      REDPANDA_BROKERS: redpanda:9092
      CLICKHOUSE_URL: http://clickhouse:8123
```

For test:

```typescript
// tests/e2e/smoke-ingest.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import sampleEvents from './fixtures/sample-events.json';

const INGEST_URL = process.env.INGEST_URL ?? 'http://localhost:8787';
const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL ?? 'http://localhost:8123';
const API_KEY = process.env.API_KEY ?? 'pk_test_smoke';

async function queryClickhouse(sql: string): Promise<string> {
  const res = await fetch(`${CLICKHOUSE_URL}?query=${encodeURIComponent(sql)}`);
  return await res.text();
}

describe('Smoke: ingest → clickhouse', () => {
  it('accepts batch and persists to clickhouse within 10s', async () => {
    const res = await fetch(`${INGEST_URL}/v1/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Estalara-API-Key': API_KEY },
      body: JSON.stringify({ events: sampleEvents }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accepted).toBe(50);
    
    const startedAt = Date.now();
    let count = 0;
    while (Date.now() - startedAt < 10_000) {
      const result = await queryClickhouse(`SELECT count(*) FROM events WHERE event_id IN (${sampleEvents.map(e => `'${e.event_id}'`).join(',')}) FORMAT TSV`);
      count = parseInt(result.trim(), 10);
      if (count === 50) break;
      await new Promise(r => setTimeout(r, 500));
    }
    expect(count).toBe(50);
  }, 60_000);
});
```

## Test plan

- Run `pnpm e2e:smoke` locally (after `docker-compose up` and `wrangler dev` in another terminal)
- Run via CI workflow_dispatch trigger to verify nightly runs
- Inject failure (e.g., point at wrong CLICKHOUSE_URL) and verify test fails clearly with debugging info

## Definition of Done

- [ ] Branch `qa-engineer/TICKET-016-e2e-smoke-ingest`
- [ ] PR title above
- [ ] All ACs verified
- [ ] CI green via `gh pr checks <pr> --watch`
- [ ] Prettier clean
- [ ] HANDOFF: TICKET-016 → TICKET-017 (load test can build on this harness)

## Notes

- Don't run the e2e test on every PR — it's slow. Nightly + on-demand is enough until we have many devs.
- If wrangler dev is hard to orchestrate from CI, fall back to using miniflare directly.
- Sample events should mix valid + a few intentionally invalid (skip from ingest) to test the rejection path. Document this in fixtures README.
