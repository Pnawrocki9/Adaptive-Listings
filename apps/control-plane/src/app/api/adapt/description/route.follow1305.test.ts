/**
 * FOLLOW-1305 (FOLLOW-820 condition 1c) — legacy admission on the description read path.
 *
 * A description cache entry written BEFORE the unsupported-claim check existed carries no
 * `claims_validation` stamp. It is not trusted FIT: the route serves it as a MISS (the seller's
 * copy via `template_fallback`) and enqueues one regeneration under the check, instead of
 * serving it as `ai_cached`. The unsafe fixture is the Codex reproduction's copy (an unsupported
 * 9.9% yield). A stamped entry is served as before, and the warm/backfill writers copy the stamp
 * so neither can launder a legacy entry into a trusted one.
 *
 * @module apps/control-plane/src/app/api/adapt/description/route.follow1305.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const {
  mockGetPgCachedDescription,
  mockInsertPgCachedDescription,
  mockGetCachedDescription,
  mockSetCachedDescription,
} = vi.hoisted(() => ({
  mockGetPgCachedDescription: vi.fn(),
  mockInsertPgCachedDescription: vi.fn().mockResolvedValue(undefined),
  mockGetCachedDescription: vi.fn(),
  mockSetCachedDescription: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/description-pg-cache', () => ({
  getPgCachedDescription: mockGetPgCachedDescription,
  insertPgCachedDescription: mockInsertPgCachedDescription,
}));

vi.mock('@/lib/description-cache', () => ({
  getCachedDescription: mockGetCachedDescription,
  descriptionKey: (t: string, l: string, a: string, loc: string) => `desc:${t}:${l}:${a}:${loc}`,
  setCachedDescription: mockSetCachedDescription,
  invalidateDescriptionCache: vi.fn(),
}));

vi.mock('@/lib/rag-retrieval', () => ({
  retrieveListingContext: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/global-config-store', () => ({
  getGlobalGenerationModel: vi.fn().mockResolvedValue('claude-sonnet-4-6'),
}));

vi.mock('@/lib/demo-override-store', () => ({
  getDemoOverride: vi.fn().mockResolvedValue({
    enabled: false,
    overrideArchetype: null,
    overrideModel: 'claude-sonnet-4-6',
  }),
}));

vi.mock('@/lib/listing-details', () => ({
  fetchListingOriginalDescription: vi.fn().mockResolvedValue('An apartment with two bedrooms.'),
}));

vi.mock('@/lib/adapt-get-auth', () => ({
  resolveAdaptGetAuth: vi.fn().mockResolvedValue({ ok: true, tenantId: 'test-tenant-uuid' }),
}));

import { GET } from './route';
import { CLAIMS_VALIDATION_VERSION } from '@/lib/claim-containment';

const UNSAFE_LEGACY_TEXT = 'A two-bedroom apartment offering a guaranteed 9.9% yield.';
const SAFE_TEXT = 'A two-bedroom apartment for a rental buyer.';

function request(): NextRequest {
  const url = new URL('http://localhost/api/adapt/description');
  url.searchParams.set('listing_id', 'prop-follow1305');
  url.searchParams.set('archetype', 'yield_hunter');
  url.searchParams.set('locale', 'en');
  return new NextRequest(url, { headers: { Authorization: 'Bearer test-token' } });
}

function modalDispatches(fetchMock: ReturnType<typeof vi.fn>): number {
  return fetchMock.mock.calls.filter(
    (call: unknown[]) => (call[1] as RequestInit | undefined)?.method === 'POST',
  ).length;
}

const pgRow = (description: string, claimsValidation: string | null) => ({
  description,
  headline: null,
  generatedAt: '2026-10-01T00:00:00.000Z',
  model: 'claude-sonnet-4-6',
  verdict: 'FIT' as const,
  claimsValidation,
});

describe('FOLLOW-1305 — a legacy (unstamped) cache hit is not trusted FIT', () => {
  let publishFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // `clearAllMocks` keeps queued `mockResolvedValueOnce` values; a hit served by an earlier
    // layer would leave the next layer's queued value to leak into the next test.
    mockGetPgCachedDescription.mockReset().mockResolvedValue(null);
    mockGetCachedDescription.mockReset().mockResolvedValue(null);
    mockInsertPgCachedDescription.mockResolvedValue(undefined);
    mockSetCachedDescription.mockResolvedValue(undefined);
    vi.stubEnv('MODAL_DESCRIPTION_URL', 'https://modal.example.test/description');
    publishFetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', publishFetch);
  });

  it('legacy unsafe Postgres hit → miss: seller copy served, regeneration enqueued, nothing warmed', async () => {
    mockGetPgCachedDescription.mockResolvedValueOnce(pgRow(UNSAFE_LEGACY_TEXT, null));
    mockGetCachedDescription.mockResolvedValueOnce(null);

    const body = (await (await GET(request())).json()) as { source: string; description: string };

    expect(body.source).toBe('template_fallback');
    expect(body.description).not.toContain('9.9%');
    expect(mockSetCachedDescription).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(modalDispatches(publishFetch)).toBe(1);
    });
  });

  it('legacy unsafe Redis hit → miss: seller copy served, no Postgres backfill, regeneration enqueued', async () => {
    mockGetPgCachedDescription.mockResolvedValueOnce(null);
    mockGetCachedDescription.mockResolvedValueOnce({
      text: UNSAFE_LEGACY_TEXT,
      headline: null,
      generated_at: '2026-10-01T00:00:00.000Z',
    });

    const body = (await (await GET(request())).json()) as { source: string; description: string };

    expect(body.source).toBe('template_fallback');
    expect(body.description).not.toContain('9.9%');
    expect(mockInsertPgCachedDescription).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(modalDispatches(publishFetch)).toBe(1);
    });
  });

  it('a stale-version stamp is legacy too', async () => {
    mockGetPgCachedDescription.mockResolvedValueOnce(pgRow(SAFE_TEXT, 'claims-v0'));
    mockGetCachedDescription.mockResolvedValueOnce(null);

    const body = (await (await GET(request())).json()) as { source: string };
    expect(body.source).toBe('template_fallback');
  });

  it('positive control: a stamped Postgres hit is served as ai_cached and the warm copies the stamp', async () => {
    mockGetPgCachedDescription.mockResolvedValueOnce(pgRow(SAFE_TEXT, CLAIMS_VALIDATION_VERSION));

    const body = (await (await GET(request())).json()) as { source: string; description: string };

    expect(body).toMatchObject({ source: 'ai_cached', description: SAFE_TEXT });
    await vi.waitFor(() => {
      expect(mockSetCachedDescription).toHaveBeenCalledTimes(1);
    });
    expect(mockSetCachedDescription.mock.calls[0]?.[1]).toMatchObject({
      claims_validation: CLAIMS_VALIDATION_VERSION,
    });
    expect(modalDispatches(publishFetch)).toBe(0);
  });

  it('positive control: a stamped Redis hit is served and the Postgres backfill copies the stamp', async () => {
    mockGetPgCachedDescription.mockResolvedValueOnce(null);
    mockGetCachedDescription.mockResolvedValueOnce({
      text: SAFE_TEXT,
      headline: null,
      generated_at: '2026-10-01T00:00:00.000Z',
      claims_validation: CLAIMS_VALIDATION_VERSION,
    });

    const body = (await (await GET(request())).json()) as { source: string };

    expect(body.source).toBe('ai_cached');
    await vi.waitFor(() => {
      expect(mockInsertPgCachedDescription).toHaveBeenCalledTimes(1);
    });
    expect(mockInsertPgCachedDescription.mock.calls[0]?.[7]).toBe(CLAIMS_VALIDATION_VERSION);
  });

  it('a legacy NEUTRAL marker carries no text and still short-circuits (no re-enqueue)', async () => {
    mockGetPgCachedDescription.mockResolvedValueOnce({
      ...pgRow('', null),
      verdict: 'NEUTRAL' as const,
    });

    const body = (await (await GET(request())).json()) as { source: string };
    expect(body.source).toBe('template_fallback');
    expect(modalDispatches(publishFetch)).toBe(0);
  });
});
