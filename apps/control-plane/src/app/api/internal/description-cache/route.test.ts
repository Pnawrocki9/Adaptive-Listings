/**
 * Tests for POST /api/internal/description-cache — FOLLOW-456 / audit F-13.
 *
 * Coverage:
 *   - 401 when DESCRIPTION_CACHE_INTERNAL_SECRET is unset (fail-closed —
 *     previously an unset secret accepted ANY non-empty bearer token).
 *   - 401 when the secret is set but the bearer is missing/wrong.
 *   - 201 when the secret is set and the bearer matches (constant-time compare) —
 *     proving a correctly-signed Modal callback (FOLLOW-460) still succeeds.
 *   - 400 on invalid body.
 *   - 500 when the configured-DB write throws (fail-loud, Rule K.2).
 *
 * @module apps/control-plane/src/app/api/internal/description-cache/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { mockUpdate, mockInsert } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockInsert: vi.fn(),
}));

vi.mock('@estalara/db', () => ({
  createTenantClient: vi.fn(() => ({
    update: mockUpdate,
    insert: mockInsert,
  })),
  descriptionCachePersistent: {
    tenantId: 'tenant_id',
    listingId: 'listing_id',
    archetype: 'archetype',
    locale: 'locale',
    invalidatedAt: 'invalidated_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  isNull: vi.fn((a: unknown) => ({ op: 'isNull', a })),
}));

import { POST } from './route';

const SECRET = 'test-description-cache-secret-xyz';
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';

const VALID_BODY = {
  tenant_id: TENANT_ID,
  listing_id: 'listing-1',
  archetype: 'yield_hunter',
  locale: 'en' as const,
  description: 'A lovely home.',
  headline: 'Lovely home',
  model: 'claude-sonnet-4-6',
};

function makeRequest(opts: { bearer?: string; body?: unknown } = {}): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.bearer !== undefined) {
    headers.Authorization = `Bearer ${opts.bearer}`;
  }
  return new NextRequest('http://localhost/api/internal/description-cache', {
    method: 'POST',
    headers,
    body: JSON.stringify(opts.body ?? VALID_BODY),
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  // DATABASE_URL unset by default -> insertPgCachedDescriptionStrict is a no-op
  // ("not configured" path, Rule K.2) unless a test opts in below.
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('POST /api/internal/description-cache — auth (fail-closed)', () => {
  it('returns 401 when DESCRIPTION_CACHE_INTERNAL_SECRET is unset, even with no bearer', async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 when DESCRIPTION_CACHE_INTERNAL_SECRET is unset, even with a non-empty bearer', async () => {
    // This is exactly the fail-open bug: previously any non-empty token was accepted here.
    const res = await POST(makeRequest({ bearer: 'anything-non-empty' }));
    expect(res.status).toBe(401);
  });

  it('returns 401 when no bearer token is provided at all', async () => {
    vi.stubEnv('DESCRIPTION_CACHE_INTERNAL_SECRET', SECRET);
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 when the bearer token is wrong', async () => {
    vi.stubEnv('DESCRIPTION_CACHE_INTERNAL_SECRET', SECRET);
    const res = await POST(makeRequest({ bearer: 'wrong-secret' }));
    expect(res.status).toBe(401);
  });

  it('returns 201 when the bearer token matches (correctly-signed Modal callback)', async () => {
    vi.stubEnv('DESCRIPTION_CACHE_INTERNAL_SECRET', SECRET);
    const res = await POST(makeRequest({ bearer: SECRET }));
    expect(res.status).toBe(201);
    const body = await parseBody<{ written: boolean }>(res);
    expect(body.written).toBe(true);
  });
});

describe('POST /api/internal/description-cache — validation + fail-loud', () => {
  beforeEach(() => {
    vi.stubEnv('DESCRIPTION_CACHE_INTERNAL_SECRET', SECRET);
  });

  it('returns 400 on invalid body (missing description)', async () => {
    const res = await POST(
      makeRequest({ bearer: SECRET, body: { ...VALID_BODY, description: undefined } }),
    );
    expect(res.status).toBe(400);
  });

  it('returns 500 when the configured DB write throws (Rule K.2 fail-loud)', async () => {
    vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/db');
    mockUpdate.mockImplementation(() => {
      throw new Error('DB connection refused');
    });

    const res = await POST(makeRequest({ bearer: SECRET }));
    expect(res.status).toBe(500);
    const body = await parseBody<{ written: boolean }>(res);
    expect(body.written).toBe(false);
  });
});
