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
 * also used by `apps/ingest` (Cloudflare Worker), which
 * is not a browser-session-authenticated surface and should not gain a dependency
 * on `@supabase/ssr`. The SSR-cookie fallback lives only in control-plane, same as
 * the existing admin fix.
 *
 * @module apps/control-plane/src/lib/session-auth
 */

import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { createAdminClient, tenants } from '@estalara/db';
import {
  getAuthClaims,
  requireTenantAccess,
  requireAgencyRole,
  isTenantClaims,
  isStaffClaims,
} from '@estalara/auth';
import type {
  AgencyRole,
  AuthClaims,
  EstalaraRole,
  StaffClaims,
  TenantClaims,
} from '@estalara/auth';
import { verifyTracerAdminAuth } from '@/lib/tracer-auth';

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

// ═══════════════════════════════════════════════════════════════════════════
// resolveTenantAccess — ADR-0018 §2 (superadmin tenant access) — FOLLOW-592
//
// Consumer phasing (Rule I deferral): the exports below (resolveTenantAccess,
// AccessError, TenantAccess, ResolveTenantAccessOpts) are the FOLLOW-592
// foundation. Production route consumers opt in in FOLLOW-594..600 per ADR-0018
// §6 (analytics read-only first, then per-tenant writes, then bandit). Until then
// the end-to-end wiring is proven by the integration test suite
// `__tests__/resolve-tenant-access.test.ts` (17 cases). Do NOT wire a route here
// — that is out of FOLLOW-592 scope.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Estalara staff role rank (ADR-0018 §4; mirrors the map in
 * `apps/control-plane/src/middleware.ts:119-125` and the module-private one in
 * `packages/auth/src/jwt.ts:59-63`, neither of which is exported for reuse).
 * Higher = more privileged. superadmin(3) > ops(2) > readonly(1).
 */
const STAFF_ROLE_RANK: Record<EstalaraRole, number> = {
  'estalara:superadmin': 3,
  'estalara:ops': 2,
  'estalara:readonly': 1,
};

/** Minimum staff rank that may WRITE on tenant data (CEO Q3, 2026-07-20): `estalara:ops`+. */
const STAFF_WRITE_MIN_RANK = STAFF_ROLE_RANK['estalara:ops']; // 2

/** Rank that gates the highest-risk staff writes (bandit weights, global generation_model). */
const STAFF_SUPERADMIN_RANK = STAFF_ROLE_RANK['estalara:superadmin']; // 3

/** Accepts any RFC-4122 UUID (all versions). Staff-supplied ids are attacker-influenced. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Error carrying an HTTP status. Every failure path in {@link resolveTenantAccess}
 * throws this so opted-in routes can `catch` and map `err.status` uniformly.
 */
export class AccessError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'AccessError';
    this.status = status;
  }
}

/**
 * Discriminated union returned by {@link resolveTenantAccess}. The two access
 * paths are structurally impossible to confuse — an agency result never carries
 * `canWrite`/`isSuperadmin`, and a staff result never carries the agency
 * `rawToken` (which, for a staff JWT, would be `null` and silently DISABLE RLS
 * if fed to `createTenantClient`; see the staff-branch doc-comment below).
 */
export type TenantAccess =
  | {
      via: 'agency';
      /** Sourced ONLY from `claims.tenant_id` — never from a URL/query param. */
      tenantId: string;
      claims: TenantClaims;
      /** Raw JWT for `createTenantClient(rawToken)` (RLS-enforced agency queries). */
      rawToken: string | null;
    }
  | {
      via: 'staff';
      /**
       * The VALIDATED, existence-checked tenant id (from `opts.tenantId`).
       *
       * ⚠️ RLS TRAP (ADR-0018 §2 invariant 5 — the load-bearing one): staff-path
       * queries MUST use a service-role client (`createAdminClient`), which
       * BYPASSES Row-Level Security. There is NO database-level tenant fence on
       * this path. Every staff query the caller runs MUST apply
       * `WHERE tenant_id = <this.tenantId>` (or the drizzle equivalent) IN THE
       * QUERY ITSELF. A staff query that forgets this filter reads/writes EVERY
       * tenant's rows — a cross-tenant leak. This field is the only fence; do not
       * rely on convention.
       */
      tenantId: string;
      staff: StaffClaims;
      role: EstalaraRole;
      /** `true` iff `role` rank ≥ `estalara:ops` (CEO Q3). Write routes MUST assert this. */
      canWrite: boolean;
      /** `true` iff `role` rank ≥ `estalara:superadmin`. Highest-risk routes assert this. */
      isSuperadmin: boolean;
    };

export interface ResolveTenantAccessOpts {
  /**
   * Explicit tenant from the URL/query segment. REQUIRED when `allowStaffOverride`
   * is true. For the agency path it is only a cross-check: it must equal the
   * session's `tenant_id` or the request is rejected — it can NEVER override the
   * claim (ADR-0018 §2 invariants 1, 2 & 4).
   */
  tenantId?: string;
  /**
   * Per-route opt-in for the staff (superadmin) override path. When false
   * (default) staff receive ZERO tenant access on the route (fail-closed).
   */
  allowStaffOverride?: boolean;
  /** Minimum agency role for the agency path. Unchanged existing semantics. */
  minAgencyRole?: AgencyRole;
}

/**
 * Validate a staff-supplied tenant id against the `tenants` table.
 *
 * Unlike the agency path (where the verified claim guarantees a real tenant), a
 * staff-supplied id is attacker-influenced input (ADR-0018 §2 invariant 3), so it
 * MUST be resolved against real data before any tenant-scoped query runs. Uses the
 * same service-role lookup the Tenants hub uses (`tenants/[id]/route.ts`), and
 * excludes soft-deleted tenants (`deleted_at IS NULL`).
 *
 * Fails CLOSED: if the id is malformed it returns false (→ 404, no distinction
 * leaked); if the lookup itself cannot run (DB unconfigured/unreachable) it THROWS
 * an `AccessError(500)` rather than passing through — this is a security boundary,
 * so an unverifiable tenant is a denied tenant, never an allowed one.
 *
 * Exported (FOLLOW-594) so URL-scoped staff pages (`/admin/tenants/[id]/*`) can
 * reuse the SAME existence check the API staff-override path uses, before
 * rendering — an unknown `[id]` renders `notFound()` (404). Do not duplicate the
 * lookup in a page; call this so both surfaces agree on what "exists" means.
 */
export async function tenantExists(tenantId: string): Promise<boolean> {
  // Malformed ids never hit the DB (a non-UUID against a uuid column would throw
  // and be indistinguishable from an outage). Treat as "unknown tenant".
  if (!UUID_RE.test(tenantId)) return false;

  let db: ReturnType<typeof createAdminClient>;
  try {
    db = createAdminClient();
  } catch {
    // DB not configured/reachable. Fail closed — we cannot verify tenant scope.
    throw new AccessError(500, 'Tenant validation unavailable: cannot verify staff tenant scope');
  }

  try {
    const rows = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(and(eq(tenants.id, tenantId), isNull(tenants.deletedAt)))
      .limit(1);
    return rows.length > 0;
  } catch {
    throw new AccessError(500, 'Tenant validation failed: cannot verify staff tenant scope');
  }
}

/**
 * Resolve tenant access for a request, returning a discriminated union that
 * distinguishes an AGENCY caller (acting on its own tenant) from an ESTALARA
 * STAFF caller acting on an explicit tenant (ADR-0018 §2, superadmin access).
 *
 * Resolution order and the five security invariants (each maps to a real foot-gun
 * in the current code — see ADR-0018 §2):
 *
 *  1. **Agency path is evaluated FIRST and is byte-unchanged.** If the resolved
 *     session is an agency (tenant) session, behavior equals today's
 *     `requireTenantSessionAccess`: `tenantId` comes ONLY from `claims.tenant_id`
 *     and the agency role is enforced. A route that does not set
 *     `allowStaffOverride` gets exactly this and nothing else.
 *  2. **An agency session can NEVER act on a foreign tenant.** If `opts.tenantId`
 *     is supplied and differs from the session's `tenant_id`, the request is 403.
 *     The param never overrides the claim (the returned id is always the claim).
 *  3. **Staff path requires verified `estalara_staff` AND explicit opt-in.** Only
 *     when `opts.allowStaffOverride === true` and {@link verifyTracerAdminAuth}
 *     (the shared, composed staff gate — constant-time `ADMIN_API_SECRET`, staff
 *     SSR session, or staff JWT) verifies. A non-staff caller with
 *     `allowStaffOverride: true` was already handled by the agency path above, so
 *     it falls through unchanged.
 *  4. **The staff `tenantId` is validated against the `tenants` table** (existence
 *     + not soft-deleted) before it is returned; an unknown id is 404.
 *  5. **The returned staff `tenantId` is the ONLY tenant fence** — staff queries
 *     run under `createAdminClient` (RLS bypassed), so the caller MUST apply
 *     `WHERE tenant_id = access.tenantId`. See the `TenantAccess` staff-branch
 *     doc-comment (RLS TRAP).
 *
 * Note (deliberate narrowing vs the tracer): the headless `ADMIN_API_SECRET`
 * Bearer path — valid for read-only tracer routes — is REJECTED here, because a
 * tenant-scoped staff action must be attributable to a staff user
 * (`staff_audit_log.adminUserId = staff.sub`, ADR-0018 §3) and the shared secret
 * carries no user identity. Staff must act via an identified SSR session or JWT.
 *
 * @throws {AccessError} with `.status` on any failure (401/403/404/500).
 */
export async function resolveTenantAccess(
  req: NextRequest,
  opts?: ResolveTenantAccessOpts,
): Promise<TenantAccess> {
  const allowStaffOverride = opts?.allowStaffOverride ?? false;
  const minAgencyRole: AgencyRole = opts?.minAgencyRole ?? 'agency:viewer';

  // Resolve the caller's session claims (legacy Bearer/cookie first, then SSR).
  const resolved = await getSessionAuth(req);

  // ── AGENCY PATH — evaluated first, byte-unchanged (invariants 1, 2, 4). ──────
  if (resolved && isTenantClaims(resolved.claims)) {
    try {
      requireAgencyRole(resolved.claims, minAgencyRole);
    } catch {
      throw new AccessError(403, 'Access denied: insufficient agency role');
    }
    // Invariant 2: a supplied tenantId is a cross-check only — never an override.
    if (opts?.tenantId !== undefined && opts.tenantId !== resolved.claims.tenant_id) {
      throw new AccessError(403, 'Access denied: agency session cannot act on a foreign tenant');
    }
    return {
      via: 'agency',
      tenantId: resolved.claims.tenant_id,
      claims: resolved.claims,
      rawToken: resolved.rawToken,
    };
  }

  // ── STAFF PATH — only when the route opts in (fail-closed by default). ───────
  if (allowStaffOverride) {
    // Compose the shared staff gate — we do NOT reimplement staff verification.
    const staffAuth = await verifyTracerAdminAuth(req);
    if (staffAuth.ok) {
      // Resolve the staff IDENTITY (sub + role) for write-tiering and audit
      // attribution. The headless ADMIN_API_SECRET path carries no identity, so a
      // tenant-scoped action cannot be attributed to a staff actor → reject.
      const staffClaims: StaffClaims | null =
        resolved && isStaffClaims(resolved.claims)
          ? resolved.claims
          : staffAuth.claims && isStaffClaims(staffAuth.claims)
            ? staffAuth.claims
            : null;
      if (!staffClaims) {
        throw new AccessError(
          403,
          'Staff override requires an identified staff user (SSR session or JWT); ' +
            'the headless ADMIN_API_SECRET path is not attributable for tenant-scoped actions',
        );
      }
      // Staff MUST supply the explicit tenant (URL/query) — never inferred.
      if (!opts?.tenantId) {
        throw new AccessError(400, 'tenantId is required when allowStaffOverride is true');
      }
      // Invariant 4: validate the attacker-influenced id against real tenants.
      const exists = await tenantExists(opts.tenantId);
      if (!exists) {
        throw new AccessError(404, 'Unknown tenant');
      }
      const role = staffClaims.estalara_role;
      return {
        via: 'staff',
        tenantId: opts.tenantId,
        staff: staffClaims,
        role,
        canWrite: STAFF_ROLE_RANK[role] >= STAFF_WRITE_MIN_RANK,
        isSuperadmin: STAFF_ROLE_RANK[role] >= STAFF_SUPERADMIN_RANK,
      };
    }
    // staffAuth not ok: a valid agency session already returned above (invariant 3
    // — non-staff falls through unchanged); reaching here means neither a valid
    // agency session nor verified staff.
  }

  // No access. 401 when unauthenticated; 403 when a valid session exists but is
  // not permitted here (e.g. staff on a route without allowStaffOverride).
  throw new AccessError(resolved ? 403 : 401, 'Unauthorized: no tenant access for this request');
}
