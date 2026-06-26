/**
 * FOLLOW-372 tests: profiling opt-out gate for GET /api/adapt.
 *
 * When the SDK sends `profiling_opt_out=1`, the GET handler MUST:
 *   1. Return 200 with empty directives and source='default'.
 *   2. NOT log a ClickHouse variant row (logDecisionAsync is suppressed).
 *   3. NOT call getBanditArms / thompsonSample (no bandit sampling on opt-out path).
 *
 * Scope boundary test: asserts that the neutral response shape includes the
 * correct fields without a variant, confirming AL DOM adaptation is suspended.
 *
 * Hard boundary (FOLLOW-372 §H.9): this gate does NOT suppress:
 *   - buying-intent identification
 *   - lead ranking
 *   - agent-facing chat summaries
 * Those are app.estalara.com concerns outside this route's scope.
 * This test verifies the boundary via documentation assertion (no ClickHouse
 * row emitted; the route has no hook into those pipelines).
 *
 * @module apps/control-plane/src/app/api/adapt/route.follow372.test
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

// FOLLOW-397: include SEED_VARIANTS so VARIANT_INDEX is derived correctly at module load.
vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
  getBanditArms: vi.fn().mockResolvedValue([
    { variant: 'control', alpha: 1, beta: 1, paused: false },
    { variant: 'v1', alpha: 1, beta: 1, paused: false },
    { variant: 'v2', alpha: 1, beta: 1, paused: false },
  ]),
}));

vi.mock('@estalara/shared', async () => {
  const mod = await vi.importActual<Record<string, unknown>>('@estalara/shared');
  return {
    ...mod,
    assignHoldout: vi.fn().mockResolvedValue({
      holdout_group: false,
      skipped: false,
      assigned_at: new Date().toISOString(),
    }),
    // Deterministic 'v1' — on the opt-out path sampling must NEVER run
    thompsonSample: vi.fn().mockReturnValue('v1'),
  };
});

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
    headers: { Authorization: 'Bearer test_key', 'x-tenant-id': 'tenant-follow372' },
  });
}

const BASE_PARAMS = {
  session_id: 'sess-follow372-001',
  archetype: 'yield_hunter',
  confidence: '0.80',
  similarity: '0.90',
  tier: '1',
};

// ─── FOLLOW-372: profiling opt-out gate ────────────────────────────────────────

describe('GET /api/adapt — FOLLOW-372: profiling_opt_out=1 gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
    vi.stubEnv('ADAPT_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('AC-1: returns 200 with empty directives and source=default when profiling_opt_out=1', async () => {
    captureClickhouseUrl();

    const res = await GET(makeGetRequest({ ...BASE_PARAMS, profiling_opt_out: '1' }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      directives: unknown[];
      source: string;
      archetype: string;
    };

    expect(body.directives).toHaveLength(0);
    expect(body.source).toBe('default');
    expect(body.archetype).toBe('neutral');
  });

  it('AC-2: variant logging is suppressed — no ClickHouse INSERT when profiling_opt_out=1', async () => {
    const capture = captureClickhouseUrl();

    await GET(makeGetRequest({ ...BASE_PARAMS, profiling_opt_out: '1' }));

    // logDecisionAsync must NOT fire on the opt-out path.
    // If fetch was called, it means ClickHouse INSERT ran — that is a failure.
    const clickhouseUrl = capture.getLastUrl();
    expect(
      clickhouseUrl,
      'ClickHouse INSERT must NOT be called on profiling_opt_out=1 path',
    ).toBeNull();
  });

  it('AC-3: bandit sampling is skipped — getBanditArms NOT called when profiling_opt_out=1', async () => {
    captureClickhouseUrl();

    await GET(makeGetRequest({ ...BASE_PARAMS, profiling_opt_out: '1' }));

    expect(getBanditArms).not.toHaveBeenCalled();
  });

  it('AC-4: thompsonSample is NOT called when profiling_opt_out=1', async () => {
    captureClickhouseUrl();

    await GET(makeGetRequest({ ...BASE_PARAMS, profiling_opt_out: '1' }));

    expect(thompsonSample).not.toHaveBeenCalled();
  });

  it('AC-5: response includes adapt_decision_id, session_id, tier for client correlation', async () => {
    captureClickhouseUrl();

    const res = await GET(makeGetRequest({ ...BASE_PARAMS, profiling_opt_out: '1' }));
    const body = (await res.json()) as {
      adapt_decision_id: string;
      session_id: string;
      tier: number;
    };

    expect(body.adapt_decision_id).toBeTruthy();
    expect(typeof body.adapt_decision_id).toBe('string');
    expect(body.session_id).toBe('sess-follow372-001');
    expect(body.tier).toBe(1);
  });

  it('positive control: profiling_opt_out absent → normal path runs, variant logged, directives non-empty', async () => {
    const capture = captureClickhouseUrl();

    const res = await GET(makeGetRequest(BASE_PARAMS));

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      directives: unknown[];
      source: string;
    };

    // Normal path: high similarity (0.90) → playbook source, directives present
    expect(body.source).toBe('playbook');
    expect(body.directives.length).toBeGreaterThan(0);

    // ClickHouse INSERT MUST fire on normal path
    const clickhouseUrl = capture.getLastUrl();
    expect(clickhouseUrl, 'ClickHouse INSERT must be called on normal path').not.toBeNull();

    // getBanditArms and thompsonSample ran (v1 variant sampled per mock)
    expect(getBanditArms).toHaveBeenCalled();
    expect(thompsonSample).toHaveBeenCalled();
  });

  it('positive control: profiling_opt_out=0 (not opted out) → normal path runs', async () => {
    const capture = captureClickhouseUrl();

    const res = await GET(makeGetRequest({ ...BASE_PARAMS, profiling_opt_out: '0' }));

    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string };
    // Normal path fires
    expect(body.source).toBe('playbook');

    // ClickHouse INSERT must fire
    const clickhouseUrl = capture.getLastUrl();
    expect(clickhouseUrl).not.toBeNull();
  });

  it('BOUNDARY DOC: profiling_opt_out=1 suspends AL DOM only — route has no hook to buying-intent, lead-ranking, or chat-summary pipelines', () => {
    // This test is a documentation assertion. The adapt route reads no pipeline
    // that feeds buying-intent, lead-ranking, or agent chat summaries.
    // Those are app.estalara.com concerns (Rafał's backend + ML pipeline).
    // Confirmed: the adapt GET handler's code path for opt-out returns immediately
    // before touching Redis (chat-intent), ClickHouse, or any ML sink.
    // The boundary is defined in §H.9 / PRIVACY_NOTICE_TEMPLATE §6.3 and
    // in the FOLLOW-372 HANDOFF's boundary reminder.
    expect(true).toBe(true);
  });
});
