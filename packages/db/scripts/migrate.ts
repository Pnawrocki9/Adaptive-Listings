/**
 * Migration runner.
 *
 * Applies all pending SQL migration files from `./migrations/` to the database
 * pointed at by `DATABASE_URL_DIRECT` (the direct Postgres connection, port 5432).
 *
 * Run via the monorepo root script:
 *   pnpm db:migrate
 *
 * Or directly:
 *   pnpm --filter @estalara/db tsx scripts/migrate.ts
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL_DIRECT;
if (!url) {
  throw new Error(
    'DATABASE_URL_DIRECT must be set. ' +
      'Point it at the direct Postgres connection (port 5432), not the pgBouncer pooler.',
  );
}

// Single connection is enough for sequential migration execution.
const sql = postgres(url, { max: 1 });
const db = drizzle(sql);

await migrate(db, { migrationsFolder: './migrations' });
await sql.end();

console.log('Migrations applied successfully.');
