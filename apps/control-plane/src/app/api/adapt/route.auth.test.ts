/**
 * `POST /api/adapt` — stage: AUTH and request validation.
 *
 * Who may call the route and with what: the demo-mode HS256 JWT (FOLLOW-205) and its runtime
 * revocation (FOLLOW-636), the tenant API key via `resolveApiKey` with its origin verdicts
 * (FOLLOW-451 / FOLLOW-943 / FOLLOW-957), the tenant always derived server-side, and the Zod body
 * validation that runs before anything else.
 *
 * FOLLOW-1287 merged the per-ticket suites below into this one file, one `describe` per original
 * file, every test kept verbatim (see the registry note under the imports for how their differing
 * mocks coexist).
 *
 * @module apps/control-plane/src/app/api/adapt/route.auth.test
 */
import { describe, expect, it, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { getDemoOverride } from '@/lib/demo-override-store';
import { callLlmGateway } from '@/lib/llm-gateway';
import { NextRequest } from 'next/server';
import { z } from 'zod';
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

vi.mock('@/lib/llm-gateway', async (importOriginal) =>
  __H.proxy('@/lib/llm-gateway', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@estalara/auth', async (importOriginal) =>
  __H.proxy('@estalara/auth', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/demo-jwt-verify', async (importOriginal) =>
  __H.proxy('@/lib/demo-jwt-verify', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/bandit-query', async (importOriginal) =>
  __H.proxy('@/lib/bandit-query', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/embedding-lookup', async (importOriginal) =>
  __H.proxy('@/lib/embedding-lookup', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/rag-retrieval', async (importOriginal) =>
  __H.proxy('@/lib/rag-retrieval', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/tenant-schema', async (importOriginal) =>
  __H.proxy('@/lib/tenant-schema', await importOriginal<Record<string, unknown>>()),
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
vi.mock('@estalara/shared', async (importOriginal) =>
  __H.proxy('@estalara/shared', await importOriginal<Record<string, unknown>>()),
);

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.test.ts (+POST /api/adapt — auth gate|POST /api/adapt — Zod validation)
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.test.ts — Tests for POST /api/adapt — Decision API real logic.', () => {
  /**
   * Tests for POST /api/adapt — Decision API real logic.
   *
   * Coverage:
   *   - Decision tree: all 4 branches (with and without LLM gateway), and their edges
   *   - AdaptationDirectives shape validation
   *   - LLM gateway integration (mocked), incl. the FOLLOW-1056 `fallback_reason`
   *   - POST: auth surface, Zod validation, 200 with AdaptationDirectives, ReorderDirective,
   *     page_context derived from page_type
   *
   * FOLLOW-1287 retired `GET /api/adapt`. The decision-tree, schema, integration, gateway and
   * FOLLOW-1056 cases were written against GET's query string; they now drive POST with the same
   * values through `makeRequest()` below, assertions unchanged. The GET-only cases left with the
   * handler: its auth gate (`resolveAdaptGetAuth`; the helper stays covered by
   * `description/route.follow473.test.ts` and `lib/__tests__/adapt-get-auth.parity.test.ts`), its
   * query-string validation (POST's Zod validation is covered below) and the `tier` echo.
   */

  const __reg = new Map<string, Record<string, unknown>>();
  // Mock the LLM gateway module — by default returns null (no API key in test env)
  __reg.set(
    '@/lib/llm-gateway',
    (() => ({
      callLlmGateway: vi.fn().mockResolvedValue(null),
    }))(),
  );
  // Mock @estalara/auth — getAuthClaims returns null
  __reg.set(
    '@estalara/auth',
    (() => ({
      getAuthClaims: vi.fn().mockResolvedValue(null),
    }))(),
  );
  // Bypass demo JWT verification for non-auth tests (FOLLOW-205).
  // Full auth path is exercised in route.demo-auth.test.ts.
  __reg.set(
    '@/lib/demo-jwt-verify',
    (() => ({
      verifyDemoJwt: vi.fn().mockResolvedValue({}),
      DemoJwtSecretMissingError: class DemoJwtSecretMissingError extends Error {},
      DemoJwtInvalidError: class DemoJwtInvalidError extends Error {},
    }))(),
  );
  // Mock bandit-query — POST handler now calls getBanditArms (FOLLOW-007)
  // FOLLOW-397: include SEED_VARIANTS so VARIANT_INDEX is derived correctly at module load.
  __reg.set(
    '@/lib/bandit-query',
    (() => ({
      SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
      getBanditArms: vi.fn().mockResolvedValue([
        { variant: 'control', alpha: 1, beta: 1, paused: false },
        { variant: 'v1', alpha: 1, beta: 1, paused: false },
        { variant: 'v2', alpha: 1, beta: 1, paused: false },
      ]),
    }))(),
  );
  // FOLLOW-1202: `reorder` is served only on an all-cosine batch. The defaults (no embeddings) are
  // what the unmocked lookup resolved to here before — it fails open without a database — and the
  // ReorderDirective block below supplies embeddings where it expects a reorder.
  __reg.set(
    '@/lib/embedding-lookup',
    (() => {
      const actual = __H.real('@/lib/embedding-lookup');
      return {
        ...actual,
        fetchArchetypeEmbedding: vi.fn().mockResolvedValue(null),
        fetchListingEmbeddings: vi.fn().mockResolvedValue(new Map()),
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

  const mockCallLlmGateway = vi.mocked(callLlmGateway);

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  async function parseBody<T>(res: Response): Promise<T> {
    const raw: unknown = await res.json();
    return raw as T;
  }

  // ─── Zod schema for AdaptationDirectives ─────────────────────────────────────

  const TextDirectiveSchema = z.object({
    type: z.literal('text'),
    slot: z.string(),
    value: z.string(),
    archetype: z.string(),
    confidence: z.number().min(0).max(1),
  });

  const ClassDirectiveSchema = z.object({
    type: z.literal('class'),
    selector: z.string(),
    add: z.array(z.string()),
    remove: z.array(z.string()),
    archetype: z.string(),
    confidence: z.number().min(0).max(1),
  });

  const ReorderDirectiveSchema = z.object({
    type: z.literal('reorder'),
    container_selector: z.string(),
    item_selector: z.string(),
    score_function: z.literal('archetype_affinity'),
    scores: z.array(z.object({ listing_id: z.string(), score: z.number() })),
    pin_top_n: z.number().optional(),
    archetype: z.string(),
    confidence: z.number().min(0).max(1),
  });

  const AdaptationDirectivesSchema = z.object({
    session_id: z.string(),
    archetype: z.string(),
    confidence: z.number().min(0).max(1),
    similarity: z.number().min(0).max(1),
    page_context: z.union([z.literal(1), z.literal(2)]).optional(),
    directives: z.array(
      z.union([TextDirectiveSchema, ClassDirectiveSchema, ReorderDirectiveSchema]),
    ),
    source: z.enum([
      'playbook',
      'llm_tweaked',
      'llm_full',
      'default',
      'playbook_fallback_llm_capped',
      'playbook_fallback_llm_unavailable',
    ]),
    generated_at: z.string().datetime(),
  });

  // ─── Unit: decision tree branches (gateway mocked to return null) ─────────────

  // ─── Unit: decision tree branches (gateway returns directives) ─────────────────

  // ─── Unit: AdaptationDirectives Zod schema validation ────────────────────────

  // ─── Integration: valid request → correct AdaptationDirectives ────────────

  // ─── LLM gateway unit tests ───────────────────────────────────────────────────

  // ─── POST /api/adapt — demo-mode endpoint ────────────────────────────────────

  const VALID_POST_BODY = {
    tenant_id: 'est_demo_tenant',
    session_id: 'sess-post-001',
    page_type: 'listing_list' as const,
    archetype_hint: 'yield_hunter',
    confidence: 0.8,
    similarity: 0.9,
  };

  function makePostRequest(body: Record<string, unknown>, authHeader?: string): NextRequest {
    return new NextRequest('http://localhost/api/adapt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(authHeader !== undefined ? { Authorization: authHeader } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  describe('POST /api/adapt — auth gate (FOLLOW-205: JWT verification; verifyDemoJwt mocked)', () => {
    // NOTE: verifyDemoJwt is mocked globally in this file (see top-level vi.mock).
    // Full cryptographic auth coverage (invalid JWT, expired JWT, wrong secret) is
    // in route.demo-auth.test.ts. These tests cover the HTTP surface (missing header →
    // 401) and the downstream happy path with auth bypassed for isolation.
    beforeEach(() => {
      mockCallLlmGateway.mockClear();
      mockCallLlmGateway.mockResolvedValue(null);
    });

    it('missing Authorization header → 401 invalid_demo_token', async () => {
      const res = await POST(makePostRequest(VALID_POST_BODY));
      expect(res.status).toBe(401);
      const body = await parseBody<{ error: string }>(res);
      expect(body.error).toBe('invalid_demo_token');
    });

    it('empty Bearer token → 401 invalid_demo_token', async () => {
      const res = await POST(makePostRequest(VALID_POST_BODY, 'Bearer '));
      expect(res.status).toBe(401);
      const body = await parseBody<{ error: string }>(res);
      expect(body.error).toBe('invalid_demo_token');
    });

    it('Authorization: Bearer <token> (verifyDemoJwt passes) → 200 with AdaptationDirectives', async () => {
      const res = await POST(makePostRequest(VALID_POST_BODY, 'Bearer demo_key'));
      expect(res.status).toBe(200);
      const body = await parseBody<unknown>(res);
      const parsed = AdaptationDirectivesSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.session_id).toBe('sess-post-001');
        expect(parsed.data.archetype).toBe('yield_hunter');
        expect(parsed.data.source).toBe('playbook'); // high similarity → playbook
      }
    });
  });

  describe('POST /api/adapt — Zod validation', () => {
    beforeEach(() => {
      mockCallLlmGateway.mockClear();
      mockCallLlmGateway.mockResolvedValue(null);
    });

    it('missing tenant_id → 400', async () => {
      const noTenant = {
        session_id: VALID_POST_BODY.session_id,
        page_type: VALID_POST_BODY.page_type,
      };
      const res = await POST(makePostRequest(noTenant, 'Bearer demo_key'));
      expect(res.status).toBe(400);
      const body = await parseBody<{ error: string }>(res);
      expect(body.error).toContain('Validation failed');
    });

    it('missing session_id → 400', async () => {
      const noSession = {
        tenant_id: VALID_POST_BODY.tenant_id,
        page_type: VALID_POST_BODY.page_type,
      };
      const res = await POST(makePostRequest(noSession, 'Bearer demo_key'));
      expect(res.status).toBe(400);
    });

    it('invalid page_type → 400', async () => {
      const res = await POST(
        makePostRequest({ ...VALID_POST_BODY, page_type: 'invalid_type' }, 'Bearer demo_key'),
      );
      expect(res.status).toBe(400);
    });

    it('confidence out of range → 400', async () => {
      const res = await POST(
        makePostRequest({ ...VALID_POST_BODY, confidence: 1.5 }, 'Bearer demo_key'),
      );
      expect(res.status).toBe(400);
    });

    it('similarity out of range → 400', async () => {
      const res = await POST(
        makePostRequest({ ...VALID_POST_BODY, similarity: -0.1 }, 'Bearer demo_key'),
      );
      expect(res.status).toBe(400);
    });
  });

  // ─── POST /api/adapt — ReorderDirective ──────────────────────────────────────

  // ─── POST /api/adapt — page_context derived from page_type (FOLLOW-357 / FOLLOW-356) ──

  // ─── FOLLOW-1056: the fallback REASON reaches the response body ───────────────

  __H.active = null;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.demo-auth.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.demo-auth.test.ts — Auth hardening tests for POST /api/adapt — FOLLOW-205.', () => {
  /**
   * Auth hardening tests for POST /api/adapt — FOLLOW-205.
   *
   * Verifies that the demo-mode endpoint performs real HS256 JWT verification
   * rather than a presence-only Bearer check. Coverage:
   *
   *   AC1: Arbitrary non-empty Bearer string (not a valid JWT) → 401
   *          with JSON body { error: 'invalid_demo_token' }
   *   AC2: Valid JWT signed by DEMO_MODE_JWT_SECRET → proceeds normally (200)
   *   AC3: Expired JWT (exp in the past) → 401
   *          with JSON body { error: 'invalid_demo_token' }
   *
   * Test strategy: stub DEMO_MODE_JWT_SECRET via vi.stubEnv, generate real
   * HS256 JWTs using crypto.subtle (Web Crypto API, available in Node 15+),
   * and import the POST handler without mocking verifyDemoJwt so the full
   * auth path runs end-to-end.
   *
   * All other external dependencies are mocked so the test does not require
   * a live database, ClickHouse, Redis, or LLM connection.
   *
   * @module apps/control-plane/src/app/api/adapt/route.demo-auth.test
   */

  const __reg = new Map<string, Record<string, unknown>>();
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

  // ─── Mock external dependencies (not under test here) ─────────────────────────

  // NOTE: verifyDemoJwt is NOT mocked here — we test the full auth path.

  // ─── JWT helpers ──────────────────────────────────────────────────────────────

  const TEST_SECRET = 'test-demo-secret-at-least-32-chars-long!!';

  /** Base64url-encode a Uint8Array. */
  function toBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  /** Encode a JSON object as base64url. */
  function encodeSegment(obj: Record<string, unknown>): string {
    const json = JSON.stringify(obj);
    const encoder = new TextEncoder();
    const bytes = encoder.encode(json);
    return toBase64Url(bytes);
  }

  /**
   * Build a real HS256 JWT signed with TEST_SECRET.
   * `expOffsetSeconds` is relative to now: positive = expires in future, negative = already expired.
   */
  async function buildJwt(
    expOffsetSeconds: number,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const header = encodeSegment({ alg: 'HS256', typ: 'JWT' });
    const nowSecs = Math.floor(Date.now() / 1000);
    const payload = encodeSegment({
      sub: 'demo',
      iat: nowSecs,
      exp: nowSecs + expOffsetSeconds,
      ...extra,
    });

    const signingInput = `${header}.${payload}`;
    const keyMaterial = new TextEncoder().encode(TEST_SECRET);
    const key = await crypto.subtle.importKey(
      'raw',
      keyMaterial,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signatureBuffer = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(signingInput),
    );
    const signature = toBase64Url(new Uint8Array(signatureBuffer));

    return `${signingInput}.${signature}`;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  const TENANT_ID = '550e8400-e29b-41d4-a716-446655440001';

  const BASE_BODY = {
    tenant_id: TENANT_ID,
    session_id: 'sess-auth-test-001',
    page_type: 'listing_detail',
    archetype_hint: 'neutral',
    confidence: 0.5,
    similarity: 0.5,
  };

  function makePostRequest(body: Record<string, unknown>, authHeader: string): NextRequest {
    return new NextRequest('http://localhost/api/adapt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
    });
  }

  // ─── Tests ────────────────────────────────────────────────────────────────────

  describe('POST /api/adapt — demo JWT auth hardening (FOLLOW-205)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.stubEnv('CLICKHOUSE_URL', '');
      vi.stubEnv('DEMO_MODE_JWT_SECRET', TEST_SECRET);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('AC1: arbitrary non-empty Bearer string (not a JWT) → 401 invalid_demo_token', async () => {
      const res = await POST(makePostRequest(BASE_BODY, 'Bearer not-a-jwt-at-all'));

      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('invalid_demo_token');
    });

    it('AC1: missing Authorization header → 401 invalid_demo_token', async () => {
      const req = new NextRequest('http://localhost/api/adapt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(BASE_BODY),
      });

      const res = await POST(req);

      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('invalid_demo_token');
    });

    it('AC2: valid JWT signed by DEMO_MODE_JWT_SECRET → 200', async () => {
      const token = await buildJwt(3600); // expires in 1 hour

      const res = await POST(makePostRequest(BASE_BODY, `Bearer ${token}`));

      expect(res.status).toBe(200);
    });

    it('AC2: JWT signed by wrong secret → 401 invalid_demo_token', async () => {
      // Build JWT with a different secret than what is configured
      const wrongSecretHeader = encodeSegmentDirect({ alg: 'HS256', typ: 'JWT' });
      const nowSecs = Math.floor(Date.now() / 1000);
      const wrongSecretPayload = encodeSegmentDirect({
        sub: 'demo',
        iat: nowSecs,
        exp: nowSecs + 3600,
      });
      const wrongKeyMaterial = new TextEncoder().encode('wrong-secret-32chars-long-enough!');
      const wrongKey = await crypto.subtle.importKey(
        'raw',
        wrongKeyMaterial,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
      );
      const wrongSigBuffer = await crypto.subtle.sign(
        'HMAC',
        wrongKey,
        new TextEncoder().encode(`${wrongSecretHeader}.${wrongSecretPayload}`),
      );
      const wrongSig = toBase64Url(new Uint8Array(wrongSigBuffer));
      const wrongToken = `${wrongSecretHeader}.${wrongSecretPayload}.${wrongSig}`;

      const res = await POST(makePostRequest(BASE_BODY, `Bearer ${wrongToken}`));

      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('invalid_demo_token');
    });

    it('AC3: expired JWT → 401 invalid_demo_token', async () => {
      const token = await buildJwt(-60); // expired 60 seconds ago

      const res = await POST(makePostRequest(BASE_BODY, `Bearer ${token}`));

      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('invalid_demo_token');
    });

    it('missing DEMO_MODE_JWT_SECRET → 500 demo_auth_misconfigured', async () => {
      vi.stubEnv('DEMO_MODE_JWT_SECRET', '');

      const res = await POST(makePostRequest(BASE_BODY, 'Bearer some-token'));

      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('demo_auth_misconfigured');
    });

    it('FOLLOW-260: JWT tenant_id supersedes body tenant_id (cross-tenant escalation blocked)', async () => {
      const jwtTenantId = '550e8400-e29b-41d4-a716-446655440099';
      const bodyTenantId = '550e8400-e29b-41d4-a716-446655440001';
      expect(jwtTenantId).not.toBe(bodyTenantId);

      const token = await buildJwt(3600, { tenant_id: jwtTenantId });

      const body = { ...BASE_BODY, tenant_id: bodyTenantId };
      const res = await POST(makePostRequest(body, `Bearer ${token}`));

      expect(res.status).toBe(200);
      // getDemoOverride must have been called with the JWT tenant, not the body tenant.
      const mockGetDemoOverride = vi.mocked(getDemoOverride);
      expect(mockGetDemoOverride).toHaveBeenCalledWith(jwtTenantId);
      expect(mockGetDemoOverride).not.toHaveBeenCalledWith(bodyTenantId);
    });
  });

  // ─── Internal duplicate for wrong-secret test (avoids circular import) ────────

  function encodeSegmentDirect(obj: Record<string, unknown>): string {
    const json = JSON.stringify(obj);
    const encoder = new TextEncoder();
    const bytes = encoder.encode(json);
    let binary = '';
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  __H.active = null;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.follow451.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.follow451.test.ts — Auth-matrix tests for POST /api/adapt — FOLLOW-451 (audit F-05).', () => {
  /**
   * Auth-matrix tests for POST /api/adapt — FOLLOW-451 (audit F-05).
   *
   * CEO Q1 (2026-07-02): POST /api/adapt must accept EITHER a demo-mode HS256
   * JWT (DEMO_MODE_JWT_SECRET, pre-existing FOLLOW-205/260 path — see
   * route.demo-auth.test.ts, unmodified by this ticket) OR a real tenant API
   * key resolved via the shared `resolveApiKey()` (ADR-0015). Before this fix,
   * a real tenant key always 401'd against `verifyDemoJwt` with no fallback,
   * and the SDK (`packages/sdk/src/core/adapt.ts`) fails open to
   * `{ adaptResponse: null }` on any non-2xx response — i.e. every non-demo
   * tenant silently received zero adaptation.
   *
   * Coverage (ticket AC5 test matrix):
   *   - Real, registered, non-revoked/non-expired API key + matching
   *     body.tenant_id → 200 with a populated AdaptationDirectives body (not
   *     the previous 401 → SDK null).
   *   - Real API key + mismatched body.tenant_id → 403 (parity with
   *     POST /api/adapt/feedback, ADR-0015 Step 7).
   *   - Bearer token that is neither a valid demo JWT nor a registered API key
   *     → 401.
   *   - Revoked API key → 401 (resolveApiKey's WHERE revoked_at IS NULL filter).
   *   - DEMO_MODE_JWT_SECRET missing → still 500 (demo path is NOT bypassed by
   *     the API-key fallback; unchanged pre-existing contract).
   *
   * The existing demo-JWT auth suite (route.demo-auth.test.ts) is NOT modified
   * by this ticket and remains the regression guard for the demo path.
   *
   * @module apps/control-plane/src/app/api/adapt/route.follow451.test
   */

  const { mockSelectLimit } = (() => ({
    mockSelectLimit: vi.fn().mockResolvedValue([]),
  }))();
  const __reg = new Map<string, Record<string, unknown>>();
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
  __reg.set(
    '@estalara/db',
    (() => ({
      createAdminClient: vi.fn(() => ({
        select: vi.fn().mockReturnThis(),
        from: vi.fn().mockReturnThis(),
        where: vi.fn().mockReturnThis(),
        limit: mockSelectLimit,
      })),
      tenants: {},
      apiKeys: {
        tenantId: 'tenant_id',
        hashedKey: 'hashed_key',
        revokedAt: 'revoked_at',
        expiresAt: 'expires_at',
      },
    }))(),
  );
  __reg.set(
    'drizzle-orm',
    (() => ({
      and: vi.fn((...preds: unknown[]) => ({ kind: 'and', preds })),
      eq: vi.fn((col: unknown, val: unknown) => ({ kind: 'eq', col, val })),
      isNull: vi.fn((col: unknown) => ({ kind: 'isNull', col })),
      or: vi.fn((...preds: unknown[]) => ({ kind: 'or', preds })),
      gt: vi.fn((col: unknown, val: unknown) => ({ kind: 'gt', col, val })),
    }))(),
  );
  __H.active = __reg;
  beforeAll(() => {
    __H.active = __reg;
  });
  afterAll(() => {
    __H.active = null;
  });

  // ─── Mock external dependencies (not under test here) ─────────────────────────

  // ─── @estalara/db mock — controllable api_keys lookup for resolveApiKey() ────
  //
  // A single shared `mockSelectLimit` backs every `db.select().from().where().limit()`
  // call site (resolveApiKey's api_keys lookup AND checkPilotFrozenAsync's tenants
  // lookup, which runs fire-and-forget). Tests set the resolved value to a fake
  // api_keys row; checkPilotFrozenAsync destructures unrelated fields
  // (`pilotFrozen`/`quizEnabled`) off that same row, which are simply `undefined`
  // for an api_keys row → the guard no-ops, matching the "no-op when absent" spec.

  // NOTE: verifyDemoJwt and resolveApiKey are NOT mocked — the full auth path
  // (both branches) runs end-to-end, same testing philosophy as
  // route.demo-auth.test.ts.

  // ─── Crypto helper — SHA-256(rawKey) mirrors api-key-auth.ts ─────────────────

  async function sha256Hex(input: string): Promise<string> {
    const enc = new TextEncoder();
    const buf = await crypto.subtle.digest('SHA-256', enc.encode(input));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  async function makeApiKeyRow(rawApiKey: string, tenantId: string) {
    return { tenantId, hashedKey: await sha256Hex(rawApiKey) };
  }

  // ─── Request helpers ──────────────────────────────────────────────────────────

  const TENANT_A = '550e8400-e29b-41d4-a716-446655440001';
  const TENANT_B = '550e8400-e29b-41d4-a716-446655440099';
  const VALID_API_KEY = 'sk_live_test_tenant_a_key';

  function baseBody(tenantId: string): Record<string, unknown> {
    return {
      tenant_id: tenantId,
      session_id: 'sess-follow451-001',
      page_type: 'listing_detail',
      archetype_hint: 'neutral',
      confidence: 0.5,
      similarity: 0.5,
    };
  }

  function makePostRequest(
    body: Record<string, unknown>,
    authHeader: string | null,
    origin?: string,
  ): NextRequest {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (authHeader !== null) headers.Authorization = authHeader;
    // [FOLLOW-943] The origin gate short-circuits when there is no `Origin`, so a browser-shaped
    // request is the only way to reach it. Every case above deliberately sends none — they are
    // server-side callers and must stay on the ungated path.
    if (origin !== undefined) headers.Origin = origin;
    return new NextRequest('http://localhost/api/adapt', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  // ─── Tests ────────────────────────────────────────────────────────────────────

  describe('POST /api/adapt — real tenant API-key auth path (FOLLOW-451, audit F-05)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockSelectLimit.mockReset().mockResolvedValue([]);
      vi.stubEnv('CLICKHOUSE_URL', '');
      vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
      // No DEMO_MODE_JWT_SECRET in this describe block — the bearer token under
      // test is never a JWT-shaped string, so verifyDemoJwt throws
      // DemoJwtInvalidError (not DemoJwtSecretMissingError) and the handler
      // falls through to the API-key path. See the dedicated
      // DEMO_MODE_JWT_SECRET-missing test below for that orthogonal case.
      vi.stubEnv('DEMO_MODE_JWT_SECRET', 'unrelated-demo-secret-32-chars-long!!');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('valid registered API key + matching body.tenant_id → 200 with populated directives (not 401 → SDK null)', async () => {
      const keyRow = await makeApiKeyRow(VALID_API_KEY, TENANT_A);
      mockSelectLimit.mockResolvedValue([keyRow]);

      const res = await POST(makePostRequest(baseBody(TENANT_A), `Bearer ${VALID_API_KEY}`));

      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      // Proves this is a real AdaptationDirectives payload, not the SDK's
      // `{ adaptResponse: null }` fail-open shape that resulted from the
      // pre-fix 401.
      expect(body.session_id).toBe('sess-follow451-001');
      expect(Array.isArray(body.directives)).toBe(true);
      expect(typeof body.archetype).toBe('string');
      expect(typeof body.adapt_decision_id).toBe('string');
    });

    it('valid registered API key + mismatched body.tenant_id → 403 (parity with feedback/route.ts)', async () => {
      const keyRow = await makeApiKeyRow(VALID_API_KEY, TENANT_A);
      mockSelectLimit.mockResolvedValue([keyRow]);

      const res = await POST(makePostRequest(baseBody(TENANT_B), `Bearer ${VALID_API_KEY}`));

      expect(res.status).toBe(403);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('FORBIDDEN');
    });

    it('unknown bearer (neither a demo JWT nor a registered API key) → 401', async () => {
      // api_keys lookup returns no rows for any bearer.
      mockSelectLimit.mockResolvedValue([]);

      const res = await POST(makePostRequest(baseBody(TENANT_A), 'Bearer not-a-jwt-not-a-key'));

      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('invalid_demo_token');
    });

    it('revoked API key (excluded by resolveApiKey WHERE revoked_at IS NULL) → 401', async () => {
      // The mocked query chain does not evaluate WHERE predicates — it models the
      // filtered-out-by-SQL outcome directly by resolving no rows, exactly as a
      // real Postgres query would for a revoked key.
      mockSelectLimit.mockResolvedValue([]);

      const res = await POST(makePostRequest(baseBody(TENANT_A), `Bearer ${VALID_API_KEY}`));

      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('invalid_demo_token');
    });

    // ── FOLLOW-943: an ORIGIN refusal is not an auth failure ────────────────────────────────
    //
    // Before this, `POST /api/adapt` answered `401 invalid_demo_token` to a caller holding a VALID
    // API key that was refused for its DOMAIN — an answer naming a JWT the caller never presented.
    // These cases assert the route's own response, which is the thing that was wrong; asserting
    // `resolveOriginDecision` would have stayed green throughout (Rule AU).

    it('FOLLOW-943: valid key, disallowed origin → 403 forbidden_origin, NOT 401 invalid_demo_token', async () => {
      vi.stubEnv('FIRST_PARTY_TENANT_ID', TENANT_A);
      mockSelectLimit
        .mockResolvedValueOnce([{ tenantId: TENANT_A, hashedKey: await sha256Hex(VALID_API_KEY) }])
        .mockResolvedValueOnce([{ allowedOrigins: ['https://homes.clientbrand.com'] }]);

      const res = await POST(
        makePostRequest(baseBody(TENANT_A), `Bearer ${VALID_API_KEY}`, 'https://evil.example.com'),
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('forbidden_origin');
    });

    it('FOLLOW-957: valid key, unresolvable first party → 403 first_party_unverified', async () => {
      // The lockout shape: a correct key, a platform origin, and an environment that cannot say
      // whether this tenant IS the first party. Distinguishable from the case above by design.
      vi.stubEnv('FIRST_PARTY_TENANT_ID', '');
      mockSelectLimit
        .mockResolvedValueOnce([{ tenantId: TENANT_A, hashedKey: await sha256Hex(VALID_API_KEY) }])
        .mockResolvedValueOnce([{ allowedOrigins: ['https://homes.clientbrand.com'] }]);

      const res = await POST(
        makePostRequest(baseBody(TENANT_A), `Bearer ${VALID_API_KEY}`, 'https://app.estalara.com'),
      );

      expect(res.status).toBe(403);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('first_party_unverified');
    });

    it('resolveApiKey DB error (configured-but-failed, Rule K.2) → 401, never fabricates a tenant', async () => {
      mockSelectLimit.mockRejectedValueOnce(new Error('connection refused'));

      const res = await POST(makePostRequest(baseBody(TENANT_A), `Bearer ${VALID_API_KEY}`));

      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('invalid_demo_token');
    });
  });

  describe('POST /api/adapt — DEMO_MODE_JWT_SECRET missing is NOT bypassed by the API-key fallback', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockSelectLimit.mockReset().mockResolvedValue([]);
      vi.stubEnv('CLICKHOUSE_URL', '');
      vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
      vi.stubEnv('DEMO_MODE_JWT_SECRET', '');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('DEMO_MODE_JWT_SECRET unset + a real API key bearer → still 500 demo_auth_misconfigured', async () => {
      const keyRow = await makeApiKeyRow(VALID_API_KEY, TENANT_A);
      mockSelectLimit.mockResolvedValue([keyRow]);

      const res = await POST(makePostRequest(baseBody(TENANT_A), `Bearer ${VALID_API_KEY}`));

      // Unchanged pre-existing contract (route.demo-auth.test.ts): a missing
      // demo secret is treated as a deployment misconfiguration and never falls
      // through to the API-key path, regardless of whether the bearer would
      // otherwise resolve to a valid tenant key.
      expect(res.status).toBe(500);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('demo_auth_misconfigured');
    });
  });

  __H.active = null;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.follow636.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.follow636.test.ts — FOLLOW-636 — end-to-end enforcement of demo-session revocation on POST /api/adapt.', () => {
  /**
   * FOLLOW-636 — end-to-end enforcement of demo-session revocation on POST /api/adapt.
   *
   * Proves the runtime gap is closed at the ACTUAL adapt demo-JWT path (not just in
   * the unit helper): a demo token whose signature + `exp` are perfectly valid is
   * STILL refused once its `demo_sessions.revoked_at` is set. Coverage:
   *
   *   1. Signature-valid demo JWT, session row NOT revoked → 200 (serves).
   *   2. Signature-valid demo JWT, session row revoked      → 401 invalid_demo_token.
   *   3. Signature-valid demo JWT, revocation lookup THROWS  → 200 (fail-open — a DB
   *      blip must not break a legitimate live demo; signature+exp stayed fail-closed).
   *
   * Test strategy mirrors route.demo-auth.test.ts: stub DEMO_MODE_JWT_SECRET, mint a
   * REAL HS256 JWT carrying `session_id`, and drive the full POST handler with a
   * controllable createAdminClient so the demo_sessions row (and its throw) is
   * exercised through the real code path — verifyDemoJwt is NOT mocked.
   *
   * @module apps/control-plane/src/app/api/adapt/route.follow636.test
   */

  // ─── Controllable service-role DB (shared by resolveDemoSessionRevocation + resolveAlEnablement) ──
  const { dbRef, createAdminClientMock } = (() => {
    const ref: { rows: unknown[]; throwOnQuery: boolean } = { rows: [], throwOnQuery: false };
    const builder = {
      select: () => builder,
      from: () => builder,
      where: () => builder,
      limit: () => {
        if (ref.throwOnQuery)
          return Promise.reject(new Error('simulated demo_sessions DB failure'));
        return Promise.resolve(ref.rows);
      },
    };
    return { dbRef: ref, createAdminClientMock: vi.fn(() => builder) };
  })();
  const __reg = new Map<string, Record<string, unknown>>();
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
      createAdminClient: createAdminClientMock,
      tenants: { id: 'id', alEnabled: 'al_enabled', status: 'status' },
      demoSessions: { id: 'id', revokedAt: 'revoked_at' },
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

  // ─── Mock external dependencies (not under test here) ─────────────────────────

  // verifyDemoJwt + resolveDemoSessionRevocation are NOT mocked — full path runs.

  // ─── JWT helpers ──────────────────────────────────────────────────────────────

  const TEST_SECRET = 'test-demo-secret-at-least-32-chars-long!!';

  function toBase64Url(bytes: Uint8Array): string {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  function encodeSegment(obj: Record<string, unknown>): string {
    return toBase64Url(new TextEncoder().encode(JSON.stringify(obj)));
  }

  async function buildDemoJwt(extra: Record<string, unknown>): Promise<string> {
    const header = encodeSegment({ alg: 'HS256', typ: 'JWT' });
    const nowSecs = Math.floor(Date.now() / 1000);
    const payload = encodeSegment({ sub: 'demo', iat: nowSecs, exp: nowSecs + 3600, ...extra });
    const signingInput = `${header}.${payload}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(TEST_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signingInput));
    return `${signingInput}.${toBase64Url(new Uint8Array(sig))}`;
  }

  const TENANT_ID = '550e8400-e29b-41d4-a716-446655440001';
  const SESSION_ID = '22222222-2222-2222-2222-222222222222';

  const BASE_BODY = {
    tenant_id: TENANT_ID,
    session_id: 'sess-runtime-001',
    page_type: 'listing_detail',
    archetype_hint: 'neutral',
    confidence: 0.5,
    similarity: 0.5,
  };

  function makePostRequest(authHeader: string): NextRequest {
    return new NextRequest('http://localhost/api/adapt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify(BASE_BODY),
    });
  }

  // ─── Tests ────────────────────────────────────────────────────────────────────

  describe('POST /api/adapt — demo-session revocation enforcement (FOLLOW-636)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      dbRef.rows = [];
      dbRef.throwOnQuery = false;
      vi.stubEnv('CLICKHOUSE_URL', '');
      vi.stubEnv('DEMO_MODE_JWT_SECRET', TEST_SECRET);
      // "configured" so resolveDemoSessionRevocation runs the query path, not the dev short-circuit.
      vi.stubEnv('DATABASE_URL_ADMIN', 'postgres://test');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('valid demo JWT + NON-revoked session row → 200 (serves)', async () => {
      dbRef.rows = [{ revokedAt: null }];
      const token = await buildDemoJwt({ tenant_id: TENANT_ID, session_id: SESSION_ID });
      const res = await POST(makePostRequest(`Bearer ${token}`));
      expect(res.status).toBe(200);
    });

    it('valid demo JWT + REVOKED session row → 401 invalid_demo_token (runtime cut-off)', async () => {
      dbRef.rows = [{ revokedAt: new Date('2026-07-24T00:00:00Z') }];
      const token = await buildDemoJwt({ tenant_id: TENANT_ID, session_id: SESSION_ID });
      const res = await POST(makePostRequest(`Bearer ${token}`));
      expect(res.status).toBe(401);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error).toBe('invalid_demo_token');
    });

    it('valid demo JWT + revocation lookup THROWS → 200 (fail-open, demo not broken)', async () => {
      dbRef.throwOnQuery = true;
      const token = await buildDemoJwt({ tenant_id: TENANT_ID, session_id: SESSION_ID });
      const res = await POST(makePostRequest(`Bearer ${token}`));
      expect(res.status).toBe(200);
    });
  });

  __H.active = null;
});
