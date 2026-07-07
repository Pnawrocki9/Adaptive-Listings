/**
 * FOLLOW-464 / audit F-15 / RETRO-162 LG-1: getPgCachedDescription must filter on
 * `model` so a Postgres Step-1 hit is model-scoped — matching the model-scoped Redis
 * Step-2 key it runs before. Before this fix the WHERE clause omitted `model` entirely,
 * so:
 *   - a FIT row generated under model A would be served for a model-B request (stale
 *     description instead of a fresh, correctly-model-attributed one), and
 *   - after FOLLOW-465, a NEUTRAL negative-cache marker written under model A would
 *     permanently suppress generation under model B (and the DEMO override_model
 *     preview) until `listing.updated` invalidation — a correctness regression, not
 *     just a staleness one.
 *
 * This suite unit-tests `getPgCachedDescription` directly (mocking the Drizzle client)
 * to prove the real WHERE clause — not a route-level mock — now includes an `eq` on
 * the `model` column.
 *
 * @module apps/control-plane/src/lib/description-pg-cache.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const { mockLimit, mockOrderBy, mockWhere, mockFrom, mockSelect } = vi.hoisted(() => {
  const mockLimit = vi.fn();
  const mockOrderBy = vi.fn((_orderBy: unknown) => ({ limit: mockLimit }));
  const mockWhere = vi.fn((_where: unknown) => ({ orderBy: mockOrderBy }));
  const mockFrom = vi.fn((_from: unknown) => ({ where: mockWhere }));
  const mockSelect = vi.fn((_columns: unknown) => ({ from: mockFrom }));
  return { mockLimit, mockOrderBy, mockWhere, mockFrom, mockSelect };
});

vi.mock('@estalara/db', () => ({
  createTenantClient: vi.fn(() => ({ select: mockSelect })),
  descriptionCachePersistent: {
    tenantId: 'tenant_id',
    listingId: 'listing_id',
    archetype: 'archetype',
    locale: 'locale',
    model: 'model',
    invalidatedAt: 'invalidated_at',
    generatedAt: 'generated_at',
    description: 'description',
    headline: 'headline',
    verdict: 'verdict',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: unknown, b: unknown) => ({ op: 'eq', a, b })),
  and: vi.fn((...args: unknown[]) => ({ op: 'and', args })),
  isNull: vi.fn((a: unknown) => ({ op: 'isNull', a })),
  desc: vi.fn((a: unknown) => ({ op: 'desc', a })),
}));

import { getPgCachedDescription } from './description-pg-cache';

const TENANT_ID = 'tenant-follow464';
const LISTING_ID = 'listing-follow464';
const ARCHETYPE = 'yield_hunter';
const LOCALE = 'en';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('DATABASE_URL', 'postgresql://user:pass@localhost:5432/db');
  mockLimit.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('FOLLOW-464: getPgCachedDescription WHERE clause is model-scoped', () => {
  it('includes an eq(model, <requested model>) condition in the WHERE clause', async () => {
    await getPgCachedDescription(TENANT_ID, LISTING_ID, ARCHETYPE, LOCALE, 'claude-sonnet-4-6');

    expect(mockWhere).toHaveBeenCalledTimes(1);
    const whereArg = mockWhere.mock.calls[0]![0] as { op: string; args: unknown[] };
    expect(whereArg.op).toBe('and');

    const modelCondition = whereArg.args.find(
      (c): c is { op: string; a: string; b: string } =>
        typeof c === 'object' && c !== null && (c as { a?: unknown }).a === 'model',
    );
    expect(modelCondition).toBeDefined();
    expect(modelCondition?.op).toBe('eq');
    expect(modelCondition?.b).toBe('claude-sonnet-4-6');
  });

  it('a request for a different model produces a DIFFERENT eq condition value (proves the filter is request-scoped, not hardcoded)', async () => {
    await getPgCachedDescription(TENANT_ID, LISTING_ID, ARCHETYPE, LOCALE, 'claude-opus-4-8');

    const whereArg = mockWhere.mock.calls[0]![0] as { op: string; args: unknown[] };
    const modelCondition = whereArg.args.find(
      (c): c is { op: string; a: string; b: string } =>
        typeof c === 'object' && c !== null && (c as { a?: unknown }).a === 'model',
    );
    expect(modelCondition?.b).toBe('claude-opus-4-8');
  });

  it('still filters tenantId/listingId/archetype/locale/invalidatedAt alongside model (no regression on the existing scoping)', async () => {
    await getPgCachedDescription(TENANT_ID, LISTING_ID, ARCHETYPE, LOCALE, 'claude-sonnet-4-6');

    const whereArg = mockWhere.mock.calls[0]![0] as { op: string; args: unknown[] };
    const columnsFiltered = whereArg.args
      .map((c) => (typeof c === 'object' && c !== null ? (c as { a?: unknown }).a : undefined))
      .filter(Boolean);
    expect(columnsFiltered).toEqual([
      'tenant_id',
      'listing_id',
      'archetype',
      'locale',
      'model',
      'invalidated_at',
    ]);

    // The full select().from().where().orderBy().limit(1) chain still runs unchanged.
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(mockOrderBy).toHaveBeenCalledWith({ op: 'desc', a: 'generated_at' });
  });
});
