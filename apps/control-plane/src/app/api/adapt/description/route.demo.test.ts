/**
 * DEMO MODE tests for GET /api/adapt/description — DEMO-001.
 *
 * Coverage (AC5, AC7d):
 *   - When DEMO MODE is on, description cache key includes model suffix
 *     (switching model → different key → cache miss → new Modal job).
 *   - When DEMO MODE is off, standard cache key (no suffix).
 *   - When getDemoOverride throws, falls back to standard cache key (fail-open).
 *
 * @module apps/control-plane/src/app/api/adapt/description/route.demo.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Hoisted stubs ────────────────────────────────────────────────────────────

const { mockGetCachedDescription, mockDescriptionKey, mockGetDemoOverride } = vi.hoisted(() => ({
  mockGetCachedDescription: vi.fn(),
  mockDescriptionKey: vi.fn(
    (tenantId: string, listingId: string, archetype: string, locale: string) =>
      `desc:${tenantId}:${listingId}:${archetype}:${locale}`,
  ),
  mockGetDemoOverride: vi.fn(),
}));

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/description-cache', () => ({
  getCachedDescription: mockGetCachedDescription,
  descriptionKey: mockDescriptionKey,
  setCachedDescription: vi.fn(),
  invalidateDescriptionCache: vi.fn(),
}));

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi
    .fn()
    .mockResolvedValue({ tenant_id: 'demo-tenant-uuid', estalara_staff: false }),
}));

vi.mock('@/lib/rag-retrieval', () => ({
  retrieveListingContext: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/demo-override-store', () => ({
  getDemoOverride: mockGetDemoOverride,
}));

import { GET } from './route';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT_ID = 'demo-tenant-uuid';

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/adapt/description');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url, {
    headers: { Authorization: 'Bearer test_key' },
  });
}

// FOLLOW-203: `tier` param removed
const VALID_PARAMS = {
  listing_id: 'listing-demo-001',
  archetype: 'yield_hunter',
  locale: 'en',
};

async function parseBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function getCachedDescriptionCallKey(): string | undefined {
  return mockGetCachedDescription.mock.calls[0]?.[0] as string | undefined;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/adapt/description — DEMO MODE (DEMO-001 AC5, AC7d)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: cache miss
    mockGetCachedDescription.mockResolvedValue(null);
    // Default: demo mode off
    mockGetDemoOverride.mockResolvedValue({
      enabled: false,
      overrideArchetype: null,
      overrideModel: 'claude-sonnet-4-6',
    });
  });

  it('AC7d — standard cache key when DEMO MODE is off', async () => {
    mockGetDemoOverride.mockResolvedValue({
      enabled: false,
      overrideArchetype: null,
      overrideModel: 'claude-sonnet-4-6',
    });

    await GET(makeRequest(VALID_PARAMS));

    expect(mockDescriptionKey).toHaveBeenCalledWith(
      TENANT_ID,
      'listing-demo-001',
      'yield_hunter',
      'en',
    );
    const key = getCachedDescriptionCallKey();
    // No demo suffix on the key
    expect(key).not.toContain(':demo:');
  });

  it('AC7d — cache key includes model suffix when DEMO MODE is on', async () => {
    mockGetDemoOverride.mockResolvedValue({
      enabled: true,
      overrideArchetype: 'yield_hunter',
      overrideModel: 'claude-opus-4-8',
    });

    await GET(makeRequest(VALID_PARAMS));

    const key = getCachedDescriptionCallKey();
    // Must include demo model suffix
    expect(key).toContain(':demo:claude-opus-4-8');
  });

  it('AC7d — different models yield different cache keys (switching model busts cache)', async () => {
    // First request — haiku model
    mockGetDemoOverride.mockResolvedValue({
      enabled: true,
      overrideArchetype: 'yield_hunter',
      overrideModel: 'claude-haiku-4-5-20251001',
    });
    await GET(makeRequest(VALID_PARAMS));
    const key1 = getCachedDescriptionCallKey();

    vi.clearAllMocks();
    mockGetCachedDescription.mockResolvedValue(null);

    // Second request — opus model
    mockGetDemoOverride.mockResolvedValue({
      enabled: true,
      overrideArchetype: 'yield_hunter',
      overrideModel: 'claude-opus-4-8',
    });
    await GET(makeRequest(VALID_PARAMS));
    const key2 = getCachedDescriptionCallKey();

    // Keys must differ
    expect(key1).not.toBe(key2);
    expect(key1).toContain('claude-haiku-4-5-20251001');
    expect(key2).toContain('claude-opus-4-8');
  });

  it('AC7d — falls back to standard cache key when getDemoOverride throws (fail-open)', async () => {
    mockGetDemoOverride.mockRejectedValue(new Error('DB error'));

    await GET(makeRequest(VALID_PARAMS));

    const key = getCachedDescriptionCallKey();
    // Should have used standard key (no demo suffix)
    expect(key).not.toContain(':demo:');
  });

  it('returns template_fallback when cache is miss (normal behaviour preserved)', async () => {
    mockGetDemoOverride.mockResolvedValue({
      enabled: false,
      overrideArchetype: null,
      overrideModel: 'claude-sonnet-4-6',
    });
    mockGetCachedDescription.mockResolvedValue(null);

    const res = await GET(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(200);

    const body = await parseBody<{ source: string }>(res);
    expect(body.source).toBe('template_fallback');
  });

  it('returns ai_cached when cache is hit (normal behaviour preserved)', async () => {
    mockGetDemoOverride.mockResolvedValue({
      enabled: false,
      overrideArchetype: null,
      overrideModel: 'claude-sonnet-4-6',
    });
    mockGetCachedDescription.mockResolvedValue({
      text: 'Cached AI description.',
      generated_at: '2026-06-02T10:00:00Z',
    });

    const res = await GET(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(200);

    const body = await parseBody<{ source: string; description: string }>(res);
    expect(body.source).toBe('ai_cached');
    expect(body.description).toBe('Cached AI description.');
  });
});
