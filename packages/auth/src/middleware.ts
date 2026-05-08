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
 * In all cases the JWT payload is parsed but NOT cryptographically verified
 * here — Supabase validates the signature. This module only extracts and
 * type-checks the custom claims injected by custom_access_token_hook.
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

/**
 * Decode the payload portion of a JWT without verifying the signature.
 * Supabase has already verified the token; we trust the payload at this layer.
 */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1];
    if (!payload) return null;
    // Normalise base64url → base64
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(base64);
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── Public guards ─────────────────────────────────────────────────────────

/**
 * Extract and decode JWT claims from the request.
 * Returns `null` if no valid token is found or claims cannot be parsed.
 */
export function getAuthClaims(req: Request): Promise<AuthClaims | null> {
  const token = extractRawToken(req);
  if (!token) return Promise.resolve(null);
  const payload = decodeJwtPayload(token);
  if (!payload) return Promise.resolve(null);
  try {
    return Promise.resolve(extractClaims(payload));
  } catch {
    return Promise.resolve(null);
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
