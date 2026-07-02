/**
 * Tests for GET /api/dashboard/analytics/summary
 *
 * Rule K.2 paths:
 *   - CLICKHOUSE_URL set + query fails → 500 + Sentry.captureException
 *   - CLICKHOUSE_URL not set           → 200 + data_source: 'mock'
 *   - CLICKHOUSE_URL set + success     → 200 + data_source: 'clickhouse'
 *
 * JWT verification mocked via vi.mock('@estalara/auth'). The 'SSR cookie session
 * fallback' describe block additionally mocks '@supabase/ssr' to prove the route
 * authorizes a same-origin browser session with NO Authorization header at all
 * (FOLLOW-454 — the getSessionAuthClaims() fallback in session-auth.ts).
 *
 * @module apps/control-plane/src/app/api/dashboard/analytics/summary/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { SummaryResponse } from './route.js';

// ─── Mock @estalara/auth ───────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440001';

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
}));

import { getAuthClaims } from '@estalara/auth';
const mockGetAuthClaims = vi.mocked(getAuthClaims);

// ─── Mock @supabase/ssr (FOLLOW-454 SSR cookie session fallback) ──────────────
// createServerClient is called by the REAL getSessionAuth() (session-auth.ts)
// when the legacy getAuthClaims path finds nothing. mockGetUser/mockGetSession
// let individual tests control what the SSR client returns.

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn().mockImplementation(() => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  })),
}));

// ─── Mock @sentry/nextjs ──────────────────────────────────────────────────────

const mockCaptureException = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  captureException: mockCaptureException,
  captureMessage: vi.fn(),
}));

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

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/dashboard/analytics/summary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Ensure CLICKHOUSE_URL is not set so CI uses mock data path by default.
    delete process.env.CLICKHOUSE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLICKHOUSE_URL;
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

  // ─── Rule K.2: CLICKHOUSE_URL unset → mock path ─────────────────────────────

  it('returns 200 with data_source: mock when CLICKHOUSE_URL is not set', async () => {
    authAsTenant();
    // CLICKHOUSE_URL is deleted in beforeEach.

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest(TENANT_ID));

    expect(res.status).toBe(200);
    const body = await parseBody<SummaryResponse>(res);
    expect(body.data_source).toBe('mock');
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(typeof body.sessions).toBe('number');
    expect(typeof body.adapted).toBe('number');
    expect(typeof body.holdout).toBe('number');
  });

  // ─── Rule K.2: CLICKHOUSE_URL set + query fails → 500 + Sentry ───────────────

  it('returns 500 and calls Sentry.captureException when CLICKHOUSE_URL is set but query returns non-ok', async () => {
    authAsTenant();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Internal Server Error', { status: 500 })),
    );

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest(TENANT_ID));

    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe('clickhouse_query_failed');
    expect(body.error.message).toContain('ClickHouse');

    // Sentry must be notified — never silently swallow.
    expect(mockCaptureException).toHaveBeenCalledOnce();
    const [err, extras] = mockCaptureException.mock.calls[0] as [unknown, unknown];
    expect(err).toBeInstanceOf(Error);
    expect(extras).toMatchObject({ tags: { route: 'dashboard/analytics/summary' } });
  });

  it('returns 500 when CLICKHOUSE_URL is set and fetch throws (network error)', async () => {
    authAsTenant();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest(TENANT_ID));

    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('clickhouse_query_failed');
    expect(mockCaptureException).toHaveBeenCalledOnce();
  });

  it('does NOT fall back to mock when CLICKHOUSE_URL is set and query fails', async () => {
    authAsTenant();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 503 })));

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest(TENANT_ID));

    // Must be 500, NOT 200 with mock data.
    expect(res.status).toBe(500);
  });

  // ─── Rule K.2: CLICKHOUSE_URL set + success → data_source: clickhouse ────────

  it('returns 200 with data_source: clickhouse when ClickHouse responds successfully', async () => {
    authAsTenant();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

    const chRow = JSON.stringify({ sessions: 1200, adapted: 1020, holdout: 180 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(chRow, { status: 200 })));

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest(TENANT_ID));

    expect(res.status).toBe(200);
    const body = await parseBody<SummaryResponse>(res);
    expect(body.data_source).toBe('clickhouse');
    expect(body.sessions).toBe(1200);
    expect(body.adapted).toBe(1020);
    expect(body.holdout).toBe(180);
    // p95Latency is null from CH path — latency_ms does not exist on adaptation_decisions.
    expect(body.p95Latency).toBeNull();
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  // ─── Query guard: ts not assigned_at ─────────────────────────────────────────

  it('summary query uses ts not assigned_at (guard against phantom column regression)', async () => {
    authAsTenant();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

    let capturedSql = '';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((urlStr: unknown) => {
        const url = new URL(String(urlStr));
        capturedSql = url.searchParams.get('query') ?? '';
        const row = JSON.stringify({ sessions: 0, adapted: 0, holdout: 0 });
        return Promise.resolve(new Response(row, { status: 200 }));
      }),
    );

    const { GET } = await import('./route.js');
    await GET(makeRequest(TENANT_ID));

    // Must use ts (the only timestamp column on adaptation_decisions, migration 0003).
    expect(capturedSql).toContain('ts');
    // Must NOT reference the phantom column assigned_at.
    expect(capturedSql).not.toContain('assigned_at');
    // Must NOT reference the phantom column latency_ms.
    expect(capturedSql).not.toContain('latency_ms');
  });

  // ─── Existing shape / invariant tests (mock path) ─────────────────────────────

  it('returns 200 with correct shape for valid tenant JWT', async () => {
    authAsTenant();

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest(TENANT_ID));

    expect(res.status).toBe(200);
    const body = await parseBody<SummaryResponse>(res);

    expect(body.tenant_id).toBe(TENANT_ID);
    expect(typeof body.sessions).toBe('number');
    expect(typeof body.adapted).toBe('number');
    expect(typeof body.holdout).toBe('number');
    // p95Latency is a number on mock path, null on clickhouse path.
    expect(body.p95Latency === null || typeof body.p95Latency === 'number').toBe(true);
    expect(body.window_days).toBe(7);
    expect(typeof body.generated_at).toBe('string');
    expect(['clickhouse', 'mock']).toContain(body.data_source);
  });

  it('response shape: sessions = adapted + holdout (mock data invariant)', async () => {
    authAsTenant();

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest(TENANT_ID));

    expect(res.status).toBe(200);
    const body = await parseBody<SummaryResponse>(res);
    expect(body.adapted + body.holdout).toBe(body.sessions);
  });

  it('mock data is deterministic for same tenant_id', async () => {
    authAsTenant();

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

  it('KPI values are non-negative numbers (mock path)', async () => {
    authAsTenant();

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest(TENANT_ID));
    const body = await parseBody<SummaryResponse>(res);

    expect(body.sessions).toBeGreaterThan(0);
    expect(body.adapted).toBeGreaterThanOrEqual(0);
    expect(body.holdout).toBeGreaterThanOrEqual(0);
    // Mock path returns a positive number for p95Latency.
    expect(typeof body.p95Latency).toBe('number');
    expect(body.p95Latency!).toBeGreaterThan(0);
  });
});

// ─── SSR cookie session fallback (FOLLOW-454) ─────────────────────────────────
//
// Drives the REAL route handler with NO Authorization header at all — the
// legacy getAuthClaims path (mocked to resolve null) finds nothing, forcing the
// real getSessionAuthClaims() fallback in session-auth.ts to authorize via the
// Supabase SSR session cookie (@supabase/ssr mocked above). This is the exact
// scenario a logged-in agency dashboard browser session hits: same-origin
// fetch(), no Authorization header, only the chunked sb-<project-ref>-auth-token
// cookie (Rule Q guardrail — no hand-fabricated fixtures, the real handler runs).

describe('GET /api/dashboard/analytics/summary — SSR cookie session fallback (FOLLOW-454)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLICKHOUSE_URL;
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-test');
    // Legacy path finds nothing — no Authorization header, no sb-access-token cookie.
    mockGetAuthClaims.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete process.env.CLICKHOUSE_URL;
  });

  it('browser session (chunked SSR cookie), agency tenant user → 200, no Bearer header needed', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-uuid',
          email: 'user@agency.com',
          app_metadata: { tenant_id: TENANT_ID, agency_role: 'agency:admin' },
          user_metadata: {},
          aud: 'authenticated',
          created_at: '2026-01-01T00:00:00Z',
        },
      },
      error: null,
    });
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'ssr-session-jwt' } },
      error: null,
    });

    // No Authorization header at all — a same-origin browser fetch() relying
    // solely on the chunked sb-<project-ref>-auth-token cookie.
    const req = new NextRequest('http://localhost/api/dashboard/analytics/summary', {
      headers: { 'Content-Type': 'application/json' },
    });

    const { GET } = await import('./route.js');
    const res = await GET(req);

    expect(res.status).toBe(200);
    const body = await parseBody<SummaryResponse>(res);
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(body.data_source).toBe('mock');
  });

  it('browser session belongs to Estalara staff (no tenant_id) → 401', async () => {
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'staff-uuid',
          email: 'staff@estalara.com',
          app_metadata: { estalara_staff: true, estalara_role: 'estalara:ops' },
          user_metadata: {},
          aud: 'authenticated',
          created_at: '2026-01-01T00:00:00Z',
        },
      },
      error: null,
    });

    const req = new NextRequest('http://localhost/api/dashboard/analytics/summary', {
      headers: { 'Content-Type': 'application/json' },
    });
    const { GET } = await import('./route.js');
    const res = await GET(req);

    expect(res.status).toBe(401);
  });

  it('no session anywhere (getUser → null user) → 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const req = new NextRequest('http://localhost/api/dashboard/analytics/summary', {
      headers: { 'Content-Type': 'application/json' },
    });
    const { GET } = await import('./route.js');
    const res = await GET(req);

    expect(res.status).toBe(401);
  });
});
