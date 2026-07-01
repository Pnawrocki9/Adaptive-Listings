/**
 * Tests for GET /api/pilot/inquiry-starts
 *
 * ClickHouse absent in CI → mock data path.
 * JWT verification mocked via vi.mock('@estalara/auth').
 *
 * Rule K.2 paths:
 *   - CLICKHOUSE_URL set + query fails → 500 + Sentry.captureException
 *   - CLICKHOUSE_URL not set           → 200 + data_source: 'mock'
 *
 * @module apps/control-plane/src/app/api/pilot/inquiry-starts/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { InquiryStartsResponse } from './route.js';

// ─── Mock @estalara/auth ───────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440099';

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
}));

import { getAuthClaims } from '@estalara/auth';
const mockGetAuthClaims = vi.mocked(getAuthClaims);

// ─── Mock @sentry/nextjs ──────────────────────────────────────────────────────

const mockCaptureException = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  captureException: mockCaptureException,
  captureMessage: vi.fn(),
}));

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

function authAsTenant(): void {
  mockGetAuthClaims.mockResolvedValue({
    sub: 'user-uuid',
    email: 'user@agency.com',
    tenant_id: TENANT_ID,
    agency_role: 'agency:admin',
    estalara_staff: false,
    mfa_verified: true,
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/pilot/inquiry-starts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure CLICKHOUSE_URL is not set so CI uses mock data path
    delete process.env.CLICKHOUSE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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

  // ─── Rule K.2: CLICKHOUSE_URL unset → mock path ─────────────────────────────

  it('returns 200 with data_source: mock when CLICKHOUSE_URL is not set', async () => {
    authAsTenant();
    // CLICKHOUSE_URL is deleted in beforeEach — no need to set it again.

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenantId: TENANT_ID }));

    expect(res.status).toBe(200);
    const body = await parseBody<InquiryStartsResponse>(res);
    expect(body.data_source).toBe('mock');
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(typeof body.total_inquiry_starts).toBe('number');
    expect(Array.isArray(body.daily_breakdown)).toBe(true);
  });

  // ─── Rule K.2: CLICKHOUSE_URL set + query fails → 500 + Sentry ───────────────

  it('returns 500 and calls Sentry.captureException when CLICKHOUSE_URL is set but agg query fails', async () => {
    authAsTenant();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Internal Server Error', { status: 500 })),
    );

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenantId: TENANT_ID }));

    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe('clickhouse_error');
    expect(typeof body.error.message).toBe('string');
    expect(body.error.message).toContain('ClickHouse');

    // Sentry must be notified — never silently swallow the error.
    expect(mockCaptureException).toHaveBeenCalledOnce();
    const [err, extras] = mockCaptureException.mock.calls[0] as [unknown, unknown];
    expect(err).toBeInstanceOf(Error);
    expect(extras).toMatchObject({ tags: { route: 'pilot/inquiry-starts' } });
  });

  it('returns 500 when CLICKHOUSE_URL is set and fetch throws (network error)', async () => {
    authAsTenant();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenantId: TENANT_ID }));

    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('clickhouse_error');
    expect(mockCaptureException).toHaveBeenCalledOnce();
  });

  it('does NOT fall back to mock when CLICKHOUSE_URL is set and query fails', async () => {
    authAsTenant();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 503 })));

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenantId: TENANT_ID }));

    // Must be 500, NOT 200 with mock data.
    expect(res.status).toBe(500);
  });

  // ─── ClickHouse success path ──────────────────────────────────────────────────

  it('returns 200 with data_source: clickhouse when ClickHouse responds successfully', async () => {
    authAsTenant();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

    const aggRows = [
      JSON.stringify({ is_holdout: '0', inquiry_starts: 120, total_sessions: 800 }),
      JSON.stringify({ is_holdout: '1', inquiry_starts: 30, total_sessions: 200 }),
    ].join('\n');
    const dailyRows = [JSON.stringify({ date: '2026-05-01', adapted: 4, holdout: 1 })].join('\n');

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(aggRows, { status: 200 }))
      .mockResolvedValueOnce(new Response(dailyRows, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenantId: TENANT_ID }));

    expect(res.status).toBe(200);
    const body = await parseBody<InquiryStartsResponse>(res);
    expect(body.data_source).toBe('clickhouse');
    expect(body.adapted_count).toBe(120);
    expect(body.holdout_count).toBe(30);
    expect(body.total_inquiry_starts).toBe(150);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  // ─── Existing shape / invariant tests ────────────────────────────────────────

  it('returns 200 with correct top-level shape (mock path)', async () => {
    authAsTenant();

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
    expect(['clickhouse', 'mock']).toContain(body.data_source);
  });

  it('daily_breakdown rows have date, adapted, holdout fields', async () => {
    authAsTenant();

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
    authAsTenant();

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenantId: TENANT_ID }));

    expect(res.status).toBe(200);
    const body = await parseBody<InquiryStartsResponse>(res);
    // lift_pct is either null (insufficient data) or a finite number
    expect(body.lift_pct === null || typeof body.lift_pct === 'number').toBe(true);
  });

  it('total_inquiry_starts equals adapted_count + holdout_count', async () => {
    authAsTenant();

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenantId: TENANT_ID }));

    expect(res.status).toBe(200);
    const body = await parseBody<InquiryStartsResponse>(res);
    expect(body.total_inquiry_starts).toBe(body.adapted_count + body.holdout_count);
  });

  it('window_days defaults to 30 when not provided', async () => {
    authAsTenant();

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenantId: TENANT_ID }));

    expect(res.status).toBe(200);
    const body = await parseBody<InquiryStartsResponse>(res);
    expect(body.window_days).toBe(30);
  });

  it('mock data is deterministic for same tenant_id', async () => {
    authAsTenant();

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

  // ─── Query guard: ts not assigned_at (FOLLOW-440) ────────────────────────────

  it('inquiry-starts queries use ts not assigned_at on adaptation_decisions (guard against phantom column regression)', async () => {
    authAsTenant();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

    const capturedSqls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((urlStr: unknown) => {
        const url = new URL(String(urlStr));
        const sql = url.searchParams.get('query') ?? '';
        capturedSqls.push(sql);
        // Return empty response for both aggregate and daily queries.
        return Promise.resolve(new Response('', { status: 200 }));
      }),
    );

    const { GET } = await import('./route.js');
    await GET(makeRequest({ tenantId: TENANT_ID }));

    // Both aggregate and daily queries must have been sent.
    expect(capturedSqls.length).toBe(2);

    for (const sql of capturedSqls) {
      // Must use ts (the canonical timestamp column on adaptation_decisions, migration 0003).
      expect(sql).toContain('ad.ts');
      // Must NOT reference the phantom column assigned_at.
      expect(sql).not.toContain('assigned_at');
    }
  });
});
