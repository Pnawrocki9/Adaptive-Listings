import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture the execute spy so tests can inspect set_config calls.
const executeSpy = vi.fn().mockResolvedValue([]);

// Mock the transaction helper: runs the callback immediately with a tx proxy that
// records calls to execute().
const transactionSpy = vi.fn().mockImplementation((fn: (tx: unknown) => Promise<unknown>) => {
  const tx = { execute: executeSpy };
  return fn(tx);
});

// Mock postgres and drizzle at module level — no dynamic imports needed.
// This eliminates the vi.resetModules() + dynamic import race that caused
// intermittent CI failures when tests ran concurrently.
vi.mock('postgres', () => ({
  default: vi.fn(() => ({ end: vi.fn() })),
}));

vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: vi.fn(() => ({ transaction: transactionSpy })),
}));

import { createAdminClient, createTenantClient, withJwt } from '../client.js';

describe('createTenantClient', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL;
    executeSpy.mockClear();
    transactionSpy.mockClear();
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

  it('returns a db with an rls() method when called without jwtToken', () => {
    process.env.DATABASE_URL = 'postgres://anon@localhost/db';
    const db = createTenantClient();
    expect(typeof db.rls).toBe('function');
  });

  it('returns a db with an rls() method when called with jwtToken', () => {
    process.env.DATABASE_URL = 'postgres://anon@localhost/db';
    const db = createTenantClient('test-jwt-token');
    expect(typeof db.rls).toBe('function');
  });

  it('rls() without jwtToken wraps in a transaction but does NOT call set_config', async () => {
    process.env.DATABASE_URL = 'postgres://anon@localhost/db';
    const db = createTenantClient();
    const resultFn = vi.fn().mockResolvedValue('ok');

    const result = await db.rls(resultFn);

    expect(result).toBe('ok');
    expect(transactionSpy).toHaveBeenCalledTimes(1);
    // No set_config call because no JWT was provided.
    expect(executeSpy).not.toHaveBeenCalled();
  });

  it('rls() with jwtToken executes set_config with the correct token', async () => {
    process.env.DATABASE_URL = 'postgres://anon@localhost/db';
    const token = 'eyJhbGciOiJIUzI1NiJ9.test.sig';
    const db = createTenantClient(token);
    const resultFn = vi.fn().mockResolvedValue('rows');

    const result = await db.rls(resultFn);

    expect(result).toBe('rows');
    expect(transactionSpy).toHaveBeenCalledTimes(1);
    // set_config must have been called exactly once.
    expect(executeSpy).toHaveBeenCalledTimes(1);
    // drizzle's sql`` tag produces an SQL object whose queryChunks interleave
    // StringChunk instances (for the literal parts) with the raw interpolated values
    // (pushed as-is by the sql tag function). The jwtToken string will appear
    // directly as a string element in queryChunks.
    const [sqlObject] = executeSpy.mock.calls[0] as [{ queryChunks?: unknown[] }];
    expect(sqlObject.queryChunks ?? []).toContain(token);
  });
});

describe('withJwt', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env.DATABASE_URL = 'postgres://anon@localhost/db';
    executeSpy.mockClear();
    transactionSpy.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('is a callable export', () => {
    expect(typeof withJwt).toBe('function');
  });

  it('wraps fn in a transaction and calls set_config with the jwt token', async () => {
    const { createClient } = await import('../client.js');
    const db = createClient('postgres://anon@localhost/db');
    const token = 'eyJhbGciOiJIUzI1NiJ9.payload.sig';
    const resultFn = vi.fn().mockResolvedValue(42);

    const result = await withJwt(db, token, resultFn);

    expect(result).toBe(42);
    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy).toHaveBeenCalledTimes(1);
    const [sqlObject] = executeSpy.mock.calls[0] as [{ queryChunks?: unknown[] }];
    expect(sqlObject.queryChunks ?? []).toContain(token);
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
