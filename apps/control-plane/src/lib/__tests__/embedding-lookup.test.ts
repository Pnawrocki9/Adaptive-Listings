/**
 * Unit tests for embedding-lookup.ts
 *
 * Covers the FOLLOW-043 contract: once the archetype_embeddings table has
 * been seeded with 1024-dim vectors (by scripts/seed-archetype-embeddings.ts),
 * fetchArchetypeEmbedding() must return a non-null number[] of length 1024
 * so the cosine-affinity path in the adapt route becomes reachable.
 *
 * Mocks @estalara/db so no real DB connection is required.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @estalara/db BEFORE importing the module under test
// ---------------------------------------------------------------------------

interface ArchetypeRow {
  embedding: number[] | null;
}

interface ListingRow {
  listingId: string;
  embedding: number[] | null;
}

let mockArchetypeRows: ArchetypeRow[] = [];
let mockListingRows: ListingRow[] = [];
let shouldThrow: 'archetype' | 'listing' | null = null;

// Chain builders matching the Drizzle .select().from().where().limit() shape.
// The leaf `limit` / `where` returns a promise (Drizzle queries are PromiseLike)
// using Promise.resolve so we keep ESLint's require-await rule satisfied without
// marking the function async.
function archetypeChain() {
  return {
    from: () => ({
      where: () => ({
        limit: () => {
          if (shouldThrow === 'archetype') {
            return Promise.reject(new Error('DB connection refused'));
          }
          return Promise.resolve(mockArchetypeRows);
        },
      }),
    }),
  };
}

function listingChain() {
  return {
    from: () => ({
      where: () => {
        if (shouldThrow === 'listing') {
          return Promise.reject(new Error('DB connection refused'));
        }
        return Promise.resolve(mockListingRows);
      },
    }),
  };
}

// `select()` is called once per lookup. We don't have access to the table
// argument from `from()`, but the suite alternates by manipulating which
// mock dataset is "active" before each call.
let nextChain: 'archetype' | 'listing' = 'archetype';

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({
    select: vi.fn(() => (nextChain === 'archetype' ? archetypeChain() : listingChain())),
  })),
  archetypeEmbeddings: {
    embedding: 'embedding',
    archetypeName: 'archetype_name',
  },
  listingEmbeddings: {
    tenantId: 'tenant_id',
    listingId: 'listing_id',
    embedding: 'embedding',
  },
}));

// Import after mocking.
const { fetchArchetypeEmbedding, fetchListingEmbeddings } = await import('@/lib/embedding-lookup');

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const ARCHETYPE_DIM = 1024;
const SEEDED_VECTOR: number[] = Array.from({ length: ARCHETYPE_DIM }, (_, i) => (i % 100) / 100);

// ---------------------------------------------------------------------------
// fetchArchetypeEmbedding
// ---------------------------------------------------------------------------

describe('fetchArchetypeEmbedding — FOLLOW-043 contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextChain = 'archetype';
    mockArchetypeRows = [];
    shouldThrow = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a 1024-dim number[] after seed populates the archetype row', async () => {
    // Simulate post-seed state: family_buyer row has its 1024-dim vector.
    mockArchetypeRows = [{ embedding: SEEDED_VECTOR }];

    const result = await fetchArchetypeEmbedding('family_buyer');

    expect(result).not.toBeNull();
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(ARCHETYPE_DIM);
    // First element matches the deterministic fixture.
    expect(result?.[0]).toBe(0);
    // Vector content is preserved end-to-end.
    expect(result).toEqual(SEEDED_VECTOR);
  });

  it('returns null when the archetype row exists but embedding is NULL (pre-seed)', async () => {
    // Simulate the pre-seed state from 0005_seed_archetype_embeddings.sql.
    mockArchetypeRows = [{ embedding: null }];

    const result = await fetchArchetypeEmbedding('family_buyer');

    expect(result).toBeNull();
  });

  it('returns null when the archetype row does not exist', async () => {
    mockArchetypeRows = [];

    const result = await fetchArchetypeEmbedding('unknown_archetype');

    expect(result).toBeNull();
  });

  it('returns null when embedding is an empty array', async () => {
    mockArchetypeRows = [{ embedding: [] }];

    const result = await fetchArchetypeEmbedding('family_buyer');

    expect(result).toBeNull();
  });

  it('fails open and returns null when DB throws (no exception propagates)', async () => {
    shouldThrow = 'archetype';

    const result = await fetchArchetypeEmbedding('family_buyer');

    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// fetchListingEmbeddings (sanity — already covered elsewhere, light pass)
// ---------------------------------------------------------------------------

describe('fetchListingEmbeddings — fail-open contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nextChain = 'listing';
    mockListingRows = [];
    shouldThrow = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an empty map when no listing ids are requested', async () => {
    const result = await fetchListingEmbeddings(TENANT_A, []);
    expect(result.size).toBe(0);
  });

  it('returns a populated map keyed by listing_id', async () => {
    mockListingRows = [
      { listingId: 'L1', embedding: SEEDED_VECTOR },
      { listingId: 'L2', embedding: null },
    ];

    const result = await fetchListingEmbeddings(TENANT_A, ['L1', 'L2']);

    expect(result.size).toBe(2);
    expect(result.get('L1')).toEqual(SEEDED_VECTOR);
    expect(result.get('L2')).toBeNull();
  });

  it('returns an empty map when DB throws (fail-open)', async () => {
    shouldThrow = 'listing';

    const result = await fetchListingEmbeddings(TENANT_A, ['L1']);

    expect(result.size).toBe(0);
  });
});
