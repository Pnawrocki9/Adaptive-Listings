/**
 * Tests for GET /api/ab/weights
 *
 * Auth is mocked via vi.mock('@estalara/auth').
 * @estalara/db is mocked to avoid needing a real DB connection.
 * DATABASE_URL is set to a fake value in tests that exercise the DB path.
 *
 * @module apps/control-plane/src/app/api/ab/weights/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { AbWeightsResponse } from './route.js';

// ─── Shared mock data ────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';

/** Simulate three db rows (2 active, 1 paused). */
const MOCK_DB_ROWS = [
  {
    tenantId: TENANT_ID,
    archetype: 'yield_hunter',
    variant: 'control',
    alpha: 10,
    beta: 5,
    paused: false,
    updatedAt: new Date('2026-05-14T00:00:00Z'),
  },
  {
    tenantId: TENANT_ID,
    archetype: 'yield_hunter',
    variant: 'headline_v1',
    alpha: 20,
    beta: 8,
    paused: false,
    updatedAt: new Date('2026-05-14T01:00:00Z'),
  },
  {
    tenantId: TENANT_ID,
    archetype: 'family_buyer',
    variant: 'control',
    alpha: 3,
    beta: 30,
    paused: true,
    updatedAt: new Date('2026-05-14T02:00:00Z'),
  },
];

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
}));

// Mock @estalara/db. The mock select builder returns mockSelectResult.rows.
const mockSelectResult: { rows: (typeof MOCK_DB_ROWS)[number][] } = { rows: [] };

vi.mock('@estalara/db', () => ({
  createTenantClient: vi.fn(() => ({
    rls: vi.fn().mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => {
      // tx is a chainable select builder
      const txStub = {
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockResolvedValue(mockSelectResult.rows),
      };
      return fn(txStub);
    }),
  })),
  abBanditWeights: {
    tenantId: 'tenant_id',
    archetype: 'archetype',
    variant: 'variant',
    alpha: 'alpha',
    beta: 'beta',
    paused: 'paused',
    updatedAt: 'updated_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: string, val: string) => ({ col, val })),
  and: vi.fn((...args: unknown[]) => args),
}));

import { getAuthClaims } from '@estalara/auth';
const mockGetAuthClaims = vi.mocked(getAuthClaims);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(params: Record<string, string> = {}, withJwt = true): NextRequest {
  const url = new URL('http://localhost/api/ab/weights');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (withJwt) {
    headers.Authorization = 'Bearer mock-jwt-token';
  }
  return new NextRequest(url.toString(), { headers });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

/** Set a fake DATABASE_URL so the route proceeds past the env guard. */
function setFakeDatabaseUrl() {
  process.env.DATABASE_URL = 'postgresql://fake:fake@localhost:5432/fake';
}

function clearDatabaseUrl(saved: string | undefined) {
  if (saved === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = saved;
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/ab/weights', () => {
  let savedDatabaseUrl: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset mock rows to the full 3-row set by default.
    mockSelectResult.rows = [...MOCK_DB_ROWS];
    // Set a fake DATABASE_URL so the route proceeds to DB path.
    savedDatabaseUrl = process.env.DATABASE_URL;
    setFakeDatabaseUrl();
  });

  afterEach(() => {
    clearDatabaseUrl(savedDatabaseUrl);
  });

  it('returns 401 when getAuthClaims returns null (no JWT)', async () => {
    mockGetAuthClaims.mockResolvedValue(null);

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({}, false));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns 401 for staff user without tenant_id', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'staff-uuid',
      email: 'staff@estalara.com',
      tenant_id: null,
      estalara_staff: true,
      estalara_role: 'estalara:ops' as const,
      mfa_verified: false,
    });

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
  });

  it('returns 200 with 3 rows (2 active, 1 paused) — all rows returned', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:admin' as const,
      estalara_staff: false,
      mfa_verified: true,
    });

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await parseBody<AbWeightsResponse>(res);
    expect(body.rows).toHaveLength(3);
    expect(body.total).toBe(3);
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(typeof body.generated_at).toBe('string');
  });

  it('?archetype=yield_hunter filter — returns 1 row (mocked single-archetype query)', async () => {
    // Only yield_hunter rows in this test
    mockSelectResult.rows = MOCK_DB_ROWS.filter((r) => r.archetype === 'yield_hunter').slice(0, 1);

    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:admin' as const,
      estalara_staff: false,
      mfa_verified: true,
    });

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ archetype: 'yield_hunter' }));
    expect(res.status).toBe(200);
    const body = await parseBody<AbWeightsResponse>(res);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]?.archetype).toBe('yield_hunter');
  });

  it('empty table → [] with total 0 (graceful)', async () => {
    mockSelectResult.rows = [];

    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:admin' as const,
      estalara_staff: false,
      mfa_verified: true,
    });

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await parseBody<AbWeightsResponse>(res);
    expect(body.rows).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  it('rows include paused=true for the paused row', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:admin' as const,
      estalara_staff: false,
      mfa_verified: true,
    });

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    const body = await parseBody<AbWeightsResponse>(res);
    const pausedRow = body.rows.find((r) => r.paused);
    expect(pausedRow).toBeDefined();
    expect(pausedRow?.archetype).toBe('family_buyer');
  });

  it('estimated_rate is computed as alpha / (alpha + beta)', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:admin' as const,
      estalara_staff: false,
      mfa_verified: true,
    });

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    const body = await parseBody<AbWeightsResponse>(res);
    for (const row of body.rows) {
      const expected = row.alpha / (row.alpha + row.beta);
      expect(Math.abs(row.estimated_rate - expected)).toBeLessThan(0.001);
    }
  });

  it('total matches rows.length', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:admin' as const,
      estalara_staff: false,
      mfa_verified: true,
    });

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    const body = await parseBody<AbWeightsResponse>(res);
    expect(body.total).toBe(body.rows.length);
  });

  it('DATABASE_URL absent — returns empty rows gracefully', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:admin' as const,
      estalara_staff: false,
      mfa_verified: true,
    });

    // Override DATABASE_URL to be absent for this test.
    delete process.env.DATABASE_URL;

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await parseBody<AbWeightsResponse>(res);
    expect(body.rows).toHaveLength(0);
    expect(body.total).toBe(0);
  });
});
