/**
 * FOLLOW-369 tests: GET-path consent-skip parity for /api/adapt.
 *
 * FOLLOW-360 AC-2 required that consent-skip GET requests serve no adaptation,
 * consistent with POST. PR #333 only gated the holdout axis; the consent axis
 * was left unimplemented.
 *
 * This test asserts the FOLLOW-369 implementation:
 *   - When consent_mode_enabled=true AND consent_state is a skip state
 *     ('opted_out' | 'unknown' | 'none'), the GET handler MUST:
 *       1. Return 200 with empty directives and source='default'.
 *       2. NOT log a ClickHouse variant row (logDecisionAsync suppressed).
 *       3. NOT call getBanditArms / thompsonSample (no bandit sampling).
 *   - The holdout-path behavior from PR #333 is unchanged.
 *   - Non-skip consent states (e.g. 'consented', or absent consent params)
 *     do not trigger the skip.
 *
 * @module apps/control-plane/src/app/api/adapt/route.follow369.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks (hoisted before route import) ────────────────────────────────────

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

vi.mock('@estalara/sdk/playbooks', () => ({
  getPlaybook: vi.fn(() => ({
    slots: [
      {
        slot: 'headline',
        en: 'Control headline',
        variants: { en: ['Control headline', 'Variant 1 headline', 'Variant 2 headline'] },
      },
      { slot: 'cta', en: 'View Details' },
    ],
  })),
}));

// Return arms that include v1/v2 — ensures that IF sampling runs, it can return
// a non-control variant. Used with the thompsonSample mock below.
// FOLLOW-397: include SEED_VARIANTS so VARIANT_INDEX is derived correctly at module load.
vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
  getBanditArms: vi.fn().mockResolvedValue([
    { variant: 'control', alpha: 1, beta: 1, paused: false },
    { variant: 'v1', alpha: 1, beta: 1, paused: false },
    { variant: 'v2', alpha: 1, beta: 1, paused: false },
  ]),
}));

// Deterministic 'v1' so we can distinguish "sampling ran" (v1) from "skip path"
// (no ClickHouse INSERT at all).
vi.mock('@estalara/shared', async () => {
  const mod = await vi.importActual<Record<string, unknown>>('@estalara/shared');
  return {
    ...mod,
    assignHoldout: vi.fn().mockResolvedValue({
      holdout_group: false,
      skipped: false,
      assigned_at: new Date().toISOString(),
    }),
    thompsonSample: vi.fn().mockReturnValue('v1'),
  };
});

// FOLLOW-473: GET auth is now the shared two-step resolver (resolveAdaptGetAuth).
// Mock it to the deterministic tenant this suite exercises — the real auth
// mechanics are covered end-to-end in route.follow473.test.ts.
vi.mock('@/lib/adapt-get-auth', () => ({
  resolveAdaptGetAuth: vi.fn().mockResolvedValue({ ok: true, tenantId: 'tenant-follow369' }),
}));

import { GET } from './route.js';
import { getBanditArms } from '@/lib/bandit-query';
import { thompsonSample } from '@estalara/shared';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Captures the URL of the most recent ClickHouse fetch call (null if not called). */
function captureClickhouseUrl(): { getLastUrl: () => URL | null } {
  let lastUrl: URL | null = null;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: unknown, _opts?: unknown) => {
      try {
        lastUrl = typeof url === 'string' ? new URL(url) : null;
      } catch {
        lastUrl = null;
      }
      return Promise.resolve(new Response('', { status: 200 }));
    }),
  );
  return { getLastUrl: () => lastUrl };
}

function makeGetRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/adapt');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url, {
    headers: { Authorization: 'Bearer test_key', 'x-tenant-id': 'tenant-follow369' },
  });
}

const BASE_PARAMS = {
  session_id: 'sess-follow369-001',
  archetype: 'yield_hunter',
  confidence: '0.80',
  similarity: '0.90',
  tier: '1',
};

// ─── FOLLOW-369: consent-skip GET gate ─────────────────────────────────────────

describe('GET /api/adapt — FOLLOW-369: consent-skip parity with POST', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
    vi.stubEnv('ADAPT_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it(
    'AC-1: consent_state=opted_out + consent_mode_enabled=true returns 200 with ' +
      'empty directives and source=default (FOLLOW-369 / FOLLOW-360 AC-2)',
    async () => {
      captureClickhouseUrl();

      const res = await GET(
        makeGetRequest({
          ...BASE_PARAMS,
          consent_state: 'opted_out',
          consent_mode_enabled: 'true',
        }),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        directives: unknown[];
        source: string;
        archetype: string;
      };
      expect(body.directives).toHaveLength(0);
      expect(body.source).toBe('default');
      expect(body.archetype).toBe('neutral');
    },
  );

  it('AC-1 (unknown): consent_state=unknown + consent_mode_enabled=true skips adaptation', async () => {
    captureClickhouseUrl();

    const res = await GET(
      makeGetRequest({
        ...BASE_PARAMS,
        consent_state: 'unknown',
        consent_mode_enabled: 'true',
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { directives: unknown[]; source: string };
    expect(body.directives).toHaveLength(0);
    expect(body.source).toBe('default');
  });

  it('AC-1 (none): consent_state=none + consent_mode_enabled=true skips adaptation', async () => {
    captureClickhouseUrl();

    const res = await GET(
      makeGetRequest({
        ...BASE_PARAMS,
        consent_state: 'none',
        consent_mode_enabled: 'true',
      }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { directives: unknown[]; source: string };
    expect(body.directives).toHaveLength(0);
    expect(body.source).toBe('default');
  });

  it('AC-2: variant logging is suppressed — no ClickHouse INSERT on consent-skip GET', async () => {
    const capture = captureClickhouseUrl();

    await GET(
      makeGetRequest({
        ...BASE_PARAMS,
        consent_state: 'opted_out',
        consent_mode_enabled: 'true',
      }),
    );

    // logDecisionAsync must NOT fire on the consent-skip path.
    expect(
      capture.getLastUrl(),
      'ClickHouse INSERT must NOT be called on consent-skip path',
    ).toBeNull();
  });

  it('AC-2: bandit sampling is skipped — getBanditArms NOT called on consent-skip GET', async () => {
    captureClickhouseUrl();

    await GET(
      makeGetRequest({
        ...BASE_PARAMS,
        consent_state: 'opted_out',
        consent_mode_enabled: 'true',
      }),
    );

    expect(getBanditArms).not.toHaveBeenCalled();
  });

  it('AC-2: thompsonSample is NOT called on consent-skip GET', async () => {
    captureClickhouseUrl();

    await GET(
      makeGetRequest({
        ...BASE_PARAMS,
        consent_state: 'opted_out',
        consent_mode_enabled: 'true',
      }),
    );

    expect(thompsonSample).not.toHaveBeenCalled();
  });

  // ─── Negative cases — consent skip must NOT fire ───────────────────────────

  it(
    'AC-3 (holdout unchanged): consent-skip GET does NOT affect holdout=false + no consent params ' +
      '— normal path still reaches bandit sampling (PR #333 behavior preserved)',
    async () => {
      const capture = captureClickhouseUrl();

      const res = await GET(makeGetRequest({ ...BASE_PARAMS, holdout_group: 'false' }));

      expect(res.status).toBe(200);
      // Normal path: bandit runs, ClickHouse is called.
      expect(getBanditArms).toHaveBeenCalled();
      const url = capture.getLastUrl();
      expect(url).not.toBeNull();
      // FOLLOW-1163 / ESC-077: the LOGGED variant is `control`, not the sampled `v1`. A GET
      // response carries no listing context, so §E.7.0 withholds every property-asserting
      // directive and the surviving `cta` is identical across arms — crediting `v1` would credit
      // it for control's copy. **This test's subject is unaffected:** what it asserts is that the
      // consent-skip path still REACHES bandit sampling, and that is the
      // `expect(getBanditArms).toHaveBeenCalled()` above, which is untouched.
      expect(url!.searchParams.get('param_p_variant')).toBe('control');
    },
  );

  it(
    'negative: consent_state=opted_out WITHOUT consent_mode_enabled=true does NOT skip ' +
      '— consent mode disabled means all sessions are eligible for A/B',
    async () => {
      const capture = captureClickhouseUrl();

      const res = await GET(
        makeGetRequest({
          ...BASE_PARAMS,
          consent_state: 'opted_out',
          // consent_mode_enabled absent / defaults to false
        }),
      );

      expect(res.status).toBe(200);
      // Normal path runs: bandit is sampled and ClickHouse is written.
      expect(getBanditArms).toHaveBeenCalled();
      expect(capture.getLastUrl()).not.toBeNull();
    },
  );

  it(
    'negative: consent_state=consented + consent_mode_enabled=true does NOT skip ' +
      '— "consented" is a granted state, not in SKIP_CONSENT_STATES',
    async () => {
      const capture = captureClickhouseUrl();

      const res = await GET(
        makeGetRequest({
          ...BASE_PARAMS,
          consent_state: 'consented',
          consent_mode_enabled: 'true',
        }),
      );

      expect(res.status).toBe(200);
      expect(getBanditArms).toHaveBeenCalled();
      expect(capture.getLastUrl()).not.toBeNull();
    },
  );

  it(
    'AC-3 (holdout unchanged): holdout_group=true with consent params still uses holdout gate ' +
      '— holdout takes precedence over consent-skip because profiling_opt_out fires first; ' +
      'but holdout gate runs AFTER consent-skip, so consent-skip fires for consent-skip states',
    async () => {
      // Verify: holdout=true + opted_out → consent-skip fires FIRST (no ClickHouse).
      // This tests ordering: consent-skip gate comes BEFORE holdout gate in the code.
      const capture = captureClickhouseUrl();

      const res = await GET(
        makeGetRequest({
          ...BASE_PARAMS,
          holdout_group: 'true',
          consent_state: 'opted_out',
          consent_mode_enabled: 'true',
        }),
      );

      expect(res.status).toBe(200);
      const body = (await res.json()) as { directives: unknown[]; source: string };
      expect(body.directives).toHaveLength(0);
      expect(body.source).toBe('default');
      // No ClickHouse: consent-skip suppresses logging (holdout path would log).
      expect(capture.getLastUrl()).toBeNull();
    },
  );
});
