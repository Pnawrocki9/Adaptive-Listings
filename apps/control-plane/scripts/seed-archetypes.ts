/**
 * scripts/seed-archetypes.ts — CLI entrypoint for archetype embedding seeder.
 *
 * Purpose:
 *   `packages/db/migrations/0005_seed_archetype_embeddings.sql` inserts 18
 *   canonical archetype rows with `embedding = NULL`. Without a populated
 *   vector, `fetchArchetypeEmbedding()` returns null for every archetype and
 *   the cosine-affinity path in the adapt route silently falls back to djb2.
 *
 *   This script reads each archetype's description, calls OpenAI
 *   `text-embedding-3-small` at 1024 dims, and writes the result back.
 *
 * Core logic:
 *   Lives in `src/lib/archetype-seeder.ts` — a proper TypeScript module that
 *   can be unit-tested. This file is a thin CLI wrapper only.
 *
 * WHY THIS FILE IS `.ts` AND NOT `.mts` (FOLLOW-1191 / audit finding E-1):
 *   `apps/control-plane` has no `"type": "module"`, so `src/lib/*.ts` is CJS
 *   under `tsx`, while a `.mts` entrypoint is ESM. Across that boundary Node's
 *   cjs-module-lexer cannot see esbuild's generated getters, so EVERY named
 *   import from `src/lib/` failed at module instantiation —
 *   `does not provide an export named 'ARCHETYPE_EMBEDDING_DIM'` — and this
 *   script had not run anywhere since 2026-06-25. A `.ts` entrypoint sits in
 *   the SAME CJS graph as the module it imports, so named imports resolve.
 *   `"type": "module"` on the app was rejected: it would flip the whole Next.js
 *   module graph, and `src/lib/seed-listing-embeddings.ts` is imported by a
 *   route. Changing the specifier to `.ts` was tried and does NOT help — module
 *   kind comes from the importing file's own extension, not the specifier.
 *
 * Connection (see resolveSeedTarget in src/lib/archetype-seeder.ts):
 *   - Hosted: Supabase PostgREST (HTTP) with the service_role key — no direct
 *     Postgres connection required. service_role bypasses all RLS policies per
 *     Supabase design. The Supabase direct host is IPv6-only and unreachable
 *     from GitHub Actions and many CI environments.
 *   - Localhost: a direct Postgres connection when DATABASE_URL_ADMIN points at
 *     a loopback host. Non-loopback direct writes are refused.
 *
 * Credentials (in priority order):
 *   1. DATABASE_URL_ADMIN on a loopback host — direct write to local Postgres
 *   2. SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL — explicit, fastest
 *   3. SUPABASE_ACCESS_TOKEN — Management API fetches the service_role key
 *
 * Refresh cadence:
 *   MVP:      one-shot manual run after any archetype description change.
 *             Trigger:  `pnpm seed:archetypes`
 *   Post-MVP: daily Modal cron in apps/archetype-pipeline (future FOLLOW-NNN).
 *
 * Idempotency:
 *   The job only touches rows WHERE embedding IS NULL. Re-running with all
 *   rows populated is a no-op (logs "nothing to seed").
 *
 * Failure handling:
 *   Per-archetype errors are logged and skipped. Exit 1 only if every
 *   attempted row failed.
 *
 * Usage:
 *   pnpm seed:archetypes
 *   FORCE_RESEED=true pnpm seed:archetypes   # clears & re-embeds all rows
 *   pnpm seed:archetypes --import-check      # resolve imports only; no DB, no OpenAI
 *
 *   # localhost (loopback override must come AFTER doppler run, not before it)
 *   doppler run -c dev -- env \
 *     DATABASE_URL_ADMIN='postgresql://supabase_admin:postgres@127.0.0.1:5433/postgres' \
 *     pnpm seed:archetypes
 */

// Core seeding logic lives in src/lib/archetype-seeder.ts (testable module).
import { ARCHETYPE_EMBEDDING_DIM, seedArchetypeEmbeddings } from '../src/lib/archetype-seeder.js';

// Re-export for consumers that imported these from this script directly.
export { seedArchetypeEmbeddings, ARCHETYPE_EMBEDDING_DIM };

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

const isMain =
  typeof process !== 'undefined' &&
  Array.isArray(process.argv) &&
  process.argv[1] !== undefined &&
  (process.argv[1].endsWith('seed-archetypes.ts') ||
    process.argv[1].endsWith('seed-archetypes.js'));

/**
 * `--import-check`: prove the module boundary resolves, without a database, an
 * OpenAI key or any credential. This is what the `Seed script import check`
 * CI job runs on every PR — the gate that finding E-1 did not have.
 */
if (isMain && process.argv.includes('--import-check')) {
  console.log(
    `[seed-archetypes] import-check OK: ARCHETYPE_EMBEDDING_DIM=${String(ARCHETYPE_EMBEDDING_DIM)}, ` +
      `seedArchetypeEmbeddings=${typeof seedArchetypeEmbeddings}`,
  );
  process.exit(0);
}

if (isMain) {
  seedArchetypeEmbeddings()
    .then((result) => {
      const allFailed = result.attempted > 0 && result.succeeded === 0;
      process.exit(allFailed ? 1 : 0);
    })
    .catch((err: unknown) => {
      console.error(
        '[seed-archetypes] fatal error:',
        err instanceof Error ? (err.stack ?? err.message) : err,
      );
      process.exit(1);
    });
}
