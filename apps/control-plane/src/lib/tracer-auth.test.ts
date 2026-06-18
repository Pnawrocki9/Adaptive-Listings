/**
 * Tests for verifyTracerAdminAuth (FOLLOW-310, ADR-0013 §Decision 1).
 * Extended with SSR cookie path tests (FOLLOW-336, RETRO-083 TG-1).
 *
 * Coverage:
 *   COOKIE-1: sb-access-token cookie + NO Authorization header → ok:true via 'staff_jwt'
 *             (fixes FOLLOW-310: EventSource cannot send headers; cookie path must work)
 *   COOKIE-2: No Authorization header AND no cookie → 401
 *   COOKIE-3: Authorization: Bearer <ADMIN_API_SECRET> → ok:true via 'admin_secret'
 *   COOKIE-4: Authorization with wrong secret → falls through to JWT path → 401 (no JWT)
 *   COOKIE-5: Authorization with staff JWT Bearer → ok:true via 'staff_jwt'
 *
 *   SSR-1: SSR cookie path — staff user (estalara_staff: true) → ok:true via 'staff_session'
 *   SSR-2: SSR cookie path — non-staff user (estalara_staff absent) → ok:false 403
 *   SSR-3: SSR cookie path — getUser() returns null (no active session) → falls through to
 *          JWT path → 401 when no JWT is present
 *   SSR-4: SSR cookie path — getUser() returns an error → falls through to JWT path → 401
 *
 * These tests drive the REAL verifyTracerAdminAuth function — no mock of the function
 * itself. Only getAuthClaims (the JWT decoder) and createServerClient (@supabase/ssr) are
 * mocked, which is the correct boundary.
 *
 * For the SSR tests (SSR-1..4): ADMIN_API_SECRET is deliberately UNSET so Path 1 is
 * skipped and the test reaches the real checkStaffSession call (Path 2). The value under
 * test (the staff outcome) comes from createServerClient().auth.getUser() — not from any
 * hand-written injection into checkStaffSession itself (Rule Q / guardrail: tests must
 * drive the REAL production path).
 *
 * @module apps/control-plane/src/lib/tracer-auth.test
 */

import { NextRequest } from 'next/server';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock @estalara/auth ──────────────────────────────────────────────────────

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
  isStaffClaims: vi.fn(),
}));

// ─── Mock @supabase/ssr ───────────────────────────────────────────────────────
// createServerClient is called by the REAL checkStaffSession (Path 2).
// We return a spy so individual tests can control what getUser() resolves to.
// The mock is hoisted; the per-test implementation is set via mockReturnValue.

const mockGetUser = vi.fn();

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn().mockImplementation(() => ({
    auth: {
      getUser: mockGetUser,
    },
  })),
}));

import { getAuthClaims, isStaffClaims } from '@estalara/auth';
import { verifyTracerAdminAuth } from './tracer-auth';

const mockGetAuthClaims = vi.mocked(getAuthClaims);
const mockIsStaffClaims = vi.mocked(isStaffClaims);

const ADMIN_SECRET = 'test-admin-secret-follow310';

/** A plausible staff claims object. */
const STAFF_CLAIMS = {
  sub: 'staff-uuid',
  email: 'staff@estalara.com',
  tenant_id: null,
  estalara_staff: true as const,
  estalara_role: 'estalara:ops' as const,
  mfa_verified: true,
};

/** Helper: build a NextRequest with specified headers. */
function makeRequest(headers: Record<string, string>, path = '/api/admin/tracer/sessions') {
  return new NextRequest(`http://localhost${path}`, { headers });
}

// ─── Original COOKIE-1..5 tests (FOLLOW-310) ─────────────────────────────────

describe('verifyTracerAdminAuth — FOLLOW-310 cookie auth path (ADR-0013 §Decision 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-test');
    // Default: SSR session path finds no user so it falls through to getAuthClaims.
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
  });

  it('COOKIE-1: sb-access-token cookie + NO Authorization header → ok:true via staff_jwt', async () => {
    // This test proves the fix for FOLLOW-310: the SSE EventSource cannot send
    // custom headers, so the browser sends only the sb-access-token cookie.
    // verifyTracerAdminAuth must successfully authenticate via Path 2 (getAuthClaims).
    mockGetAuthClaims.mockResolvedValue(STAFF_CLAIMS);
    mockIsStaffClaims.mockReturnValue(true);

    const req = makeRequest({
      // Cookie header — sent automatically by browser for same-origin requests.
      Cookie: `sb-access-token=valid.staff.jwt.token`,
      // NO Authorization header — EventSource cannot set custom headers.
    });

    const result = await verifyTracerAdminAuth(req);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.via).toBe('staff_jwt');
    }
    // getAuthClaims must have been called — it reads the cookie.
    expect(mockGetAuthClaims).toHaveBeenCalledOnce();
  });

  it('COOKIE-2: no Authorization header AND no cookie → 401', async () => {
    mockGetAuthClaims.mockResolvedValue(null);

    const req = makeRequest({});
    const result = await verifyTracerAdminAuth(req);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
  });

  it('COOKIE-3: Authorization: Bearer <ADMIN_API_SECRET> → ok:true via admin_secret', async () => {
    // Bearer token with the correct admin secret (programmatic/curl access).
    const req = makeRequest({ Authorization: `Bearer ${ADMIN_SECRET}` });

    const result = await verifyTracerAdminAuth(req);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.via).toBe('admin_secret');
    }
    // getAuthClaims should NOT be called — admin_secret path short-circuits.
    expect(mockGetAuthClaims).not.toHaveBeenCalled();
  });

  it('COOKIE-4: Authorization with wrong secret → falls through to JWT path → 401', async () => {
    mockGetAuthClaims.mockResolvedValue(null);

    const req = makeRequest({ Authorization: `Bearer wrong-secret` });
    const result = await verifyTracerAdminAuth(req);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
    // getAuthClaims was called because wrong-secret caused fall-through to Path 2.
    expect(mockGetAuthClaims).toHaveBeenCalledOnce();
  });

  it('COOKIE-5: Authorization with staff JWT Bearer → ok:true via staff_jwt', async () => {
    mockGetAuthClaims.mockResolvedValue(STAFF_CLAIMS);
    mockIsStaffClaims.mockReturnValue(true);

    const req = makeRequest({ Authorization: `Bearer staff.jwt.token.here` });
    const result = await verifyTracerAdminAuth(req);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.via).toBe('staff_jwt');
    }
  });
});

// ─── SSR-1..4: checkStaffSession paths (FOLLOW-336, RETRO-083 TG-1) ──────────
//
// These tests exercise Path 2 of verifyTracerAdminAuth — the checkStaffSession
// function that calls the REAL createServerClient().auth.getUser() (mocked here
// via the @supabase/ssr module mock above).
//
// ADMIN_API_SECRET is UNSET so Path 1 (Bearer token) is bypassed. No Authorization
// header is sent so Path 1 is also skipped even if ADMIN_API_SECRET were set.
// The `getUser` mock controls what checkStaffSession receives, exactly as the
// real Supabase server client would in production.

describe('verifyTracerAdminAuth — SSR cookie path via checkStaffSession (FOLLOW-336)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    // Path 1 is disabled — no admin secret, so fall-through to checkStaffSession.
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-test');
    // getAuthClaims (Path 3) returns null by default so it does not interfere.
    mockGetAuthClaims.mockResolvedValue(null);
    mockIsStaffClaims.mockReturnValue(false);
  });

  it('SSR-1: getUser() returns staff user (estalara_staff: true) → ok:true via staff_session', async () => {
    // The value under test — estalara_staff: true — comes from the mocked
    // createServerClient().auth.getUser() response, which mirrors what the real
    // Supabase Auth server returns when an active session with the correct
    // app_metadata is present. We do NOT inject the value directly into
    // checkStaffSession (it is not exported); the REAL function reads it from
    // the client response (Rule Q guardrail).
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'staff-user-uuid',
          app_metadata: { estalara_staff: true, estalara_role: 'estalara:ops' },
          user_metadata: {},
          aud: 'authenticated',
          created_at: '2026-01-01T00:00:00Z',
        },
      },
      error: null,
    });

    // No Authorization header → Path 1 skipped; SSR cookie path is the active gate.
    const req = makeRequest({ Cookie: 'sb-test-auth-token=chunk1' });
    const result = await verifyTracerAdminAuth(req);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Outcome must be 'staff_session', not 'staff_jwt' or 'admin_secret'.
      expect(result.via).toBe('staff_session');
      // staff_session carries no claims (app_metadata is read by checkStaffSession,
      // not the JWT claims decoder).
      expect(result.claims).toBeNull();
    }
    // Path 3 (getAuthClaims) must NOT be reached — staff_session short-circuits it.
    expect(mockGetAuthClaims).not.toHaveBeenCalled();
  });

  it('SSR-2: getUser() returns non-staff user (estalara_staff absent) → ok:false 403', async () => {
    // A valid Supabase session exists but the user is not Estalara staff.
    // The REAL checkStaffSession returns 'not_staff' → verifyTracerAdminAuth
    // must return 403 Forbidden without proceeding to the JWT path.
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'tenant-user-uuid',
          app_metadata: { provider: 'email' },
          user_metadata: {},
          aud: 'authenticated',
          created_at: '2026-01-01T00:00:00Z',
        },
      },
      error: null,
    });

    const req = makeRequest({ Cookie: 'sb-test-auth-token=chunk1' });
    const result = await verifyTracerAdminAuth(req);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.message).toMatch(/Forbidden/i);
    }
    // Once not_staff is detected, getAuthClaims must NOT be called.
    expect(mockGetAuthClaims).not.toHaveBeenCalled();
  });

  it('SSR-3: getUser() returns null user (no active session) → falls through to JWT → 401', async () => {
    // No Supabase session — checkStaffSession returns 'none', so verifyTracerAdminAuth
    // proceeds to Path 3 (getAuthClaims). With no JWT either, the result is 401.
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    mockGetAuthClaims.mockResolvedValue(null);

    const req = makeRequest({});
    const result = await verifyTracerAdminAuth(req);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
    // getAuthClaims IS called because 'none' causes fall-through to Path 3.
    expect(mockGetAuthClaims).toHaveBeenCalledOnce();
  });

  it('SSR-4: getUser() throws an error → checkStaffSession returns none → falls through → 401', async () => {
    // A network or auth server error causes getUser() to throw. The REAL
    // checkStaffSession catches all errors and returns 'none', so the auth
    // attempt falls through to the JWT path (Path 3), then 401.
    mockGetUser.mockRejectedValue(new Error('Supabase auth server unavailable'));
    mockGetAuthClaims.mockResolvedValue(null);

    const req = makeRequest({});
    const result = await verifyTracerAdminAuth(req);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
    }
  });
});
