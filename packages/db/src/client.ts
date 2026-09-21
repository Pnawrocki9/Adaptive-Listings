/**
 * Drizzle client factory for Supabase Postgres.
 *
 * Supports two connection modes:
 *  - `'transaction'` (default) — direct connection on port 5432; safe for migrations
 *    and operations that use prepared statements.
 *  - `'session'`   — pooled connection via pgBouncer on port 6543; `prepare: false`
 *    is enforced because pgBouncer transaction mode is incompatible with prepared
 *    statements (see README for details).
 *
 * @module @estalara/db/client
 */

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema/index.js';

/**
 * Options for {@link createClient}.
 */
export interface ClientOptions {
  /**
   * Connection pool mode.
   *
   * - `'transaction'` — direct Postgres connection (port 5432). Prepared statements
   *   are enabled. Use for migrations and scripts.
   * - `'session'`     — pooled connection via pgBouncer (port 6543). Prepared
   *   statements are disabled automatically because pgBouncer transaction mode does
   *   not support them.
   *
   * @default 'transaction'
   */
  poolMode?: 'session' | 'transaction';

  /**
   * Maximum number of connections in the pool.
   *
   * @default 10
   */
  max?: number;

  /**
   * Supabase tenant JWT for RLS context propagation.
   * Reserved for future use — will be applied via `SET request.jwt = '...'`
   * so Postgres RLS policies can read `auth.jwt()`.
   */
  jwtToken?: string;
}

/**
 * Creates a typed Drizzle ORM client over a NEW connection pool that the caller
 * owns and must `.end()` (via `db.$client.end()`) when done. Use this for scripts
 * and migrations; request-scoped code should use {@link createAdminClient} or
 * {@link createTenantClient}, which share one pool per process (FOLLOW-1241).
 *
 * @param databaseUrl - Postgres connection string (e.g. `postgresql://user:pass@host/db`).
 * @param options     - Optional pool and connection settings.
 * @returns           A Drizzle `PostgresJsDatabase` bound to the full schema.
 *
 * @example
 * ```typescript
 * // Pooled (app queries via pgBouncer)
 * const db = createClient(process.env.DATABASE_URL!, { poolMode: 'session' });
 *
 * // Direct (migration scripts)
 * const db = createClient(process.env.DATABASE_URL_DIRECT!);
 * ```
 */
export function createClient(databaseUrl: string, options: ClientOptions = {}) {
  const { poolMode = 'transaction', max = 10 } = options;

  // pgBouncer in transaction mode does not support prepared statements.
  // Use prepare: false for session (pooled) connections to avoid runtime errors.
  const prepare = poolMode !== 'session';

  const pgSql = postgres(databaseUrl, { max, prepare });
  return drizzle(pgSql, { schema });
}

/** Inferred return type of {@link createClient} — pass this around instead of the raw Drizzle type. */
export type Database = ReturnType<typeof createClient>;

/**
 * A {@link Database} instance augmented with an `.rls()` helper that propagates a
 * tenant JWT into the Postgres session so RLS policies can read `auth.jwt()`.
 *
 * Use `.rls(tx => ...)` instead of raw queries whenever RLS enforcement is required.
 */
export interface TenantDatabase extends Database {
  /**
   * Executes `fn` inside a Postgres transaction that first sets `request.jwt` to the
   * tenant's JWT token (transaction-local, via `set_config(..., true)`).
   *
   * All queries inside `fn` run under Supabase Row Level Security.
   *
   * @example
   * ```typescript
   * const db = createTenantClient(jwtToken);
   * const rows = await db.rls(tx => tx.select().from(tenants));
   * ```
   */
  rls: <T>(fn: (tx: Database) => Promise<T>) => Promise<T>;
}

/**
 * Executes `fn` inside a Postgres transaction with `request.jwt` set to `jwtToken`
 * (transaction-local). This ensures Supabase RLS policies that read `auth.jwt()` or
 * `current_setting('request.jwt')` see the correct tenant claims.
 *
 * @param db       - A Drizzle database instance (created by {@link createClient}).
 * @param jwtToken - The Supabase tenant JWT string.
 * @param fn       - Callback that receives the transaction handle and returns a result.
 * @returns        The value returned by `fn`.
 *
 * @example
 * ```typescript
 * const db = createClient(process.env.DATABASE_URL!);
 * const rows = await withJwt(db, req.jwtToken, tx => tx.select().from(tenants));
 * ```
 */
export async function withJwt<T>(
  db: Database,
  jwtToken: string,
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT set_config('request.jwt', ${jwtToken}, true)`);
    return fn(tx as unknown as Database);
  });
}

/**
 * Creates a Drizzle client for TENANT queries.
 *
 * Reads `DATABASE_URL` (pooled pgBouncer endpoint, port 6543).
 * Row Level Security is ENFORCED — queries see only the calling tenant's data.
 * Pass the tenant's JWT so Supabase RLS policies can read `auth.jwt()` claims.
 *
 * When `jwtToken` is provided the returned client has an `.rls()` method that wraps
 * a callback in a Postgres transaction with `request.jwt` set transaction-locally.
 * Use `.rls()` for all queries that must run under RLS.
 *
 * Use this in: API route handlers, edge functions, any code running in tenant context.
 * Never use this for migrations or cross-tenant admin operations.
 *
 * Every call shares one process-wide pool for `DATABASE_URL` (FOLLOW-1241); only
 * the returned wrapper, and so its `.rls()` JWT, is per call.
 *
 * @throws {Error} if `DATABASE_URL` is not set
 *
 * @example
 * ```typescript
 * // With JWT — RLS enforced
 * const db = createTenantClient(jwtToken);
 * const rows = await db.rls(tx => tx.select().from(tenants));
 *
 * // Without JWT — use withJwt() explicitly or ensure token is wired upstream
 * const db = createTenantClient();
 * ```
 */
export function createTenantClient(jwtToken?: string): TenantDatabase {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  // A fresh Drizzle wrapper per call over the SHARED pool (FOLLOW-1241): `rls`
  // is attached below, so sharing the wrapper itself would let one caller's JWT
  // overwrite another's. The wrapper is cheap; the pool is what must be shared.
  const base = drizzle(sharedPool(url, 'transaction'), { schema });

  const tenantDb = base as TenantDatabase;

  if (jwtToken !== undefined) {
    tenantDb.rls = <T>(fn: (tx: Database) => Promise<T>): Promise<T> => withJwt(base, jwtToken, fn);
  } else {
    // No JWT provided — rls() is a pass-through that does NOT set request.jwt.
    // Callers that reach this path should be audited: RLS will not be enforced.
    tenantDb.rls = <T>(fn: (tx: Database) => Promise<T>): Promise<T> =>
      base.transaction((tx) => fn(tx as unknown as Database));
  }

  return tenantDb;
}

/**
 * Creates a Drizzle client for ADMIN operations.
 *
 * Reads `DATABASE_URL_ADMIN` (service role, falls back to `DATABASE_URL_DIRECT`).
 * Row Level Security is BYPASSED — use only for migrations, seeding, and master admin ops.
 *
 * NEVER use this in tenant-facing API routes.
 * NEVER expose this client to the control plane tenant dashboard.
 *
 * Every call returns a client over the SAME process-wide pool for the resolved URL
 * — cheap to call per request, and never `.end()` it outside process exit
 * (FOLLOW-1241).
 *
 * @throws {Error} if neither `DATABASE_URL_ADMIN` nor `DATABASE_URL_DIRECT` is set
 */
export function createAdminClient(): Database {
  return drizzle(sharedPool(resolveAdminDatabaseUrl(), 'session'), { schema });
}

/**
 * Idle connections in a shared pool are closed after this many seconds.
 *
 * postgres.js defaults `idle_timeout` to 0 (never). On a reused serverless
 * instance (Vercel Fluid Compute) or a long-lived `next dev` process that pins up
 * to `max` connections per pool against the Supabase pooler for as long as the
 * instance lives, even when it serves nothing. 20s keeps a warm pool across a
 * burst of requests and hands the slots back once traffic stops.
 */
const SHARED_POOL_IDLE_TIMEOUT_S = 20;

/**
 * Process-wide pool registry, keyed by pool mode + URL.
 *
 * Lives on `globalThis` rather than in module scope so that Next dev HMR, which
 * re-evaluates this module, reuses the same pools instead of orphaning them.
 */
interface GlobalWithPools {
  __estalaraDbSharedPools?: Map<string, postgres.Sql>;
}

/**
 * Returns the one postgres.js pool this process uses for `url` in `poolMode`,
 * opening it on first use.
 *
 * {@link createAdminClient} and {@link createTenantClient} are called once PER
 * REQUEST by the control plane. They used to go through {@link createClient},
 * which opens a new pool every call; nothing ever `.end()`ed those, so each
 * request leaked its connections until Postgres refused new clients (FOLLOW-1241:
 * +4 connections per `/api/admin/analytics/rollup` request on localhost).
 *
 * Callers MUST NOT `.end()` a pool obtained this way except at process exit
 * (as `scripts/migrate.ts` does) — it is shared with every other caller.
 */
function sharedPool(url: string, poolMode: 'session' | 'transaction'): postgres.Sql {
  const g = globalThis as unknown as GlobalWithPools;
  const pools = (g.__estalaraDbSharedPools ??= new Map<string, postgres.Sql>());
  const key = `${poolMode} ${url}`;
  let pool = pools.get(key);
  if (!pool) {
    pool = postgres(url, {
      max: 10,
      prepare: poolMode !== 'session',
      idle_timeout: SHARED_POOL_IDLE_TIMEOUT_S,
    });
    pools.set(key, pool);
  }
  return pool;
}

/**
 * The one place the admin URL precedence lives. {@link createAdminClient} and
 * {@link describeAdminDatabase} both read it, so the database a caller REPORTS
 * cannot drift from the one it CONNECTS to (FOLLOW-1193).
 */
function resolveAdminDatabaseUrl(): string {
  const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT;
  if (!url) throw new Error('DATABASE_URL_ADMIN is not set');
  return url;
}

/**
 * Credential-free identity of a Postgres database: host, port and database name.
 * Never carries the user or password.
 */
export interface DatabaseTarget {
  host: string;
  port: string;
  name: string;
}

/**
 * Describe a Postgres connection URL without its credentials.
 *
 * @throws {Error} when the URL is unparseable. The message deliberately does NOT
 *                 echo the input, which may carry a password.
 */
export function describeDatabaseUrl(url: string): DatabaseTarget {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(
      'Database URL is not a parseable URL (value withheld: it may carry credentials)',
    );
  }
  return {
    host: parsed.hostname,
    port: parsed.port || '5432',
    name: decodeURIComponent(parsed.pathname.replace(/^\//, '')),
  };
}

/**
 * Describe the database {@link createAdminClient} connects to.
 *
 * Used by `POST /api/listings/embed` to tell `pnpm seed:listings` which database
 * its rows landed in — that seeder has no database of its own, so without this a
 * control plane started against hosted Supabase and an archetype seed against a
 * loopback container were two green runs writing two different databases
 * (FOLLOW-1193 / RETRO-324 §4a LG-2).
 *
 * @throws {Error} if neither `DATABASE_URL_ADMIN` nor `DATABASE_URL_DIRECT` is set
 */
export function describeAdminDatabase(): DatabaseTarget {
  return describeDatabaseUrl(resolveAdminDatabaseUrl());
}

// Re-export schema so callers can import table types from one place.
export * from './schema/index.js';
