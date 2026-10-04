/**
 * FOLLOW-1286 (CEO ruling D3) — the Thompson-sampling bandit is frozen by default.
 *
 * With `BANDIT_ENABLED` unset (the default) or anything but `'true'`, `/api/adapt` (POST and GET):
 *   - never calls `getBanditArms` and never draws an arm (`thompsonSample` is not reached);
 *   - answers `variant: 'control'`;
 *   - still WRITES the `adaptation_decisions.variant` column, as `'control'`.
 *
 * The opposite case is pinned too: with `BANDIT_ENABLED=true` the same request draws the arm the
 * (mocked, single-active-arm) sampler returns, i.e. the pre-freeze behaviour is intact. The rest
 * of that behaviour is pinned by the pre-existing bandit suites, which now stub the flag on.
 *
 * The fixture gives the `cta` en variants so an arm, if one were drawn, would be observable in the
 * served copy and in the logged column (same mechanism fixture as `route.follow362.test.ts`).
 *
 * @module apps/control-plane/src/app/api/adapt/route.bandit-freeze.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

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

vi.mock('@/lib/tenant-schema', () => ({
  getTenantSchema: vi.fn().mockResolvedValue(null),
}));

vi.mock('@estalara/sdk/playbooks', () => ({
  getPlaybook: vi.fn(() => ({
    slots: [
      { slot: 'headline', en: 'Control headline' },
      {
        slot: 'cta',
        en: 'Control CTA',
        variants: { en: ['Control CTA', 'Variant 1 CTA', 'Variant 2 CTA'] },
      },
    ],
  })),
}));

const mockGetBanditArms = vi.hoisted(() => vi.fn());
vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
  getBanditArms: mockGetBanditArms,
}));

const mockThompsonSample = vi.hoisted(() => vi.fn());
vi.mock('@estalara/shared', async () => {
  const mod = await vi.importActual<Record<string, unknown>>('@estalara/shared');
  return {
    ...mod,
    assignHoldout: vi.fn().mockResolvedValue({
      holdout_group: false,
      skipped: false,
      assigned_at: new Date().toISOString(),
    }),
    thompsonSample: mockThompsonSample,
  };
});

vi.mock('@/lib/adapt-get-auth', () => ({
  resolveAdaptGetAuth: vi.fn().mockResolvedValue({ ok: true, tenantId: 'tenant-freeze' }),
}));

import { GET, POST } from './route.js';

const POST_BODY = {
  tenant_id: 'est_demo_tenant',
  session_id: 'sess-freeze-post',
  page_type: 'listing_detail' as const,
  archetype_hint: 'yield_hunter',
  confidence: 0.8,
  similarity: 0.9,
  holdout_pct: 0.0,
  consent_state: 'granted',
  consent_mode_enabled: false,
};

const GET_PARAMS = {
  session_id: 'sess-freeze-get',
  archetype: 'yield_hunter',
  confidence: '0.80',
  similarity: '0.90',
  tier: '1',
};

function makePost(): NextRequest {
  return new NextRequest('http://localhost/api/adapt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer demo_key' },
    body: JSON.stringify(POST_BODY),
  });
}

function makeGet(): NextRequest {
  const url = new URL('http://localhost/api/adapt');
  for (const [k, v] of Object.entries(GET_PARAMS)) url.searchParams.set(k, v);
  return new NextRequest(url, { headers: { Authorization: 'Bearer test_key' } });
}

let loggedVariant: string | null;

beforeEach(() => {
  vi.clearAllMocks();
  loggedVariant = null;
  vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
  vi.stubEnv('ADAPT_API_KEY', '');
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: unknown, opts?: { body?: string }) => {
      if ((opts?.body ?? '').includes('INSERT INTO adaptation_decisions')) {
        loggedVariant = new URL(String(url)).searchParams.get('param_p_variant');
      }
      return Promise.resolve(new Response('', { status: 200 }));
    }),
  );
  mockGetBanditArms.mockResolvedValue([
    { variant: 'control', alpha: 1, beta: 1, paused: true },
    { variant: 'v1', alpha: 1, beta: 1, paused: false },
    { variant: 'v2', alpha: 1, beta: 1, paused: true },
  ]);
  mockThompsonSample.mockReturnValue('v1');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe.each([
  ['unset', undefined],
  ['empty', ''],
  ['"false"', 'false'],
  ['"TRUE" (exact match only)', 'TRUE'],
])('BANDIT_ENABLED %s → bandit frozen', (_label, value) => {
  beforeEach(() => {
    if (value === undefined) expect(process.env.BANDIT_ENABLED).toBeUndefined();
    else vi.stubEnv('BANDIT_ENABLED', value);
  });

  it('POST: variant=control in the body AND in adaptation_decisions; no arm read or drawn', async () => {
    const res = await POST(makePost());
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      variant: string;
      directives: { slot: string; value: string }[];
    };

    expect(body.variant).toBe('control');
    expect(loggedVariant).toBe('control');
    expect(mockGetBanditArms).not.toHaveBeenCalled();
    expect(mockThompsonSample).not.toHaveBeenCalled();
    // The served copy is the control copy, never a variant's.
    const cta = body.directives.find((d) => d.slot === 'cta');
    expect(cta?.value).toBe('Control CTA');
  });

  it('GET: variant=control in the body AND in adaptation_decisions; no arm read or drawn', async () => {
    const res = await GET(makeGet());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { variant: string };

    expect(body.variant).toBe('control');
    expect(loggedVariant).toBe('control');
    expect(mockGetBanditArms).not.toHaveBeenCalled();
    expect(mockThompsonSample).not.toHaveBeenCalled();
  });
});

describe('BANDIT_ENABLED=true → pre-freeze behaviour (arm drawn and logged)', () => {
  beforeEach(() => {
    vi.stubEnv('BANDIT_ENABLED', 'true');
  });

  it('POST draws the sampled arm, serves its copy and logs it', async () => {
    const res = await POST(makePost());
    const body = (await res.json()) as {
      variant: string;
      directives: { slot: string; value: string }[];
    };

    expect(mockGetBanditArms).toHaveBeenCalledWith('est_demo_tenant', 'yield_hunter');
    expect(body.variant).toBe('v1');
    expect(loggedVariant).toBe('v1');
    expect(body.directives.find((d) => d.slot === 'cta')?.value).toBe('Variant 1 CTA');
  });

  it('GET draws the sampled arm and logs it', async () => {
    const res = await GET(makeGet());
    const body = (await res.json()) as { variant: string };

    expect(mockGetBanditArms).toHaveBeenCalledOnce();
    expect(body.variant).toBe('v1');
    expect(loggedVariant).toBe('v1');
  });
});
