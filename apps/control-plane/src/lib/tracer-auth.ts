/**
 * Admin auth guard for K.3.6 Archetype Tracer routes (FOLLOW-267).
 *
 * Accepts (in order):
 *   (a) Bearer <ADMIN_API_SECRET> — compared with timingSafeEqual (constant-time).
 *   (b) A Supabase SSR browser session — the sb-<project-ref>-auth-token cookie
 *       set by signInWithPassword(), validated via createServerClient().getUser().
 *       Staff status is read from user.app_metadata.estalara_staff. This is the
 *       path same-origin admin pages (and EventSource SSE) take, since the browser
 *       sends the chunked SSR cookie automatically (FOLLOW-326).
 *   (c) A verified Supabase JWT bearing estalara_staff: true (legacy sb-access-token
 *       cookie or Bearer JWT) via @estalara/auth getAuthClaims.
 *
 * Most consumers are read-only (tracer, analytics rollup, diagnostics). They expose
 * session-level archetype state and ClickHouse event trails which are operationally
 * sensitive but not directly PII-bearing. Auth is still required for tenant isolation.
 *
 * Rank (FOLLOW-1321, ADR-0018 Resolved decision #3 reaffirmed by ESC-085): a
 * successful result is discriminated by `kind`. `kind: 'staff'` carries the staff
 * user's id, `role` and the derived `canWrite` (rank >= `estalara:ops`) and
 * `isSuperadmin` (rank >= `estalara:superadmin`) from `@/lib/staff-rank` — the
 * same table `resolveTenantAccess` uses. `kind: 'secret'` is the headless
 * `ADMIN_API_SECRET` path: it carries no identity and no role, so it is READ-ONLY —
 * write routes that use this gate MUST require `kind === 'staff'` plus the right
 * tier, and attribute their `staff_audit_log` row to `userId`.
 *
 * Rule H amendment: read-only routes do not require the full HMAC + replay-resistant
 * auth mandated for mutation routes, but they do require one of the auth paths
 * above (no unauthenticated access). Mutating consumers accept only the verified
 * Supabase JWT / SSR session paths (signed, `exp`-bound — replay window = token TTL).
 *
 * @module apps/control-plane/src/lib/tracer-auth
 */

import { timingSafeEqual } from 'crypto';
import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';
import { getAuthClaims, isStaffClaims } from '@estalara/auth';
import type { AuthClaims, EstalaraRole } from '@estalara/auth';
import { isEstalaraRole, staffRoleTier } from '@/lib/staff-rank';

export type TracerAuthResult =
  | {
      ok: true;
      /** Headless `ADMIN_API_SECRET` Bearer: no identity, no role — read-only. */
      kind: 'secret';
      via: 'admin_secret';
      claims: null;
    }
  | {
      ok: true;
      /** An identified Estalara staff user (verified JWT or SSR session). */
      kind: 'staff';
      via: 'staff_jwt' | 'staff_session';
      /** Verified staff claims on the JWT path; `null` on the SSR session path. */
      claims: AuthClaims | null;
      /** Supabase user id of the staff member (`staff_audit_log.admin_user_id`). */
      userId: string;
      /** `null` when the session's `app_metadata.estalara_role` is missing/malformed. */
      role: EstalaraRole | null;
      /** Rank >= `estalara:ops` (CEO Q3). Write routes MUST assert this. */
      canWrite: boolean;
      /** Rank >= `estalara:superadmin`. Highest-risk writes MUST assert this. */
      isSuperadmin: boolean;
    }
  | { ok: false; status: 401 | 403; message: string };

type StaffSessionCheck =
  | { status: 'staff'; userId: string; role: EstalaraRole | null }
  | { status: 'not_staff' }
  | { status: 'none' };

/**
 * Verify the request carries a Supabase SSR browser session belonging to an
 * Estalara staff member.
 *
 * Reads the chunked sb-<project-ref>-auth-token cookie via createServerClient and
 * validates it with getUser() (which checks the token against the Supabase Auth
 * server). Staff status comes from user.app_metadata.estalara_staff — this does
 * NOT depend on the custom access token hook being installed, so it works even
 * before the JWT carries custom claims.
 *
 * Returns 'staff' (with the user id and `app_metadata.estalara_role`, `null` when
 * absent/malformed) when the session is a valid Estalara staff user, 'not_staff'
 * when a valid non-staff session exists (→ 403), and 'none' when no valid session
 * is present (→ fall through to other auth paths).
 */
async function checkStaffSession(req: NextRequest): Promise<StaffSessionCheck> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return { status: 'none' };

  try {
    const supabase = createServerClient(url, anonKey, {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        // Read-only auth check — token refresh writes are not persisted here.
        setAll() {
          /* no-op: we only validate, never mutate the response cookies */
        },
      },
    });

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { status: 'none' };

    const appMeta = user.app_metadata as Record<string, unknown>;
    if (appMeta.estalara_staff !== true) return { status: 'not_staff' };
    const role = isEstalaraRole(appMeta.estalara_role) ? appMeta.estalara_role : null;
    return { status: 'staff', userId: user.id, role };
  } catch {
    return { status: 'none' };
  }
}

/**
 * Verify the request carries admin-level auth for tracer routes.
 *
 * Checks in order:
 *   1. Bearer token matches ADMIN_API_SECRET (constant-time compare).
 *   2. Valid Supabase JWT with estalara_staff: true (staff-only routes).
 *
 * When ADMIN_API_SECRET is not set: skips the secret path and falls through to JWT.
 * When neither path matches: returns { ok: false, status: 401 }.
 *
 * The Bearer secret is compared constant-time to prevent timing-based secret
 * extraction. The result does not by itself authorize a write: a mutating caller
 * must check `kind === 'staff'` and `canWrite` / `isSuperadmin` (FOLLOW-1321).
 */
export async function verifyTracerAdminAuth(req: NextRequest): Promise<TracerAuthResult> {
  const authHeader = req.headers.get('Authorization') ?? req.headers.get('authorization') ?? '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  // ── Path 1: ADMIN_API_SECRET Bearer ──────────────────────────────────────
  const adminSecret = process.env.ADMIN_API_SECRET;
  if (adminSecret && token) {
    // Constant-time compare (timingSafeEqual from Node crypto).
    // Both buffers must be the same length — pad to the longer to avoid length leak.
    const secretBuf = Buffer.from(adminSecret, 'utf8');
    const tokenBuf = Buffer.from(token, 'utf8');

    if (secretBuf.length === tokenBuf.length) {
      if (timingSafeEqual(secretBuf, tokenBuf)) {
        return { ok: true, kind: 'secret', via: 'admin_secret', claims: null };
      }
    }
    // Intentional fall-through: try JWT path if ADMIN_API_SECRET doesn't match
    // (token might be a JWT instead of the raw secret).
  }

  // ── Path 2: Supabase SSR browser session (chunked cookie) ─────────────────
  // This is the path that same-origin admin pages and EventSource SSE take. The
  // browser sends sb-<project-ref>-auth-token automatically; getUser() validates
  // it and we read staff status from app_metadata (FOLLOW-326).
  const session = await checkStaffSession(req);
  if (session.status === 'staff') {
    return {
      ok: true,
      kind: 'staff',
      via: 'staff_session',
      claims: null,
      userId: session.userId,
      role: session.role,
      ...staffRoleTier(session.role),
    };
  }
  if (session.status === 'not_staff') {
    return {
      ok: false,
      status: 403,
      message: 'Forbidden: tracer routes require Estalara staff or ADMIN_API_SECRET',
    };
  }

  // ── Path 3: Supabase JWT with estalara_staff: true ────────────────────────
  // Legacy sb-access-token cookie or Bearer JWT (used by API callers and tests).
  try {
    const claims = await getAuthClaims(req);
    if (claims && isStaffClaims(claims)) {
      // A verified JWT's role is already typed; re-guard it anyway so a malformed
      // claim degrades to view-only instead of an undefined rank lookup.
      const role = isEstalaraRole(claims.estalara_role) ? claims.estalara_role : null;
      return {
        ok: true,
        kind: 'staff',
        via: 'staff_jwt',
        claims,
        userId: claims.sub,
        role,
        ...staffRoleTier(role),
      };
    }
    if (claims) {
      // Tenant JWT — not allowed for admin tracer routes.
      return {
        ok: false,
        status: 403,
        message: 'Forbidden: tracer routes require Estalara staff or ADMIN_API_SECRET',
      };
    }
  } catch {
    // JWT parse failure — fall through to 401.
  }

  return {
    ok: false,
    status: 401,
    message: 'Unauthorized: provide Bearer <ADMIN_API_SECRET> or a valid Estalara staff JWT',
  };
}
