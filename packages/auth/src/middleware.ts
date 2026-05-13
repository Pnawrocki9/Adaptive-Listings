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
 * @module @estalara/auth/middleware
 */

import {
  extractClaims,
  requireAgencyRole,
  requireStaffRole,
  isStaffClaims,
  isTenantClaims,
  type AgencyRole,
  type AuthClaims,
  type EstalaraRole,
  type StaffClaims,
  type TenantClaims,
} from './jwt.js';

export type { AuthClaims, TenantClaims, StaffClaims };

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

/**
 * Verify the HMAC-SHA-256 signature on a JWT and return the decoded payload.
 *
 * Returns `null` (fail-secure) when:
 *  - `SUPABASE_JWT_SECRET` is not set
 *  - The token does not have exactly three dot-separated parts
 *  - The signature does not match
 *  - Anything throws (e.g. malformed base64, JSON parse failure)
 *
 * Does NOT check `exp` / `nbf` — expiry enforcement is the caller's
 * responsibility.
 */
async function verifyAndDecodeJwtPayload(token: string): Promise<Record<string, unknown> | null> {
  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, sig] = parts as [string, string, string];

  try {
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
    const sigBytes = base64urlToUint8Array(sig);

    const valid = await crypto.subtle.verify('HMAC', key, sigBytes, signingInputBytes);
    if (!valid) return null;

    const decoded = base64urlToString(payload);
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── Public guards ─────────────────────────────────────────────────────────

/**
 * Extract and verify JWT claims from the request.
 *
 * The JWT signature is verified with HMAC-SHA-256 against `SUPABASE_JWT_SECRET`.
 * Returns `null` if no valid token is found, the signature is invalid, or
 * the claims cannot be parsed.
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

/**
 * Require an agency user with at least the specified role within their tenant.
 *
 * @throws {Error} if not authenticated, not an agency user, or insufficient role
 */
export async function requireTenantAccess(
  req: Request,
  minimum: AgencyRole,
): Promise<TenantClaims> {
  const claims = await requireAuth(req);
  requireAgencyRole(claims, minimum);
  if (!isTenantClaims(claims)) {
    throw new Error('Access denied: tenant user access required');
  }
  return claims;
}
