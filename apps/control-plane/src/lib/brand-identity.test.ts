/**
 * Unit tests for the per-tenant brand identity resolver (FOLLOW-654).
 *
 * @module apps/control-plane/src/lib/brand-identity.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ESTALARA_BRAND_NAME,
  ESTALARA_LEGAL_ENTITY,
  isFirstPartyTenant,
  resolveBrandIdentity,
} from './brand-identity';

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
