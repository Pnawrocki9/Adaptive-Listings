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

import postgres from 'postgres';

import {
  createAdminClient,
  createClient,
  createTenantClient,
  describeAdminDatabase,
  describeDatabaseUrl,
  withJwt,
} from '../client.js';

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

// FOLLOW-1193: `POST /api/listings/embed` reports the database it wrote to so
// `pnpm seed:listings` can print it. That report is only worth anything if it
// describes the URL `createAdminClient()` actually connects with — these tests
// fail if the two resolve different environment variables.
describe('describeAdminDatabase', () => {
  const originalEnv = process.env;
  const postgresMock = vi.mocked(postgres);

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_DIRECT;
    postgresMock.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('describes host, port and database name — never the user or password', () => {
    process.env.DATABASE_URL_ADMIN = 'postgresql://seed_user:not-a-real-pw@127.0.0.1:5433/postgres';
    const target = describeAdminDatabase();
    expect(target).toEqual({ host: '127.0.0.1', port: '5433', name: 'postgres' });
    expect(JSON.stringify(target)).not.toContain('seed_user');
    expect(JSON.stringify(target)).not.toContain('not-a-real-pw');
  });

  it('describes the SAME URL createAdminClient() connects with (ADMIN over DIRECT)', () => {
    process.env.DATABASE_URL_ADMIN = 'postgresql://u:p@127.0.0.1:5433/local_db';
    process.env.DATABASE_URL_DIRECT = 'postgresql://u:p@db.hosted.example:5432/hosted_db';

    createAdminClient();
    const connectedWith = postgresMock.mock.calls.at(-1)![0];

    expect(describeAdminDatabase()).toEqual(describeDatabaseUrl(connectedWith));
    expect(describeAdminDatabase().host).toBe('127.0.0.1');
  });

  it('falls back to DATABASE_URL_DIRECT exactly as createAdminClient() does', () => {
    process.env.DATABASE_URL_DIRECT = 'postgresql://u:p@db.hosted.example:5432/hosted_db';

    createAdminClient();
    const connectedWith = postgresMock.mock.calls.at(-1)![0];

    expect(describeAdminDatabase()).toEqual(describeDatabaseUrl(connectedWith));
    expect(describeAdminDatabase().host).toBe('db.hosted.example');
  });

  it('defaults the port to 5432 when the URL omits it', () => {
    expect(describeDatabaseUrl('postgresql://u:p@localhost/app')).toEqual({
      host: 'localhost',
      port: '5432',
      name: 'app',
    });
  });

  it('throws without ever echoing an unparseable URL (it may carry a password)', () => {
    expect(() => describeDatabaseUrl('not a url with secret-pw')).toThrow(/not a parseable URL/);
    expect(() => describeDatabaseUrl('not a url with secret-pw')).not.toThrow(/secret-pw/);
  });
});

// FOLLOW-1241: `createAdminClient()` / `createTenantClient()` are called once PER
// REQUEST by the control plane. Each call used to open a brand-new postgres.js
// pool that nothing ever `.end()`ed — measured +4 Postgres connections per
// `/api/admin/analytics/rollup` request on localhost until PG refused clients.
// These tests fail if a request-scoped factory call opens a pool of its own.
describe('pool reuse (FOLLOW-1241)', () => {
  const originalEnv = process.env;
  const postgresMock = vi.mocked(postgres);
  const openedFor = (dbName: string) =>
    postgresMock.mock.calls.filter(([url]) => url.endsWith(`/${dbName}`));

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_DIRECT;
    delete process.env.DATABASE_URL;
    postgresMock.mockClear();
    executeSpy.mockClear();
    transactionSpy.mockClear();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('createAdminClient() opens ONE pool no matter how many times it is called', () => {
    process.env.DATABASE_URL_ADMIN = 'postgresql://u:p@127.0.0.1:5433/pool_reuse_admin';

    for (let i = 0; i < 16; i++) createAdminClient();

    expect(openedFor('pool_reuse_admin')).toHaveLength(1);
  });

  it('createAdminClient() opens a separate pool when the resolved URL changes', () => {
    process.env.DATABASE_URL_ADMIN = 'postgresql://u:p@127.0.0.1:5433/pool_reuse_a';
    createAdminClient();
    process.env.DATABASE_URL_ADMIN = 'postgresql://u:p@127.0.0.1:5433/pool_reuse_b';
    createAdminClient();
    createAdminClient();

    expect(openedFor('pool_reuse_a')).toHaveLength(1);
    expect(openedFor('pool_reuse_b')).toHaveLength(1);
  });

  it('createTenantClient() opens ONE pool across calls with different JWTs', () => {
    process.env.DATABASE_URL = 'postgresql://anon@127.0.0.1:5433/pool_reuse_tenant';

    createTenantClient('jwt-a');
    createTenantClient('jwt-b');
    createTenantClient();

    expect(openedFor('pool_reuse_tenant')).toHaveLength(1);
  });

  it('a shared tenant pool never leaks one caller JWT into another caller rls()', async () => {
    process.env.DATABASE_URL = 'postgresql://anon@127.0.0.1:5433/pool_reuse_tenant_jwt';

    const a = createTenantClient('jwt-tenant-a');
    const b = createTenantClient('jwt-tenant-b');
    const none = createTenantClient();

    await a.rls(() => Promise.resolve('a'));
    await b.rls(() => Promise.resolve('b'));
    await none.rls(() => Promise.resolve('none'));

    const chunks = executeSpy.mock.calls.map(
      ([sqlObject]) => (sqlObject as { queryChunks?: unknown[] }).queryChunks ?? [],
    );
    expect(chunks).toHaveLength(2); // `none` must NOT set request.jwt
    expect(chunks[0]).toContain('jwt-tenant-a');
    expect(chunks[0]).not.toContain('jwt-tenant-b');
    expect(chunks[1]).toContain('jwt-tenant-b');
    expect(chunks[1]).not.toContain('jwt-tenant-a');
  });

  it('createClient() still opens a fresh, caller-owned pool on every call', () => {
    createClient('postgresql://u:p@127.0.0.1:5433/pool_owned');
    createClient('postgresql://u:p@127.0.0.1:5433/pool_owned');

    expect(openedFor('pool_owned')).toHaveLength(2);
  });
});
