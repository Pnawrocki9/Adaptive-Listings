import { describe, expect, it } from 'vitest';

import { MOCK_TENANTS } from './tenants/mock-data';

describe('Admin mock data — tenants', () => {
  it('has at least one tenant', () => {
    expect(MOCK_TENANTS.length).toBeGreaterThan(0);
  });

  it('each tenant has required shape', () => {
    for (const tenant of MOCK_TENANTS) {
      expect(tenant).toHaveProperty('id');
      expect(tenant).toHaveProperty('name');
      expect(tenant).toHaveProperty('plan');
      expect(tenant).toHaveProperty('status');
      expect(['starter', 'growth', 'enterprise']).toContain(tenant.plan);
      expect(['active', 'suspended', 'trial']).toContain(tenant.status);
    }
  });
});
