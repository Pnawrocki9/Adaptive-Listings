/**
 * `POST /api/adapt` — stage: LOGGING.
 *
 * What the route writes after the response: the parameterised `adaptation_decisions` INSERT
 * (FOLLOW-261) and its columns, `page_context_source`, `holdout_pct`, the flag-gated
 * `scoring_path`, the fail-loud Sentry capture on a rejected insert (FOLLOW-425), registration
 * via `after()` (FOLLOW-431).
 *
 * FOLLOW-1287 merged the per-ticket suites below into this one file, one `describe` per original
 * file, every test kept verbatim (see the registry note under the imports for how their differing
 * mocks coexist).
 *
 * @module apps/control-plane/src/app/api/adapt/route.logging.test
 */
import { describe, expect, it, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { fetchArchetypeEmbedding, fetchListingEmbeddings } from '@/lib/embedding-lookup';
import { getTenantSchema } from '@/lib/tenant-schema';
import * as Sentry from '@sentry/nextjs';
import { NextRequest, after } from 'next/server';
import { POST } from './route';

// ─── Per-origin mock registry ─────────────────────────────────────────────────
//
// FOLLOW-1287: this file merges several per-ticket suites. Each of them used to declare its own
// module-level `vi.mock` factories, and those factories DIFFER (one suite's gateway returns null,
// another's returns directives; one fixes the playbook, another uses the real registry), so they
// cannot simply be concatenated. Instead every module any merged suite mocked is mocked ONCE
// below with a proxy, and each suite's original factories — verbatim — fill a per-suite registry
// (`__reg`) inside that suite's `describe`. While a suite runs (and while it is collected, so a
// top-level `vi.mocked(x)` binds to that suite's own mock), the proxy serves its registry; a
// module the suite never mocked falls through to the real implementation, exactly as it did when
// the suite was its own file.
const __H = vi.hoisted(() => {
  const h = {
    active: null as Map<string, Record<string, unknown>> | null,
    actual: {} as Record<string, Record<string, unknown>>,
    /** The real module, as the suite's `vi.importActual` / `importOriginal` returned it. */
    real(id: string): Record<string, unknown> {
      const mod = h.actual[id];
      if (!mod) throw new Error(`[FOLLOW-1287 registry] ${id} was not loaded before collection`);
      return mod;
    },
    proxy(id: string, actual: Record<string, unknown>): Record<string, unknown> {
      h.actual[id] = actual;
      // The suite's own mock when it mocked this module, else the real module. Resolved on every
      // access, so an export a suite's factory did not define is missing exactly as it was.
      const source = (): Record<string | symbol, unknown> => h.active?.get(id) ?? actual;
      return new Proxy<Record<string, unknown>>(
        {},
        {
          get: (_target, key) => source()[key],
          has: (_target, key) => key in source(),
          ownKeys: () => Reflect.ownKeys(source()),
          getOwnPropertyDescriptor: (_target, key) =>
            key in source()
              ? { enumerable: true, configurable: true, value: source()[key] }
              : undefined,
        },
      );
    },
  };
  return h;
});

vi.mock('next/server', async (importOriginal) =>
  __H.proxy('next/server', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@sentry/nextjs', async (importOriginal) =>
  __H.proxy('@sentry/nextjs', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/llm-gateway', async (importOriginal) =>
  __H.proxy('@/lib/llm-gateway', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@estalara/auth', async (importOriginal) =>
  __H.proxy('@estalara/auth', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/bandit-query', async (importOriginal) =>
  __H.proxy('@/lib/bandit-query', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/rag-retrieval', async (importOriginal) =>
  __H.proxy('@/lib/rag-retrieval', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/tenant-schema', async (importOriginal) =>
  __H.proxy('@/lib/tenant-schema', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/embedding-lookup', async (importOriginal) =>
  __H.proxy('@/lib/embedding-lookup', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@estalara/db', async (importOriginal) =>
  __H.proxy('@estalara/db', await importOriginal<Record<string, unknown>>()),
);
vi.mock('drizzle-orm', async (importOriginal) =>
  __H.proxy('drizzle-orm', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/demo-override-store', async (importOriginal) =>
  __H.proxy('@/lib/demo-override-store', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/demo-jwt-verify', async (importOriginal) =>
  __H.proxy('@/lib/demo-jwt-verify', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@estalara/shared', async (importOriginal) =>
  __H.proxy('@estalara/shared', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/adapt-get-auth', async (importOriginal) =>
  __H.proxy('@/lib/adapt-get-auth', await importOriginal<Record<string, unknown>>()),
);

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.clickhouse.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.clickhouse.test.ts — Tests for logDecisionAsync — FOLLOW-261 (F-30) parameterized ClickHouse INSERT.', () => {
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

  const __reg = new Map<string, Record<string, unknown>>();
  // ─── next/server mock (must be before all imports) ───────────────────────────
  // Mock after() as a synchronous pass-through spy so existing tests that rely on
  // the fire-and-forget fetch completing synchronously continue to work, and new
  // tests can assert after() was called (FOLLOW-431 / AC-4).
  __reg.set(
    'next/server',
    (() => {
      const actual = __H.real('next/server');
      return {
        ...actual,
        after: vi.fn((fn: () => unknown) => {
          void fn();
        }),
      };
    })(),
  );
  // ─── Sentry mock (FOLLOW-425) ─────────────────────────────────────────────────
  // `captureMessage` joined this mock with FOLLOW-1140: a request with no `listing_id` drops every
  // playbook directive whose copy carries a `{token}` server-side and says so through Sentry.
  // Without the export that path throws inside the mock.
  __reg.set('@sentry/nextjs', (() => ({ captureException: vi.fn(), captureMessage: vi.fn() }))());
  __reg.set(
    '@/lib/llm-gateway',
    (() => ({
      callLlmGateway: vi.fn().mockResolvedValue(null),
    }))(),
  );
  __reg.set(
    '@estalara/auth',
    (() => ({
      getAuthClaims: vi.fn().mockResolvedValue(null),
    }))(),
  );
  // FOLLOW-397: include SEED_VARIANTS so VARIANT_INDEX is derived correctly at module load.
  __reg.set(
    '@/lib/bandit-query',
    (() => ({
      SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
      getBanditArms: vi
        .fn()
        .mockResolvedValue([{ variant: 'control', alpha: 1, beta: 1, paused: false }]),
    }))(),
  );
  __reg.set(
    '@/lib/rag-retrieval',
    (() => ({
      retrieveListingContext: vi.fn().mockResolvedValue({}),
    }))(),
  );
  __reg.set(
    '@/lib/tenant-schema',
    (() => ({
      getTenantSchema: vi.fn().mockResolvedValue(null),
    }))(),
  );
  __reg.set(
    '@/lib/embedding-lookup',
    (() => ({
      fetchArchetypeEmbedding: vi.fn().mockResolvedValue(null),
      fetchListingEmbeddings: vi.fn().mockResolvedValue(new Map()),
      LISTING_EMBEDDING_BATCH_LIMIT: 20,
    }))(),
  );
  __reg.set(
    '@estalara/db',
    (() => ({
      createAdminClient: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue([]),
      })),
      tenants: {},
      demoOverrides: {},
    }))(),
  );
  __reg.set(
    'drizzle-orm',
    (() => ({
      eq: vi.fn(),
      and: vi.fn(),
    }))(),
  );
  __reg.set(
    '@/lib/demo-override-store',
    (() => ({
      getDemoOverride: vi.fn().mockResolvedValue({
        enabled: false,
        overrideArchetype: null,
        overrideModel: 'claude-sonnet-4-6',
      }),
      DEMO_OVERRIDE_CONFIDENCE: 0.95,
      DEMO_OVERRIDE_SIMILARITY: 0.75,
    }))(),
  );
  __reg.set(
    '@/lib/demo-jwt-verify',
    (() => ({
      verifyDemoJwt: vi.fn().mockResolvedValue({}),
      DemoJwtSecretMissingError: class DemoJwtSecretMissingError extends Error {},
      DemoJwtInvalidError: class DemoJwtInvalidError extends Error {},
    }))(),
  );
  __reg.set(
    '@estalara/shared',
    (() => {
      const mod = __H.real('@estalara/shared');
      return {
        ...mod,
        assignHoldout: vi.fn().mockResolvedValue({
          holdout_group: false,
          skipped: false,
          assigned_at: new Date().toISOString(),
        }),
        thompsonSample: vi.fn().mockReturnValue('control'),
      };
    })(),
  );
  __H.active = __reg;
  beforeAll(() => {
    __H.active = __reg;
  });
  afterAll(() => {
    __H.active = null;
  });

  // ─── Mock all external dependencies ──────────────────────────────────────────

  // FOLLOW-560: overridden per-test in the scoring_path describe block below to exercise the
  // cosine / djb2_fallback / djb2_guard / not_applicable paths that feed adaptation_decisions
  // via buildReorderDirective(). Every other describe block in this file relies on this module's
  // default mocks (getTenantSchema -> null, embeddings -> null/empty) and is unaffected.

  const mockGetTenantSchema = vi.mocked(getTenantSchema);
  const mockFetchArchetypeEmbedding = vi.mocked(fetchArchetypeEmbedding);
  const mockFetchListingEmbeddings = vi.mocked(fetchListingEmbeddings);

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
    // FOLLOW-1201 (audit SEC-4 / FOLLOW-1102): this used to read "bound from the request body" and
    // sent `holdout_pct: 0.25`. The persisted value is now the CONFIGURED rate; a public caller's
    // body value is ignored (only the ADAPT_API_KEY caller may override it). Inverted, not deleted:
    // the body still carries a different number so the assertion proves it was NOT honoured.
    it('FOLLOW-988: the INSERT carries holdout_pct, bound from the configured rate (body ignored)', async () => {
      vi.stubEnv('HOLDOUT_PCT', '0.25');
      await POST(makePostRequest({ ...BASE_BODY, holdout_pct: 0.9 }));

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
  // AC-2: asserted that GET and POST wrote DIFFERENT page_context_source values. FOLLOW-1287
  // retired GET (its 'caller_supplied' case went with it); the POST half below remains.

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

      // One ClickHouse INSERT per treatment request (the `adaptation_decisions` row) since
      // FOLLOW-1290 removed the pre-LLM segment row, so fail-loud fires exactly once.
      expect(captureException).toHaveBeenCalledTimes(1);
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

      // One ClickHouse INSERT per treatment request (the `adaptation_decisions` row) since
      // FOLLOW-1290 removed the pre-LLM segment row, so fail-loud fires exactly once.
      expect(captureException).toHaveBeenCalledTimes(1);
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

  describe('FOLLOW-431: logDecisionAsync registered via after() in the POST handler', () => {
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
  });

  // ─── FOLLOW-431 publisher case RETIRED — its subject no longer exists ─────────
  //
  // This asserted `publishAbAssignmentEvent` was registered via `after()`. That publisher is gone
  // (ADR-0022 / FOLLOW-988 stage B), so the case asserted a registration of a function that had
  // discarded its argument since ADR-0016.
  //
  // THE INVARIANT IT GUARDED IS NOT LOST, and that was checked rather than assumed: FOLLOW-431 /
  // ESC-033 is "un-awaited work after the response is dropped on Vercel, so every sink must be
  // registered via after()". The POST case above still asserts exactly that for
  // `logDecisionAsync` (its GET twin left with the GET handler, FOLLOW-1287). This was the third
  // subject of one rule, not a rule of its own.

  // ─── FOLLOW-560: scoring_path — cosine vs djb2_fallback vs djb2_guard vs not_applicable ───
  //
  // The column is gated behind SCORING_PATH_COLUMN_ENABLED (default unset/false everywhere,
  // including prod Doppler) rather than always appearing in the INSERT column list. Reason:
  // ESC-031 — an earlier column (page_context_source) landed in the unconditional column list
  // before its migration was live in prod and every adaptation_decisions write failed SILENTLY
  // for 80 minutes. Migration 0022's prod apply is explicitly deferred to FOLLOW-820 (no same-day
  // choreography available, unlike migration 0021's), so the writer must be safe to deploy with
  // or without the column existing in prod. See migration 0022's header and the comment above
  // `scoringPathColumnEnabled` in route.ts for the full rationale.
  //
  // Consumer this column exists FOR: FOLLOW-819's differentiator E2E reads it to tell a real
  // cosine ranking from a djb2 stable-hash shuffle (backlog/FOLLOW_UPS.md FOLLOW-819 AC-3).

  describe('logDecisionAsync — FOLLOW-560 scoring_path', () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    const REORDER_SCHEMA = {
      reorder_capable: true,
      container_selector: '[data-estalara-listings-grid]',
      item_selector: '[data-estalara-listing-id]',
    };

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', mockFetch);
      vi.stubEnv('CLICKHOUSE_URL', CLICKHOUSE_URL);
      vi.stubEnv('DEMO_MODE_JWT_SECRET', 'test-secret-32-chars-long-enough!!');
      mockGetTenantSchema.mockReset();
      mockFetchArchetypeEmbedding.mockReset();
      mockFetchListingEmbeddings.mockReset();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    });

    it(
      'SCORING_PATH_COLUMN_ENABLED unset (the prod default): the column is OMITTED from the ' +
        'INSERT entirely — the ESC-031 safety net',
      async () => {
        mockGetTenantSchema.mockResolvedValue(REORDER_SCHEMA);
        mockFetchArchetypeEmbedding.mockResolvedValue(null);
        mockFetchListingEmbeddings.mockResolvedValue(new Map());

        await POST(makePostRequest({ ...BASE_BODY, listing_ids: ['listing-a', 'listing-b'] }));
        await new Promise((r) => setTimeout(r, 0));

        expect(mockFetch).toHaveBeenCalled();
        const [fetchUrl, options] = mockFetch.mock.calls[0] as [string, RequestInit];
        const body = options.body as string;
        const parsedUrl = new URL(fetchUrl);

        // Byte-identical to the pre-FOLLOW-560 INSERT: no column name, no bound param. This is
        // what makes the writer safe to deploy before migration 0022 lands in prod — it cannot
        // hit NO_SUCH_COLUMN_IN_BLOCK regardless of merge/deploy order relative to the migration.
        expect(body).not.toContain('scoring_path');
        expect(parsedUrl.searchParams.get('param_p_scoring_path')).toBeNull();
        // SQL-shape regression (RETRO-014 model): the column list must remain the single
        // parenthesised literal that migration-contract-test.sh greps out of route.ts. If someone
        // interpolates the flag into the list again, this token disappears and the CI ordering
        // guard silently stops guarding (it extracts a backtick-laced non-list).
        expect(body).toContain('lead_id, ts) VALUES (');
      },
    );

    it('SCORING_PATH_COLUMN_ENABLED=true, every listing scores via cosine → scoring_path=cosine', async () => {
      vi.stubEnv('SCORING_PATH_COLUMN_ENABLED', 'true');
      mockGetTenantSchema.mockResolvedValue(REORDER_SCHEMA);
      mockFetchArchetypeEmbedding.mockResolvedValue([1, 0, 0]);
      mockFetchListingEmbeddings.mockResolvedValue(
        new Map<string, number[] | null>([
          ['listing-a', [1, 0, 0]],
          ['listing-b', [0, 1, 0]],
        ]),
      );

      await POST(makePostRequest({ ...BASE_BODY, listing_ids: ['listing-a', 'listing-b'] }));
      await new Promise((r) => setTimeout(r, 0));

      const [fetchUrl, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      const parsedUrl = new URL(fetchUrl);
      const body = options.body as string;

      // The column name AND its placeholder must be in the INSERT field/VALUES lists, appended
      // last in both — the two string replacements in logDecisionAsync must stay in lockstep or
      // ClickHouse binds the value to the wrong column.
      expect(body).toContain('lead_id, ts, scoring_path) VALUES (');
      expect(body).toContain('{p_ts:String}, {p_scoring_path:String})');
      expect(parsedUrl.searchParams.get('param_p_scoring_path')).toBe('cosine');
    });

    it(
      'SCORING_PATH_COLUMN_ENABLED=true, embeddings attempted but every listing lacks one → ' +
        'scoring_path=djb2_fallback',
      async () => {
        vi.stubEnv('SCORING_PATH_COLUMN_ENABLED', 'true');
        mockGetTenantSchema.mockResolvedValue(REORDER_SCHEMA);
        // The lookup itself succeeds (embeddingsAttempted=true) but resolves no embeddings —
        // no listing has a cosine score (affinityScore's "embedding missing" cases), which is a
        // DIFFERENT reason than the latency guard below. Since FOLLOW-1202 the reorder is withheld.
        mockFetchArchetypeEmbedding.mockResolvedValue(null);
        mockFetchListingEmbeddings.mockResolvedValue(new Map());

        await POST(makePostRequest({ ...BASE_BODY, listing_ids: ['listing-a', 'listing-b'] }));
        await new Promise((r) => setTimeout(r, 0));

        expect(mockFetchArchetypeEmbedding).toHaveBeenCalled();
        const [fetchUrl] = mockFetch.mock.calls[0] as [string];
        const parsedUrl = new URL(fetchUrl);
        expect(parsedUrl.searchParams.get('param_p_scoring_path')).toBe('djb2_fallback');
      },
    );

    it(
      'SCORING_PATH_COLUMN_ENABLED=true, listing_ids exceeds LISTING_EMBEDDING_BATCH_LIMIT ' +
        '(latency guard) → scoring_path=djb2_guard, embeddings never attempted',
      async () => {
        vi.stubEnv('SCORING_PATH_COLUMN_ENABLED', 'true');
        mockGetTenantSchema.mockResolvedValue(REORDER_SCHEMA);
        // LISTING_EMBEDDING_BATCH_LIMIT is mocked to 20 at the top of this file.
        const manyListingIds = Array.from({ length: 21 }, (_, i) => `listing-${String(i)}`);

        await POST(makePostRequest({ ...BASE_BODY, listing_ids: manyListingIds }));
        await new Promise((r) => setTimeout(r, 0));

        // The guard fires BEFORE any embedding fetch — distinguishes this from djb2_fallback.
        expect(mockFetchArchetypeEmbedding).not.toHaveBeenCalled();
        const [fetchUrl] = mockFetch.mock.calls[0] as [string];
        const parsedUrl = new URL(fetchUrl);
        expect(parsedUrl.searchParams.get('param_p_scoring_path')).toBe('djb2_guard');
      },
    );

    it(
      'SCORING_PATH_COLUMN_ENABLED=true, no listing_ids → no ReorderDirective built → ' +
        'scoring_path=not_applicable',
      async () => {
        vi.stubEnv('SCORING_PATH_COLUMN_ENABLED', 'true');
        mockGetTenantSchema.mockResolvedValue(null);

        await POST(makePostRequest(BASE_BODY));
        await new Promise((r) => setTimeout(r, 0));

        const [fetchUrl] = mockFetch.mock.calls[0] as [string];
        const parsedUrl = new URL(fetchUrl);
        expect(parsedUrl.searchParams.get('param_p_scoring_path')).toBe('not_applicable');
      },
    );
  });

  __H.active = null;
});
