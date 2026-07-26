/**
 * Unit tests for the per-tenant brand identity resolver (FOLLOW-654).
 *
 * @module apps/control-plane/src/lib/brand-identity.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isFirstPartyTenant,
  isUnprovisionedExternalBrand,
  resolveBrandIdentity,
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
    vi.stubEnv('FIRST_PARTY_TENANT_ID', 'estalara-tenant-uuid');
    expect(isFirstPartyTenant('estalara-tenant-uuid')).toBe(true);
    expect(isFirstPartyTenant('external-brand-uuid')).toBe(false);
  });
});
