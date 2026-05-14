/**
 * Tests for GET /api/dashboard/analytics/summary
 *
 * ClickHouse is NOT configured in CI (no CLICKHOUSE_URL env var),
 * so the route falls back to deterministic mock data.
 * JWT verification relies on SUPABASE_JWT_SECRET — absent in CI →
 * getAuthClaims returns null → 401. We bypass by calling the route
 * with a mock that makes getAuthClaims return a fixed TenantClaims object.
 *
 * @module apps/control-plane/src/app/api/dashboard/analytics/summary/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { SummaryResponse } from './route.js';

// ─── Mock @estalara/auth ───────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440001';

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
}));

import { getAuthClaims } from '@estalara/auth';
const mockGetAuthClaims = vi.mocked(getAuthClaims);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(tenantId?: string): NextRequest {
  const url = new URL('http://localhost/api/dashboard/analytics/summary');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (tenantId) {
    headers.Authorization = `Bearer mock-token`;
  }
  return new NextRequest(url.toString(), { headers });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/dashboard/analytics/summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when getAuthClaims returns null (no valid JWT)', async () => {
    mockGetAuthClaims.mockResolvedValue(null);

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns 401 when claims have no tenant_id (staff user without tenant)', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'staff-uuid',
      email: 'staff@estalara.com',
      tenant_id: null,
      estalara_staff: true,
      estalara_role: 'estalara:ops',
      mfa_verified: false,
    });

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest('staff'));

    expect(res.status).toBe(401);
  });

  it('returns 200 with correct shape for valid tenant JWT', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:admin',
      estalara_staff: false,
      mfa_verified: true,
    });

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest(TENANT_ID));

    expect(res.status).toBe(200);
    const body = await parseBody<SummaryResponse>(res);

    expect(body.tenant_id).toBe(TENANT_ID);
    expect(typeof body.sessions).toBe('number');
    expect(typeof body.adapted).toBe('number');
    expect(typeof body.holdout).toBe('number');
    expect(typeof body.p95Latency).toBe('number');
    expect(body.window_days).toBe(7);
    expect(typeof body.generated_at).toBe('string');
  });

  it('response shape: sessions = adapted + holdout (mock data invariant)', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:viewer',
      estalara_staff: false,
      mfa_verified: true,
    });

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest(TENANT_ID));

    expect(res.status).toBe(200);
    const body = await parseBody<SummaryResponse>(res);
    expect(body.adapted + body.holdout).toBe(body.sessions);
  });

  it('mock data is deterministic for same tenant_id', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:viewer',
      estalara_staff: false,
      mfa_verified: true,
    });

    const { GET } = await import('./route.js');
    const res1 = await GET(makeRequest(TENANT_ID));
    const res2 = await GET(makeRequest(TENANT_ID));

    const body1 = await parseBody<SummaryResponse>(res1);
    const body2 = await parseBody<SummaryResponse>(res2);

    expect(body1.sessions).toBe(body2.sessions);
    expect(body1.adapted).toBe(body2.adapted);
    expect(body1.holdout).toBe(body2.holdout);
    expect(body1.p95Latency).toBe(body2.p95Latency);
  });

  it('KPI values are positive numbers', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:viewer',
      estalara_staff: false,
      mfa_verified: true,
    });

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest(TENANT_ID));
    const body = await parseBody<SummaryResponse>(res);

    expect(body.sessions).toBeGreaterThan(0);
    expect(body.adapted).toBeGreaterThanOrEqual(0);
    expect(body.holdout).toBeGreaterThanOrEqual(0);
    expect(body.p95Latency).toBeGreaterThan(0);
  });
});
