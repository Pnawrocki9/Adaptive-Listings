/**
 * Unit tests for src/lib/archetype-seeder.ts
 *
 * Acceptance criteria (FOLLOW-341 AC6):
 *   Mock the OpenAI call; assert the job correctly upserts the embedding for
 *   a test archetype row fetched from Supabase PostgREST.
 *
 * What we test:
 *   1. Happy path: fetches pending rows, calls OpenAI once per row, PATCHes
 *      the vector back — upsert body carries the correct 1024-dim vector.
 *   2. No-op when all rows already have embeddings (nothing to seed).
 *   3. Per-archetype error isolation: one OpenAI failure → that row counted
 *      as failed; other rows still succeed.
 *   4. PATCH failure → row counted as failed, not thrown.
 *   5. ARCHETYPE_EMBEDDING_DIM constant is 1024.
 *   6. Transport selection driven through seedArchetypeEmbeddings(): a loopback
 *      DATABASE_URL_ADMIN writes to local Postgres and never touches the hosted
 *      project, and a forced direct write to a hosted host is REFUSED
 *      (FOLLOW-1191 / audit finding L-8).
 *
 * Mocking strategy:
 *   vi.mock('openai') intercepts the OpenAI SDK at module-graph level so the
 *   module-level _openai singleton inside archetype-seeder.ts is populated
 *   with the mock.
 *   vi.stubGlobal('fetch', ...) intercepts Supabase PostgREST HTTP calls.
 *
 * @module apps/control-plane/src/lib/__tests__/seed-archetypes.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Hoist the mock so vi.mock can reference it ───────────────────────────────

const mockEmbeddingsCreate = vi.hoisted(() => vi.fn());

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    embeddings: { create: mockEmbeddingsCreate },
  })),
}));

// ─── Direct-Postgres transport mock (FOLLOW-1191) ────────────────────────────
// `directPostgresBackend` dynamically imports @estalara/db. Mocking it lets the
// tests below drive the transport through seedArchetypeEmbeddings() — the real
// entrypoint — instead of asserting on a resolver's return value.

const pgSpy = vi.hoisted(() => ({
  pendingRows: [] as { archetype_name: string; description: string }[],
  cleared: 0,
  updates: [] as { name: string; dims: number }[],
  // FOLLOW-1193: which URL each client factory was asked to connect with.
  connectedWith: [] as string[],
  adminClientCalls: 0,
}));

vi.mock('@estalara/db', () => {
  const selectChain = {
    from: () => selectChain,
    where: () => Promise.resolve(pgSpy.pendingRows),
  };
  const updateChain = (set: Record<string, unknown>) => ({
    where: (name: string) => {
      const embedding = set.embedding as number[] | null;
      if (embedding) pgSpy.updates.push({ name, dims: embedding.length });
      return Promise.resolve();
    },
    then: (resolve: (v: unknown) => unknown) => {
      // `.set()` awaited without `.where()` — the FORCE_RESEED clear-all path.
      if (set.embedding === null) pgSpy.cleared += 1;
      return Promise.resolve(undefined).then(resolve);
    },
  });
  const client = {
    select: () => selectChain,
    update: () => ({ set: updateChain }),
  };
  return {
    // `createAdminClient()` re-reads DATABASE_URL_ADMIN on its own; the seeder
    // must not use it (FOLLOW-1193 / RETRO-324 §4a LG-4). Counted, not refused,
    // so the pre-fix code still seeds and the test fails on the assertion.
    createAdminClient: () => {
      pgSpy.adminClientCalls += 1;
      return client;
    },
    createClient: (url: string) => {
      pgSpy.connectedWith.push(url);
      return client;
    },
    archetypeEmbeddings: { archetypeName: 'archetype_name', description: 'description' },
  };
});

vi.mock('drizzle-orm', () => ({
  eq: (_col: unknown, value: string) => value,
  isNull: () => 'is-null',
}));

// ─── Import under test (after vi.mock is hoisted) ─────────────────────────────

import {
  ARCHETYPE_EMBEDDING_DIM,
  _resetOpenAIForTest,
  seedArchetypeEmbeddings,
} from '../archetype-seeder.js';

// ─── Constants & fixtures ────────────────────────────────────────────────────

/** 1024-dim deterministic test vector (values 0/1024, 1/1024, …). */
const MOCK_VECTOR: number[] = Array.from(
  { length: ARCHETYPE_EMBEDDING_DIM },
  (_, i) => i / ARCHETYPE_EMBEDDING_DIM,
);

const ROW_YIELD = {
  archetype_name: 'yield_hunter',
  description: 'Real estate investor focused on rental yield and ROI.',
};
const ROW_FAMILY = {
  archetype_name: 'family_buyer',
  description: 'Family purchasing a primary residence.',
};

// ─── Env helpers ─────────────────────────────────────────────────────────────

const SAVED_ENV: Record<string, string | undefined> = {};

function setTestEnv(): void {
  for (const key of [
    'OPENAI_API_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_URL',
    'FORCE_RESEED',
    // FOLLOW-1191: resolveSeedTarget() reads these. An inherited loopback
    // DATABASE_URL_ADMIN would route the PostgREST tests down the direct-Postgres
    // transport, so they are cleared explicitly rather than merely saved.
    'DATABASE_URL_ADMIN',
    'DATABASE_URL_DIRECT',
    'ARCHETYPE_SEED_TRANSPORT',
  ]) {
    SAVED_ENV[key] = process.env[key];
  }
  process.env.OPENAI_API_KEY = 'sk-test-000';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.FORCE_RESEED = 'false';
  Reflect.deleteProperty(process.env, 'DATABASE_URL_ADMIN');
  Reflect.deleteProperty(process.env, 'DATABASE_URL_DIRECT');
  Reflect.deleteProperty(process.env, 'ARCHETYPE_SEED_TRANSPORT');
}

function restoreEnv(): void {
  for (const [key, val] of Object.entries(SAVED_ENV)) {
    if (val === undefined) Reflect.deleteProperty(process.env, key);
    else process.env[key] = val;
  }
}

// ─── PostgREST fetch mock factory ────────────────────────────────────────────

/**
 * Returns a fetch mock that simulates the two Supabase PostgREST calls made
 * by seedArchetypeEmbeddings():
 *   GET  …?embedding=is.null  → JSON array of pendingRows
 *   PATCH …?archetype_name=eq.X → 204 (success) or patchStatus
 */
function makeSupabaseFetch(
  pendingRows: { archetype_name: string; description: string }[],
  patchStatus = 204,
): ReturnType<typeof vi.fn> {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const urlStr = url;
    const method = (init?.method ?? 'GET').toUpperCase();

    // SELECT: fetch rows where embedding IS NULL
    if (method === 'GET' && urlStr.includes('is.null')) {
      return Promise.resolve(
        new Response(JSON.stringify(pendingRows), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    }

    // PATCH: update the embedding for one archetype
    if (method === 'PATCH') {
      return Promise.resolve(new Response(null, { status: patchStatus }));
    }

    return Promise.resolve(new Response('{}', { status: 200 }));
  });
}

// ─── Before / after hooks ────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  _resetOpenAIForTest(); // reset module-level singleton so mock takes effect
  setTestEnv();
  // Default: OpenAI returns a valid 1024-dim vector
  mockEmbeddingsCreate.mockResolvedValue({ data: [{ embedding: MOCK_VECTOR }] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  restoreEnv();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('ARCHETYPE_EMBEDDING_DIM constant', () => {
  it('equals 1024 (matching OpenAI text-embedding-3-small reduced dims)', () => {
    expect(ARCHETYPE_EMBEDDING_DIM).toBe(1024);
  });
});

describe('seedArchetypeEmbeddings — happy path', () => {
  it('calls OpenAI once per pending row and PATCHes the 1024-dim vector back', async () => {
    const fetchMock = makeSupabaseFetch([ROW_YIELD]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await seedArchetypeEmbeddings();

    expect(result.attempted).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);

    // OpenAI called exactly once, with the row's description
    expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(1);
    expect(mockEmbeddingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'text-embedding-3-small',
        input: ROW_YIELD.description,
        dimensions: ARCHETYPE_EMBEDDING_DIM,
      }),
    );

    // PATCH called with archetype_name in the URL
    const calls = fetchMock.mock.calls as [string, RequestInit][];
    const patchCall = calls.find(
      ([url, init]) =>
        (init.method?.toUpperCase() ?? '') === 'PATCH' &&
        url.includes(`archetype_name=eq.${ROW_YIELD.archetype_name}`),
    );
    expect(patchCall).toBeDefined();
  });

  it('PATCH body carries the correct 1024-dim vector string', async () => {
    const fetchMock = makeSupabaseFetch([ROW_YIELD]);
    vi.stubGlobal('fetch', fetchMock);

    await seedArchetypeEmbeddings();

    const calls = fetchMock.mock.calls as [string, RequestInit][];
    const patchCall = calls.find(
      ([url, init]) =>
        (init.method?.toUpperCase() ?? '') === 'PATCH' &&
        url.includes(`archetype_name=eq.${ROW_YIELD.archetype_name}`),
    );
    expect(patchCall).toBeDefined();

    const body = JSON.parse(patchCall![1].body as string) as { embedding: string };
    const vec: number[] = JSON.parse(body.embedding) as number[];
    expect(vec).toHaveLength(ARCHETYPE_EMBEDDING_DIM);
    // Spot-check a few values from our deterministic mock vector
    expect(vec[0]).toBeCloseTo(0);
    expect(vec[1]).toBeCloseTo(1 / ARCHETYPE_EMBEDDING_DIM);
  });

  it('handles multiple pending rows: calls OpenAI once per row', async () => {
    const fetchMock = makeSupabaseFetch([ROW_YIELD, ROW_FAMILY]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await seedArchetypeEmbeddings();

    expect(result.attempted).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(mockEmbeddingsCreate).toHaveBeenCalledTimes(2);
  });
});

describe('seedArchetypeEmbeddings — no-op when already seeded', () => {
  it('returns attempted=0 when PostgREST returns an empty array', async () => {
    const fetchMock = makeSupabaseFetch([]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await seedArchetypeEmbeddings();

    expect(result.attempted).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.failed).toBe(0);
    // OpenAI must never be called
    expect(mockEmbeddingsCreate).not.toHaveBeenCalled();
  });
});

describe('seedArchetypeEmbeddings — error handling', () => {
  it('counts a row as failed when OpenAI throws; does not propagate the error', async () => {
    mockEmbeddingsCreate.mockRejectedValueOnce(new Error('Rate limit exceeded'));
    const fetchMock = makeSupabaseFetch([ROW_YIELD]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await seedArchetypeEmbeddings();

    expect(result.attempted).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(0);
  });

  it('counts a row as failed when the PATCH returns a non-2xx status', async () => {
    const fetchMock = makeSupabaseFetch([ROW_YIELD], 500);
    vi.stubGlobal('fetch', fetchMock);

    const result = await seedArchetypeEmbeddings();

    expect(result.attempted).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(0);
  });

  it('counts each row independently when some succeed and some fail', async () => {
    const rows = [ROW_YIELD, ROW_FAMILY];
    // Second OpenAI call fails, first succeeds
    mockEmbeddingsCreate
      .mockResolvedValueOnce({ data: [{ embedding: MOCK_VECTOR }] })
      .mockRejectedValueOnce(new Error('Timeout'));

    const fetchMock = makeSupabaseFetch(rows);
    vi.stubGlobal('fetch', fetchMock);

    const result = await seedArchetypeEmbeddings();

    expect(result.attempted).toBe(2);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(1);
  });
});

// ─── Transport selection, driven through the real entrypoint ─────────────────
// FOLLOW-1191 / audit finding L-8. Asserted through seedArchetypeEmbeddings()
// rather than on a resolver's return value, so each case proves the transport
// that was CHOSEN is also the one that ran.

describe('seedArchetypeEmbeddings — transport selection', () => {
  const LOOPBACK = 'postgresql://supabase_admin:postgres@127.0.0.1:5433/postgres';
  const HOSTED = 'postgresql://postgres:pw@db.example-project.supabase.co:5432/postgres';

  beforeEach(() => {
    pgSpy.pendingRows = [];
    pgSpy.cleared = 0;
    pgSpy.updates = [];
    pgSpy.connectedWith = [];
    pgSpy.adminClientCalls = 0;
  });

  // FOLLOW-1193 / RETRO-324 §4a LG-4: the direct backend used to LABEL its log
  // line from the resolved URL but CONNECT via createAdminClient(), which
  // re-reads the environment on its own. This fails if the two ever diverge:
  // the connection must be opened with the exact URL the printed label names.
  it('connects with the exact URL its printed target label names', async () => {
    process.env.DATABASE_URL_ADMIN = LOOPBACK;
    pgSpy.pendingRows = [ROW_YIELD];
    vi.stubGlobal('fetch', makeSupabaseFetch([]));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await seedArchetypeEmbeddings();

    const label = logSpy.mock.calls
      .map((c) => String(c[0]))
      .find((line) => line.startsWith('[archetype-seeder] target:'));
    logSpy.mockRestore();

    expect(pgSpy.connectedWith).toEqual([LOOPBACK]);
    expect(pgSpy.adminClientCalls).toBe(0);
    expect(label).toBe('[archetype-seeder] target: direct Postgres 127.0.0.1:5433/postgres');
  });

  it('uses PostgREST when no admin URL is present', async () => {
    const fetchMock = makeSupabaseFetch([ROW_YIELD]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await seedArchetypeEmbeddings();

    expect(result.succeeded).toBe(1);
    expect(pgSpy.updates).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('writes to LOOPBACK Postgres — not the hosted project — when DATABASE_URL_ADMIN is local', async () => {
    process.env.DATABASE_URL_ADMIN = LOOPBACK;
    pgSpy.pendingRows = [ROW_YIELD, ROW_FAMILY];
    const fetchMock = makeSupabaseFetch([]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await seedArchetypeEmbeddings();

    expect(result).toEqual({ attempted: 2, succeeded: 2, failed: 0 });
    expect(pgSpy.updates).toEqual([
      { name: 'yield_hunter', dims: ARCHETYPE_EMBEDDING_DIM },
      { name: 'family_buyer', dims: ARCHETYPE_EMBEDDING_DIM },
    ]);
    // The hosted project must not have been touched at all.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('FORCE_RESEED clears embeddings on the direct-Postgres path too', async () => {
    process.env.DATABASE_URL_ADMIN = LOOPBACK;
    process.env.FORCE_RESEED = 'true';
    pgSpy.pendingRows = [ROW_YIELD];
    vi.stubGlobal('fetch', makeSupabaseFetch([]));

    await seedArchetypeEmbeddings();

    expect(pgSpy.cleared).toBe(1);
  });

  it('leaves a HOSTED DATABASE_URL_ADMIN on the PostgREST path (CI/prod unchanged)', async () => {
    process.env.DATABASE_URL_ADMIN = HOSTED;
    const fetchMock = makeSupabaseFetch([ROW_YIELD]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await seedArchetypeEmbeddings();

    expect(result.succeeded).toBe(1);
    expect(pgSpy.updates).toEqual([]);
    expect(fetchMock).toHaveBeenCalled();
  });

  it('REFUSES a forced direct write to a non-loopback host', async () => {
    process.env.ARCHETYPE_SEED_TRANSPORT = 'postgres';
    process.env.DATABASE_URL_ADMIN = HOSTED;
    const fetchMock = makeSupabaseFetch([ROW_YIELD]);
    vi.stubGlobal('fetch', fetchMock);

    await expect(seedArchetypeEmbeddings()).rejects.toThrow(
      /REFUSING a direct write to host "db.example-project.supabase.co"/,
    );
    // Refusal, not a silent downgrade to the hosted PostgREST path.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pgSpy.updates).toEqual([]);
  });

  it('accepts a forced direct write to a loopback host', async () => {
    process.env.ARCHETYPE_SEED_TRANSPORT = 'postgres';
    process.env.DATABASE_URL_ADMIN = 'postgresql://u:p@localhost:5433/postgres';
    pgSpy.pendingRows = [ROW_YIELD];
    vi.stubGlobal('fetch', makeSupabaseFetch([]));

    const result = await seedArchetypeEmbeddings();

    expect(result.succeeded).toBe(1);
    expect(pgSpy.updates).toHaveLength(1);
  });

  it('throws when the direct transport is forced without an admin URL', async () => {
    process.env.ARCHETYPE_SEED_TRANSPORT = 'postgres';
    vi.stubGlobal('fetch', makeSupabaseFetch([]));

    await expect(seedArchetypeEmbeddings()).rejects.toThrow(/requires DATABASE_URL_ADMIN/);
  });

  it('falls back to PostgREST when an auto-detected admin URL is unparseable', async () => {
    process.env.DATABASE_URL_ADMIN = 'not a url';
    const fetchMock = makeSupabaseFetch([ROW_YIELD]);
    vi.stubGlobal('fetch', fetchMock);

    const result = await seedArchetypeEmbeddings();

    expect(result.succeeded).toBe(1);
    expect(fetchMock).toHaveBeenCalled();
  });
});
