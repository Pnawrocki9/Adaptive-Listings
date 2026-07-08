/**
 * FOLLOW-362 — Fix locale/A/B variant logging mismatch.
 *
 * Problem (RETRO-095 §4a LG-2): `thompsonSample()` ran for every locale and
 * logged v1/v2 to ClickHouse, but no playbook has `variants.pl` or `variants.es`
 * arrays. For `pl`/`es` sessions `runDecisionTree` always served the single
 * locale string (`s.pl`/`s.es`), which is indistinguishable from control copy —
 * so the logged variant did NOT match the copy actually served.
 *
 * Fix: suppress bandit sampling (and log `variant: 'control'`) whenever
 * `locale !== 'en'`, for both GET and POST handlers.
 *
 * AC-3 assertion: a `pl` locale request must have `response.variant` equal to
 * `ClickHouse param_p_variant`, and both must equal `'control'` (not v1/v2),
 * even when only the v1 arm is active.
 *
 * Rule S: all three supported locales are exercised (en / pl / es).
 * Rule K.1: the logged variant and the copy-selection variant agree on one
 *   variable (`getHandlerVariant` / `selectedVariant`) for every code path.
 *
 * @module apps/control-plane/src/app/api/adapt/route.follow362.test
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

vi.mock('@/lib/tenant-schema', () => ({
  getTenantSchema: vi.fn().mockResolvedValue(null),
}));

/**
 * Playbook where the headline slot has `variants.en` (only en, no pl/es arrays).
 * This mirrors the real playbooks which never populate `variants.pl` or `variants.es`.
 */
const PLAYBOOK_EN_VARIANTS_ONLY = {
  slots: [
    {
      slot: 'headline',
      en: 'Control headline (en)',
      pl: 'Nagłówek kontrolny (pl)',
      es: 'Titular de control (es)',
      variants: {
        en: ['Control headline (en)', 'Variant 1 headline (en)', 'Variant 2 headline (en)'],
        // variants.pl and variants.es intentionally absent — reflects real playbook state
      },
    },
    { slot: 'cta', en: 'View Details', pl: 'Zobacz szczegóły', es: 'Ver detalles' },
  ],
};

vi.mock('@estalara/sdk/playbooks', () => ({
  getPlaybook: vi.fn(() => PLAYBOOK_EN_VARIANTS_ONLY),
}));

const mockGetBanditArms = vi.hoisted(() => vi.fn());
// FOLLOW-397: include SEED_VARIANTS so VARIANT_INDEX is derived correctly at module load.
vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
  getBanditArms: mockGetBanditArms,
}));

// Mock @estalara/shared so thompsonSample is deterministic.
// This mock makes v1 the only active variant when called — used to confirm
// that despite v1 being "available", non-en locales suppress it.
vi.mock('@estalara/shared', async () => {
  const mod = await vi.importActual<Record<string, unknown>>('@estalara/shared');
  return {
    ...mod,
    assignHoldout: vi.fn().mockResolvedValue({
      holdout_group: false,
      skipped: false,
      assigned_at: new Date().toISOString(),
    }),
    // Returns 'v1' when called (single-active-arm scenario).
    thompsonSample: vi.fn().mockReturnValue('v1'),
  };
});

// FOLLOW-473: GET auth is now the shared two-step resolver (resolveAdaptGetAuth).
// Mock it to the deterministic tenant this suite exercises — the real auth
// mechanics are covered end-to-end in route.follow473.test.ts.
vi.mock('@/lib/adapt-get-auth', () => ({
  resolveAdaptGetAuth: vi.fn().mockResolvedValue({ ok: true, tenantId: 'tenant-follow362' }),
}));

import { GET, POST } from './route.js';
import { getBanditArms } from '@/lib/bandit-query';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeGetRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/adapt');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url, {
    headers: { Authorization: 'Bearer test_key', 'x-tenant-id': 'tenant-follow362' },
  });
}

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/adapt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer demo_key',
    },
    body: JSON.stringify(body),
  });
}

const BASE_GET_PARAMS = {
  session_id: 'sess-follow362-get',
  archetype: 'yield_hunter',
  confidence: '0.80',
  similarity: '0.90',
  tier: '1',
};

const BASE_POST_BODY = {
  tenant_id: 'est_demo_tenant',
  session_id: 'sess-follow362-post',
  page_type: 'listing_detail' as const,
  archetype_hint: 'yield_hunter',
  confidence: 0.8,
  similarity: 0.9,
  holdout_pct: 0.0,
  consent_state: 'granted',
  consent_mode_enabled: false,
};

// Single-active-v1 arms: thompsonSample would pick v1 if called.
const V1_ONLY_ARMS = [
  { variant: 'control', alpha: 1, beta: 1, paused: true },
  { variant: 'v1', alpha: 1, beta: 1, paused: false },
  { variant: 'v2', alpha: 1, beta: 1, paused: true },
];

// ─── POST handler — AC-3 core suite ──────────────────────────────────────────

describe('POST /api/adapt — FOLLOW-362: non-en locale suppresses variant sampling', () => {
  let capturedUrl: URL | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedUrl = null;
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: unknown) => {
        try {
          capturedUrl = new URL(typeof url === 'string' ? url : '');
        } catch {
          capturedUrl = null;
        }
        return Promise.resolve(new Response('', { status: 200 }));
      }),
    );
    // v1 is the only active arm — thompsonSample would return 'v1' if called.
    mockGetBanditArms.mockResolvedValue(V1_ONLY_ARMS);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // ── AC-3 (core): pl locale → variant in response and ClickHouse both = 'control' ──

  it(
    'AC-3 pl: response.variant=control AND ClickHouse param_p_variant=control ' +
      'even when v1 is the only active arm',
    async () => {
      const res = await POST(makePostRequest({ ...BASE_POST_BODY, locale: 'pl' }));
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;

      // Response body must carry 'control', not 'v1'.
      expect(body.variant).toBe('control');

      // ClickHouse INSERT must also carry 'control' (Rule K.1: same variable used for
      // copy selection and logging).
      expect(capturedUrl, 'ClickHouse INSERT URL must be present').not.toBeNull();
      expect(capturedUrl!.searchParams.get('param_p_variant')).toBe('control');
    },
  );

  // Rule S: same assertion for es locale

  it(
    'AC-3 es: response.variant=control AND ClickHouse param_p_variant=control ' +
      'even when v1 is the only active arm',
    async () => {
      const res = await POST(makePostRequest({ ...BASE_POST_BODY, locale: 'es' }));
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;

      expect(body.variant).toBe('control');

      expect(capturedUrl, 'ClickHouse INSERT URL must be present').not.toBeNull();
      expect(capturedUrl!.searchParams.get('param_p_variant')).toBe('control');
    },
  );

  // en locale must continue to use the bandit (unchanged behaviour)

  it('en locale: response.variant=v1 AND ClickHouse param_p_variant=v1 (bandit unchanged)', async () => {
    const res = await POST(makePostRequest({ ...BASE_POST_BODY, locale: 'en' }));
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;

    // thompsonSample returns 'v1' (the only non-paused arm).
    expect(body.variant).toBe('v1');

    expect(capturedUrl, 'ClickHouse INSERT URL must be present').not.toBeNull();
    expect(capturedUrl!.searchParams.get('param_p_variant')).toBe('v1');
  });

  // getBanditArms must NOT be called for non-en locales (no wasted DB round-trip)

  it('pl locale: getBanditArms is NOT called (sampling suppressed)', async () => {
    await POST(makePostRequest({ ...BASE_POST_BODY, locale: 'pl' }));
    expect(getBanditArms).not.toHaveBeenCalled();
  });

  it('es locale: getBanditArms is NOT called (sampling suppressed)', async () => {
    await POST(makePostRequest({ ...BASE_POST_BODY, locale: 'es' }));
    expect(getBanditArms).not.toHaveBeenCalled();
  });

  it('en locale: getBanditArms IS called (sampling active)', async () => {
    await POST(makePostRequest({ ...BASE_POST_BODY, locale: 'en' }));
    expect(getBanditArms).toHaveBeenCalledOnce();
  });

  // Verify served copy: pl slot served (not the en variant 1 text)

  it('pl locale: served directive value is the pl slot string, not an en variant', async () => {
    const res = await POST(makePostRequest({ ...BASE_POST_BODY, locale: 'pl' }));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      directives: { type: string; slot: string; value: string }[];
    };

    const headline = body.directives.find((d) => d.type === 'text' && d.slot === 'headline');
    // Must serve the Polish slot string, NOT 'Variant 1 headline (en)'.
    expect(headline?.value).toBe('Nagłówek kontrolny (pl)');
    expect(headline?.value).not.toContain('(en)');
  });
});

// ─── GET handler — FOLLOW-362 locale suppression ──────────────────────────────

describe('GET /api/adapt — FOLLOW-362: non-en locale suppresses variant sampling', () => {
  let capturedUrl: URL | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedUrl = null;
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
    vi.stubEnv('ADAPT_API_KEY', '');
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: unknown) => {
        try {
          capturedUrl = new URL(typeof url === 'string' ? url : '');
        } catch {
          capturedUrl = null;
        }
        return Promise.resolve(new Response('', { status: 200 }));
      }),
    );
    // v1 is the only active arm.
    mockGetBanditArms.mockResolvedValue(V1_ONLY_ARMS);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it(
    'GET pl: response.variant=control AND ClickHouse param_p_variant=control ' +
      'even when v1 is the only active arm',
    async () => {
      const res = await GET(makeGetRequest({ ...BASE_GET_PARAMS, locale: 'pl' }));
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body.variant).toBe('control');

      expect(capturedUrl, 'ClickHouse INSERT URL must be present').not.toBeNull();
      expect(capturedUrl!.searchParams.get('param_p_variant')).toBe('control');
    },
  );

  it(
    'GET es: response.variant=control AND ClickHouse param_p_variant=control ' +
      'even when v1 is the only active arm',
    async () => {
      const res = await GET(makeGetRequest({ ...BASE_GET_PARAMS, locale: 'es' }));
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      expect(body.variant).toBe('control');

      expect(capturedUrl, 'ClickHouse INSERT URL must be present').not.toBeNull();
      expect(capturedUrl!.searchParams.get('param_p_variant')).toBe('control');
    },
  );

  it('GET en: response.variant=v1 AND ClickHouse param_p_variant=v1 (bandit unchanged)', async () => {
    const res = await GET(makeGetRequest({ ...BASE_GET_PARAMS, locale: 'en' }));
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.variant).toBe('v1');

    expect(capturedUrl, 'ClickHouse INSERT URL must be present').not.toBeNull();
    expect(capturedUrl!.searchParams.get('param_p_variant')).toBe('v1');
  });

  it('GET pl: getBanditArms is NOT called (sampling suppressed)', async () => {
    await GET(makeGetRequest({ ...BASE_GET_PARAMS, locale: 'pl' }));
    expect(getBanditArms).not.toHaveBeenCalled();
  });

  it('GET en: getBanditArms IS called (sampling active)', async () => {
    await GET(makeGetRequest({ ...BASE_GET_PARAMS, locale: 'en' }));
    expect(getBanditArms).toHaveBeenCalledOnce();
  });
});
