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

// Re-export schema so callers can import table types from one place.
export * from './schema/index.js';
