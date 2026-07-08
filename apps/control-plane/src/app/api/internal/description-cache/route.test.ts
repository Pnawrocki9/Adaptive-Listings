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
 *   - FOLLOW-463 / audit F-17: the ClickHouse `description_generations` audit
 *     trail write (verified_facts_used durability, NEUTRAL skip, fail-loud-but-
 *     non-blocking Sentry capture on a rejected/failed insert).
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

// FOLLOW-463: writeDescriptionGenerationAudit calls Sentry.captureException on a
// failed/rejected ClickHouse INSERT. Mocked so the fail-loud-but-non-blocking
// tests below can assert on it without a real Sentry SDK.
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

import * as Sentry from '@sentry/nextjs';
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

describe('POST /api/internal/description-cache — FOLLOW-465 NEUTRAL negative cache', () => {
  beforeEach(() => {
    vi.stubEnv('DESCRIPTION_CACHE_INTERNAL_SECRET', SECRET);
  });

  it('rejects an empty description when verdict is absent (implicit FIT)', async () => {
    const res = await POST(
      makeRequest({ bearer: SECRET, body: { ...VALID_BODY, description: '' } }),
    );
    expect(res.status).toBe(400);
  });

  it('rejects an empty description when verdict is explicitly FIT', async () => {
    const res = await POST(
      makeRequest({ bearer: SECRET, body: { ...VALID_BODY, description: '', verdict: 'FIT' } }),
    );
    expect(res.status).toBe(400);
  });

  it('accepts an empty description (negative-cache marker) when verdict is NEUTRAL', async () => {
    const res = await POST(
      makeRequest({
        bearer: SECRET,
        body: { ...VALID_BODY, description: '', headline: null, verdict: 'NEUTRAL' },
      }),
    );
    expect(res.status).toBe(201);
    const body = await parseBody<{ written: boolean }>(res);
    expect(body.written).toBe(true);
  });

  it('rejects an unknown verdict value', async () => {
    const res = await POST(
      makeRequest({ bearer: SECRET, body: { ...VALID_BODY, verdict: 'MAYBE' } }),
    );
    expect(res.status).toBe(400);
  });
});

describe('POST /api/internal/description-cache — ClickHouse audit trail (FOLLOW-463 / F-17)', () => {
  const CLICKHOUSE_URL = 'http://ch.internal.test:8123';
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubEnv('DESCRIPTION_CACHE_INTERNAL_SECRET', SECRET);
    vi.stubEnv('CLICKHOUSE_URL', CLICKHOUSE_URL);
    mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('inserts a description_generations row with verified_facts_used, description_chars, model, archetype, listing, locale on a FIT write', async () => {
    const res = await POST(
      makeRequest({
        bearer: SECRET,
        body: { ...VALID_BODY, verified_facts_used: ['bedrooms: 3', 'location: Marbella'] },
      }),
    );
    expect(res.status).toBe(201);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [fetchUrl, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const parsedUrl = new URL(fetchUrl);
    expect(parsedUrl.origin).toBe(CLICKHOUSE_URL);
    expect(parsedUrl.searchParams.get('query')).toBe(
      'INSERT INTO description_generations FORMAT JSONEachRow',
    );

    const row = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(row.tenant_id).toBe(TENANT_ID);
    expect(row.listing_id).toBe('listing-1');
    expect(row.archetype).toBe('yield_hunter');
    expect(row.locale).toBe('en');
    expect(row.model).toBe('claude-sonnet-4-6');
    expect(row.description_chars).toBe(VALID_BODY.description.length);
    expect(row.verified_facts_used).toEqual(['bedrooms: 3', 'location: Marbella']);
    expect(row.source).toBe('modal_generation');
  });

  it('defaults verified_facts_used to [] when the caller omits it (back-compat)', async () => {
    const res = await POST(makeRequest({ bearer: SECRET, body: VALID_BODY }));
    expect(res.status).toBe(201);

    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const row = JSON.parse(options.body as string) as Record<string, unknown>;
    expect(row.verified_facts_used).toEqual([]);
  });

  it('does NOT insert a description_generations row for a NEUTRAL negative-cache marker (empty description)', async () => {
    const res = await POST(
      makeRequest({
        bearer: SECRET,
        body: { ...VALID_BODY, description: '', headline: null, verdict: 'NEUTRAL' },
      }),
    );
    expect(res.status).toBe(201);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('captures a Sentry exception but still returns 201 when ClickHouse rejects the insert', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve('insert rejected'),
    });

    const res = await POST(makeRequest({ bearer: SECRET, body: VALID_BODY }));

    expect(res.status).toBe(201);
    const body = await parseBody<{ written: boolean }>(res);
    expect(body.written).toBe(true);
    expect(Sentry.captureException).toHaveBeenCalledOnce();
    const [, context] = (Sentry.captureException as ReturnType<typeof vi.fn>).mock.calls[0] as [
      Error,
      { tags: Record<string, string> },
    ];
    expect(context.tags.kind).toBe('description_generations_write_failed');
    expect(context.tags.table).toBe('description_generations');
  });

  it('captures a Sentry exception but still returns 201 when the ClickHouse fetch throws (network error)', async () => {
    mockFetch.mockRejectedValue(new Error('connection refused'));

    const res = await POST(makeRequest({ bearer: SECRET, body: VALID_BODY }));

    expect(res.status).toBe(201);
    expect(Sentry.captureException).toHaveBeenCalledOnce();
  });
});
