/**
 * Unit tests for rag-retrieval.ts
 *
 * Mocks @estalara/db createAdminClient so no real DB connection is needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @estalara/db BEFORE importing the module under test
// ---------------------------------------------------------------------------

const mockExecute = vi.fn();

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({
    execute: mockExecute,
  })),
  answers: {},
}));

// Import after mocking
const { retrieveListingContext } = await import('@/lib/rag-retrieval');

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const LISTING_ID = 'listing-abc-123';
const INTENT_VECTOR = Array.from({ length: 1536 }, (_, i) => (i % 10) / 10);

describe('retrieveListingContext — short-circuit conditions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns {} when listingId is null', async () => {
    const result = await retrieveListingContext(TENANT_A, null, INTENT_VECTOR);
    expect(result).toEqual({});
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('returns {} when listingId is undefined', async () => {
    const result = await retrieveListingContext(TENANT_A, undefined, INTENT_VECTOR);
    expect(result).toEqual({});
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('returns {} when intentVector is null', async () => {
    const result = await retrieveListingContext(TENANT_A, LISTING_ID, null);
    expect(result).toEqual({});
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('returns {} when intentVector is undefined', async () => {
    const result = await retrieveListingContext(TENANT_A, LISTING_ID, undefined);
    expect(result).toEqual({});
    expect(mockExecute).not.toHaveBeenCalled();
  });

  it('returns {} when intentVector is empty array', async () => {
    const result = await retrieveListingContext(TENANT_A, LISTING_ID, []);
    expect(result).toEqual({});
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe('retrieveListingContext — top-3 selection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns top-3 as { question: answer } map when DB returns rows', async () => {
    mockExecute.mockResolvedValue([
      { question: 'What is the yield?', answer: '6.5%' },
      { question: 'How many bedrooms?', answer: '3' },
      { question: 'Is it furnished?', answer: 'Yes' },
    ]);

    const result = await retrieveListingContext(TENANT_A, LISTING_ID, INTENT_VECTOR);

    expect(result).toEqual({
      'What is the yield?': '6.5%',
      'How many bedrooms?': '3',
      'Is it furnished?': 'Yes',
    });
    expect(mockExecute).toHaveBeenCalledOnce();
  });

  it('returns {} when DB returns no rows', async () => {
    mockExecute.mockResolvedValue([]);

    const result = await retrieveListingContext(TENANT_A, LISTING_ID, INTENT_VECTOR);
    expect(result).toEqual({});
  });

  it('returns partial map when DB returns fewer than 3 rows', async () => {
    mockExecute.mockResolvedValue([{ question: 'What is the yield?', answer: '5.8%' }]);

    const result = await retrieveListingContext(TENANT_A, LISTING_ID, INTENT_VECTOR);
    expect(result).toEqual({ 'What is the yield?': '5.8%' });
  });

  it('fails open and returns {} when DB throws', async () => {
    mockExecute.mockRejectedValue(new Error('DB connection refused'));

    const result = await retrieveListingContext(TENANT_A, LISTING_ID, INTENT_VECTOR);
    expect(result).toEqual({});
    // Must not throw
  });
});

describe('retrieveListingContext — RLS isolation (conceptual)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('queries with tenant_id so tenant A cannot see tenant B rows', async () => {
    const TENANT_B = '22222222-2222-2222-2222-222222222222';
    mockExecute.mockResolvedValue([{ question: 'Tenant B Q?', answer: 'Tenant B A' }]);

    // Call for TENANT_B — mock returns the row. The WHERE clause with tenant_id
    // is embedded in the SQL template. We verify the SQL string contains the correct tenant_id.
    await retrieveListingContext(TENANT_B, LISTING_ID, INTENT_VECTOR);

    expect(mockExecute).toHaveBeenCalledOnce();
    const sqlArg = mockExecute.mock.calls[0]?.[0];
    // The sql template object carries queryChunks; serialise to verify tenant_id presence
    const sqlString = JSON.stringify(sqlArg);
    expect(sqlString).toContain(TENANT_B);
    expect(sqlString).not.toContain(TENANT_A);
  });
});
