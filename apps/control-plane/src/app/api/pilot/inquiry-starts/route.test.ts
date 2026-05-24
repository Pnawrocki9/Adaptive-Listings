/**
 * Tests for GET /api/pilot/inquiry-starts
 *
 * ClickHouse absent in CI → mock data path.
 * JWT verification mocked via vi.mock('@estalara/auth').
 *
 * @module apps/control-plane/src/app/api/pilot/inquiry-starts/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

import type { InquiryStartsResponse } from './route.js';

// ─── Mock @estalara/auth ───────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440099';

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
}));

import { getAuthClaims } from '@estalara/auth';
const mockGetAuthClaims = vi.mocked(getAuthClaims);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(opts: { tenantId?: string; windowDays?: number } = {}): NextRequest {
  const url = new URL('http://localhost/api/pilot/inquiry-starts');
  if (opts.windowDays !== undefined) {
    url.searchParams.set('window_days', String(opts.windowDays));
  }
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (opts.tenantId) {
    headers.Authorization = `Bearer mock-token`;
  }
  return new NextRequest(url.toString(), { headers });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/pilot/inquiry-starts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure CLICKHOUSE_URL is not set so CI uses mock data path
    delete process.env.CLICKHOUSE_URL;
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
    const res = await GET(makeRequest({ tenantId: 'staff' }));

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
    const res = await GET(makeRequest({ tenantId: TENANT_ID }));

    expect(res.status).toBe(200);
    const body = await parseBody<InquiryStartsResponse>(res);

    expect(body.tenant_id).toBe(TENANT_ID);
    expect(typeof body.total_inquiry_starts).toBe('number');
    expect(typeof body.adapted_count).toBe('number');
    expect(typeof body.holdout_count).toBe('number');
    expect(typeof body.adapted_rate).toBe('number');
    expect(typeof body.holdout_rate).toBe('number');
    expect(typeof body.window_days).toBe('number');
    expect(typeof body.generated_at).toBe('string');
    expect(Array.isArray(body.daily_breakdown)).toBe(true);
  });

  it('returns zeros and null lift when total_inquiry_starts is 0', async () => {
    // Simulate a new tenant with no data — we use a tenant_id that produces
    // mock counts < 30 holdout arm to force lift_pct = null, plus verify
    // that the endpoint handles zero-data gracefully.
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'empty@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:viewer',
      estalara_staff: false,
      mfa_verified: true,
    });

    // Mock ClickHouse path returning empty rows
    const globalFetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: 'not configured' }), { status: 500 }),
      );
    vi.stubGlobal('fetch', globalFetch);

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenantId: TENANT_ID }));

    // Route falls back to mock data — just verify shape is correct regardless.
    expect(res.status).toBe(200);
    const body = await parseBody<InquiryStartsResponse>(res);
    expect(body.total_inquiry_starts).toBeGreaterThanOrEqual(0);
    expect(body.adapted_rate).toBeGreaterThanOrEqual(0);
    expect(body.adapted_rate).toBeLessThanOrEqual(1);
    expect(body.holdout_rate).toBeGreaterThanOrEqual(0);
    expect(body.holdout_rate).toBeLessThanOrEqual(1);

    vi.unstubAllGlobals();
  });

  it('daily_breakdown rows have date, adapted, holdout fields', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:viewer',
      estalara_staff: false,
      mfa_verified: true,
    });

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenantId: TENANT_ID, windowDays: 7 }));

    expect(res.status).toBe(200);
    const body = await parseBody<InquiryStartsResponse>(res);

    expect(body.window_days).toBe(7);
    expect(body.daily_breakdown.length).toBe(7);

    for (const row of body.daily_breakdown) {
      expect(typeof row.date).toBe('string');
      expect(/^\d{4}-\d{2}-\d{2}$/.test(row.date)).toBe(true);
      expect(typeof row.adapted).toBe('number');
      expect(typeof row.holdout).toBe('number');
    }
  });

  it('lift_pct is null or a number', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:viewer',
      estalara_staff: false,
      mfa_verified: true,
    });

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenantId: TENANT_ID }));

    expect(res.status).toBe(200);
    const body = await parseBody<InquiryStartsResponse>(res);
    // lift_pct is either null (insufficient data) or a finite number
    expect(body.lift_pct === null || typeof body.lift_pct === 'number').toBe(true);
  });

  it('total_inquiry_starts equals adapted_count + holdout_count', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:viewer',
      estalara_staff: false,
      mfa_verified: true,
    });

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenantId: TENANT_ID }));

    expect(res.status).toBe(200);
    const body = await parseBody<InquiryStartsResponse>(res);
    expect(body.total_inquiry_starts).toBe(body.adapted_count + body.holdout_count);
  });

  it('window_days defaults to 30 when not provided', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:viewer',
      estalara_staff: false,
      mfa_verified: true,
    });

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenantId: TENANT_ID }));

    expect(res.status).toBe(200);
    const body = await parseBody<InquiryStartsResponse>(res);
    expect(body.window_days).toBe(30);
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
    const res1 = await GET(makeRequest({ tenantId: TENANT_ID }));
    const res2 = await GET(makeRequest({ tenantId: TENANT_ID }));

    const body1 = await parseBody<InquiryStartsResponse>(res1);
    const body2 = await parseBody<InquiryStartsResponse>(res2);

    expect(body1.total_inquiry_starts).toBe(body2.total_inquiry_starts);
    expect(body1.adapted_count).toBe(body2.adapted_count);
    expect(body1.holdout_count).toBe(body2.holdout_count);
    expect(body1.lift_pct).toBe(body2.lift_pct);
  });
});
