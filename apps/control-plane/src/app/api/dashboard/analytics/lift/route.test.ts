/**
 * Tests for GET /api/dashboard/analytics/lift
 *
 * ClickHouse absent in CI → mock data path.
 * JWT verification mocked via vi.mock('@estalara/auth').
 *
 * @module apps/control-plane/src/app/api/dashboard/analytics/lift/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { LiftResponse } from './route.js';
import { zTest } from './route.js';

// ─── Mock @estalara/auth ───────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440002';

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
}));

import { getAuthClaims } from '@estalara/auth';
const mockGetAuthClaims = vi.mocked(getAuthClaims);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(tenantId?: string): NextRequest {
  const url = new URL('http://localhost/api/dashboard/analytics/lift');
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

// ─── zTest unit tests ──────────────────────────────────────────────────────────

describe('zTest (two-proportion z-test)', () => {
  it('returns 1 when n1 or n2 is 0', () => {
    expect(zTest(0, 0, 100, 10)).toBe(1);
    expect(zTest(100, 10, 0, 0)).toBe(1);
  });

  it('returns 1 when both proportions are equal (no difference)', () => {
    // p1 = p2 = 0.1 → z = 0 → p-value = 1
    const p = zTest(1000, 100, 1000, 100);
    expect(p).toBeCloseTo(1, 2);
  });

  it('returns small p-value for large significant difference', () => {
    // p1 = 0.2, p2 = 0.1, n1 = n2 = 1000 → highly significant
    const p = zTest(1000, 200, 1000, 100);
    expect(p).toBeLessThan(0.01);
  });

  it('p-value is in [0, 1]', () => {
    const cases: [number, number, number, number][] = [
      [100, 50, 100, 30],
      [500, 100, 500, 90],
      [1000, 0, 1000, 0],
      [1000, 1000, 1000, 1000],
    ];
    for (const [n1, k1, n2, k2] of cases) {
      const p = zTest(n1, k1, n2, k2);
      expect(p).toBeGreaterThanOrEqual(0);
      expect(p).toBeLessThanOrEqual(1);
    }
  });
});

// ─── Route tests ───────────────────────────────────────────────────────────────

describe('GET /api/dashboard/analytics/lift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 401 when getAuthClaims returns null', async () => {
    mockGetAuthClaims.mockResolvedValue(null);

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());

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
      estalara_role: 'estalara:ops',
      mfa_verified: false,
    });

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest('staff'));

    expect(res.status).toBe(401);
  });

  it('returns 200 with correct top-level shape', async () => {
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
    const body = await parseBody<LiftResponse>(res);

    expect(body.tenant_id).toBe(TENANT_ID);
    expect(Array.isArray(body.rows)).toBe(true);
    expect(typeof body.window_days).toBe('number');
    expect(typeof body.dqsUnavailable).toBe('boolean');
    expect(typeof body.generated_at).toBe('string');
  });

  it('each row has archetype, adaptedRate, holdoutRate, lift, pValue, status fields', async () => {
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
    const body = await parseBody<LiftResponse>(res);

    expect(body.rows.length).toBeGreaterThan(0);

    const row = body.rows[0]!;
    expect(typeof row.archetype).toBe('string');
    expect(typeof row.adaptedRate).toBe('number');
    expect(typeof row.holdoutRate).toBe('number');
    expect(typeof row.adaptedN).toBe('number');
    expect(typeof row.holdoutN).toBe('number');
    expect(typeof row.lift).toBe('number');
    expect(typeof row.pValue).toBe('number');
    expect(['significant', 'trending', 'not_significant']).toContain(row.status);
  });

  it('lift and pValue fields are computed (not zero-defaulted)', async () => {
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
    const body = await parseBody<LiftResponse>(res);

    // At least one row should have a non-trivial lift value
    const hasComputedLift = body.rows.some((r) => r.lift !== 0);
    expect(hasComputedLift).toBe(true);

    // pValue should be in [0, 1] for all rows
    for (const row of body.rows) {
      expect(row.pValue).toBeGreaterThanOrEqual(0);
      expect(row.pValue).toBeLessThanOrEqual(1);
    }
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

    const body1 = await parseBody<LiftResponse>(res1);
    const body2 = await parseBody<LiftResponse>(res2);

    expect(body1.rows.map((r) => r.archetype)).toEqual(body2.rows.map((r) => r.archetype));
    expect(body1.rows.map((r) => r.lift)).toEqual(body2.rows.map((r) => r.lift));
    expect(body1.rows.map((r) => r.pValue)).toEqual(body2.rows.map((r) => r.pValue));
  });
});
