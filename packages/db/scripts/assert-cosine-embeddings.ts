/**
 * assert-cosine-embeddings.ts — ONE command that proves the cosine path's two
 * inputs are populated in ONE database (FOLLOW-1193).
 *
 * The adapt route reads `archetype_embeddings` and `listing_embeddings` through
 * the same admin client. `pnpm seed:archetypes` picks its database from its own
 * env; `pnpm seed:listings` writes wherever the control plane it POSTs to was
 * started. Checking each table in a separate session, against separately-typed
 * URLs, is how two green seeders end up in two different databases. This CLI
 * opens a single connection and runs both evaluators over it:
 *
 *   - archetype half: `evaluateArchetypeEmbeddings` (same assertion as the
 *     `Archetype embeddings not-NULL check` CI gate — 18 rows, non-NULL, 1024-dim,
 *     every seeded name)
 *   - listing half:   `evaluateListingEmbeddings` for `--tenant` — at least
 *     `--min-rows` rows, non-NULL, 1024-dim, every `--require-listing` present
 *
 * It prints the database it checked (host:port/name — never credentials) first,
 * and exits 1 if EITHER half fails.
 *
 * Usage (from the repo root; `$DATABASE_URL_ADMIN` is the loopback URL):
 *
 *   DATABASE_URL_ADMIN="$DATABASE_URL_ADMIN" pnpm db:assert:cosine \
 *     --tenant 00000000-0000-0000-0000-0000000000e2 --min-rows 13 \
 *     --require-listing 839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c
 *
 * `--tenant` and `--min-rows` have no defaults on purpose: a default tenant is a
 * guess, and a default floor of 0 passes an empty table.
 *
 * Not run in CI (see the FOLLOW-1193 PR): CI's DB gate reads the hosted `dev`
 * project, where no tenant has a committed listing-embedding contract and the
 * listing seed needs a running control plane. The evaluators' unit tests run in
 * the `Archetype embeddings not-NULL check` job's self-test step.
 *
 * Uses `postgres` + raw SQL (not Drizzle) for `vector_dims()` and so it needs no
 * `dist/` build, exactly like `assert-archetype-embeddings.ts`.
 */

import { parseArgs } from 'node:util';

import postgres from 'postgres';

import {
  EXPECTED_EMBEDDING_DIM,
  evaluateArchetypeEmbeddings,
  type ArchetypeEmbeddingRow,
} from '../src/archetype-embedding-assert.js';
import { describeDatabaseUrl } from '../src/client.js';
import {
  evaluateListingEmbeddings,
  type ListingEmbeddingExpectation,
  type ListingEmbeddingRow,
} from '../src/listing-embedding-assert.js';
import { ARCHETYPE_SEEDS } from '../src/seed/archetype-seeds.js';

const TAG = '[cosine-embeddings]';

function fail(message: string): never {
  console.error(`${TAG} ERROR: ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      tenant: { type: 'string' },
      'min-rows': { type: 'string' },
      'require-listing': { type: 'string', multiple: true },
    },
  });

  const tenantId = values.tenant;
  if (!tenantId) fail('--tenant <uuid> is required (listing embeddings are tenant-scoped).');
  const minRows = Number(values['min-rows']);
  if (values['min-rows'] === undefined || !Number.isInteger(minRows) || minRows < 1)
    fail('--min-rows <n> is required and must be an integer >= 1.');
  const requiredListingIds = values['require-listing'] ?? [];

  const url = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT;
  if (!url) fail('DATABASE_URL_ADMIN is not set.');

  const target = describeDatabaseUrl(url);
  console.log(`${TAG} database: ${target.host}:${target.port}/${target.name}`);

  // One connection for both halves: that is the co-location claim.
  const sql = postgres(url, { max: 1, prepare: false });
  let archetypeRows: ArchetypeEmbeddingRow[];
  let listingRows: ListingEmbeddingRow[];
  try {
    archetypeRows = await sql<ArchetypeEmbeddingRow[]>`
      SELECT archetype_name, vector_dims(embedding) AS dims
      FROM archetype_embeddings
      ORDER BY archetype_name
    `;
    listingRows = await sql<ListingEmbeddingRow[]>`
      SELECT listing_id, vector_dims(embedding) AS dims
      FROM listing_embeddings
      WHERE tenant_id = ${tenantId}
      ORDER BY listing_id
    `;
  } finally {
    // postgres-js holds the socket open; without this the process hangs.
    await sql.end({ timeout: 5 });
  }

  const expectedNames = ARCHETYPE_SEEDS.map((s) => s.archetypeName);
  const archetypeFailures = evaluateArchetypeEmbeddings(archetypeRows, expectedNames);
  const expectation: ListingEmbeddingExpectation = { minRows, requiredListingIds };
  const listingFailures = evaluateListingEmbeddings(listingRows, expectation);

  if (archetypeFailures.length === 0) {
    console.log(
      `${TAG} archetype half PASS: ${String(archetypeRows.length)} rows, non-NULL, ` +
        `${String(EXPECTED_EMBEDDING_DIM)}-dim, all ${String(expectedNames.length)} seeded names present.`,
    );
  } else {
    for (const f of archetypeFailures) console.error(`${TAG} archetype half FAIL: ${f}`);
  }

  if (listingFailures.length === 0) {
    const required =
      requiredListingIds.length > 0 ? `, including ${requiredListingIds.join(', ')}` : '';
    console.log(
      `${TAG} listing half PASS: ${String(listingRows.length)} rows for tenant ${tenantId} ` +
        `(>= ${String(minRows)}), non-NULL, ${String(EXPECTED_EMBEDDING_DIM)}-dim${required}.`,
    );
  } else {
    for (const f of listingFailures) console.error(`${TAG} listing half FAIL: ${f}`);
  }

  if (archetypeFailures.length > 0 || listingFailures.length > 0) {
    console.error(
      `${TAG} FAIL: cosine scoring needs BOTH halves in THIS database ` +
        `(${target.host}:${target.port}/${target.name}). Seed the missing half against the same ` +
        'DATABASE_URL_ADMIN, and check the "database" line each seeder printed — see README ' +
        '"Local development setup" §2/§3.',
    );
    process.exit(1);
  }

  console.log(
    `${TAG} PASS: both halves populated in ${target.host}:${target.port}/${target.name}.`,
  );
  process.exit(0);
}

main().catch((err: unknown) => {
  console.error(`${TAG} fatal error:`, err instanceof Error ? err.message : err);
  process.exit(1);
});
