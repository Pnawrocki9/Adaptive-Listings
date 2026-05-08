import { describe, expect, it } from 'vitest';

import {
  extractClaims,
  isStaffClaims,
  isTenantClaims,
  requireAgencyRole,
  requireStaffRole,
} from '../jwt.js';

// ─── Fixtures ────────────────────────────────────────────────────────────────

const agencyPayload = {
  sub: 'user-uuid-001',
  email: 'owner@acme.com',
  tenant_id: 'tenant-uuid-001',
  agency_role: 'agency:owner',
  estalara_staff: false,
  mfa_verified: true,
};

const staffPayload = {
  sub: 'staff-uuid-001',
  email: 'staff@estalara.io',
  estalara_staff: true,
  estalara_role: 'estalara:superadmin',
  mfa_verified: true,
};

// ─── extractClaims ────────────────────────────────────────────────────────────

describe('extractClaims', () => {
  it('valid agency JWT payload → returns TenantClaims', () => {
    const claims = extractClaims(agencyPayload);
    expect(isTenantClaims(claims)).toBe(true);
    expect(claims.sub).toBe('user-uuid-001');
    expect(claims.email).toBe('owner@acme.com');
    if (isTenantClaims(claims)) {
      expect(claims.tenant_id).toBe('tenant-uuid-001');
      expect(claims.agency_role).toBe('agency:owner');
      expect(claims.estalara_staff).toBe(false);
    }
  });

  it('valid staff JWT payload → returns StaffClaims', () => {
    const claims = extractClaims(staffPayload);
    expect(isStaffClaims(claims)).toBe(true);
    expect(claims.sub).toBe('staff-uuid-001');
    if (isStaffClaims(claims)) {
      expect(claims.estalara_staff).toBe(true);
      expect(claims.estalara_role).toBe('estalara:superadmin');
      expect(claims.tenant_id).toBeNull();
    }
  });

  it('non-staff payload missing tenant_id → throws', () => {
    expect(() => extractClaims({ sub: 'u', email: 'a@b.com', estalara_staff: false })).toThrow(
      'tenant_id',
    );
  });

  it('missing sub → throws', () => {
    expect(() =>
      extractClaims({ email: 'a@b.com', tenant_id: 't', agency_role: 'agency:admin' }),
    ).toThrow('sub');
  });

  it('missing email → throws', () => {
    expect(() =>
      extractClaims({
        sub: 'u',
        tenant_id: 't',
        agency_role: 'agency:viewer',
        estalara_staff: false,
      }),
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
      tenant_id: 't',
      agency_role: 'agency:viewer',
      estalara_staff: false,
    });
    expect(claims.mfa_verified).toBe(false);
  });
});

// ─── Type guards ─────────────────────────────────────────────────────────────

describe('isTenantClaims / isStaffClaims type guards', () => {
  it('isTenantClaims returns true for agency claims', () => {
    const claims = extractClaims(agencyPayload);
    expect(isTenantClaims(claims)).toBe(true);
    expect(isStaffClaims(claims)).toBe(false);
  });

  it('isStaffClaims returns true for staff claims', () => {
    const claims = extractClaims(staffPayload);
    expect(isStaffClaims(claims)).toBe(true);
    expect(isTenantClaims(claims)).toBe(false);
  });
});

// ─── requireAgencyRole ────────────────────────────────────────────────────────

describe('requireAgencyRole', () => {
  const ownerClaims = extractClaims({ ...agencyPayload, agency_role: 'agency:owner' });
  const adminClaims = extractClaims({ ...agencyPayload, agency_role: 'agency:admin' });
  const viewerClaims = extractClaims({ ...agencyPayload, agency_role: 'agency:viewer' });
  const staffClaims = extractClaims(staffPayload);

  it('owner passes owner check', () => {
    expect(() => {
      requireAgencyRole(ownerClaims, 'agency:owner');
    }).not.toThrow();
  });

  it('owner passes admin check (higher rank satisfies lower requirement)', () => {
    expect(() => {
      requireAgencyRole(ownerClaims, 'agency:admin');
    }).not.toThrow();
  });

  it('owner passes viewer check', () => {
    expect(() => {
      requireAgencyRole(ownerClaims, 'agency:viewer');
    }).not.toThrow();
  });

  it('admin passes admin check', () => {
    expect(() => {
      requireAgencyRole(adminClaims, 'agency:admin');
    }).not.toThrow();
  });

  it('admin passes viewer check', () => {
    expect(() => {
      requireAgencyRole(adminClaims, 'agency:viewer');
    }).not.toThrow();
  });

  it('viewer fails admin check → throws', () => {
    expect(() => {
      requireAgencyRole(viewerClaims, 'agency:admin');
    }).toThrow('insufficient');
  });

  it('viewer fails owner check → throws', () => {
    expect(() => {
      requireAgencyRole(viewerClaims, 'agency:owner');
    }).toThrow('insufficient');
  });

  it('admin fails owner check → throws', () => {
    expect(() => {
      requireAgencyRole(adminClaims, 'agency:owner');
    }).toThrow('insufficient');
  });

  it('staff claims throw with agency guard (not a tenant user)', () => {
    expect(() => {
      requireAgencyRole(staffClaims, 'agency:viewer');
    }).toThrow('Estalara staff');
  });
});

// ─── requireStaffRole ─────────────────────────────────────────────────────────

describe('requireStaffRole', () => {
  const superadminClaims = extractClaims({ ...staffPayload, estalara_role: 'estalara:superadmin' });
  const opsClaims = extractClaims({ ...staffPayload, estalara_role: 'estalara:ops' });
  const readonlyClaims = extractClaims({ ...staffPayload, estalara_role: 'estalara:readonly' });
  const agencyClaims = extractClaims(agencyPayload);

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

  it('agency claims throw with staff guard (not Estalara staff)', () => {
    expect(() => {
      requireStaffRole(agencyClaims, 'estalara:readonly');
    }).toThrow('agency users');
  });
});
