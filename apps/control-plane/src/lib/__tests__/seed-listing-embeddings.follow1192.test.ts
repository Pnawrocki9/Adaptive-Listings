/**
 * FOLLOW-1192 — the FOLLOW-819 fixture's listing id MUST be a member of the
 * set `DEMO_LISTING_MANIFEST` seeds, or a browser-driven request against that
 * fixture always falls back to djb2.
 *
 * WHY THIS EXISTS. RETRO-324 §4a LG-1: `DEMO_LISTING_MANIFEST`
 * (`../seed-listing-embeddings.ts`) was hardcoded to `listing-001` …
 * `listing-012`, and `tests/e2e/follow-819/fixture-listing.html` declares
 * `data-estalara-listing-id="839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c"`. The SDK
 * sends the DOM's id in the adapt request; nothing seeded an embedding row
 * for it, so `fetchListingEmbeddings()` found nothing and `affinityScore()`
 * fell back to the djb2 deterministic scorer, even once #892 made
 * `archetype_embeddings` and `listing_embeddings` both non-empty.
 *
 * WHAT THIS ASSERTS, AND WHY IT IS NOT AN INJECTION TEST. It reads the REAL
 * fixture file off disk — no hand-copied id — and checks it against the REAL
 * `DEMO_LISTING_MANIFEST` import. If either side moves and they stop
 * agreeing, this reds in `pnpm --filter control-plane test` instead of only
 * in a full browser-driven harness run that needs Docker + Doppler + a live
 * control plane to reproduce. Precedent shape:
 * `packages/sdk/src/__tests__/follow-1139-fixture-contract.test.ts`.
 *
 * @module apps/control-plane/src/lib/__tests__/seed-listing-embeddings.follow1192.test
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

import { DEMO_LISTING_MANIFEST } from '../seed-listing-embeddings';

const __dirname = dirname(fileURLToPath(import.meta.url));

// apps/control-plane/src/lib/__tests__ -> repo root is 5 levels up.
const FIXTURE_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  '..',
  'tests',
  'e2e',
  'follow-819',
  'fixture-listing.html',
);

/** Read the REAL fixture's `data-estalara-listing-id` attribute off disk. */
function fixtureListingId(): string {
  const html = readFileSync(FIXTURE_PATH, 'utf8');
  const match = /data-estalara-listing-id="([^"]+)"/.exec(html);
  expect(match, 'fixture declares data-estalara-listing-id').not.toBeNull();
  return match![1]!;
}

describe('FOLLOW-1192 — DEMO_LISTING_MANIFEST covers the FOLLOW-819 fixture listing id', () => {
  it('the fixture id is a member of the seeded manifest', () => {
    const fixtureId = fixtureListingId();
    const seededIds = DEMO_LISTING_MANIFEST.map((l) => l.listing_id);
    expect(seededIds).toContain(fixtureId);
  });

  it('the fixture declares exactly one data-estalara-listing-id (no ambiguity)', () => {
    const html = readFileSync(FIXTURE_PATH, 'utf8');
    const matches = html.match(/data-estalara-listing-id="[^"]+"/g) ?? [];
    expect(matches).toHaveLength(1);
  });
});
