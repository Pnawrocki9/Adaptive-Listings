/**
 * scripts/seed-estalara-listings.ts — one-shot listing embedding seeder
 * for the 000-app-estalara canonical fixture.
 *
 * Purpose:
 *   The adapt path uses `fetchListingEmbeddings()` to compute real cosine
 *   affinity between listings and archetypes. Without populated embeddings,
 *   `affinityScore()` always falls back to the djb2 hash deterministic scorer
 *   even though the cosine path is now wired (FOLLOW-019 + FOLLOW-043).
 *
 *   This script seeds every entry of `DEMO_LISTING_MANIFEST` (the 000-app-estalara
 *   demo listings plus the FOLLOW-819 fixture listing — the manifest is the count,
 *   this docblock deliberately does not repeat it), so the demo tenant has real
 *   embedding vectors and the cosine affinity path can be exercised.
 *
 * WHICH DATABASE (FOLLOW-1193):
 *   This script has no database of its own. Rows land wherever the control plane
 *   at NEXT_PUBLIC_APP_URL was started with `DATABASE_URL_ADMIN` pointing. The
 *   route reports that database (host:port/name) and this script prints it as
 *   `database  : …`. It must be the SAME database `pnpm seed:archetypes` printed
 *   as its target — cosine needs both tables in one database. If a loopback plane
 *   reports a non-loopback database (a plane started with a bare
 *   `doppler run -c dev`, which resolves hosted Supabase), the script STOPS after
 *   that first write. Verify both halves with `pnpm db:assert:cosine`.
 *
 * Auth strategy:
 *   Uses `x-internal-api-secret` header against POST /api/listings/embed.
 *   The control plane URL and secret are read from env vars. No JWT required.
 *
 * Credentials (in priority order):
 *   NEXT_PUBLIC_APP_URL     — control-plane base URL (default: http://localhost:3000)
 *   INTERNAL_API_SECRET     — service-to-service shared secret
 *   DEMO_TENANT_ID          — the UUID of the demo / 000-app-estalara tenant
 *
 * Idempotency:
 *   POST /api/listings/embed uses upsert semantics (ON CONFLICT DO UPDATE).
 *   Re-running this script is safe and overwrites existing embeddings.
 *
 * Failure handling:
 *   Per-listing errors are logged and skipped. Exit 1 only if every attempt fails.
 *
 * WHY THIS FILE IS `.ts` AND NOT `.mts` (FOLLOW-1191 / audit finding E-1):
 *   see the same note in scripts/seed-archetypes.ts. A `.mts` (ESM) entrypoint
 *   could not read a named export out of `src/lib/*.ts` (CJS under `tsx`), so
 *   this script died at module instantiation on every invocation since
 *   2026-06-25 with
 *   `does not provide an export named 'DEMO_LISTING_MANIFEST'`.
 *
 * Usage:
 *   pnpm seed:listings
 *   pnpm seed:listings --import-check   # resolve imports only; no HTTP, no env
 *   # or with env:
 *   DEMO_TENANT_ID=uuid INTERNAL_API_SECRET=secret NEXT_PUBLIC_APP_URL=https://admin.estalara.com pnpm seed:listings
 *
 * Related:
 *   apps/control-plane/scripts/seed-archetypes.ts — seeds archetype embeddings
 *   apps/control-plane/src/lib/seed-listing-embeddings.ts — reusable seeding logic
 */

import {
  DEMO_LISTING_MANIFEST,
  embedOneListing,
  isSplitSeedTarget,
  type SeedDatabaseTarget,
} from '../src/lib/seed-listing-embeddings.js';

function formatTarget(db: SeedDatabaseTarget): string {
  return `${db.host}:${db.port}/${db.name}`;
}

// ─── Entrypoint ───────────────────────────────────────────────────────────────

/**
 * `--import-check`: prove the module boundary resolves, without env vars, a
 * running control plane or an OpenAI key. Run by the `Seed script import check`
 * CI job on every PR — the gate that finding E-1 did not have.
 */
function importCheck(): void {
  console.log(
    `[seed-estalara-listings] import-check OK: DEMO_LISTING_MANIFEST=${String(DEMO_LISTING_MANIFEST.length)} listing(s), ` +
      `embedOneListing=${typeof embedOneListing}`,
  );
}

async function main(): Promise<void> {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  const secret = process.env.INTERNAL_API_SECRET;
  const tenantId = process.env.DEMO_TENANT_ID;

  if (!secret) {
    console.error(
      '[seed-estalara-listings] INTERNAL_API_SECRET is not set.\n' +
        'Set it in your .env.local or pass it as an env var.\n' +
        'Example: INTERNAL_API_SECRET=<secret> pnpm seed:listings',
    );
    process.exit(1);
  }

  if (!tenantId) {
    console.error(
      '[seed-estalara-listings] DEMO_TENANT_ID is not set.\n' +
        'Set it to the UUID of your demo tenant (000-app-estalara).\n' +
        'Example: DEMO_TENANT_ID=<uuid> pnpm seed:listings',
    );
    process.exit(1);
  }

  console.log('[seed-estalara-listings] Starting listing embedding seed.');
  console.log(`  base_url  : ${baseUrl}`);
  console.log(`  tenant_id : ${tenantId}`);
  console.log(`  listings  : ${String(DEMO_LISTING_MANIFEST.length)}`);

  let succeeded = 0;
  let failed = 0;
  let reported: string | undefined;

  for (const listing of DEMO_LISTING_MANIFEST) {
    const result = await embedOneListing(baseUrl, secret, tenantId, listing);
    if (result.ok) {
      // FOLLOW-1193: print the database the SERVER wrote to, once, and flag any change.
      const target = result.database ? formatTarget(result.database) : undefined;
      if (reported === undefined) {
        reported = target ?? 'unknown (server did not report one; it predates FOLLOW-1193)';
        console.log(`  database  : ${reported}  (resolved by the control plane at base_url)`);
        if (result.database && isSplitSeedTarget(baseUrl, result.database)) {
          console.error(
            `[seed-estalara-listings] STOP: the control plane at ${baseUrl} is local but wrote to ` +
              `${reported}, which is NOT a loopback database. It was started with a hosted ` +
              'DATABASE_URL_ADMIN (e.g. a bare `doppler run -c dev`). Restart it with the loopback ' +
              'override AFTER `doppler run` (`doppler run -c dev -- env DATABASE_URL_ADMIN=…`). ' +
              `One listing (${listing.listing_id}) was already upserted there.`,
          );
          process.exit(1);
        }
      } else if (target !== undefined && target !== reported) {
        console.error(`  WARNING: database changed mid-run: ${reported} -> ${target}`);
      }
      console.log(`  [ok] ${listing.listing_id} — "${listing.title ?? '(no title)'}"`);
      succeeded += 1;
    } else {
      console.error(`  [FAIL] ${listing.listing_id}: ${result.error ?? 'unknown error'}`);
      failed += 1;
    }
  }

  console.log(
    `\n[seed-estalara-listings] done. attempted=${String(DEMO_LISTING_MANIFEST.length)} succeeded=${String(succeeded)} failed=${String(failed)} database=${reported ?? 'none (no successful write)'}`,
  );

  if (succeeded === 0 && failed > 0) {
    console.error('[seed-estalara-listings] All attempts failed — exiting with code 1.');
    process.exit(1);
  }
}

if (process.argv.includes('--import-check')) {
  importCheck();
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(
    '[seed-estalara-listings] Fatal error:',
    err instanceof Error ? (err.stack ?? err.message) : err,
  );
  process.exit(1);
});
