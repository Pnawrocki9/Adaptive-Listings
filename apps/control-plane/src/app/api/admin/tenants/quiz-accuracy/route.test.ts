/**
 * @vitest-environment node
 *
 * GET /api/admin/tenants/quiz-accuracy (FOLLOW-1363) - route-driven against a REAL Postgres engine
 * (PGlite) with the actual handover DDL (`docs/handover/migrations/H002_quiz_runs.sql`) applied, so
 * the SQL of `readQuizAccuracyData` (grouping, `unnest(step_ms)`, the filters, the ordering the
 * first-400 verdict depends on) is executed once for real - the previous package's SQL was only
 * tested against fakes.
 *
 * Pinned: anonymous 401, staff 200; the tenant fence (a foreign tenant's rows never leak);
 * 372/400 -> PASS and 371/400 -> FAIL through the whole route; the default hash is the one with the
 * most decided rows and a requested hash wins; neutral rows and `shown`/`dismissed` rows are not
 * decided; `none_of_these` is a column and a miss; the language filter makes the verdict
 * non-binding; a missing table is a 200 `available:false` with the H002 message; a thrown DB error
 * is a 500 plus ONE Sentry capture (never an empty report); a bad query is 400.
 */

import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import type * as SessionAuthModule from '@/lib/session-auth';

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

vi.mock('@/lib/session-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionAuthModule>();
  return { ...actual, resolveTenantAccess: vi.fn() };
});

const { mockCaptureException } = vi.hoisted(() => ({ mockCaptureException: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({
  captureException: mockCaptureException,
  captureMessage: vi.fn(),
}));

import { AccessError, resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { GET, type QuizAccuracyResponse } from './route';

const mockResolve = vi.mocked(resolveTenantAccess);

const MIGRATION = readFileSync(
  new URL('../../../../../../../../docs/handover/migrations/H002_quiz_runs.sql', import.meta.url),
  'utf8',
);

const TENANT = '550e8400-e29b-41d4-a716-446655441363';
const OTHER = '550e8400-e29b-41d4-a716-446655449363';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

let pg: PGlite | null = null;

async function freshDb(withTable = true): Promise<PGlite> {
  if (!pg || !testDb) {
    pg = new PGlite();
    testDb = drizzlePglite(pg);
    await pg.exec(`
      CREATE TABLE tenants (id uuid PRIMARY KEY);
      INSERT INTO tenants (id) VALUES ('${TENANT}'), ('${OTHER}');
    `);
  }
  await pg.exec(`DROP TABLE IF EXISTS quiz_runs`);
  if (withTable) await pg.exec(MIGRATION);
  return pg;
}

interface Seed {
  tenant?: string;
  hash?: string | null;
  version?: number | null;
  language?: string | null;
  /** First minute offset (shown_at = 2026-11-01 + offset minutes) so ordering is controlled. */
  offset?: number;
  /** Minutes between shown_at and the decision (`updated_at`); default 0. */
  decidedAfter?: number;
  month?: string;
}

/** `correct` confirmed rows then `n - correct` corrected (to `none_of_these`), oldest first. */
async function seedDecided(n: number, correct: number, s: Seed = {}): Promise<void> {
  const offset = s.offset ?? 0;
  await pg!.query(
    `INSERT INTO quiz_runs (id, tenant_id, session_id, language, definition_hash, definition_version,
        status, resolved_archetype, confirmed_archetype, step_ms, result_ms, shown_at, updated_at)
     SELECT gen_random_uuid(), $1::uuid, 's' || g, $2::text, $3::text, $4::int,
        CASE WHEN g <= $5 THEN 'confirmed' ELSE 'corrected' END, 'yield_hunter',
        CASE WHEN g <= $5 THEN 'yield_hunter' ELSE 'none_of_these' END,
        ARRAY[3000, 3000, 3000], CASE WHEN g % 10 = 0 THEN 900 ELSE 4000 END,
        $6::timestamptz + (g + $7) * interval '1 minute',
        $6::timestamptz + (g + $7 + $9) * interval '1 minute'
     FROM generate_series(1, $8::int) AS g`,
    [
      s.tenant ?? TENANT,
      s.language === undefined ? 'en' : s.language,
      'hash' in s ? s.hash : HASH_A,
      s.version === undefined ? 2 : s.version,
      correct,
      `${s.month ?? '2026-11'}-01T00:00:00Z`,
      offset,
      n,
      s.decidedAfter ?? 0,
    ],
  );
}

async function seedStatus(
  status: string,
  n: number,
  resolved: string | null,
  hash = HASH_A,
  updatedAt = '2026-10-15T00:00:00Z',
) {
  await pg!.query(
    `INSERT INTO quiz_runs (id, tenant_id, session_id, definition_hash, status, resolved_archetype,
        last_step, shown_at, updated_at)
     SELECT gen_random_uuid(), $1::uuid, 'x' || g || $2::text, $3::text, $2::text, $4::text,
            CASE WHEN $2::text = 'dismissed' THEN g % 2 END, timestamptz '2026-10-15T00:00:00Z',
            $6::timestamptz
     FROM generate_series(1, $5::int) AS g`,
    [TENANT, status, hash, resolved, n, updatedAt],
  );
}

function staff(): TenantAccess {
  return {
    via: 'staff',
    tenantId: TENANT,
    staff: {
      sub: 'staff-1363',
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
}

function req(query = ''): NextRequest {
  return new NextRequest(
    `http://localhost/api/admin/tenants/quiz-accuracy?tenant_id=${TENANT}${query}`,
  );
}

async function get(query = ''): Promise<{ status: number; body: QuizAccuracyResponse }> {
  const res = await GET(req(query));
  return { status: res.status, body: (await res.json()) as QuizAccuracyResponse };
}

function available(b: QuizAccuracyResponse) {
  if (!b.available) throw new Error('expected an available report');
  return b;
}

beforeEach(async () => {
  vi.clearAllMocks();
  failWith = null;
  mockResolve.mockResolvedValue(staff());
  await freshDb();
});

afterAll(async () => {
  await pg?.close();
});

describe('auth', () => {
  it('anonymous caller is 401 and reads nothing', async () => {
    mockResolve.mockRejectedValue(new AccessError(401, 'Authentication required'));
    const { status, body } = await get();
    expect(status).toBe(401);
    expect(body).toMatchObject({ error: { code: 'unauthorized' } });
  });

  it('staff caller is 200 and the validated tenant is what the route reads', async () => {
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(available(body).tenant_id).toBe(TENANT);
    expect(mockResolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowStaffOverride: true, tenantId: TENANT }),
    );
  });
});

describe('verdict through the route (SQL executed on PGlite)', () => {
  it('372/400 confirmed is PASS', async () => {
    await seedDecided(400, 372);
    const b = available((await get()).body);
    expect(b.data_source).toBe('quiz_runs');
    expect(b.headline).toMatchObject({ decided: 400, correct: 372, verdict: 'PASS' });
    expect(b.headline.wilson95.lo).toBeGreaterThanOrEqual(0.9);
  });

  it('371/400 confirmed is FAIL', async () => {
    await seedDecided(400, 371);
    expect(available((await get()).body).headline.verdict).toBe('FAIL');
  });

  it('the first 400 by DECISION time decide; later decisions do not change the verdict', async () => {
    await seedDecided(400, 380);
    await seedDecided(300, 0, { offset: 1000 }); // chronologically after
    const b = available((await get()).body);
    expect(b.headline).toMatchObject({ decided: 700, analysed_n: 400, verdict: 'PASS' });
    expect(b.all_decided.n).toBe(700);
  });

  it('a run shown earlier but decided after the 400th does not displace the sample (C1)', async () => {
    await seedDecided(400, 371); // 371/400 -> FAIL
    // shown 1000 minutes BEFORE every other run, decided 5000 minutes AFTER them: ordering by
    // shown_at would put this confirmed run into the first 400 and flip FAIL to PASS (372/400).
    await seedDecided(1, 1, { offset: -1000, decidedAfter: 5000 });
    const h = available((await get()).body).headline;
    expect(h).toMatchObject({ decided: 401, analysed_n: 400, correct: 371, verdict: 'FAIL' });
  });

  it('the analysis window cuts response rate and pessimistic at the 400th decision (C4)', async () => {
    await seedDecided(400, 380); // decided 2026-11-01 .. +400 min
    await seedStatus('unconfirmed', 20, 'yield_hunter'); // last status 10-15: inside
    await seedStatus('completed', 10, 'yield_hunter', HASH_A, '2026-10-16T00:00:00Z'); // inside
    await seedStatus('unconfirmed', 50, 'yield_hunter', HASH_A, '2026-12-01T00:00:00Z'); // after
    await seedStatus('completed', 5, 'neutral'); // neutral is never asked
    const b = available((await get()).body);
    expect(b.pessimistic).toMatchObject({ n: 430, correct: 380, unconfirmed: 20, abandoned: 10 });
    expect(b.response_rate).toMatchObject({ decided: 400, asked: 430 });
    expect(b.response_rate.rate).toBeCloseTo(400 / 430);
    expect(b.response_rate.valid).toBe(true);
  });

  it('INSUFFICIENT_N on a small local sample', async () => {
    await seedDecided(40, 38);
    expect(available((await get()).body).headline.verdict).toBe('INSUFFICIENT_N');
  });

  it('futility at 130: 110/130 is FUTILE', async () => {
    await seedDecided(130, 110);
    expect(available((await get()).body).headline.verdict).toBe('FUTILE');
  });
});

describe('eligibility (PREREG §2) and the funnel', () => {
  it('counts only confirmed/corrected non-neutral rows; funnel sees every status', async () => {
    await seedDecided(10, 9);
    await seedStatus('shown', 4, null);
    await seedStatus('dismissed', 6, null);
    await seedStatus('completed', 3, 'neutral');
    await seedStatus('completed', 2, 'yield_hunter');
    await seedStatus('unconfirmed', 5, 'yield_hunter');
    await seedStatus('confirmed', 2, 'neutral'); // a neutral leaf is never decided
    const b = available((await get()).body);
    expect(b.headline.decided).toBe(10);
    expect(b.funnel).toMatchObject({
      shown: 10 + 4 + 6 + 3 + 2 + 5 + 2,
      completed: 10 + 3 + 2 + 5 + 2,
      completed_neutral: 3 + 2,
      confirmed: 9 + 2,
      corrected: 1,
      unconfirmed: 5,
    });
    expect(b.funnel.dismissed_by_step).toEqual([
      { step: 0, count: 3 },
      { step: 1, count: 3 },
    ]);
    expect(b.pessimistic).toMatchObject({ n: 17, correct: 9, unconfirmed: 5, abandoned: 2 });
    // asked = completed(22) - neutral(5) = 17; decided 10
    expect(b.response_rate).toMatchObject({ decided: 10, asked: 17 });
  });

  it('the tenant fence: another tenant never leaks in', async () => {
    await seedDecided(5, 5);
    await seedDecided(50, 0, { tenant: OTHER });
    const b = available((await get()).body);
    expect(b.headline.decided).toBe(5);
    expect(b.definition_hashes).toEqual([{ hash: HASH_A, version: 2, n: 5 }]);
  });

  it('default hash = most decided rows; a requested hash wins; NULL-hash rows are ignored', async () => {
    await seedDecided(5, 5, { hash: HASH_B, version: 3, offset: 5000 });
    await seedDecided(8, 4, { hash: HASH_A });
    await seedDecided(4, 4, { hash: null });
    const dflt = available((await get()).body);
    expect(dflt.definition_hash).toBe(HASH_A);
    expect(dflt.definition_hashes.map((h) => [h.hash, h.n])).toEqual([
      [HASH_A, 8],
      [HASH_B, 5],
    ]);
    const other = available((await get(`&definition_hash=${HASH_B}`)).body);
    expect(other.definition_hash).toBe(HASH_B);
    expect(other.headline).toMatchObject({ decided: 5, correct: 5 });
    expect(other.definition_hashes.find((h) => h.hash === HASH_B)?.version).toBe(3);
  });

  it('none_of_these is a confusion column and a miss for precision', async () => {
    await seedDecided(10, 7);
    const b = available((await get()).body);
    expect(b.confusion.columns).toEqual(['yield_hunter', 'none_of_these']);
    expect(b.confusion.matrix).toEqual([[7, 3]]);
    expect(b.per_leaf[0]).toMatchObject({ predicted_n: 10, precision: 0.7, true_n: 7 });
  });

  it('language filter narrows the rows and makes the verdict non-binding', async () => {
    await seedDecided(6, 6, { language: 'en' });
    await seedDecided(4, 0, { language: 'pl', offset: 100 });
    const all = available((await get()).body);
    expect(all.by_language.map((l) => [l.language, l.n])).toEqual([
      ['en', 6],
      ['pl', 4],
    ]);
    expect(all.headline.verdict_binding).toBe(true);
    const pl = available((await get('&language=pl')).body);
    expect(pl.headline).toMatchObject({ decided: 4, correct: 0, verdict_binding: false });
  });

  it('date range: from inclusive, to exclusive, monthly rows by UTC month', async () => {
    await seedDecided(3, 3, { month: '2026-10' });
    await seedDecided(2, 2, { month: '2026-11' });
    const b = available((await get('&from=2026-11-01')).body);
    expect(b.headline.decided).toBe(2);
    const before = available((await get('&to=2026-11-01')).body);
    expect(before.headline.decided).toBe(3);
    expect(available((await get()).body).monthly.map((m) => [m.month, m.decided])).toEqual([
      ['2026-10', 3],
      ['2026-11', 2],
    ]);
  });

  it('speed tertiles and the fast-yes flag come from step_ms / result_ms', async () => {
    await seedDecided(30, 30);
    const b = available((await get()).body);
    expect(b.by_speed_tertile.map((t) => t.n)).toEqual([10, 10, 10]);
    expect(b.by_speed_tertile[0]!.step_ms_range).toEqual([9000, 9000]);
    expect(b.fast_yes).toMatchObject({ confirmed_with_timing: 30, fast: 3 });
  });
});

describe('fail-loud paths', () => {
  it('missing table (42P01) is a 200 available:false with the H002 message, not a 500', async () => {
    await freshDb(false);
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body).toMatchObject({
      available: false,
      data_source: 'quiz_runs',
      code: 'quiz_runs_table_missing',
    });
    expect((body as { message: string }).message).toContain('H002_quiz_runs.sql');
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('a thrown DB error is a 500 plus one Sentry capture, never an empty report', async () => {
    failWith = new Error('connection reset');
    const { status, body } = await get();
    expect(status).toBe(500);
    expect(body).not.toHaveProperty('headline');
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
  });

  it('a bad query parameter is 400', async () => {
    expect((await get('&from=not-a-date')).status).toBe(400);
  });
});
