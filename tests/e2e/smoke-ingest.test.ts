/**
 * Smoke test: ingest Worker → Redpanda → stream-consumer → ClickHouse.
 *
 * Prerequisite (local): docker-compose up in tests/e2e/ and wrangler dev in apps/ingest/.
 * In CI: the e2e-smoke.yml workflow handles setup and teardown automatically.
 *
 * @module tests/e2e/smoke-ingest
 */

import { describe, expect, it } from 'vitest';

import sampleEvents from './fixtures/sample-events.json';

const INGEST_URL = process.env.INGEST_URL ?? 'http://localhost:8787';
const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL ?? 'http://localhost:8123';
const API_KEY = process.env.API_KEY ?? 'pk_test_smoke';

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';

async function queryClickhouse(sql: string): Promise<string> {
  const res = await fetch(`${CLICKHOUSE_URL}?query=${encodeURIComponent(sql)}`);
  if (!res.ok) {
    throw new Error(`ClickHouse error ${String(res.status)}: ${await res.text()}`);
  }
  return res.text();
}

describe('Smoke: ingest → clickhouse', () => {
  it('accepts batch and persists all 50 events to clickhouse within 10s', async () => {
    // 1. POST the batch
    const res = await fetch(`${INGEST_URL}/v1/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Estalara-API-Key': API_KEY,
      },
      body: JSON.stringify({ events: sampleEvents }),
    });

    expect(res.status, `ingest responded ${String(res.status)}: ${await res.clone().text()}`).toBe(
      200,
    );

    const body = (await res.json()) as { accepted: number; rejected: number };
    expect(body.accepted).toBe(50);

    // 2. Poll ClickHouse for up to 10s waiting for all 50 events
    const eventIds = sampleEvents.map((e) => `'${e.event_id}'`).join(',');
    const startedAt = Date.now();
    let count = 0;

    while (Date.now() - startedAt < 10_000) {
      const result = await queryClickhouse(
        `SELECT count(*) FROM events WHERE event_id IN (${eventIds}) FORMAT TSV`,
      );
      count = parseInt(result.trim(), 10);
      if (count === 50) break;
      await new Promise<void>((r) => setTimeout(r, 500));
    }

    expect(count, `Expected 50 events in ClickHouse, got ${String(count)} after 10s`).toBe(50);

    // 3. Assert session_summary has a row for each unique session
    const uniqueSessions = [...new Set(sampleEvents.map((e) => e.session_id))];

    for (const sessionId of uniqueSessions) {
      const sessionResult = await queryClickhouse(
        `SELECT count(*) FROM session_summary WHERE tenant_id = '${TENANT_ID}' AND session_id = '${sessionId}' FORMAT TSV`,
      );
      const sessionRows = parseInt(sessionResult.trim(), 10);
      expect(sessionRows, `session_summary missing rows for session ${sessionId}`).toBeGreaterThan(
        0,
      );
    }
  }, 60_000);
});
