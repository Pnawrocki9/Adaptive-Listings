/**
 * FOLLOW-460 AC2 + AC3: the permanent Postgres description cache survives a
 * >72h gap with no Modal re-enqueue.
 *
 * Master Design §E.7 v2.0 removed Tiers/TTL from the description cache: the durable
 * store is `description_cache_persistent` (Postgres, no expiry — only invalidated by
 * `listing.updated`), and Redis is a hot-path accelerator only. Lookup order is:
 *
 *   1. description_cache_persistent (Postgres) — if found and not invalidated → return
 *   2. Upstash Redis (hot-path cache) — if found → return + async backfill Postgres
 *   3. template_fallback immediately + fire-and-forget Modal enqueue
 *
 * This suite proves step 1 holds even when the row was generated long before the old
 * (now-removed) 72h Redis TTL would have expired it — i.e. durability no longer depends
 * on a request landing within a TTL window (RETRO-005/006-style gap the FOLLOW-460
 * Python-side fix closes for the write path; this is the read-path confirmation AC2
 * asked for, plus the AC3 "survives a >72h gap" test).
 *
 * @module apps/control-plane/src/app/api/adapt/description/route.follow460.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Hoisted stubs ────────────────────────────────────────────────────────────

const {
  mockGetPgCachedDescription,
  mockInsertPgCachedDescription,
  mockGetCachedDescription,
  mockSetCachedDescription,
  mockDescriptionKey,
} = vi.hoisted(() => ({
  mockGetPgCachedDescription: vi.fn(),
  mockInsertPgCachedDescription: vi.fn().mockResolvedValue(undefined),
  mockGetCachedDescription: vi.fn(),
  mockSetCachedDescription: vi.fn().mockResolvedValue(undefined),
  mockDescriptionKey: vi.fn(
    (tenantId: string, listingId: string, archetype: string, locale: string) =>
      `desc:${tenantId}:${listingId}:${archetype}:${locale}`,
  ),
}));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/description-pg-cache', () => ({
  getPgCachedDescription: mockGetPgCachedDescription,
  insertPgCachedDescription: mockInsertPgCachedDescription,
}));

vi.mock('@/lib/description-cache', () => ({
  getCachedDescription: mockGetCachedDescription,
  descriptionKey: mockDescriptionKey,
  setCachedDescription: mockSetCachedDescription,
  invalidateDescriptionCache: vi.fn(),
}));

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi
    .fn()
    .mockResolvedValue({ tenant_id: 'test-tenant-uuid', estalara_staff: false }),
}));

vi.mock('@/lib/rag-retrieval', () => ({
  retrieveListingContext: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/global-config-store', () => ({
  getGlobalGenerationModel: vi.fn().mockResolvedValue('claude-sonnet-4-6'),
  ALLOWED_GENERATION_MODELS: [
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-6',
    'claude-opus-4-8',
  ] as const,
  DEFAULT_GENERATION_MODEL: 'claude-sonnet-4-6',
  GENERATION_MODEL_KEY: 'generation_model',
}));

vi.mock('@/lib/demo-override-store', () => ({
  getDemoOverride: vi.fn().mockResolvedValue({
    enabled: false,
    overrideArchetype: null,
    overrideModel: 'claude-sonnet-4-6',
  }),
}));

vi.mock('@/lib/listing-details', () => ({
  fetchListingOriginalDescription: vi.fn().mockResolvedValue('The agent original copy.'),
}));

import { GET } from './route';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_PARAMS = {
  listing_id: 'prop-follow460-test',
  archetype: 'yield_hunter',
  locale: 'en',
};

function makeRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/adapt/description');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url, {
    headers: { Authorization: 'Bearer test-token' },
  });
}

// A generation timestamp well past the old (removed) 72h / 48h Redis TTL window.
const OVER_72H_AGO = new Date(Date.now() - 100 * 60 * 60 * 1000).toISOString(); // 100h ago

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FOLLOW-460 AC2/AC3: Postgres-cached description survives a >72h gap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertPgCachedDescription.mockResolvedValue(undefined);
    mockSetCachedDescription.mockResolvedValue(undefined);
  });

  it('serves the Postgres row as ai_cached with its original generated_at, no Redis lookup, no Modal enqueue', async () => {
    mockGetPgCachedDescription.mockResolvedValue({
      description: 'A description generated well over 72 hours ago, still durable.',
      headline: 'Durable yield play',
      generatedAt: OVER_72H_AGO,
      model: 'claude-sonnet-4-6',
    });

    const publishFetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', publishFetch);

    const res = await GET(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      description: string;
      headline: string | null;
      source: string;
      generated_at: string;
    };

    // Served straight from the Postgres row — same text, same original timestamp.
    expect(body.source).toBe('ai_cached');
    expect(body.description).toBe('A description generated well over 72 hours ago, still durable.');
    expect(body.headline).toBe('Durable yield play');
    expect(body.generated_at).toBe(OVER_72H_AGO);

    // Lookup order holds: a Postgres hit short-circuits before Redis is ever consulted.
    expect(mockGetCachedDescription).not.toHaveBeenCalled();

    // No re-enqueue: the Modal generation job is never triggered (no Redpanda POST).
    const postCalls = publishFetch.mock.calls.filter((call: unknown[]) => {
      const init = call[1] as RequestInit | undefined;
      return init?.method === 'POST';
    });
    expect(postCalls).toHaveLength(0);

    vi.unstubAllGlobals();
  });

  it('warms Redis from the Postgres hit (fire-and-forget) without blocking the response', async () => {
    mockGetPgCachedDescription.mockResolvedValue({
      description: 'Old but durable description.',
      headline: null,
      generatedAt: OVER_72H_AGO,
      model: 'claude-sonnet-4-6',
    });

    const res = await GET(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(200);

    // Let the afterResponse fire-and-forget fallback settle.
    await new Promise((r) => setTimeout(r, 10));

    expect(mockSetCachedDescription).toHaveBeenCalledOnce();
    const [warmKey, warmValue] = mockSetCachedDescription.mock.calls[0] as [
      string,
      { text: string },
    ];
    expect(warmKey).toContain('claude-sonnet-4-6');
    expect(warmValue.text).toBe('Old but durable description.');
  });
});
