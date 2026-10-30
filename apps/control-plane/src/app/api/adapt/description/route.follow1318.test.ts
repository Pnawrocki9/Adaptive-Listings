/**
 * FOLLOW-1318: `GET /api/adapt/description` never returns the playbook's INTERNAL writing
 * instructions (`copy_template`) in `description` on `source=template_fallback`. The three
 * template_fallback paths (cold-start miss, NEUTRAL negative-cache hit, unreadable listing
 * revision) answer with an empty description; `ai_cached` is unchanged.
 *
 * @module apps/control-plane/src/app/api/adapt/description/route.follow1318.test
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
  mockGetListingRevision,
} = vi.hoisted(() => ({
  mockGetPgCachedDescription: vi.fn(),
  mockGetListingRevision: vi.fn(),
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
  // FOLLOW-1291: the listing was never updated (revision 0).
  getListingRevision: mockGetListingRevision,
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
  fetchListingTextFields: vi.fn().mockResolvedValue({ description: 'The agent original copy.' }),
}));

// FOLLOW-473: GET auth is now the shared two-step resolver (resolveAdaptGetAuth),
// which also derives the tenant (replacing getAuthClaims/x-tenant-id). Mock it to
// the deterministic tenant this suite exercises — the real auth mechanics are
// covered end-to-end in description/route.follow473.test.ts.
vi.mock('@/lib/adapt-get-auth', () => ({
  resolveAdaptGetAuth: vi.fn().mockResolvedValue({ ok: true, tenantId: 'test-tenant-uuid' }),
}));

// FOLLOW-1297 (ADR-0023): generation runs in-process; the suite observes it through this mock.
const { mockGenerateDescription } = vi.hoisted(() => ({
  mockGenerateDescription: vi.fn((_event: Record<string, unknown>) =>
    Promise.resolve({
      outcome: { verdict: 'FIT', description: 'x', verifiedFacts: [] },
      headline: null,
      writes: { pg: 'published', redis: 'written', audit: 'written' },
    }),
  ),
}));
vi.mock('@/lib/description-generator', () => ({
  generateDescription: mockGenerateDescription,
  // `lib/claim-containment` re-exports the stamp from the generator module.
  CLAIMS_VALIDATION_VERSION: 'claims-v2',
}));

import { GET } from './route';
import { CLAIMS_VALIDATION_VERSION } from '@/lib/claim-containment';
import { getPlaybook } from '@estalara/shared/playbooks';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_PARAMS = {
  listing_id: 'prop-follow1318-test',
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

// ─── Tests ────────────────────────────────────────────────────────────────────

interface Body {
  source: string;
  description: string;
  headline: string | null;
}

describe('FOLLOW-1318: template_fallback carries no playbook text', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetListingRevision.mockResolvedValue(0);
    mockGetPgCachedDescription.mockResolvedValue(null);
    mockGetCachedDescription.mockResolvedValue(null);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
  });

  function expectNoPlaybookText(body: Body, locale: 'en' | 'pl' | 'es'): void {
    const template = getPlaybook('family_buyer').copy_template[locale];
    expect(template.length).toBeGreaterThan(0);
    expect(body.source).toBe('template_fallback');
    expect(body.description).not.toContain(template);
    expect(body.description).toBe('');
    expect(body.headline).toBeNull();
  }

  it.each(['en', 'pl', 'es'] as const)('cold-start miss (%s)', async (locale) => {
    const res = await GET(makeRequest({ ...VALID_PARAMS, locale }));
    expect(res.status).toBe(200);
    expectNoPlaybookText((await res.json()) as Body, locale);
    // the generator still receives the playbook text as its INPUT
    await new Promise((r) => setTimeout(r, 10));
    expect(mockGenerateDescription.mock.calls[0]?.[0]).toMatchObject({
      copy_template: getPlaybook('family_buyer').copy_template[locale],
    });
  });

  it('NEUTRAL negative-cache hit', async () => {
    mockGetPgCachedDescription.mockResolvedValue({
      description: '',
      headline: null,
      generatedAt: new Date().toISOString(),
      model: 'claude-sonnet-4-6',
      verdict: 'NEUTRAL',
      claimsValidation: CLAIMS_VALIDATION_VERSION,
    });
    const res = await GET(makeRequest(VALID_PARAMS));
    expectNoPlaybookText((await res.json()) as Body, 'en');
  });

  it('unreadable listing revision (fail closed)', async () => {
    mockGetListingRevision.mockResolvedValue(null);
    const res = await GET(makeRequest(VALID_PARAMS));
    expectNoPlaybookText((await res.json()) as Body, 'en');
  });

  it('ai_cached response is unchanged', async () => {
    mockGetPgCachedDescription.mockResolvedValue({
      description: 'A warm home near great schools.',
      headline: 'Room to grow',
      generatedAt: new Date().toISOString(),
      model: 'claude-sonnet-4-6',
      verdict: 'FIT',
      claimsValidation: CLAIMS_VALIDATION_VERSION,
      listingRevision: 0,
    });
    const body = (await (await GET(makeRequest(VALID_PARAMS))).json()) as Body;
    expect(body).toMatchObject({
      source: 'ai_cached',
      description: 'A warm home near great schools.',
      headline: 'Room to grow',
    });
  });
});
