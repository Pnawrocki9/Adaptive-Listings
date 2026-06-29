/**
 * FOLLOW-426: fail-loud tests for publishDescriptionRequested (via GET handler).
 *
 * Verifies that an HTTP-level rejection from the Redpanda REST proxy (non-ok
 * response: 4xx/5xx, auth failure, missing topic, quota) is captured to Sentry —
 * NOT silently swallowed. Before FOLLOW-426, publishDescriptionRequested used a bare
 * `await fetch()` with no `res.ok` check; the outer `.catch()` at the call site was
 * completely blind to these HTTP-level rejections because `fetch` resolves on 4xx/5xx.
 *
 * Tests exercise the cache-miss path (getCachedDescription → null) so that
 * publishDescriptionRequested is invoked on every request. Three tests per AC-3:
 *   (a) non-ok HTTP response → Sentry captured with kind='insert_rejected'
 *   (b) network / thrown error → Sentry captured with kind='network'
 *   (c) happy path (ok response) → Sentry NOT called, caller unaffected
 *
 * FOLLOW-431: also asserts that publishDescriptionRequested is registered via after()
 * so it completes after the response on Vercel (AC-4).
 *
 * @module apps/control-plane/src/app/api/adapt/description/route.redpanda.test
 */

// ─── next/server mock (must be before all imports) ───────────────────────────
// Mock after() as a synchronous pass-through spy so existing tests that rely on
// the fire-and-forget fetch completing synchronously continue to work, and new
// tests can assert after() was called (FOLLOW-431 / AC-4).
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
//
// vi.hoisted is required because vi.mock factories are hoisted to the top of the
// module; variables declared outside them cannot be referenced inside.

const { mockGetCachedDescription, mockDescriptionKey } = vi.hoisted(() => ({
  mockGetCachedDescription: vi.fn(),
  mockDescriptionKey: vi.fn(
    (tenantId: string, listingId: string, archetype: string, locale: string) =>
      `desc:${tenantId}:${listingId}:${archetype}:${locale}`,
  ),
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

// Mock listing-details so only the Redpanda publish triggers a real fetch call
vi.mock('@/lib/listing-details', () => ({
  fetchListingOriginalDescription: vi.fn().mockResolvedValue(''),
}));

// Mock description-pg-cache: getPgCachedDescription returns null (no Postgres in tests)
// so the route always falls through to the Redis/cache-miss path.
vi.mock('@/lib/description-pg-cache', () => ({
  getPgCachedDescription: vi.fn().mockResolvedValue(null),
  insertPgCachedDescription: vi.fn().mockResolvedValue(undefined),
}));

import * as Sentry from '@sentry/nextjs';
import { after } from 'next/server';
import { GET } from './route';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const VALID_PARAMS = {
  listing_id: 'prop-follow426-test',
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

describe('publishDescriptionRequested — FOLLOW-426 fail loud on Redpanda HTTP rejection', () => {
  let captureException: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    captureException = vi.mocked(Sentry.captureException);
    captureException.mockReset();
    // Cache miss on every test so the route reaches publishDescriptionRequested
    mockGetCachedDescription.mockResolvedValue(null);
    vi.stubEnv('REDPANDA_REST_URL', 'https://redpanda.test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('FOLLOW-426 (a): non-ok HTTP response → captureException called with kind=insert_rejected, route returns 200', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Authentication failed. Invalid credentials.'),
      }),
    );

    // Route must still return 200 — fire-and-forget failure must not surface to callers
    const res = await GET(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(200);

    // Allow the fire-and-forget .then() microtask chain to settle
    await new Promise((r) => setTimeout(r, 10));

    expect(captureException).toHaveBeenCalledOnce();
    const [capturedErr, capturedCtx] = captureException.mock.calls[0] as [
      Error,
      { tags: Record<string, string>; extra: Record<string, unknown> },
    ];
    expect(capturedErr).toBeInstanceOf(Error);
    expect(capturedErr.message).toContain('401');
    expect(capturedErr.message).toContain('Authentication failed');
    expect(capturedCtx.tags.kind).toBe('insert_rejected');
    expect(capturedCtx.tags.sink).toBe('redpanda');
    expect(capturedCtx.tags.area).toBe('description');
    expect(capturedCtx.extra.status).toBe(401);
  });

  it('FOLLOW-426 (b): network-level rejection → captureException called with kind=network, route returns 200', async () => {
    const networkErr = new Error('connect ECONNREFUSED redpanda.test:443');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkErr));

    const res = await GET(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(200);

    await new Promise((r) => setTimeout(r, 10));

    expect(captureException).toHaveBeenCalledOnce();
    const [capturedErr, capturedCtx] = captureException.mock.calls[0] as [
      Error,
      { tags: Record<string, string> },
    ];
    expect(capturedErr).toBeInstanceOf(Error);
    expect(capturedErr.message).toContain('ECONNREFUSED');
    expect(capturedCtx.tags.kind).toBe('network');
    expect(capturedCtx.tags.sink).toBe('redpanda');
    expect(capturedCtx.tags.area).toBe('description');
  });

  it('FOLLOW-426 (c): successful HTTP 200 → captureException NOT called, route returns 200 template_fallback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));

    const res = await GET(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string };
    expect(body.source).toBe('template_fallback');

    await new Promise((r) => setTimeout(r, 10));

    expect(captureException).not.toHaveBeenCalled();
  });
});

// ─── FOLLOW-431: after() registration ────────────────────────────────────────
//
// AC-1: publishDescriptionRequested must be registered via after() in the GET
// handler so its async work completes after the response is sent on Vercel.

describe('FOLLOW-431: publishDescriptionRequested registered via after() in GET handler', () => {
  let mockAfter: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockAfter = vi.mocked(after);
    mockAfter.mockReset();
    mockAfter.mockImplementation((fn: () => unknown) => {
      void fn();
    });
    mockGetCachedDescription.mockResolvedValue(null);
    vi.stubEnv('REDPANDA_REST_URL', 'https://redpanda.test');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('FOLLOW-431: GET handler registers publishDescriptionRequested via after() on cache-miss path', async () => {
    const res = await GET(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(200);

    // after() must have been called with a function (the publishDescriptionRequested wrapper)
    expect(mockAfter).toHaveBeenCalledOnce();
    const [callback] = mockAfter.mock.calls[0] as [() => unknown];
    expect(typeof callback).toBe('function');
  });
});
