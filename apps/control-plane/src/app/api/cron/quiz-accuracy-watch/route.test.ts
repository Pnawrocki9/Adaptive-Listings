/**
 * @vitest-environment node
 *
 * GET /api/cron/quiz-accuracy-watch (FOLLOW-1363, PREREG §7) - route-driven against PGlite with the
 * real H002 DDL. Pinned: auth (401 without / wrong / unset secret); the PREVIOUS UTC month is the
 * one evaluated; a month with >= 100 decided runs and a Wilson upper bound < 0.90 warns once; a
 * healthy month and a month below 100 decided runs do not; a response rate < 60 % warns; a missing
 * table and an unset database are visible 200s, not silence; a thrown read is a 500 + one exception.
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

const { mockCaptureException, mockCaptureMessage } = vi.hoisted(() => ({
  mockCaptureException: vi.fn(),
  mockCaptureMessage: vi.fn(),
}));
vi.mock('@sentry/nextjs', () => ({
  captureException: mockCaptureException,
  captureMessage: mockCaptureMessage,
}));

import { ESTALARA_TENANT_ID } from '@/lib/estalara-tenant';
import { GET } from './route';

const MIGRATION = readFileSync(
  new URL('../../../../../../../docs/handover/migrations/H002_quiz_runs.sql', import.meta.url),
  'utf8',
);
const SECRET = 'cron-secret-1363';
const HASH = 'c'.repeat(64);

let pg: PGlite | null = null;

async function freshDb(withTable = true): Promise<void> {
  if (!pg || !testDb) {
    pg = new PGlite();
    testDb = drizzlePglite(pg);
    await pg.exec(`CREATE TABLE tenants (id uuid PRIMARY KEY)`);
    await pg.exec(`INSERT INTO tenants (id) VALUES ('${ESTALARA_TENANT_ID}')`);
  }
  await pg.exec(`DROP TABLE IF EXISTS quiz_runs`);
  if (withTable) await pg.exec(MIGRATION);
}

/** `n` decided rows in October 2026, `correct` of them confirmed; `completed` extra unasked-for. */
async function seedOctober(n: number, correct: number, extraCompleted = 0): Promise<void> {
  await pg!.query(
    `INSERT INTO quiz_runs (id, tenant_id, session_id, definition_hash, status, resolved_archetype,
        confirmed_archetype, shown_at)
     SELECT gen_random_uuid(), $1::uuid, 's' || g, $2::text,
        CASE WHEN g <= $3 THEN 'confirmed' ELSE 'corrected' END, 'yield_hunter',
        CASE WHEN g <= $3 THEN 'yield_hunter' ELSE 'none_of_these' END,
        timestamptz '2026-10-05T00:00:00Z' + g * interval '1 minute'
     FROM generate_series(1, $4::int) AS g`,
    [ESTALARA_TENANT_ID, HASH, correct, n],
  );
  if (extraCompleted > 0) {
    await pg!.query(
      `INSERT INTO quiz_runs (id, tenant_id, session_id, definition_hash, status, resolved_archetype, shown_at)
       SELECT gen_random_uuid(), $1::uuid, 'c' || g, $2::text, 'completed', 'yield_hunter',
              timestamptz '2026-10-06T00:00:00Z'
       FROM generate_series(1, $3::int) AS g`,
      [ESTALARA_TENANT_ID, HASH, extraCompleted],
    );
  }
}

function req(auth?: string): NextRequest {
  return new NextRequest('http://localhost/api/cron/quiz-accuracy-watch', {
    headers: auth ? { authorization: auth } : {},
  });
}
const authed = () => req(`Bearer ${SECRET}`);

beforeEach(async () => {
  vi.clearAllMocks();
  failWith = null;
  vi.stubEnv('CRON_SECRET', SECRET);
  vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://unused/unused');
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T03:30:00Z')); // previous UTC month = 2026-10
  await freshDb();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
afterAll(async () => {
  testDb = null;
  await pg?.close();
  pg = null;
});

describe('auth', () => {
  it('401 without a header, with a wrong secret, and with CRON_SECRET unset', async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req('Bearer nope'))).status).toBe(401);
    vi.stubEnv('CRON_SECRET', '');
    expect((await GET(req('Bearer '))).status).toBe(401);
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });
});

describe('monthly warning (PREREG §7)', () => {
  it('warns once when >= 100 decided and the Wilson upper bound is < 0.90', async () => {
    await seedOctober(100, 80, 25); // 80 % and asked = 125 -> rate 0.8, so only the bound fires
    const res = await GET(authed());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ month: '2026-10', decided: 100, warned: true });
    expect(mockCaptureMessage).toHaveBeenCalledTimes(1);
    expect(mockCaptureMessage.mock.calls[0]![1]).toMatchObject({
      level: 'warning',
      extra: { upper_bound_below_target: true, response_rate_below_min: false },
    });
  });

  it('does not warn for a healthy month', async () => {
    await seedOctober(100, 99);
    const body = (await (await GET(authed())).json()) as { warned: boolean };
    expect(body.warned).toBe(false);
    expect(mockCaptureMessage).not.toHaveBeenCalled();
  });

  it('does not warn below 100 decided runs, even at 0 % accuracy', async () => {
    await seedOctober(99, 0);
    expect(((await (await GET(authed())).json()) as { warned: boolean }).warned).toBe(false);
  });

  it('warns on a response rate < 60 % even when accuracy is fine', async () => {
    await seedOctober(100, 100, 100); // decided 100 of 200 asked = 50 %
    const body = (await (await GET(authed())).json()) as { warned: boolean };
    expect(body.warned).toBe(true);
    expect(mockCaptureMessage.mock.calls[0]![1]).toMatchObject({
      extra: { upper_bound_below_target: false, response_rate_below_min: true },
    });
  });
});

describe('visible non-warning states and failure', () => {
  it('missing table is a 200 available:false, not silence', async () => {
    await freshDb(false);
    const body = await (await GET(authed())).json();
    expect(body).toMatchObject({
      available: false,
      code: 'quiz_runs_table_missing',
      warned: false,
    });
  });

  it('unset database is a 200 not_configured', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');
    const body = await (await GET(authed())).json();
    expect(body).toMatchObject({ data_source: 'not_configured', warned: false });
  });

  it('a thrown read is a 500 plus one exception capture', async () => {
    failWith = new Error('connection reset');
    const res = await GET(authed());
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: { code: 'quiz_accuracy_read_failed' } });
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
  });
});
