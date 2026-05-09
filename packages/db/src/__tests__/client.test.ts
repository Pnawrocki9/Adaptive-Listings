import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock postgres and drizzle at module level — no dynamic imports needed.
// This eliminates the vi.resetModules() + dynamic import race that caused
// intermittent CI failures when tests ran concurrently.
vi.mock('postgres', () => ({
  default: vi.fn(() => ({ end: vi.fn() })),
}));

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: vi.fn(() => ({})),
}));

import { createAdminClient, createTenantClient } from '../client.js';

describe('createTenantClient', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws if DATABASE_URL is not set', () => {
    expect(() => createTenantClient()).toThrow('DATABASE_URL is not set');
  });

  it('does not throw if DATABASE_URL is set', () => {
    process.env.DATABASE_URL = 'postgres://anon@localhost/db';
    expect(() => createTenantClient()).not.toThrow();
  });
});

describe('createAdminClient', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_DIRECT;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('throws if neither DATABASE_URL_ADMIN nor DATABASE_URL_DIRECT is set', () => {
    expect(() => createAdminClient()).toThrow('DATABASE_URL_ADMIN is not set');
  });

  it('prefers DATABASE_URL_ADMIN over DATABASE_URL_DIRECT', () => {
    process.env.DATABASE_URL_ADMIN = 'postgres://service@localhost/db';
    expect(() => createAdminClient()).not.toThrow();
  });
});
