/**
 * Estalara staff role rank — the ONE control-plane copy of the ADR-0018 §4 rank
 * table, shared by `lib/session-auth.ts` (`resolveTenantAccess`) and
 * `lib/tracer-auth.ts` (`verifyTracerAdminAuth`).
 *
 * It lives in its own dependency-free module because `session-auth.ts` imports
 * `tracer-auth.ts`; putting the table in either of them would force an import
 * cycle or a second copy (FOLLOW-1321). It is pure (type-only imports), so a
 * `'use client'` page may import it too.
 *
 * Other copies that predate this module and are NOT importable from here:
 * `apps/control-plane/src/middleware.ts` (edge middleware, own copy) and
 * `packages/auth/src/jwt.ts` (module-private, behind `requireStaffRole`).
 *
 * @module apps/control-plane/src/lib/staff-rank
 */

import type { EstalaraRole } from '@estalara/auth';

/** Higher = more privileged. superadmin(3) > ops(2) > readonly(1). */
const STAFF_ROLE_RANK: Record<EstalaraRole, number> = {
  'estalara:superadmin': 3,
  'estalara:ops': 2,
  'estalara:readonly': 1,
};

/** Minimum staff rank that may WRITE (CEO Q3, 2026-07-20): `estalara:ops`+. */
const STAFF_WRITE_MIN_RANK = STAFF_ROLE_RANK['estalara:ops']; // 2

/** Rank that gates the highest-risk staff writes (bandit weights, global generation_model). */
const STAFF_SUPERADMIN_RANK = STAFF_ROLE_RANK['estalara:superadmin']; // 3

/** Runtime guard for an `estalara_role` claim read from untyped `app_metadata`. */
export function isEstalaraRole(v: unknown): v is EstalaraRole {
  return v === 'estalara:superadmin' || v === 'estalara:ops' || v === 'estalara:readonly';
}

/**
 * Derive the write tier of a staff role. A `null` role (staff session whose
 * `app_metadata.estalara_role` is missing or malformed) is view-only: fail closed.
 */
export function staffRoleTier(role: EstalaraRole | null): {
  canWrite: boolean;
  isSuperadmin: boolean;
} {
  const rank = role === null ? 0 : STAFF_ROLE_RANK[role];
  return { canWrite: rank >= STAFF_WRITE_MIN_RANK, isSuperadmin: rank >= STAFF_SUPERADMIN_RANK };
}

/**
 * Response header on `GET /api/admin/intent/config` carrying the server's verdict
 * on whether the caller may write (`'true'`/`'false'`). The Weight Editor page
 * reads it to render read-only for `estalara:readonly` staff and for the
 * `ADMIN_API_SECRET` path; the POST/PUT handlers enforce the same rule server-side.
 */
export const STAFF_CAN_WRITE_HEADER = 'x-estalara-staff-can-write';
