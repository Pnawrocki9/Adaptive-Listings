/**
 * FOLLOW-452 tests (audit F-08): per-archetype holdout logging + GET holdout
 * server-side computation.
 *
 * Two independent defects fixed:
 *
 *   1. POST /api/adapt logged EVERY holdout row with a hardcoded
 *      archetype='neutral', confidence=0.5 — even when the session's would-be
 *      archetype (from body.archetype_hint / demo-override) was something
 *      else entirely. This starved the per-archetype lift query's holdout arm
 *      for every real archetype (it only ever populated 'neutral'), making
 *      lift structurally unmeasurable for any archetype other than neutral.
 *      Fix: resolve archetype/confidence/similarity (incl. demo-override)
 *      BEFORE the A/B holdout gate, and log the WOULD-BE values on the
 *      holdout row. The RESPONSE returned to the held-out caller is UNCHANGED
 *      — still 'neutral' with empty directives (locked-in product behavior).
 *
 *   2. GET /api/adapt trusted a caller-supplied `holdout_group` query param
 *      (defaulting to false when absent) instead of computing holdout
 *      server-side. Fix: GET now calls the shared `assignHoldout()` helper
 *      (same algorithm POST uses) using the request's own session_id/
 *      tenant_id/consent params — the query param is no longer read at all.
 *
 * @module apps/control-plane/src/app/api/adapt/route.follow452.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks (hoisted before route import) ──────────────────────────────────────

vi.mock('@/lib/demo-jwt-verify', () => ({
  verifyDemoJwt: vi.fn().mockResolvedValue({}),
  DemoJwtSecretMissingError: class DemoJwtSecretMissingError extends Error {},
  DemoJwtInvalidError: class DemoJwtInvalidError extends Error {},
}));

vi.mock('@/lib/llm-gateway', () => ({
  callLlmGateway: vi.fn().mockResolvedValue(null),
}));

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/rag-retrieval', () => ({
  retrieveListingContext: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/ab-events', () => ({
  publishAbAssignmentEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@estalara/sdk/playbooks', () => ({
  getPlaybook: vi.fn(() => ({
    slots: [
      { slot: 'headline', en: 'High-yield investment property' },
      { slot: 'cta', en: 'View ROI Analysis' },
    ],
  })),
}));

// FOLLOW-397: include SEED_VARIANTS so VARIANT_INDEX is derived correctly at module load.
vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
  getBanditArms: vi.fn().mockResolvedValue([
    { variant: 'control', alpha: 1, beta: 1, paused: false },
    { variant: 'v1', alpha: 1, beta: 1, paused: false },
    { variant: 'v2', alpha: 1, beta: 1, paused: false },
  ]),
}));

const { mockGetDemoOverride } = vi.hoisted(() => ({
  mockGetDemoOverride: vi.fn(),
}));

vi.mock('@/lib/demo-override-store', () => ({
  getDemoOverride: mockGetDemoOverride,
  DEMO_OVERRIDE_CONFIDENCE: 0.95,
  DEMO_OVERRIDE_SIMILARITY: 0.75,
}));

// `assignHoldout` is spied (not fixed): the POST describe block below exercises
// the REAL deterministic algorithm (holdout_pct=0.0/1.0 is deterministic
// regardless of session/tenant); the GET describe block overrides it per-test
// to prove the query param is ignored.
const { mockAssignHoldout } = vi.hoisted(() => ({ mockAssignHoldout: vi.fn() }));
vi.mock('@estalara/shared', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@estalara/shared');
  mockAssignHoldout.mockImplementation(actual.assignHoldout as (...args: unknown[]) => unknown);
  return {
    ...actual,
    assignHoldout: mockAssignHoldout,
  };
});

import { GET, POST } from './route.js';
import { assignHoldout } from '@estalara/shared';

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Captures the body and URL of the most recent ClickHouse fetch call. */
function captureFetch(): { getLastBody: () => string | null; getLastUrl: () => URL | null } {
  let lastBody: string | null = null;
  let lastUrl: URL | null = null;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: unknown, opts?: { body?: string }) => {
      lastBody = opts?.body ?? null;
      try {
        lastUrl = typeof url === 'string' ? new URL(url) : null;
      } catch {
        lastUrl = null;
      }
      return Promise.resolve(new Response('', { status: 200 }));
    }),
  );
  return { getLastBody: () => lastBody, getLastUrl: () => lastUrl };
}

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/adapt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer demo_key' },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/adapt');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url, {
    headers: { Authorization: 'Bearer test_key', 'x-tenant-id': 'tenant-follow452' },
  });
}

const SYNTHETIC_ARCHETYPE_X = 'yield_hunter';

const BASE_POST_BODY = {
  tenant_id: 'est_demo_tenant',
  session_id: 'sess-follow452-post-001',
  page_type: 'listing_list' as const,
  archetype_hint: SYNTHETIC_ARCHETYPE_X,
  confidence: 0.82,
  similarity: 0.91,
};

// ─── POST: holdout row logs the would-be archetype, not hardcoded 'neutral' ──

describe('POST /api/adapt — FOLLOW-452: holdout row logs the would-be archetype/confidence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
    mockGetDemoOverride.mockResolvedValue({ enabled: false, overrideArchetype: null });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it(
    `a synthetic archetype-X ('${SYNTHETIC_ARCHETYPE_X}') session assigned to holdout produces a ` +
      'ClickHouse adaptation_decisions row keyed to X, not to the hardcoded "neutral"',
    async () => {
      const capture = captureFetch();

      const res = await POST(
        makePostRequest({ ...BASE_POST_BODY, holdout_pct: 1.0, consent_mode_enabled: false }),
      );

      expect(res.status).toBe(200);

      // AC: response body to the held-out caller is UNCHANGED — still neutral.
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.holdout_group).toBe(true);
      expect(body.archetype).toBe('neutral');
      expect(body.confidence).toBe(0.5);
      expect((body.directives as unknown[]).length).toBe(0);

      // AC: the LOGGED ClickHouse row carries the would-be archetype/confidence.
      const url = capture.getLastUrl();
      expect(url, 'ClickHouse INSERT must have fired for the holdout row').not.toBeNull();
      expect(url!.searchParams.get('param_p_holdout_group')).toBe('1');
      expect(url!.searchParams.get('param_p_archetype')).toBe(SYNTHETIC_ARCHETYPE_X);
      expect(url!.searchParams.get('param_p_confidence')).toBe(String(BASE_POST_BODY.confidence));
      const insertBody = capture.getLastBody() ?? '';
      expect(insertBody).toMatch(/INSERT INTO adaptation_decisions/);
    },
  );

  it('holdout row reflects the DEMO-OVERRIDE archetype (not body.archetype_hint) when demo mode is active', async () => {
    mockGetDemoOverride.mockResolvedValue({
      enabled: true,
      overrideArchetype: 'luxury_buyer',
      overrideModel: 'claude-sonnet-4-6',
    });
    const capture = captureFetch();

    const res = await POST(
      makePostRequest({ ...BASE_POST_BODY, holdout_pct: 1.0, consent_mode_enabled: false }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    // Response contract unchanged — still neutral for the held-out caller.
    expect(body.archetype).toBe('neutral');

    const url = capture.getLastUrl();
    expect(url).not.toBeNull();
    expect(url!.searchParams.get('param_p_archetype')).toBe('luxury_buyer');
    expect(url!.searchParams.get('param_p_confidence')).toBe('0.95'); // DEMO_OVERRIDE_CONFIDENCE
  });

  it('treatment arm (non-holdout) is unaffected — logs its own archetype as before', async () => {
    const capture = captureFetch();

    const res = await POST(
      makePostRequest({ ...BASE_POST_BODY, holdout_pct: 0.0, consent_mode_enabled: false }),
    );

    expect(res.status).toBe(200);
    const url = capture.getLastUrl();
    expect(url).not.toBeNull();
    expect(url!.searchParams.get('param_p_holdout_group')).toBe('0');
    expect(url!.searchParams.get('param_p_archetype')).toBe(SYNTHETIC_ARCHETYPE_X);
  });
});

// ─── GET: holdout is computed server-side, caller param is ignored ──────────

const BASE_GET_PARAMS = {
  session_id: 'sess-follow452-get-001',
  archetype: SYNTHETIC_ARCHETYPE_X,
  confidence: '0.80',
  similarity: '0.90',
  tier: '1',
};

describe('GET /api/adapt — FOLLOW-452: holdout computed via assignHoldout(), caller param ignored', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
    vi.stubEnv('ADAPT_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('caller-supplied holdout_group=true is IGNORED when assignHoldout() resolves false', async () => {
    const capture = captureFetch();
    vi.mocked(assignHoldout).mockResolvedValueOnce({
      skipped: false,
      holdout_group: false,
      holdout_pct: 0.1,
      assigned_at: new Date().toISOString(),
    });

    const res = await GET(makeGetRequest({ ...BASE_GET_PARAMS, holdout_group: 'true' }));

    expect(res.status).toBe(200);
    const url = capture.getLastUrl();
    expect(url).not.toBeNull();
    // If the caller-supplied param were still honored, this would be '1'.
    expect(url!.searchParams.get('param_p_holdout_group')).toBe('0');
  });

  it('caller-supplied holdout_group=false is IGNORED when assignHoldout() resolves true', async () => {
    const capture = captureFetch();
    vi.mocked(assignHoldout).mockResolvedValueOnce({
      skipped: false,
      holdout_group: true,
      holdout_pct: 0.1,
      assigned_at: new Date().toISOString(),
    });

    const res = await GET(makeGetRequest({ ...BASE_GET_PARAMS, holdout_group: 'false' }));

    expect(res.status).toBe(200);
    const url = capture.getLastUrl();
    expect(url).not.toBeNull();
    // If the caller-supplied param were still honored, this would be '0'.
    expect(url!.searchParams.get('param_p_holdout_group')).toBe('1');
  });

  it('assignHoldout() is called with the request session_id/tenant_id (server-side computation)', async () => {
    captureFetch();
    vi.mocked(assignHoldout).mockResolvedValueOnce({
      skipped: false,
      holdout_group: false,
      holdout_pct: 0.1,
      assigned_at: new Date().toISOString(),
    });

    await GET(makeGetRequest(BASE_GET_PARAMS));

    expect(assignHoldout).toHaveBeenCalledWith(
      expect.objectContaining({
        tenant_id: 'tenant-follow452',
        session_id: BASE_GET_PARAMS.session_id,
      }),
    );
  });
});
