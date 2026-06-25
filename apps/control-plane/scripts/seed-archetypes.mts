/**
 * scripts/seed-archetypes.mts — CLI entrypoint for archetype embedding seeder.
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
 * Connection:
 *   Uses Supabase PostgREST (HTTP) with the service_role key — no direct
 *   Postgres connection required. service_role bypasses all RLS policies per
 *   Supabase design. The Supabase direct host is IPv6-only and unreachable
 *   from GitHub Actions and many CI environments.
 *
 * Credentials (in priority order):
 *   1. SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL — explicit, fastest
 *   2. SUPABASE_ACCESS_TOKEN — Management API fetches the service_role key
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
  (process.argv[1].endsWith('seed-archetypes.mts') ||
    process.argv[1].endsWith('seed-archetypes.ts') ||
    process.argv[1].endsWith('seed-archetypes.js'));

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
