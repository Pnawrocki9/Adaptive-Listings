/**
 * @vitest-environment node
 *
 * POST /api/quiz/run (FOLLOW-1358, ESC-086 item 2) — route-driven against a REAL Postgres engine
 * (PGlite) that has had the actual handover SQL (`docs/handover/migrations/H002_quiz_runs.sql`)
 * applied, so the state machine under test is the production statement against the production DDL
 * (CHECKs, primary key, ON CONFLICT guard), not a mirror.
 *
 * Pinned: every legal transition of the forward-only state machine; every illegal one (replay,
 * backward step, out of a terminal status, foreign session) answers 200 `applied: false` and
 * changes nothing; timings rounded to 100 ms server-side; HMAC failure 401; unknown key 401;
 * foreign Origin 403 with no row; body tenant ≠ key tenant 403 with no row; opt-out 204 with no
 * row; no profiling consent 204 with no row; missing table 503 `quiz_runs_table_missing` with ONE
 * Sentry capture; the handover file is idempotent and carries RLS + the confirmed_archetype CHECK.
 */

import { createHash, createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';

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

import { POST } from './route';

const MIGRATION = readFileSync(
  new URL('../../../../../../../docs/handover/migrations/H002_quiz_runs.sql', import.meta.url),
  'utf8',
);

const TENANT_ID = '550e8400-e29b-41d4-a716-446655441358';
const OTHER_TENANT_ID = '550e8400-e29b-41d4-a716-446655449999';
const OPS_KEY = 'ops-key-1358';
const DB_KEY = 'db-key-1358';
const REVOKED_KEY = 'revoked-key-1358';
const SESSION = 'a'.repeat(64);
const RUN_ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

let pg: PGlite | null = null;

/** One engine for the file; each test gets an empty quiz_runs (or none). */
async function freshDb(withTable = true): Promise<PGlite> {
  if (!pg || !testDb) {
    pg = new PGlite();
    testDb = drizzlePglite(pg);
    await pg.exec(`
      CREATE TABLE tenants (id uuid PRIMARY KEY);
      CREATE TABLE api_keys (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        hashed_key text NOT NULL UNIQUE,
        expires_at timestamptz,
        revoked_at timestamptz
      );
      INSERT INTO tenants (id) VALUES ('${TENANT_ID}'), ('${OTHER_TENANT_ID}');
    `);
    const sha = (k: string) => createHash('sha256').update(k).digest('hex');
    await pg.query(`INSERT INTO api_keys (tenant_id, hashed_key) VALUES ($1, $2)`, [
      TENANT_ID,
      sha(DB_KEY),
    ]);
    await pg.query(
      `INSERT INTO api_keys (tenant_id, hashed_key, revoked_at) VALUES ($1, $2, now())`,
      [TENANT_ID, sha(REVOKED_KEY)],
    );
  }
  await pg.exec(`DROP TABLE IF EXISTS quiz_runs`);
  if (withTable) await pg.exec(MIGRATION);
  return pg;
}

interface RunRow {
  status: string;
  session_id: string;
  tenant_id: string;
  resolved_archetype: string | null;
  confirmed_archetype: string | null;
  last_step: number | null;
  step_ms: number[] | null;
  result_ms: number | null;
  offered: unknown;
  traits: unknown;
  answer_path: unknown;
  definition_hash: string | null;
  definition_version: number | null;
}

async function runRows(): Promise<RunRow[]> {
  const res = await pg!.query<RunRow>(`SELECT * FROM quiz_runs ORDER BY shown_at`);
  return res.rows;
}

function ping(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    quiz_run_id: RUN_ID,
    event: 'shown',
    tenant_id: TENANT_ID,
    session_id: SESSION,
    language: 'en',
    definition_hash: 'f'.repeat(64),
    definition_version: null,
    sdk_version: '0.9.0',
    consent_state: 'consented',
    ...overrides,
  };
}

/** Ops-key request (no HMAC): the state-machine tests' transport. */
function opsRequest(body: unknown, query = ''): NextRequest {
  return new NextRequest(`http://localhost/api/quiz/run${query}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPS_KEY}` },
    body: JSON.stringify(body),
  });
}

/** Real HMAC request through the api_keys lookup. */
function signedRequest(
  body: unknown,
  opts: { key?: string; origin?: string; signature?: string } = {},
): NextRequest {
  const key = opts.key ?? DB_KEY;
  const raw = JSON.stringify(body);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${key}`,
    'X-Estalara-Signature': opts.signature ?? createHmac('sha256', key).update(raw).digest('hex'),
  };
  if (opts.origin) headers.Origin = opts.origin;
  return new NextRequest('http://localhost/api/quiz/run', { method: 'POST', headers, body: raw });
}

async function send(body: unknown): Promise<{ status: number; applied?: boolean }> {
  const res = await POST(opsRequest(body));
  const json = res.status === 200 ? ((await res.json()) as { applied: boolean }) : undefined;
  return { status: res.status, ...(json ? { applied: json.applied } : {}) };
}

// PGlite (WASM) start-up takes seconds, more under memory pressure: pay it once, outside any test's
// own timeout.
beforeAll(async () => {
  await freshDb();
}, 120_000);

beforeEach(() => {
  mockCaptureException.mockClear();
  vi.stubEnv('ADAPT_API_KEY', OPS_KEY);
  vi.stubEnv('ADAPT_TENANT_ID', TENANT_ID);
  vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://unused/unused');
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  testDb = null;
  await pg?.close();
  pg = null;
});

describe('state machine — legal transitions', () => {
  it('shown → completed → confirmed: each applies, later pings keep earlier data', async () => {
    await freshDb();
    expect(await send(ping())).toEqual({ status: 200, applied: true });
    expect((await runRows())[0]).toMatchObject({ status: 'shown', tenant_id: TENANT_ID });

    expect(
      await send(
        ping({
          event: 'completed',
          resolved_archetype: 'family_buyer',
          answer_path: [
            { question_id: 'q_purpose', answer_index: 1 },
            { question_id: 'q_traits', answer_indexes: [0, 6] },
          ],
          traits: ['premium', 'has_children'],
          step_ms: [3_149, 2_151],
          last_step: 2,
        }),
      ),
    ).toEqual({ status: 200, applied: true });

    expect(
      await send(
        ping({ event: 'confirmed', confirmed_archetype: 'family_buyer', result_ms: 1_249 }),
      ),
    ).toEqual({ status: 200, applied: true });

    const [row] = await runRows();
    expect(row).toMatchObject({
      status: 'confirmed',
      resolved_archetype: 'family_buyer',
      confirmed_archetype: 'family_buyer',
      traits: ['premium', 'has_children'],
      last_step: 2,
      // rounded to 100 ms server-side
      step_ms: [3_100, 2_200],
      result_ms: 1_200,
      definition_hash: 'f'.repeat(64),
      definition_version: null,
    });
    expect(row!.answer_path).toEqual([
      { question_id: 'q_purpose', answer_index: 1 },
      { question_id: 'q_traits', answer_indexes: [0, 6] },
    ]);
  });

  it('shown → dismissed records last_step', async () => {
    await freshDb();
    await send(ping());
    expect(await send(ping({ event: 'dismissed', last_step: 1 }))).toEqual({
      status: 200,
      applied: true,
    });
    expect((await runRows())[0]).toMatchObject({ status: 'dismissed', last_step: 1 });
  });

  it('completed → corrected to none_of_these with the offered alternatives', async () => {
    await freshDb();
    await send(ping({ event: 'completed', resolved_archetype: 'yield_hunter' }));
    expect(
      await send(
        ping({
          event: 'corrected',
          offered: ['flip_investor', 'commercial_investor', 'vacation_rental_investor'],
          confirmed_archetype: 'none_of_these',
        }),
      ),
    ).toEqual({ status: 200, applied: true });
    expect((await runRows())[0]).toMatchObject({
      status: 'corrected',
      confirmed_archetype: 'none_of_these',
      offered: ['flip_investor', 'commercial_investor', 'vacation_rental_investor'],
    });
  });

  it('completed → unconfirmed', async () => {
    await freshDb();
    await send(ping({ event: 'completed', resolved_archetype: 'downsizer' }));
    expect(await send(ping({ event: 'unconfirmed' }))).toEqual({ status: 200, applied: true });
    expect((await runRows())[0]!.status).toBe('unconfirmed');
  });

  it('a lost shown ping does not cost the next one: the first ping inserts at its own status', async () => {
    await freshDb();
    expect(
      await send(ping({ event: 'completed', resolved_archetype: 'retiree_relocator' })),
    ).toEqual({ status: 200, applied: true });
    expect((await runRows())[0]!.status).toBe('completed');
  });

  it('shown → confirmed skips a lost completed ping (still forward)', async () => {
    await freshDb();
    await send(ping());
    expect(
      await send(
        ping({
          event: 'confirmed',
          resolved_archetype: 'first_time_buyer',
          confirmed_archetype: 'first_time_buyer',
        }),
      ),
    ).toEqual({ status: 200, applied: true });
    expect((await runRows())[0]!.status).toBe('confirmed');
  });
});

describe('state machine — illegal transitions are 200 no-ops', () => {
  it('a replay of the same status changes nothing', async () => {
    await freshDb();
    await send(ping());
    expect(await send(ping({ language: 'pl' }))).toEqual({ status: 200, applied: false });
    expect((await runRows())[0]).toMatchObject({ status: 'shown' });
    const lang = await pg!.query<{ language: string }>(`SELECT language FROM quiz_runs`);
    expect(lang.rows[0]!.language).toBe('en');
  });

  it('backward: completed → dismissed, completed → shown', async () => {
    await freshDb();
    await send(ping({ event: 'completed', resolved_archetype: 'upsizer' }));
    expect(await send(ping({ event: 'dismissed', last_step: 0 }))).toEqual({
      status: 200,
      applied: false,
    });
    expect(await send(ping({ event: 'shown' }))).toEqual({ status: 200, applied: false });
    expect((await runRows())[0]).toMatchObject({ status: 'completed', last_step: null });
  });

  it('dismissed is terminal: completed and confirmed after it change nothing', async () => {
    await freshDb();
    await send(ping());
    await send(ping({ event: 'dismissed', last_step: 1 }));
    expect(await send(ping({ event: 'completed', resolved_archetype: 'yield_hunter' }))).toEqual({
      status: 200,
      applied: false,
    });
    expect(await send(ping({ event: 'confirmed', confirmed_archetype: 'yield_hunter' }))).toEqual({
      status: 200,
      applied: false,
    });
    expect((await runRows())[0]).toMatchObject({
      status: 'dismissed',
      resolved_archetype: null,
      confirmed_archetype: null,
    });
  });

  it('the first terminal outcome wins: confirmed → corrected / unconfirmed change nothing', async () => {
    await freshDb();
    await send(ping({ event: 'completed', resolved_archetype: 'family_buyer' }));
    await send(ping({ event: 'confirmed', confirmed_archetype: 'family_buyer' }));
    expect(
      await send(ping({ event: 'corrected', confirmed_archetype: 'first_time_buyer' })),
    ).toEqual({ status: 200, applied: false });
    expect(await send(ping({ event: 'unconfirmed' }))).toEqual({ status: 200, applied: false });
    expect((await runRows())[0]).toMatchObject({
      status: 'confirmed',
      confirmed_archetype: 'family_buyer',
    });
  });

  it('a different session reusing the run id changes nothing (row fenced on its own session)', async () => {
    await freshDb();
    await send(ping());
    expect(
      await send(
        ping({ event: 'completed', session_id: 'b'.repeat(64), resolved_archetype: 'neutral' }),
      ),
    ).toEqual({ status: 200, applied: false });
    expect(await runRows()).toHaveLength(1);
    expect((await runRows())[0]).toMatchObject({ status: 'shown', session_id: SESSION });
  });
});

describe('validation', () => {
  it('400 when confirmed_archetype rides a non-confirmation event (the DB CHECK is never reached)', async () => {
    await freshDb();
    const res = await POST(
      opsRequest(ping({ event: 'completed', confirmed_archetype: 'family_buyer' })),
    );
    expect(res.status).toBe(400);
    expect(await runRows()).toEqual([]);
  });

  it('400 on a non-canonical archetype, an unknown trait, an over-cap timing or a missing run id', async () => {
    await freshDb();
    for (const bad of [
      ping({ event: 'completed', resolved_archetype: 'astronaut' }),
      ping({ traits: ['likes_cats'] }),
      ping({ step_ms: [600_001] }),
      ping({ quiz_run_id: undefined }),
      ping({ answer_path: [{ question_id: 'q', answer_index: 1, answer_indexes: [1] }] }),
    ]) {
      expect((await POST(opsRequest(bad))).status).toBe(400);
    }
    expect(await runRows()).toEqual([]);
  });
});

describe('auth, tenant fence and privacy gates', () => {
  it('401 without a bearer, with a bad HMAC, and with a revoked key — nothing written', async () => {
    await freshDb();
    const noBearer = new NextRequest('http://localhost/api/quiz/run', {
      method: 'POST',
      body: JSON.stringify(ping()),
    });
    expect((await POST(noBearer)).status).toBe(401);
    expect((await POST(signedRequest(ping(), { signature: '0'.repeat(64) }))).status).toBe(401);
    expect((await POST(signedRequest(ping(), { key: REVOKED_KEY }))).status).toBe(401);
    expect(await runRows()).toEqual([]);
  });

  it('200 through the real HMAC + api_keys path with a listed origin', async () => {
    await freshDb();
    const res = await POST(signedRequest(ping(), { origin: 'http://localhost:5173' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ applied: true });
    expect((await runRows())[0]!.tenant_id).toBe(TENANT_ID);
  });

  it('403 for a foreign browser Origin — before any write', async () => {
    await freshDb();
    const res = await POST(signedRequest(ping(), { origin: 'https://evil.example.com' }));
    expect(res.status).toBe(403);
    expect(await runRows()).toEqual([]);
  });

  it("403 when the body names a tenant other than the key's — nothing written", async () => {
    await freshDb();
    const res = await POST(opsRequest(ping({ tenant_id: OTHER_TENANT_ID })));
    expect(res.status).toBe(403);
    expect(await runRows()).toEqual([]);
  });

  it('204 and no row when profiling_opt_out=1 (after auth: no key → still 401)', async () => {
    await freshDb();
    const res = await POST(opsRequest(ping(), '?profiling_opt_out=1'));
    expect(res.status).toBe(204);
    expect(await runRows()).toEqual([]);
    const noKey = new NextRequest('http://localhost/api/quiz/run?profiling_opt_out=1', {
      method: 'POST',
      body: JSON.stringify(ping()),
    });
    expect((await POST(noKey)).status).toBe(401);
  });

  it('204 and no row unless consent_state is `consented` — absent and legitimate-interest included [C3/C5]', async () => {
    await freshDb();
    for (const state of ['none', 'session-only', 'legitimate-interest', undefined]) {
      expect((await POST(opsRequest(ping({ consent_state: state })))).status).toBe(204);
    }
    expect(await runRows()).toEqual([]);
    expect(await send(ping({ consent_state: 'consented' }))).toEqual({
      status: 200,
      applied: true,
    });
  });

  it('stores nothing beyond the schema: ip / user_agent / unknown keys are dropped', async () => {
    await freshDb();
    expect(
      await send(ping({ ip: '203.0.113.7', user_agent: 'Mozilla/5.0 probe', note: 'free text' })),
    ).toEqual({ status: 200, applied: true });
    const dump = JSON.stringify((await pg!.query(`SELECT * FROM quiz_runs`)).rows);
    for (const leaked of ['203.0.113.7', 'Mozilla/5.0 probe', 'free text']) {
      expect(dump).not.toContain(leaked);
    }
  });
});

describe('missing table (H002 not applied)', () => {
  it('503 quiz_runs_table_missing with ONE Sentry capture', async () => {
    await freshDb(false);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await POST(opsRequest(ping()));
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('quiz_runs_table_missing');
    await vi.waitFor(() => {
      expect(mockCaptureException).toHaveBeenCalledTimes(1);
    });
    const [, ctx] = mockCaptureException.mock.calls[0] as [
      unknown,
      { tags: Record<string, string> },
    ];
    expect(ctx.tags).toMatchObject({ route: 'quiz/run', error_code: 'quiz_runs_table_missing' });
    assertSanitised();
  });

  it('500 path: a failing query never hands its params to Sentry or the log [C1]', async () => {
    const db = await freshDb();
    // Any non-42P01 failure: the driver error message is "Failed query: insert … params: …".
    await db.exec(`ALTER TABLE quiz_runs ADD CONSTRAINT quiz_runs_boom CHECK (false) NOT VALID`);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await POST(
      opsRequest(ping({ answer_path: [{ question_id: 'q_x', answer_index: 3 }] })),
    );
    expect(res.status).toBe(500);
    await vi.waitFor(() => {
      expect(mockCaptureException).toHaveBeenCalledTimes(1);
    });
    const [captured, ctx] = mockCaptureException.mock.calls[0] as [
      Error,
      { tags: Record<string, string> },
    ];
    expect(ctx.tags).toMatchObject({ error_code: 'quiz_run_write_failed', sqlstate: '23514' });
    expect(captured.message).toContain('23514');
    assertSanitised();
  });
});

/** C1: the captured error (message + whole cause chain) and every console.error line hold no params. */
function assertSanitised(): void {
  const [captured] = mockCaptureException.mock.calls[0] as [Error];
  expect(captured.cause).toBeUndefined();
  const seen: string[] = [captured.message, captured.stack ?? ''];
  const logged = vi.mocked(console.error).mock.calls.flat().map(String);
  for (const text of [...seen, ...logged]) {
    expect(text).not.toContain(SESSION);
    expect(text).not.toContain(RUN_ID);
    expect(text).not.toMatch(/params|Failed query|q_x/);
  }
}

describe('the handover migration H002', () => {
  it('is idempotent, enables RLS with a tenant policy, and enforces the confirmed_archetype CHECK', async () => {
    const db = await freshDb();
    await db.exec(MIGRATION);
    const pol = await db.query<{ polname: string }>(
      `select polname from pg_policy where polrelid = 'quiz_runs'::regclass`,
    );
    expect(pol.rows.map((r) => r.polname)).toEqual(['quiz_runs_tenant_isolation']);
    const rls = await db.query<{ relrowsecurity: boolean }>(
      `select relrowsecurity from pg_class where relname = 'quiz_runs'`,
    );
    expect(rls.rows[0]!.relrowsecurity).toBe(true);
    await expect(
      db.query(
        `insert into quiz_runs (id, tenant_id, session_id, status, confirmed_archetype)
         values (gen_random_uuid(), $1, 's', 'shown', 'family_buyer')`,
        [TENANT_ID],
      ),
    ).rejects.toThrow(/quiz_runs_confirmed_archetype_check/);
    await expect(
      db.query(
        `insert into quiz_runs (id, tenant_id, session_id, status)
         values (gen_random_uuid(), $1, 's', 'finished')`,
        [TENANT_ID],
      ),
    ).rejects.toThrow(/check/i);
    // Each step_ms element is capped DB-side too (0..600000).
    await expect(
      db.query(
        `insert into quiz_runs (id, tenant_id, session_id, status, step_ms)
         values (gen_random_uuid(), $1, 's', 'shown', '{100,700000}')`,
        [TENANT_ID],
      ),
    ).rejects.toThrow(/check/i);
  });

  it('cascades on tenant delete (ON DELETE CASCADE)', async () => {
    const db = await freshDb();
    await send(ping());
    await db.exec(`DELETE FROM api_keys WHERE tenant_id = '${TENANT_ID}'`);
    await db.exec(`DELETE FROM tenants WHERE id = '${TENANT_ID}'`);
    expect(await runRows()).toEqual([]);
    // restore for later files/tests in this engine
    await pg!.close();
    pg = null;
    testDb = null;
  });
});
