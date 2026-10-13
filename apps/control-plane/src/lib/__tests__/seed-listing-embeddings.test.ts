/**
 * Tests for seed-listing-embeddings helper (FOLLOW-046).
 *
 * Coverage:
 *   - extractListingIdsFromSchema returns [] (current schema has no listing IDs)
 *   - embedOneListing: happy path → ok: true
 *   - embedOneListing: non-200 HTTP response → ok: false with error detail
 *   - embedOneListing: fetch throws → ok: false with error message
 *   - seedListingEmbeddingsForActivation: INTERNAL_API_SECRET absent → skip with reason
 *   - seedListingEmbeddingsForActivation: demo tenant → seeds all 13 fixture listings
 *   - seedListingEmbeddingsForActivation: non-demo tenant, no schema IDs → no-op
 *   - seedListingEmbeddingsForActivation: demo tenant, some embeds fail → handed to the retry hop
 *   - DEMO_LISTING_MANIFEST has exactly 13 entries with required fields (12
 *     000-app-estalara demo listings + the FOLLOW-819 fixture listing, FOLLOW-1192)
 *   - runEmbedSeedHop: bounded concurrency, checkpoint, requeue, retry-once (FOLLOW-1297 G-06)
 *
 * @module apps/control-plane/src/lib/__tests__/seed-listing-embeddings.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as Sentry from '@sentry/nextjs';

// Mock @sentry/nextjs so Sentry.captureMessage is observable in tests.
vi.mock('@sentry/nextjs', () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

import {
  DEMO_LISTING_MANIFEST,
  embedOneListing,
  extractListingIdsFromSchema,
  isSplitSeedTarget,
  runEmbedSeedHop,
  seedListingEmbeddingsForActivation,
} from '../seed-listing-embeddings';
import type { TenantSiteSchema } from '@estalara/shared';

// ─── Minimal schema fixture ────────────────────────────────────────────────────

const MINIMAL_SCHEMA: TenantSiteSchema = {
  tenant_id: 'tenant-abc',
  domain: 'example.com',
  detected_at: '2026-01-01T00:00:00Z',
  detection_source: 'data_estalara',
  detection_confidence: 0.99,
  index_schema: {
    url_patterns: ['https://example.com/**'],
    listing_card_selector: '[data-estalara-listing-id]',
    card_field_mappings: {},
    data_extractors_per_card: {},
    reorder_capable: false,
  },
  detail_schema: {
    url_patterns: ['https://example.com/listing/*'],
    slot_selectors: {},
    data_extractors: {},
  },
  archetype_hints: [],
};

// ─── Constants ────────────────────────────────────────────────────────────────

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const DEMO_TENANT_ID = '22222222-2222-2222-2222-222222222222';
const TEST_SECRET = 'test-internal-secret';
const BASE_URL = 'http://localhost:3000';

// ─── Environment helpers ───────────────────────────────────────────────────────

const ORIGINAL_ENV = {
  INTERNAL_API_SECRET: process.env.INTERNAL_API_SECRET,
  DEMO_TENANT_ID: process.env.DEMO_TENANT_ID,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
};

beforeEach(() => {
  vi.resetAllMocks();
  process.env.INTERNAL_API_SECRET = TEST_SECRET;
  process.env.DEMO_TENANT_ID = DEMO_TENANT_ID;
  process.env.NEXT_PUBLIC_APP_URL = BASE_URL;
});

afterEach(() => {
  // Restore original env — use Reflect.deleteProperty to satisfy no-dynamic-delete.
  for (const [key, val] of Object.entries(ORIGINAL_ENV)) {
    if (val === undefined) {
      Reflect.deleteProperty(process.env, key);
    } else {
      process.env[key] = val;
    }
  }
});

// ─── DEMO_LISTING_MANIFEST ─────────────────────────────────────────────────────

describe('DEMO_LISTING_MANIFEST', () => {
  it('has exactly 13 listings', () => {
    expect(DEMO_LISTING_MANIFEST).toHaveLength(13);
  });

  it('every listing has a listing_id and at least one text field', () => {
    for (const listing of DEMO_LISTING_MANIFEST) {
      expect(typeof listing.listing_id).toBe('string');
      expect(listing.listing_id.length).toBeGreaterThan(0);

      const hasText =
        Boolean(listing.title) ||
        Boolean(listing.description) ||
        Boolean(listing.price) ||
        Boolean(listing.location);
      expect(hasText).toBe(true);
    }
  });

  it('12 listing IDs follow listing-NNN pattern; the FOLLOW-819 fixture listing is its own UUID', () => {
    const patterned = DEMO_LISTING_MANIFEST.filter((l) => /^listing-\d+$/.test(l.listing_id));
    const other = DEMO_LISTING_MANIFEST.filter((l) => !/^listing-\d+$/.test(l.listing_id));
    expect(patterned).toHaveLength(12);
    expect(other.map((l) => l.listing_id)).toEqual(['839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c']);
  });
});

// ─── extractListingIdsFromSchema ───────────────────────────────────────────────

describe('extractListingIdsFromSchema', () => {
  it('returns an empty array (current schemas carry no listing IDs)', () => {
    const result = extractListingIdsFromSchema(MINIMAL_SCHEMA);
    expect(result).toEqual([]);
  });
});

// ─── embedOneListing ──────────────────────────────────────────────────────────

describe('embedOneListing', () => {
  it('returns ok: true on a 200 response', async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, listing_id: 'listing-001' }), { status: 200 }),
      );
    vi.stubGlobal('fetch', mockFetch);

    const result = await embedOneListing(BASE_URL, TEST_SECRET, TENANT_A, {
      listing_id: 'listing-001',
      title: 'Test Villa',
      price: '€500,000',
    });

    expect(result.ok).toBe(true);
    expect(result.listing_id).toBe('listing-001');
    expect(result.error).toBeUndefined();

    // Verify the request shape
    const [calledUrl, calledInit] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${BASE_URL}/api/listings/embed`);
    expect(calledInit.method).toBe('POST');

    const sentHeaders = calledInit.headers as Record<string, string>;
    expect(sentHeaders['x-internal-api-secret']).toBe(TEST_SECRET);

    const body = JSON.parse(calledInit.body as string) as Record<string, unknown>;
    expect(body.tenant_id).toBe(TENANT_A);
    expect(body.listing_id).toBe('listing-001');
  });

  // FOLLOW-1193: the seeder prints the database the server resolved.
  it('carries the database the server reported writing to', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            listing_id: 'listing-001',
            database: { host: '127.0.0.1', port: '5433', name: 'postgres' },
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await embedOneListing(BASE_URL, TEST_SECRET, TENANT_A, {
      listing_id: 'listing-001',
      title: 'Test Villa',
    });

    expect(result).toEqual({
      listing_id: 'listing-001',
      ok: true,
      database: { host: '127.0.0.1', port: '5433', name: 'postgres' },
    });
  });

  it('a 200 from a server that predates the database field is still ok, with no database', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 200 })));

    const result = await embedOneListing(BASE_URL, TEST_SECRET, TENANT_A, {
      listing_id: 'listing-001',
      title: 'Test Villa',
    });

    expect(result).toEqual({ listing_id: 'listing-001', ok: true });
  });

  it('returns ok: false on a non-200 HTTP response', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ error: 'OpenAI not configured' }), { status: 503 }),
        ),
    );

    const result = await embedOneListing(BASE_URL, TEST_SECRET, TENANT_A, {
      listing_id: 'listing-002',
      title: 'Another listing',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('503');
  });

  it('returns ok: false when fetch throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('Network unreachable')));

    const result = await embedOneListing(BASE_URL, TEST_SECRET, TENANT_A, {
      listing_id: 'listing-003',
      description: 'Some property',
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain('Network unreachable');
  });
});

// ─── isSplitSeedTarget (FOLLOW-1193) ──────────────────────────────────────────

describe('isSplitSeedTarget', () => {
  const LOOPBACK_DB = { host: '127.0.0.1', port: '5433', name: 'postgres' };
  const HOSTED_DB = { host: 'db.hosted-project.example', port: '5432', name: 'postgres' };

  it('flags a LOOPBACK plane that resolved a NON-loopback database — the split-brain', () => {
    expect(isSplitSeedTarget('http://localhost:3000', HOSTED_DB)).toBe(true);
    expect(isSplitSeedTarget('http://127.0.0.1:3000', HOSTED_DB)).toBe(true);
  });

  it('does not flag a loopback plane on a loopback database', () => {
    expect(isSplitSeedTarget('http://localhost:3000', LOOPBACK_DB)).toBe(false);
    expect(isSplitSeedTarget('http://localhost:3000', { ...LOOPBACK_DB, host: 'localhost' })).toBe(
      false,
    );
  });

  it('does not flag a hosted plane (a hosted plane writing hosted is the intended path)', () => {
    expect(isSplitSeedTarget('https://admin.estalara.com', HOSTED_DB)).toBe(false);
  });
});

// ─── seedListingEmbeddingsForActivation ───────────────────────────────────────

describe('seedListingEmbeddingsForActivation — missing secret', () => {
  it('skips seeding and returns skipped_reason when INTERNAL_API_SECRET is absent', async () => {
    delete process.env.INTERNAL_API_SECRET;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await seedListingEmbeddingsForActivation(TENANT_A, MINIMAL_SCHEMA);

    expect(result.attempted).toBe(0);
    expect(result.succeeded).toBe(0);
    expect(result.skipped_reason).toContain('INTERNAL_API_SECRET');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('seedListingEmbeddingsForActivation — non-demo tenant', () => {
  it('returns no-op result when no listing IDs are discoverable from schema', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await seedListingEmbeddingsForActivation(TENANT_A, MINIMAL_SCHEMA);

    expect(result.attempted).toBe(0);
    expect(result.skipped_reason).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('seedListingEmbeddingsForActivation — demo tenant', () => {
  it('seeds all 13 fixture listings when tenant matches DEMO_TENANT_ID', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const demoSchema: TenantSiteSchema = {
      ...MINIMAL_SCHEMA,
      tenant_id: DEMO_TENANT_ID,
      domain: 'app.estalara.com',
    };

    const result = await seedListingEmbeddingsForActivation(DEMO_TENANT_ID, demoSchema);

    expect(result.attempted).toBe(13);
    expect(result.succeeded).toBe(13);
    expect(result.failed).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(13);
  });

  it('hands first-time failures to the retry hop instead of counting them as failed', async () => {
    // Every 3rd manifest listing fails its embed call: 4 of 13.
    const failIds = new Set(
      DEMO_LISTING_MANIFEST.filter((_, i) => (i + 1) % 3 === 0).map((l) => l.listing_id),
    );
    const requeues: { listing_ids: string[]; retry_listing_ids?: string[] }[] = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/api/internal/listings/embed-seed')) {
        requeues.push(JSON.parse(init?.body as string) as (typeof requeues)[number]);
        return Promise.resolve(new Response('{"accepted":true}', { status: 202 }));
      }
      const body = JSON.parse(init?.body as string) as { listing_id: string };
      return Promise.resolve(
        failIds.has(body.listing_id)
          ? new Response('{"error":"rate limit"}', { status: 429 })
          : new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const demoSchema: TenantSiteSchema = {
      ...MINIMAL_SCHEMA,
      tenant_id: DEMO_TENANT_ID,
      domain: 'app.estalara.com',
    };

    const result = await seedListingEmbeddingsForActivation(DEMO_TENANT_ID, demoSchema);

    // 9 embedded; the 4 failures are the next hop's work (retried once there), not `failed`.
    expect(result).toMatchObject({
      tenant_id: DEMO_TENANT_ID,
      attempted: 9,
      succeeded: 9,
      failed: 0,
      overflow_count: 4,
    });
    expect(requeues).toHaveLength(1);
    expect([...(requeues[0]?.retry_listing_ids ?? [])].sort()).toEqual([...failIds].sort());
  });

  it('never throws even when fetch throws on every call', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));

    const demoSchema: TenantSiteSchema = {
      ...MINIMAL_SCHEMA,
      tenant_id: DEMO_TENANT_ID,
      domain: 'app.estalara.com',
    };

    // Must not throw: every embed fails, and so does the requeue POST (captured, not thrown).
    const result = await seedListingEmbeddingsForActivation(DEMO_TENANT_ID, demoSchema);

    expect(result.succeeded).toBe(0);
    expect(result.overflow_count).toBe(13);
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ kind: 'requeue_failed' }) }),
    );
  });
});

// ─── extractListingIdsFromSchema — listing_ids forward-compat ─────────────────

describe('extractListingIdsFromSchema — listing_ids forward-compat', () => {
  it('returns ListingTextContent[] when schema carries listing_ids', () => {
    const schemaWithIds = {
      ...MINIMAL_SCHEMA,
      listing_ids: ['listing-a', 'listing-b', 'listing-c'],
    } as unknown as TenantSiteSchema;
    const result = extractListingIdsFromSchema(schemaWithIds);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ listing_id: 'listing-a' });
    expect(result[2]).toEqual({ listing_id: 'listing-c' });
  });

  it('filters out non-string entries in listing_ids', () => {
    const schemaWithMixed = {
      ...MINIMAL_SCHEMA,
      listing_ids: ['listing-a', 42, null, '', 'listing-b'],
    } as unknown as TenantSiteSchema;
    const result = extractListingIdsFromSchema(schemaWithMixed);
    // Only non-empty strings pass through; '' is filtered
    expect(result).toHaveLength(2);
    expect(result.map((l) => l.listing_id)).toEqual(['listing-a', 'listing-b']);
  });
});

// ─── FOLLOW-1297 (ADR-0023 §6 G-06): control-plane hop, checkpoint and requeue ──────────────

describe('runEmbedSeedHop / activation (FOLLOW-1297 G-06)', () => {
  // The hop's module-private constants (`SEED_HOP_CONCURRENCY`, `SEED_HOP_BUDGET_MS`,
  // `MAX_REQUEUE_DEPTH` in seed-listing-embeddings.ts); pinned here as values, not re-exported.
  const SEED_HOP_CONCURRENCY = 4;
  const SEED_HOP_BUDGET_MS = 10_000;
  const MAX_REQUEUE_DEPTH = 20;

  /** fetch stub: embed calls succeed (or fail for `failIds`), the requeue POST is recorded. */
  function stubFetch(failIds: ReadonlySet<string> = new Set()) {
    const requeues: Record<string, unknown>[] = [];
    const embedded: string[] = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/api/internal/listings/embed-seed')) {
        requeues.push(JSON.parse(init?.body as string) as Record<string, unknown>);
        return Promise.resolve(new Response('{"accepted":true}', { status: 202 }));
      }
      const body = JSON.parse(init?.body as string) as { listing_id: string };
      embedded.push(body.listing_id);
      return Promise.resolve(
        failIds.has(body.listing_id)
          ? new Response('boom', { status: 500 })
          : new Response(JSON.stringify({ ok: true }), { status: 200 }),
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    return { fetchMock, requeues, embedded };
  }

  it('activation embeds every listing in one hop, past the retired 50-listing inline cap, with no requeue', async () => {
    const { requeues, embedded } = stubFetch();
    const LISTING_COUNT = 53;
    const listingIds = Array.from({ length: LISTING_COUNT }, (_, i) => `hop-${String(i)}`);
    const schema = { ...MINIMAL_SCHEMA, listing_ids: listingIds } as unknown as TenantSiteSchema;

    const result = await seedListingEmbeddingsForActivation(TENANT_A, schema);

    expect(embedded).toHaveLength(LISTING_COUNT);
    expect(result).toMatchObject({
      attempted: LISTING_COUNT,
      succeeded: LISTING_COUNT,
      failed: 0,
      overflow_count: 0,
    });
    expect(requeues).toHaveLength(0);
  });

  it('a first-time failure is requeued as a retry; a failure on its retry is reported, not requeued', async () => {
    const { requeues } = stubFetch(new Set(['bad']));
    const listings = [{ listing_id: 'ok-1' }, { listing_id: 'bad' }, { listing_id: 'ok-2' }];

    const first = await runEmbedSeedHop({
      tenantId: TENANT_A,
      listings,
      retryIds: new Set(),
      requeueDepth: 0,
    });
    expect(first).toEqual({ succeeded: 2, failed: [], remaining: 1, requeued: true });
    expect(requeues).toEqual([
      { tenant_id: TENANT_A, listing_ids: ['bad'], requeue_depth: 1, retry_listing_ids: ['bad'] },
    ]);

    const second = await runEmbedSeedHop({
      tenantId: TENANT_A,
      listings: [{ listing_id: 'bad' }],
      retryIds: new Set(['bad']),
      requeueDepth: 1,
    });
    expect(second).toEqual({ succeeded: 0, failed: ['bad'], remaining: 0, requeued: false });
    expect(requeues).toHaveLength(1);
    expect(vi.mocked(Sentry.captureMessage)).toHaveBeenCalledWith(
      expect.stringContaining('failed on their retry'),
      expect.objectContaining({ tags: expect.objectContaining({ kind: 'embed_retry_failed' }) }),
    );
  });

  it('the wall-clock budget checkpoints what did not START and requeues it with depth + 1', async () => {
    const listings = Array.from({ length: 12 }, (_, i) => ({ listing_id: `cp-${String(i)}` }));
    // Each embed takes longer than the budget (fake clock), so only the first
    // SEED_HOP_CONCURRENCY listings ever start; the requeue POST answers at once.
    vi.useFakeTimers();
    const requeues: Record<string, unknown>[] = [];
    const embedded: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        if (url.endsWith('/embed-seed')) {
          requeues.push(JSON.parse(init?.body as string) as Record<string, unknown>);
          return Promise.resolve(new Response('{"accepted":true}', { status: 202 }));
        }
        embedded.push((JSON.parse(init?.body as string) as { listing_id: string }).listing_id);
        return new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
          }, SEED_HOP_BUDGET_MS + 1);
        });
      }),
    );

    const pending = runEmbedSeedHop({
      tenantId: TENANT_A,
      listings,
      retryIds: new Set(),
      requeueDepth: 4,
    });
    await vi.advanceTimersByTimeAsync(SEED_HOP_BUDGET_MS + 5);
    const result = await pending;
    vi.useRealTimers();

    expect(embedded).toHaveLength(SEED_HOP_CONCURRENCY);
    expect(result).toEqual({
      succeeded: SEED_HOP_CONCURRENCY,
      failed: [],
      remaining: 12 - SEED_HOP_CONCURRENCY,
      requeued: true,
    });
    expect(requeues[0]).toMatchObject({ requeue_depth: 5 });
    expect((requeues[0] as { listing_ids: string[] }).listing_ids).toHaveLength(
      12 - SEED_HOP_CONCURRENCY,
    );
  });

  it('at MAX_REQUEUE_DEPTH the remainder is reported with its ids instead of requeued', async () => {
    const { requeues } = stubFetch(new Set(['bad']));
    const result = await runEmbedSeedHop({
      tenantId: TENANT_A,
      listings: [{ listing_id: 'bad' }],
      retryIds: new Set(),
      requeueDepth: MAX_REQUEUE_DEPTH,
    });
    expect(result).toEqual({ succeeded: 0, failed: [], remaining: 1, requeued: false });
    expect(requeues).toHaveLength(0);
    expect(vi.mocked(Sentry.captureMessage)).toHaveBeenCalledWith(
      expect.stringContaining('exhausted'),
      expect.objectContaining({
        tags: expect.objectContaining({ kind: 'requeue_depth_exhausted' }),
        extra: expect.objectContaining({ listing_ids: ['bad'] }),
      }),
    );
  });

  it('a rejected requeue POST is captured and reported as requeued: false', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) =>
        Promise.resolve(
          url.endsWith('/embed-seed')
            ? new Response('nope', { status: 500 })
            : new Response('boom', { status: 500 }),
        ),
      ),
    );
    const result = await runEmbedSeedHop({
      tenantId: TENANT_A,
      listings: [{ listing_id: 'x' }],
      retryIds: new Set(),
      requeueDepth: 0,
    });
    expect(result).toEqual({ succeeded: 0, failed: [], remaining: 1, requeued: false });
    expect(vi.mocked(Sentry.captureException)).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ tags: expect.objectContaining({ kind: 'requeue_failed' }) }),
    );
  });
});
