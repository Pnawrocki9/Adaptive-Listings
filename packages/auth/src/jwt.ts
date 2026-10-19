/**
 * JWT claim extraction and RBAC guards.
 *
 * Supabase Auth embeds custom claims in the JWT via a Postgres function hook
 * (see supabase-hook.sql). This module provides type-safe extractors and RBAC
 * guards for those claims.
 *
 * JWT structure (Supabase custom claims added by custom_access_token_hook):
 *   {
 *     sub: string,                    // user UUID (Supabase auth.users.id)
 *     email: string,
 *     estalara_staff?: boolean,       // true for Estalara employees
 *     estalara_role?: EstalaraRole,   // staff only
 *     tenant_id?: null,               // staff carry no tenant affiliation
 *     mfa_verified?: boolean,         // whether MFA was completed this session
 *   }
 *
 * FOLLOW-1335 (ESC-085, decision D-B): Adaptive Listings is single-tenant with one staff
 * backoffice, so the only claim shape is Estalara STAFF (ranks readonly < ops < superadmin).
 * The agency (tenant-user) shape — a `tenant_id` plus an agency role — and its type, type
 * guard and role guard are removed: `extractClaims` rejects any non-staff payload, so
 * `getAuthClaims` returns `null` for it. A token the hook still mints with agency claims
 * (for a user whose metadata carries them) therefore authenticates nobody.
 *
 * @module @estalara/auth/jwt
 */

/** Estalara staff role. Hierarchy: superadmin > ops > readonly. */
export type EstalaraRole = 'estalara:superadmin' | 'estalara:ops' | 'estalara:readonly';

/** JWT claims for an Estalara staff member (no tenant affiliation). */
export interface StaffClaims {
  sub: string;
  email: string;
  tenant_id: null;
  estalara_staff: true;
  estalara_role: EstalaraRole;
  mfa_verified: boolean;
}

/** Every valid claim shape — only Estalara staff since FOLLOW-1335. */
export type AuthClaims = StaffClaims;

// ─── Role hierarchy map ────────────────────────────────────────────────────

const STAFF_ROLE_RANK: Record<EstalaraRole, number> = {
  'estalara:superadmin': 3,
  'estalara:ops': 2,
  'estalara:readonly': 1,
};

// ─── Type guards ───────────────────────────────────────────────────────────

/**
 * Returns true if claims belong to an Estalara staff member. Every verified claim set is
 * staff since FOLLOW-1335; the guard stays as the runtime check for claims that reach a
 * caller through an untyped path (mocks, reconstructed session metadata).
 */
export function isStaffClaims(claims: AuthClaims): claims is StaffClaims {
  return claims.estalara_staff;
}

// ─── Claim extraction ──────────────────────────────────────────────────────

/**
 * Parse a raw (already-verified) Supabase JWT payload into typed {@link AuthClaims}.
 *
 * The JWT signature is verified by Supabase before it reaches application code.
 * This function only handles structural extraction and validation.
 *
 * @throws {Error} if the payload is structurally invalid, missing required fields, or not an
 *   Estalara staff token (FOLLOW-1335 — there is no other caller identity)
 */
export function extractClaims(jwtPayload: Record<string, unknown>): AuthClaims {
  const sub = jwtPayload.sub;
  const email = jwtPayload.email;
  const estalaraStaff = jwtPayload.estalara_staff;
  const mfaVerified = jwtPayload.mfa_verified ?? false;

  if (typeof sub !== 'string' || sub.length === 0) {
    throw new Error('JWT missing required field: sub');
  }
  if (typeof email !== 'string' || email.length === 0) {
    throw new Error('JWT missing required field: email');
  }
  if (estalaraStaff !== true) {
    throw new Error('JWT is not an Estalara staff token (estalara_staff is not true)');
  }

  const estalaraRole = jwtPayload.estalara_role;
  if (!isEstalaraRole(estalaraRole)) {
    throw new Error(`JWT has invalid estalara_role: ${String(estalaraRole)}`);
  }
  return {
    sub,
    email,
    tenant_id: null,
    estalara_staff: true,
    estalara_role: estalaraRole,
    mfa_verified: mfaVerified === true,
  };
}

// ─── RBAC guard ───────────────────────────────────────────────────────────

/**
 * Assert that the caller is Estalara staff with at least the given role.
 *
 * Role hierarchy (high → low): superadmin > ops > readonly.
 *
 * @throws {Error} if claims are not staff claims, or role is insufficient
 */
export function requireStaffRole(claims: AuthClaims, minimum: EstalaraRole): void {
  if (!isStaffClaims(claims)) {
    throw new Error('Access denied: Estalara staff access required');
  }
  const actual = STAFF_ROLE_RANK[claims.estalara_role];
  const required = STAFF_ROLE_RANK[minimum];
  if (actual < required) {
    throw new Error(
      `Access denied: role '${claims.estalara_role}' is insufficient — '${minimum}' or higher required`,
    );
  }
}

// ─── Internal validators ───────────────────────────────────────────────────

function isEstalaraRole(value: unknown): value is EstalaraRole {
  return (
    value === 'estalara:superadmin' || value === 'estalara:ops' || value === 'estalara:readonly'
  );
}
