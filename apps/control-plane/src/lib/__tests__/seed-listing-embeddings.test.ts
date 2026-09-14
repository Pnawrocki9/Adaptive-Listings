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
 *   - seedListingEmbeddingsForActivation: demo tenant, some embeds fail → failed count correct
 *   - DEMO_LISTING_MANIFEST has exactly 13 entries with required fields (12
 *     000-app-estalara demo listings + the FOLLOW-819 fixture listing, FOLLOW-1192)
 *   - overflow path: MAX_INLINE_SEED+1 listings → MAX_INLINE_SEED embedded inline +
 *     publishListingEmbeddingSeed called once with the 1 overflow id (FOLLOW-435)
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

// Mock the Redpanda publisher so overflow tests don't need a live broker.
// The mock is defined at module scope (hoisted) so it applies before any imports below.
vi.mock('../listing-embed-seed-publisher', () => ({
  publishListingEmbeddingSeed: vi.fn().mockResolvedValue(undefined),
}));

import {
  DEMO_LISTING_MANIFEST,
  MAX_INLINE_SEED,
  embedOneListing,
  extractListingIdsFromSchema,
  seedListingEmbeddingsForActivation,
} from '../seed-listing-embeddings';
import { publishListingEmbeddingSeed } from '../listing-embed-seed-publisher';
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

  it('counts failed listings separately when some embeds fail', async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(() => {
      callCount++;
      // Fail every 3rd listing
      if (callCount % 3 === 0) {
        return Promise.resolve(new Response('{"error":"rate limit"}', { status: 429 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    });
    vi.stubGlobal('fetch', fetchMock);

    const demoSchema: TenantSiteSchema = {
      ...MINIMAL_SCHEMA,
      tenant_id: DEMO_TENANT_ID,
      domain: 'app.estalara.com',
    };

    const result = await seedListingEmbeddingsForActivation(DEMO_TENANT_ID, demoSchema);

    expect(result.attempted).toBe(13);
    // 13 listings, every 3rd fails: listings 3, 6, 9, 12 → 4 failures
    expect(result.failed).toBe(4);
    expect(result.succeeded).toBe(9);
    expect(result.tenant_id).toBe(DEMO_TENANT_ID);
  });

  it('never throws even when fetch throws on every call', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection refused')));

    const demoSchema: TenantSiteSchema = {
      ...MINIMAL_SCHEMA,
      tenant_id: DEMO_TENANT_ID,
      domain: 'app.estalara.com',
    };

    // Must not throw
    const result = await seedListingEmbeddingsForActivation(DEMO_TENANT_ID, demoSchema);

    expect(result.attempted).toBe(13);
    expect(result.failed).toBe(13);
    expect(result.succeeded).toBe(0);
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

// ─── seedListingEmbeddingsForActivation — overflow cap (FOLLOW-434) ───────────

describe('seedListingEmbeddingsForActivation — overflow cap (FOLLOW-434)', () => {
  it(`embeds exactly MAX_INLINE_SEED listings inline and captures overflow to Sentry`, async () => {
    // Build MAX_INLINE_SEED + 1 synthetic listing IDs.
    // These are injected via schema.listing_ids which extractListingIdsFromSchema
    // now parses (forward-compat hook, implemented as part of FOLLOW-434).
    // A non-demo tenant is used so the DEMO_LISTING_MANIFEST path is not taken.
    const totalCount = MAX_INLINE_SEED + 1;
    const listingIds = Array.from(
      { length: totalCount },
      (_, i) => `overflow-test-${String(i + 1).padStart(3, '0')}`,
    );

    const schemaWithListings = {
      ...MINIMAL_SCHEMA,
      listing_ids: listingIds,
    } as unknown as TenantSiteSchema;

    // Mock fetch to resolve immediately — this controls embedOneListing() per-call.
    // Each embedOneListing() call makes exactly one fetch() call, so asserting
    // fetch call count IS equivalent to asserting embedOneListing call count.
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const sentrySpy = vi.mocked(Sentry.captureMessage);

    // Call with TENANT_A (non-demo) so only schema.listing_ids feeds the list.
    const result = await seedListingEmbeddingsForActivation(TENANT_A, schemaWithListings);

    // Exactly MAX_INLINE_SEED embed calls were made (fetch called MAX_INLINE_SEED times).
    expect(fetchMock).toHaveBeenCalledTimes(MAX_INLINE_SEED);
    expect(result.attempted).toBe(MAX_INLINE_SEED);
    expect(result.succeeded).toBe(MAX_INLINE_SEED);

    // Overflow count is recorded in the result.
    expect(result.overflow_count).toBe(1);

    // Overflow is captured to Sentry — NOT silently dropped.
    expect(sentrySpy).toHaveBeenCalledOnce();
    const sentryCall = sentrySpy.mock.calls[0];

    // First arg is the message string — must identify OVERFLOW + cap value.
    expect(sentryCall?.[0]).toContain('OVERFLOW');
    expect(sentryCall?.[0]).toContain(String(MAX_INLINE_SEED));

    // Extra context carries the overflow listing id so it is actionable.
    // Cast through unknown to avoid TS strict overlap errors; eslint optional-chain not needed
    // because we already verified sentrySpy was called once above.
    const sentryOptions = (sentryCall?.[1] ?? {}) as {
      extra: { overflow_listing_ids: string[]; overflow_count: number };
    };
    const overflowIds = sentryOptions.extra.overflow_listing_ids;
    // The one overflow listing is the (MAX_INLINE_SEED + 1)th listing.
    expect(overflowIds).toContain(`overflow-test-${String(MAX_INLINE_SEED + 1).padStart(3, '0')}`);
    expect(sentryOptions.extra.overflow_count).toBe(1);

    // Function must NOT throw on overflow — fail-open contract preserved.
    // (If it threw, the await above would have rejected — no explicit assertion needed.)
  });
});

// ─── seedListingEmbeddingsForActivation — overflow enqueue (FOLLOW-435) ──────

describe('seedListingEmbeddingsForActivation — overflow enqueue (FOLLOW-435)', () => {
  it(
    `enqueues exactly the 1 overflow listing via publishListingEmbeddingSeed ` +
      `when MAX_INLINE_SEED+1 listings are present`,
    async () => {
      const publishMock = vi.mocked(publishListingEmbeddingSeed);
      publishMock.mockClear();

      const totalCount = MAX_INLINE_SEED + 1;
      const listingIds = Array.from(
        { length: totalCount },
        (_, i) => `enqueue-test-${String(i + 1).padStart(3, '0')}`,
      );

      const schemaWithListings = {
        ...MINIMAL_SCHEMA,
        listing_ids: listingIds,
      } as unknown as TenantSiteSchema;

      const fetchMock = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      vi.stubGlobal('fetch', fetchMock);

      const result = await seedListingEmbeddingsForActivation(TENANT_A, schemaWithListings);

      // Inline: exactly MAX_INLINE_SEED embed calls.
      expect(fetchMock).toHaveBeenCalledTimes(MAX_INLINE_SEED);
      expect(result.attempted).toBe(MAX_INLINE_SEED);
      expect(result.succeeded).toBe(MAX_INLINE_SEED);
      expect(result.overflow_count).toBe(1);

      // Publisher called exactly once with the 1 overflow id.
      expect(publishMock).toHaveBeenCalledOnce();
      const publishCall = publishMock.mock.calls[0]?.[0];
      expect(publishCall).toBeDefined();
      expect(publishCall?.tenant_id).toBe(TENANT_A);
      expect(publishCall?.listing_ids).toEqual([
        `enqueue-test-${String(MAX_INLINE_SEED + 1).padStart(3, '0')}`,
      ]);
    },
  );

  it('does NOT call publishListingEmbeddingSeed when all listings fit within MAX_INLINE_SEED', async () => {
    const publishMock = vi.mocked(publishListingEmbeddingSeed);
    publishMock.mockClear();

    // Exactly MAX_INLINE_SEED listings — no overflow.
    const listingIds = Array.from(
      { length: MAX_INLINE_SEED },
      (_, i) => `no-overflow-${String(i + 1).padStart(3, '0')}`,
    );

    const schemaWithListings = {
      ...MINIMAL_SCHEMA,
      listing_ids: listingIds,
    } as unknown as TenantSiteSchema;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );

    await seedListingEmbeddingsForActivation(TENANT_A, schemaWithListings);

    expect(publishMock).not.toHaveBeenCalled();
  });

  it('never throws even when publishListingEmbeddingSeed rejects', async () => {
    const publishMock = vi.mocked(publishListingEmbeddingSeed);
    // publishListingEmbeddingSeed is designed to never reject, but test fail-open anyway.
    publishMock.mockRejectedValueOnce(new Error('Redpanda unreachable'));

    const listingIds = Array.from(
      { length: MAX_INLINE_SEED + 2 },
      (_, i) => `failopen-${String(i + 1).padStart(3, '0')}`,
    );

    const schemaWithListings = {
      ...MINIMAL_SCHEMA,
      listing_ids: listingIds,
    } as unknown as TenantSiteSchema;

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 })),
    );

    // Must not throw even when the publisher rejects.
    const result = await seedListingEmbeddingsForActivation(TENANT_A, schemaWithListings);
    expect(result.overflow_count).toBe(2);
  });
});
