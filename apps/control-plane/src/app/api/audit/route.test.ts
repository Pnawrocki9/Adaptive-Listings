/**
 * Tests for GET /api/audit — staff-only, tenant-fenced read of `staff_audit_log`
 * (FOLLOW-599, ADR-0018 §3).
 *
 * Coverage:
 *   - Auth: 401 (AccessError), 400 (staff no tenant_id), agency caller → 403
 *     (deferred Phase-2, out of scope), option-wiring (allowStaffOverride:true).
 *   - Mock fallback (data_source: 'mock') when the admin DB is absent (Rule K.2).
 *   - Real path (data_source: 'real') when configured + query succeeds.
 *   - Fail-loud: 500 + Sentry when Postgres configured-but-throws (Rule K.2).
 *   - `action` filter + pagination reflected.
 *   - A READ inserts NO staff_audit_log row (CEO Q4 — reads are not logged).
 *   - MANDATORY (ADR-0018 §2 invariant 5, RETRO-187): staff request for tenant A
 *     binds eq(staffAuditLog.targetTenantId, A) into the REAL service-role query
 *     and never returns tenant B's rows. Service-role table (no RLS) → the WHERE
 *     predicate is the ONLY fence.
 *
 * @module apps/control-plane/src/app/api/audit/route.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { AuditResponse } from './route';
import type * as SessionAuthModule from '@/lib/session-auth';

// ─── Constants ────────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';
const OTHER_TENANT_ID = '660e8400-e29b-41d4-a716-446655440099';
const STAFF_SUB = 'staff-uuid';

// ─── Mock modules ─────────────────────────────────────────────────────────────

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  staffAuditLog: {
    id: 'id',
    adminUserId: 'admin_user_id',
    action: 'action',
    targetTenantId: 'target_tenant_id',
    targetUserId: 'target_user_id',
    payload: 'payload',
    ipAddress: 'ip_address',
    userAgent: 'user_agent',
    createdAt: 'created_at',
  },
}));

// Partial mock: ONLY resolveTenantAccess is a spy; AccessError and everything else
// stay real (mirrors labels/route.test.ts).
vi.mock('@/lib/session-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionAuthModule>();
  return { ...actual, resolveTenantAccess: vi.fn() };
});

// `eq(col, val)`/`and(...conds)`/`desc(col)` → plain tagged objects the DB mock
// reads `.val` off of — how the MANDATORY tenant-fence test observes the REAL
// fence the route binds (RETRO-187, mirrors labels/route.test.ts).
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ tag: 'eq', col, val })),
  and: vi.fn((...conds: unknown[]) => ({ tag: 'and', conds })),
  desc: vi.fn((col: unknown) => ({ tag: 'desc', col })),
}));

import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@estalara/db';
import { resolveTenantAccess, AccessError, type TenantAccess } from '@/lib/session-auth';

const mockCreateAdminClient = vi.mocked(createAdminClient);
const mockCaptureException = vi.mocked(Sentry.captureException);
const mockResolve = vi.mocked(resolveTenantAccess);

// ─── Access fixtures ──────────────────────────────────────────────────────────

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
      sub: STAFF_SUB,
      email: 'staff@estalara.com',
      tenant_id: null,
      estalara_staff: true,
      estalara_role: 'estalara:readonly',
      mfa_verified: true,
    },
    role: 'estalara:readonly',
    canWrite: false,
    isSuperadmin: false,
  };
}

function makeRequest(params?: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/audit');
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  return new NextRequest(url.toString(), {
    headers: { Authorization: 'Bearer mock-token' },
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

/**
 * Build a mock admin client whose select→from→where→orderBy chain resolves the
 * given rows. `where` captures the fence value the route bound (from the mocked
 * `and(...)`'s first condition) so the MANDATORY test can assert it. `insert` is a
 * spy so we can prove a READ never writes an audit row.
 */
function makeReadDb(
  rowsOrByTenant: Record<string, unknown>[] | Record<string, Record<string, unknown>[]>,
  capture?: { whereVal: string | null },
) {
  const insertSpy = vi.fn();
  const transactionSpy = vi.fn();
  const db = {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn((cond: { tag: string; conds: { tag: string; val: string }[] }) => {
          const whereVal = cond.conds[0]!.val;
          if (capture) capture.whereVal = whereVal;
          const rows = Array.isArray(rowsOrByTenant)
            ? rowsOrByTenant
            : (rowsOrByTenant[whereVal] ?? []);
          return { orderBy: vi.fn().mockResolvedValue(rows) };
        }),
      }),
    }),
    insert: insertSpy,
    transaction: transactionSpy,
  };
  return { db, insertSpy, transactionSpy };
}

function auditRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000001',
    admin_user_id: STAFF_SUB,
    action: 'tenant.approved',
    target_tenant_id: TENANT_ID,
    payload: { plan: 'growth' },
    ip_address: '203.0.113.7',
    user_agent: 'staff-console',
    created_at: new Date('2026-06-01T10:00:00Z'),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_DIRECT;
    mockResolve.mockResolvedValue(staffAccess(TENANT_ID));
  });

  afterEach(() => {
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_DIRECT;
  });

  // ── Auth gates ────────────────────────────────────────────────────────────

  it('returns 401 when resolveTenantAccess throws AccessError(401)', async () => {
    mockResolve.mockRejectedValue(new AccessError(401, 'Unauthorized'));
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenant_id: TENANT_ID }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when staff supplies no tenant_id (mapped from AccessError(400))', async () => {
    mockResolve.mockRejectedValue(
      new AccessError(400, 'tenantId is required when allowStaffOverride is true'),
    );
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('bad_request');
  });

  it('rejects an AGENCY caller with 403 (agency audit read is a deferred Phase-2 item)', async () => {
    mockResolve.mockResolvedValue(agencyAccess(TENANT_ID));
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenant_id: TENANT_ID }));
    expect(res.status).toBe(403);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('forbidden');
  });

  it('option-wiring: calls resolveTenantAccess with allowStaffOverride:true', async () => {
    const { GET } = await import('./route.js');
    await GET(makeRequest({ tenant_id: TENANT_ID }));
    expect(mockResolve).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ allowStaffOverride: true, tenantId: TENANT_ID }),
    );
  });

  it('returns 400 for invalid limit (> 100)', async () => {
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenant_id: TENANT_ID, limit: '200' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_error');
  });

  // ── Mock path (no DB configured) ──────────────────────────────────────────

  it('returns mock data with data_source: mock when DATABASE_URL_ADMIN is unset', async () => {
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenant_id: TENANT_ID }));
    expect(res.status).toBe(200);
    const body = await parseBody<AuditResponse>(res);
    expect(body.data_source).toBe('mock');
    expect(body.entries.length).toBeGreaterThan(0);
    // Mock rows carry the fenced target_tenant_id + real-shape admin_user_id (no user_email).
    expect(body.entries[0]!.target_tenant_id).toBe(TENANT_ID);
    expect(typeof body.entries[0]!.admin_user_id).toBe('string');
  });

  // ── Real DB path ──────────────────────────────────────────────────────────

  it('returns data_source: real when DB is configured and query succeeds', async () => {
    process.env.DATABASE_URL_ADMIN = 'postgres://test';
    const { db } = makeReadDb([auditRow()]);
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenant_id: TENANT_ID }));
    expect(res.status).toBe(200);
    const body = await parseBody<AuditResponse>(res);
    expect(body.data_source).toBe('real');
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]!.action).toBe('tenant.approved');
    expect(body.entries[0]!.admin_user_id).toBe(STAFF_SUB);
    expect(body.entries[0]!.created_at).toBe('2026-06-01T10:00:00.000Z');
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  // ── A READ never writes an audit row (CEO Q4) ─────────────────────────────

  it('does NOT insert any staff_audit_log row on a read (reads are not logged — CEO Q4)', async () => {
    process.env.DATABASE_URL_ADMIN = 'postgres://test';
    const { db, insertSpy, transactionSpy } = makeReadDb([auditRow()]);
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenant_id: TENANT_ID }));
    expect(res.status).toBe(200);
    expect(insertSpy).not.toHaveBeenCalled();
    expect(transactionSpy).not.toHaveBeenCalled();
  });

  // ── Fail-loud: Postgres configured-but-fails (Rule K.2) ───────────────────

  it('returns 500 and calls Sentry when Postgres configured but throws', async () => {
    process.env.DATABASE_URL_ADMIN = 'postgres://test';
    const db = {
      select: vi.fn().mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockRejectedValue(new Error('connection refused')),
          }),
        }),
      }),
    };
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenant_id: TENANT_ID }));
    expect(res.status).toBe(500);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('audit_query_failed');
    expect(mockCaptureException).toHaveBeenCalledOnce();
  });

  // ── action filter + pagination ────────────────────────────────────────────

  it('applies the action filter to the mock fallback', async () => {
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenant_id: TENANT_ID, action: 'profile_mode.enabled' }));
    const body = await parseBody<AuditResponse>(res);
    expect(body.entries.every((e) => e.action === 'profile_mode.enabled')).toBe(true);
    expect(body.entries.length).toBe(1);
  });

  it('reflects page + limit in the response', async () => {
    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenant_id: TENANT_ID, page: '2', limit: '50' }));
    const body = await parseBody<AuditResponse>(res);
    expect(body.page).toBe(2);
    expect(body.limit).toBe(50);
  });

  // ── MANDATORY tenant-fence test (ADR-0018 §2 invariant 5, RETRO-187) ──────
  //
  // Drives the route's REAL Drizzle query (not a pre-filtered local array): the DB
  // mock keys a stateful per-tenant store on the value the route binds into
  // `.where(eq(staffAuditLog.targetTenantId, access.tenantId))`. A mis-fence (e.g.
  // binding the wrong tenant) would key the wrong store slot and surface B's rows.
  // Service-role table (no RLS) → this WHERE predicate is the ONLY fence.

  it('MANDATORY: staff request for tenant A binds eq(staffAuditLog.targetTenantId, A) into the real query and never returns B’s rows', async () => {
    mockResolve.mockResolvedValue(staffAccess(TENANT_ID));
    process.env.DATABASE_URL_ADMIN = 'postgres://test';

    const rowsByTenant: Record<string, Record<string, unknown>[]> = {
      [TENANT_ID]: [auditRow({ id: 'A-row', target_tenant_id: TENANT_ID })],
      [OTHER_TENANT_ID]: [
        auditRow({
          id: 'B-row',
          target_tenant_id: OTHER_TENANT_ID,
          action: 'tenant.suspended',
        }),
      ],
    };

    const capture = { whereVal: null as string | null };
    const { db } = makeReadDb(rowsByTenant, capture);
    mockCreateAdminClient.mockReturnValue(db as unknown as ReturnType<typeof createAdminClient>);

    const { GET } = await import('./route.js');
    const res = await GET(makeRequest({ tenant_id: TENANT_ID }));
    const body = await parseBody<AuditResponse>(res);

    // The fence bound into the REAL query is A, never B.
    expect(capture.whereVal).toBe(TENANT_ID);
    expect(capture.whereVal).not.toBe(OTHER_TENANT_ID);
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0]!.id).toBe('A-row');
    expect(body.entries[0]!.target_tenant_id).toBe(TENANT_ID);
    // Tenant B's row must never appear for a tenant-A-scoped request.
    expect(body.entries.some((e) => e.target_tenant_id === OTHER_TENANT_ID)).toBe(false);
  });
});
