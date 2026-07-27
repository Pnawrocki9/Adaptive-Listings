/**
 * Unit tests for the per-tenant brand identity resolver (FOLLOW-654).
 *
 * @module apps/control-plane/src/lib/brand-identity.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

// [FOLLOW-678 AC 2] brand-identity.ts warns via Sentry once per instance when
// FIRST_PARTY_TENANT_ID is present but malformed — mocked so the assertion below doesn't depend
// on a real Sentry init.
const { mockCaptureMessage } = vi.hoisted(() => ({ mockCaptureMessage: vi.fn() }));
vi.mock('@sentry/nextjs', () => ({ captureMessage: mockCaptureMessage }));

import {
  isFirstPartyTenant,
  isUnprovisionedExternalBrand,
  resolveBrandIdentity,
  resolveFirstPartyTenantId,
} from './brand-identity';
import type { createAdminClient } from '@estalara/db';

// The first-party fallback identity (kept module-private in brand-identity.ts;
// asserted here as literals so the constants need no test-only export).
const ESTALARA_BRAND_NAME = 'Estalara';
const ESTALARA_LEGAL_ENTITY = 'Time2Show, Inc.';

describe('resolveBrandIdentity', () => {
  it('resolves a fully-configured brand identity', () => {
    const id = resolveBrandIdentity({
      brand_name: 'Costa Sol Properties',
      legal_entity: 'Costa Sol S.L.',
    });
    expect(id).toEqual({
      brandName: 'Costa Sol Properties',
      legalEntity: 'Costa Sol S.L.',
      isFallbackIdentity: false,
    });
  });

  it('falls back to Estalara identity when brand_name is absent (never empty)', () => {
    const id = resolveBrandIdentity({ primary_color: '#1a73e8' });
    expect(id.brandName).toBe(ESTALARA_BRAND_NAME);
    expect(id.legalEntity).toBe(ESTALARA_LEGAL_ENTITY);
    expect(id.isFallbackIdentity).toBe(true);
  });

  it('falls back for null / non-object / malformed blobs', () => {
    for (const raw of [null, undefined, 'str', 42, [], { brand_name: '   ' }]) {
      const id = resolveBrandIdentity(raw);
      expect(id.brandName).toBe(ESTALARA_BRAND_NAME);
      expect(id.brandName).not.toBe('');
    }
  });

  it('falls back per-field: brand_name set but legal_entity absent', () => {
    const id = resolveBrandIdentity({ brand_name: 'Marbella Premium' });
    expect(id.brandName).toBe('Marbella Premium');
    expect(id.legalEntity).toBe(ESTALARA_LEGAL_ENTITY);
  });

  it('trims surrounding whitespace on configured values', () => {
    const id = resolveBrandIdentity({ brand_name: '  Marbella Premium  ' });
    expect(id.brandName).toBe('Marbella Premium');
  });

  it('FOLLOW-659: an explicit null on ONE key does not discard the OTHER key', () => {
    // Regression guard for `.optional()` vs `.nullish()`: with `.optional()` the whole
    // object parse fails on a null, silently resolving a correctly-set brand_name to
    // the Estalara fallback.
    const id = resolveBrandIdentity({ brand_name: 'Costa Sol Properties', legal_entity: null });
    expect(id.brandName).toBe('Costa Sol Properties');
    expect(id.legalEntity).toBe(ESTALARA_LEGAL_ENTITY);
    expect(id.isFallbackIdentity).toBe(false);
  });
});

// ─── FOLLOW-659: un-provisioned external brand alarm ──────────────────────────

describe('isUnprovisionedExternalBrand', () => {
  const TENANT = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  const OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

  /**
   * Minimal Drizzle stub for `db.select({...}).from(tenants).limit(2)`. The `select`
   * spy is returned alongside the client so a test can assert the probe never ran.
   */
  function dbWithTenantCount(count: number | Error): {
    db: ReturnType<typeof createAdminClient>;
    select: ReturnType<typeof vi.fn>;
  } {
    const limit = vi.fn(() =>
      count instanceof Error
        ? Promise.reject(count)
        : Promise.resolve(Array.from({ length: count }, (_, i) => ({ id: `t-${String(i)}` }))),
    );
    const select = vi.fn(() => ({ from: vi.fn(() => ({ limit })) }));
    return { db: { select } as unknown as ReturnType<typeof createAdminClient>, select };
  }

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('false for a tenant WITH a configured identity — and runs no query at all', async () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', OTHER);
    const { db, select } = dbWithTenantCount(2);
    const identity = resolveBrandIdentity({ brand_name: 'Costa Sol Properties' });

    expect(await isUnprovisionedExternalBrand(db, TENANT, identity)).toBe(false);
    expect(select).not.toHaveBeenCalled();
  });

  it('false for THE first-party tenant on the fallback identity (Estalara is correct for it)', async () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', TENANT);
    const identity = resolveBrandIdentity({});

    expect(await isUnprovisionedExternalBrand(dbWithTenantCount(2).db, TENANT, identity)).toBe(
      false,
    );
  });

  it('true for a non-first-party tenant on the fallback identity', async () => {
    vi.stubEnv('FIRST_PARTY_TENANT_ID', OTHER);
    const identity = resolveBrandIdentity({});

    expect(await isUnprovisionedExternalBrand(dbWithTenantCount(2).db, TENANT, identity)).toBe(
      true,
    );
  });

  it('env UNSET + exactly one tenant → false (today live state, byte-identical)', async () => {
    const identity = resolveBrandIdentity({});

    expect(await isUnprovisionedExternalBrand(dbWithTenantCount(1).db, TENANT, identity)).toBe(
      false,
    );
  });

  it('env UNSET + a second tenant → true (a forgotten env cannot mask the gap)', async () => {
    const identity = resolveBrandIdentity({});

    expect(await isUnprovisionedExternalBrand(dbWithTenantCount(2).db, TENANT, identity)).toBe(
      true,
    );
  });

  it('fails CLOSED on a tenant-count read error', async () => {
    const identity = resolveBrandIdentity({});

    expect(
      await isUnprovisionedExternalBrand(
        dbWithTenantCount(new Error('ECONNREFUSED')).db,
        TENANT,
        identity,
      ),
    ).toBe(true);
  });
});

describe('isFirstPartyTenant', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('treats every tenant as first-party when FIRST_PARTY_TENANT_ID is unset', () => {
    expect(isFirstPartyTenant('any-tenant-uuid')).toBe(true);
  });

  it('treats only the matching tenant as first-party when the env is set', () => {
    const ESTALARA = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
    const EXTERNAL = 'b2c3d4e5-f6a7-4901-bcde-f12345678901';
    vi.stubEnv('FIRST_PARTY_TENANT_ID', ESTALARA);
    expect(isFirstPartyTenant(ESTALARA)).toBe(true);
    expect(isFirstPartyTenant(EXTERNAL)).toBe(false);
  });
});

// ─── FOLLOW-678: canonicalization + malformed-value handling ──────────────────

describe('resolveFirstPartyTenantId', () => {
  it('unset for undefined, empty, and whitespace-only', () => {
    expect(resolveFirstPartyTenantId(undefined)).toEqual({ status: 'unset' });
    expect(resolveFirstPartyTenantId('')).toEqual({ status: 'unset' });
    expect(resolveFirstPartyTenantId('   ')).toEqual({ status: 'unset' });
  });

  it('valid: trims and lower-cases a well-formed UUID', () => {
    expect(resolveFirstPartyTenantId(' A1B2C3D4-E5F6-4890-ABCD-EF1234567890 ')).toEqual({
      status: 'valid',
      value: 'a1b2c3d4-e5f6-4890-abcd-ef1234567890',
    });
  });

  it('malformed: present but not a well-formed UUID', () => {
    expect(resolveFirstPartyTenantId('not-a-real-uuid')).toEqual({
      status: 'malformed',
      raw: 'not-a-real-uuid',
    });
  });
});

describe('isFirstPartyTenant — case-fold + malformed-env handling (FOLLOW-678)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('matches case-insensitively: upper-case env vs lower-case tenant id', () => {
    const TENANT = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
    vi.stubEnv('FIRST_PARTY_TENANT_ID', TENANT.toUpperCase());
    expect(isFirstPartyTenant(TENANT)).toBe(true);
  });

  it('matches case-insensitively: lower-case env vs upper-case tenant id', () => {
    const TENANT = 'a1b2c3d4-e5f6-4890-abcd-ef1234567890';
    vi.stubEnv('FIRST_PARTY_TENANT_ID', TENANT);
    expect(isFirstPartyTenant(TENANT.toUpperCase())).toBe(true);
  });

  it(
    'a malformed env degrades to the UNSET behavior (every tenant first-party) — would FAIL ' +
      'under the pre-fix exact-string-compare defect, which instead denies every tenant',
    () => {
      mockCaptureMessage.mockClear();
      vi.stubEnv('FIRST_PARTY_TENANT_ID', 'not-a-real-uuid');
      expect(isFirstPartyTenant('any-tenant-uuid')).toBe(true);
      expect(isFirstPartyTenant('a1b2c3d4-e5f6-4890-abcd-ef1234567890')).toBe(true);
      // [AC 2] warned via Sentry that the env is malformed, so the bad value is visible
      // without requiring a request to fail.
      expect(mockCaptureMessage).toHaveBeenCalledWith(
        'first_party_tenant_id_malformed',
        expect.objectContaining({ level: 'warning' }),
      );
    },
  );
});
