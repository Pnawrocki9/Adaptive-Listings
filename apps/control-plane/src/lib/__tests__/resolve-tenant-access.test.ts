/**
 * Security-invariant test suite for `resolveTenantAccess` (ADR-0018 §2 / FOLLOW-592).
 *
 * The ADR names five security invariants; each maps to a real foot-gun in the
 * current code and gets at least one dedicated test here. Plus the CEO Q3 write
 * tier matrix (readonly / ops / superadmin).
 *
 * Invariant → test mapping:
 *   INV-1  Agency path byte-unchanged (allowStaffOverride absent/false)  → AGENCY-1, AGENCY-DEFAULT
 *   INV-2  Agency session can NEVER act on a foreign tenant              → AGENCY-FOREIGN
 *   INV-3  Staff path needs verified estalara_staff + explicit opt-in;   → STAFF-READ, STAFF-NO-OPTIN,
 *          non-staff with opt-in falls through to agency unchanged          STAFF-NONSTAFF-FALLTHROUGH,
 *                                                                            STAFF-SECRET-REJECTED
 *   INV-4  Staff tenantId validated against the tenants table            → STAFF-UNKNOWN-TENANT,
 *                                                                            STAFF-MALFORMED-TENANT,
 *                                                                            STAFF-VALIDATION-FAILS-CLOSED
 *   INV-5  RLS/service-role trap: returned tenantId is the only fence    → RLS-TRAP-LEAK-DEMO
 *   Q3     Write tier: readonly=no-write, ops=write, superadmin=rank-3   → TIER-READONLY, TIER-OPS,
 *                                                                            TIER-SUPERADMIN
 *
 * Only @estalara/auth, @supabase/ssr, ./tracer-auth.js and @estalara/db are mocked
 * — the real resolveTenantAccess is exercised end-to-end.
 *
 * @module apps/control-plane/src/lib/__tests__/resolve-tenant-access.test
 */

import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock @estalara/auth ──────────────────────────────────────────────────────

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
  requireTenantAccess: vi.fn(),
  requireAgencyRole: vi.fn(),
  isTenantClaims: vi.fn(
    (claims: { estalara_staff: boolean; tenant_id: unknown }) =>
      !claims.estalara_staff && typeof claims.tenant_id === 'string',
  ),
  isStaffClaims: vi.fn((claims: { estalara_staff: boolean }) => claims.estalara_staff),
}));

// ─── Mock @supabase/ssr (drives getSessionAuth's SSR fallback) ────────────────

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn().mockImplementation(() => ({
    auth: { getUser: mockGetUser, getSession: mockGetSession },
  })),
}));

// ─── Mock ./tracer-auth.js (the composed staff gate) ──────────────────────────

vi.mock('@/lib/tracer-auth', () => ({
  verifyTracerAdminAuth: vi.fn(),
}));

// ─── Mock @estalara/db (tenants existence lookup) ─────────────────────────────

const mockCreateAdminClient = vi.fn<() => unknown>();
/** Captures the value passed to the mocked drizzle `eq()` (the queried tenant id). */
const mockState: { eqValue: unknown } = { eqValue: undefined };

vi.mock('@estalara/db', () => ({
  createAdminClient: () => mockCreateAdminClient(),
  tenants: { id: 'tenants.id', deletedAt: 'tenants.deleted_at' },
}));

vi.mock('drizzle-orm', () => ({
  and: (...args: unknown[]) => ({ and: args }),
  eq: (_col: unknown, value: unknown) => {
    mockState.eqValue = value;
    return { eq: value };
  },
  isNull: (a: unknown) => ({ isNull: a }),
}));

import { getAuthClaims, requireAgencyRole } from '@estalara/auth';
import { verifyTracerAdminAuth } from '@/lib/tracer-auth';
import { resolveTenantAccess, AccessError } from '@/lib/session-auth';

const mockGetAuthClaims = vi.mocked(getAuthClaims);
const mockRequireAgencyRole = vi.mocked(requireAgencyRole);
const mockVerifyTracer = vi.mocked(verifyTracerAdminAuth);

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';

const AGENCY_CLAIMS = {
  sub: 'agency-user',
  email: 'user@agency.com',
  tenant_id: TENANT_A,
  agency_role: 'agency:admin' as const,
  estalara_staff: false as const,
  mfa_verified: true,
};

function req(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/admin/tenants/x/analytics', { headers });
}

/**
 * Make tenantExists() see the given tenant id(s) as existing. The mocked drizzle
 * `eq()` records the queried id into `mockState.eqValue`; `limit()` returns a row
 * only when that id is in `existingIds`.
 */
function tenantsTableReturns(existingIds: string[]) {
  mockCreateAdminClient.mockReturnValue({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () =>
            Promise.resolve(
              existingIds.includes(String(mockState.eqValue)) ? [{ id: mockState.eqValue }] : [],
            ),
        }),
      }),
    }),
  });
}

async function expectStatus(p: Promise<unknown>, status: number) {
  await expect(p).rejects.toBeInstanceOf(AccessError);
  await p.catch((e: unknown) => {
    expect((e as AccessError).status).toBe(status);
  });
}

// staffSession(): make getSessionAuth resolve to a staff SSR session + make the
// tracer gate approve it.
function staffSession(role: 'estalara:superadmin' | 'estalara:ops' | 'estalara:readonly') {
  mockGetAuthClaims.mockResolvedValue(null);
  mockGetUser.mockResolvedValue({
    data: {
      user: {
        id: `staff-${role}`,
        email: 'staff@estalara.com',
        app_metadata: { estalara_staff: true, estalara_role: role },
        user_metadata: {},
        aud: 'authenticated',
        created_at: '2026-01-01T00:00:00Z',
      },
    },
    error: null,
  });
  mockGetSession.mockResolvedValue({
    data: { session: { access_token: 'staff-jwt' } },
    error: null,
  });
  mockVerifyTracer.mockResolvedValue({ ok: true, via: 'staff_session', claims: null });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-test');
  mockRequireAgencyRole.mockImplementation(() => undefined);
  tenantsTableReturns([TENANT_A, TENANT_B]);
});

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANT 1 — Agency path byte-unchanged
// ═══════════════════════════════════════════════════════════════════════════

describe('INV-1: agency path byte-unchanged', () => {
  it('AGENCY-1: agency session, no staff opt-in → via:agency, tenantId from claim only', async () => {
    mockGetAuthClaims.mockResolvedValue(AGENCY_CLAIMS);

    const result = await resolveTenantAccess(req({ Authorization: 'Bearer jwt' }));

    expect(result.via).toBe('agency');
    if (result.via !== 'agency') throw new Error('unreachable');
    expect(result.tenantId).toBe(TENANT_A);
    expect(result.claims).toEqual(AGENCY_CLAIMS);
    expect(result.rawToken).toBe('jwt');
    // Staff gate is never consulted on the agency path.
    expect(mockVerifyTracer).not.toHaveBeenCalled();
  });

  it('AGENCY-DEFAULT: enforces minAgencyRole exactly like requireTenantSessionAccess', async () => {
    mockGetAuthClaims.mockResolvedValue(AGENCY_CLAIMS);
    mockRequireAgencyRole.mockImplementation(() => {
      throw new Error("role 'agency:admin' is insufficient");
    });

    await expectStatus(resolveTenantAccess(req(), { minAgencyRole: 'agency:owner' }), 403);
    expect(mockRequireAgencyRole).toHaveBeenCalledWith(AGENCY_CLAIMS, 'agency:owner');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANT 2 — Agency session can NEVER act on a foreign tenant
// ═══════════════════════════════════════════════════════════════════════════

describe('INV-2: agency cannot act on a foreign tenant', () => {
  it('AGENCY-FOREIGN: agency session + mismatched tenantId param → 403, param never overrides', async () => {
    mockGetAuthClaims.mockResolvedValue(AGENCY_CLAIMS); // tenant_id = TENANT_A

    // Even with allowStaffOverride true, an agency user is handled on the agency
    // path and the foreign tenantId is rejected — not silently honored.
    await expectStatus(
      resolveTenantAccess(req(), { tenantId: TENANT_B, allowStaffOverride: true }),
      403,
    );
    expect(mockVerifyTracer).not.toHaveBeenCalled();
  });

  it('AGENCY-MATCH: agency session + matching tenantId param → allowed, tenantId is the claim', async () => {
    mockGetAuthClaims.mockResolvedValue(AGENCY_CLAIMS);

    const result = await resolveTenantAccess(req(), { tenantId: TENANT_A });
    expect(result.via).toBe('agency');
    expect(result.tenantId).toBe(TENANT_A);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANT 3 — Staff path needs verified staff + explicit opt-in
// ═══════════════════════════════════════════════════════════════════════════

describe('INV-3: staff path requires verified staff + explicit opt-in', () => {
  it('STAFF-READ: staff session + allowStaffOverride + valid tenant → via:staff', async () => {
    staffSession('estalara:ops');

    const result = await resolveTenantAccess(req(), {
      allowStaffOverride: true,
      tenantId: TENANT_A,
    });

    expect(result.via).toBe('staff');
    if (result.via !== 'staff') throw new Error('unreachable');
    expect(result.tenantId).toBe(TENANT_A);
    expect(result.staff.sub).toBe('staff-estalara:ops');
    expect(mockVerifyTracer).toHaveBeenCalledOnce();
  });

  it('STAFF-NO-OPTIN: staff session on a route WITHOUT allowStaffOverride → 403 (fail-closed)', async () => {
    staffSession('estalara:superadmin');

    // No opt-in → staff gets zero tenant access, even the superadmin.
    await expectStatus(resolveTenantAccess(req(), { tenantId: TENANT_A }), 403);
    expect(mockVerifyTracer).not.toHaveBeenCalled();
  });

  it('STAFF-NONSTAFF-FALLTHROUGH: agency user + allowStaffOverride → agency path, unchanged', async () => {
    mockGetAuthClaims.mockResolvedValue(AGENCY_CLAIMS);

    const result = await resolveTenantAccess(req(), {
      allowStaffOverride: true,
      tenantId: TENANT_A,
    });

    expect(result.via).toBe('agency');
    // The staff gate is never reached for a valid agency caller.
    expect(mockVerifyTracer).not.toHaveBeenCalled();
  });

  it('STAFF-SECRET-REJECTED: headless ADMIN_API_SECRET (no identity) → 403 not attributable', async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null }); // no session identity
    mockVerifyTracer.mockResolvedValue({ ok: true, via: 'admin_secret', claims: null });

    await expectStatus(
      resolveTenantAccess(req({ Authorization: 'Bearer THE_SECRET' }), {
        allowStaffOverride: true,
        tenantId: TENANT_A,
      }),
      403,
    );
  });

  it('STAFF-UNAUTH: no session at all + allowStaffOverride → 401', async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockVerifyTracer.mockResolvedValue({ ok: false, status: 401, message: 'no' });

    await expectStatus(
      resolveTenantAccess(req(), { allowStaffOverride: true, tenantId: TENANT_A }),
      401,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANT 4 — Staff tenantId validated against the tenants table
// ═══════════════════════════════════════════════════════════════════════════

describe('INV-4: staff tenantId validated against the tenants table', () => {
  it('STAFF-UNKNOWN-TENANT: well-formed but non-existent tenant id → 404', async () => {
    staffSession('estalara:ops');
    const ghost = '99999999-9999-4999-8999-999999999999';

    await expectStatus(
      resolveTenantAccess(req(), { allowStaffOverride: true, tenantId: ghost }),
      404,
    );
  });

  it('STAFF-MALFORMED-TENANT: non-UUID tenant id never hits the DB, → 404', async () => {
    staffSession('estalara:ops');

    await expectStatus(
      resolveTenantAccess(req(), { allowStaffOverride: true, tenantId: 'estalara_staff' }),
      404,
    );
    // Malformed id short-circuits before any admin DB client is created.
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('STAFF-MISSING-TENANT: allowStaffOverride without tenantId → 400', async () => {
    staffSession('estalara:ops');

    await expectStatus(resolveTenantAccess(req(), { allowStaffOverride: true }), 400);
  });

  it('STAFF-VALIDATION-FAILS-CLOSED: DB lookup throws → 500 (never passes through)', async () => {
    staffSession('estalara:ops');
    mockCreateAdminClient.mockImplementation(() => {
      throw new Error('DATABASE_URL_ADMIN is not set');
    });

    await expectStatus(
      resolveTenantAccess(req(), { allowStaffOverride: true, tenantId: TENANT_A }),
      500,
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INVARIANT 5 — RLS/service-role trap: the returned tenantId is the ONLY fence
// ═══════════════════════════════════════════════════════════════════════════

describe('INV-5: RLS trap — returned tenantId is the only tenant fence', () => {
  it('RLS-TRAP-LEAK-DEMO: a staff query WITHOUT the tenant filter crosses tenants; WITH it does not', async () => {
    staffSession('estalara:ops');

    const access = await resolveTenantAccess(req(), {
      allowStaffOverride: true,
      tenantId: TENANT_A,
    });
    expect(access.via).toBe('staff');
    if (access.via !== 'staff') throw new Error('unreachable');

    // Simulate the service-role (RLS-bypassed) world the staff path runs in: a
    // table holding rows for MULTIPLE tenants, with no DB-level fence.
    const allRows = [
      { tenant_id: TENANT_A, secret: 'A-data' },
      { tenant_id: TENANT_B, secret: 'B-data' },
    ];

    // The foot-gun: a staff query that forgets the WHERE tenant_id filter.
    const leakedRows = allRows; // no filter applied → reads EVERY tenant
    expect(leakedRows.map((r) => r.tenant_id)).toContain(TENANT_B); // cross-tenant leak

    // The contract: apply access.tenantId as the WHERE fence.
    const safeRows = allRows.filter((r) => r.tenant_id === access.tenantId);
    expect(safeRows).toHaveLength(1);
    expect(safeRows.every((r) => r.tenant_id === TENANT_A)).toBe(true);
    expect(safeRows.map((r) => r.tenant_id)).not.toContain(TENANT_B);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// CEO Q3 — Write tier matrix (readonly / ops / superadmin)
// ═══════════════════════════════════════════════════════════════════════════

describe('Q3: staff write tier matrix', () => {
  it('TIER-READONLY: estalara:readonly → canWrite=false, isSuperadmin=false', async () => {
    staffSession('estalara:readonly');

    const result = await resolveTenantAccess(req(), {
      allowStaffOverride: true,
      tenantId: TENANT_A,
    });
    if (result.via !== 'staff') throw new Error('unreachable');
    expect(result.canWrite).toBe(false);
    expect(result.isSuperadmin).toBe(false);
  });

  it('TIER-OPS: estalara:ops → canWrite=true, isSuperadmin=false', async () => {
    staffSession('estalara:ops');

    const result = await resolveTenantAccess(req(), {
      allowStaffOverride: true,
      tenantId: TENANT_A,
    });
    if (result.via !== 'staff') throw new Error('unreachable');
    expect(result.canWrite).toBe(true);
    expect(result.isSuperadmin).toBe(false);
  });

  it('TIER-SUPERADMIN: estalara:superadmin → canWrite=true, isSuperadmin=true', async () => {
    staffSession('estalara:superadmin');

    const result = await resolveTenantAccess(req(), {
      allowStaffOverride: true,
      tenantId: TENANT_A,
    });
    if (result.via !== 'staff') throw new Error('unreachable');
    expect(result.canWrite).toBe(true);
    expect(result.isSuperadmin).toBe(true);
  });
});
