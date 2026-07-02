/**
 * Session-aware auth resolution for tenant-facing dashboard routes and APIs.
 *
 * Mirrors the admin-side SSR-cookie fix (FOLLOW-326 / ADR-0013 / FOLLOW-336). The
 * browser's Supabase session (set by `@supabase/ssr`'s browser client via
 * `signInWithPassword()`) lives in a chunked `sb-<project-ref>-auth-token` cookie,
 * not the legacy `sb-access-token` cookie that `@estalara/auth`'s `getAuthClaims`
 * reads. Tenant-facing dashboard API routes (analytics, pilot metrics, A/B weights,
 * quiz config, tenant CRUD) and the `/dashboard/*` middleware gate authenticated
 * ONLY via `getAuthClaims`, so every same-origin fetch from a logged-in agency
 * browser session received a 401 (FOLLOW-454).
 *
 * `getSessionAuthClaims()` / `getSessionAuth()` first try the existing Bearer
 * header / legacy `sb-access-token` cookie path (`getAuthClaims` — unchanged, so
 * programmatic/API-key callers and every existing route test that mocks
 * `@estalara/auth` keep working unmodified). Only when that path finds nothing do
 * they fall back to validating the chunked SSR cookie via
 * `createServerClient().auth.getUser()` and reconstructing `AuthClaims` from
 * `user.app_metadata` — the same pattern `apps/control-plane/src/lib/tracer-auth.ts`
 * (`checkStaffSession`) and `apps/control-plane/src/middleware.ts`
 * (`checkAdminSession`) already use for the staff/admin surface.
 *
 * `@estalara/auth`'s `getAuthClaims` itself is intentionally NOT modified: it is
 * also used by `apps/decision-api` and `apps/ingest` (Cloudflare Workers), which
 * are not browser-session-authenticated surfaces and should not gain a dependency
 * on `@supabase/ssr`. The SSR-cookie fallback lives only in control-plane, same as
 * the existing admin fix.
 *
 * @module apps/control-plane/src/lib/session-auth
 */

import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';
import {
  getAuthClaims,
  requireTenantAccess,
  requireAgencyRole,
  isTenantClaims,
} from '@estalara/auth';
import type { AgencyRole, AuthClaims, EstalaraRole, TenantClaims } from '@estalara/auth';

function isAgencyRole(v: unknown): v is AgencyRole {
  return v === 'agency:owner' || v === 'agency:admin' || v === 'agency:viewer';
}

function isEstalaraRole(v: unknown): v is EstalaraRole {
  return v === 'estalara:superadmin' || v === 'estalara:ops' || v === 'estalara:readonly';
}

/** Read the raw Bearer / legacy `sb-access-token` cookie JWT, if present. */
function extractLegacyRawToken(req: NextRequest): string | null {
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  const legacyCookie = req.cookies.get('sb-access-token')?.value;
  return legacyCookie ?? null;
}

/**
 * Validate the chunked Supabase SSR session cookie and reconstruct `AuthClaims`
 * from `user.app_metadata`. Read-only — never writes refreshed cookies back onto
 * a response (unlike middleware, a route handler does not carry a rewritable
 * response object shared with the browser navigation; the browser's own
 * Supabase client instance handles token refresh on its next call).
 *
 * Returns `null` when Supabase env vars are absent, no session is present, or
 * `app_metadata` does not carry a structurally valid claim set.
 */
async function resolveSsrSession(
  req: NextRequest,
): Promise<{ claims: AuthClaims; rawToken: string | null } | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  try {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        // Read-only auth check — token refresh writes are not persisted here.
        setAll() {
          /* no-op: we only validate, never mutate a response's cookies */
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    const appMeta = user.app_metadata as Record<string, unknown>;
    const email = user.email;
    if (typeof email !== 'string' || email.length === 0) return null;
    const mfaVerified = appMeta.mfa_verified === true;

    let claims: AuthClaims;
    if (appMeta.estalara_staff === true) {
      const role = appMeta.estalara_role;
      if (!isEstalaraRole(role)) return null;
      claims = {
        sub: user.id,
        email,
        tenant_id: null,
        estalara_staff: true,
        estalara_role: role,
        mfa_verified: mfaVerified,
      };
    } else {
      const tenantId = appMeta.tenant_id;
      const agencyRole = appMeta.agency_role;
      if (typeof tenantId !== 'string' || tenantId.length === 0 || !isAgencyRole(agencyRole)) {
        return null;
      }
      claims = {
        sub: user.id,
        email,
        tenant_id: tenantId,
        agency_role: agencyRole,
        estalara_staff: false,
        mfa_verified: mfaVerified,
      };
    }

    // The access token was already network-validated by getUser() above.
    // getSession() reads it back out of the same (already-validated) client
    // state so RLS-scoped queries can propagate a real JWT via
    // createTenantClient()/db.rls() — without this, callers on this path would
    // silently fall back to createTenantClient(undefined), which DISABLES RLS
    // (packages/db/src/client.ts, tenantDb.rls pass-through branch).
    const {
      data: { session },
    } = await supabase.auth.getSession();
    return { claims, rawToken: session?.access_token ?? null };
  } catch {
    return null;
  }
}

/**
 * Resolve `AuthClaims` + the raw JWT for a tenant-facing request, trying the
 * legacy Bearer/cookie path first and falling back to the SSR session cookie.
 *
 * Use this (instead of `getSessionAuthClaims`) in routes that pass the raw token
 * into `createTenantClient(rawToken)` for RLS-enforced queries (e.g. `/api/ab/weights`,
 * `/api/tenants/:id/bandit/weights/:archetype`).
 */
export async function getSessionAuth(
  req: NextRequest,
): Promise<{ claims: AuthClaims; rawToken: string | null } | null> {
  const legacyClaims = await getAuthClaims(req);
  if (legacyClaims) {
    return { claims: legacyClaims, rawToken: extractLegacyRawToken(req) };
  }
  return resolveSsrSession(req);
}

/**
 * Session-aware drop-in replacement for `@estalara/auth`'s `getAuthClaims` in
 * tenant-facing control-plane routes. Convenience wrapper for routes that only
 * need claims, not the raw JWT.
 */
export async function getSessionAuthClaims(req: NextRequest): Promise<AuthClaims | null> {
  const result = await getSessionAuth(req);
  return result?.claims ?? null;
}

/**
 * Session-aware equivalent of `@estalara/auth`'s `requireTenantAccess`: tries the
 * legacy Bearer/cookie path first (unchanged — existing tests mocking
 * `requireTenantAccess` keep working unmodified), then falls back to the SSR
 * session cookie.
 *
 * @throws {Error} if not authenticated, not an agency user, or role insufficient.
 */
export async function requireTenantSessionAccess(
  req: NextRequest,
  minimum: AgencyRole,
): Promise<TenantClaims> {
  try {
    return await requireTenantAccess(req, minimum);
  } catch {
    const resolved = await resolveSsrSession(req);
    if (!resolved) {
      throw new Error('Unauthorized: no valid authentication token');
    }
    requireAgencyRole(resolved.claims, minimum);
    if (!isTenantClaims(resolved.claims)) {
      throw new Error('Access denied: tenant user access required');
    }
    return resolved.claims;
  }
}
