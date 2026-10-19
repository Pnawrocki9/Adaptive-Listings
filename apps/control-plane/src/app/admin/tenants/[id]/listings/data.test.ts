/**
 * Tests for the listings index data layer (FOLLOW-1334): the tenant fence is in the query, rows are
 * normalised, and a failing DB is an explicit `{ ok: false }` plus a Sentry capture (Rule K.2).
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/listings/data.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockCapture = vi.hoisted(() => vi.fn());
vi.mock('@sentry/nextjs', () => ({ captureException: mockCapture }));

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  answers: { tenantId: 'tenant_id', listingId: 'listing_id', updatedAt: 'updated_at' },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ _tag: 'eq', col, val })),
  desc: vi.fn((x: unknown) => ({ _tag: 'desc', x })),
  max: vi.fn((x: unknown) => ({ _tag: 'max', x })),
  count: vi.fn(() => ({ _tag: 'count' })),
}));

import { createAdminClient } from '@estalara/db';
import { getListingAnswerSummaries } from './data';

const TENANT = '11111111-1111-4111-8111-111111111111';

function dbReturning(rows: unknown[] | Error) {
  const orderBy = vi.fn(() =>
    rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows),
  );
  const groupBy = vi.fn(() => ({ orderBy }));
  const where = vi.fn(() => ({ groupBy }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  vi.mocked(createAdminClient).mockReturnValue({ select } as unknown as ReturnType<
    typeof createAdminClient
  >);
  return { where };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getListingAnswerSummaries', () => {
  it('fences the query on the tenant id and maps rows', async () => {
    const { where } = dbReturning([
      { listingId: 'L-1', answerCount: 3, lastUpdatedAt: new Date('2026-10-02T10:00:00Z') },
      { listingId: 'L-2', answerCount: 1, lastUpdatedAt: null },
    ]);

    const result = await getListingAnswerSummaries(TENANT);

    expect(where).toHaveBeenCalledWith({ _tag: 'eq', col: 'tenant_id', val: TENANT });
    expect(result).toEqual({
      ok: true,
      listings: [
        { listingId: 'L-1', answerCount: 3, lastUpdatedAt: '2026-10-02T10:00:00.000Z' },
        { listingId: 'L-2', answerCount: 1, lastUpdatedAt: null },
      ],
    });
  });

  it('returns an empty list (ok) for a tenant with no answers', async () => {
    dbReturning([]);
    expect(await getListingAnswerSummaries(TENANT)).toEqual({ ok: true, listings: [] });
  });

  it('a failing query is { ok: false } + Sentry, never an empty list (Rule K.2)', async () => {
    dbReturning(new Error('connection refused'));

    const result = await getListingAnswerSummaries(TENANT);

    expect(result.ok).toBe(false);
    // The raw DB error (SQL + params for drizzle) never reaches the page.
    expect(JSON.stringify(result)).not.toContain('connection refused');
    expect(JSON.stringify(result)).toContain('listing lookup failed');
    expect(mockCapture).toHaveBeenCalledOnce();
  });

  it('an unconfigured DB (createAdminClient throws) is { ok: false } too', async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error('DATABASE_URL_ADMIN is not set');
    });

    const result = await getListingAnswerSummaries(TENANT);

    expect(result.ok).toBe(false);
    expect(mockCapture).toHaveBeenCalledOnce();
  });
});
