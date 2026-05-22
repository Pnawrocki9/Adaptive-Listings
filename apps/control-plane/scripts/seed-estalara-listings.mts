/**
 * scripts/seed-estalara-listings.mts — one-shot listing embedding seeder
 * for the 000-app-estalara canonical fixture.
 *
 * Purpose:
 *   The adapt path uses `fetchListingEmbeddings()` to compute real cosine
 *   affinity between listings and archetypes. Without populated embeddings,
 *   `affinityScore()` always falls back to the djb2 hash deterministic scorer
 *   even though the cosine path is now wired (FOLLOW-019 + FOLLOW-043).
 *
 *   This script seeds the 12 canonical demo listings for the 000-app-estalara
 *   fixture, ensuring the demo tenant has real embedding vectors and the cosine
 *   affinity path is exercised in the Sprint 9.5 demo.
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
 * Usage:
 *   pnpm seed:listings
 *   # or with env:
 *   DEMO_TENANT_ID=uuid INTERNAL_API_SECRET=secret NEXT_PUBLIC_APP_URL=https://admin.estalara.com pnpm seed:listings
 *
 * Related:
 *   apps/control-plane/scripts/seed-archetypes.mts — seeds archetype embeddings
 *   apps/control-plane/src/lib/seed-listing-embeddings.ts — reusable seeding logic
 */

import { DEMO_LISTING_MANIFEST, embedOneListing } from '../src/lib/seed-listing-embeddings.js';

// ─── Entrypoint ───────────────────────────────────────────────────────────────

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

  for (const listing of DEMO_LISTING_MANIFEST) {
    const result = await embedOneListing(baseUrl, secret, tenantId, listing);
    if (result.ok) {
      console.log(`  [ok] ${listing.listing_id} — "${listing.title ?? '(no title)'}"`);
      succeeded += 1;
    } else {
      console.error(`  [FAIL] ${listing.listing_id}: ${result.error ?? 'unknown error'}`);
      failed += 1;
    }
  }

  console.log(
    `\n[seed-estalara-listings] done. attempted=${String(DEMO_LISTING_MANIFEST.length)} succeeded=${String(succeeded)} failed=${String(failed)}`,
  );

  if (succeeded === 0 && failed > 0) {
    console.error('[seed-estalara-listings] All attempts failed — exiting with code 1.');
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(
    '[seed-estalara-listings] Fatal error:',
    err instanceof Error ? (err.stack ?? err.message) : err,
  );
  process.exit(1);
});
