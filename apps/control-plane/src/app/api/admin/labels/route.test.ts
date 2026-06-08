/**
 * Tests for GET /api/admin/labels + PATCH /api/admin/labels/[id] (FOLLOW-174).
 *
 * Coverage:
 *   - Auth gate: 401 for missing/invalid JWT, role enforcement
 *   - Mock fallback (data_source: 'mock') when DB/CH absent (Rule K.2)
 *   - Fail-loud: 500 when Postgres configured-but-fails (Rule K.2)
 *   - Fail-loud: 500 when ClickHouse configured-but-fails (Rule K.2)
 *   - Tenant_id pinning: agency user cannot query another tenant's data
 *   - Staff can supply tenant_id query param
 *   - PATCH: writes label_source=manual_admin, validates outcome_class Zod enum
 *   - PATCH: cross-tenant guard (agency user gets 404, not 403, to avoid leaking)
 *   - PATCH: 503 when DATABASE_URL_ADMIN absent
 *   - Wired-entrypoint test (Rule Q): drives the route handler, not just helpers
 *
 * @module apps/control-plane/src/app/api/admin/labels/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { AdminLabelsResponse } from './route-helpers';

// ─── Mock modules ─────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';
const OTHER_TENANT_ID = '660e8400-e29b-41d4-a716-446655440099';
const LABEL_ID = 'aabbccdd-0001-0001-0001-000000000001';

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
  isStaffClaims: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  conversionLabels: {
    id: 'id',
    tenantId: 'tenant_id',
    predictionId: 'prediction_id',
    leadId: 'lead_id',
    outcomeClass: 'outcome_class',
    labelSource: 'label_source',
    confidence: 'confidence',
    notes: 'notes',
    labeledAt: 'labeled_at',
    createdAt: 'created_at',
    updatedAt: 'updated_at',
  },
  upsertConversionLabel: vi.fn(),
}));

// @estalara/shared is used as-is (real Zod schemas) — no mock needed.

import { getAuthClaims, isStaffClaims } from '@estalara/auth';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient, upsertConversionLabel } from '@estalara/db';

const mockGetAuthClaims = vi.mocked(getAuthClaims);
const mockIsStaffClaims = vi.mocked(isStaffClaims);
const mockCreateAdminClient = vi.mocked(createAdminClient);
const mockUpsertConversionLabel = vi.mocked(upsertConversionLabel);
const mockCaptureException = vi.mocked(Sentry.captureException);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function agencyAuth(tenantId = TENANT_ID) {
  mockGetAuthClaims.mockResolvedValue({
    sub: 'user-uuid',
    email: 'user@agency.com',
    tenant_id: tenantId,
    agency_role: 'agency:owner',
    estalara_staff: false,
    mfa_verified: true,
  });
  mockIsStaffClaims.mockReturnValue(false);
}

function staffAuth() {
  mockGetAuthClaims.mockResolvedValue({
    sub: 'staff-uuid',
    email: 'staff@estalara.com',
    tenant_id: null,
    estalara_staff: true,
    estalara_role: 'estalara:ops',
    mfa_verified: true,
  });
  mockIsStaffClaims.mockReturnValue(true);
}

function makeGetRequest(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/admin/labels');
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  return new NextRequest(url.toString(), {
    headers: { Authorization: 'Bearer mock-token' },
  });
}

function makePatchRequest(id: string, body: unknown, authed = true): NextRequest {
  const url = new URL(`http://localhost/api/admin/labels/${id}`);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (authed) headers.Authorization = 'Bearer mock-token';
  return new NextRequest(url.toString(), {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

// ─── GET tests ────────────────────────────────────────────────────────────────

describe('GET /api/admin/labels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_DIRECT;
    delete process.env.CLICKHOUSE_URL;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_DIRECT;
    delete process.env.CLICKHOUSE_URL;
  });

  // ── Auth gates ────────────────────────────────────────────────────────────

  it('returns 401 when JWT is absent', async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    const { GET } = await import('./route.js');
    const req = new NextRequest('http://localhost/api/admin/labels');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 when staff supplies no tenant_id param', async () => {
    staffAuth();
    const { GET } = await import('./route.js');
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  it('returns 400 for invalid page_size (> 100)', async () => {
    agencyAuth();
    const { GET } = await import('./route.js');
    const res = await GET(makeGetRequest({ page_size: '200' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  // ── Mock path (no DB configured) ──────────────────────────────────────────

  it('returns mock data with data_source: mock when DATABASE_URL_ADMIN is unset', async () => {
    agencyAuth();
    const { GET } = await import('./route.js');
    const res = await GET(makeGetRequest({ page: '1', page_size: '5' }));
    expect(res.status).toBe(200);
    const body = await parseBody<AdminLabelsResponse>(res);
    expect(body.data_source).toBe('mock');
    expect(body.rows.length).toBeGreaterThan(0);
    // Mock rows must carry observable label_source
    expect(body.rows[0]!.label.label_source).toBeDefined();
  });

  // ── Real DB path ──────────────────────────────────────────────────────────

  it('returns data_source: real when DB is configured and query succeeds', async () => {
    agencyAuth();
    process.env.DATABASE_URL_ADMIN = 'postgres://test';

    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([
              {
                id: LABEL_ID,
                tenant_id: TENANT_ID,
                prediction_id: 'pred-001',
                lead_id: '',
                outcome_class: 'viewing_booked',
                label_source: 'system',
                confidence: 1.0,
                notes: null,
                labeled_at: new Date('2026-06-01T10:00:00Z'),
                created_at: new Date('2026-06-01T10:00:00Z'),
                updated_at: new Date('2026-06-01T10:00:00Z'),
              },
            ]),
          }),
        }),
      }),
    };
    mockCreateAdminClient.mockReturnValue(
      mockDb as unknown as ReturnType<typeof createAdminClient>,
    );

    const { GET } = await import('./route.js');
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await parseBody<AdminLabelsResponse>(res);
    expect(body.data_source).toBe('real');
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]!.label.outcome_class).toBe('viewing_booked');
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  // ── Fail-loud: Postgres configured-but-fails (Rule K.2) ───────────────────

  it('returns 500 and calls Sentry when Postgres configured but throws', async () => {
    agencyAuth();
    process.env.DATABASE_URL_ADMIN = 'postgres://test';

    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockRejectedValue(new Error('connection refused')),
          }),
        }),
      }),
    };
    mockCreateAdminClient.mockReturnValue(
      mockDb as unknown as ReturnType<typeof createAdminClient>,
    );

    const { GET } = await import('./route.js');
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('postgres_query_failed');
    expect(mockCaptureException).toHaveBeenCalledOnce();
  });

  // ── Fail-loud: ClickHouse configured-but-fails (Rule K.2) ─────────────────

  it('returns 500 and calls Sentry when ClickHouse configured but fetch fails', async () => {
    agencyAuth();
    process.env.DATABASE_URL_ADMIN = 'postgres://test';
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

    // Use a valid UUID-shaped prediction_id so the hex-validation filter in
    // fetchPredictions allows it through to the ClickHouse query.
    const PRED_UUID = 'aaaabbbb-cccc-dddd-eeee-ffffffffffff';
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([
              {
                id: LABEL_ID,
                tenant_id: TENANT_ID,
                prediction_id: PRED_UUID,
                lead_id: '',
                outcome_class: 'viewing_booked',
                label_source: 'system',
                confidence: 1.0,
                notes: null,
                labeled_at: new Date('2026-06-01T10:00:00Z'),
                created_at: new Date('2026-06-01T10:00:00Z'),
                updated_at: new Date('2026-06-01T10:00:00Z'),
              },
            ]),
          }),
        }),
      }),
    };
    mockCreateAdminClient.mockReturnValue(
      mockDb as unknown as ReturnType<typeof createAdminClient>,
    );
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('CH error', { status: 500 })));

    const { GET } = await import('./route.js');
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('clickhouse_query_failed');
    expect(mockCaptureException).toHaveBeenCalledOnce();
  });

  // ── Staff can supply tenant_id param ──────────────────────────────────────

  it('allows staff to supply tenant_id as a query param', async () => {
    staffAuth();
    process.env.DATABASE_URL_ADMIN = 'postgres://test';

    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    };
    mockCreateAdminClient.mockReturnValue(
      mockDb as unknown as ReturnType<typeof createAdminClient>,
    );

    const { GET } = await import('./route.js');
    const res = await GET(makeGetRequest({ tenant_id: TENANT_ID }));
    expect(res.status).toBe(200);
    const body = await parseBody<AdminLabelsResponse>(res);
    expect(body.data_source).toBe('real');
  });
});

// ─── PATCH tests ──────────────────────────────────────────────────────────────

describe('PATCH /api/admin/labels/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_DIRECT;
  });

  afterEach(() => {
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_DIRECT;
  });

  const makeParams = (id: string) => Promise.resolve({ id });

  // ── Auth gates ────────────────────────────────────────────────────────────

  it('returns 401 when JWT is absent', async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    const { PATCH } = await import('./[id]/route.js');
    const res = await PATCH(makePatchRequest(LABEL_ID, { outcome_class: 'offer_made' }, false), {
      params: makeParams(LABEL_ID),
    });
    expect(res.status).toBe(401);
  });

  it('returns 401 for agency viewer (insufficient role)', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user',
      email: 'viewer@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:viewer',
      estalara_staff: false,
      mfa_verified: true,
    });
    mockIsStaffClaims.mockReturnValue(false);
    const { PATCH } = await import('./[id]/route.js');
    const res = await PATCH(makePatchRequest(LABEL_ID, { outcome_class: 'offer_made' }), {
      params: makeParams(LABEL_ID),
    });
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('forbidden');
  });

  it('returns 401 for staff readonly (insufficient role)', async () => {
    mockGetAuthClaims.mockResolvedValue({
      sub: 'staff',
      email: 'readonly@estalara.com',
      tenant_id: null,
      estalara_staff: true,
      estalara_role: 'estalara:readonly',
      mfa_verified: true,
    });
    mockIsStaffClaims.mockReturnValue(true);
    const { PATCH } = await import('./[id]/route.js');
    const res = await PATCH(makePatchRequest(LABEL_ID, { outcome_class: 'offer_made' }), {
      params: makeParams(LABEL_ID),
    });
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('forbidden');
  });

  // ── Service unavailable when DB not configured ─────────────────────────────

  it('returns 503 when DATABASE_URL_ADMIN is not configured', async () => {
    agencyAuth();
    const { PATCH } = await import('./[id]/route.js');
    const res = await PATCH(makePatchRequest(LABEL_ID, { outcome_class: 'offer_made' }), {
      params: makeParams(LABEL_ID),
    });
    expect(res.status).toBe(503);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('service_unavailable');
  });

  // ── Body validation ───────────────────────────────────────────────────────

  it('returns 400 for invalid outcome_class value', async () => {
    agencyAuth();
    process.env.DATABASE_URL_ADMIN = 'postgres://test';

    const { PATCH } = await import('./[id]/route.js');
    const res = await PATCH(makePatchRequest(LABEL_ID, { outcome_class: 'not_a_valid_class' }), {
      params: makeParams(LABEL_ID),
    });
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  it('returns 400 for extra fields (.strict() enforcement)', async () => {
    agencyAuth();
    process.env.DATABASE_URL_ADMIN = 'postgres://test';

    const { PATCH } = await import('./[id]/route.js');
    const res = await PATCH(
      makePatchRequest(LABEL_ID, {
        outcome_class: 'offer_made',
        extra_field: 'should_not_be_here',
      }),
      { params: makeParams(LABEL_ID) },
    );
    expect(res.status).toBe(400);
  });

  // ── 404 when label not found ──────────────────────────────────────────────

  it('returns 404 when label does not exist', async () => {
    agencyAuth();
    process.env.DATABASE_URL_ADMIN = 'postgres://test';

    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    };
    mockCreateAdminClient.mockReturnValue(
      mockDb as unknown as ReturnType<typeof createAdminClient>,
    );

    const { PATCH } = await import('./[id]/route.js');
    const res = await PATCH(makePatchRequest(LABEL_ID, { outcome_class: 'offer_made' }), {
      params: makeParams(LABEL_ID),
    });
    expect(res.status).toBe(404);
  });

  // ── Cross-tenant: agency user gets 404 (not 403) ─────────────────────────

  it("returns 404 (not 403) when agency user tries to reclassify another tenant's label", async () => {
    agencyAuth(TENANT_ID);
    process.env.DATABASE_URL_ADMIN = 'postgres://test';

    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: LABEL_ID,
                // label belongs to OTHER_TENANT_ID, not TENANT_ID
                tenantId: OTHER_TENANT_ID,
                predictionId: 'pred-001',
                leadId: '',
              },
            ]),
          }),
        }),
      }),
    };
    mockCreateAdminClient.mockReturnValue(
      mockDb as unknown as ReturnType<typeof createAdminClient>,
    );

    const { PATCH } = await import('./[id]/route.js');
    const res = await PATCH(makePatchRequest(LABEL_ID, { outcome_class: 'offer_made' }), {
      params: makeParams(LABEL_ID),
    });
    // 404 prevents leaking "label exists but belongs to another tenant" information.
    expect(res.status).toBe(404);
  });

  // ── Success path: writes label_source=manual_admin ────────────────────────

  it('writes label_source=manual_admin and returns 200 on valid reclassification', async () => {
    agencyAuth();
    process.env.DATABASE_URL_ADMIN = 'postgres://test';

    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: LABEL_ID,
                tenantId: TENANT_ID,
                predictionId: 'pred-001',
                leadId: '',
              },
            ]),
          }),
        }),
      }),
    };
    mockCreateAdminClient.mockReturnValue(
      mockDb as unknown as ReturnType<typeof createAdminClient>,
    );
    mockUpsertConversionLabel.mockResolvedValue(undefined);

    const { PATCH } = await import('./[id]/route.js');
    const res = await PATCH(
      makePatchRequest(LABEL_ID, {
        outcome_class: 'contract_signed',
        notes: 'CRM confirmed — deal signed 2026-06-01',
      }),
      { params: makeParams(LABEL_ID) },
    );
    expect(res.status).toBe(200);
    const body = await parseBody<{
      ok: boolean;
      id: string;
      outcome_class: string;
      label_source: string;
    }>(res);
    expect(body.ok).toBe(true);
    expect(body.label_source).toBe('manual_admin');
    expect(body.outcome_class).toBe('contract_signed');

    // Verify upsertConversionLabel was called with the right arguments.
    expect(mockUpsertConversionLabel).toHaveBeenCalledOnce();
    const callArgs = mockUpsertConversionLabel.mock.calls[0]!;
    expect(callArgs[1].labelSource).toBe('manual_admin');
    expect(callArgs[1].outcomeClass).toBe('contract_signed');
    expect(callArgs[1].notes).toBe('CRM confirmed — deal signed 2026-06-01');
    expect(callArgs[1].tenantId).toBe(TENANT_ID);

    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  // ── Fail-loud: Postgres configured-but-fails on the write (Rule K.2) ──────

  it('returns 500 and calls Sentry when upsertConversionLabel throws', async () => {
    agencyAuth();
    process.env.DATABASE_URL_ADMIN = 'postgres://test';

    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue([
              {
                id: LABEL_ID,
                tenantId: TENANT_ID,
                predictionId: 'pred-001',
                leadId: '',
              },
            ]),
          }),
        }),
      }),
    };
    mockCreateAdminClient.mockReturnValue(
      mockDb as unknown as ReturnType<typeof createAdminClient>,
    );
    mockUpsertConversionLabel.mockRejectedValue(new Error('deadlock detected'));

    const { PATCH } = await import('./[id]/route.js');
    const res = await PATCH(makePatchRequest(LABEL_ID, { outcome_class: 'lost' }), {
      params: makeParams(LABEL_ID),
    });
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('postgres_write_failed');
    expect(mockCaptureException).toHaveBeenCalledOnce();
  });
});
