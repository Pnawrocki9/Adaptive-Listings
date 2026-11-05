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
import { isStaffClaims } from '../jwt.js';

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
function signJwt(
  payload: Record<string, unknown>,
  secret: string,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' },
): string {
  const encodedHeader = b64url(JSON.stringify(header));
  const body = b64url(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${body}`;
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

/**
 * FOLLOW-1307: the emitter is Supabase Auth (GoTrue). Its user access tokens carry
 * `iss = <project URL>/auth/v1` and `aud = 'authenticated'`; the verifier derives the expected
 * issuer from `NEXT_PUBLIC_SUPABASE_URL` (the same project the SSR path calls).
 */
const SUPABASE_URL = 'https://project-ref.supabase.co';
const ISSUER = `${SUPABASE_URL}/auth/v1`;
const nowSecs = (): number => Math.floor(Date.now() / 1000);

/** Stub the two env vars every accepted token needs. */
function stubVerifierEnv(): void {
  vi.stubEnv('SUPABASE_JWT_SECRET', TEST_SECRET);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', SUPABASE_URL);
}

/** The tenant-user payload the hook minted for agency users before FOLLOW-1335. */
const formerAgencyPayload = {
  sub: 'user-uuid-001',
  email: 'owner@acme.com',
  tenant_id: 'tenant-uuid-001',
  agency_role: 'agency:owner',
  estalara_staff: false,
  mfa_verified: true,
};

/** A live staff access token in the shape Supabase Auth emits (time claims set per test run). */
const staffPayload = {
  sub: 'staff-uuid-001',
  email: 'staff@estalara.com',
  estalara_staff: true,
  estalara_role: 'estalara:superadmin',
  mfa_verified: true,
  iss: ISSUER,
  aud: 'authenticated',
  role: 'authenticated',
  iat: nowSecs(),
  exp: nowSecs() + 3600,
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
  it('FOLLOW-1335: a validly signed former agency token → null (not a caller any more)', async () => {
    stubVerifierEnv();
    const token = signJwt(formerAgencyPayload, TEST_SECRET);
    const claims = await getAuthClaims(makeRequest(token));
    expect(claims).toBeNull();
  });

  it('valid StaffClaims token with correct secret → returns StaffClaims', async () => {
    stubVerifierEnv();
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
    stubVerifierEnv();
    // A staff payload: it would be accepted if the signature were valid, so a null proves the
    // signature check (a non-staff payload is null for another reason since FOLLOW-1335).
    const token = signJwtTampered(staffPayload);
    const req = makeRequest(token);
    const claims = await getAuthClaims(req);
    expect(claims).toBeNull();
  });

  it('missing SUPABASE_JWT_SECRET → returns null (fail-secure)', async () => {
    vi.stubEnv('SUPABASE_JWT_SECRET', '');
    // Generate a valid-looking staff token; it should still be rejected.
    const token = signJwt(staffPayload, TEST_SECRET);
    const req = makeRequest(token);
    const claims = await getAuthClaims(req);
    expect(claims).toBeNull();
  });

  it('malformed token — only 2 parts → returns null', async () => {
    stubVerifierEnv();
    const req = makeRequest('header.payload');
    const claims = await getAuthClaims(req);
    expect(claims).toBeNull();
  });

  it('malformed token — 4 parts → returns null', async () => {
    stubVerifierEnv();
    const req = makeRequest('a.b.c.d');
    const claims = await getAuthClaims(req);
    expect(claims).toBeNull();
  });

  it('completely non-JWT garbage string → returns null', async () => {
    stubVerifierEnv();
    const req = makeRequest('not-a-jwt');
    const claims = await getAuthClaims(req);
    expect(claims).toBeNull();
  });

  it('no Authorization header and no cookie → returns null', async () => {
    stubVerifierEnv();
    const req = new Request('https://example.com/api/test');
    const claims = await getAuthClaims(req);
    expect(claims).toBeNull();
  });

  it('token delivered via sb-access-token cookie → verified and returned', async () => {
    stubVerifierEnv();
    const token = signJwt(staffPayload, TEST_SECRET);
    const req = new Request('https://example.com/api/test', {
      headers: { cookie: `sb-access-token=${token}; other=value` },
    });
    const claims = await getAuthClaims(req);
    expect(claims).not.toBeNull();
    expect(claims?.sub).toBe('staff-uuid-001');
  });
});

// ─── FOLLOW-1307: time, algorithm, issuer and audience ───────────────────────

describe('getAuthClaims — exp / nbf / alg / iss / aud (FOLLOW-1307, Codex F-09)', () => {
  /** Sign a variant of the live staff token and verify it through the real middleware. */
  async function claimsFor(
    overrides: Record<string, unknown>,
    header?: Record<string, unknown>,
  ): Promise<unknown> {
    // An `undefined` override drops the claim (JSON.stringify omits undefined values).
    const payload: Record<string, unknown> = { ...staffPayload, ...overrides };
    return getAuthClaims(makeRequest(signJwt(payload, TEST_SECRET, header)));
  }

  it('control: the live Supabase-shaped staff token is accepted', async () => {
    stubVerifierEnv();
    expect(await claimsFor({})).not.toBeNull();
  });

  it('expired token (validly signed) → null', async () => {
    stubVerifierEnv();
    expect(await claimsFor({ iat: 1000000000, exp: 1000000001 })).toBeNull();
  });

  it('exp equal to now → null (expired at exp, RFC 7519 §4.1.4)', async () => {
    stubVerifierEnv();
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
      const now = Math.floor(Date.now() / 1000);
      expect(await claimsFor({ iat: now - 60, exp: now })).toBeNull();
      expect(await claimsFor({ iat: now - 60, exp: now + 1 })).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('no exp claim → null (a token without an expiry never expires)', async () => {
    stubVerifierEnv();
    expect(await claimsFor({ exp: undefined })).toBeNull();
  });

  it('non-numeric exp → null', async () => {
    stubVerifierEnv();
    expect(await claimsFor({ exp: String(nowSecs() + 3600) })).toBeNull();
  });

  it('nbf in the future → null; nbf in the past → accepted', async () => {
    stubVerifierEnv();
    expect(await claimsFor({ nbf: nowSecs() + 600 })).toBeNull();
    expect(await claimsFor({ nbf: nowSecs() - 600 })).not.toBeNull();
  });

  it('non-numeric nbf → null', async () => {
    stubVerifierEnv();
    expect(await claimsFor({ nbf: 'soon' })).toBeNull();
  });

  it.each([
    ['none', { alg: 'none', typ: 'JWT' }],
    ['HS512', { alg: 'HS512', typ: 'JWT' }],
    ['RS256', { alg: 'RS256', typ: 'JWT' }],
    ['ES256', { alg: 'ES256', typ: 'JWT' }],
    ['missing', { typ: 'JWT' }],
  ])(
    'header alg %s (signature still HMAC-SHA-256 with the right key) → null',
    async (_name, header) => {
      stubVerifierEnv();
      expect(await claimsFor({}, header)).toBeNull();
    },
  );

  it('a header that is not JSON → null', async () => {
    stubVerifierEnv();
    const body = b64url(JSON.stringify(staffPayload));
    const signingInput = `${b64url('not-json')}.${body}`;
    const sig = createHmac('sha256', TEST_SECRET).update(signingInput).digest();
    expect(await getAuthClaims(makeRequest(`${signingInput}.${b64urlBytes(sig)}`))).toBeNull();
  });

  it('wrong issuer → null (another project, or the anon/service key issuer "supabase")', async () => {
    stubVerifierEnv();
    expect(await claimsFor({ iss: 'https://other-ref.supabase.co/auth/v1' })).toBeNull();
    expect(await claimsFor({ iss: 'supabase' })).toBeNull();
    expect(await claimsFor({ iss: undefined })).toBeNull();
  });

  it('NEXT_PUBLIC_SUPABASE_URL with a trailing slash still yields the GoTrue issuer', async () => {
    stubVerifierEnv();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', `${SUPABASE_URL}/`);
    expect(await claimsFor({})).not.toBeNull();
  });

  it('NEXT_PUBLIC_SUPABASE_URL unset → null (no issuer to verify against: fail closed)', async () => {
    stubVerifierEnv();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    expect(await claimsFor({})).toBeNull();
  });

  it('audience: "authenticated" (string or array member) accepted; anything else → null', async () => {
    stubVerifierEnv();
    expect(await claimsFor({ aud: ['authenticated', 'other'] })).not.toBeNull();
    expect(await claimsFor({ aud: 'anon' })).toBeNull();
    expect(await claimsFor({ aud: ['anon'] })).toBeNull();
    expect(await claimsFor({ aud: undefined })).toBeNull();
  });
});
