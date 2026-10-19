/**
 * Session-aware staff auth resolution for control-plane routes and APIs.
 *
 * Mirrors the admin-side SSR-cookie fix (FOLLOW-326 / ADR-0013 / FOLLOW-336). The
 * browser's Supabase session (set by `@supabase/ssr`'s browser client via
 * `signInWithPassword()`) lives in a chunked `sb-<project-ref>-auth-token` cookie,
 * not the legacy `sb-access-token` cookie that `@estalara/auth`'s `getAuthClaims`
 * reads (FOLLOW-454). `getSessionAuthClaims()` therefore first tries the Bearer
 * header / legacy cookie path (`getAuthClaims` — programmatic callers and the route
 * tests that mock `@estalara/auth`), and only when that finds no staff token falls
 * back to validating the chunked SSR cookie via `createServerClient().auth.getUser()`
 * and reconstructing the claims from `user.app_metadata` — the same pattern
 * `lib/tracer-auth.ts` (`checkStaffSession`) and `middleware.ts` (`checkAdminSession`)
 * use.
 *
 * FOLLOW-1335 (ESC-085, decision D-B): Adaptive Listings is single-tenant and has ONE
 * backoffice, so the only caller identity left is Estalara STAFF (ranks readonly < ops <
 * superadmin, `lib/staff-rank.ts`). The agency (tenant-user) claim shape, its SSR
 * reconstruction, `requireTenantSessionAccess` and the agency branch of
 * `resolveTenantAccess` are gone: a session or JWT that is not staff resolves to "no
 * caller" (401), whatever `tenant_id` / `agency_role` it may still carry.
 *
 * @module apps/control-plane/src/lib/session-auth
 */

import { createServerClient } from '@supabase/ssr';
import type { NextRequest } from 'next/server';
import { and, eq, isNull } from 'drizzle-orm';
import { createAdminClient, tenants } from '@estalara/db';
import { getAuthClaims, isStaffClaims } from '@estalara/auth';
import type { EstalaraRole, StaffClaims } from '@estalara/auth';
import { verifyTracerAdminAuth } from '@/lib/tracer-auth';
import { isEstalaraRole, staffRoleTier } from '@/lib/staff-rank';

/**
 * Validate the chunked Supabase SSR session cookie and reconstruct staff claims
 * from `user.app_metadata`. Read-only — never writes refreshed cookies back onto
 * a response (unlike middleware, a route handler does not carry a rewritable
 * response object shared with the browser navigation; the browser's own
 * Supabase client instance handles token refresh on its next call).
 *
 * Returns `null` when Supabase env vars are absent, no session is present, or
 * `app_metadata` does not carry a structurally valid STAFF claim set (a non-staff
 * session is no caller at all since FOLLOW-1335).
 */
async function resolveSsrStaffSession(req: NextRequest): Promise<StaffClaims | null> {
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
    if (appMeta.estalara_staff !== true) return null;
    const role = appMeta.estalara_role;
    if (!isEstalaraRole(role)) return null;

    return {
      sub: user.id,
      email,
      tenant_id: null,
      estalara_staff: true,
      estalara_role: role,
      mfa_verified: appMeta.mfa_verified === true,
    };
  } catch {
    return null;
  }
}

/**
 * Resolve the Estalara staff caller of a request: a verified Bearer / legacy-cookie
 * staff JWT first, then the SSR session cookie. `null` when neither carries staff.
 */
export async function getSessionAuthClaims(req: NextRequest): Promise<StaffClaims | null> {
  const legacyClaims = await getAuthClaims(req);
  if (legacyClaims && isStaffClaims(legacyClaims)) return legacyClaims;
  return resolveSsrStaffSession(req);
}

// ═══════════════════════════════════════════════════════════════════════════
// resolveTenantAccess — ADR-0018 §2 (superadmin tenant access) — FOLLOW-592;
// staff-only since FOLLOW-1335 (the agency path was removed with the agency roles).
// ═══════════════════════════════════════════════════════════════════════════

// Staff role rank (ADR-0018 §4): the table and the ops/superadmin thresholds live
// in `@/lib/staff-rank` (`staffRoleTier`), shared with `verifyTracerAdminAuth`
// (FOLLOW-1321) — never copy them here.

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
 * The access {@link resolveTenantAccess} grants: an identified Estalara staff user acting on
 * an explicit, existence-checked tenant. `via` is always `'staff'` since FOLLOW-1335 removed
 * the agency variant; it stays on the object so call sites keep reading explicitly.
 */
export interface TenantAccess {
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
}

export interface ResolveTenantAccessOpts {
  /**
   * Explicit tenant from the URL/query segment. REQUIRED (400 without it): staff carry
   * no tenant of their own, so the tenant is never inferred.
   */
  tenantId?: string;
  /**
   * Per-route opt-in for staff tenant access. When false (default) the route grants
   * ZERO tenant access (fail-closed) — and since FOLLOW-1335 staff is the only path.
   */
  allowStaffOverride?: boolean;
}

/**
 * Validate a staff-supplied tenant id against the `tenants` table.
 *
 * A staff-supplied id is attacker-influenced input (ADR-0018 §2 invariant 3), so it
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
 * Resolve an Estalara STAFF caller's access to an explicit tenant (ADR-0018 §2, superadmin
 * access; staff-only since FOLLOW-1335).
 *
 * Security invariants (numbering kept from ADR-0018 §2; 1 and 2 governed the removed
 * agency path):
 *
 *  3. **Staff path requires verified `estalara_staff` AND explicit opt-in.** Only
 *     when `opts.allowStaffOverride === true` and {@link verifyTracerAdminAuth}
 *     (the shared, composed staff gate — constant-time `ADMIN_API_SECRET`, staff
 *     SSR session, or staff JWT) verifies.
 *  4. **The staff `tenantId` is validated against the `tenants` table** (existence
 *     + not soft-deleted) before it is returned; an unknown id is 404.
 *  5. **The returned staff `tenantId` is the ONLY tenant fence** — staff queries
 *     run under `createAdminClient` (RLS bypassed), so the caller MUST apply
 *     `WHERE tenant_id = access.tenantId`. See the `TenantAccess.tenantId`
 *     doc-comment (RLS TRAP).
 *
 * Note (deliberate narrowing vs the tracer): the headless `ADMIN_API_SECRET`
 * Bearer path — valid for read-only tracer routes — is REJECTED here, because a
 * tenant-scoped staff action must be attributable to a staff user
 * (`staff_audit_log.adminUserId = staff.sub`, ADR-0018 §3) and the shared secret
 * carries no user identity. Staff must act via an identified SSR session or JWT.
 *
 * A caller that is not staff (no session, an expired one, or a former agency
 * account) is 401; a staff caller on a route that did not opt in is 403.
 *
 * @throws {AccessError} with `.status` on any failure (400/401/403/404/500).
 */
export async function resolveTenantAccess(
  req: NextRequest,
  opts?: ResolveTenantAccessOpts,
): Promise<TenantAccess> {
  const allowStaffOverride = opts?.allowStaffOverride ?? false;

  // The caller's verified staff claims (legacy Bearer/cookie first, then SSR).
  const claims = await getSessionAuthClaims(req);

  // ── STAFF PATH — only when the route opts in (fail-closed by default). ───────
  if (allowStaffOverride) {
    // Compose the shared staff gate — we do NOT reimplement staff verification.
    const staffAuth = await verifyTracerAdminAuth(req);
    if (staffAuth.ok) {
      // Resolve the staff IDENTITY (sub + role) for write-tiering and audit
      // attribution. The headless ADMIN_API_SECRET path carries no identity, so a
      // tenant-scoped action cannot be attributed to a staff actor → reject.
      const staffClaims: StaffClaims | null =
        claims ?? (staffAuth.claims && isStaffClaims(staffAuth.claims) ? staffAuth.claims : null);
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
        ...staffRoleTier(role),
      };
    }
  }

  // No access. 401 when no staff caller was found; 403 when a staff caller is on a
  // route that does not opt in.
  throw new AccessError(claims ? 403 : 401, 'Unauthorized: no tenant access for this request');
}
