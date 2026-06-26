/**
 * Tests for logDecisionAsync — FOLLOW-261 (F-30) parameterized ClickHouse INSERT.
 *
 * Verifies that the adaptation_decisions INSERT uses {name:Type} placeholders in the
 * query body and passes all values as URL query params (?param_p_*=), so that
 * SQL-injection characters in string inputs never reach the query text.
 *
 * @module apps/control-plane/src/app/api/adapt/route.clickhouse.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock all external dependencies ──────────────────────────────────────────

vi.mock('@/lib/llm-gateway', () => ({
  callLlmGateway: vi.fn().mockResolvedValue(null),
}));

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn().mockResolvedValue(null),
}));

// FOLLOW-397: include SEED_VARIANTS so VARIANT_INDEX is derived correctly at module load.
vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
  getBanditArms: vi
    .fn()
    .mockResolvedValue([{ variant: 'control', alpha: 1, beta: 1, paused: false }]),
}));

vi.mock('@/lib/rag-retrieval', () => ({
  retrieveListingContext: vi.fn().mockResolvedValue({}),
}));

vi.mock('@/lib/tenant-schema', () => ({
  getTenantSchema: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/embedding-lookup', () => ({
  fetchArchetypeEmbedding: vi.fn().mockResolvedValue(null),
  fetchListingEmbeddings: vi.fn().mockResolvedValue(new Map()),
  LISTING_EMBEDDING_BATCH_LIMIT: 20,
}));

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue([]),
  })),
  tenants: {},
  demoOverrides: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
  and: vi.fn(),
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

vi.mock('@/lib/ab-events', () => ({
  publishAbAssignmentEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/demo-jwt-verify', () => ({
  verifyDemoJwt: vi.fn().mockResolvedValue({}),
  DemoJwtSecretMissingError: class DemoJwtSecretMissingError extends Error {},
  DemoJwtInvalidError: class DemoJwtInvalidError extends Error {},
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

import { GET, POST } from './route';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440001';
const CLICKHOUSE_URL = 'http://localhost:8123';

const BASE_BODY = {
  tenant_id: TENANT_ID,
  session_id: 'sess-ch-test-001',
  page_type: 'listing_detail' as const,
  archetype_hint: 'neutral',
  confidence: 0.5,
  similarity: 0.5,
};

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/adapt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    },
    body: JSON.stringify(body),
  });
}

function makeGetRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/adapt');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url, {
    headers: {
      Authorization: 'Bearer test-token',
      'x-tenant-id': TENANT_ID,
    },
  });
}

const BASE_GET_PARAMS = {
  session_id: 'sess-ch-get-001',
  archetype: 'yield_hunter',
  confidence: '0.75',
  similarity: '0.90',
  tier: '1',
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('logDecisionAsync — FOLLOW-261 parameterized ClickHouse INSERT', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
    vi.stubEnv('CLICKHOUSE_URL', CLICKHOUSE_URL);
    vi.stubEnv('DEMO_MODE_JWT_SECRET', 'test-secret-32-chars-long-enough!!');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('FOLLOW-261: query body uses {p_*:Type} placeholders, not interpolated values', async () => {
    await POST(makePostRequest(BASE_BODY));

    // Allow microtasks (fire-and-forget fetch) to settle
    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).toHaveBeenCalled();
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = options.body as string;

    // Query body must use named placeholders
    expect(body).toContain('{p_session_id:String}');
    expect(body).toContain('{p_tenant_id:String}');
    expect(body).toContain('{p_confidence:Float64}');
    expect(body).toContain('{p_holdout_group:UInt8}');
    // Must NOT contain any literal value interpolated into the query
    expect(body).not.toContain(TENANT_ID);
    expect(body).not.toContain('sess-ch-test-001');
  });

  it('FOLLOW-261: values appear as URL query params on the ClickHouse URL', async () => {
    const sessionId = 'sess-param-test-002';
    await POST(makePostRequest({ ...BASE_BODY, session_id: sessionId }));

    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).toHaveBeenCalled();
    const [fetchUrl] = mockFetch.mock.calls[0] as [string];
    const parsedUrl = new URL(fetchUrl);

    expect(parsedUrl.searchParams.get('param_p_session_id')).toBe(sessionId);
    expect(parsedUrl.searchParams.get('param_p_tenant_id')).toBe(TENANT_ID);
    expect(parsedUrl.origin).toBe(CLICKHOUSE_URL);
  });

  it('FOLLOW-261 (F-30): single-quote in session_id goes to URL param, not query body', async () => {
    const maliciousSession = "sess'); DROP TABLE adaptation_decisions; --";
    await POST(makePostRequest({ ...BASE_BODY, session_id: maliciousSession }));

    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).toHaveBeenCalled();
    const [fetchUrl, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = options.body as string;
    const parsedUrl = new URL(fetchUrl);

    // The malicious value must NOT appear in the query body
    expect(body).not.toContain('DROP TABLE');
    expect(body).not.toContain(maliciousSession);
    // The value IS safely passed as a URL param (ClickHouse handles escaping)
    expect(parsedUrl.searchParams.get('param_p_session_id')).toBe(maliciousSession);
  });

  it('FOLLOW-261: no fetch call when CLICKHOUSE_URL is empty', async () => {
    vi.stubEnv('CLICKHOUSE_URL', '');

    await POST(makePostRequest(BASE_BODY));
    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).not.toHaveBeenCalled();
  });

  // FOLLOW-356 AC-3: logDecisionAsync receives page_context=2 for listing_detail pages.
  it('FOLLOW-356 AC-3: logDecisionAsync receives page_context=2 for listing_detail', async () => {
    await POST(makePostRequest({ ...BASE_BODY, page_type: 'listing_detail' as const }));

    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).toHaveBeenCalled();
    const [fetchUrl] = mockFetch.mock.calls[0] as [string];
    const parsedUrl = new URL(fetchUrl);

    // The ClickHouse INSERT must carry page_context=2 for listing_detail.
    expect(parsedUrl.searchParams.get('param_p_page_context')).toBe('2');
  });

  // FOLLOW-356 AC-3 (parity): logDecisionAsync receives page_context=1 for list/search/home.
  it('FOLLOW-356 AC-3: logDecisionAsync receives page_context=1 for listing_list', async () => {
    await POST(makePostRequest({ ...BASE_BODY, page_type: 'listing_list' as const }));

    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).toHaveBeenCalled();
    const [fetchUrl] = mockFetch.mock.calls[0] as [string];
    const parsedUrl = new URL(fetchUrl);

    expect(parsedUrl.searchParams.get('param_p_page_context')).toBe('1');
  });
});

// ─── FOLLOW-358: page_context_source discriminator (Rule K.1) ─────────────────
//
// AC-2: asserts that GET and POST write DIFFERENT page_context_source values to
// ClickHouse, making the semantic divergence observable to analysts.

describe('logDecisionAsync — FOLLOW-358 page_context_source discriminator (Rule K.1)', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
    vi.stubEnv('CLICKHOUSE_URL', CLICKHOUSE_URL);
    vi.stubEnv('ADAPT_API_KEY', '');
    vi.stubEnv('DEMO_MODE_JWT_SECRET', 'test-secret-32-chars-long-enough!!');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('FOLLOW-358 AC-2: GET handler writes page_context_source=caller_supplied to ClickHouse', async () => {
    await GET(makeGetRequest(BASE_GET_PARAMS));
    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).toHaveBeenCalled();
    const [fetchUrl] = mockFetch.mock.calls[0] as [string];
    const parsedUrl = new URL(fetchUrl);

    // GET path: caller supplies the tier value; source must be 'caller_supplied'.
    expect(parsedUrl.searchParams.get('param_p_page_context_source')).toBe('caller_supplied');
    // Sanity: page_context is the raw tier param passed by the caller.
    expect(parsedUrl.searchParams.get('param_p_page_context')).toBe('1');
  });

  it('FOLLOW-358 AC-2: POST handler writes page_context_source=page_type_derived to ClickHouse', async () => {
    await POST(makePostRequest({ ...BASE_BODY, page_type: 'listing_detail' as const }));
    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).toHaveBeenCalled();
    const [fetchUrl] = mockFetch.mock.calls[0] as [string];
    const parsedUrl = new URL(fetchUrl);

    // POST path: server derives the value from page_type; source must be 'page_type_derived'.
    expect(parsedUrl.searchParams.get('param_p_page_context_source')).toBe('page_type_derived');
    // Sanity: listing_detail → page_context=2 (pageContextFromPageType).
    expect(parsedUrl.searchParams.get('param_p_page_context')).toBe('2');
  });

  it('FOLLOW-358 AC-2: POST listing_list → page_context_source=page_type_derived, page_context=1', async () => {
    await POST(makePostRequest({ ...BASE_BODY, page_type: 'listing_list' as const }));
    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).toHaveBeenCalled();
    const [fetchUrl] = mockFetch.mock.calls[0] as [string];
    const parsedUrl = new URL(fetchUrl);

    expect(parsedUrl.searchParams.get('param_p_page_context_source')).toBe('page_type_derived');
    expect(parsedUrl.searchParams.get('param_p_page_context')).toBe('1');
  });

  it('FOLLOW-358 AC-2: page_context_source placeholder is in the INSERT query body', async () => {
    await POST(makePostRequest(BASE_BODY));
    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).toHaveBeenCalled();
    const [, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = options.body as string;

    // The column name must appear in the INSERT field list AND the placeholder in VALUES.
    expect(body).toContain('page_context_source');
    expect(body).toContain('{p_page_context_source:String}');
  });
});
