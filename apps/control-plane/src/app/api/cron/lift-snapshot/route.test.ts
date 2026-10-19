/**
 * @vitest-environment node
 *
 * GET /api/cron/lift-snapshot (FOLLOW-1338) — route-driven against a REAL Postgres engine (PGlite)
 * that has had the actual handover SQL (`docs/handover/migrations/0042_lift_daily_snapshots.sql`)
 * applied, so the unique key, the CHECKs and the idempotent UPSERT are the production DDL's, not a
 * hand-copied mirror. ClickHouse is a fetch stand-in.
 *
 * Pinned: auth (401 without / with a wrong secret / with CRON_SECRET unset); one day -> one row per
 * arm; a second run is idempotent (same row count, `computed_at` moves); the missing table is a 500
 * `lift_snapshot_table_missing` with ONE Sentry capture (no crash); the not-configured and
 * flag-off states write nothing and say so on the wire; the migration file itself is idempotent.
 */

import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { sql } from 'drizzle-orm';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PGlite db; schema type is wide
let testDb: ReturnType<typeof drizzlePglite<any>> | null = null;

vi.mock('@estalara/db', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.mock importOriginal generic requires inline import() type
  const real = await importOriginal<typeof import('@estalara/db')>();
  return {
    ...real,
    createAdminClient: () => {
      if (!testDb) throw new Error('test db not initialised');
      return testDb;
    },
  };
});

const { mockCaptureException } = vi.hoisted(() => ({ mockCaptureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({
  captureException: mockCaptureException,
  captureMessage: vi.fn(),
}));

import { ESTALARA_TENANT_ID } from '@/lib/estalara-tenant';
import { GET } from './route';

const MIGRATION = readFileSync(
  new URL(
    '../../../../../../../docs/handover/migrations/0042_lift_daily_snapshots.sql',
    import.meta.url,
  ),
  'utf8',
);
const SECRET = 'cron-secret-for-tests';
const YESTERDAY = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

let pg: PGlite | null = null;

/** One engine for the file (PGlite start-up is seconds); each test gets a clean table state. */
async function freshDb(withTable: boolean): Promise<void> {
  if (!pg || !testDb) {
    pg = new PGlite();
    testDb = drizzlePglite(pg);
    await pg.exec(`CREATE TABLE tenants (id uuid PRIMARY KEY)`);
  }
  await pg.exec(`DROP TABLE IF EXISTS lift_daily_snapshots`);
  await pg.exec(`DELETE FROM tenants`);
  await pg.exec(`INSERT INTO tenants (id) VALUES ('${ESTALARA_TENANT_ID}')`);
  if (withTable) await pg.exec(MIGRATION);
}

function rows(): Promise<{ rows: Record<string, unknown>[] }> {
  if (!testDb) throw new Error('test db not initialised');
  return testDb.execute(
    sql`select to_char(day,'YYYY-MM-DD') as day, arm, sessions, conversions, live_signups,
               agent_contacts, relative_lift_pct, p_value, confidence, computed_at
        from lift_daily_snapshots order by arm`,
  );
}

function stubClickHouse(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      const base = {
        day_utc: YESTERDAY,
        cta_sessions: 0,
        unsigned_conversion_sessions: 0,
      };
      const lines = [
        {
          ...base,
          holdout: 0,
          sessions: 60,
          conversions: 9,
          signed_conversion_sessions: 9,
          live_signup_sessions: 6,
          agent_contact_sessions: 5, // 2 sessions did both -> 9 combined
        },
        {
          ...base,
          holdout: 1,
          sessions: 40,
          conversions: 3,
          signed_conversion_sessions: 3,
          live_signup_sessions: 1,
          agent_contact_sessions: 2,
        },
      ];
      return Promise.resolve(new Response(lines.map((l) => JSON.stringify(l)).join('\n')));
    }),
  );
}

function req(auth?: string): NextRequest {
  return new NextRequest('http://localhost/api/cron/lift-snapshot', {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  mockCaptureException.mockClear();
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.stubEnv('CLICKHOUSE_URL', 'http://ch.test:8123');
  vi.stubEnv('CALLER_SIGNED_COLUMN_ENABLED', 'true');
  vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://unused/unused');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
afterAll(async () => {
  testDb = null;
  await pg?.close();
  pg = null;
});

describe('auth', () => {
  it('401 without an Authorization header, with a wrong secret, and with CRON_SECRET unset', async () => {
    await freshDb(true);
    stubClickHouse();
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req('Bearer wrong'))).status).toBe(401);
    expect((await GET(req(SECRET))).status).toBe(401); // not a Bearer token
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(req('Bearer '))).status).toBe(401);
    expect((await rows()).rows).toHaveLength(0);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('snapshot of yesterday (UTC)', () => {
  it('one day -> one row per arm, with the single computeArmLift figures on both', async () => {
    await freshDb(true);
    stubClickHouse();
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      data_source: 'clickhouse',
      day: YESTERDAY,
      rows_written: 2,
    });

    const got = (await rows()).rows;
    expect(got).toHaveLength(2);
    expect(got[0]).toMatchObject({
      day: YESTERDAY,
      arm: 'adapted',
      sessions: 60,
      conversions: 9,
      live_signups: 6,
      agent_contacts: 5,
      confidence: 'not_significant', // 60 / 40 sessions: past the 30 minimum, p well above 0.1
    });
    expect(got[1]).toMatchObject({ arm: 'holdout', sessions: 40, conversions: 3 });
    // (0.15 - 0.075) / 0.075 * 100 = 100
    expect(Number(got[0]!.relative_lift_pct)).toBeCloseTo(100, 1);
    expect(got[1]!.relative_lift_pct).toEqual(got[0]!.relative_lift_pct);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('a second run is idempotent: same two rows, computed_at moves, nothing is added', async () => {
    await freshDb(true);
    stubClickHouse();
    await GET(req(`Bearer ${SECRET}`));
    await testDb!.execute(
      sql`update lift_daily_snapshots set computed_at = '2020-01-01T00:00:00Z'`,
    );
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const got = (await rows()).rows;
    expect(got).toHaveLength(2);
    for (const r of got) {
      expect(new Date(r.computed_at as string).getTime()).toBeGreaterThan(Date.parse('2021-01-01'));
    }
  });

  it('writes the key to the constant tenant only', async () => {
    await freshDb(true);
    stubClickHouse();
    await GET(req(`Bearer ${SECRET}`));
    const r = (await testDb!.execute(
      sql`select distinct tenant_id from lift_daily_snapshots`,
    )) as unknown as { rows: { tenant_id: string }[] };
    expect(r.rows).toEqual([{ tenant_id: ESTALARA_TENANT_ID }]);
  });
});

describe('Rule K.2 — fail loud, never fabricate', () => {
  it('missing table -> 500 lift_snapshot_table_missing, exactly one Sentry capture', async () => {
    await freshDb(false);
    stubClickHouse();
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('lift_snapshot_table_missing');
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
  });

  it('another write failure is a different code, not the missing-table one', async () => {
    await freshDb(true);
    stubClickHouse();
    await testDb!.execute(sql`delete from tenants`); // FK violation, table present
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'lift_snapshot_write_failed',
    );
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
  });

  it('a failing ClickHouse is a 500 with one capture and writes nothing', async () => {
    await freshDb(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('boom', { status: 503 }))),
    );
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'clickhouse_query_failed',
    );
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    expect((await rows()).rows).toHaveLength(0);
  });

  it('CLICKHOUSE_URL unset -> 200 not_configured, no row (mock data is never stored)', async () => {
    await freshDb(true);
    vi.stubEnv('CLICKHOUSE_URL', '');
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(await res.json()).toMatchObject({ data_source: 'not_configured', rows_written: 0 });
    expect((await rows()).rows).toHaveLength(0);
  });

  it('caller-class flag off -> 200 conversion_source disabled, no row', async () => {
    await freshDb(true);
    vi.stubEnv('CALLER_SIGNED_COLUMN_ENABLED', 'false');
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(await res.json()).toMatchObject({ conversion_source: 'disabled', rows_written: 0 });
    expect((await rows()).rows).toHaveLength(0);
  });
});

describe('the handover migration', () => {
  it('is idempotent (a second application changes nothing) and enables RLS with a tenant policy', async () => {
    await freshDb(true);
    await pg!.exec(MIGRATION);
    const pol = await pg!.query<{ polname: string }>(
      `select polname from pg_policy where polrelid = 'lift_daily_snapshots'::regclass`,
    );
    expect(pol.rows.map((r) => r.polname)).toEqual(['lift_daily_snapshots_tenant_isolation']);
    const rls = await pg!.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'lift_daily_snapshots'`,
    );
    expect(rls.rows[0]!.relrowsecurity).toBe(true);
  });

  it('rejects a bad arm / confidence / negative count (CHECKs)', async () => {
    await freshDb(true);
    const bad = (arm: string, conf: string, sessions: number) =>
      testDb!.execute(
        sql.raw(
          `insert into lift_daily_snapshots (tenant_id, day, arm, sessions, conversions, live_signups, agent_contacts, p_value, confidence)
           values ('${ESTALARA_TENANT_ID}', '2026-01-01', '${arm}', ${String(sessions)}, 0, 0, 0, 1, '${conf}')`,
        ),
      );
    await expect(bad('control', 'not_significant', 1)).rejects.toThrow();
    await expect(bad('adapted', 'maybe', 1)).rejects.toThrow();
    await expect(bad('adapted', 'not_significant', -1)).rejects.toThrow();
  });
});
