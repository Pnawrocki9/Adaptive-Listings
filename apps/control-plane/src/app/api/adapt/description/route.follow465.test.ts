/**
 * FOLLOW-465 / audit F-18: negative-cache NEUTRAL archetype-fit verdicts to stop
 * perpetual Sonnet re-spend.
 *
 * Before this fix, a NEUTRAL verdict (ADR-0010 archetype-fit gate declining to
 * adapt a listing/archetype pair) wrote NOTHING to Redis or Postgres — structurally
 * identical to a genuine generation failure. Every repeat request for the same
 * (tenant, listing, archetype, locale, model) was therefore a permanent cache MISS
 * that re-dispatched a fresh (uncapped) Sonnet 4.6 call to Modal, forever.
 *
 * This suite proves the read-path short-circuit: once a NEUTRAL verdict is
 * negative-cached (Postgres or Redis), a repeat request serves template_fallback
 * WITHOUT dispatching to Modal again.
 *
 * @module apps/control-plane/src/app/api/adapt/description/route.follow465.test
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
  listing_id: 'prop-follow465-test',
  archetype: 'family_buyer',
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

function countModalDispatches(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter((call: unknown[]) => {
    const init = call[1] as RequestInit | undefined;
    return init?.method === 'POST';
  }).length;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FOLLOW-465: NEUTRAL verdict negative-cache short-circuits the Modal re-enqueue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsertPgCachedDescription.mockResolvedValue(undefined);
    mockSetCachedDescription.mockResolvedValue(undefined);
    vi.stubEnv('MODAL_DESCRIPTION_URL', 'https://modal.example.test/description');
  });

  it(
    'two identical requests: 1st (cache miss) dispatches Modal once; 2nd (NEUTRAL ' +
      'negative-cache hit, Postgres) serves template_fallback with NO 2nd dispatch',
    async () => {
      const publishFetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
      vi.stubGlobal('fetch', publishFetch);

      // ── Request 1: cold cache — neither Postgres nor Redis has an entry yet.
      mockGetPgCachedDescription.mockResolvedValueOnce(null);
      mockGetCachedDescription.mockResolvedValueOnce(null);

      const res1 = await GET(makeRequest(VALID_PARAMS));
      expect(res1.status).toBe(200);
      const body1 = (await res1.json()) as { source: string; description: string };
      expect(body1.source).toBe('template_fallback');

      // Let the afterResponse fire-and-forget Modal dispatch settle.
      await new Promise((r) => setTimeout(r, 10));
      expect(countModalDispatches(publishFetch)).toBe(1);

      // ── Simulate the Modal job completing with a NEUTRAL verdict: it negative-
      // caches by writing a row with verdict='NEUTRAL' to Postgres (and Redis,
      // not exercised in this Postgres-first test).
      mockGetPgCachedDescription.mockResolvedValueOnce({
        description: '',
        headline: null,
        generatedAt: new Date().toISOString(),
        model: 'claude-sonnet-4-6',
        verdict: 'NEUTRAL',
      });

      // ── Request 2: identical request — Postgres now has the NEUTRAL marker.
      const res2 = await GET(makeRequest(VALID_PARAMS));
      expect(res2.status).toBe(200);
      const body2 = (await res2.json()) as {
        source: string;
        description: string;
        headline: string | null;
      };
      expect(body2.source).toBe('template_fallback');
      expect(body2.headline).toBeNull();

      // Let any fire-and-forget work settle before asserting the dispatch count.
      await new Promise((r) => setTimeout(r, 10));

      // EXACTLY ONE generation enqueue across both requests — the 2nd hit the
      // negative cache and skipped the Modal dispatch entirely.
      expect(countModalDispatches(publishFetch)).toBe(1);

      // Redis was consulted exactly once — during request 1's genuine cache miss.
      // Request 2's Postgres NEUTRAL hit short-circuits BEFORE Redis is ever
      // consulted (mirrors the FIT short-circuit already proven by
      // route.follow460.test.ts), so the call count does not grow to 2.
      expect(mockGetCachedDescription).toHaveBeenCalledTimes(1);

      vi.unstubAllGlobals();
    },
  );

  it('a NEUTRAL Redis hit (Postgres miss) also short-circuits without a Modal dispatch', async () => {
    const publishFetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', publishFetch);

    mockGetPgCachedDescription.mockResolvedValue(null);
    mockGetCachedDescription.mockResolvedValue({
      text: '',
      headline: null,
      generated_at: new Date().toISOString(),
      verdict: 'NEUTRAL',
    });

    const res = await GET(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string };
    expect(body.source).toBe('template_fallback');

    await new Promise((r) => setTimeout(r, 10));
    expect(countModalDispatches(publishFetch)).toBe(0);
    // No Postgres backfill from a NEUTRAL Redis hit either.
    expect(mockInsertPgCachedDescription).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('a FIT Postgres hit (verdict undefined) is unaffected — still served as ai_cached', async () => {
    mockGetPgCachedDescription.mockResolvedValue({
      description: 'A warm, family-friendly home near great schools.',
      headline: 'Room to grow in a great school catchment',
      generatedAt: new Date().toISOString(),
      model: 'claude-sonnet-4-6',
      // verdict intentionally omitted — mirrors every pre-FOLLOW-465 mock/row.
    });

    const res = await GET(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; description: string };
    expect(body.source).toBe('ai_cached');
    expect(body.description).toBe('A warm, family-friendly home near great schools.');
  });
});
