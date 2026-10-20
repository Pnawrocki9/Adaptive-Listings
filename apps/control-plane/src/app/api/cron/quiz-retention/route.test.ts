/**
 * @vitest-environment node
 *
 * GET /api/cron/quiz-retention (FOLLOW-1364, ESC-086 C6; CEO ruling 2026-10-20: 13 months) -
 * route-driven against PGlite with the real H002 DDL. Pinned: auth (401 without / wrong / unset
 * secret, nothing deleted); only rows older than 13 months go from BOTH tables, younger rows stay
 * (including 12 months and 12 months 29 days); batches loop past 5 000 rows; a replay deletes
 * nothing more; a missing `quiz_runs` is tolerated and reported while `quiz_completions` is still
 * purged; an unset database is a visible 200; a thrown error is a 500 + ONE exception that carries
 * no SQL, no params and no cause.
 */

import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PGlite db; schema type is wide
let testDb: ReturnType<typeof drizzlePglite<any>> | null = null;
let failWith: Error | null = null;

vi.mock('@estalara/db', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.mock importOriginal generic requires inline import() type
  const real = await importOriginal<typeof import('@estalara/db')>();
  return {
    ...real,
    createAdminClient: () => {
      if (failWith) {
        const err = failWith;
        return { execute: () => Promise.reject(err) };
      }
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

import { GET } from './route';

const MIGRATION = readFileSync(
  new URL('../../../../../../../docs/handover/migrations/H002_quiz_runs.sql', import.meta.url),
  'utf8',
);
const SECRET = 'cron-secret-1364';
const TENANT = '550e8400-e29b-41d4-a716-446655441364';

let pg: PGlite | null = null;

async function freshDb(withRuns = true): Promise<void> {
  if (!pg || !testDb) {
    pg = new PGlite();
    testDb = drizzlePglite(pg);
    await pg.exec(`CREATE TABLE tenants (id uuid PRIMARY KEY)`);
    await pg.exec(`INSERT INTO tenants (id) VALUES ('${TENANT}')`);
  }
  await pg.exec(`DROP TABLE IF EXISTS quiz_runs`);
  await pg.exec(`DROP TABLE IF EXISTS quiz_completions`);
  // Only the columns the job touches; the production DDL is packages/db/migrations/0022.
  await pg.exec(`CREATE TABLE quiz_completions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id uuid NOT NULL REFERENCES tenants(id),
    session_id text NOT NULL,
    resolved_archetype text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now())`);
  if (withRuns) await pg.exec(MIGRATION);
}

/** `n` rows in both tables aged `age` (a Postgres interval literal), with a unique session each. */
async function seed(n: number, age: string, tag: string): Promise<void> {
  await pg!.query(
    `INSERT INTO quiz_runs (id, tenant_id, session_id, status, shown_at)
     SELECT gen_random_uuid(), $1::uuid, $3::text || g, 'shown', now() - $2::interval
     FROM generate_series(1, $4::int) AS g`,
    [TENANT, age, tag, n],
  );
  await pg!.query(
    `INSERT INTO quiz_completions (tenant_id, session_id, resolved_archetype, created_at)
     SELECT $1::uuid, $3::text || g, 'yield_hunter', now() - $2::interval
     FROM generate_series(1, $4::int) AS g`,
    [TENANT, age, tag, n],
  );
}

async function count(table: string): Promise<number> {
  const r = await pg!.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
  return r.rows[0]!.n;
}

function req(auth?: string): NextRequest {
  return new NextRequest('http://localhost/api/cron/quiz-retention', {
    headers: auth ? { authorization: auth } : {},
  });
}
const authed = () => req(`Bearer ${SECRET}`);

beforeEach(async () => {
  vi.clearAllMocks();
  failWith = null;
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://unused/unused');
  await freshDb();
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  testDb = null;
  await pg?.close();
});

describe('auth', () => {
  it('401 without a header, with a wrong secret and with the secret unset; deletes nothing', async () => {
    await seed(3, '14 months', 'old');
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req('Bearer nope'))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(authed())).status).toBe(401);
    expect(await count('quiz_runs')).toBe(3);
    expect(await count('quiz_completions')).toBe(3);
  });
});

describe('retention window', () => {
  it('deletes only rows older than 13 months from both tables', async () => {
    await seed(4, '13 months 2 days', 'old');
    await seed(2, '12 months 29 days', 'edge');
    await seed(3, '1 day', 'new');
    const res = await GET(authed());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      data_source: 'postgres',
      retention_months: 13,
      quiz_runs: { deleted: 4 },
      quiz_completions: { deleted: 4 },
    });
    expect(await count('quiz_runs')).toBe(5);
    expect(await count('quiz_completions')).toBe(5);
    const left = await pg!.query<{ session_id: string }>(
      `SELECT session_id FROM quiz_runs WHERE session_id LIKE 'old%'`,
    );
    expect(left.rows).toHaveLength(0);
  });

  it('is idempotent: a replay deletes nothing more', async () => {
    await seed(2, '14 months', 'old');
    await seed(2, '1 day', 'new');
    await GET(authed());
    const body = await (await GET(authed())).json();
    expect(body.quiz_runs.deleted).toBe(0);
    expect(body.quiz_completions.deleted).toBe(0);
    expect(await count('quiz_runs')).toBe(2);
  });

  it('loops in bounded batches past 5 000 rows', async () => {
    await seed(12_000, '15 months', 'bulk');
    await seed(1, '1 day', 'new');
    const body = await (await GET(authed())).json();
    expect(body.quiz_runs.deleted).toBe(12_000);
    expect(body.quiz_completions.deleted).toBe(12_000);
    expect(await count('quiz_runs')).toBe(1);
    expect(await count('quiz_completions')).toBe(1);
  }, 60_000);

  it('stops on an exact multiple of the batch size without error', async () => {
    await seed(5000, '15 months', 'exact');
    const body = await (await GET(authed())).json();
    expect(body.quiz_runs.deleted).toBe(5000);
    expect(await count('quiz_runs')).toBe(0);
  }, 60_000);
});

describe('dependencies', () => {
  it('tolerates a missing quiz_runs (H002 not applied), reports it and still purges completions', async () => {
    await freshDb(false);
    await seed1Completion('14 months');
    const res = await GET(authed());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.quiz_runs).toEqual({ deleted: 0, skipped: 'table_missing' });
    expect(body.quiz_completions.deleted).toBe(1);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('an unset database is a visible 200 not_configured', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');
    const body = await (await GET(authed())).json();
    expect(body.data_source).toBe('not_configured');
  });

  it('a thrown error is a 500 and ONE exception without SQL, params or cause', async () => {
    const driver = Object.assign(
      new Error('delete from "quiz_runs" where session_id = $1 -- params: secret-session'),
      { code: '57014' },
    );
    failWith = Object.assign(new Error('Failed query: delete ... params: secret-session'), {
      cause: driver,
    });
    const res = await GET(authed());
    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('quiz_retention_failed');
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    const [captured, ctx] = mockCaptureException.mock.calls[0]!;
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe('quiz_retention_failed (sqlstate 57014)');
    expect((captured as Error).cause).toBeUndefined();
    expect(JSON.stringify(ctx)).not.toContain('secret-session');
    expect(JSON.stringify(ctx)).not.toContain('delete');
  });
});

async function seed1Completion(age: string): Promise<void> {
  await pg!.query(
    `INSERT INTO quiz_completions (tenant_id, session_id, resolved_archetype, created_at)
     VALUES ($1::uuid, 's', 'yield_hunter', now() - $2::interval)`,
    [TENANT, age],
  );
}
