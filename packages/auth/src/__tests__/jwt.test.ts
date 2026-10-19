import { describe, expect, it } from 'vitest';

import { extractClaims, isStaffClaims, requireStaffRole } from '../jwt.js';
import type { AuthClaims } from '../jwt.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

/** The tenant-user payload the hook minted for agency users before FOLLOW-1335. */
const formerAgencyPayload = {
  sub: 'user-uuid-001',
  email: 'owner@acme.com',
  tenant_id: 'tenant-uuid-001',
  agency_role: 'agency:owner',
  estalara_staff: false,
  mfa_verified: true,
};

const staffPayload = {
  sub: 'staff-uuid-001',
  email: 'staff@estalara.com',
  estalara_staff: true,
  estalara_role: 'estalara:superadmin',
  mfa_verified: true,
};

// ─── extractClaims ────────────────────────────────────────────────────────────

describe('extractClaims', () => {
  it('valid staff JWT payload → returns StaffClaims', () => {
    const claims = extractClaims(staffPayload);
    expect(isStaffClaims(claims)).toBe(true);
    expect(claims.sub).toBe('staff-uuid-001');
    expect(claims.estalara_staff).toBe(true);
    expect(claims.estalara_role).toBe('estalara:superadmin');
    expect(claims.tenant_id).toBeNull();
  });

  it('FOLLOW-1335: a former agency payload (tenant_id + agency role, not staff) → throws', () => {
    expect(() => extractClaims(formerAgencyPayload)).toThrow('not an Estalara staff token');
  });

  it('a payload without estalara_staff → throws (no implicit tenant-user path)', () => {
    expect(() => extractClaims({ sub: 'u', email: 'a@b.com', tenant_id: 't' })).toThrow(
      'not an Estalara staff token',
    );
  });

  it('estalara_staff must be the boolean true, not a truthy string', () => {
    expect(() => extractClaims({ ...staffPayload, estalara_staff: 'true' })).toThrow(
      'not an Estalara staff token',
    );
  });

  it('missing sub → throws', () => {
    expect(() =>
      extractClaims({ email: 'a@b.com', estalara_staff: true, estalara_role: 'estalara:ops' }),
    ).toThrow('sub');
  });

  it('missing email → throws', () => {
    expect(() =>
      extractClaims({ sub: 'u', estalara_staff: true, estalara_role: 'estalara:ops' }),
    ).toThrow('email');
  });

  it('staff payload with invalid estalara_role → throws', () => {
    expect(() =>
      extractClaims({
        sub: 'u',
        email: 'a@b.com',
        estalara_staff: true,
        estalara_role: 'bad:role',
      }),
    ).toThrow('estalara_role');
  });

  it('mfa_verified defaults to false when absent', () => {
    const claims = extractClaims({
      sub: 'u',
      email: 'a@b.com',
      estalara_staff: true,
      estalara_role: 'estalara:readonly',
    });
    expect(claims.mfa_verified).toBe(false);
  });

  it('a staff payload carrying a stray tenant_id still yields tenant_id null', () => {
    const claims = extractClaims({ ...staffPayload, tenant_id: 'tenant-uuid-001' });
    expect(claims.tenant_id).toBeNull();
  });
});

// ─── Type guard ──────────────────────────────────────────────────────────────

describe('isStaffClaims type guard', () => {
  it('returns true for staff claims', () => {
    expect(isStaffClaims(extractClaims(staffPayload))).toBe(true);
  });

  it('returns false for a non-staff object reaching it through an untyped path', () => {
    expect(isStaffClaims(formerAgencyPayload as unknown as AuthClaims)).toBe(false);
  });
});

// ─── requireStaffRole ─────────────────────────────────────────────────────────

describe('requireStaffRole', () => {
  const superadminClaims = extractClaims({ ...staffPayload, estalara_role: 'estalara:superadmin' });
  const opsClaims = extractClaims({ ...staffPayload, estalara_role: 'estalara:ops' });
  const readonlyClaims = extractClaims({ ...staffPayload, estalara_role: 'estalara:readonly' });

  it('superadmin passes superadmin check', () => {
    expect(() => {
      requireStaffRole(superadminClaims, 'estalara:superadmin');
    }).not.toThrow();
  });

  it('superadmin passes ops check', () => {
    expect(() => {
      requireStaffRole(superadminClaims, 'estalara:ops');
    }).not.toThrow();
  });

  it('superadmin passes readonly check', () => {
    expect(() => {
      requireStaffRole(superadminClaims, 'estalara:readonly');
    }).not.toThrow();
  });

  it('ops passes ops check', () => {
    expect(() => {
      requireStaffRole(opsClaims, 'estalara:ops');
    }).not.toThrow();
  });

  it('ops passes readonly check', () => {
    expect(() => {
      requireStaffRole(opsClaims, 'estalara:readonly');
    }).not.toThrow();
  });

  it('readonly fails ops check → throws', () => {
    expect(() => {
      requireStaffRole(readonlyClaims, 'estalara:ops');
    }).toThrow('insufficient');
  });

  it('readonly fails superadmin check → throws', () => {
    expect(() => {
      requireStaffRole(readonlyClaims, 'estalara:superadmin');
    }).toThrow('insufficient');
  });

  it('ops fails superadmin check → throws', () => {
    expect(() => {
      requireStaffRole(opsClaims, 'estalara:superadmin');
    }).toThrow('insufficient');
  });

  it('a non-staff object (untyped path) throws with the staff guard', () => {
    expect(() => {
      requireStaffRole(formerAgencyPayload as unknown as AuthClaims, 'estalara:readonly');
    }).toThrow('Estalara staff access required');
  });
});
