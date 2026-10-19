/**
 * Tests for session-auth.ts `getSessionAuthClaims` (FOLLOW-454, mirrors ADR-0013 / FOLLOW-336
 * test style; staff-only since FOLLOW-1335 removed the agency claim shape).
 *
 * Coverage:
 *   LEGACY-1: verified staff Bearer JWT → returned; @supabase/ssr is never touched (the legacy
 *             path short-circuits).
 *   LEGACY-2: no Bearer/legacy cookie, no SSR session → null.
 *   LEGACY-3: a verified legacy token that is NOT staff (a mocked tenant-user shape) is never
 *             returned — the SSR fallback decides instead.
 *   SSR-2: no legacy auth, valid SSR session (staff user) → reconstructed StaffClaims.
 *   SSR-3: no legacy auth, SSR getUser() returns no user → null.
 *   SSR-4: no legacy auth, SSR env vars absent → null (the guard short-circuits).
 *   SSR-5: SSR session with empty app_metadata → null (malformed claims are not trusted).
 *   SSR-6: SSR session of a former agency user (tenant_id + agency_role, no staff flag) → null.
 *   SSR-7: SSR staff session with a malformed estalara_role → null.
 *
 * These tests drive the REAL session-auth function — no mock of the module under test itself.
 * Only @estalara/auth and @supabase/ssr are mocked (Rule Q guardrail).
 *
 * @module apps/control-plane/src/lib/session-auth.test
 */

import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock @estalara/auth ──────────────────────────────────────────────────────

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
  isStaffClaims: vi.fn((claims: { estalara_staff: unknown }) => claims.estalara_staff === true),
}));

// ─── Mock @supabase/ssr ───────────────────────────────────────────────────────

const mockGetUser = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn().mockImplementation(() => ({
    auth: { getUser: mockGetUser },
  })),
}));

import { getAuthClaims } from '@estalara/auth';
import { getSessionAuthClaims } from './session-auth.js';

const mockGetAuthClaims = vi.mocked(getAuthClaims);

const STAFF_CLAIMS = {
  sub: 'staff-uuid',
  email: 'staff@estalara.com',
  tenant_id: null,
  estalara_staff: true as const,
  estalara_role: 'estalara:ops' as const,
  mfa_verified: true,
};

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/dashboard/analytics/summary', { headers });
}

function ssrUser(appMetadata: Record<string, unknown>) {
  return {
    data: {
      user: {
        id: 'user-uuid',
        email: 'user@example.com',
        app_metadata: appMetadata,
        user_metadata: {},
        aud: 'authenticated',
        created_at: '2026-01-01T00:00:00Z',
      },
    },
    error: null,
  };
}

describe('getSessionAuthClaims (FOLLOW-454; staff-only since FOLLOW-1335)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
  });

  it('LEGACY-1: verified staff Bearer JWT → returned, SSR client never called', async () => {
    mockGetAuthClaims.mockResolvedValue(STAFF_CLAIMS);

    const req = makeRequest({ Authorization: 'Bearer mock-jwt-token' });

    expect(await getSessionAuthClaims(req)).toEqual(STAFF_CLAIMS);
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it('LEGACY-2: no legacy auth, no SSR session (env unset) → null', async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    // Deliberately no NEXT_PUBLIC_SUPABASE_URL / ANON_KEY.

    expect(await getSessionAuthClaims(makeRequest())).toBeNull();
  });

  it('LEGACY-3: a verified legacy token that is not staff is never returned (SSR decides)', async () => {
    // @estalara/auth no longer produces this shape (FOLLOW-1335); the resolver must not pass
    // one through even if it did.
    mockGetAuthClaims.mockResolvedValue({
      sub: 'user-uuid',
      email: 'user@example.com',
      tenant_id: 'tenant-uuid-001',
      estalara_staff: false,
      mfa_verified: true,
    } as unknown as typeof STAFF_CLAIMS);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-test');
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    const req = makeRequest({ Authorization: 'Bearer mock-jwt-token' });

    expect(await getSessionAuthClaims(req)).toBeNull();
    expect(mockGetUser).toHaveBeenCalledTimes(1);
  });

  describe('SSR cookie fallback', () => {
    beforeEach(() => {
      mockGetAuthClaims.mockResolvedValue(null);
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-test');
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

      expect(await getSessionAuthClaims(makeRequest())).toEqual({
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

      expect(await getSessionAuthClaims(makeRequest())).toBeNull();
    });

    it('SSR-5: session user with empty app_metadata → null', async () => {
      mockGetUser.mockResolvedValue(ssrUser({}));

      expect(await getSessionAuthClaims(makeRequest())).toBeNull();
    });

    it('SSR-6: a former agency session (tenant_id + agency_role, no staff flag) → null', async () => {
      mockGetUser.mockResolvedValue(
        ssrUser({ tenant_id: 'tenant-uuid-001', agency_role: 'agency:owner' }),
      );

      expect(await getSessionAuthClaims(makeRequest())).toBeNull();
    });

    it('SSR-7: staff session with a malformed estalara_role → null', async () => {
      mockGetUser.mockResolvedValue(ssrUser({ estalara_staff: true, estalara_role: 'root' }));

      expect(await getSessionAuthClaims(makeRequest())).toBeNull();
    });
  });

  it('SSR-4: env vars absent → null without calling createServerClient auth', async () => {
    mockGetAuthClaims.mockResolvedValue(null);
    // No env vars stubbed.

    expect(await getSessionAuthClaims(makeRequest())).toBeNull();
    expect(mockGetUser).not.toHaveBeenCalled();
  });
});
