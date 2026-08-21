/**
 * Tests for logDecisionAsync — FOLLOW-261 (F-30) parameterized ClickHouse INSERT.
 *
 * Verifies that the adaptation_decisions INSERT uses {name:Type} placeholders in the
 * query body and passes all values as URL query params (?param_p_*=), so that
 * SQL-injection characters in string inputs never reach the query text.
 *
 * FOLLOW-431: also asserts that logDecisionAsync is registered via after() so it
 * completes after the response on Vercel. (It also covered publishAbAssignmentEvent
 * until ADR-0022 / FOLLOW-988 stage B deleted that publisher.)
 *
 * @module apps/control-plane/src/app/api/adapt/route.clickhouse.test
 */

// ─── next/server mock (must be before all imports) ───────────────────────────
// Mock after() as a synchronous pass-through spy so existing tests that rely on
// the fire-and-forget fetch completing synchronously continue to work, and new
// tests can assert after() was called (FOLLOW-431 / AC-4).
vi.mock('next/server', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('next/server');
  return {
    ...actual,
    after: vi.fn((fn: () => unknown) => {
      void fn();
    }),
  };
});

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── Sentry mock (FOLLOW-425) ─────────────────────────────────────────────────
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

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

import * as Sentry from '@sentry/nextjs';
import { after } from 'next/server';
// FOLLOW-473: GET auth is now the shared two-step resolver (resolveAdaptGetAuth).
// Mock it to the deterministic tenant this suite exercises (TENANT_ID) — the real
// auth mechanics are covered end-to-end in route.follow473.test.ts.
vi.mock('@/lib/adapt-get-auth', () => ({
  resolveAdaptGetAuth: vi
    .fn()
    .mockResolvedValue({ ok: true, tenantId: '550e8400-e29b-41d4-a716-446655440001' }),
}));

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

  // FOLLOW-988 / ADR-0022: holdout_pct is the ONE field the retired A/B publisher carried that
  // adaptation_decisions did not. It is now written here.
  //
  // ⚠️ This column exists in prod ONLY because an operator applied migration 0021 by hand on
  // 2026-08-15 — ClickHouse migrations do not auto-apply and the prod user has no DDL grant.
  // ESC-031 is what happens when that ordering slips: migration 0019 shipped unapplied and every
  // adaptation_decisions write failed SILENTLY for 80 minutes, because logDecisionAsync's .catch()
  // swallows the 4xx ClickHouse returns for an unknown column. This test asserts the column is
  // BOUND; it cannot assert the column EXISTS in production, and nothing in CI can.
  it('FOLLOW-988: the INSERT carries holdout_pct, bound from the request body', async () => {
    await POST(makePostRequest({ ...BASE_BODY, holdout_pct: 0.25 }));

    await new Promise((r) => setTimeout(r, 0));

    expect(mockFetch).toHaveBeenCalled();
    const [fetchUrl] = mockFetch.mock.calls[0] as [string];
    const parsedUrl = new URL(fetchUrl);

    // The column must be in the STATEMENT, which travels in the POST body, not the URL — a bound
    // param with no matching column is a silent no-op, so asserting the binding alone is not enough.
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const statement = init.body;
    expect(typeof statement, 'the SQL travels as a string body').toBe('string');
    expect(statement as string).toContain('holdout_pct');
    expect(parsedUrl.searchParams.get('param_p_holdout_pct')).toBe('0.25');
  });

  it('FOLLOW-988: falls back to DEFAULT_HOLDOUT_PCT when the body omits it', async () => {
    // The default matches migration 0021's column DEFAULT 0 only if DEFAULT_HOLDOUT_PCT is 0;
    // asserting the ACTUAL constant rather than a literal keeps this honest if the regime changes.
    await POST(makePostRequest({ ...BASE_BODY }));

    await new Promise((r) => setTimeout(r, 0));

    const [fetchUrl] = mockFetch.mock.calls[0] as [string];
    const parsedUrl = new URL(fetchUrl);
    expect(parsedUrl.searchParams.get('param_p_holdout_pct')).not.toBeNull();
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

// ─── FOLLOW-425: fail loud on ClickHouse INSERT rejection ────────────────────
//
// Verifies that a non-2xx HTTP response from ClickHouse (e.g. auth failure Code
// 516, unknown column, quota exceeded) is treated as an error: Sentry is
// notified and the failure is logged — while the fire-and-forget guarantee is
// preserved (logDecisionAsync does not throw and does not block the caller).

describe('logDecisionAsync — FOLLOW-425 fail loud on ClickHouse INSERT rejection', () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let captureException: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    captureException = vi.mocked(Sentry.captureException);
    captureException.mockReset();
    vi.stubEnv('CLICKHOUSE_URL', CLICKHOUSE_URL);
    vi.stubEnv('DEMO_MODE_JWT_SECRET', 'test-secret-32-chars-long-enough!!');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('FOLLOW-425: non-ok HTTP response → captureException called, route does not throw', async () => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 516,
      text: () =>
        Promise.resolve('Authentication failed. Password is incorrect or there is no user.'),
    });
    vi.stubGlobal('fetch', mockFetch);

    // Must not throw — fire-and-forget guarantee
    await expect(POST(makePostRequest(BASE_BODY))).resolves.not.toThrow();

    // Allow the fire-and-forget microtask chain to settle
    await new Promise((r) => setTimeout(r, 0));

    // FOLLOW-1061: a treatment request now issues TWO ClickHouse INSERTs — the
    // `adaptation_decisions` row and the `llm_calls` pre-LLM segment row — and this mock
    // fails BOTH, so fail-loud fires twice. Asserting the exact count keeps the original
    // assertion's strength (it would still catch a swallowed failure) instead of
    // weakening it to `toHaveBeenCalled()`.
    expect(captureException).toHaveBeenCalledTimes(2);
    const [capturedErr, capturedCtx] = captureException.mock.calls[0] as [
      Error,
      { tags: Record<string, string> },
    ];
    expect(capturedErr).toBeInstanceOf(Error);
    expect(capturedErr.message).toContain('516');
    expect(capturedErr.message).toContain('Authentication failed');
    expect(capturedCtx.tags.kind).toBe('insert_rejected');
    expect(capturedCtx.tags.sink).toBe('clickhouse');
  });

  it('FOLLOW-425: network-level rejection → captureException called (kind=network)', async () => {
    const networkErr = new Error('connect ECONNREFUSED 127.0.0.1:8123');
    mockFetch = vi.fn().mockRejectedValue(networkErr);
    vi.stubGlobal('fetch', mockFetch);

    await expect(POST(makePostRequest(BASE_BODY))).resolves.not.toThrow();

    await new Promise((r) => setTimeout(r, 0));

    // FOLLOW-1061: a treatment request now issues TWO ClickHouse INSERTs — the
    // `adaptation_decisions` row and the `llm_calls` pre-LLM segment row — and this mock
    // fails BOTH, so fail-loud fires twice. Asserting the exact count keeps the original
    // assertion's strength (it would still catch a swallowed failure) instead of
    // weakening it to `toHaveBeenCalled()`.
    expect(captureException).toHaveBeenCalledTimes(2);
    const [capturedErr, capturedCtx] = captureException.mock.calls[0] as [
      Error,
      { tags: Record<string, string> },
    ];
    expect(capturedErr).toBeInstanceOf(Error);
    expect(capturedCtx.tags.kind).toBe('network');
    expect(capturedCtx.tags.sink).toBe('clickhouse');
  });

  it('FOLLOW-425: successful HTTP 200 → captureException NOT called', async () => {
    mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal('fetch', mockFetch);

    await POST(makePostRequest(BASE_BODY));
    await new Promise((r) => setTimeout(r, 0));

    expect(captureException).not.toHaveBeenCalled();
  });
});

// ─── FOLLOW-431: after() registration — sinks must be registered via after() ───
//
// AC-1: logDecisionAsync and publishAbAssignmentEvent must be registered via
// after() so their async work completes after the Vercel response is sent.
// The after() mock is a synchronous pass-through (see top of file) so the
// existing fail-loud tests still work; these tests assert the registration itself.

describe('FOLLOW-431: logDecisionAsync registered via after() in GET and POST handlers', () => {
  let mockAfter: ReturnType<typeof vi.fn>;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockAfter = vi.mocked(after);
    mockAfter.mockReset();
    // Restore pass-through behaviour so the sink still runs in the same tick
    mockAfter.mockImplementation((fn: () => unknown) => {
      void fn();
    });
    mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', mockFetch);
    vi.stubEnv('CLICKHOUSE_URL', 'http://localhost:8123');
    vi.stubEnv('DEMO_MODE_JWT_SECRET', 'test-secret-32-chars-long-enough!!');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('FOLLOW-431: POST handler registers logDecisionAsync via after()', async () => {
    await POST(makePostRequest(BASE_BODY));
    await new Promise((r) => setTimeout(r, 0));

    // after() must have been called at least once with a function that starts the
    // ClickHouse INSERT (verified by the subsequent fetch assertion).
    expect(mockAfter).toHaveBeenCalled();
    // The callback must have triggered the actual ClickHouse fetch
    expect(mockFetch).toHaveBeenCalled();
    const [fetchUrl] = mockFetch.mock.calls[0] as [string];
    expect(fetchUrl).toContain('param_p_session_id');
  });

  it('FOLLOW-431: GET handler registers logDecisionAsync via after()', async () => {
    await GET(makeGetRequest(BASE_GET_PARAMS));
    await new Promise((r) => setTimeout(r, 0));

    expect(mockAfter).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalled();
    const [fetchUrl] = mockFetch.mock.calls[0] as [string];
    expect(fetchUrl).toContain('param_p_session_id');
  });
});

// ─── FOLLOW-431 publisher case RETIRED — its subject no longer exists ─────────
//
// This asserted `publishAbAssignmentEvent` was registered via `after()`. That publisher is gone
// (ADR-0022 / FOLLOW-988 stage B), so the case asserted a registration of a function that had
// discarded its argument since ADR-0016.
//
// THE INVARIANT IT GUARDED IS NOT LOST, and that was checked rather than assumed: FOLLOW-431 /
// ESC-033 is "un-awaited work after the response is dropped on Vercel, so every sink must be
// registered via after()". Two cases above still assert exactly that for `logDecisionAsync`, on
// both the POST and the GET path. This was the third subject of one rule, not a rule of its own.
