/**
 * Tests for GET /api/admin/labels + PATCH /api/admin/labels/[id] (FOLLOW-174,
 * FOLLOW-597).
 *
 * Coverage:
 *   - GET: auth via `resolveTenantAccess` (ADR-0018 §2, FOLLOW-597) — 401/403/404
 *     mapped from AccessError, tenant-filter proof, option-wiring assertion.
 *   - Mock fallback (data_source: 'mock') when DB/CH absent (Rule K.2)
 *   - Fail-loud: 500 when Postgres configured-but-fails (Rule K.2)
 *   - Fail-loud: 500 when ClickHouse configured-but-fails (Rule K.2)
 *   - PATCH: writes label_source=manual_admin, validates outcome_class Zod enum
 *   - PATCH: cross-tenant guard (agency user gets 404, not 403, to avoid leaking)
 *   - PATCH: 503 when DATABASE_URL_ADMIN absent
 *   - PATCH staff branch (FOLLOW-597): staff_audit_log insert + db.transaction()
 *     atomicity, rollback-on-audit-failure (ADR-0018 §3a)
 *   - Wired-entrypoint test (Rule Q): drives the route handler, not just helpers
 *
 * @module apps/control-plane/src/app/api/admin/labels/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  buildPredictionsQuery,
  MODEL_VERSION_FILTER_PATTERN,
  type AdminLabelsResponse,
} from './route-helpers';
import type * as SessionAuthModule from '@/lib/session-auth';

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
  staffAuditLog: { __table: 'staff_audit_log' },
}));

// Partial mock (GET, FOLLOW-597): ONLY resolveTenantAccess is a spy; AccessError and
// every other export (incl. getSessionAuthClaims, used by PATCH) stay real.
vi.mock('@/lib/session-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionAuthModule>();
  return { ...actual, resolveTenantAccess: vi.fn() };
});

// `eq(col, val)`/`and(...conds)` → plain tagged objects the DB mock reads `.val` off
// of. This is how the MANDATORY tenant-filter test observes the REAL fence the route
// binds (RETRO-187) — `.where()` is always mocked in this file (never real Postgres),
// so swapping the real drizzle-orm builders for introspectable stand-ins does not
// change any OTHER test's behavior (none of them inspect the `.where()` argument).
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ tag: 'eq', col, val })),
  and: vi.fn((...conds: unknown[]) => ({ tag: 'and', conds })),
  gte: vi.fn((col: unknown, val: unknown) => ({ tag: 'gte', col, val })),
  lte: vi.fn((col: unknown, val: unknown) => ({ tag: 'lte', col, val })),
}));

// @estalara/shared is used as-is (real Zod schemas) — no mock needed.

import { getAuthClaims, isStaffClaims } from '@estalara/auth';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient, upsertConversionLabel } from '@estalara/db';
import { resolveTenantAccess, AccessError, type TenantAccess } from '@/lib/session-auth';

const mockGetAuthClaims = vi.mocked(getAuthClaims);
const mockIsStaffClaims = vi.mocked(isStaffClaims);
const mockCreateAdminClient = vi.mocked(createAdminClient);
const mockUpsertConversionLabel = vi.mocked(upsertConversionLabel);
const mockCaptureException = vi.mocked(Sentry.captureException);
const mockResolve = vi.mocked(resolveTenantAccess);

// ─── Helpers — PATCH (getAuthClaims/isStaffClaims, unchanged shape) ───────────

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

// ─── Helpers — GET (resolveTenantAccess fixtures, FOLLOW-597) ─────────────────

function agencyAccess(tenantId = TENANT_ID): TenantAccess {
  return {
    via: 'agency',
    tenantId,
    claims: {
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: tenantId,
      agency_role: 'agency:viewer',
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
    mockResolve.mockResolvedValue(agencyAccess());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_DIRECT;
    delete process.env.CLICKHOUSE_URL;
  });

  // ── Auth gates ────────────────────────────────────────────────────────────

  it('returns 401 when resolveTenantAccess throws AccessError(401)', async () => {
    mockResolve.mockRejectedValue(new AccessError(401, 'Unauthorized'));
    const { GET } = await import('./route.js');
    const req = new NextRequest('http://localhost/api/admin/labels');
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it('returns 400 when staff supplies no tenant_id param (mapped from AccessError(400))', async () => {
    mockResolve.mockRejectedValue(
      new AccessError(400, 'tenantId is required when allowStaffOverride is true'),
    );
    const { GET } = await import('./route.js');
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('bad_request');
  });

  it('option-wiring (FOLLOW-603 pattern): calls resolveTenantAccess with allowStaffOverride:true', async () => {
    const { GET } = await import('./route.js');
    await GET(makeGetRequest());
    expect(mockResolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowStaffOverride: true }),
    );
  });

  it('returns 400 for invalid page_size (> 100)', async () => {
    const { GET } = await import('./route.js');
    const res = await GET(makeGetRequest({ page_size: '200' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  // ── Mock path (no DB configured) ──────────────────────────────────────────

  it('returns mock data with data_source: mock when DATABASE_URL_ADMIN is unset', async () => {
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

  // ── model_version filter: allowlist + param binding (FOLLOW-782) ──────────

  it('returns 400 (not a silently-dropped filter) when model_version violates the allowlist', async () => {
    const { GET } = await import('./route.js');
    const res = await GET(makeGetRequest({ model_version: "v1' OR 1=1 --" }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  it('FOLLOW-782 wiring: binds model_version as param_model_version, never into the SQL text', async () => {
    process.env.DATABASE_URL_ADMIN = 'postgres://test';
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';

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

    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown) => {
        capturedUrl = String(input);
        return Promise.resolve(new Response('', { status: 200 }));
      }),
    );

    const { GET } = await import('./route.js');
    const res = await GET(makeGetRequest({ model_version: 'rulebased-bandit v1.2' }));
    expect(res.status).toBe(200);

    const url = new URL(capturedUrl);
    // The value travels as a bound ClickHouse param…
    expect(url.searchParams.get('param_model_version')).toBe('rulebased-bandit v1.2');
    // …and the SQL text carries only the placeholder, never the value.
    const sql = url.searchParams.get('query') ?? '';
    expect(sql).toContain('model_version = {model_version:String}');
    expect(sql).not.toContain('rulebased-bandit v1.2');
  });

  // ── Staff can supply tenant_id param ──────────────────────────────────────

  it('allows staff to supply tenant_id as a query param', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_ID));
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

  // ── MANDATORY tenant-filter test (ADR-0018 §2 invariant 5, RETRO-187) ─────
  //
  // Drives the route's REAL Drizzle query (not a pre-filtered local array): the
  // DB mock keys a stateful per-tenant store on the value the route binds into
  // `.where(eq(conversionLabels.tenantId, access.tenantId))`. A mis-fence (e.g.
  // binding the wrong tenant) would key the wrong store slot and surface B's rows.

  it('MANDATORY: staff request for tenant A binds eq(conversionLabels.tenantId, A) into the real query and never returns B’s rows', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_ID));
    process.env.DATABASE_URL_ADMIN = 'postgres://test';

    const rowsByTenant: Record<string, Record<string, unknown>[]> = {
      [TENANT_ID]: [
        {
          id: LABEL_ID,
          tenant_id: TENANT_ID,
          prediction_id: 'pred-a',
          lead_id: '',
          outcome_class: 'viewing_booked',
          label_source: 'system',
          confidence: 1.0,
          notes: null,
          labeled_at: new Date('2026-06-01T10:00:00Z'),
          created_at: new Date('2026-06-01T10:00:00Z'),
          updated_at: new Date('2026-06-01T10:00:00Z'),
        },
      ],
      [OTHER_TENANT_ID]: [
        {
          id: 'other-label-id',
          tenant_id: OTHER_TENANT_ID,
          prediction_id: 'pred-b',
          lead_id: '',
          outcome_class: 'lost',
          label_source: 'system',
          confidence: 0.4,
          notes: null,
          labeled_at: new Date('2026-06-02T10:00:00Z'),
          created_at: new Date('2026-06-02T10:00:00Z'),
          updated_at: new Date('2026-06-02T10:00:00Z'),
        },
      ],
    };

    // `fetchLabels` always builds `conditions = [eq(conversionLabels.tenantId, tenantId), ...]`
    // then `and(...conditions)` — so `conds[0].val` is the REAL tenant fence the route bound.
    let capturedWhereVal: string | null = null;
    const mockDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn((cond: { tag: string; conds: { tag: string; val: string }[] }) => {
            capturedWhereVal = cond.conds[0]!.val;
            const tenantRows = rowsByTenant[capturedWhereVal] ?? [];
            return { orderBy: vi.fn().mockResolvedValue(tenantRows) };
          }),
        }),
      }),
    };
    mockCreateAdminClient.mockReturnValue(
      mockDb as unknown as ReturnType<typeof createAdminClient>,
    );

    const { GET } = await import('./route.js');
    const res = await GET(makeGetRequest({ tenant_id: TENANT_ID }));
    const body = await parseBody<AdminLabelsResponse>(res);

    // The fence bound into the REAL query is A, never B.
    expect(capturedWhereVal).toBe(TENANT_ID);
    expect(capturedWhereVal).not.toBe(OTHER_TENANT_ID);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]!.label.id).toBe(LABEL_ID);
    expect(body.rows[0]!.label.tenant_id).toBe(TENANT_ID);
    // Tenant B's row must never appear for a tenant-A-scoped request.
    expect(body.rows.some((r) => r.label.tenant_id === OTHER_TENANT_ID)).toBe(false);
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

// ═══════════════════════════════════════════════════════════════════════════
// PATCH — staff audit trail + atomicity (ADR-0018 §3/§3a, FOLLOW-597)
// ═══════════════════════════════════════════════════════════════════════════

describe('PATCH /api/admin/labels/[id] — staff audit trail + atomicity', () => {
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

  /** Build a mock admin client whose select() resolves the existing row, and whose
   * transaction() invokes the callback with a `tx` exposing `.insert(staffAuditLog)`. */
  function makeStaffWriteDb(auditRows: Record<string, unknown>[]) {
    const selectDb = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([
                { id: LABEL_ID, tenantId: TENANT_ID, predictionId: 'pred-001', leadId: '' },
              ]),
          }),
        }),
      }),
      transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
        const insertFn = vi.fn((_table: unknown) => ({
          values: vi.fn((v: Record<string, unknown>) => {
            auditRows.push(v);
            return Promise.resolve([]);
          }),
        }));
        return cb({ insert: insertFn });
      }),
    };
    return selectDb;
  }

  it('a successful staff reclassify inserts exactly one staff_audit_log row (attributed) inside ONE db.transaction()', async () => {
    staffAuth();
    process.env.DATABASE_URL_ADMIN = 'postgres://test';
    const auditRows: Record<string, unknown>[] = [];
    const db = makeStaffWriteDb(auditRows);
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);
    mockUpsertConversionLabel.mockResolvedValue(undefined);

    const { PATCH } = await import('./[id]/route.js');
    const res = await PATCH(makePatchRequest(LABEL_ID, { outcome_class: 'purchased' }), {
      params: makeParams(LABEL_ID),
    });

    expect(res.status).toBe(200);
    expect(db.transaction).toHaveBeenCalledOnce();
    // upsertConversionLabel was called INSIDE the tx (with the tx handle as 1st arg).
    expect(mockUpsertConversionLabel).toHaveBeenCalledOnce();
    expect(mockUpsertConversionLabel.mock.calls[0]![1].outcomeClass).toBe('purchased');
    // Exactly one attributed staff_audit_log row.
    expect(auditRows).toHaveLength(1);
    expect(auditRows[0]!.adminUserId).toBe('staff-uuid');
    expect(auditRows[0]!.action).toBe('conversion_label.reclassify');
    expect(auditRows[0]!.targetTenantId).toBe(TENANT_ID);
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('ROLLS BACK (no silent 200) when the staff audit insert fails inside the tx', async () => {
    staffAuth();
    process.env.DATABASE_URL_ADMIN = 'postgres://test';

    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([
                { id: LABEL_ID, tenantId: TENANT_ID, predictionId: 'pred-001', leadId: '' },
              ]),
          }),
        }),
      }),
      transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
        const insertFn = vi.fn(() => ({
          values: vi.fn().mockRejectedValue(new Error('audit sink down')),
        }));
        // Real Postgres/Drizzle rolls back the whole tx when the callback rejects
        // (well-established Drizzle behavior — not independently re-provable from a
        // mock; the load-bearing property under test here is that the ROUTE never
        // returns a silent 200 when this rejection occurs).
        return cb({ insert: insertFn });
      }),
    };
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);
    mockUpsertConversionLabel.mockResolvedValue(undefined);

    const { PATCH } = await import('./[id]/route.js');
    const res = await PATCH(makePatchRequest(LABEL_ID, { outcome_class: 'purchased' }), {
      params: makeParams(LABEL_ID),
    });

    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('audit_write_failed');
    expect(mockCaptureException).toHaveBeenCalledOnce();
  });

  it('agency write does NOT open a transaction and is NOT audited', async () => {
    agencyAuth();
    process.env.DATABASE_URL_ADMIN = 'postgres://test';
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            limit: vi
              .fn()
              .mockResolvedValue([
                { id: LABEL_ID, tenantId: TENANT_ID, predictionId: 'pred-001', leadId: '' },
              ]),
          }),
        }),
      }),
      transaction: vi.fn(),
    };
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);
    mockUpsertConversionLabel.mockResolvedValue(undefined);

    const { PATCH } = await import('./[id]/route.js');
    const res = await PATCH(makePatchRequest(LABEL_ID, { outcome_class: 'purchased' }), {
      params: makeParams(LABEL_ID),
    });

    expect(res.status).toBe(200);
    expect(db.transaction).not.toHaveBeenCalled();
    // upsertConversionLabel called directly on `db` (not a tx handle) — unchanged shape.
    expect(mockUpsertConversionLabel).toHaveBeenCalledWith(db, expect.anything());
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// buildPredictionsQuery — ClickHouse param binding (FOLLOW-782)
//
// These drive the query builder DIRECTLY with values the current allowlist
// would reject, i.e. they assert the property that must still hold if a future
// edit widens MODEL_VERSION_FILTER_PATTERN: the bound value can never alter the
// structure of the query. Layer 1 (the allowlist) is asserted separately by the
// route-level 400 test above — defence in depth, not either/or.
// ═══════════════════════════════════════════════════════════════════════════

describe('buildPredictionsQuery — model_version is bound, never interpolated', () => {
  const DECISION_IDS = ['aaaabbbb-cccc-dddd-eeee-ffffffffffff'];

  // Every one of these contains at least one ClickHouse-meaningful character.
  const HOSTILE_VALUES = [
    "v1' OR 1=1 --",
    "v1'; DROP TABLE adaptation_decisions; --",
    "v1' UNION ALL SELECT * FROM intent_events WHERE tenant_id != '",
    // Placeholder-injection attempt (a bound value must never be re-parsed as
    // ClickHouse param syntax). Deliberately NOT a placeholder name the query
    // already uses, so the "value never appears in SQL" assertion is meaningful.
    '{evil:Identifier}',
    "v1\\' OR 1=1",
    "v1') AND 1=1 --",
  ];

  it('the current allowlist rejects every hostile fixture (layer 1 still in place)', () => {
    for (const value of HOSTILE_VALUES) {
      expect(MODEL_VERSION_FILTER_PATTERN.test(value)).toBe(false);
    }
    // …and still accepts legitimate model versions.
    expect(MODEL_VERSION_FILTER_PATTERN.test('rulebased-bandit-v1')).toBe(true);
    expect(MODEL_VERSION_FILTER_PATTERN.test('intent v2.1')).toBe(true);
  });

  it.each(HOSTILE_VALUES)(
    'produces byte-identical SQL structure for hostile value %j (layer 2)',
    (hostile) => {
      const benign = buildPredictionsQuery(TENANT_ID, DECISION_IDS, 'rulebased-bandit-v1');
      const attack = buildPredictionsQuery(TENANT_ID, DECISION_IDS, hostile);

      expect(benign).not.toBeNull();
      expect(attack).not.toBeNull();

      // Query structure does not depend on the filter value at all.
      expect(attack?.sql).toBe(benign?.sql);
      expect(attack?.sql).toContain('AND model_version = {model_version:String}');
      // The value itself never appears in the SQL text.
      expect(attack?.sql).not.toContain(hostile);
      // It travels as a bound param, byte-for-byte, with no escaping applied.
      expect(attack?.params.model_version).toBe(hostile);
      // The tenant fence is bound too.
      expect(attack?.params.tenant_id).toBe(TENANT_ID);
    },
  );

  it('omits the model_version clause entirely when no filter is supplied', () => {
    const spec = buildPredictionsQuery(TENANT_ID, DECISION_IDS);
    expect(spec).not.toBeNull();
    expect(spec?.sql).not.toContain('model_version = {model_version:String}');
    expect(spec?.params).not.toHaveProperty('model_version');
    expect(spec?.params.tenant_id).toBe(TENANT_ID);
  });

  // ── decisionIds UUID-shape allowlist is retained (AC2) ────────────────────

  it('keeps the UUID-shape allowlist on decisionIds: non-UUID ids are dropped', () => {
    const spec = buildPredictionsQuery(TENANT_ID, [
      'aaaabbbb-cccc-dddd-eeee-ffffffffffff',
      "not-a-uuid' OR 1=1 --",
    ]);
    expect(spec).not.toBeNull();
    expect(spec?.sql).toContain("'aaaabbbb-cccc-dddd-eeee-ffffffffffff'");
    expect(spec?.sql).not.toContain('OR 1=1');
  });

  it('returns null when no decision id survives the UUID-shape allowlist', () => {
    expect(buildPredictionsQuery(TENANT_ID, ["'; DROP TABLE x; --"])).toBeNull();
    expect(buildPredictionsQuery(TENANT_ID, [])).toBeNull();
  });
});
