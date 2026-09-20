/**
 * listing-embedding-assert.ts — the listing half of the cosine co-location check.
 *
 * FOLLOW-1193 / RETRO-324 §4a LG-2. The adapt route's cosine affinity reads
 * `archetype_embeddings` AND `listing_embeddings` through the same
 * `createAdminClient()`, so both must be populated in the SAME database. The
 * archetype half has had {@link evaluateArchetypeEmbeddings} since FOLLOW-1191;
 * the listing half had no assertion at all, and the two seeders pick their
 * database by different mechanisms (`seed:archetypes` from its own env,
 * `seed:listings` from whatever the control plane it POSTs to was started
 * with). Two green seeders could therefore write two different databases and
 * nothing would say so.
 *
 * What it asserts, for ONE named tenant (listing ids are tenant-scoped):
 *   1. `minRows >= 1`                         — a zero floor passes an empty table
 *   2. row count >= minRows                   — kills the empty / partial seed
 *   3. no row has a NULL embedding
 *   4. every embedding has vector_dims() == 1024
 *   5. every `requiredListingIds` entry exists — 13 rows of the wrong listings
 *      would satisfy (2) on its own
 *
 * Consumed by:
 *   - packages/db/scripts/assert-cosine-embeddings.ts (the operator CLI, which
 *     runs this and the archetype evaluator over ONE connection)
 *
 * @module @estalara/db/listing-embedding-assert
 */

import { EXPECTED_EMBEDDING_DIM } from './archetype-embedding-assert.js';

/** One `listing_embeddings` row as the assertion reads it. `dims` is NULL exactly when `embedding` is. */
export interface ListingEmbeddingRow {
  listing_id: string;
  dims: number | null;
}

/** What the listing half requires of the named tenant. */
export interface ListingEmbeddingExpectation {
  /** Minimum row count for the tenant. Must be >= 1. */
  minRows: number;
  /** Listing ids that must be present (e.g. the FOLLOW-819 fixture listing). */
  requiredListingIds?: readonly string[];
}

/**
 * Pure evaluation of one tenant's `listing_embeddings` snapshot. Returns
 * human-readable failures — empty means the listing half passes.
 */
export function evaluateListingEmbeddings(
  rows: ListingEmbeddingRow[],
  expectation: ListingEmbeddingExpectation,
  expectedDim = EXPECTED_EMBEDDING_DIM,
): string[] {
  const failures: string[] = [];
  const { minRows, requiredListingIds = [] } = expectation;

  if (!Number.isInteger(minRows) || minRows < 1) {
    failures.push(
      `minRows must be >= 1 (got ${String(minRows)}); a zero floor passes an empty table vacuously.`,
    );
  }

  if (rows.length < minRows) {
    failures.push(
      `${String(rows.length)} listing embedding row(s) for the tenant, expected at least ${String(minRows)}.`,
    );
  }

  const nullRows = rows.filter((r) => r.dims === null).map((r) => r.listing_id);
  if (nullRows.length > 0) {
    failures.push(
      `${String(nullRows.length)} listing(s) have a NULL embedding: ${nullRows.join(', ')}`,
    );
  }

  const wrongDim = rows
    .filter((r) => r.dims !== null && r.dims !== expectedDim)
    .map((r) => `${r.listing_id}=${String(r.dims)}`);
  if (wrongDim.length > 0) {
    failures.push(
      `${String(wrongDim.length)} listing(s) are not ${String(expectedDim)}-dim: ${wrongDim.join(', ')}`,
    );
  }

  const present = new Set(rows.map((r) => r.listing_id));
  const missing = requiredListingIds.filter((id) => !present.has(id));
  if (missing.length > 0) {
    failures.push(`${String(missing.length)} required listing(s) absent: ${missing.join(', ')}`);
  }

  return failures;
}
