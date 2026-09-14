/**
 * Unit tests for the listing half of the cosine co-location check (FOLLOW-1193).
 *
 * Cosine affinity needs BOTH `archetype_embeddings` and `listing_embeddings`
 * populated in the SAME database. The archetype half has had an evaluator since
 * FOLLOW-1191; the listing half had nothing, so a database with 18 archetype
 * vectors and zero listing vectors — or the reverse — looked seeded to every
 * check that existed. These cases are the red-first evidence: an empty listing
 * table for the named tenant must FAIL, and so must a zero floor, which would
 * otherwise pass that empty table vacuously (the E-5 shape).
 *
 * @module packages/db/src/__tests__/assert-listing-embeddings.test
 */

import { describe, expect, it } from 'vitest';

import { EXPECTED_EMBEDDING_DIM } from '../archetype-embedding-assert.js';
import {
  evaluateListingEmbeddings,
  type ListingEmbeddingRow,
} from '../listing-embedding-assert.js';

const FIXTURE_LISTING = '839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c';

function goodRows(n: number): ListingEmbeddingRow[] {
  const rows: ListingEmbeddingRow[] = Array.from({ length: n - 1 }, (_, i) => ({
    listing_id: `listing-${String(i + 1).padStart(3, '0')}`,
    dims: EXPECTED_EMBEDDING_DIM,
  }));
  rows.push({ listing_id: FIXTURE_LISTING, dims: EXPECTED_EMBEDDING_DIM });
  return rows;
}

describe('evaluateListingEmbeddings', () => {
  it('FAILS on an empty listing table for the tenant', () => {
    const failures = evaluateListingEmbeddings([], { minRows: 13 });
    expect(failures.join(' ')).toContain('0 listing embedding row(s)');
  });

  it('FAILS when the floor is 0 — a zero floor would pass an empty table vacuously', () => {
    const failures = evaluateListingEmbeddings([], { minRows: 0 });
    expect(failures.join(' ')).toContain('minRows must be >= 1');
  });

  it('passes on 13 non-NULL 1024-dim rows including the required fixture listing', () => {
    expect(
      evaluateListingEmbeddings(goodRows(13), {
        minRows: 13,
        requiredListingIds: [FIXTURE_LISTING],
      }),
    ).toEqual([]);
  });

  it('FAILS below the floor (12 of 13 — the pre-#905 seed)', () => {
    const failures = evaluateListingEmbeddings(goodRows(12), { minRows: 13 });
    expect(failures.join(' ')).toContain('12 listing embedding row(s)');
  });

  it('FAILS when a required listing id is absent even if the count is met', () => {
    const rows = goodRows(14).filter((r) => r.listing_id !== FIXTURE_LISTING);
    const failures = evaluateListingEmbeddings(rows, {
      minRows: 13,
      requiredListingIds: [FIXTURE_LISTING],
    });
    expect(failures.join(' ')).toContain(`absent: ${FIXTURE_LISTING}`);
  });

  it('FAILS on a NULL embedding', () => {
    const rows = goodRows(13);
    rows[0] = { listing_id: rows[0]!.listing_id, dims: null };
    expect(evaluateListingEmbeddings(rows, { minRows: 13 }).join(' ')).toContain('NULL embedding');
  });

  it('FAILS on a wrong dimensionality', () => {
    const rows = goodRows(13);
    rows[3] = { listing_id: rows[3]!.listing_id, dims: 1536 };
    expect(evaluateListingEmbeddings(rows, { minRows: 13 }).join(' ')).toContain('not 1024-dim');
  });
});
