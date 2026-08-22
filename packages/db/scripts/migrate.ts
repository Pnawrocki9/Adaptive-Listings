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
 *
 * --- FOLLOW-149 hardening (2026-05-28) ---
 *
 * Before this hardening, the runner unconditionally printed
 * "Migrations applied successfully." — even when zero migrations were applied.
 * Combined with the drizzle-kit year-drift bug (which can cause `_journal.json`
 * entries to be silently skipped by Drizzle's migrator), this produced a class
 * of false-success outcomes where new migrations did NOT apply but the script
 * exited 0 with a green message.
 *
 * The runner now:
 *   1. Counts rows in `drizzle.__drizzle_migrations` BEFORE migrate.
 *   2. Calls migrate().
 *   3. Counts rows AFTER. Computes `applied = after - before` and
 *      `pending = journal_entry_count - after`.
 *   4. Prints an honest summary of all three numbers.
 *   5. If `pending > 0 AND applied === 0`, exits with code 2 and a loud
 *      warning pointing at FOLLOW-149 (i.e. the journal-ordering bug is
 *      almost certainly present — the CI gate at
 *      `scripts/check-migration-journal.sh` will pinpoint the bad entry).
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

import { createAdminClient } from '../src/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_FOLDER = resolve(__dirname, '../migrations');
const JOURNAL_PATH = resolve(MIGRATIONS_FOLDER, 'meta/_journal.json');

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

/**
 * Returns the row count of `drizzle.__drizzle_migrations`, or `null` if the
 * table does not yet exist (first migration ever — pre-state has zero
 * applied migrations, treat as 0). Throws on any other error so we never
 * silently misreport the count.
 */
async function appliedCount(db: Awaited<ReturnType<typeof createAdminClient>>): Promise<number> {
  try {
    const rows = (await db.execute(
      sql`SELECT COUNT(*)::int AS n FROM drizzle.__drizzle_migrations`,
    )) as unknown as { n: number }[];
    const first = rows[0];
    return first?.n ?? 0;
  } catch (err) {
    // The driver wraps the real Postgres error in `.cause` — DrizzleQueryError's own
    // `.message` is just "Failed query: ..." and never contains "does not exist", so this
    // codepath was silently unreachable on any DB that already has the table (i.e. every
    // staging/prod run so far). Found standing up a genuinely fresh local Postgres for
    // FOLLOW-818 — the first time this script ever ran against a true first-migration state.
    const msg = err instanceof Error ? err.message : String(err);
    const causeMsg = err instanceof Error && err.cause instanceof Error ? err.cause.message : '';
    if (/does not exist|relation .* does not exist/i.test(`${msg} ${causeMsg}`)) return 0;
    throw err;
  }
}

function readJournalCount(): number {
  const raw = readFileSync(JOURNAL_PATH, 'utf8');
  const journal = JSON.parse(raw) as Journal;
  return journal.entries.length;
}

const db = createAdminClient();

const journalCount = readJournalCount();
const before = await appliedCount(db);

await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });

const after = await appliedCount(db);
const applied = after - before;
const pending = journalCount - after;

console.log(
  `Migrations applied: ${String(applied)} ` +
    `(${String(before)} already applied before this run, ${String(after)} now applied, ` +
    `${String(pending)} still pending after this run; journal has ${String(journalCount)} entries).`,
);

if (pending > 0 && applied === 0) {
  console.error(
    `\n⚠️  No migrations applied but ${String(pending)} entries remain unapplied — likely journal timestamp ordering bug; see FOLLOW-149.`,
  );
  console.error(
    '   Drizzle silently skips entries whose _journal.json "when" is <= the last applied entry\'s.',
  );
  console.error(
    '   Run `bash scripts/check-migration-journal.sh` to identify the offending entry.',
  );
  process.exit(2);
}

if (applied > 0 && pending === 0) {
  console.log('Migrations applied successfully.');
} else if (applied > 0 && pending > 0) {
  // Mixed state — some applied, some still pending (unusual, but possible
  // if a later entry's `when` is between two existing applied entries).
  console.warn(
    `Partial success — ${String(applied)} applied, ${String(pending)} still pending. Investigate journal ordering.`,
  );
  process.exit(2);
} else {
  // applied === 0 && pending === 0 → already up-to-date.
  console.log('Already up-to-date — no migrations needed.');
}

// Close the pool explicitly. Without this the process hangs on the SUCCESS path — the driver
// keeps an idle socket open and the event loop never drains, so the only exits are the two
// process.exit(2) failure branches above. Against Supabase that is invisible (the pooler drops
// the idle connection and the run happens to end); against a local Postgres it is not, and a
// completed migration reads as a hung terminal, or as exit 124 when wrapped in `timeout`.
// FOLLOW-818 — found the first time this script was run against a local container.
await db.$client.end({ timeout: 5 });
