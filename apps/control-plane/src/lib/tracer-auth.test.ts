/**
 * Tests for verifyTracerAdminAuth (FOLLOW-310, ADR-0013 §Decision 1).
 *
 * Coverage:
 *   COOKIE-1: sb-access-token cookie + NO Authorization header → ok:true via 'staff_jwt'
 *             (fixes FOLLOW-310: EventSource cannot send headers; cookie path must work)
 *   COOKIE-2: No Authorization header AND no cookie → 401
 *   COOKIE-3: Authorization: Bearer <ADMIN_API_SECRET> → ok:true via 'admin_secret'
 *   COOKIE-4: Authorization with wrong secret → falls through to JWT path → 401 (no JWT)
 *   COOKIE-5: Authorization with staff JWT Bearer → ok:true via 'staff_jwt'
 *
 * These tests drive the REAL verifyTracerAdminAuth function — no mock of the function
 * itself. Only getAuthClaims (the JWT decoder) is mocked, which is the correct boundary:
 * the test proves that when the browser sends only a cookie (no Authorization header),
 * verifyTracerAdminAuth correctly reaches Path 2 (getAuthClaims) and succeeds.
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

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('verifyTracerAdminAuth — FOLLOW-310 cookie auth path (ADR-0013 §Decision 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
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
