/**
 * FOLLOW-464 / audit F-15 / RETRO-162 LG-1: model-key the Postgres description cache
 * read (`getPgCachedDescription`) so a model switch is not defeated by a stale
 * (or, post-FOLLOW-465, a cross-model NEUTRAL) Postgres Step-1 hit.
 *
 * Before this fix, `getPgCachedDescription`'s WHERE clause omitted `model` entirely,
 * so it returned the most-recent row for (tenant, listing, archetype, locale)
 * regardless of which model generated it — even though the model-scoped Redis Step-2
 * (`cacheKey` suffixed `:{model}` / `:demo:{model}`) runs AFTER it and never gets a
 * chance to be consulted on a Step-1 hit. Consequences:
 *   - F-15: a FIT row generated under model A is served (stale) for a model-B request.
 *   - RETRO-162 LG-1: after FOLLOW-465, a NEUTRAL negative-cache marker written under
 *     model A permanently short-circuits (serves template_fallback, skips Modal
 *     dispatch for) a request under model B — including the DEMO `override_model`
 *     preview — until `listing.updated` invalidation.
 *
 * This suite drives the mocked `getPgCachedDescription` with MODEL-AWARE behaviour
 * (returning a row only when the requested `model` argument matches the row's stored
 * model — i.e. simulating the real, now-fixed WHERE clause) to prove the route
 * re-dispatches / re-generates instead of serving a stale hit or a cross-model
 * negative-cache short-circuit.
 *
 * @module apps/control-plane/src/app/api/adapt/description/route.follow464.test
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
  mockGetGlobalGenerationModel,
  mockGetDemoOverride,
} = vi.hoisted(() => ({
  mockGetPgCachedDescription: vi.fn(),
  mockInsertPgCachedDescription: vi.fn().mockResolvedValue(undefined),
  mockGetCachedDescription: vi.fn(),
  mockSetCachedDescription: vi.fn().mockResolvedValue(undefined),
  mockDescriptionKey: vi.fn(
    (tenantId: string, listingId: string, archetype: string, locale: string) =>
      `desc:${tenantId}:${listingId}:${archetype}:${locale}`,
  ),
  mockGetGlobalGenerationModel: vi.fn(),
  mockGetDemoOverride: vi.fn(),
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
  getGlobalGenerationModel: mockGetGlobalGenerationModel,
  ALLOWED_GENERATION_MODELS: [
    'claude-haiku-4-5-20251001',
    'claude-sonnet-4-6',
    'claude-opus-4-8',
  ] as const,
  DEFAULT_GENERATION_MODEL: 'claude-sonnet-4-6',
  GENERATION_MODEL_KEY: 'generation_model',
}));

vi.mock('@/lib/demo-override-store', () => ({
  getDemoOverride: mockGetDemoOverride,
}));

vi.mock('@/lib/listing-details', () => ({
  fetchListingOriginalDescription: vi.fn().mockResolvedValue('The agent original copy.'),
}));

import { GET } from './route';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_PARAMS = {
  listing_id: 'prop-follow464-test',
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

/** Model-aware getPgCachedDescription stub — simulates the FIXED (model-scoped) WHERE clause. */
function pgRowFor(model: string, verdict: 'FIT' | 'NEUTRAL') {
  return {
    description: verdict === 'FIT' ? 'A warm home for growing families.' : '',
    headline: verdict === 'FIT' ? 'Room to grow' : null,
    generatedAt: new Date().toISOString(),
    model,
    verdict,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockInsertPgCachedDescription.mockResolvedValue(undefined);
  mockSetCachedDescription.mockResolvedValue(undefined);
  // Redis Step-2 is always a clean miss in these tests — the point under test is
  // exclusively the Postgres Step-1 model-scoping, so a Step-2 miss guarantees any
  // dispatch/re-generation we observe is attributable to Step-1 not short-circuiting.
  mockGetCachedDescription.mockResolvedValue(null);
  mockGetDemoOverride.mockResolvedValue({
    enabled: false,
    overrideArchetype: null,
    overrideModel: null,
  });
  mockGetGlobalGenerationModel.mockResolvedValue('claude-sonnet-4-6');
  vi.stubEnv('MODAL_DESCRIPTION_URL', 'https://modal.example.test/description');
});

describe('FOLLOW-464 / F-15: FIT model-switch cache-busting on the Postgres path', () => {
  it('a FIT row stored under model A does not satisfy a model-B request (miss -> regen)', async () => {
    const publishFetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
    vi.stubGlobal('fetch', publishFetch);

    // Model-aware stub: only returns the row when the requested model matches.
    mockGetPgCachedDescription.mockImplementation(
      (_t: string, _l: string, _a: string, _loc: string, model: string) =>
        model === 'claude-sonnet-4-6' ? pgRowFor('claude-sonnet-4-6', 'FIT') : null,
    );

    // Request 1: global model = claude-sonnet-4-6 -> Postgres FIT hit -> ai_cached.
    mockGetGlobalGenerationModel.mockResolvedValueOnce('claude-sonnet-4-6');
    const res1 = await GET(makeRequest(VALID_PARAMS));
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { source: string };
    expect(body1.source).toBe('ai_cached');
    expect(mockGetPgCachedDescription).toHaveBeenLastCalledWith(
      'test-tenant-uuid',
      VALID_PARAMS.listing_id,
      VALID_PARAMS.archetype,
      VALID_PARAMS.locale,
      'claude-sonnet-4-6',
    );

    // Request 2: global model switches to claude-opus-4-8 -> Postgres model-scoped
    // miss (row was stored under claude-sonnet-4-6) -> falls through to Redis (also a
    // clean miss) -> falls to the full cache-miss path -> Modal dispatch (re-gen).
    mockGetGlobalGenerationModel.mockResolvedValueOnce('claude-opus-4-8');
    const res2 = await GET(makeRequest(VALID_PARAMS));
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { source: string };
    expect(body2.source).toBe('template_fallback');
    expect(mockGetPgCachedDescription).toHaveBeenLastCalledWith(
      'test-tenant-uuid',
      VALID_PARAMS.listing_id,
      VALID_PARAMS.archetype,
      VALID_PARAMS.locale,
      'claude-opus-4-8',
    );

    await new Promise((r) => setTimeout(r, 10));
    // Exactly one dispatch — from request 2's genuine model-B miss. Request 1 served
    // the FIT hit with no dispatch.
    expect(countModalDispatches(publishFetch)).toBe(1);

    vi.unstubAllGlobals();
  });
});

describe('FOLLOW-464 / RETRO-162 LG-1: NEUTRAL cross-model regression guard', () => {
  it(
    'a NEUTRAL row written under model A does NOT short-circuit a model-B request ' +
      '(model B re-dispatches instead of serving template_fallback-with-no-dispatch)',
    async () => {
      const publishFetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
      vi.stubGlobal('fetch', publishFetch);

      // A NEUTRAL row exists ONLY for claude-sonnet-4-6 (model-scoped stub).
      mockGetPgCachedDescription.mockImplementation(
        (_t: string, _l: string, _a: string, _loc: string, model: string) =>
          model === 'claude-sonnet-4-6' ? pgRowFor('claude-sonnet-4-6', 'NEUTRAL') : null,
      );

      // Same-model request (claude-sonnet-4-6): correctly short-circuits, no dispatch.
      mockGetGlobalGenerationModel.mockResolvedValueOnce('claude-sonnet-4-6');
      const resSameModel = await GET(makeRequest(VALID_PARAMS));
      expect(resSameModel.status).toBe(200);
      expect(((await resSameModel.json()) as { source: string }).source).toBe('template_fallback');
      await new Promise((r) => setTimeout(r, 10));
      expect(countModalDispatches(publishFetch)).toBe(0);

      // Cross-model request (claude-opus-4-8): the model-A NEUTRAL row must NOT
      // suppress this request. Pre-fix (no model filter) this would have hit the
      // stale NEUTRAL row and never dispatched. Post-fix: Postgres misses (wrong
      // model), Redis misses (clean), falls to the real cache-miss path -> dispatch.
      mockGetGlobalGenerationModel.mockResolvedValueOnce('claude-opus-4-8');
      const resCrossModel = await GET(makeRequest(VALID_PARAMS));
      expect(resCrossModel.status).toBe(200);
      // Cross-model response is ALSO template_fallback shape (cache-miss path returns
      // the same shape as the negative-cache short-circuit) — the distinguishing
      // signal is whether a Modal dispatch fired, asserted below.
      expect(((await resCrossModel.json()) as { source: string }).source).toBe('template_fallback');

      await new Promise((r) => setTimeout(r, 10));
      // Exactly ONE dispatch total — from the cross-model request re-generating.
      expect(countModalDispatches(publishFetch)).toBe(1);

      vi.unstubAllGlobals();
    },
  );

  it(
    'a non-demo NEUTRAL row does NOT short-circuit a DEMO override_model request ' +
      '(demo preview re-dispatches instead of leaking the prod NEUTRAL verdict)',
    async () => {
      const publishFetch = vi.fn().mockResolvedValue(new Response('', { status: 200 }));
      vi.stubGlobal('fetch', publishFetch);

      // A NEUTRAL row exists ONLY for the prod/global model (claude-sonnet-4-6).
      mockGetPgCachedDescription.mockImplementation(
        (_t: string, _l: string, _a: string, _loc: string, model: string) =>
          model === 'claude-sonnet-4-6' ? pgRowFor('claude-sonnet-4-6', 'NEUTRAL') : null,
      );
      mockGetGlobalGenerationModel.mockResolvedValue('claude-sonnet-4-6');

      // DEMO MODE active with a DIFFERENT override_model (claude-opus-4-8) — the
      // demo preview must not inherit the prod NEUTRAL verdict.
      mockGetDemoOverride.mockResolvedValue({
        enabled: true,
        overrideArchetype: 'family_buyer',
        overrideModel: 'claude-opus-4-8',
      });

      const res = await GET(makeRequest(VALID_PARAMS));
      expect(res.status).toBe(200);
      expect(mockGetPgCachedDescription).toHaveBeenLastCalledWith(
        'test-tenant-uuid',
        VALID_PARAMS.listing_id,
        VALID_PARAMS.archetype,
        VALID_PARAMS.locale,
        'claude-opus-4-8',
      );

      await new Promise((r) => setTimeout(r, 10));
      // Demo request must re-dispatch — the prod NEUTRAL (model=claude-sonnet-4-6)
      // does not satisfy the demo-model (claude-opus-4-8) lookup.
      expect(countModalDispatches(publishFetch)).toBe(1);

      vi.unstubAllGlobals();
    },
  );
});
