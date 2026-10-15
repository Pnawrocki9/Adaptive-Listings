/**
 * FOLLOW-457 AC1: fail-loud on empty/failed original_description fetch.
 *
 * ESC-019 residual gap — the listing read (fetchDescriptionGrounding since FOLLOW-1314) fails open to '' on any
 * 302/timeout/non-2xx/malformed-JSON/missing-field outcome (see listing-details.ts),
 * and previously the route started the generation regardless, risking
 * near-ungrounded Sonnet copy. This suite proves the route now:
 *   1. Captures the empty-original condition to Sentry (observable, not silent).
 *   2. Skips the generation entirely (no description.requested event).
 *   3. Still returns 200 template_fallback — the response contract is unaffected.
 *   4. Leaves the non-empty-original path unchanged (generation still starts; Sentry
 *      is not falsely triggered) — a regression guard for the happy path.
 *
 * @module apps/control-plane/src/app/api/adapt/description/route.follow457.test
 */

// ─── next/server mock (must be before all imports) ───────────────────────────
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
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── Sentry mock (must be hoisted before the module import) ──────────────────
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

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
  CLAIMS_VALIDATION_VERSION: 'claims-v1',
}));

// ─── Hoisted stubs ────────────────────────────────────────────────────────────

const { mockGetCachedDescription, mockDescriptionKey, mockFetchListingOriginalDescription } =
  vi.hoisted(() => ({
    mockGetCachedDescription: vi.fn(),
    mockDescriptionKey: vi.fn(
      (tenantId: string, listingId: string, archetype: string, locale: string) =>
        `desc:${tenantId}:${listingId}:${archetype}:${locale}`,
    ),
    mockFetchListingOriginalDescription: vi.fn(),
  }));

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('@/lib/description-cache', () => ({
  getCachedDescription: mockGetCachedDescription,
  descriptionKey: mockDescriptionKey,
  setCachedDescription: vi.fn(),
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

// FOLLOW-1314: the route reads the listing once through `fetchListingTextFields`; this stub keeps
// the test's own vocabulary (the original description string, '' = fetch failure).
vi.mock('@/lib/listing-details', () => ({
  fetchListingTextFields: async (...args: unknown[]) => {
    const description = (await mockFetchListingOriginalDescription(...args)) as string;
    return description ? { description } : null;
  },
}));

vi.mock('@/lib/description-pg-cache', () => ({
  // FOLLOW-1291: the listing was never updated (revision 0).
  getListingRevision: () => Promise.resolve(0),
  getPgCachedDescription: vi.fn().mockResolvedValue(null),
  insertPgCachedDescription: vi.fn().mockResolvedValue(undefined),
}));

import * as Sentry from '@sentry/nextjs';
// FOLLOW-473: GET auth is now the shared two-step resolver (resolveAdaptGetAuth),
// which also derives the tenant (replacing getAuthClaims/x-tenant-id). Mock it to
// the deterministic tenant this suite exercises — the real auth mechanics are
// covered end-to-end in description/route.follow473.test.ts.
vi.mock('@/lib/adapt-get-auth', () => ({
  resolveAdaptGetAuth: vi.fn().mockResolvedValue({ ok: true, tenantId: 'test-tenant-uuid' }),
}));

import { GET } from './route';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_PARAMS = {
  listing_id: 'prop-follow457-test',
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('FOLLOW-457 AC1: empty original_description fails loud and skips generation', () => {
  let captureException: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    captureException = vi.mocked(Sentry.captureException);
    captureException.mockReset();
    mockGetCachedDescription.mockResolvedValue(null);
    mockFetchListingOriginalDescription.mockReset();
    mockGenerateDescription.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('empty original_description (fetch failure): captures to Sentry, skips generation, still returns 200 template_fallback', async () => {
    mockFetchListingOriginalDescription.mockResolvedValue('');
    const publishFetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', publishFetch);

    const res = await GET(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string };
    expect(body.source).toBe('template_fallback');

    // Allow any fire-and-forget microtask chain to settle.
    await new Promise((r) => setTimeout(r, 10));

    // Runtime proof (ESC-019 residual gap resolved): the empty-original condition
    // is captured to Sentry ...
    expect(captureException).toHaveBeenCalledOnce();
    const [capturedErr, capturedCtx] = captureException.mock.calls[0] as [
      Error,
      { tags: Record<string, string>; extra: Record<string, unknown> },
    ];
    expect(capturedErr).toBeInstanceOf(Error);
    expect(capturedErr.message).toContain('empty original_description');
    expect(capturedCtx.tags.kind).toBe('empty_original_description');
    expect(capturedCtx.tags.area).toBe('description');
    expect(capturedCtx.extra.listingId).toBe(VALID_PARAMS.listing_id);
    expect(capturedCtx.extra.archetype).toBe(VALID_PARAMS.archetype);

    // ... AND the generation is never started.
    expect(mockGenerateDescription).not.toHaveBeenCalled();
  });

  it('non-empty original_description: Sentry is NOT captured and generation still starts (regression guard)', async () => {
    mockFetchListingOriginalDescription.mockResolvedValue('The agent original copy.');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    const res = await GET(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 10));

    expect(captureException).not.toHaveBeenCalled();
    expect(mockGenerateDescription).toHaveBeenCalledOnce();
    const event = mockGenerateDescription.mock.calls[0]![0];
    expect(event.original_description).toBe('The agent original copy.');
  });
});
