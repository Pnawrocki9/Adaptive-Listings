/**
 * Tests for GET /api/dashboard/analytics/lift
 *
 * Auth model (ADR-0018 §2, FOLLOW-594): the route delegates agency + staff
 * resolution to `resolveTenantAccess`. Its end-to-end wiring is covered by
 * `src/lib/__tests__/resolve-tenant-access.test.ts`; here we PARTIALLY MOCK
 * `@/lib/session-auth` — only `resolveTenantAccess` is a spy, `AccessError` and
 * the other exports stay real (via `importOriginal`).
 *
 * Rule K.2 paths:
 *   - CLICKHOUSE_URL set + query fails → 500 + Sentry.captureException
 *   - CLICKHOUSE_URL not set           → 200 + data_source: 'mock'
 *   - CLICKHOUSE_URL set + success     → 200 + data_source: 'clickhouse'
 *
 * @module apps/control-plane/src/app/api/dashboard/analytics/lift/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { LiftResponse } from './route-helpers';
import type * as SessionAuthModule from '@/lib/session-auth';

// ─── Partial mock of @/lib/session-auth (only resolveTenantAccess is a spy) ─────

vi.mock('@/lib/session-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionAuthModule>();
  return { ...actual, resolveTenantAccess: vi.fn() };
});

import { resolveTenantAccess, AccessError, type TenantAccess } from '@/lib/session-auth';
const mockResolve = vi.mocked(resolveTenantAccess);

// ─── Mock @sentry/nextjs ──────────────────────────────────────────────────────

const mockCaptureException = vi.fn();

vi.mock('@sentry/nextjs', () => ({
  captureException: mockCaptureException,
  captureMessage: vi.fn(),
}));

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TENANT_A = '550e8400-e29b-41d4-a716-446655440002';
const TENANT_B = '550e8400-e29b-41d4-a716-4466554400c3';

function agencyAccess(tenantId = TENANT_A): TenantAccess {
  return {
    via: 'agency',
    tenantId,
    claims: {
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: tenantId,
      agency_role: 'agency:admin',
      estalara_staff: false,
      mfa_verified: true,
    },
    rawToken: 'agency-jwt',
  };
}

function staffAccess(tenantId: string): TenantAccess {
  return {
    via: 'staff',
    tenantId,
    staff: {
      sub: 'staff-uuid',
      email: 'staff@estalara.com',
      tenant_id: null,
      estalara_staff: true,
      estalara_role: 'estalara:ops',
      mfa_verified: true,
    },
    role: 'estalara:ops',
    canWrite: true,
    isSuperadmin: false,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRequest(tenantId?: string): NextRequest {
  const url = new URL('http://localhost/api/dashboard/analytics/lift');
  if (tenantId) url.searchParams.set('tenant_id', tenantId);
  return new NextRequest(url.toString(), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

// ─── ClickHouse stand-in ───────────────────────────────────────────────────────

interface Cohort {
  archetype: string;
  adapted: [sessions: number, cta: number];
  holdout: [sessions: number, cta: number];
}

/** Answer whichever of the three lift queries was sent, from per-archetype cohorts. */
function answerLiftQuery(urlStr: unknown, cohorts: Cohort[]): Response {
  const sql = new URL(String(urlStr)).searchParams.get('query') ?? '';
  const lines: unknown[] = [];
  if (sql.includes('FROM events AS ev')) {
    // funnel: leave empty (not under test here)
  } else if (sql.includes('GROUP BY ad.archetype, ad.holdout_group')) {
    for (const c of cohorts) {
      lines.push({
        archetype: c.archetype,
        holdout: 0,
        sessions: c.adapted[0],
        cta_sessions: c.adapted[1],
      });
      lines.push({
        archetype: c.archetype,
        holdout: 1,
        sessions: c.holdout[0],
        cta_sessions: c.holdout[1],
      });
    }
  } else {
    for (const holdout of [0, 1] as const) {
      const key = holdout === 0 ? 'adapted' : 'holdout';
      lines.push({
        holdout,
        sessions: cohorts.reduce((n, c) => n + c[key][0], 0),
        cta_sessions: cohorts.reduce((n, c) => n + c[key][1], 0),
      });
    }
  }
  return new Response(lines.map((l) => JSON.stringify(l)).join('\n'), { status: 200 });
}

// ─── Route tests ───────────────────────────────────────────────────────────────

describe('GET /api/dashboard/analytics/lift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: agency caller on their own tenant (byte-unchanged behavior).
    mockResolve.mockResolvedValue(agencyAccess());
    delete process.env.CLICKHOUSE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLICKHOUSE_URL;
  });

  it('returns 401 when resolveTenantAccess throws AccessError(401)', async () => {
    mockResolve.mockRejectedValue(new AccessError(401, 'Unauthorized: no tenant access'));

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns 403 when resolveTenantAccess throws AccessError(403)', async () => {
    mockResolve.mockRejectedValue(new AccessError(403, 'Access denied: insufficient agency role'));

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('forbidden');
  });

  // ─── Rule K.2: CLICKHOUSE_URL unset → mock path ─────────────────────────────

  it('returns 200 with data_source: mock when CLICKHOUSE_URL is not set', async () => {
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = await parseBody<LiftResponse>(res);
    expect(body.data_source).toBe('mock');
    expect(body.tenant_id).toBe(TENANT_A);
    expect(Array.isArray(body.rows)).toBe(true);
    expect(body.rows.length).toBeGreaterThan(0);
  });

  // ─── Rule K.2: CLICKHOUSE_URL set + query fails → 500 + Sentry ───────────────

  it('returns 500 and calls Sentry.captureException when CLICKHOUSE_URL is set but query returns non-ok', async () => {
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Internal Server Error', { status: 500 })),
    );

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe('clickhouse_query_failed');
    expect(body.error.message).toContain('ClickHouse');

    // Sentry must be notified — never silently swallow.
    expect(mockCaptureException).toHaveBeenCalledOnce();
    const [err, extras] = mockCaptureException.mock.calls[0] as [unknown, unknown];
    expect(err).toBeInstanceOf(Error);
    expect(extras).toMatchObject({ tags: { route: 'dashboard/analytics/lift' } });
  });

  it('returns 500 when CLICKHOUSE_URL is set and fetch throws (network error)', async () => {
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());

    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('clickhouse_query_failed');
    expect(mockCaptureException).toHaveBeenCalledOnce();
  });

  it('does NOT fall back to mock when CLICKHOUSE_URL is set and query fails', async () => {
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('boom', { status: 503 })));

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());

    // Must be 500, NOT 200 with mock data.
    expect(res.status).toBe(500);
  });

  // ─── Rule K.2: CLICKHOUSE_URL set + success → data_source: clickhouse ────────

  it('returns 200 with data_source: clickhouse when ClickHouse responds successfully', async () => {
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

    const cohorts: Cohort[] = [{ archetype: 'investor', adapted: [600, 96], holdout: [150, 15] }];

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((u: unknown) => Promise.resolve(answerLiftQuery(u, cohorts))),
    );

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = await parseBody<LiftResponse>(res);
    expect(body.data_source).toBe('clickhouse');
    expect(body.dqsUnavailable).toBe(false);
    expect(body.rows.length).toBe(1);
    expect(body.rows[0]!.archetype).toBe('investor');
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('returns 200 with dqsUnavailable:true when ClickHouse returns empty response', async () => {
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(new Response('', { status: 200 }))),
    );

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = await parseBody<LiftResponse>(res);
    expect(body.data_source).toBe('clickhouse');
    expect(body.dqsUnavailable).toBe(true);
    expect(body.rows).toEqual([]);
  });

  // ─── Existing shape / invariant tests (mock path) ─────────────────────────────

  it('returns 200 with correct top-level shape', async () => {
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = await parseBody<LiftResponse>(res);

    expect(body.tenant_id).toBe(TENANT_A);
    expect(Array.isArray(body.rows)).toBe(true);
    expect(typeof body.window_days).toBe('number');
    expect(typeof body.dqsUnavailable).toBe('boolean');
    expect(typeof body.generated_at).toBe('string');
    expect(['clickhouse', 'mock']).toContain(body.data_source);
  });

  it('each row has archetype, adaptedRate, holdoutRate, lift, pValue, status fields', async () => {
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
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
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
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
    const { GET } = await import('./route.js');
    const res1 = await GET(makeRequest());
    const res2 = await GET(makeRequest());

    const body1 = await parseBody<LiftResponse>(res1);
    const body2 = await parseBody<LiftResponse>(res2);

    expect(body1.rows.map((r) => r.archetype)).toEqual(body2.rows.map((r) => r.archetype));
    expect(body1.rows.map((r) => r.lift)).toEqual(body2.rows.map((r) => r.lift));
    expect(body1.rows.map((r) => r.pValue)).toEqual(body2.rows.map((r) => r.pValue));
  });
});

describe('GET /api/dashboard/analytics/lift — pilot summary, funnel and window (FOLLOW-1289)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolve.mockResolvedValue(agencyAccess());
    delete process.env.CLICKHOUSE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLICKHOUSE_URL;
  });

  function makeWindowRequest(windowDays: string): NextRequest {
    const url = new URL('http://localhost/api/dashboard/analytics/lift');
    url.searchParams.set('window_days', windowDays);
    return new NextRequest(url.toString());
  }

  it('mock path honours window_days and returns summary, a 5-stage funnel and by_archetype', async () => {
    const { GET } = await import('./route.js');
    const res = await GET(makeWindowRequest('30'));
    expect(res.status).toBe(200);
    const body = await parseBody<LiftResponse>(res);
    expect(body.window_days).toBe(30);
    expect(body.data_source).toBe('mock');
    expect(body.funnel).toHaveLength(5);
    expect(body.by_archetype.length).toBeGreaterThan(0);
    expect(typeof body.summary.adapted_sessions).toBe('number');
    // Sorted by adapted volume descending.
    const volumes = body.by_archetype.map((a) => a.n_adapted);
    expect(volumes).toEqual([...volumes].sort((a, b) => b - a));
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('defaults window_days to 7 for a missing or unsupported value', async () => {
    const { GET } = await import('./route.js');
    const body = await parseBody<LiftResponse>(await GET(makeWindowRequest('999')));
    expect(body.window_days).toBe(7);
  });

  it('ClickHouse path: summary comes from the per-arm totals and binds tenant_id/window_days as params', async () => {
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';
    const cohorts: Cohort[] = [{ archetype: 'investor', adapted: [800, 160], holdout: [200, 20] }];
    const fetchMock = vi
      .fn()
      .mockImplementation((u: unknown) => Promise.resolve(answerLiftQuery(u, cohorts)));
    vi.stubGlobal('fetch', fetchMock);

    const { GET } = await import('./route.js');
    const res = await GET(makeWindowRequest('14'));
    expect(res.status).toBe(200);
    const body = await parseBody<LiftResponse>(res);

    expect(body.summary.adapted_sessions).toBe(800);
    expect(body.summary.holdout_sessions).toBe(200);
    expect(body.summary.adapted_cta_rate).toBeCloseTo(0.2, 4);
    expect(body.summary.holdout_cta_rate).toBeCloseTo(0.1, 4);
    expect(body.summary.relative_lift_pct).toBeCloseTo(100, 1);
    expect(body.summary.is_significant).toBe(true);
    expect(body.data_source).toBe('clickhouse');
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls as unknown[][]) {
      const url = String(call[0]);
      expect(url).toContain(`param_tenant_id=${encodeURIComponent(TENANT_A)}`);
      expect(url).toContain('param_window_days=14');
    }
  });

  it('ClickHouse path: an empty window is an all-zero summary with dqsUnavailable, never mock', async () => {
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => Promise.resolve(new Response('', { status: 200 }))),
    );
    const { GET } = await import('./route.js');
    const body = await parseBody<LiftResponse>(await GET(makeWindowRequest('7')));
    expect(body.summary.adapted_sessions).toBe(0);
    expect(body.summary.relative_lift_pct).toBeNull();
    expect(body.summary.confidence).toBe('not_significant');
    expect(body.dqsUnavailable).toBe(true);
    expect(body.data_source).toBe('clickhouse');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Staff override path (ADR-0018 §2, FOLLOW-594)
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/dashboard/analytics/lift — staff override (ADR-0018)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLICKHOUSE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLICKHOUSE_URL;
  });

  it('staff caller with a validated ?tenant_id → 200 with that tenant’s data', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest(TENANT_A));

    expect(res.status).toBe(200);
    const body = await parseBody<LiftResponse>(res);
    expect(body.tenant_id).toBe(TENANT_A);
    expect(body.data_source).toBe('mock');
  });

  it('staff caller who omits ?tenant_id → 400 (resolve throws AccessError(400))', async () => {
    mockResolve.mockRejectedValue(
      new AccessError(400, 'tenantId is required when allowStaffOverride is true'),
    );

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());

    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('bad_request');
  });

  it('staff caller with an unknown ?tenant_id → 404 (resolve throws AccessError(404))', async () => {
    mockResolve.mockRejectedValue(new AccessError(404, 'Unknown tenant'));

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest('99999999-9999-4999-8999-999999999999'));

    expect(res.status).toBe(404);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('not_found');
  });

  // ─── MANDATORY tenant-filter test (ADR-0018 §2 invariant 5, RETRO-187) ───────
  // Exercises the route's REAL ClickHouse query: intercepts the outgoing fetch and
  // asserts param_tenant_id is tenant A (in BOTH the events subquery and the outer
  // adaptation_decisions filter), never B, and that B's distinct archetype row can
  // never surface. Red-first: a mis-fence to B would flip capturedParam and the
  // returned archetype, failing the assertions.

  it('MANDATORY (RETRO-187): staff request for tenant A binds param_tenant_id=A into the real ClickHouse query and never returns tenant B rows', async () => {
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));

    let capturedParam: string | null = null;
    let capturedSql = '';
    const cohortA: Cohort = { archetype: 'family_buyer', adapted: [400, 48], holdout: [100, 8] };
    const cohortB: Cohort = { archetype: 'yield_hunter', adapted: [999, 500], holdout: [999, 10] };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((urlStr: unknown) => {
        const url = new URL(String(urlStr));
        capturedParam = url.searchParams.get('param_tenant_id');
        capturedSql = url.searchParams.get('query') ?? '';
        // ClickHouse only returns rows for the tenant actually queried.
        return Promise.resolve(
          answerLiftQuery(urlStr, [capturedParam === TENANT_A ? cohortA : cohortB]),
        );
      }),
    );

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest(TENANT_A));
    const body = await parseBody<LiftResponse>(res);

    // The fence bound into the real query is A, not B.
    expect(capturedParam).toBe(TENANT_A);
    expect(capturedParam).not.toBe(TENANT_B);
    // The query parameterizes tenant_id (no string interpolation of the id).
    expect(capturedSql).toContain('{tenant_id:String}');
    // The response carries A's archetype only — B's row can never surface.
    expect(body.tenant_id).toBe(TENANT_A);
    expect(body.rows.map((r) => r.archetype)).toContain('family_buyer');
    expect(body.rows.map((r) => r.archetype)).not.toContain('yield_hunter');
    expect(body.data_source).toBe('clickhouse');
  });
});
