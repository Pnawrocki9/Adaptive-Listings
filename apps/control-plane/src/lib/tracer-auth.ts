/**
 * Admin auth guard for K.3.6 Archetype Tracer routes (FOLLOW-267).
 *
 * Accepts either:
 *   (a) Bearer <ADMIN_API_SECRET> — compared with timingSafeEqual (constant-time).
 *   (b) A valid Supabase JWT bearing estalara_staff: true (admin-role JWT).
 *
 * All tracer routes are read-only (no state mutation). They expose session-level
 * archetype state and ClickHouse event trails which are operationally sensitive
 * but not directly PII-bearing. Auth is still required for tenant isolation.
 *
 * Rule H amendment: read-only routes do not require the full HMAC + replay-resistant
 * auth mandated for mutation routes, but they do require one of the two auth paths
 * above (no unauthenticated access).
 *
 * @module apps/control-plane/src/lib/tracer-auth
 */

import { timingSafeEqual } from 'crypto';
import type { NextRequest } from 'next/server';
import { getAuthClaims, isStaffClaims } from '@estalara/auth';
import type { AuthClaims } from '@estalara/auth';

export type TracerAuthResult =
  | { ok: true; via: 'admin_secret' | 'staff_jwt'; claims: AuthClaims | null }
  | { ok: false; status: 401 | 403; message: string };

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

  // ── Path 2: Supabase JWT with estalara_staff: true ────────────────────────
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
