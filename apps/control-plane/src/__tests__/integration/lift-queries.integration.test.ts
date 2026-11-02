/**
 * FOLLOW-1457: the lift reader's queries EXECUTE on a real ClickHouse. The string-level pin in
 * `route-helpers.test.ts` cannot see a query the server refuses for another reason, and one refused
 * query fails the whole route (they share one `Promise.all`). No fixture: only execution is asserted.
 *
 * Run: CLICKHOUSE_URL=http://localhost:8123 CLICKHOUSE_USER=default CLICKHOUSE_PASSWORD=clickhouse \
 *      CALLER_SIGNED_COLUMN_ENABLED=true pnpm --filter @estalara/control-plane \
 *      exec vitest run --config vitest.integration.config.ts lift-queries
 *
 * @module apps/control-plane/src/__tests__/integration/lift-queries.integration.test
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { fetchLiftDaily, fetchLiftRaw } from '@/app/api/dashboard/analytics/lift/route-helpers';

const TENANT_ID = '00000000-0000-0000-0000-000000001457';

describe.skipIf(!process.env.CLICKHOUSE_URL)('lift queries on a real ClickHouse', () => {
  it('the rolling report executes', async () => {
    const raw = await fetchLiftRaw(TENANT_ID, 7);
    expect(raw?.groups).toEqual([]);
    expect(raw?.funnel).toEqual([]);
  });

  it('the per-day report executes', async () => {
    const raw = await fetchLiftDaily(TENANT_ID, '2026-11-01', '2026-11-02');
    expect(raw?.rows).toEqual([]);
  });
});

/**
 * FOLLOW-1458: which arm a both-arm session lands in, on real rows. The rows live in a database of
 * their own, cloned from the live table definitions, so nothing a running stack reads is touched.
 * Replacing `argMin` with `argMax` reds this; the string pin in `route-helpers.test.ts` is what runs
 * in CI, which does not run this spec.
 */
describe.skipIf(!process.env.CLICKHOUSE_URL)('a both-arm session on a real ClickHouse', () => {
  const DB = `lift_itest_${String(Date.now())}`;
  const ch = async (query: string): Promise<void> => {
    const url = new URL(process.env.CLICKHOUSE_URL ?? '');
    url.searchParams.set('user', process.env.CLICKHOUSE_USER ?? 'default');
    url.searchParams.set('password', process.env.CLICKHOUSE_PASSWORD ?? '');
    const res = await fetch(url, { method: 'POST', body: query });
    if (!res.ok) throw new Error(await res.text());
  };
  const decisionAt = async (session: string, holdout: 0 | 1, secondsAgo: number): Promise<void> => {
    await ch(
      `INSERT INTO ${DB}.adaptation_decisions (session_id, tenant_id, holdout_group, variant, ts)
       VALUES ('${session}', '${TENANT_ID}', ${String(holdout)}, 'control',
               now64(3) - toIntervalSecond(${String(secondsAgo)}))`,
    );
  };

  beforeAll(async () => {
    await ch(`CREATE DATABASE ${DB}`);
    await ch(`CREATE TABLE ${DB}.adaptation_decisions AS default.adaptation_decisions`);
    await ch(`CREATE TABLE ${DB}.events AS default.events`);
    // Lopsided on purpose: `argMax` would move these to 4 adapted and 1 holdout.
    await decisionAt('s-holdout-first', 1, 300);
    await decisionAt('s-holdout-first', 0, 200);
    await decisionAt('s-holdout-first-2', 1, 300);
    await decisionAt('s-holdout-first-2', 0, 200);
    await decisionAt('s-adapted-first', 0, 300);
    await decisionAt('s-adapted-first', 1, 200);
    await decisionAt('s-adapted-only', 0, 300);
    await decisionAt('s-adapted-only-2', 0, 300);
    const url = new URL(process.env.CLICKHOUSE_URL ?? '');
    url.searchParams.set('database', DB);
    vi.stubEnv('CLICKHOUSE_URL', url.toString());
  });

  afterAll(async () => {
    vi.unstubAllEnvs();
    await ch(`DROP DATABASE IF EXISTS ${DB}`);
  });

  it('counts each session once, in the arm of its first decision', async () => {
    const raw = await fetchLiftRaw(TENANT_ID, 7);
    const arm = (holdout: number) => raw?.groups.find((g) => g.holdout === holdout);
    expect(arm(0)?.sessions).toBe(3);
    expect(arm(0)?.both_arm_sessions).toBe(1);
    expect(arm(1)?.sessions).toBe(2);
    expect(arm(1)?.both_arm_sessions).toBe(2);
  });
});
