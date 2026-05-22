/**
 * Tests for seed-listing-embeddings helper (FOLLOW-046).
 *
 * Coverage:
 *   - extractListingIdsFromSchema returns [] (current schema has no listing IDs)
 *   - embedOneListing: happy path → ok: true
 *   - embedOneListing: non-200 HTTP response → ok: false with error detail
 *   - embedOneListing: fetch throws → ok: false with error message
 *   - seedListingEmbeddingsForActivation: INTERNAL_API_SECRET absent → skip with reason
 *   - seedListingEmbeddingsForActivation: demo tenant → seeds all 12 fixture listings
 *   - seedListingEmbeddingsForActivation: non-demo tenant, no schema IDs → no-op
 *   - seedListingEmbeddingsForActivation: demo tenant, some embeds fail → failed count correct
 *   - DEMO_LISTING_MANIFEST has exactly 12 entries with required fields
 *
 * @module apps/control-plane/src/lib/__tests__/seed-listing-embeddings.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEMO_LISTING_MANIFEST,
  embedOneListing,
  extractListingIdsFromSchema,
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
  it('has exactly 12 listings', () => {
    expect(DEMO_LISTING_MANIFEST).toHaveLength(12);
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

  it('listing IDs follow listing-NNN pattern', () => {
    for (const listing of DEMO_LISTING_MANIFEST) {
      expect(listing.listing_id).toMatch(/^listing-\d+$/);
    }
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
  it('seeds all 12 fixture listings when tenant matches DEMO_TENANT_ID', async () => {
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

    expect(result.attempted).toBe(12);
    expect(result.succeeded).toBe(12);
    expect(result.failed).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(12);
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

    expect(result.attempted).toBe(12);
    // 12 listings, every 3rd fails: listings 3, 6, 9, 12 → 4 failures
    expect(result.failed).toBe(4);
    expect(result.succeeded).toBe(8);
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

    expect(result.attempted).toBe(12);
    expect(result.failed).toBe(12);
    expect(result.succeeded).toBe(0);
  });
});
