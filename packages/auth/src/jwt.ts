/**
 * JWT claim extraction and tenant context helpers.
 *
 * Supabase Auth embeds custom claims in the JWT via a Postgres function hook
 * (see supabase-hook.sql). This module provides type-safe extractors and RBAC
 * guards for those claims.
 *
 * JWT structure (Supabase custom claims added by custom_access_token_hook):
 *   {
 *     sub: string,                    // user UUID (Supabase auth.users.id)
 *     email: string,
 *     tenant_id?: string,             // UUID — agency users only
 *     agency_role?: AgencyRole,       // agency users only
 *     estalara_staff?: boolean,       // true for Estalara employees
 *     estalara_role?: EstalaraRole,   // staff only
 *     mfa_verified?: boolean,         // whether MFA was completed this session
 *   }
 *
 * @module @estalara/auth/jwt
 */

/** Agency user role within a tenant. Hierarchy: owner > admin > viewer. */
export type AgencyRole = 'agency:owner' | 'agency:admin' | 'agency:viewer';

/** Estalara staff role. Hierarchy: superadmin > ops > readonly. */
export type EstalaraRole = 'estalara:superadmin' | 'estalara:ops' | 'estalara:readonly';

/** JWT claims for an agency user (belongs to a specific tenant). */
export interface TenantClaims {
  sub: string;
  email: string;
  tenant_id: string;
  agency_role: AgencyRole;
  estalara_staff: false;
  mfa_verified: boolean;
}

/** JWT claims for an Estalara staff member (no tenant affiliation). */
export interface StaffClaims {
  sub: string;
  email: string;
  tenant_id: null;
  estalara_staff: true;
  estalara_role: EstalaraRole;
  mfa_verified: boolean;
}

/** Discriminated union of all valid claim shapes. */
export type AuthClaims = TenantClaims | StaffClaims;

// ─── Role hierarchy maps ───────────────────────────────────────────────────

const AGENCY_ROLE_RANK: Record<AgencyRole, number> = {
  'agency:owner': 3,
  'agency:admin': 2,
  'agency:viewer': 1,
};

const STAFF_ROLE_RANK: Record<EstalaraRole, number> = {
  'estalara:superadmin': 3,
  'estalara:ops': 2,
  'estalara:readonly': 1,
};

// ─── Type guards ───────────────────────────────────────────────────────────

/** Returns true if claims belong to an agency user (has tenant_id, not staff). */
export function isTenantClaims(claims: AuthClaims): claims is TenantClaims {
  return !claims.estalara_staff && typeof claims.tenant_id === 'string';
}

/** Returns true if claims belong to an Estalara staff member. */
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
 * @throws {Error} if the payload is structurally invalid or missing required fields
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

  // Staff path
  if (estalaraStaff === true) {
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

  // Agency user path
  const tenantId = jwtPayload.tenant_id;
  const agencyRole = jwtPayload.agency_role;

  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    throw new Error('JWT missing required field: tenant_id (required for non-staff users)');
  }
  if (!isAgencyRole(agencyRole)) {
    throw new Error(`JWT has invalid agency_role: ${String(agencyRole)}`);
  }

  return {
    sub,
    email,
    tenant_id: tenantId,
    agency_role: agencyRole,
    estalara_staff: false,
    mfa_verified: mfaVerified === true,
  };
}

// ─── RBAC guards ──────────────────────────────────────────────────────────

/**
 * Assert that the caller is an agency user with at least the given role.
 *
 * Role hierarchy (high → low): owner > admin > viewer.
 *
 * @throws {Error} if claims are not agency claims, or role is insufficient
 */
export function requireAgencyRole(claims: AuthClaims, minimum: AgencyRole): void {
  if (!isTenantClaims(claims)) {
    throw new Error('Access denied: Estalara staff cannot access tenant resources via this guard');
  }
  const actual = AGENCY_ROLE_RANK[claims.agency_role];
  const required = AGENCY_ROLE_RANK[minimum];
  if (actual < required) {
    throw new Error(
      `Access denied: role '${claims.agency_role}' is insufficient — '${minimum}' or higher required`,
    );
  }
}

/**
 * Assert that the caller is Estalara staff with at least the given role.
 *
 * Role hierarchy (high → low): superadmin > ops > readonly.
 *
 * @throws {Error} if claims are not staff claims, or role is insufficient
 */
export function requireStaffRole(claims: AuthClaims, minimum: EstalaraRole): void {
  if (!isStaffClaims(claims)) {
    throw new Error('Access denied: agency users cannot access staff resources');
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

function isAgencyRole(value: unknown): value is AgencyRole {
  return value === 'agency:owner' || value === 'agency:admin' || value === 'agency:viewer';
}

function isEstalaraRole(value: unknown): value is EstalaraRole {
  return (
    value === 'estalara:superadmin' || value === 'estalara:ops' || value === 'estalara:readonly'
  );
}
