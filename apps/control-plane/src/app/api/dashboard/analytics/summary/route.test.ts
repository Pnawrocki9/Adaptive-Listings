/**
 * Tests for GET /api/dashboard/analytics/summary
 *
 * Auth model (ADR-0018 §2, FOLLOW-594): the route delegates the entire agency +
 * staff resolution to `resolveTenantAccess`, whose own end-to-end wiring (SSR
 * cookie, staff gate, tenant existence check, RLS trap) is exercised by
 * `src/lib/__tests__/resolve-tenant-access.test.ts` (17 cases). These route tests
 * therefore PARTIALLY MOCK `@/lib/session-auth` — only `resolveTenantAccess` is a
 * spy; `AccessError` and every other export stay real (via `importOriginal`), so
 * `accessErrorToResponse(err instanceof AccessError)` maps statuses for real. This
 * is cleaner than reconstructing the full internal auth flow through an extended
 * `@estalara/auth` mock (which would re-test session-auth internals here).
 *
 * Rule K.2 paths:
 *   - CLICKHOUSE_URL set + query fails → 500 + Sentry.captureException
 *   - CLICKHOUSE_URL not set           → 200 + data_source: 'mock'
 *   - CLICKHOUSE_URL set + success     → 200 + data_source: 'clickhouse'
 *
 * @module apps/control-plane/src/app/api/dashboard/analytics/summary/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { SummaryResponse } from './route.js';
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

const TENANT_A = '550e8400-e29b-41d4-a716-446655440001';
const TENANT_B = '550e8400-e29b-41d4-a716-4466554400b2';

/** A resolved agency access (tenant from the session claim). */
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

/** A resolved Estalara-staff access acting on an explicit, validated tenant. */
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
  const url = new URL('http://localhost/api/dashboard/analytics/summary');
  if (tenantId) url.searchParams.set('tenant_id', tenantId);
  return new NextRequest(url.toString(), {
    headers: { 'Content-Type': 'application/json' },
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('GET /api/dashboard/analytics/summary', () => {
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

  // ─── Auth error mapping (accessErrorToResponse) ─────────────────────────────

  it('returns 401 when resolveTenantAccess throws AccessError(401) (no valid session)', async () => {
    mockResolve.mockRejectedValue(new AccessError(401, 'Unauthorized: no tenant access'));

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());

    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('returns 403 when resolveTenantAccess throws AccessError(403) (agency foreign tenant)', async () => {
    mockResolve.mockRejectedValue(
      new AccessError(403, 'Access denied: agency session cannot act on a foreign tenant'),
    );

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest(TENANT_B));

    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('forbidden');
  });

  // ─── Rule K.2: CLICKHOUSE_URL unset → mock path (agency) ─────────────────────

  it('returns 200 with data_source: mock when CLICKHOUSE_URL is not set', async () => {
    // CLICKHOUSE_URL deleted in beforeEach; agency access from beforeEach.
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = await parseBody<SummaryResponse>(res);
    expect(body.data_source).toBe('mock');
    expect(body.tenant_id).toBe(TENANT_A);
    expect(typeof body.sessions).toBe('number');
    expect(typeof body.adapted).toBe('number');
    expect(typeof body.holdout).toBe('number');
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
    expect(extras).toMatchObject({ tags: { route: 'dashboard/analytics/summary' } });
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

    const chRow = JSON.stringify({ sessions: 1200, adapted: 1020, holdout: 180 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(chRow, { status: 200 })));

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());

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
    await GET(makeRequest());

    // Must use ts (the only timestamp column on adaptation_decisions, migration 0003).
    expect(capturedSql).toContain('ts');
    // Must NOT reference the phantom column assigned_at.
    expect(capturedSql).not.toContain('assigned_at');
    // Must NOT reference the phantom column latency_ms.
    expect(capturedSql).not.toContain('latency_ms');
  });

  // ─── Existing shape / invariant tests (mock path) ─────────────────────────────

  it('returns 200 with correct shape for valid agency session', async () => {
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = await parseBody<SummaryResponse>(res);

    expect(body.tenant_id).toBe(TENANT_A);
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
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());

    expect(res.status).toBe(200);
    const body = await parseBody<SummaryResponse>(res);
    expect(body.adapted + body.holdout).toBe(body.sessions);
  });

  it('mock data is deterministic for same tenant_id', async () => {
    const { GET } = await import('./route.js');
    const res1 = await GET(makeRequest());
    const res2 = await GET(makeRequest());

    const body1 = await parseBody<SummaryResponse>(res1);
    const body2 = await parseBody<SummaryResponse>(res2);

    expect(body1.sessions).toBe(body2.sessions);
    expect(body1.adapted).toBe(body2.adapted);
    expect(body1.holdout).toBe(body2.holdout);
    expect(body1.p95Latency).toBe(body2.p95Latency);
  });

  it('KPI values are non-negative numbers (mock path)', async () => {
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    const body = await parseBody<SummaryResponse>(res);

    expect(body.sessions).toBeGreaterThan(0);
    expect(body.adapted).toBeGreaterThanOrEqual(0);
    expect(body.holdout).toBeGreaterThanOrEqual(0);
    // Mock path returns a positive number for p95Latency.
    expect(typeof body.p95Latency).toBe('number');
    expect(body.p95Latency!).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Staff override path (ADR-0018 §2, FOLLOW-594)
// ═══════════════════════════════════════════════════════════════════════════

describe('GET /api/dashboard/analytics/summary — staff override (ADR-0018)', () => {
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
    const body = await parseBody<SummaryResponse>(res);
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
  // asserts the fence (param_tenant_id) sent on the wire is tenant A — never B —
  // and that B's distinct rows can never surface. Red-first: if the route bound the
  // wrong id, capturedParam would be B and `sessions` would be B's 999, failing.

  it('MANDATORY (RETRO-187): staff request for tenant A binds param_tenant_id=A into the real ClickHouse query and never returns tenant B rows', async () => {
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';
    mockResolve.mockResolvedValue(staffAccess(TENANT_A));

    let capturedParam: string | null = null;
    let capturedSql = '';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((urlStr: unknown) => {
        const url = new URL(String(urlStr));
        capturedParam = url.searchParams.get('param_tenant_id');
        capturedSql = url.searchParams.get('query') ?? '';
        // ClickHouse only ever returns rows for the tenant actually queried.
        // Tenant A → A's distinct data; anything else (a mis-fence to B) → B's data.
        const body =
          capturedParam === TENANT_A
            ? { sessions: 111, adapted: 100, holdout: 11 } // tenant A
            : { sessions: 999, adapted: 900, holdout: 99 }; // tenant B (must never appear)
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      }),
    );

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest(TENANT_A));
    const body = await parseBody<SummaryResponse>(res);

    // The fence bound into the real query is A, not B.
    expect(capturedParam).toBe(TENANT_A);
    expect(capturedParam).not.toBe(TENANT_B);
    // The query parameterizes tenant_id (no string interpolation of the id).
    expect(capturedSql).toContain('{tenant_id:String}');
    // The response carries A's rows only — B's 999 can never surface.
    expect(body.tenant_id).toBe(TENANT_A);
    expect(body.sessions).toBe(111);
    expect(body.sessions).not.toBe(999);
    expect(body.data_source).toBe('clickhouse');
  });
});
