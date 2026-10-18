/**
 * Tests for GET /api/admin/analytics/rollup (FOLLOW-638; single tenant since FOLLOW-1330).
 *
 * Coverage:
 *   T1: 401 when verifyTracerAdminAuth rejects (no auth).
 *   T2: 403 when verifyTracerAdminAuth rejects (authenticated but not staff).
 *   T3: 200 with the data.ts payload when auth succeeds and the data layer
 *       reports ok: true (mirrors the exact shape data.ts returns).
 *   T4: 500 + error envelope when the data layer reports ok: false (Rule K.2
 *       — a configured-but-failed store is never silently swallowed).
 *
 * The auth gate (`verifyTracerAdminAuth`) and the data layer
 * (`getTenantAnalyticsRollup`) are unit-tested separately (tracer-auth has
 * its own coverage; `./data.test.ts` covers the query/merge logic). This
 * suite verifies the ROUTE wires the two together and maps results to the
 * correct HTTP status. The response keys the FOLLOW-819 harness reads, and the tenant scope, are
 * pinned end to end by `./route.contract.test.ts`.
 *
 * @module apps/control-plane/src/app/api/admin/analytics/rollup/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@/lib/tracer-auth', () => ({
  verifyTracerAdminAuth: vi.fn(),
}));

vi.mock('./data', () => ({
  getTenantAnalyticsRollup: vi.fn(),
}));

import { verifyTracerAdminAuth } from '@/lib/tracer-auth';
import { getTenantAnalyticsRollup } from './data';
import { GET } from './route';
import type { TenantAnalyticsRollup } from './data';
import { ESTALARA_TENANT_ID } from '@/lib/estalara-tenant';

const mockVerifyTracerAdminAuth = vi.mocked(verifyTracerAdminAuth);
const mockGetRollup = vi.mocked(getTenantAnalyticsRollup);

function makeRequest(): NextRequest {
  return new NextRequest('http://localhost/api/admin/analytics/rollup', { method: 'GET' });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

const SAMPLE_ROLLUP: TenantAnalyticsRollup = {
  tenant_id: ESTALARA_TENANT_ID,
  window_days: 7,
  generated_at: '2026-07-24T00:00:00.000Z',
  rollup: {
    sessions: 100,
    adapted: 90,
    holdout: 10,
    ctaLift: 12.5,
    conversions: {
      adaptedN: 90,
      holdoutN: 10,
      adaptedConversions: 9,
      holdoutConversions: 1,
      preExposureConversions: 0,
      unsignedConversions: 2,
      ctaClickedSessions: 30,
    },
    quizCompletions: 20,
  },
  data_source: 'clickhouse',
  conversion_source: 'signed_events',
  quiz_data_source: 'live',
  // FOLLOW-560: 'disabled' is the ordinary shape wherever migration 0022 is not applied — the
  // route just passes the field through, so this fixture uses the state most deployments are in.
  scoringPathSplit: null,
  scoring_path_source: 'disabled',
  reorderWithheld: {
    embeddings_missing: 0,
    embeddings_not_attempted: 0,
    embeddings_lookup_failed: 0,
  },
  reorder_withheld_source: 'live',
};

describe('GET /api/admin/analytics/rollup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('T1: returns 401 when verifyTracerAdminAuth rejects unauthenticated', async () => {
    mockVerifyTracerAdminAuth.mockResolvedValue({
      ok: false,
      status: 401,
      message: 'Unauthorized: provide Bearer <ADMIN_API_SECRET> or a valid Estalara staff JWT',
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
    expect(mockGetRollup).not.toHaveBeenCalled();
  });

  it('T2: returns 403 when verifyTracerAdminAuth rejects a non-staff session', async () => {
    mockVerifyTracerAdminAuth.mockResolvedValue({
      ok: false,
      status: 403,
      message: 'Forbidden: tracer routes require Estalara staff or ADMIN_API_SECRET',
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(403);
    expect(mockGetRollup).not.toHaveBeenCalled();
  });

  it('T3: returns 200 with the rollup payload when auth succeeds', async () => {
    mockVerifyTracerAdminAuth.mockResolvedValue({
      ok: true,
      kind: 'secret',
      via: 'admin_secret',
      claims: null,
    });
    mockGetRollup.mockResolvedValue({ ok: true, data: SAMPLE_ROLLUP });

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await parseBody<TenantAnalyticsRollup>(res);
    expect(body).toEqual(SAMPLE_ROLLUP);
    // FOLLOW-1330: no ?tenant_id → the data layer is asked for the Estalara tenant.
    expect(mockGetRollup).toHaveBeenCalledWith(ESTALARA_TENANT_ID);
  });

  it('T4: returns 500 + error envelope when the data layer fails (Rule K.2 fail loud)', async () => {
    mockVerifyTracerAdminAuth.mockResolvedValue({
      ok: true,
      kind: 'staff',
      via: 'staff_session',
      claims: null,
      userId: 'staff-user-uuid',
      role: 'estalara:readonly',
      canWrite: false,
      isSuperadmin: false,
    });
    mockGetRollup.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'ClickHouse rollup query failed: HTTP 500 Internal Server Error',
    });

    const res = await GET(makeRequest());
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe('query_failed');
    expect(body.error.message).toContain('ClickHouse rollup query failed');
  });
});
