/**
 * FOLLOW-1297 (ADR-0023 §5 step 2) — the switch in `description/route.ts`:
 *   - `MODAL_DESCRIPTION_URL` set   → the Modal dispatch (unchanged), `generateDescription` NOT called;
 *   - `MODAL_DESCRIPTION_URL` unset → `generateDescription(event)` registered via after().
 * Everything before the dispatch (auth, cache lookups, empty-original refusal) is unchanged.
 */
vi.mock('next/server', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('next/server');
  return {
    ...actual,
    after: vi.fn((fn: () => unknown) => {
      void fn();
    }),
  };
});

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), addBreadcrumb: vi.fn() }));

const { mockGenerate, mockGetCachedDescription } = vi.hoisted(() => ({
  mockGenerate: vi.fn(),
  mockGetCachedDescription: vi.fn(),
}));

vi.mock('@/lib/description-generator', () => ({ generateDescription: mockGenerate }));
vi.mock('@/lib/description-cache', () => ({
  getCachedDescription: mockGetCachedDescription,
  descriptionKey: (t: string, l: string, a: string, lo: string) => `desc:${t}:${l}:${a}:${lo}`,
  setCachedDescription: vi.fn(),
  invalidateDescriptionCache: vi.fn(),
}));
vi.mock('@/lib/rag-retrieval', () => ({
  retrieveListingContext: vi.fn().mockResolvedValue({}),
}));
vi.mock('@/lib/listing-details', () => ({
  fetchListingOriginalDescription: vi.fn().mockResolvedValue('A two-bedroom flat in Lisbon.'),
}));
vi.mock('@/lib/global-config-store', () => ({
  getGlobalGenerationModel: vi.fn().mockResolvedValue('claude-sonnet-4-6'),
  ALLOWED_GENERATION_MODELS: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-8'],
  DEFAULT_GENERATION_MODEL: 'claude-sonnet-4-6',
}));
vi.mock('@/lib/demo-override-store', () => ({
  getDemoOverride: vi.fn().mockResolvedValue({ enabled: false, overrideArchetype: null }),
}));
vi.mock('@/lib/description-pg-cache', () => ({
  getPgCachedDescription: vi.fn().mockResolvedValue(null),
  getListingRevision: vi.fn().mockResolvedValue(0),
  insertPgCachedDescription: vi.fn(),
}));
vi.mock('@/lib/adapt-get-auth', () => ({
  resolveAdaptGetAuth: vi
    .fn()
    .mockResolvedValue({ ok: true, tenantId: '00000000-0000-4000-8000-000000001297' }),
}));

import { GET, maxDuration } from './route';

function makeRequest(): NextRequest {
  const url = new URL('http://localhost/api/adapt/description');
  url.searchParams.set('listing_id', 'listing-1297');
  url.searchParams.set('archetype', 'yield_hunter');
  url.searchParams.set('locale', 'en');
  return new NextRequest(url, { headers: { Authorization: 'Bearer test-key' } });
}

describe('description route — FOLLOW-1297 switch', () => {
  beforeEach(() => {
    mockGetCachedDescription.mockResolvedValue(null);
    mockGenerate.mockReset().mockResolvedValue({
      outcome: { verdict: 'FIT', description: 'x', verifiedFacts: [] },
      headline: null,
      claimsValidation: 'claims-v1',
      writes: { pg: 'published', redis: 'written', audit: 'written' },
    });
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('exports maxDuration = 120 (G-03: after() work counts against the function budget)', () => {
    expect(maxDuration).toBe(120);
  });

  it('MODAL_DESCRIPTION_URL unset → generateDescription(event) runs in-process, no Modal fetch', async () => {
    vi.stubEnv('MODAL_DESCRIPTION_URL', '');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));

    expect(mockGenerate).toHaveBeenCalledOnce();
    const event = mockGenerate.mock.calls[0]![0] as Record<string, unknown>;
    expect(event).toMatchObject({
      tenant_id: '00000000-0000-4000-8000-000000001297',
      listing_id: 'listing-1297',
      archetype: 'yield_hunter',
      locale: 'en',
      original_description: 'A two-bedroom flat in Lisbon.',
      listing_context: {},
      listing_revision: 0,
      generation_model: 'claude-sonnet-4-6',
    });
    expect(String(event.cache_key)).toMatch(/:claude-sonnet-4-6:r0$/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('MODAL_DESCRIPTION_URL set → the Modal dispatch, generateDescription NOT called', async () => {
    vi.stubEnv('MODAL_DESCRIPTION_URL', 'https://modal.test/description');
    vi.stubEnv('INTERNAL_API_SECRET', 'test-internal-secret');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 202 });
    vi.stubGlobal('fetch', fetchMock);

    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));

    expect(mockGenerate).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]![0]).toBe('https://modal.test/description');
  });
});
