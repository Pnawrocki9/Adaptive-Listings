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

import { describe, expect, it } from 'vitest';

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
