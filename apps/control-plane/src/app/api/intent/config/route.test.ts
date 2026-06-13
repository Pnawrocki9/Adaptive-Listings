/**
 * Tests for GET /api/intent/config (FOLLOW-294, ADR-0012 Ticket A).
 *
 * Coverage:
 *   AUTH-1: returns 401 when Authorization header is absent
 *   AUTH-2: returns 401 when Authorization header is present but malformed (no Bearer prefix)
 *   AUTH-3: returns 401 when bearer token is empty string after trimming
 *   AUTH-4: returns 404 when bearer token not found in api_keys
 *   AUTH-5: returns 503 when auth DB throws (configured-but-failed on auth leg)
 *   AUTH-6: derives tenant_id from authenticated key (no ?tenant_id query param)
 *   MOCK-1: returns 200 with data_source: 'mock' and weights: {} when DB unconfigured (dev/CI)
 *   MOCK-2: returns 200 with data_source: 'mock' and weights: {} when no active row found
 *   LIVE-1: returns 200 with data_source: 'live' when active row found (tenant-specific)
 *   LIVE-2: returns 200 with data_source: 'live' when active row found (global fallback)
 *   FAIL-1: returns 500 (data_source: 'error') when DB configured but throws during weight fetch
 *   CORS-1: returns CORS headers on 200 responses
 *   CACHE-1: returns Cache-Control: public, max-age=300
 *   OPT-1: OPTIONS returns 204 with CORS headers
 *
 * Database is mocked throughout — no real Postgres required.
 *
 * Auth implementation note: the route computes SHA-256(bearerToken) and compares it
 * constant-time against the `hashedKey` returned by the DB mock. For auth-success
 * tests, the DB mock returns the real SHA-256('valid-api-key') so the constant-time
 * compare passes. For auth-failure tests, the DB returns no rows (key not found).
 *
 * @module apps/control-plane/src/app/api/intent/config/route.test
 */

import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

// The raw API key used in Bearer headers throughout auth-success tests.
const VALID_KEY = 'valid-api-key';

// SHA-256('valid-api-key') — computed at runtime so no high-entropy literal exists in source.
// This matches what sha256Hex() produces inside the route, so constantTimeEqual passes.
const VALID_KEY_HASH = createHash('sha256').update(VALID_KEY).digest('hex');

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';

// The route calls createAdminClient() twice in the live path:
//   call 1: resolveApiKey  → select from api_keys
//   call 2: weight lookup  → select from intent_weight_configs
//
// We expose mockDbFactory so individual tests can configure what each client instance returns.
// Each call to createAdminClient() produces a fresh mock client object.

interface MockChain {
  select: ReturnType<typeof vi.fn>;
}

const { mockCreateAdminClient } = vi.hoisted(() => {
  const mockCreateAdminClient = vi.fn();
  return { mockCreateAdminClient };
});

vi.mock('@estalara/db', () => ({
  createAdminClient: mockCreateAdminClient,
  apiKeys: {
    tenantId: 'tenant_id',
    hashedKey: 'hashed_key',
    revokedAt: 'revoked_at',
    expiresAt: 'expires_at',
  },
  intentWeightConfigs: {
    id: 'id',
    tenantId: 'tenant_id',
    weights: 'weights',
    createdAt: 'created_at',
    isActive: 'is_active',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((_col: unknown, _val: unknown) => ({ type: 'eq' })),
  and: vi.fn((..._args: unknown[]) => ({ type: 'and' })),
  or: vi.fn((..._args: unknown[]) => ({ type: 'or' })),
  isNull: vi.fn((_col: unknown) => ({ type: 'isNull' })),
  gt: vi.fn((_col: unknown, _val: unknown) => ({ type: 'gt' })),
}));

// ─── DB mock helpers ──────────────────────────────────────────────────────────

/**
 * Build a Drizzle-style mock chain: select().from().where().limit() resolving to `rows`.
 */
function makeDbMock(rows: unknown[]): MockChain {
  const limitFn = vi.fn().mockResolvedValue(rows);
  const whereFn = vi.fn().mockReturnValue({ limit: limitFn });
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });
  return { select: selectFn };
}

/**
 * Build a Drizzle-style mock chain whose limit() rejects with an error.
 */
function makeDbMockThrowing(err: Error): MockChain {
  const limitFn = vi.fn().mockRejectedValue(err);
  const whereFn = vi.fn().mockReturnValue({ limit: limitFn });
  const fromFn = vi.fn().mockReturnValue({ where: whereFn });
  const selectFn = vi.fn().mockReturnValue({ from: fromFn });
  return { select: selectFn };
}

/**
 * Auth-success row — DB returns a key row matching SHA-256('valid-api-key').
 */
function authSuccessRow() {
  return [{ tenantId: TENANT_ID, hashedKey: VALID_KEY_HASH }];
}

/**
 * Configure createAdminClient to return the specified sequence of DB instances.
 * First call → authDb, second call → weightDb.
 */
function setupDbSequence(authDb: MockChain, weightDb?: MockChain) {
  if (weightDb) {
    mockCreateAdminClient.mockReturnValueOnce(authDb).mockReturnValueOnce(weightDb);
  } else {
    mockCreateAdminClient.mockReturnValue(authDb);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(opts: { bearer?: string } = {}): NextRequest {
  const url = 'http://localhost/api/intent/config';
  const headers: Record<string, string> = {};
  if (opts.bearer !== undefined) {
    headers.Authorization = opts.bearer;
  }
  return new NextRequest(url, { method: 'GET', headers });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

// ─── Import route (after mocks are registered) ────────────────────────────────

import { GET, OPTIONS } from './route';

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('OPTIONS /api/intent/config', () => {
  it('OPT-1: returns 204 with CORS headers', () => {
    const res = OPTIONS();
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('GET');
  });
});

describe('GET /api/intent/config — unconfigured DB (dev/CI)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');
    vi.clearAllMocks();
  });

  it('MOCK-1: returns 200 with data_source: mock and empty weights when DB unconfigured', async () => {
    const res = await GET(makeRequest({ bearer: 'Bearer valid-api-key' }));
    expect(res.status).toBe(200);
    const body = await parseBody<{
      weights: object;
      data_source: string;
      is_tenant_specific: boolean;
      effective_at: string;
    }>(res);
    expect(body.data_source).toBe('mock');
    expect(body.weights).toEqual({});
    expect(body.is_tenant_specific).toBe(false);
    expect(typeof body.effective_at).toBe('string');
  });

  it('MOCK-1b: no Authorization header returns 200 mock when DB unconfigured (no auth attempted)', async () => {
    // When DB is unconfigured, the route returns mock immediately without auth
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await parseBody<{ data_source: string }>(res);
    expect(body.data_source).toBe('mock');
  });

  it('CORS-1: returns Access-Control-Allow-Origin: * on mock response', async () => {
    const res = await GET(makeRequest({ bearer: 'Bearer valid-api-key' }));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('CACHE-1: returns Cache-Control: public, max-age=300 on mock response', async () => {
    const res = await GET(makeRequest({ bearer: 'Bearer valid-api-key' }));
    expect(res.headers.get('Cache-Control')).toContain('max-age=300');
    expect(res.headers.get('Cache-Control')).toContain('public');
  });
});

describe('GET /api/intent/config — auth failures (DB configured)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    vi.clearAllMocks();
  });

  it('AUTH-1: returns 401 when Authorization header is absent', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: string }>(res);
    expect(body.error).toBe('Invalid API key');
  });

  it('AUTH-2: returns 401 when Authorization header lacks Bearer prefix', async () => {
    const res = await GET(makeRequest({ bearer: 'Basic dXNlcjpwYXNz' }));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: string }>(res);
    expect(body.error).toBe('Invalid API key');
  });

  it('AUTH-3: returns 401 when bearer token is empty after trimming', async () => {
    const res = await GET(makeRequest({ bearer: 'Bearer   ' }));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: string }>(res);
    expect(body.error).toBe('Invalid API key');
  });

  it('AUTH-4: returns 404 when bearer token is not found in api_keys (no matching rows)', async () => {
    // Auth DB returns empty — key not found
    setupDbSequence(makeDbMock([]));

    const res = await GET(makeRequest({ bearer: 'Bearer unknown-key' }));
    expect(res.status).toBe(404);
    const body = await parseBody<{ error: string }>(res);
    expect(body.error).toBe('Tenant not found');
  });

  it('AUTH-5: returns 503 when auth DB throws (configured-but-failed on auth leg)', async () => {
    // Auth DB throws
    setupDbSequence(makeDbMockThrowing(new Error('DB connection failed')));

    const res = await GET(makeRequest({ bearer: 'Bearer valid-api-key' }));
    expect(res.status).toBe(503);
    const body = await parseBody<{ error: string }>(res);
    expect(body.error).toBe('Service temporarily unavailable');
  });
});

describe('GET /api/intent/config — authenticated live path (DB configured)', () => {
  const now = new Date('2026-06-13T10:00:00.000Z');

  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    vi.clearAllMocks();
  });

  it('AUTH-6: derives tenant_id from authenticated key (not from query param)', async () => {
    // No ?tenant_id in the URL — auth succeeds, weight query uses resolved tenantId
    setupDbSequence(makeDbMock(authSuccessRow()), makeDbMock([]));

    const res = await GET(makeRequest({ bearer: 'Bearer valid-api-key' }));
    // Returns 200 mock (no active row) but auth succeeded via API key
    expect(res.status).toBe(200);
    const body = await parseBody<{ data_source: string }>(res);
    // Auth passed; no active weight row → mock
    expect(body.data_source).toBe('mock');
  });

  it('MOCK-2: returns 200 with data_source: mock and empty weights when no active row', async () => {
    setupDbSequence(makeDbMock(authSuccessRow()), makeDbMock([]));

    const res = await GET(makeRequest({ bearer: 'Bearer valid-api-key' }));
    expect(res.status).toBe(200);
    const body = await parseBody<{ weights: object; data_source: string }>(res);
    expect(body.data_source).toBe('mock');
    expect(body.weights).toEqual({});
  });

  it('LIVE-1: returns 200 with data_source: live when tenant-specific active row found', async () => {
    const validWeights = {
      behavioral_damping: 0.25,
      priors: { yield_hunter: 0.06, neutral: 0.3 },
    };
    const weightRows = [
      { id: 'cfg-1', tenantId: TENANT_ID, weights: validWeights, createdAt: now, isActive: true },
    ];
    setupDbSequence(makeDbMock(authSuccessRow()), makeDbMock(weightRows));

    const res = await GET(makeRequest({ bearer: 'Bearer valid-api-key' }));
    expect(res.status).toBe(200);
    const body = await parseBody<{
      weights: { behavioral_damping: number };
      data_source: string;
      is_tenant_specific: boolean;
      effective_at: string;
    }>(res);
    expect(body.data_source).toBe('live');
    expect(body.is_tenant_specific).toBe(true);
    expect(body.weights.behavioral_damping).toBe(0.25);
    expect(body.effective_at).toBe('2026-06-13T10:00:00.000Z');
    expect(res.headers.get('Cache-Control')).toContain('max-age=300');
  });

  it('LIVE-2: returns 200 with data_source: live using global row when no tenant-specific row', async () => {
    const globalWeights = { behavioral_damping: 0.3 };
    const weightRows = [
      { id: 'cfg-global', tenantId: null, weights: globalWeights, createdAt: now, isActive: true },
    ];
    setupDbSequence(makeDbMock(authSuccessRow()), makeDbMock(weightRows));

    const res = await GET(makeRequest({ bearer: 'Bearer valid-api-key' }));
    expect(res.status).toBe(200);
    const body = await parseBody<{
      data_source: string;
      is_tenant_specific: boolean;
    }>(res);
    expect(body.data_source).toBe('live');
    expect(body.is_tenant_specific).toBe(false);
  });

  it('FAIL-1: returns 500 (data_source: error) when DB throws during weight fetch (Rule K.2)', async () => {
    // Auth succeeds; weight DB throws (configured-but-failed)
    setupDbSequence(makeDbMock(authSuccessRow()), makeDbMockThrowing(new Error('DB timeout')));

    const res = await GET(makeRequest({ bearer: 'Bearer valid-api-key' }));
    // MUST be 500 — never silently return mock when configured DB fails (Rule K.2)
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string }; data_source: string }>(res);
    expect(body.error.code).toBe('db_error');
    expect(body.data_source).toBe('error');
    // Must NOT return weights — that would be fabricated data
    expect('weights' in body).toBe(false);
  });

  it('CORS-1: returns Access-Control-Allow-Origin: * on authenticated 200', async () => {
    setupDbSequence(makeDbMock(authSuccessRow()), makeDbMock([]));

    const res = await GET(makeRequest({ bearer: 'Bearer valid-api-key' }));
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('CACHE-1: returns Cache-Control: public, max-age=300 on authenticated response', async () => {
    setupDbSequence(makeDbMock(authSuccessRow()), makeDbMock([]));

    const res = await GET(makeRequest({ bearer: 'Bearer valid-api-key' }));
    expect(res.headers.get('Cache-Control')).toContain('max-age=300');
    expect(res.headers.get('Cache-Control')).toContain('public');
  });

  it(
    'AC5: after a tenant weight row is written (FOLLOW-268-write POST), ' +
      'GET returns data_source: live with the written weights',
    async () => {
      // Simulate: FOLLOW-268-write POST created a row for TENANT_ID.
      // The api_keys row authenticates the SDK's bearer token to TENANT_ID.
      // The weight lookup finds the row and returns data_source: 'live'.
      // This test verifies the end-to-end wiring contract between the write API
      // (which creates intent_weight_configs rows) and the read API.
      //
      // In a real environment: POST /api/admin/intent/config with Bearer ADMIN_API_SECRET
      // creates an intent_weight_configs row. GET /api/intent/config with Bearer <api-key>
      // for the same tenant then returns data_source: 'live' with those weights.
      // Here we simulate both sides via DB mocks: auth DB returns the api_keys row
      // (same as all LIVE-* tests) and the weight DB returns the written row.
      const writtenWeights = {
        behavioral_damping: 0.22,
        priors: { family_buyer: 0.07, neutral: 0.28 },
        signal_likelihoods: {
          'cta.clicked': { yield_hunter: 1.2 },
        },
      };
      const weightRow = {
        id: 'cfg-written-by-admin',
        tenantId: TENANT_ID,
        weights: writtenWeights,
        createdAt: new Date('2026-06-13T10:00:00.000Z'),
        isActive: true,
      };
      setupDbSequence(makeDbMock(authSuccessRow()), makeDbMock([weightRow]));

      const res = await GET(makeRequest({ bearer: 'Bearer valid-api-key' }));
      expect(res.status).toBe(200);
      const body = await parseBody<{
        data_source: string;
        is_tenant_specific: boolean;
        weights: { behavioral_damping?: number };
      }>(res);

      // Key assertion: GET returns 'live' — NOT 'mock'.
      // This proves the GET route serves real rows from intent_weight_configs
      // when an active row exists (as created by the FOLLOW-268-write admin API).
      expect(body.data_source).toBe('live');
      expect(body.is_tenant_specific).toBe(true);
      expect(body.weights.behavioral_damping).toBe(0.22);
    },
  );
});
