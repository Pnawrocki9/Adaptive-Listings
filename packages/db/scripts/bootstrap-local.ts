/**
 * bootstrap-local.ts — make an EMPTY local Postgres accept this repo's migration chain.
 *
 * FOLLOW-818. `pnpm db:migrate` cannot bootstrap a fresh database on its own, for two reasons
 * that only ever show up on a genuinely empty one (hosted Supabase has both preconditions
 * already, which is why neither was recorded before this ticket):
 *
 *   1. The migrations' RLS policies call `auth.jwt()` / `auth.uid()` and their grants name the
 *      `anon` / `authenticated` / `service_role` roles. A `supabase/postgres` CONTAINER ships the
 *      extensions but not that auth layer — it is provisioned by the hosted platform, not the
 *      image — so migration 0004 dies with `function auth.jwt() does not exist`.
 *   2. Migration `0016_pilot_inquiry_selector` opens with a DO block that RAISEs unless a tenant
 *      row with slug `000-app-estalara` already exists. No migration creates that row. Because
 *      drizzle-orm applies the WHOLE chain inside ONE transaction (`pg-core/dialect.js`), the
 *      abort at 0016 rolls back all fifteen migrations before it — so the operator cannot simply
 *      "insert the tenant and re-run": the `tenants` table never survives long enough to insert
 *      into. That is the deadlock this script breaks.
 *
 * What it does, in order:
 *   1. Refuses to run against anything but a loopback host (never Supabase — see the guard below).
 *   2. Applies `local-supabase-shim.sql` (auth schema + functions + roles + extensions).
 *   3. Applies journal entry 0 on its own, OUTSIDE the migrator's transaction, and records its
 *      hash in `drizzle.__drizzle_migrations` exactly as drizzle would (sha256 of the file, with
 *      the journal's own `when` as `created_at`) so the migrator skips it and starts at 0001.
 *   4. Applies `local-pilot-tenant.sql`, which is now possible because `tenants` exists and is
 *      committed.
 *
 * Then run `pnpm db:migrate` — it applies 0001…HEAD in one transaction, 0016 finds its tenant,
 * and the run ends with an honest `applied=N pending=0` summary.
 *
 * Idempotent: every step is skip-if-present, so re-running it on an already-bootstrapped database
 * is a no-op. Run via the monorepo root script:
 *
 *   DATABASE_URL_ADMIN=postgresql://supabase_admin:postgres@127.0.0.1:5433/postgres \
 *     pnpm db:bootstrap:local
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, '../migrations');
const JOURNAL_PATH = resolve(MIGRATIONS_FOLDER, 'meta/_journal.json');
const SHIM_PATH = resolve(__dirname, 'local-supabase-shim.sql');
const PILOT_TENANT_PATH = resolve(__dirname, 'local-pilot-tenant.sql');

/** Hosts this script is willing to touch. Anything else is refused, loudly. */
const ALLOWED_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0']);

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

function assertLocalUrl(url: string): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    console.error('[bootstrap-local] ERROR: DATABASE_URL_ADMIN is not a parseable URL.');
    process.exit(1);
  }
  if (!ALLOWED_HOSTS.has(host)) {
    console.error(
      `[bootstrap-local] REFUSING to run against host "${host}". This script seeds fixtures and ` +
        'stubs the Supabase auth layer; it is for a local container only. A hosted Supabase ' +
        'project already defines those objects for real and already has the pilot tenant.',
    );
    process.exit(1);
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT;
  if (!url) {
    console.error('[bootstrap-local] ERROR: DATABASE_URL_ADMIN is not set.');
    process.exit(1);
  }
  assertLocalUrl(url);

  // `onnotice` swallows the "already exists, skipping" NOTICEs every idempotent statement
  // here emits on a re-run; real failures still throw.
  const sql = postgres(url, { max: 1, prepare: false, onnotice: () => undefined });
  try {
    console.log('[bootstrap-local] 1/3 Applying the Supabase auth shim…');
    await sql.unsafe(readFileSync(SHIM_PATH, 'utf8'));

    const journal = JSON.parse(readFileSync(JOURNAL_PATH, 'utf8')) as { entries: JournalEntry[] };
    const first = journal.entries[0];
    if (!first) throw new Error('meta/_journal.json has no entries.');

    const [{ exists: tenantsExists }] = await sql<{ exists: boolean }[]>`
      SELECT to_regclass('public.tenants') IS NOT NULL AS exists
    `;

    if (tenantsExists) {
      console.log(`[bootstrap-local] 2/3 ${first.tag} already applied — skipping.`);
    } else {
      console.log(`[bootstrap-local] 2/3 Applying ${first.tag} ahead of the migrator…`);
      const migrationSql = readFileSync(resolve(MIGRATIONS_FOLDER, `${first.tag}.sql`), 'utf8');
      const hash = createHash('sha256').update(migrationSql).digest('hex');
      await sql.unsafe(migrationSql);
      // Mirror drizzle's own bookkeeping so `db:migrate` starts at entry 1, not 0.
      await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
      await sql`
        CREATE TABLE IF NOT EXISTS drizzle."__drizzle_migrations" (
          id SERIAL PRIMARY KEY,
          hash text NOT NULL,
          created_at bigint
        )
      `;
      await sql`
        INSERT INTO drizzle."__drizzle_migrations" ("hash", "created_at")
        VALUES (${hash}, ${first.when})
      `;
    }

    console.log('[bootstrap-local] 3/3 Seeding the pilot tenant migration 0016 asserts on…');
    await sql.unsafe(readFileSync(PILOT_TENANT_PATH, 'utf8'));

    console.log('[bootstrap-local] Done. Next: pnpm db:migrate (applies 0001…HEAD).');
  } finally {
    await sql.end({ timeout: 5 });
  }
}

await main();
