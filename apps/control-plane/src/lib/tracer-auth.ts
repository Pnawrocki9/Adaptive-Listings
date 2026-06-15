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
 * All tracer routes are read-only (no state mutation). They expose session-level
 * archetype state and ClickHouse event trails which are operationally sensitive
 * but not directly PII-bearing. Auth is still required for tenant isolation.
 *
 * Rule H amendment: read-only routes do not require the full HMAC + replay-resistant
 * auth mandated for mutation routes, but they do require one of the auth paths
 * above (no unauthenticated access).
 *
 * @module apps/control-plane/src/lib/tracer-auth
 */

import { timingSafeEqual } from 'crypto';
import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';
import { getAuthClaims, isStaffClaims } from '@estalara/auth';
import type { AuthClaims } from '@estalara/auth';

export type TracerAuthResult =
  | { ok: true; via: 'admin_secret' | 'staff_jwt' | 'staff_session'; claims: AuthClaims | null }
  | { ok: false; status: 401 | 403; message: string };

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
 * Returns 'staff' when the session is a valid Estalara staff user, 'not_staff'
 * when a valid non-staff session exists (→ 403), and 'none' when no valid session
 * is present (→ fall through to other auth paths).
 */
async function checkStaffSession(req: NextRequest): Promise<'staff' | 'not_staff' | 'none'> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return 'none';

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
    if (!user) return 'none';

    const appMeta = user.app_metadata as Record<string, unknown>;
    return appMeta.estalara_staff === true ? 'staff' : 'not_staff';
  } catch {
    return 'none';
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
 * This is a READ-ONLY gate — no HMAC replay defense required (Rule H amendment:
 * HMAC + replay resistance is required for mutation endpoints only). The Bearer
 * token is still compared constant-time to prevent timing-based secret extraction.
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
        return { ok: true, via: 'admin_secret', claims: null };
      }
    }
    // Intentional fall-through: try JWT path if ADMIN_API_SECRET doesn't match
    // (token might be a JWT instead of the raw secret).
  }

  // ── Path 2: Supabase SSR browser session (chunked cookie) ─────────────────
  // This is the path that same-origin admin pages and EventSource SSE take. The
  // browser sends sb-<project-ref>-auth-token automatically; getUser() validates
  // it and we read staff status from app_metadata (FOLLOW-326).
  const sessionStatus = await checkStaffSession(req);
  if (sessionStatus === 'staff') {
    return { ok: true, via: 'staff_session', claims: null };
  }
  if (sessionStatus === 'not_staff') {
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
      return { ok: true, via: 'staff_jwt', claims };
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
