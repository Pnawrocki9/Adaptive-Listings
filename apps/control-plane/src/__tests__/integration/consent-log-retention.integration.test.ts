/**
 * Integration test — the consent-log retention cron, against a REAL ClickHouse (FOLLOW-1118 /
 * ESC-071).
 *
 * ## What this proves, and why a mocked test could not
 *
 * ESC-071 was not a bug in a function. It was a promise with no mechanism: the banner told
 * visitors in three languages that their consent-decision log was deleted, and the only thing
 * that ever touched the row was a 13-month TTL. A unit test with a mocked `fetch` can assert
 * that we *sent* a DELETE; it cannot assert that a row *left the table*, and "we sent something
 * plausible" is the exact class of evidence that let the false sentence ship for three months.
 *
 * So this spec seeds two rows of the SAME age into a real engine and asserts an asymmetry:
 *
 *   1. `consent.denied`, aged past the window — must be gone after the cron runs.
 *   2. `page.view`, aged identically — must still be there. The `events` table's 13-month TTL
 *      governs every non-consent type and this mechanism must not touch it. A cron that deleted
 *      both would pass a "did it delete?" test and be a data-loss incident.
 *
 * ## The pre-fix control (`§ before the fix`) is the load-bearing case
 *
 * Before asserting the fix works, the spec reproduces the defect: it applies the ONLY mechanism
 * that existed before this PR — the table's own TTL, forced with `OPTIMIZE TABLE events FINAL`
 * — and asserts BOTH rows survive. That is ESC-071 reproduced against a real engine rather than
 * read off a migration file. Without it, a later refactor could delete the retention route
 * entirely and the remaining assertions would still describe a world nobody had checked.
 *
 * ## Transport
 *
 * The route's GET handler is invoked directly with a real `NextRequest`, including its
 * `CRON_SECRET` Bearer auth, so the code under test is the deployed code path — not a
 * re-implementation of it. `ALTER … DELETE` is an asynchronous ClickHouse mutation, so the spec
 * polls until the row actually disappears rather than assuming the HTTP 200 meant "deleted".
 *
 * Env contract (same as the sibling tracer spec):
 *   CLICKHOUSE_URL       — HTTP endpoint, e.g. http://localhost:8123
 *   CLICKHOUSE_USER      — optional; defaults to "default"
 *   CLICKHOUSE_PASSWORD  — optional; omit / empty for a passwordless container
 *   REQUIRE_CLICKHOUSE   — "1" in the CI job: hard-fail instead of skipping
 *
 * @module apps/control-plane/src/__tests__/integration/consent-log-retention.integration
 */

import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { CONSENT_LOG_RETENTION_DAYS } from '@estalara/shared';
import { executeClickHouseSql, readClickHouseConfig } from '@/lib/clickhouse-dsr';
import { GET } from '@/app/api/internal/retention/consent-log/route';

// ─── Skip / hard-fail gate ───────────────────────────────────────────────────

const HAS_CLICKHOUSE = Boolean(process.env.CLICKHOUSE_URL);
const REQUIRE_CLICKHOUSE = process.env.REQUIRE_CLICKHOUSE === '1';

if (REQUIRE_CLICKHOUSE && !HAS_CLICKHOUSE) {
  throw new Error(
    'REQUIRE_CLICKHOUSE=1 is set but CLICKHOUSE_URL is not. A silent skip here would produce a ' +
      'green badge over an unexecuted retention proof — the FOLLOW-1118 AC forbids exactly that.',
  );
}

const CRON_SECRET = 'follow-1118-integration-cron-secret';
const SEED_TENANT_ID = '00000000-0000-0000-0000-111811181118';
const SEED_SESSION_ID = 'follow-1118-retention-session';

/** Comfortably past the 180-day window, and comfortably inside the 13-month table TTL. */
const SEED_AGE_DAYS = CONSENT_LOG_RETENTION_DAYS + 20;

const cfg = readClickHouseConfig();

/** Seed one row of a given type at a given age, using ClickHouse's own clock. */
async function seedRow(type: string, ageDays: number): Promise<void> {
  await executeClickHouseSql(
    cfg!,
    `INSERT INTO events
       (event_id, tenant_id, session_id, ts, ingest_received_at, region, type,
        schema_version, consent_state, listing_id, archetype_hint, payload)
     SELECT generateUUIDv4(), {tenant:String}, {session:String},
            now() - toIntervalDay({age:UInt32}), now() - toIntervalDay({age:UInt32}),
            'eu', {type:String}, 1, 'denied', '', '', '{}'`,
    { tenant: SEED_TENANT_ID, session: SEED_SESSION_ID, age: String(ageDays), type },
  );
}

/** How many seeded rows of `type` remain. */
async function countRows(type: string): Promise<number> {
  const raw = await executeClickHouseSql(
    cfg!,
    `SELECT count() FROM events WHERE tenant_id = {tenant:String} AND session_id = {session:String} AND type = {type:String}`,
    { tenant: SEED_TENANT_ID, session: SEED_SESSION_ID, type },
  );
  return Number(raw.trim());
}

/** Invoke the deployed cron handler exactly as Vercel Cron does. */
async function runCron(): Promise<Response> {
  process.env.CRON_SECRET = CRON_SECRET;
  return GET(
    new NextRequest('https://control-plane.test/api/internal/retention/consent-log', {
      headers: { authorization: `Bearer ${CRON_SECRET}` },
    }),
  );
}

/** ClickHouse mutations are asynchronous; wait for the row to actually go. */
async function waitForRowsToGo(type: string, timeoutMs = 30_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  let remaining = await countRows(type);
  while (remaining > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    remaining = await countRows(type);
  }
  return remaining;
}

beforeAll(async () => {
  if (!HAS_CLICKHOUSE) return;
  await executeClickHouseSql(cfg!, `ALTER TABLE events DELETE WHERE tenant_id = {tenant:String}`, {
    tenant: SEED_TENANT_ID,
  });
  await seedRow('consent.denied', SEED_AGE_DAYS);
  await seedRow('page.view', SEED_AGE_DAYS);
});

afterAll(async () => {
  if (!HAS_CLICKHOUSE) return;
  await executeClickHouseSql(cfg!, `ALTER TABLE events DELETE WHERE tenant_id = {tenant:String}`, {
    tenant: SEED_TENANT_ID,
  });
});

describe.skipIf(!HAS_CLICKHOUSE)('consent-log retention cron against a live ClickHouse', () => {
  test('both seeded rows exist before anything runs', async () => {
    expect(await countRows('consent.denied')).toBe(1);
    expect(await countRows('page.view')).toBe(1);
  });

  test('§ before the fix: the 13-month table TTL leaves BOTH rows in place (ESC-071 reproduced)', async () => {
    // The only mechanism that existed before this PR. Forcing a merge materialises the TTL;
    // rows aged 200 days are far inside 13 months, so the promise of deletion is unmet for the
    // consent row — which is the whole escalation, executed rather than asserted.
    await executeClickHouseSql(cfg!, 'OPTIMIZE TABLE events FINAL');
    expect(await countRows('consent.denied')).toBe(1);
    expect(await countRows('page.view')).toBe(1);
  });

  test('§ after the fix: the cron reports the consent row and issues the mutation', async () => {
    const res = await runCron();
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data_source: string;
      retention_days: number;
      matched: number;
      mutation_issued: boolean;
    };
    expect(body.data_source).toBe('clickhouse');
    expect(body.retention_days).toBe(CONSENT_LOG_RETENTION_DAYS);
    expect(body.matched).toBeGreaterThanOrEqual(1);
    expect(body.mutation_issued).toBe(true);
  });

  test('the consent row is GONE and the same-age non-consent row is UNTOUCHED', async () => {
    expect(await waitForRowsToGo('consent.denied')).toBe(0);
    expect(await countRows('page.view')).toBe(1);
  });

  test('a second run is a no-op — idempotent, and honest about it', async () => {
    const res = await runCron();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { matched: number; mutation_issued: boolean };
    expect(body.matched).toBe(0);
    expect(body.mutation_issued).toBe(false);
  });

  test('an unauthenticated call deletes nothing', async () => {
    process.env.CRON_SECRET = CRON_SECRET;
    const res = await GET(
      new NextRequest('https://control-plane.test/api/internal/retention/consent-log', {
        headers: { authorization: 'Bearer not-the-secret' },
      }),
    );
    expect(res.status).toBe(401);
    expect(await countRows('page.view')).toBe(1);
  });
});
