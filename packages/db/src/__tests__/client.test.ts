import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('createTenantClient', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws if DATABASE_URL is not set', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgres://admin@localhost/db');
    const { createTenantClient } = await import('../client.js');
    expect(() => createTenantClient()).toThrow('DATABASE_URL is not set');
  });

  it('does not throw if DATABASE_URL is set', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://anon@localhost/db');
    const { createTenantClient } = await import('../client.js');
    expect(() => createTenantClient()).not.toThrow();
  });
});

describe('createAdminClient', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws if neither DATABASE_URL_ADMIN nor DATABASE_URL_DIRECT is set', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');
    const { createAdminClient } = await import('../client.js');
    expect(() => createAdminClient()).toThrow('DATABASE_URL_ADMIN is not set');
  });

  it('prefers DATABASE_URL_ADMIN over DATABASE_URL_DIRECT', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgres://service@localhost/db');
    vi.stubEnv('DATABASE_URL_DIRECT', 'postgres://direct@localhost/db');
    const { createAdminClient } = await import('../client.js');
    expect(() => createAdminClient()).not.toThrow();
  });
});
