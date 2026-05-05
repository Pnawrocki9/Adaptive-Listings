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
 * Creates a typed Drizzle ORM client.
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

  const sql = postgres(databaseUrl, { max, prepare });
  return drizzle(sql, { schema });
}

/** Inferred return type of {@link createClient} — pass this around instead of the raw Drizzle type. */
export type Database = ReturnType<typeof createClient>;

/**
 * Creates a Drizzle client for TENANT queries.
 *
 * Reads `DATABASE_URL` (pooled pgBouncer endpoint, port 6543).
 * Row Level Security is ENFORCED — queries see only the calling tenant's data.
 * Pass the tenant's JWT so Supabase RLS policies can read `auth.jwt()` claims.
 *
 * Use this in: API route handlers, edge functions, any code running in tenant context.
 * Never use this for migrations or cross-tenant admin operations.
 *
 * @throws {Error} if `DATABASE_URL` is not set
 */
export function createTenantClient(jwtToken?: string) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return createClient(url, {
    poolMode: 'transaction',
    ...(jwtToken !== undefined ? { jwtToken } : {}),
  });
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
 * @throws {Error} if neither `DATABASE_URL_ADMIN` nor `DATABASE_URL_DIRECT` is set
 */
export function createAdminClient() {
  const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT;
  if (!url) throw new Error('DATABASE_URL_ADMIN is not set');
  return createClient(url, { poolMode: 'session' });
}

// Re-export schema so callers can import table types from one place.
export * from './schema/index.js';
