/**
 * FOLLOW-457 AC1: fail-loud on empty/failed original_description fetch.
 *
 * ESC-019 residual gap — fetchListingOriginalDescription fails open to '' on any
 * 302/timeout/non-2xx/malformed-JSON/missing-field outcome (see listing-details.ts),
 * and previously the route enqueued the Modal generation job regardless, risking
 * near-ungrounded Sonnet copy. This suite proves the route now:
 *   1. Captures the empty-original condition to Sentry (observable, not silent).
 *   2. Skips enqueuing the Modal job entirely (no description.requested publish).
 *   3. Still returns 200 template_fallback — the response contract is unaffected.
 *   4. Leaves the non-empty-original path unchanged (publish still fires; Sentry
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

vi.mock('@/lib/listing-details', () => ({
  fetchListingOriginalDescription: mockFetchListingOriginalDescription,
}));

vi.mock('@/lib/description-pg-cache', () => ({
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
    vi.stubEnv('MODAL_DESCRIPTION_URL', 'https://modal.test/description');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('empty original_description (fetch failure): captures to Sentry, skips Modal dispatch, still returns 200 template_fallback', async () => {
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

    // ... AND the Modal generation job is never dispatched: no POST to Modal.
    const postCalls = publishFetch.mock.calls.filter((call: unknown[]) => {
      const init = call[1] as RequestInit | undefined;
      return init?.method === 'POST';
    });
    expect(postCalls).toHaveLength(0);
  });

  it('non-empty original_description: Sentry is NOT captured and Modal dispatch still fires (regression guard)', async () => {
    mockFetchListingOriginalDescription.mockResolvedValue('The agent original copy.');
    const publishedBodies: string[] = [];
    const publishFetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        publishedBodies.push((init.body as string | undefined) ?? '');
      }
      return Promise.resolve(new Response('', { status: 200 }));
    });
    vi.stubGlobal('fetch', publishFetch);

    const res = await GET(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 10));

    expect(captureException).not.toHaveBeenCalled();
    expect(publishedBodies).toHaveLength(1);
    const event = JSON.parse(publishedBodies[0]!) as Record<string, unknown>;
    expect(event.original_description).toBe('The agent original copy.');
  });
});
