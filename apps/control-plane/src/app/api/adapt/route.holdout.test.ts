/**
 * Smoke tests for holdout_group wiring into ClickHouse adaptation_decisions INSERT.
 * TICKET-AB-007
 *
 * These tests verify that every adaptation_decisions INSERT includes the holdout_group
 * field derived from the assignHoldout() result, so that analytics panels
 * (Adapted vs Holdout impressions, Conversion lift vs holdout) read correct data.
 *
 * Approach: stub CLICKHOUSE_URL env var, mock global.fetch to capture the INSERT
 * query body, and assert holdout_group is present with the expected value.
 *
 * @module apps/control-plane/src/app/api/adapt/route.holdout.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies — including workspace packages not built in test env

// Bypass JWT verification — these tests focus on holdout wiring, not auth.
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
      { slot: 'headline', en: 'High-yield investment property' },
      { slot: 'cta', en: 'View ROI Analysis' },
    ],
  })),
}));

// Mock bandit-query — POST handler now calls getBanditArms (FOLLOW-007)
// FOLLOW-397: include SEED_VARIANTS so VARIANT_INDEX is derived correctly at module load.
vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
  getBanditArms: vi.fn().mockResolvedValue([
    { variant: 'control', alpha: 1, beta: 1, paused: false },
    { variant: 'v1', alpha: 1, beta: 1, paused: false },
    { variant: 'v2', alpha: 1, beta: 1, paused: false },
  ]),
}));

// FOLLOW-452: `assignHoldout` is spied (not fixed) so the POST describe block below
// keeps exercising the REAL deterministic algorithm (holdout_pct=0.0/1.0 behavior),
// while the GET describe block can override it per-test to drive the holdout branch
// now that GET computes holdout server-side instead of trusting a caller query param.
const { mockAssignHoldout } = vi.hoisted(() => ({ mockAssignHoldout: vi.fn() }));
vi.mock('@estalara/shared', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@estalara/shared');
  mockAssignHoldout.mockImplementation(actual.assignHoldout as (...args: unknown[]) => unknown);
  return {
    ...actual,
    assignHoldout: mockAssignHoldout,
  };
});

// FOLLOW-473: GET auth is now the shared two-step resolver (resolveAdaptGetAuth).
// Mock it to the deterministic tenant this suite exercises — the real auth
// mechanics are covered end-to-end in route.follow473.test.ts.
vi.mock('@/lib/adapt-get-auth', () => ({
  resolveAdaptGetAuth: vi.fn().mockResolvedValue({ ok: true, tenantId: 'tenant-test' }),
}));

import { GET, POST } from './route.js';
import { assignHoldout } from '@estalara/shared';

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Captures the body and URL of the most recent ClickHouse fetch call. */
function captureFetchBody(): { getLastBody: () => string | null; getLastUrl: () => URL | null } {
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
  return {
    getLastBody: () => lastBody,
    getLastUrl: () => lastUrl,
  };
}

function makeGetRequest(params: Record<string, string>, auth = 'Bearer test_key'): NextRequest {
  const url = new URL('http://localhost/api/adapt');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url, {
    headers: { Authorization: auth, 'x-tenant-id': 'tenant-test' },
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

const VALID_GET_PARAMS = {
  session_id: 'sess-holdout-001',
  archetype: 'yield_hunter',
  confidence: '0.75',
  similarity: '0.90',
  tier: '1',
};

const VALID_POST_BODY = {
  tenant_id: 'est_demo_tenant',
  session_id: 'sess-holdout-post-001',
  page_type: 'listing_list' as const,
  archetype_hint: 'yield_hunter',
  confidence: 0.8,
  similarity: 0.9,
};

// ─── Smoke tests — GET /api/adapt ─────────────────────────────────────────────

describe('GET /api/adapt — holdout_group wired into ClickHouse INSERT (TICKET-AB-007)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
    vi.stubEnv('ADAPT_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('smoke: assignHoldout()=true → INSERT includes holdout_group=1 (FOLLOW-261: URL param)', async () => {
    const capture = captureFetchBody();

    // FOLLOW-452: holdout is computed server-side via assignHoldout(); drive
    // the holdout branch by overriding the mock instead of a query param.
    vi.mocked(assignHoldout).mockResolvedValueOnce({
      skipped: false,
      holdout_group: true,
      holdout_pct: 0.1,
      assigned_at: new Date().toISOString(),
    });

    const res = await GET(makeGetRequest(VALID_GET_PARAMS));

    expect(res.status).toBe(200);
    const body = capture.getLastBody();
    expect(body).not.toBeNull();
    expect(body).toContain('holdout_group');
    // FOLLOW-261: value is passed as URL param, not interpolated into query body
    const url = capture.getLastUrl();
    expect(url).not.toBeNull();
    expect(url!.searchParams.get('param_p_holdout_group')).toBe('1');
  });

  it('smoke: assignHoldout()=false → INSERT includes holdout_group=0 (FOLLOW-261: URL param)', async () => {
    const capture = captureFetchBody();

    vi.mocked(assignHoldout).mockResolvedValueOnce({
      skipped: false,
      holdout_group: false,
      holdout_pct: 0.1,
      assigned_at: new Date().toISOString(),
    });

    const res = await GET(makeGetRequest(VALID_GET_PARAMS));

    expect(res.status).toBe(200);
    const body = capture.getLastBody();
    expect(body).not.toBeNull();
    expect(body).toContain('holdout_group');
    // FOLLOW-261: value is passed as URL param
    const url = capture.getLastUrl();
    expect(url).not.toBeNull();
    expect(url!.searchParams.get('param_p_holdout_group')).toBe('0');
  });

  it(
    'FOLLOW-452: GET ignores a caller-supplied `holdout_group=true` query param — ' +
      'the server-side assignHoldout() result (false) is what gets logged',
    async () => {
      const capture = captureFetchBody();

      vi.mocked(assignHoldout).mockResolvedValueOnce({
        skipped: false,
        holdout_group: false,
        holdout_pct: 0.1,
        assigned_at: new Date().toISOString(),
      });

      // Caller tries to force holdout via the (now-ignored) query param.
      const res = await GET(makeGetRequest({ ...VALID_GET_PARAMS, holdout_group: 'true' }));

      expect(res.status).toBe(200);
      const url = capture.getLastUrl();
      expect(url).not.toBeNull();
      // If the caller-supplied param were still honored this would be '1'.
      expect(url!.searchParams.get('param_p_holdout_group')).toBe('0');
    },
  );

  it('INSERT includes holdout_group column in the field list', async () => {
    const capture = captureFetchBody();

    vi.mocked(assignHoldout).mockResolvedValueOnce({
      skipped: false,
      holdout_group: false,
      holdout_pct: 0.1,
      assigned_at: new Date().toISOString(),
    });

    await GET(makeGetRequest(VALID_GET_PARAMS));

    const body = capture.getLastBody() ?? '';
    expect(body).toContain('holdout_group');
    // Verify the column list includes all expected fields
    expect(body).toContain('session_id');
    expect(body).toContain('tenant_id');
    expect(body).toContain('archetype');
    expect(body).toContain('holdout_group');
    expect(body).toContain('ts');
  });
});

// ─── Smoke tests — POST /api/adapt ────────────────────────────────────────────

describe('POST /api/adapt — holdout_group wired into ClickHouse INSERT (TICKET-AB-007)', () => {
  // TICKET-AB-010 update: holdout_group is now computed server-side by assignHoldout().
  // The ClickHouse INSERT only fires for treatment-arm sessions (holdout_pct=0.0 → guaranteed
  // treatment). Holdout and skipped sessions return early without a ClickHouse INSERT.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('smoke: treatment arm (holdout_pct=0.0) → INSERT includes holdout_group=0 (FOLLOW-261: URL param)', async () => {
    const capture = captureFetchBody();

    // holdout_pct=0.0 → 100% treatment, consent_mode_enabled=false → no skip
    const res = await POST(
      makePostRequest({ ...VALID_POST_BODY, holdout_pct: 0.0, consent_mode_enabled: false }),
    );

    expect(res.status).toBe(200);
    const body = capture.getLastBody();
    expect(body).not.toBeNull();
    expect(body).toContain('holdout_group');
    // FOLLOW-261: treatment arm → URL param '0'
    const url = capture.getLastUrl();
    expect(url).not.toBeNull();
    expect(url!.searchParams.get('param_p_holdout_group')).toBe('0');
  });

  it('smoke: holdout arm (holdout_pct=1.0) → returns early with empty directives AND still logs to ClickHouse (FOLLOW-442)', async () => {
    const capture = captureFetchBody();

    // holdout_pct=1.0 → 100% holdout → route returns early with empty directives,
    // but (FOLLOW-442) MUST still call logDecisionAsync so the lift query's holdout
    // denominator is non-zero.
    const res = await POST(
      makePostRequest({ ...VALID_POST_BODY, holdout_pct: 1.0, consent_mode_enabled: false }),
    );

    expect(res.status).toBe(200);
    const resBody = (await res.json()) as Record<string, unknown>;
    // Response body to the held-out caller is UNCHANGED (locked-in product
    // behavior, FOLLOW-452): still 'neutral' with empty directives.
    expect(resBody.holdout_group).toBe(true);
    expect(resBody.archetype).toBe('neutral');
    expect(Array.isArray(resBody.directives)).toBe(true);
    expect((resBody.directives as unknown[]).length).toBe(0);

    // FOLLOW-442: REDPANDA_REST_URL is not stubbed in this suite, so
    // publishAbAssignmentEvent is a configured-no-op (no fetch); the ONLY fetch call
    // on this path is the ClickHouse INSERT from logDecisionAsync. Assert it fired
    // with holdout_group=1 (i.e. holdoutGroup=true) and the expected feature values.
    const fetchBody = capture.getLastBody() ?? '';
    expect(fetchBody).toMatch(/INSERT INTO adaptation_decisions/);
    expect(fetchBody).toContain('holdout_group');
    const url = capture.getLastUrl();
    expect(url).not.toBeNull();
    expect(url!.searchParams.get('param_p_holdout_group')).toBe('1');
    // variant='control' — bandit not consulted on the holdout path.
    expect(url!.searchParams.get('param_p_variant')).toBe('control');
    // FOLLOW-452 (audit F-08): the LOGGED row carries the WOULD-BE archetype/
    // confidence (VALID_POST_BODY.archetype_hint/confidence) — NOT the hardcoded
    // 'neutral'/0.5 that the RESPONSE body above still uses. This is the core
    // fix: without it, the per-archetype lift query's holdout arm was starved
    // for every real archetype.
    expect(url!.searchParams.get('param_p_archetype')).toBe(VALID_POST_BODY.archetype_hint);
    expect(url!.searchParams.get('param_p_confidence')).toBe(String(VALID_POST_BODY.confidence));
  });

  it('smoke: consent skipped → no ClickHouse INSERT (no holdout_group field)', async () => {
    const capture = captureFetchBody();

    const res = await POST(
      makePostRequest({
        ...VALID_POST_BODY,
        consent_state: 'opted_out',
        consent_mode_enabled: true,
      }),
    );

    expect(res.status).toBe(200);
    const resBody = (await res.json()) as Record<string, unknown>;
    expect(resBody.holdout_group).toBeUndefined();
    const fetchBody = capture.getLastBody() ?? '';
    expect(fetchBody).not.toMatch(/INSERT INTO adaptation_decisions/);
  });

  it('INSERT query contains the exact holdout_group field name (treatment arm)', async () => {
    const capture = captureFetchBody();

    await POST(
      makePostRequest({ ...VALID_POST_BODY, holdout_pct: 0.0, consent_mode_enabled: false }),
    );

    const body = capture.getLastBody() ?? '';
    // Column list
    expect(body).toContain('holdout_group');
    // The INSERT format is: INSERT INTO adaptation_decisions (col1, ..., holdout_group, ts)
    expect(body).toMatch(/INSERT INTO adaptation_decisions/);
    expect(body).toMatch(/holdout_group/);
  });

  it('INSERT carries Conversion Label Loop fields (FOLLOW-170): model_version + features_snapshot + lead_id', async () => {
    const capture = captureFetchBody();

    await POST(
      makePostRequest({ ...VALID_POST_BODY, holdout_pct: 0.0, consent_mode_enabled: false }),
    );

    const body = capture.getLastBody() ?? '';
    // Column names still present in the INSERT column list (query body).
    expect(body).toContain('model_version');
    expect(body).toContain('features_snapshot');
    expect(body).toContain('lead_id');

    // FOLLOW-261: values are now URL params, not interpolated into query body.
    const url = capture.getLastUrl();
    expect(url).not.toBeNull();
    // model_version scorer stamp is in the URL param.
    expect(url!.searchParams.get('param_p_model_version')).toBe('rulebased-bandit-v1');
    // features_snapshot is a PII-free JSON blob — parse it from the URL param.
    const snapshot = url!.searchParams.get('param_p_features_snapshot') ?? '';
    const parsed = JSON.parse(snapshot) as Record<string, unknown>;
    expect(parsed).toHaveProperty('archetype');
    expect(parsed).toHaveProperty('confidence');
    // PII check: session/lead IDs must NOT be in the snapshot.
    expect(snapshot).not.toMatch(/"session_id":/);
  });
});

// ─── No CLICKHOUSE_URL — fire-and-forget skips gracefully ─────────────────────

describe('adapt route — no CLICKHOUSE_URL configured (fire-and-forget no-op)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CLICKHOUSE_URL', '');
    vi.stubEnv('ADAPT_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('GET returns 200 without throwing when CLICKHOUSE_URL is not set', async () => {
    const res = await GET(makeGetRequest({ ...VALID_GET_PARAMS, holdout_group: 'true' }));
    expect(res.status).toBe(200);
  });

  it('POST returns 200 without throwing when CLICKHOUSE_URL is not set', async () => {
    const res = await POST(makePostRequest({ ...VALID_POST_BODY, holdout_group: true }));
    expect(res.status).toBe(200);
  });
});
