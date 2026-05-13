/**
 * Tests for packages/auth/src/middleware.ts
 *
 * Covers JWT HMAC-SHA-256 signature verification added in TICKET-FIX-013.
 *
 * Test JWTs are generated in-process using Node.js `crypto.createHmac` so that
 * no external JWT library is required and no real Supabase credentials are used.
 */

import { createHmac } from 'node:crypto';
import { describe, expect, it, vi, afterEach } from 'vitest';

import { getAuthClaims } from '../middleware.js';
import { isTenantClaims, isStaffClaims } from '../jwt.js';

// ─── JWT test helper ──────────────────────────────────────────────────────────

function b64url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

function b64urlBytes(bytes: Buffer): string {
  return bytes.toString('base64url');
}

/**
 * Build a signed JWT with the given payload and secret.
 * Uses HMAC-SHA-256 (alg: "HS256") — same algorithm Supabase uses.
 */
function signJwt(payload: Record<string, unknown>, secret: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const sig = createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${b64urlBytes(sig)}`;
}

/**
 * Build a JWT whose signature is produced by the wrong secret, simulating a
 * tampered or forged token that should be rejected.
 */
function signJwtTampered(payload: Record<string, unknown>): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  // Sign with a completely different secret so the signature does not match.
  const badSig = createHmac('sha256', 'wrong-secret').update(signingInput).digest();
  return `${signingInput}.${b64urlBytes(badSig)}`;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TEST_SECRET = 'super-test-secret-32-chars-long!!';

const tenantPayload = {
  sub: 'user-uuid-001',
  email: 'owner@acme.com',
  tenant_id: 'tenant-uuid-001',
  agency_role: 'agency:owner',
  estalara_staff: false,
  mfa_verified: true,
};

const staffPayload = {
  sub: 'staff-uuid-001',
  email: 'staff@estalara.io',
  estalara_staff: true,
  estalara_role: 'estalara:superadmin',
  mfa_verified: true,
};

/** Build a minimal Request with a Bearer token. */
function makeRequest(token: string): Request {
  return new Request('https://example.com/api/test', {
    headers: { Authorization: `Bearer ${token}` },
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('getAuthClaims — JWT signature verification (TICKET-FIX-013)', () => {
  it('valid TenantClaims token with correct secret → returns TenantClaims', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', TEST_SECRET);
    const token = signJwt(tenantPayload, TEST_SECRET);
    const req = makeRequest(token);
    const claims = await getAuthClaims(req);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe('user-uuid-001');
    expect(claims?.email).toBe('owner@acme.com');
    // Narrow to TenantClaims via type guard
    if (!claims || !isTenantClaims(claims)) {
      throw new Error('Expected TenantClaims');
    }
    expect(claims.tenant_id).toBe('tenant-uuid-001');
    expect(claims.agency_role).toBe('agency:owner');
  });

  it('valid StaffClaims token with correct secret → returns StaffClaims', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', TEST_SECRET);
    const token = signJwt(staffPayload, TEST_SECRET);
    const req = makeRequest(token);
    const claims = await getAuthClaims(req);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe('staff-uuid-001');
    // Narrow to StaffClaims via type guard
    if (!claims || !isStaffClaims(claims)) {
      throw new Error('Expected StaffClaims');
    }
    expect(claims.estalara_role).toBe('estalara:superadmin');
    expect(claims.tenant_id).toBeNull();
  });

  it('tampered signature → returns null', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', TEST_SECRET);
    const token = signJwtTampered(tenantPayload);
    const req = makeRequest(token);
    const claims = await getAuthClaims(req);
    expect(claims).toBeNull();
  });

  it('missing SUPABASE_JWT_SECRET → returns null (fail-secure)', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', '');
    // Generate a valid-looking token; it should still be rejected.
    const token = signJwt(tenantPayload, TEST_SECRET);
    const req = makeRequest(token);
    const claims = await getAuthClaims(req);
    expect(claims).toBeNull();
  });

  it('malformed token — only 2 parts → returns null', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', TEST_SECRET);
    const req = makeRequest('header.payload');
    const claims = await getAuthClaims(req);
    expect(claims).toBeNull();
  });

  it('malformed token — 4 parts → returns null', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', TEST_SECRET);
    const req = makeRequest('a.b.c.d');
    const claims = await getAuthClaims(req);
    expect(claims).toBeNull();
  });

  it('completely non-JWT garbage string → returns null', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', TEST_SECRET);
    const req = makeRequest('not-a-jwt');
    const claims = await getAuthClaims(req);
    expect(claims).toBeNull();
  });

  it('expired token — signature still valid → returns claims (expiry not checked here)', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', TEST_SECRET);
    const expiredPayload = {
      ...tenantPayload,
      // iat/exp well in the past
      iat: 1000000000,
      exp: 1000000001,
    };
    const token = signJwt(expiredPayload, TEST_SECRET);
    const req = makeRequest(token);
    // Signature verification does not enforce expiry — that is the caller's job.
    const claims = await getAuthClaims(req);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe('user-uuid-001');
  });

  it('no Authorization header and no cookie → returns null', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', TEST_SECRET);
    const req = new Request('https://example.com/api/test');
    const claims = await getAuthClaims(req);
    expect(claims).toBeNull();
  });

  it('token delivered via sb-access-token cookie → verified and returned', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', TEST_SECRET);
    const token = signJwt(tenantPayload, TEST_SECRET);
    const req = new Request('https://example.com/api/test', {
      headers: { cookie: `sb-access-token=${token}; other=value` },
    });
    const claims = await getAuthClaims(req);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe('user-uuid-001');
  });
});
