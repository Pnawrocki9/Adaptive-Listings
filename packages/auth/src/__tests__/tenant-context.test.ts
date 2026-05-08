import { describe, expect, it } from 'vitest';

import {
  createTenantContext,
  getTenantContext,
  getTenantContextOrNull,
  tenantContextStorage,
  type TenantContext,
} from '../tenant-context.js';
import type { TenantClaims } from '../jwt.js';

const validClaims: TenantClaims = {
  sub: 'user-uuid-001',
  email: 'owner@acme.com',
  tenant_id: 'tenant-uuid-001',
  agency_role: 'agency:owner',
  estalara_staff: false,
  mfa_verified: true,
};

describe('createTenantContext', () => {
  it('happy path — returns correct TenantContext shape', () => {
    const ctx = createTenantContext(validClaims, 'req-123');
    expect(ctx).toEqual({
      tenant_id: 'tenant-uuid-001',
      agency_role: 'agency:owner',
      user_id: 'user-uuid-001',
      request_id: 'req-123',
    });
  });

  it('throws when tenant_id is empty string', () => {
    const claims: TenantClaims = { ...validClaims, tenant_id: '' };
    expect(() => createTenantContext(claims, 'req-123')).toThrow('tenant_id');
  });
});

describe('getTenantContextOrNull', () => {
  it('returns null when called outside AsyncLocalStorage', () => {
    // No tenantContextStorage.run() wrapping this test → null
    expect(getTenantContextOrNull()).toBeNull();
  });
});

describe('getTenantContext', () => {
  it('throws when called outside AsyncLocalStorage', () => {
    expect(() => getTenantContext()).toThrow('No tenant context in scope');
  });
});

describe('AsyncLocalStorage — tenantContextStorage.run()', () => {
  it('getTenantContext() returns the correct context inside run()', () => {
    const ctx = createTenantContext(validClaims, 'req-456');
    let capturedCtx;
    tenantContextStorage.run(ctx, () => {
      capturedCtx = getTenantContext();
    });
    expect(capturedCtx).toEqual(ctx);
    expect(capturedCtx).toMatchObject({
      tenant_id: 'tenant-uuid-001',
      user_id: 'user-uuid-001',
      agency_role: 'agency:owner',
      request_id: 'req-456',
    });
  });

  it('getTenantContextOrNull() returns context inside run() and null outside', () => {
    const ctx = createTenantContext(validClaims, 'req-789');
    // Use a ref object to hold the captured value — avoids TypeScript closure narrowing
    // the variable type to `never` when accessed after the run() callback.
    const ref: { value: TenantContext | null } = { value: null };
    tenantContextStorage.run(ctx, () => {
      ref.value = getTenantContextOrNull();
    });
    expect(ref.value).not.toBeNull();
    expect(ref.value?.tenant_id).toBe('tenant-uuid-001');
    // Outside the run block → back to null
    expect(getTenantContextOrNull()).toBeNull();
  });
});
