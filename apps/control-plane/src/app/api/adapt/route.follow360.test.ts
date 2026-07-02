/**
 * FOLLOW-360 / ESC-026 regression tests: GET-path bandit gate for holdout sessions.
 *
 * Regression: before FOLLOW-360, the GET handler sampled a bandit variant for ALL
 * requests including holdout ones, logging (holdout_group=1, variant=v1/v2) to
 * ClickHouse and serving v1/v2 copy in directives. This contaminated the holdout
 * counterfactual baseline (which must stay control-only).
 *
 * Fix: when holdout_group=true, bandit sampling is bypassed and variant='control'
 * is used unconditionally — mirroring the POST handler's early-return ordering.
 *
 * Test strategy: mock thompsonSample to return 'v1' deterministically so we can
 * distinguish between "sampled" (v1) and "forced-control" (control) paths.
 *
 * Fail-before: on origin/main (pre-fix), holdout GET logs param_p_variant='v1'.
 * Pass-after: with the fix, holdout GET logs param_p_variant='control'.
 *
 * FOLLOW-452: the GET handler no longer trusts a caller-supplied `holdout_group`
 * query param — it computes holdout server-side via `assignHoldout()`. These
 * tests now drive the holdout/non-holdout branches via a per-test
 * `assignHoldout` mock override instead of the (now-ignored) query param.
 *
 * @module apps/control-plane/src/app/api/adapt/route.follow360.test
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

// Return arms that include v1 and v2 — ensures that IF sampling runs, it can
// return a non-control variant. Used with the thompsonSample mock below.
// FOLLOW-397: include SEED_VARIANTS so VARIANT_INDEX is derived correctly at module load.
vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
  getBanditArms: vi.fn().mockResolvedValue([
    { variant: 'control', alpha: 1, beta: 1, paused: false },
    { variant: 'v1', alpha: 1, beta: 1, paused: false },
    { variant: 'v2', alpha: 1, beta: 1, paused: false },
  ]),
}));

// Mock thompsonSample to return 'v1' deterministically — this lets us assert that:
//   - holdout=false path: param_p_variant='v1' (sampling ran)
//   - holdout=true path:  param_p_variant='control' (sampling was bypassed)
vi.mock('@estalara/shared', async () => {
  const mod = await vi.importActual<Record<string, unknown>>('@estalara/shared');
  return {
    ...mod,
    // assignHoldout is only used by POST; stub it for completeness.
    assignHoldout: vi.fn().mockResolvedValue({
      holdout_group: false,
      skipped: false,
      assigned_at: new Date().toISOString(),
    }),
    // Deterministic 'v1' so non-holdout path is verifiable.
    thompsonSample: vi.fn().mockReturnValue('v1'),
  };
});

import { GET } from './route.js';
import { getBanditArms } from '@/lib/bandit-query';
import { assignHoldout } from '@estalara/shared';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Captures the URL of the most recent ClickHouse fetch call. */
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
    headers: { Authorization: 'Bearer test_key', 'x-tenant-id': 'tenant-follow360' },
  });
}

const BASE_PARAMS = {
  session_id: 'sess-follow360-001',
  archetype: 'yield_hunter',
  confidence: '0.80',
  similarity: '0.90',
  tier: '1',
};

// ─── FOLLOW-360 regression: holdout GET logs variant='control' ────────────────

describe('GET /api/adapt — FOLLOW-360: holdout gate bypasses bandit sampling', () => {
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
    'REGRESSION (fail-before, pass-after): holdout_group=true GET logs param_p_variant=control ' +
      '— must NOT sample v1/v2 for holdout sessions (FOLLOW-360 / ESC-026 / RETRO-095)',
    async () => {
      const capture = captureClickhouseUrl();

      // FOLLOW-452: holdout is now computed server-side via assignHoldout() —
      // drive the holdout branch by overriding the mock, not a query param.
      vi.mocked(assignHoldout).mockResolvedValueOnce({
        skipped: false,
        holdout_group: true,
        holdout_pct: 0.1,
        assigned_at: new Date().toISOString(),
      });

      const res = await GET(makeGetRequest(BASE_PARAMS));

      expect(res.status).toBe(200);

      const url = capture.getLastUrl();
      expect(url, 'ClickHouse INSERT URL must be present').not.toBeNull();

      // Core assertion — this FAILS on origin/main (pre-fix) where thompsonSample
      // runs unconditionally and returns 'v1', and PASSES after FOLLOW-360 fix
      // where the holdout gate forces 'control' without calling thompsonSample.
      expect(url!.searchParams.get('param_p_variant')).toBe('control');

      // Confirm holdout_group is correctly logged as 1
      expect(url!.searchParams.get('param_p_holdout_group')).toBe('1');
    },
  );

  it(
    'positive control: assignHoldout()=false GET logs param_p_variant=v1 ' +
      '(bandit sampling runs normally for non-holdout sessions)',
    async () => {
      const capture = captureClickhouseUrl();

      // Default mock (from the module factory above) already resolves holdout_group=false.
      const res = await GET(makeGetRequest(BASE_PARAMS));

      expect(res.status).toBe(200);

      const url = capture.getLastUrl();
      expect(url, 'ClickHouse INSERT URL must be present').not.toBeNull();

      // thompsonSample mock returns 'v1' — non-holdout path must use the sampled value.
      expect(url!.searchParams.get('param_p_variant')).toBe('v1');

      // Confirm holdout_group is logged as 0 for non-holdout
      expect(url!.searchParams.get('param_p_holdout_group')).toBe('0');
    },
  );

  it('assignHoldout()=true GET response directives use control copy (slot index 0, not v1/v2)', async () => {
    captureClickhouseUrl();
    vi.mocked(assignHoldout).mockResolvedValueOnce({
      skipped: false,
      holdout_group: true,
      holdout_pct: 0.1,
      assigned_at: new Date().toISOString(),
    });

    const res = await GET(makeGetRequest(BASE_PARAMS));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      directives: { slot: string; value: string }[];
    };

    // The playbook mock has variants.en = ['Control headline', 'Variant 1 headline', 'Variant 2 headline'].
    // variant='control' → index 0 → 'Control headline'.
    // On origin/main (pre-fix), variant='v1' → index 1 → 'Variant 1 headline'.
    const headline = body.directives.find((d) => d.slot === 'headline');
    expect(headline?.value).toBe('Control headline');
  });

  it('assignHoldout()=true GET does not call getBanditArms (sampling skipped entirely)', async () => {
    captureClickhouseUrl();
    vi.mocked(assignHoldout).mockResolvedValueOnce({
      skipped: false,
      holdout_group: true,
      holdout_pct: 0.1,
      assigned_at: new Date().toISOString(),
    });

    await GET(makeGetRequest(BASE_PARAMS));

    // On origin/main (pre-fix), getBanditArms IS called for holdout sessions.
    // After FOLLOW-360 fix, it must NOT be called — the gate short-circuits before sampling.
    expect(getBanditArms).not.toHaveBeenCalled();
  });

  it(
    'FOLLOW-452: GET ignores a caller-supplied `holdout_group=true` query param — ' +
      'the server-side assignHoldout() mock (false) wins, so bandit sampling still runs',
    async () => {
      const capture = captureClickhouseUrl();

      // Caller tries to force holdout via the query param; default mock says non-holdout.
      const res = await GET(makeGetRequest({ ...BASE_PARAMS, holdout_group: 'true' }));

      expect(res.status).toBe(200);
      const url = capture.getLastUrl();
      expect(url, 'ClickHouse INSERT URL must be present').not.toBeNull();

      // If the caller-supplied param were still honored, this would be 'control'/1.
      // It must instead reflect assignHoldout()'s (mocked) result: non-holdout, sampled 'v1'.
      expect(url!.searchParams.get('param_p_holdout_group')).toBe('0');
      expect(url!.searchParams.get('param_p_variant')).toBe('v1');
    },
  );
});
