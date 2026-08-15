/**
 * FOLLOW-383 tests: profiling opt-out gate for POST /api/adapt.
 *
 * The SDK appends ?profiling_opt_out=1 to the URL for opted-out sessions.
 * When present, the POST handler MUST:
 *   1. Return 200 with empty directives and source='default'.
 *   2. NOT log a ClickHouse variant row (logDecisionAsync is suppressed).
 *   3. Return BEFORE bandit sampling (getBanditArms / thompsonSample not called).
 *
 * @module apps/control-plane/src/app/api/adapt/route.follow383.test
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
        variants: { en: ['Control headline', 'Variant 1 headline'] },
      },
    ],
  })),
}));

// FOLLOW-397: include SEED_VARIANTS so VARIANT_INDEX is derived correctly at module load.
vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
  getBanditArms: vi.fn().mockResolvedValue([
    { variant: 'control', alpha: 1, beta: 1, paused: false },
    { variant: 'v1', alpha: 1, beta: 1, paused: false },
  ]),
}));

vi.mock('@/lib/demo-override-store', () => ({
  getDemoOverride: vi.fn().mockResolvedValue({
    enabled: false,
    overrideArchetype: null,
    overrideModel: 'claude-sonnet-4-6',
  }),
  DEMO_OVERRIDE_CONFIDENCE: 0.95,
  DEMO_OVERRIDE_SIMILARITY: 0.75,
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

import { POST } from './route.js';
import { getBanditArms } from '@/lib/bandit-query';
import { thompsonSample } from '@estalara/shared';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePostRequest(body: Record<string, unknown>, urlSuffix = ''): NextRequest {
  return new NextRequest(`http://localhost/api/adapt${urlSuffix}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test_key',
    },
    body: JSON.stringify(body),
  });
}

const BASE_BODY = {
  tenant_id: 'tenant-follow383',
  session_id: 'sess-follow383-post-001',
  page_type: 'listing_detail',
  archetype_hint: 'yield_hunter',
  confidence: 0.85,
  similarity: 0.9,
};

// ─── FOLLOW-383: profiling opt-out gate on POST ───────────────────────────────

describe('POST /api/adapt — FOLLOW-383: profiling_opt_out=1 URL query param gate', () => {
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
    // Stub fetch so ClickHouse INSERT calls don't fail
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    const res = await POST(makePostRequest(BASE_BODY, '?profiling_opt_out=1'));

    expect(res.status).toBe(200);
    const resBody = (await res.json()) as {
      directives: unknown[];
      source: string;
      archetype: string;
    };
    expect(resBody.directives).toHaveLength(0);
    expect(resBody.source).toBe('default');
    expect(resBody.archetype).toBe('neutral');
  });

  it('AC-2: ClickHouse INSERT is NOT called when profiling_opt_out=1', async () => {
    let fetchCalled = false;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        fetchCalled = true;
        return Promise.resolve(new Response('', { status: 200 }));
      }),
    );

    await POST(makePostRequest(BASE_BODY, '?profiling_opt_out=1'));

    // logDecisionAsync fires a fetch to ClickHouse — must NOT happen on opt-out path
    expect(fetchCalled).toBe(false);
  });

  it('AC-3: getBanditArms and thompsonSample are NOT called when profiling_opt_out=1', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    await POST(makePostRequest(BASE_BODY, '?profiling_opt_out=1'));

    expect(getBanditArms).not.toHaveBeenCalled();
    expect(thompsonSample).not.toHaveBeenCalled();
  });

  it('AC-4: response includes adapt_decision_id and session_id for client correlation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    const res = await POST(makePostRequest(BASE_BODY, '?profiling_opt_out=1'));
    const resBody = (await res.json()) as {
      adapt_decision_id: string;
      session_id: string;
    };

    expect(resBody.adapt_decision_id).toBeTruthy();
    expect(typeof resBody.adapt_decision_id).toBe('string');
    expect(resBody.session_id).toBe(BASE_BODY.session_id);
  });

  it('positive control: profiling_opt_out absent → normal path, getBanditArms called', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    const res = await POST(makePostRequest(BASE_BODY));

    expect(res.status).toBe(200);
    // Normal path fires bandit sampling
    expect(getBanditArms).toHaveBeenCalled();
    expect(thompsonSample).toHaveBeenCalled();
  });

  it('positive control: profiling_opt_out=0 → normal path runs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    const res = await POST(makePostRequest(BASE_BODY, '?profiling_opt_out=0'));

    expect(res.status).toBe(200);
    // Normal path fires
    expect(getBanditArms).toHaveBeenCalled();
  });
});
