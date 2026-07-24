/**
 * FOLLOW-633 tests: per-tenant Adaptive Listings ON/OFF enforcement in the adapt
 * path (GET + POST), the single shared point (resolveAlEnablement).
 *
 * Proves all four directions at the ROUTE level (the helper's own real-row
 * directions are covered in src/lib/al-enablement.test.ts):
 *   - OFF (al_enabled=false) → 200 neutral pass-through, NO adaptation, NO bandit,
 *     NO ClickHouse row, provenance `adaptive_listings_off`/`al_off_reason` present.
 *   - OFF via status suspended / canceled → same neutral pass-through.
 *   - ON (al_enabled=true + status active) → normal adaptation, directives present.
 *   - GET and POST both enforce (shared helper — they cannot diverge).
 *
 * @module apps/control-plane/src/app/api/adapt/route.follow633.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks (hoisted before route import) ────────────────────────────────────

const { mockResolveAlEnablement } = vi.hoisted(() => ({
  mockResolveAlEnablement: vi.fn(),
}));
vi.mock('@/lib/al-enablement', () => ({
  resolveAlEnablement: mockResolveAlEnablement,
  AL_OFF_STATUSES: new Set(['suspended', 'canceled']),
}));

vi.mock('@/lib/demo-jwt-verify', () => ({
  verifyDemoJwt: vi.fn().mockResolvedValue({ tenant_id: 'tenant-633' }),
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

vi.mock('@/lib/demo-override-store', () => ({
  getDemoOverride: vi.fn().mockResolvedValue({
    enabled: false,
    overrideArchetype: null,
    overrideModel: 'claude-sonnet-4-6',
  }),
  DEMO_OVERRIDE_CONFIDENCE: 0.9,
  DEMO_OVERRIDE_SIMILARITY: 0.75,
}));

vi.mock('@/lib/tenant-schema', () => ({
  getTenantSchema: vi.fn().mockResolvedValue(null),
}));

vi.mock('@estalara/sdk/playbooks', () => ({
  getPlaybook: vi.fn(() => ({
    slots: [
      { slot: 'headline', en: 'Control headline' },
      { slot: 'cta', en: 'View Details' },
    ],
  })),
}));

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
    thompsonSample: vi.fn().mockReturnValue('control'),
  };
});

vi.mock('@/lib/adapt-get-auth', () => ({
  resolveAdaptGetAuth: vi.fn().mockResolvedValue({ ok: true, tenantId: 'tenant-633' }),
}));

import { GET, POST } from './route.js';
import { getBanditArms } from '@/lib/bandit-query';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Records whether a ClickHouse INSERT fetch fired. */
function captureFetch(): { called: () => boolean } {
  let called = false;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(() => {
      called = true;
      return Promise.resolve(new Response('', { status: 200 }));
    }),
  );
  return { called: () => called };
}

const GET_PARAMS = {
  session_id: 'sess-633-get',
  archetype: 'yield_hunter',
  confidence: '0.80',
  similarity: '0.90',
  tier: '1',
};

function makeGetRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/adapt');
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new NextRequest(url, { headers: { Authorization: 'Bearer test_key' } });
}

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest(new URL('http://localhost/api/adapt'), {
    method: 'POST',
    headers: { Authorization: 'Bearer test_key', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const POST_BODY = {
  tenant_id: 'tenant-633',
  session_id: 'sess-633-post',
  page_type: 'listing_detail' as const,
  archetype_hint: 'yield_hunter',
  confidence: 0.8,
  similarity: 0.9,
};

interface AdaptBody {
  archetype: string;
  directives: unknown[];
  source: string;
  adaptive_listings_off?: boolean;
  al_off_reason?: string | null;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
  vi.stubEnv('DEMO_MODE_JWT_SECRET', 'test-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ─── GET enforcement ────────────────────────────────────────────────────────

describe('GET /api/adapt — FOLLOW-633 AL on/off enforcement', () => {
  it('OFF (al_disabled) → 200 neutral, no adaptation, no bandit, no ClickHouse row, provenance present', async () => {
    mockResolveAlEnablement.mockResolvedValue({ off: true, reason: 'al_disabled' });
    const capture = captureFetch();

    const res = await GET(makeGetRequest(GET_PARAMS));
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdaptBody;

    expect(body.directives).toHaveLength(0);
    expect(body.source).toBe('default');
    expect(body.archetype).toBe('neutral');
    expect(body.adaptive_listings_off).toBe(true);
    expect(body.al_off_reason).toBe('al_disabled');
    // No bandit sampling, no ClickHouse decision row on the OFF path.
    expect(getBanditArms).not.toHaveBeenCalled();
    expect(capture.called()).toBe(false);
  });

  it('OFF (status_suspended) → 200 neutral pass-through', async () => {
    mockResolveAlEnablement.mockResolvedValue({ off: true, reason: 'status_suspended' });
    captureFetch();
    const res = await GET(makeGetRequest(GET_PARAMS));
    const body = (await res.json()) as AdaptBody;
    expect(res.status).toBe(200);
    expect(body.directives).toHaveLength(0);
    expect(body.al_off_reason).toBe('status_suspended');
  });

  it('OFF (status_canceled) → 200 neutral pass-through', async () => {
    mockResolveAlEnablement.mockResolvedValue({ off: true, reason: 'status_canceled' });
    captureFetch();
    const res = await GET(makeGetRequest(GET_PARAMS));
    const body = (await res.json()) as AdaptBody;
    expect(res.status).toBe(200);
    expect(body.directives).toHaveLength(0);
    expect(body.al_off_reason).toBe('status_canceled');
  });

  it('ON (al_enabled=true, active) → normal adaptation, directives present, bandit runs', async () => {
    mockResolveAlEnablement.mockResolvedValue({ off: false, reason: null });
    captureFetch();

    const res = await GET(makeGetRequest(GET_PARAMS));
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdaptBody;

    // High similarity (0.90) → playbook source, directives present.
    expect(body.source).toBe('playbook');
    expect(body.directives.length).toBeGreaterThan(0);
    expect(body.adaptive_listings_off).toBeUndefined();
    expect(getBanditArms).toHaveBeenCalled();
  });
});

// ─── POST enforcement ───────────────────────────────────────────────────────

describe('POST /api/adapt — FOLLOW-633 AL on/off enforcement', () => {
  it('OFF (al_disabled) → 200 neutral, no adaptation, no bandit, provenance present', async () => {
    mockResolveAlEnablement.mockResolvedValue({ off: true, reason: 'al_disabled' });
    captureFetch();

    const res = await POST(makePostRequest(POST_BODY));
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdaptBody;

    expect(body.directives).toHaveLength(0);
    expect(body.source).toBe('default');
    expect(body.archetype).toBe('neutral');
    expect(body.adaptive_listings_off).toBe(true);
    expect(body.al_off_reason).toBe('al_disabled');
    expect(getBanditArms).not.toHaveBeenCalled();
  });

  it('OFF (status_suspended) → 200 neutral pass-through', async () => {
    mockResolveAlEnablement.mockResolvedValue({ off: true, reason: 'status_suspended' });
    captureFetch();
    const res = await POST(makePostRequest(POST_BODY));
    const body = (await res.json()) as AdaptBody;
    expect(res.status).toBe(200);
    expect(body.directives).toHaveLength(0);
    expect(body.al_off_reason).toBe('status_suspended');
  });

  it('OFF (status_canceled) → 200 neutral pass-through', async () => {
    mockResolveAlEnablement.mockResolvedValue({ off: true, reason: 'status_canceled' });
    captureFetch();
    const res = await POST(makePostRequest(POST_BODY));
    const body = (await res.json()) as AdaptBody;
    expect(res.status).toBe(200);
    expect(body.directives).toHaveLength(0);
    expect(body.al_off_reason).toBe('status_canceled');
  });

  it('ON (al_enabled=true, active) → normal adaptation, directives present, bandit runs', async () => {
    mockResolveAlEnablement.mockResolvedValue({ off: false, reason: null });
    captureFetch();

    const res = await POST(makePostRequest(POST_BODY));
    expect(res.status).toBe(200);
    const body = (await res.json()) as AdaptBody;

    expect(body.source).toBe('playbook');
    expect(body.directives.length).toBeGreaterThan(0);
    expect(body.adaptive_listings_off).toBeUndefined();
    expect(getBanditArms).toHaveBeenCalled();
  });
});
