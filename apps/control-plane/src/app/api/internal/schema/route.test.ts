/**
 * Tests for GET /api/internal/schema — FOLLOW-490 / FOLLOW-456 / audit F-13.
 *
 * Coverage:
 *   - 401 when SCHEMA_API_TOKEN is unset (fail-closed — previously an unset
 *     secret accepted ANY non-empty bearer token).
 *   - 401 when the secret is set but the bearer is missing/wrong.
 *   - 200 when the secret is set and the bearer matches (constant-time
 *     compare) — proving a correctly-configured caller still succeeds.
 *   - 400 on missing tenant_id.
 *
 * @module apps/control-plane/src/app/api/internal/schema/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { mockGetTenantSchema } = vi.hoisted(() => ({
  mockGetTenantSchema: vi.fn(),
}));

vi.mock('@/lib/tenant-schema', () => ({
  getTenantSchema: mockGetTenantSchema,
}));

import { GET } from './route';

const SECRET = 'test-schema-api-token-xyz';
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';

function makeRequest(opts: { bearer?: string; tenantId?: string | null } = {}): NextRequest {
  const headers: Record<string, string> = {};
  if (opts.bearer !== undefined) {
    headers.Authorization = `Bearer ${opts.bearer}`;
  }
  const tenantId = opts.tenantId === undefined ? TENANT_ID : opts.tenantId;
  const url = new URL('http://localhost/api/internal/schema');
  if (tenantId !== null) {
    url.searchParams.set('tenant_id', tenantId);
  }
  return new NextRequest(url, { method: 'GET', headers });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mockGetTenantSchema.mockResolvedValue({ reorder_capable: false });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('GET /api/internal/schema — auth (fail-closed)', () => {
  it('returns 401 when SCHEMA_API_TOKEN is unset, even with no bearer', async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 when SCHEMA_API_TOKEN is unset, even with a non-empty bearer', async () => {
    // This is exactly the fail-open bug: previously any non-empty token was accepted here.
    const res = await GET(makeRequest({ bearer: 'anything-non-empty' }));
    expect(res.status).toBe(401);
  });

  it('returns 401 when no bearer token is provided at all', async () => {
    vi.stubEnv('SCHEMA_API_TOKEN', SECRET);
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 401 when the bearer token is wrong', async () => {
    vi.stubEnv('SCHEMA_API_TOKEN', SECRET);
    const res = await GET(makeRequest({ bearer: 'wrong-secret' }));
    expect(res.status).toBe(401);
  });

  it('returns non-401 (success path) when the bearer token matches', async () => {
    vi.stubEnv('SCHEMA_API_TOKEN', SECRET);
    const res = await GET(makeRequest({ bearer: SECRET }));
    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
    expect(mockGetTenantSchema).toHaveBeenCalledWith(TENANT_ID);
  });
});

describe('GET /api/internal/schema — validation', () => {
  beforeEach(() => {
    vi.stubEnv('SCHEMA_API_TOKEN', SECRET);
  });

  it('returns 400 when tenant_id is missing', async () => {
    const res = await GET(makeRequest({ bearer: SECRET, tenantId: null }));
    expect(res.status).toBe(400);
  });
});
