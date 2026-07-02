/**
 * Tests for session-auth.ts (FOLLOW-454, mirrors ADR-0013 / FOLLOW-336 test style).
 *
 * Coverage:
 *   LEGACY-1: Bearer JWT present → getSessionAuthClaims resolves it; @supabase/ssr
 *             is never touched (legacy path short-circuits).
 *   LEGACY-2: No Bearer/legacy cookie, no SSR session → null.
 *   SSR-1: No legacy auth, valid SSR session (tenant user) → reconstructed
 *          TenantClaims + rawToken from getSession().access_token.
 *   SSR-2: No legacy auth, valid SSR session (staff user) → reconstructed StaffClaims.
 *   SSR-3: No legacy auth, SSR getUser() returns no user → null.
 *   SSR-4: No legacy auth, SSR env vars absent → null (no createServerClient call
 *          needed to prove this — the guard short-circuits before it).
 *   SSR-5: SSR session user has no tenant_id/agency_role in app_metadata → null
 *          (malformed claims must not be trusted).
 *
 *   requireTenantSessionAccess:
 *   RTA-1: legacy requireTenantAccess resolves → returned directly, SSR untouched.
 *   RTA-2: legacy requireTenantAccess throws, SSR session valid + sufficient role
 *          → resolved TenantClaims returned.
 *   RTA-3: legacy throws, SSR session insufficient role → throws.
 *   RTA-4: legacy throws, SSR session belongs to staff (not tenant) → throws.
 *   RTA-5: legacy throws, no SSR session → throws.
 *
 * These tests drive the REAL session-auth functions — no mock of the module under
 * test itself. Only @estalara/auth and @supabase/ssr are mocked (Rule Q guardrail).
 *
 * @module apps/control-plane/src/lib/session-auth.test
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
}));

// ─── Mock @supabase/ssr ───────────────────────────────────────────────────────

const mockGetUser = vi.fn();
const mockGetSession = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn().mockImplementation(() => ({
    auth: {
      getUser: mockGetUser,
      getSession: mockGetSession,
    },
  })),
}));

import { getAuthClaims, requireTenantAccess, requireAgencyRole } from '@estalara/auth';
import {
  getSessionAuth,
  getSessionAuthClaims,
  requireTenantSessionAccess,
} from './session-auth.js';

const mockGetAuthClaims = vi.mocked(getAuthClaims);
const mockRequireTenantAccess = vi.mocked(requireTenantAccess);
const mockRequireAgencyRole = vi.mocked(requireAgencyRole);

const TENANT_CLAIMS = {
  sub: 'user-uuid',
  email: 'user@agency.com',
  tenant_id: 'tenant-uuid-001',
  agency_role: 'agency:admin' as const,
  estalara_staff: false as const,
  mfa_verified: true,
};

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/dashboard/analytics/summary', { headers });
}

describe('getSessionAuth / getSessionAuthClaims (FOLLOW-454)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('LEGACY-1: Bearer JWT present → resolves via legacy path, SSR client never called', async () => {
    mockGetAuthClaims.mockResolvedValue(TENANT_CLAIMS);

    const req = makeRequest({ Authorization: 'Bearer mock-jwt-token' });
    const result = await getSessionAuth(req);

    expect(result?.claims).toEqual(TENANT_CLAIMS);
    expect(result?.rawToken).toBe('mock-jwt-token');
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('LEGACY-2: no legacy auth, no SSR session (env unset) → null', async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    // Deliberately no NEXT_PUBLIC_SUPABASE_URL / ANON_KEY.

    const req = makeRequest();
    const result = await getSessionAuth(req);

    expect(result).toBeNull();
    expect(await getSessionAuthClaims(req)).toBeNull();
  });

  describe('SSR cookie fallback', () => {
    beforeEach(() => {
      mockGetAuthClaims.mockResolvedValue(null);
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-test');
    });

    it('SSR-1: valid SSR session (tenant user) → reconstructed TenantClaims + rawToken', async () => {
      mockGetUser.mockResolvedValue({
        data: {
          user: {
            id: 'user-uuid',
            email: 'user@agency.com',
            app_metadata: { tenant_id: 'tenant-uuid-001', agency_role: 'agency:admin' },
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

      const req = makeRequest({ Cookie: 'sb-project-auth-token=chunk1' });
      const result = await getSessionAuth(req);

      expect(result?.claims).toEqual({
        sub: 'user-uuid',
        email: 'user@agency.com',
        tenant_id: 'tenant-uuid-001',
        agency_role: 'agency:admin',
        estalara_staff: false,
        mfa_verified: false,
      });
      expect(result?.rawToken).toBe('ssr-session-jwt');
    });

    it('SSR-2: valid SSR session (staff user) → reconstructed StaffClaims', async () => {
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
      mockGetSession.mockResolvedValue({
        data: { session: { access_token: 'ssr-staff-jwt' } },
        error: null,
      });

      const req = makeRequest();
      const result = await getSessionAuth(req);

      expect(result?.claims).toEqual({
        sub: 'staff-uuid',
        email: 'staff@estalara.com',
        tenant_id: null,
        estalara_staff: true,
        estalara_role: 'estalara:ops',
        mfa_verified: false,
      });
    });

    it('SSR-3: getUser() returns no user → null', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

      const req = makeRequest();
      expect(await getSessionAuth(req)).toBeNull();
    });

    it('SSR-5: session user has no tenant_id/agency_role in app_metadata → null', async () => {
      mockGetUser.mockResolvedValue({
        data: {
          user: {
            id: 'user-uuid',
            email: 'user@agency.com',
            app_metadata: {},
            user_metadata: {},
            aud: 'authenticated',
            created_at: '2026-01-01T00:00:00Z',
          },
        },
        error: null,
      });

      const req = makeRequest();
      expect(await getSessionAuth(req)).toBeNull();
    });
  });

  it('SSR-4: env vars absent → null without calling createServerClient auth', async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    // No env vars stubbed.

    const req = makeRequest();
    const result = await getSessionAuth(req);

    expect(result).toBeNull();
    expect(mockGetUser).not.toHaveBeenCalled();
  });
});

describe('requireTenantSessionAccess (FOLLOW-454)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-test');
    // vi.clearAllMocks() does not remove a mockImplementation set by a prior test
    // (e.g. RTA-3's throwing implementation) — reset to the default no-throw
    // behavior explicitly so each test starts from a clean slate.
    mockRequireAgencyRole.mockImplementation(() => undefined);
  });

  it('RTA-1: legacy requireTenantAccess resolves → returned directly, SSR untouched', async () => {
    mockRequireTenantAccess.mockResolvedValue(TENANT_CLAIMS);

    const req = makeRequest({ Authorization: 'Bearer mock-jwt-token' });
    const result = await requireTenantSessionAccess(req, 'agency:viewer');

    expect(result).toEqual(TENANT_CLAIMS);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('RTA-2: legacy throws, SSR session valid + sufficient role → resolved claims returned', async () => {
    mockRequireTenantAccess.mockRejectedValue(new Error('Unauthorized'));
    mockGetAuthClaims.mockResolvedValue(null);
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-uuid',
          email: 'user@agency.com',
          app_metadata: { tenant_id: 'tenant-uuid-001', agency_role: 'agency:admin' },
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

    const req = makeRequest();
    const result = await requireTenantSessionAccess(req, 'agency:viewer');

    expect(result.tenant_id).toBe('tenant-uuid-001');
    expect(mockRequireAgencyRole).toHaveBeenCalledWith(
      expect.objectContaining({ tenant_id: 'tenant-uuid-001' }),
      'agency:viewer',
    );
  });

  it('RTA-3: legacy throws, SSR session valid but role insufficient → throws', async () => {
    mockRequireTenantAccess.mockRejectedValue(new Error('Unauthorized'));
    mockGetAuthClaims.mockResolvedValue(null);
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-uuid',
          email: 'user@agency.com',
          app_metadata: { tenant_id: 'tenant-uuid-001', agency_role: 'agency:viewer' },
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
    // requireAgencyRole is mocked (no real role-hierarchy logic) — simulate the
    // real function's throw behavior for an insufficient role.
    mockRequireAgencyRole.mockImplementation(() => {
      throw new Error("Access denied: role 'agency:viewer' is insufficient");
    });

    const req = makeRequest();
    await expect(requireTenantSessionAccess(req, 'agency:admin')).rejects.toThrow(/insufficient/);
  });

  it('RTA-5: legacy throws, no SSR session → throws', async () => {
    mockRequireTenantAccess.mockRejectedValue(new Error('Unauthorized'));
    mockGetAuthClaims.mockResolvedValue(null);
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const req = makeRequest();
    await expect(requireTenantSessionAccess(req, 'agency:viewer')).rejects.toThrow();
  });

  it('RTA-4: legacy throws, SSR session belongs to staff (not tenant) → throws', async () => {
    mockRequireTenantAccess.mockRejectedValue(new Error('Unauthorized'));
    mockGetAuthClaims.mockResolvedValue(null);
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
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: 'ssr-staff-jwt' } },
      error: null,
    });

    const req = makeRequest();
    await expect(requireTenantSessionAccess(req, 'agency:viewer')).rejects.toThrow(
      /tenant user access required/,
    );
  });
});
