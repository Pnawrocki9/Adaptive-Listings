/**
 * Tests for GET /api/pilot/cta-lift (TICKET-PILOT-003).
 *
 * Auth is mocked via vi.mock('@estalara/auth'). The ClickHouse transport is
 * the global fetch; in CI CLICKHOUSE_URL is unset so the route takes the
 * deterministic mock path. The ClickHouse path is exercised by setting
 * CLICKHOUSE_URL and stubbing fetch with canned JSONEachRow responses
 * (equivalent to mocking the @clickhouse/client driver).
 *
 * Rule K.2 fail-loud paths (FOLLOW-094):
 *   - CLICKHOUSE_URL set + query fails → HTTP 500, no mock fallback, Sentry alert.
 *   - CLICKHOUSE_URL unset → HTTP 200 mock with data_source: 'mock'.
 *
 * @module apps/control-plane/src/app/api/pilot/cta-lift/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import { parseWindowDays, buildResponseFromRaw, type CtaLiftResponse } from './route-helpers';

// ─── Mock @estalara/auth ─────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
}));

import { getAuthClaims } from '@estalara/auth';
const mockGetAuthClaims = vi.mocked(getAuthClaims);

// ─── Mock @sentry/nextjs ─────────────────────────────────────────────────────

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import * as Sentry from '@sentry/nextjs';
const mockCaptureException = vi.mocked(Sentry.captureException);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(windowDays?: string, authed = true): NextRequest {
  const url = new URL('http://localhost/api/pilot/cta-lift');
  if (windowDays !== undefined) url.searchParams.set('window_days', windowDays);
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (authed) headers.Authorization = 'Bearer mock-token';
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

// ─── parseWindowDays ──────────────────────────────────────────────────────────

describe('parseWindowDays', () => {
  it('accepts 7, 14, 30', () => {
    expect(parseWindowDays('7')).toBe(7);
    expect(parseWindowDays('14')).toBe(14);
    expect(parseWindowDays('30')).toBe(30);
  });

  it('defaults to 7 for missing or invalid input', () => {
    expect(parseWindowDays(null)).toBe(7);
    expect(parseWindowDays('999')).toBe(7);
    expect(parseWindowDays('abc')).toBe(7);
  });
});

// ─── buildResponseFromRaw (assembly + stats integration) ────────────────────────

describe('buildResponseFromRaw', () => {
  it('computes summary, funnel and archetype rows from raw counts', () => {
    const raw = {
      groups: [
        { holdout: 0, sessions: 1000, cta_sessions: 150 },
        { holdout: 1, sessions: 1000, cta_sessions: 100 },
      ],
      archetypes: [
        { archetype: 'investor', holdout: 0, sessions: 600, cta_sessions: 96 },
        { archetype: 'investor', holdout: 1, sessions: 600, cta_sessions: 60 },
        { archetype: 'family_buyer', holdout: 0, sessions: 400, cta_sessions: 54 },
        { archetype: 'family_buyer', holdout: 1, sessions: 400, cta_sessions: 40 },
      ],
      funnel: [
        { stage: 'page.view', holdout: 0, sessions: 1000 },
        { stage: 'page.view', holdout: 1, sessions: 1000 },
        { stage: 'cta.clicked', holdout: 0, sessions: 150 },
        { stage: 'cta.clicked', holdout: 1, sessions: 100 },
      ],
    };

    const out = buildResponseFromRaw(TENANT_ID, 14, raw);

    expect(out.window_days).toBe(14);
    expect(out.tenant_id).toBe(TENANT_ID);
    // Summary: 0.15 vs 0.10 with n=1000 each → significant.
    expect(out.summary.adapted_cta_rate).toBeCloseTo(0.15, 4);
    expect(out.summary.holdout_cta_rate).toBeCloseTo(0.1, 4);
    expect(out.summary.absolute_lift).toBeCloseTo(0.05, 4);
    expect(out.summary.relative_lift_pct).toBeCloseTo(50, 1);
    expect(out.summary.p_value).toBeLessThan(0.05);
    expect(out.summary.is_significant).toBe(true);
    expect(out.summary.confidence).toBe('95%');

    // Funnel always has all five stages, ordered.
    expect(out.funnel.map((f) => f.stage)).toEqual([
      'page.view',
      'listing.viewed',
      'cta.clicked',
      'inquiry.started',
      'inquiry.completed',
    ]);
    // Missing stage (listing.viewed) → zero counts, not undefined.
    const lv = out.funnel.find((f) => f.stage === 'listing.viewed')!;
    expect(lv.adapted_count).toBe(0);
    expect(lv.adapted_rate).toBe(0);

    // By-archetype sorted by adapted volume desc.
    expect(out.by_archetype.map((a) => a.archetype)).toEqual(['investor', 'family_buyer']);
    const investor = out.by_archetype[0]!;
    expect(investor.n_adapted).toBe(600);
    expect(investor.n_holdout).toBe(600);
    expect(typeof investor.p_value).toBe('number');
  });

  it('sets relative_lift_pct to null when holdout CTA rate is 0', () => {
    const raw = {
      groups: [
        { holdout: 0, sessions: 500, cta_sessions: 75 },
        { holdout: 1, sessions: 500, cta_sessions: 0 },
      ],
      archetypes: [],
      funnel: [],
    };
    const out = buildResponseFromRaw(TENANT_ID, 7, raw);
    expect(out.summary.holdout_cta_rate).toBe(0);
    expect(out.summary.relative_lift_pct).toBeNull();
  });

  it('returns not_significant when sample is below 30 per arm', () => {
    const raw = {
      groups: [
        { holdout: 0, sessions: 20, cta_sessions: 10 },
        { holdout: 1, sessions: 20, cta_sessions: 2 },
      ],
      archetypes: [],
      funnel: [],
    };
    const out = buildResponseFromRaw(TENANT_ID, 7, raw);
    expect(out.summary.is_significant).toBe(false);
    expect(out.summary.confidence).toBe('not_significant');
    expect(out.summary.p_value).toBe(1);
  });
});

// ─── Route handler ─────────────────────────────────────────────────────────────

describe('GET /api/pilot/cta-lift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLICKHOUSE_URL;
    mockCaptureException.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLICKHOUSE_URL;
  });

  it('returns 401 when getAuthClaims returns null (no JWT)', async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest('7', false));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns 401 for a staff user without tenant_id', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'staff-uuid',
      email: 'staff@estalara.com',
      tenant_id: null,
      estalara_staff: true,
      estalara_role: 'estalara:ops',
      mfa_verified: false,
    });
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest('7'));
    expect(res.status).toBe(401);
  });

  it('returns mock with data_source: mock when CLICKHOUSE_URL is unset', async () => {
    authAsTenant();
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest('30'));
    expect(res.status).toBe(200);
    const body = await parseBody<CtaLiftResponse>(res);
    expect(body.window_days).toBe(30);
    expect(body.tenant_id).toBe(TENANT_ID);
    // mock path produces a populated, well-formed funnel + archetype array
    expect(body.funnel).toHaveLength(5);
    expect(body.by_archetype.length).toBeGreaterThan(0);
    // Rule K.2: provenance field must say 'mock' when no ClickHouse configured
    expect(body.data_source).toBe('mock');
    // Sentry must NOT be called — unset CLICKHOUSE_URL is not an error
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('by_archetype rows carry the full shape (mock path)', async () => {
    authAsTenant();
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest('7'));
    const body = await parseBody<CtaLiftResponse>(res);
    expect(body.by_archetype.length).toBeGreaterThan(0);
    const row = body.by_archetype[0]!;
    expect(typeof row.archetype).toBe('string');
    expect(typeof row.adapted_cta_rate).toBe('number');
    expect(typeof row.holdout_cta_rate).toBe('number');
    expect(row.lift_pct === null || typeof row.lift_pct === 'number').toBe(true);
    expect(typeof row.n_adapted).toBe('number');
    expect(typeof row.n_holdout).toBe('number');
    expect(typeof row.p_value).toBe('number');
    // Sorted by adapted volume descending.
    const volumes = body.by_archetype.map((a) => a.n_adapted);
    const sorted = [...volumes].sort((a, b) => b - a);
    expect(volumes).toEqual(sorted);
    // Provenance: no ClickHouse configured → data_source must be 'mock'.
    expect(body.data_source).toBe('mock');
  });

  it('returns all-zero summary with data_source: clickhouse when ClickHouse responds with no rows', async () => {
    authAsTenant();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';
    // Empty JSONEachRow body for all three queries. A fresh Response per call —
    // a Response body can only be read once.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(new Response('', { status: 200 }))),
    );

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest('7'));
    expect(res.status).toBe(200);
    const body = await parseBody<CtaLiftResponse>(res);

    expect(body.summary.adapted_sessions).toBe(0);
    expect(body.summary.holdout_sessions).toBe(0);
    expect(body.summary.adapted_cta_rate).toBe(0);
    expect(body.summary.holdout_cta_rate).toBe(0);
    expect(body.summary.relative_lift_pct).toBeNull();
    expect(body.summary.is_significant).toBe(false);
    expect(body.summary.confidence).toBe('not_significant');
    // Funnel still has all five stages, all zeroed.
    expect(body.funnel).toHaveLength(5);
    expect(body.funnel.every((f) => f.adapted_count === 0 && f.holdout_count === 0)).toBe(true);
    expect(body.by_archetype).toHaveLength(0);
    // Provenance: real ClickHouse configured → data_source must be 'clickhouse'.
    expect(body.data_source).toBe('clickhouse');
  });

  it('returns data_source: clickhouse when CLICKHOUSE_URL is set and query succeeds', async () => {
    authAsTenant();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

    const groupRows = [
      JSON.stringify({ holdout: 0, sessions: 800, cta_sessions: 160 }),
      JSON.stringify({ holdout: 1, sessions: 200, cta_sessions: 20 }),
    ].join('\n');
    const archetypeRows = [
      JSON.stringify({ archetype: 'investor', holdout: 0, sessions: 800, cta_sessions: 160 }),
      JSON.stringify({ archetype: 'investor', holdout: 1, sessions: 200, cta_sessions: 20 }),
    ].join('\n');
    const funnelRows = [
      JSON.stringify({ stage: 'cta.clicked', holdout: 0, sessions: 160 }),
      JSON.stringify({ stage: 'cta.clicked', holdout: 1, sessions: 20 }),
    ].join('\n');

    // The route fires the three queries via Promise.all in order:
    // groups, archetypes, funnel.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(groupRows, { status: 200 }))
      .mockResolvedValueOnce(new Response(archetypeRows, { status: 200 }))
      .mockResolvedValueOnce(new Response(funnelRows, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest('14'));
    expect(res.status).toBe(200);
    const body = await parseBody<CtaLiftResponse>(res);

    // 0.20 adapted vs 0.10 holdout.
    expect(body.summary.adapted_sessions).toBe(800);
    expect(body.summary.holdout_sessions).toBe(200);
    expect(body.summary.adapted_cta_rate).toBeCloseTo(0.2, 4);
    expect(body.summary.holdout_cta_rate).toBeCloseTo(0.1, 4);
    expect(body.summary.is_significant).toBe(true);
    expect(body.by_archetype[0]!.archetype).toBe('investor');
    // Provenance: real ClickHouse configured and succeeded.
    expect(body.data_source).toBe('clickhouse');

    // tenant_id must be bound as a query param, never interpolated into SQL.
    const firstCallUrl = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(firstCallUrl).toContain(`param_tenant_id=${encodeURIComponent(TENANT_ID)}`);
    expect(firstCallUrl).toContain('param_window_days=14');
  });

  // ─── Rule K.2 fail-loud paths (FOLLOW-094) ────────────────────────────────

  it('returns HTTP 500 and calls Sentry when CLICKHOUSE_URL is set but query fails', async () => {
    authAsTenant();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockImplementation(() => Promise.resolve(new Response('Internal error', { status: 500 }))),
    );

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest('7'));

    // Rule K.2: must not silently fall back to mock — caller gets HTTP 500.
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe('clickhouse_query_failed');
    expect(body.error.message).toContain('ClickHouse');

    // Sentry must have been notified.
    expect(mockCaptureException).toHaveBeenCalledOnce();
    const [, extras] = mockCaptureException.mock.calls[0] as [
      unknown,
      { tags: Record<string, string>; extra: Record<string, unknown> },
    ];
    expect(extras.tags.cta_lift_clickhouse_error).toBe('true');
    expect(extras.extra.tenant_id).toBe(TENANT_ID);
  });

  it('returns HTTP 500 when CLICKHOUSE_URL is set but fetch rejects (network error)', async () => {
    authAsTenant();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest('14'));

    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe('clickhouse_query_failed');
    expect(body.error.message).toContain('ECONNREFUSED');

    // Sentry must have been notified.
    expect(mockCaptureException).toHaveBeenCalledOnce();
  });
});
