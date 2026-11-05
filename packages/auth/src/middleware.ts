/**
 * Auth middleware helpers for Next.js App Router.
 *
 * These helpers wrap JWT extraction and RBAC checks for use in
 * apps/control-plane/src/middleware.ts. They accept the standard web `Request`
 * type — Next.js `NextRequest` extends `Request` and is directly compatible.
 *
 * Token lookup order:
 *  1. `Authorization: Bearer <token>` header
 *  2. `sb-access-token` cookie (Supabase SSR session cookie)
 *
 * JWT signatures are verified with HMAC-SHA-256 using the `SUPABASE_JWT_SECRET`
 * environment variable. If the secret is absent or the signature is invalid,
 * the token is rejected (fail-secure). No external JWT library is used —
 * verification is performed via the Web Crypto API (`crypto.subtle`).
 *
 * FOLLOW-1307 (Codex F-09): a validly signed token is accepted only when it is also a
 * live Supabase Auth user access token — header `alg` exactly `HS256`, a numeric `exp`
 * in the future, `nbf` (if present) not in the future, `iss` equal to
 * `<NEXT_PUBLIC_SUPABASE_URL>/auth/v1` and `aud` equal to (or containing)
 * `authenticated`. Those are the values Supabase Auth (GoTrue) emits for a signed-in
 * user (https://supabase.com/docs/guides/auth/jwt-fields); the project's anon and
 * service-role API keys, signed with the same secret, carry `iss: "supabase"` and no
 * `aud`, so they fail here regardless of their other claims.
 *
 * @module @estalara/auth/middleware
 */

import {
  extractClaims,
  requireStaffRole,
  isStaffClaims,
  type AuthClaims,
  type EstalaraRole,
  type StaffClaims,
} from './jwt.js';

export type { AuthClaims, StaffClaims };

// ─── Token extraction ──────────────────────────────────────────────────────

/**
 * Read the raw JWT string from Authorization header or Supabase SSR cookie.
 * Returns null if neither is present.
 */
function extractRawToken(req: Request): string | null {
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  const cookieHeader = req.headers.get('cookie') ?? '';
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key?.trim() === 'sb-access-token') {
      return rest.join('=');
    }
  }
  return null;
}

// ─── Base64url helpers ─────────────────────────────────────────────────────

/**
 * Decode a base64url-encoded string to a plain string (UTF-8 safe for ASCII
 * JWT payloads).
 */
function base64urlToString(input: string): string {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  // Add padding if needed.
  const padded = base64 + '=='.slice(0, (4 - (base64.length % 4)) % 4);
  return atob(padded);
}

/**
 * Decode a base64url-encoded string to a Uint8Array.
 * Used for the raw signature bytes.
 */
function base64urlToUint8Array(input: string): Uint8Array {
  const binary = base64urlToString(input);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// ─── JWT verification ──────────────────────────────────────────────────────

/** The only JWT algorithm this verifier accepts (Supabase's legacy shared-secret signing). */
const SUPPORTED_ALG = 'HS256';

/** `aud` of a Supabase Auth access token for a signed-in user. */
const SUPABASE_USER_AUDIENCE = 'authenticated';

/**
 * The issuer Supabase Auth (GoTrue) writes into its access tokens: the project URL plus
 * `/auth/v1`. Derived from `NEXT_PUBLIC_SUPABASE_URL` — the same project the SSR session
 * path (`@supabase/ssr` `getUser()`) validates against. `null` when the URL is unset: no
 * issuer can be verified, so every token is refused (fail closed).
 */
function expectedIssuer(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!url) return null;
  return `${url.replace(/\/+$/, '')}/auth/v1`;
}

/**
 * Check the registered claims of an already signature-verified payload (RFC 7519 §4.1):
 * `exp` required and numeric, expired AT `exp`; `nbf` optional, numeric, not in the
 * future; `iss` the Supabase Auth issuer; `aud` the signed-in-user audience. No leeway.
 */
function hasValidRegisteredClaims(payload: Record<string, unknown>): boolean {
  const nowSecs = Math.floor(Date.now() / 1000);
  const { exp, nbf, iss, aud } = payload;
  if (typeof exp !== 'number' || !Number.isFinite(exp) || nowSecs >= exp) return false;
  if (nbf !== undefined && (typeof nbf !== 'number' || !Number.isFinite(nbf) || nowSecs < nbf)) {
    return false;
  }
  const issuer = expectedIssuer();
  if (issuer === null || iss !== issuer) return false;
  const audiences: unknown[] = Array.isArray(aud) ? aud : [aud];
  return audiences.includes(SUPABASE_USER_AUDIENCE);
}

/**
 * Verify a JWT and return its decoded payload.
 *
 * Returns `null` (fail-secure) when:
 *  - `SUPABASE_JWT_SECRET` is not set
 *  - The token does not have exactly three dot-separated parts
 *  - The header is not JSON or its `alg` is not exactly `HS256` (FOLLOW-1307)
 *  - The HMAC-SHA-256 signature does not match
 *  - `exp` is missing, non-numeric or reached; `nbf` is non-numeric or in the future;
 *    `iss` is not the Supabase Auth issuer; `aud` is not `authenticated` (FOLLOW-1307 —
 *    see {@link hasValidRegisteredClaims})
 *  - Anything throws (e.g. malformed base64, JSON parse failure)
 */
async function verifyAndDecodeJwtPayload(token: string): Promise<Record<string, unknown> | null> {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, sig] = parts as [string, string, string];

  try {
    // The header is attacker-controlled: pin the algorithm instead of trusting it.
    const decodedHeader = JSON.parse(base64urlToString(header)) as unknown;
    if (
      typeof decodedHeader !== 'object' ||
      decodedHeader === null ||
      (decodedHeader as Record<string, unknown>).alg !== SUPPORTED_ALG
    ) {
      return null;
    }

    const keyBytes = new TextEncoder().encode(secret);
    const key = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );

    const signingInput = `${header}.${payload}`;
    const signingInputBytes = new TextEncoder().encode(signingInput);
    const sigBytes = base64urlToUint8Array(sig) as Uint8Array<ArrayBuffer>;

    // crypto.subtle.verify compares the MAC in constant time.
    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, signingInputBytes);
    if (!valid) return null;

    const decoded = JSON.parse(base64urlToString(payload)) as unknown;
    if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) return null;
    const claims = decoded as Record<string, unknown>;
    return hasValidRegisteredClaims(claims) ? claims : null;
  } catch {
    return null;
  }
}

// ─── Public guards ─────────────────────────────────────────────────────────

/**
 * Extract and verify JWT claims from the request.
 *
 * The JWT signature is verified with HMAC-SHA-256 against `SUPABASE_JWT_SECRET`, and its
 * algorithm, expiry, not-before, issuer and audience are checked (FOLLOW-1307).
 * Returns `null` if no valid token is found, the signature is invalid, the token is
 * expired / not yet valid / from another issuer or audience, or the claims cannot be
 * parsed — including a validly signed token that is not Estalara staff (the only claim
 * shape since FOLLOW-1335).
 */
export async function getAuthClaims(req: Request): Promise<AuthClaims | null> {
  const token = extractRawToken(req);
  if (!token) return null;
  const payload = await verifyAndDecodeJwtPayload(token);
  if (!payload) return null;
  try {
    return extractClaims(payload);
  } catch {
    return null;
  }
}

/**
 * Require a valid authenticated user — throw if no valid token is present.
 *
 * @throws {Error} if not authenticated
 */
export async function requireAuth(req: Request): Promise<AuthClaims> {
  const claims = await getAuthClaims(req);
  if (!claims) {
    throw new Error('Unauthorized: no valid authentication token');
  }
  return claims;
}

/**
 * Require an Estalara staff user with at least the specified role.
 *
 * @throws {Error} if not authenticated, not staff, or insufficient role
 */
export async function requireStaffAccess(
  req: Request,
  minimum: EstalaraRole,
): Promise<StaffClaims> {
  const claims = await requireAuth(req);
  requireStaffRole(claims, minimum);
  if (!isStaffClaims(claims)) {
    throw new Error('Access denied: staff access required');
  }
  return claims;
}
