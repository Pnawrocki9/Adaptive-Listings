import { describe, expect, it } from 'vitest';

import { MOCK_REGISTRATIONS } from './registrations/mock-data';
import { MOCK_TENANTS } from './tenants/mock-data';
import { MOCK_DEMO_SESSIONS } from './demo-sessions/mock-data';

describe('Admin mock data — registrations', () => {
  it('has at least one registration', () => {
    expect(MOCK_REGISTRATIONS.length).toBeGreaterThan(0);
  });

  it('each registration has required shape', () => {
    for (const reg of MOCK_REGISTRATIONS) {
      expect(reg).toHaveProperty('id');
      expect(reg).toHaveProperty('agency_name');
      expect(reg).toHaveProperty('contact_email');
      expect(reg).toHaveProperty('status');
      expect(['pending', 'approved', 'rejected']).toContain(reg.status);
    }
  });

  it('all mock registrations are pending', () => {
    expect(MOCK_REGISTRATIONS.every((r) => r.status === 'pending')).toBe(true);
  });
});

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

describe('Admin mock data — demo sessions', () => {
  it('has at least one session', () => {
    expect(MOCK_DEMO_SESSIONS.length).toBeGreaterThan(0);
  });

  it('each session has required shape', () => {
    for (const session of MOCK_DEMO_SESSIONS) {
      expect(session).toHaveProperty('id');
      expect(session).toHaveProperty('scope');
      expect(session).toHaveProperty('visibility');
      expect(session).toHaveProperty('status');
      expect(['active', 'revoked', 'expired']).toContain(session.status);
    }
  });

  it('has both active and revoked sessions in mock data', () => {
    const statuses = MOCK_DEMO_SESSIONS.map((s) => s.status);
    expect(statuses).toContain('active');
    expect(statuses).toContain('revoked');
  });
});
