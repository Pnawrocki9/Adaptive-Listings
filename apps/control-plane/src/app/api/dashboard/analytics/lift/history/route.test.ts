/**
 * @vitest-environment node
 *
 * GET /api/dashboard/analytics/lift/history (FOLLOW-1338) against a real Postgres engine (PGlite)
 * with the actual handover SQL applied. Pinned: staff-only; rows newest-first, capped at 90;
 * an empty table is `rows: []` with `data_source: 'postgres'`; a missing table is a 500
 * `lift_snapshot_table_missing` (the UI shows an error banner); an unconfigured store says so.
 */

import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';

import type * as SessionAuthModule from '@/lib/session-auth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PGlite db; schema type is wide
let testDb: ReturnType<typeof drizzlePglite<any>> | null = null;
let pg: PGlite | null = null;

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

vi.mock('@/lib/session-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionAuthModule>();
  return { ...actual, resolveTenantAccess: vi.fn() };
});
import { resolveTenantAccess, AccessError, type TenantAccess } from '@/lib/session-auth';
const mockResolve = vi.mocked(resolveTenantAccess);

const { mockCaptureException } = vi.hoisted(() => ({ mockCaptureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({
  captureException: mockCaptureException,
  captureMessage: vi.fn(),
}));

import { GET } from './route';

const MIGRATION = readFileSync(
  new URL(
    '../../../../../../../../../docs/handover/migrations/0042_lift_daily_snapshots.sql',
    import.meta.url,
  ),
  'utf8',
);
const TENANT = '550e8400-e29b-41d4-a716-446655440002';
const OTHER = '550e8400-e29b-41d4-a716-4466554400c3';

const staff: TenantAccess = {
  via: 'staff',
  tenantId: TENANT,
  staff: {
    sub: 's',
    email: 'staff@estalara.com',
    tenant_id: null,
    estalara_staff: true,
    estalara_role: 'estalara:readonly',
    mfa_verified: true,
  },
  role: 'estalara:readonly',
  canWrite: false,
  isSuperadmin: false,
};

async function freshDb(withTable: boolean): Promise<void> {
  if (!pg || !testDb) {
    pg = new PGlite();
    testDb = drizzlePglite(pg);
    await pg.exec(`CREATE TABLE tenants (id uuid PRIMARY KEY)`);
  }
  await pg.exec(`DROP TABLE IF EXISTS lift_daily_snapshots`);
  await pg.exec(`DELETE FROM tenants`);
  await pg.exec(`INSERT INTO tenants (id) VALUES ('${TENANT}'), ('${OTHER}')`);
  if (withTable) await pg.exec(MIGRATION);
}

function req(): NextRequest {
  return new NextRequest(
    `http://localhost/api/dashboard/analytics/lift/history?tenant_id=${TENANT}`,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolve.mockResolvedValue(staff);
  vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://unused/unused');
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  testDb = null;
  await pg?.close();
  pg = null;
});

describe('GET history', () => {
  it('no session -> 401; agency -> 403 staff_only', async () => {
    await freshDb(true);
    mockResolve.mockRejectedValue(new AccessError(401, 'Unauthorized'));
    expect((await GET(req())).status).toBe(401);
    mockResolve.mockResolvedValue({
      via: 'agency',
      tenantId: TENANT,
      claims: {} as never,
      rawToken: null,
    });
    const res = await GET(req());
    expect(res.status).toBe(403);
  });

  it('empty table -> 200 postgres with no rows (a real empty, not an error)', async () => {
    await freshDb(true);
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tenant_id: TENANT, data_source: 'postgres', rows: [] });
  });

  it('returns the newest 90 rows, newest day first, for THIS tenant only', async () => {
    await freshDb(true);
    // 60 days x 2 arms = 120 rows for TENANT, plus one row of another tenant
    await pg!.exec(`
      insert into lift_daily_snapshots (tenant_id, day, arm, sessions, conversions, live_signups, agent_contacts, relative_lift_pct, p_value, confidence)
      select '${TENANT}', date '2026-08-01' + g, a, 10 + g, 1, 1, 0, case when g = 0 then null else 12.5 end, 0.5, 'not_significant'
      from generate_series(0, 59) g, unnest(array['adapted','holdout']) a;
      insert into lift_daily_snapshots (tenant_id, day, arm, sessions, conversions, live_signups, agent_contacts, p_value, confidence)
      values ('${OTHER}', '2026-12-31', 'adapted', 1, 0, 0, 0, 1, 'not_significant');
    `);
    const res = await GET(req());
    const body = (await res.json()) as {
      rows: { day: string; arm: string; relative_lift_pct: number | null; computed_at: string }[];
    };
    expect(body.rows).toHaveLength(90);
    expect(body.rows[0]).toMatchObject({ day: '2026-09-29', arm: 'adapted' }); // 2026-08-01 + 59
    expect(body.rows[1]).toMatchObject({ day: '2026-09-29', arm: 'holdout' });
    expect(body.rows.every((r) => r.day !== '2026-12-31')).toBe(true);
    expect(body.rows[0]!.relative_lift_pct).toBe(12.5);
    expect(body.rows[0]!.computed_at).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('missing table -> 500 lift_snapshot_table_missing (no empty list standing in for it)', async () => {
    await freshDb(false);
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'lift_snapshot_table_missing',
    );
  });

  it('another read failure -> 500 lift_snapshot_read_failed + one Sentry capture', async () => {
    await freshDb(true);
    await pg!.exec(`ALTER TABLE lift_daily_snapshots RENAME COLUMN confidence TO conf`);
    const res = await GET(req());
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'lift_snapshot_read_failed',
    );
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
  });

  it('no admin database URL -> 200 not_configured with no rows', async () => {
    await freshDb(true);
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');
    expect(await (await GET(req())).json()).toEqual({
      tenant_id: TENANT,
      data_source: 'not_configured',
      rows: [],
    });
  });
});
