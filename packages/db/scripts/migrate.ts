/**
 * Migration runner.
 *
 * Applies all pending SQL migration files from `./migrations/` to the database
 * pointed at by `DATABASE_URL_ADMIN` (service role, direct connection, port 5432).
 * Falls back to `DATABASE_URL_DIRECT` for backwards compatibility.
 *
 * Run via the monorepo root script:
 *   pnpm db:migrate
 *
 * Or directly:
 *   pnpm --filter @estalara/db tsx scripts/migrate.ts
 */

import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { createAdminClient } from '../src/index.js';

const db = createAdminClient();

await migrate(db, { migrationsFolder: './migrations' });

console.log('Migrations applied successfully.');
