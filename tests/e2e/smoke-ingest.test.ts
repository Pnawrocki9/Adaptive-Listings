/**
 * Smoke test: ingest Worker → Redpanda → stream-consumer → ClickHouse.
 *
 * Prerequisite (local): docker-compose up in tests/e2e/ and wrangler dev in apps/ingest/.
 * In CI: the e2e-smoke.yml workflow starts + health-checks both services, THEN sets
 * REQUIRE_INGEST_SMOKE=1 for the test run.
 *
 * Skip / hard-fail contract (FOLLOW-563, mirrors
 * tests/integration/redis-shadow-round-trip.smoke.test.ts / CONVENTIONS_PATCH.md Rule Q):
 *   - REQUIRE_INGEST_SMOKE unset (default on a clean dev machine, no docker-compose/wrangler
 *     running) → soft-skip with a GitHub Actions ::notice:: instead of a raw "fetch failed".
 *   - REQUIRE_INGEST_SMOKE=1 (set only by e2e-smoke.yml, after ClickHouse + wrangler dev are
 *     health-checked ready) → the assertions run for real; a broken ingest→ClickHouse pipeline
 *     hard-fails the job.
 *
 * @module tests/e2e/smoke-ingest
 */

import { describe, expect, it } from 'vitest';

import rawSampleEvents from './fixtures/sample-events.json';

/**
 * The fixture's `ts` values are FROZEN at 1746259200000 (2025-05-03), and `events` carries
 * `TTL ts + INTERVAL 13 MONTH`. From 2026-06-03 onward every fixture row is expired the instant it
 * is written: ClickHouse applies TTL when the part is created, so the INSERT reports
 * `written_rows: 50` and `SELECT count()` returns 0 — a contradiction that took a `system.query_log`
 * probe to resolve, because the server was telling the truth on both sides.
 *
 * **This test did not break. It aged out.** A fixture with absolute timestamps under a TTL is a
 * dated claim about the world, and it expires exactly like the ones the measured-premise register
 * exists for (FOLLOW-952). The fix is to stop asserting a date: the timestamps are re-based onto
 * the run's own clock, keeping the fixture's relative spacing so ordering-sensitive assertions
 * still mean what they meant. [FOLLOW-986]
 */
const TS_EPOCH_IN_FIXTURE = 1746259200000;
const sampleEvents = rawSampleEvents.map((e) => ({
  ...e,
  ts: Date.now() - 60_000 + (e.ts - TS_EPOCH_IN_FIXTURE),
}));

const INGEST_URL = process.env.INGEST_URL ?? 'http://localhost:8787';
const CLICKHOUSE_URL = process.env.CLICKHOUSE_URL ?? 'http://localhost:8123';
const API_KEY = process.env.API_KEY ?? 'pk_test_smoke';

const TENANT_ID = 'a0000000-0000-0000-0000-000000000001';

// ─── Env var gate — skip / hard-fail logic ───────────────────────────────────
//
// There is no "secret" here (INGEST_URL/CLICKHOUSE_URL always resolve to a
// localhost default), so presence-of-env-var can't signal "services are live"
// the way it does for the Redis smoke test. Instead REQUIRE_INGEST_SMOKE is an
// explicit positive flag that e2e-smoke.yml sets ONLY after its own "Wait for
// ClickHouse" / "Wait for wrangler dev" health-check steps succeed.
const REQUIRE = process.env.REQUIRE_INGEST_SMOKE === '1';

async function queryClickhouse(sql: string): Promise<string> {
  const res = await fetch(`${CLICKHOUSE_URL}?query=${encodeURIComponent(sql)}`);
  if (!res.ok) {
    throw new Error(`ClickHouse error ${String(res.status)}: ${await res.text()}`);
  }
  return res.text();
}

// ─── Soft-skip announcement ───────────────────────────────────────────────────
//
// Deliberately emitted from MODULE TOP LEVEL, not from a beforeAll() hook: when
// every `it` in a file is `skipIf`'d, Vitest never invokes that file's
// beforeAll/afterAll hooks at all (verified locally — a beforeAll-only notice
// never printed), which would make this soft-skip an INERT gate per
// CONVENTIONS_PATCH.md Rule Q (a skip with no positive proof it happened is
// indistinguishable from a silently-broken gate). Top-level statements always
// execute during Vitest's collection phase regardless of skip status, so this
// placement is what actually guarantees the ::notice:: fires.
if (!REQUIRE) {
  const notice =
    'Skipping FOLLOW-563 ingest→clickhouse smoke — REQUIRE_INGEST_SMOKE is not set. ' +
    'This test needs live docker-compose (ClickHouse/Redpanda, tests/e2e/) + wrangler dev ' +
    '(ingest Worker, apps/ingest/) running, or the e2e-smoke.yml CI job, which starts both ' +
    'and sets REQUIRE_INGEST_SMOKE=1 once they are health-checked ready. ' +
    'To run locally: docker compose up -d (tests/e2e/), wrangler dev --port 8787 ' +
    '(apps/ingest/), then REQUIRE_INGEST_SMOKE=1 pnpm --filter @estalara/e2e-smoke test.';

  // GitHub Actions notice annotation — visible in step log UI.
  console.log(`::notice::${notice}`);
}

describe('Smoke: ingest → clickhouse', () => {
  it.skipIf(!REQUIRE)(
    'accepts batch and persists all 50 events to clickhouse within 10s',
    async () => {
      // 1. POST the batch
      const res = await fetch(`${INGEST_URL}/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Estalara-API-Key': API_KEY,
        },
        body: JSON.stringify({ events: sampleEvents }),
      });

      expect(
        res.status,
        `ingest responded ${String(res.status)}: ${await res.clone().text()}`,
      ).toBe(200);

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
        expect(
          sessionRows,
          `session_summary missing rows for session ${sessionId}`,
        ).toBeGreaterThan(0);
      }
    },
    60_000,
  );
});
