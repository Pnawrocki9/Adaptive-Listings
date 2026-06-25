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
  ]) {
    SAVED_ENV[key] = process.env[key];
  }
  process.env.OPENAI_API_KEY = 'sk-test-000';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key';
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.FORCE_RESEED = 'false';
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
