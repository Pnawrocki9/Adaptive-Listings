/**
 * FOLLOW-1314 — the description route hands the generator the listing's OWN structured fields.
 *
 * Red-first: on `main` `c20ce2ab` the route sent `listing_context` = `retrieveListingContext(…, null)`,
 * which is `{}` by construction, so the headline check never saw the place, title or price the
 * listing itself carries ("Palm Coast" was refused as `hallucinated_proper_name`). The listing
 * module mock below answers BOTH the pre-FOLLOW-1314 reader and the current one with the same
 * payload, so this file fails on `main` for the defect, not for a missing mock.
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
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), addBreadcrumb: vi.fn() }));

const { mockGenerate, mockRag, mockTextFields } = vi.hoisted(() => ({
  mockGenerate: vi.fn(),
  mockRag: vi.fn(),
  mockTextFields: vi.fn(),
}));

/** The fixture listing as `fetchListingTextFields` maps the `:8081` payload. */
const FIXTURE_FIELDS = {
  title: '9 Blackberry Pl, Palm Coast, FL 32137 — 3 bed, 2 bath',
  description: 'A three-bedroom, two-bathroom single-family home on a quiet residential street.',
  price: '385000 USD',
  location: '9 Blackberry Pl, Palm Coast, FL',
};

vi.mock('@/lib/description-generator', () => ({ generateDescription: mockGenerate }));
vi.mock('@/lib/description-cache', () => ({
  getCachedDescription: vi.fn().mockResolvedValue(null),
  descriptionKey: (t: string, l: string, a: string, lo: string) => `desc:${t}:${l}:${a}:${lo}`,
  setCachedDescription: vi.fn(),
  invalidateDescriptionCache: vi.fn(),
}));
vi.mock('@/lib/rag-retrieval', () => ({ retrieveListingContext: mockRag }));
vi.mock('@/lib/listing-details', () => ({
  fetchListingTextFields: mockTextFields,
  // The pre-FOLLOW-1314 reader, answering from the same payload (see the module docblock).
  fetchListingOriginalDescription: async (id: string, locale: string) =>
    ((await mockTextFields(id, locale)) as typeof FIXTURE_FIELDS | null)?.description ?? '',
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
  getListingRevision: vi.fn().mockResolvedValue(3),
  insertPgCachedDescription: vi.fn(),
}));
vi.mock('@/lib/adapt-get-auth', () => ({
  resolveAdaptGetAuth: vi
    .fn()
    .mockResolvedValue({ ok: true, tenantId: '00000000-0000-4000-8000-000000001314' }),
}));

import { GET } from './route';

const LISTING_ID = '839ecbd1-4e7d-4fd9-bda7-37ceb27eaa1c';

function makeRequest(): NextRequest {
  const url = new URL('http://localhost/api/adapt/description');
  url.searchParams.set('listing_id', LISTING_ID);
  url.searchParams.set('archetype', 'family_buyer');
  url.searchParams.set('locale', 'en');
  return new NextRequest(url, { headers: { Authorization: 'Bearer test-key' } });
}

async function dispatchedEvent(): Promise<Record<string, unknown>> {
  const res = await GET(makeRequest());
  expect(res.status).toBe(200);
  await new Promise((r) => setTimeout(r, 10));
  expect(mockGenerate).toHaveBeenCalledOnce();
  return mockGenerate.mock.calls[0]![0] as Record<string, unknown>;
}

describe('description route — FOLLOW-1314 listing fields reach the generator', () => {
  beforeEach(() => {
    mockRag.mockReset().mockResolvedValue({});
    mockTextFields.mockReset().mockResolvedValue(FIXTURE_FIELDS);
    mockGenerate.mockReset().mockResolvedValue({
      outcome: { verdict: 'FIT', description: 'x', verifiedFacts: [] },
      headline: null,
      claimsValidation: 'claims-v2',
      writes: { pg: 'published', redis: 'written', audit: 'written' },
    });
  });

  it('listing_context carries the listing title, price and location; the description travels once', async () => {
    const event = await dispatchedEvent();
    expect(event.original_description).toBe(FIXTURE_FIELDS.description);
    expect(event.listing_context).toEqual({
      listing_title: FIXTURE_FIELDS.title,
      listing_price: FIXTURE_FIELDS.price,
      listing_location: FIXTURE_FIELDS.location,
    });
    expect(event.listing_revision).toBe(3);
    // One backend read for both the description and the fields.
    expect(mockTextFields).toHaveBeenCalledTimes(1);
    expect(mockTextFields).toHaveBeenCalledWith(LISTING_ID, 'en');
  });

  it('an agency-curated FAQ answer wins over a backend field on a key clash', async () => {
    mockRag.mockResolvedValue({ listing_location: 'Palm Coast (curated)', faq: 'answer' });
    const event = await dispatchedEvent();
    expect(event.listing_context).toEqual({
      listing_title: FIXTURE_FIELDS.title,
      listing_price: FIXTURE_FIELDS.price,
      listing_location: 'Palm Coast (curated)',
      faq: 'answer',
    });
  });

  it('an unreadable listing still skips generation (FOLLOW-457), with no fields invented', async () => {
    mockTextFields.mockResolvedValue(null);
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 10));
    expect(mockGenerate).not.toHaveBeenCalled();
  });
});
