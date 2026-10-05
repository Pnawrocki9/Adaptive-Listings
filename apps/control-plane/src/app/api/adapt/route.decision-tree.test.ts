/**
 * `POST /api/adapt` — stage: the DECISION TREE.
 *
 * What a treatment session is served: the four branches of Master Design E.1 and the ONE LLM call
 * branches 3 and 4 share (characterised byte for byte by `route.llm-call.test.ts`'s cases, merged
 * here), the bandit arm and its copy selection (frozen by default, FOLLOW-1286), locale
 * suppression, demo mode, the chat-intent prior, slot selectors, the response shape and the
 * fail-closed `reorder` directive.
 *
 * FOLLOW-1287 merged the per-ticket suites below into this one file, one `describe` per original
 * file, every test kept verbatim (see the registry note under the imports for how their differing
 * mocks coexist).
 *
 * @module apps/control-plane/src/app/api/adapt/route.decision-tree.test
 */
import { describe, expect, it, vi, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { getBanditArms } from '@/lib/bandit-query';
import { getDemoOverride } from '@/lib/demo-override-store';
import { fetchArchetypeEmbedding, fetchListingEmbeddings } from '@/lib/embedding-lookup';
import { callLlmGateway } from '@/lib/llm-gateway';
import type { LlmGatewayInput } from '@/lib/llm-gateway';
import { getTenantSchema } from '@/lib/tenant-schema';
import { VARIANT_INDEX } from '@/lib/variant-index.js';
import { getPlaybook } from '@estalara/sdk/playbooks';
import type { ArchetypeId } from '@estalara/shared';
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
vi.mock('@/lib/demo-override-store', async (importOriginal) =>
  __H.proxy('@/lib/demo-override-store', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@estalara/sdk/playbooks', async (importOriginal) =>
  __H.proxy('@estalara/sdk/playbooks', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/chat-intent-cache', async (importOriginal) =>
  __H.proxy('@/lib/chat-intent-cache', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@estalara/db', async (importOriginal) =>
  __H.proxy('@estalara/db', await importOriginal<Record<string, unknown>>()),
);
vi.mock('drizzle-orm', async (importOriginal) =>
  __H.proxy('drizzle-orm', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@estalara/shared', async (importOriginal) =>
  __H.proxy('@estalara/shared', await importOriginal<Record<string, unknown>>()),
);
vi.mock('next/server', async (importOriginal) =>
  __H.proxy('next/server', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@sentry/nextjs', async (importOriginal) =>
  __H.proxy('@sentry/nextjs', await importOriginal<Record<string, unknown>>()),
);
vi.mock('@/lib/adapt-get-auth', async (importOriginal) =>
  __H.proxy('@/lib/adapt-get-auth', await importOriginal<Record<string, unknown>>()),
);

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.test.ts (-POST /api/adapt — auth gate|POST /api/adapt — Zod validation)
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

  /**
   * FOLLOW-1287: the cases below were written against the retired GET handler's query string. They
   * now drive POST with the same values: `archetype` → `archetype_hint`, the numbers parsed, and
   * `page_type: 'listing_detail'` so no directive is filtered by page type (GET filtered none).
   */
  function makeRequest(params: Record<string, string>): NextRequest {
    return makePostRequest(
      {
        tenant_id: 'tenant-abc',
        session_id: params.session_id,
        page_type: 'listing_detail',
        archetype_hint: params.archetype,
        confidence: Number(params.confidence),
        similarity: Number(params.similarity),
      },
      'Bearer test_key',
    );
  }

  const VALID_PARAMS = {
    session_id: 'sess-001',
    archetype: 'yield_hunter',
    confidence: '0.75',
    similarity: '0.90',
  };

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

  describe('POST /api/adapt — decision tree branches (gateway null → fallback)', () => {
    beforeEach(() => {
      mockCallLlmGateway.mockClear();
      mockCallLlmGateway.mockResolvedValue(null);
    });

    it('Branch 1: confidence <= 0.6 → source: default, directives: []', async () => {
      const res = await POST(
        makeRequest({
          ...VALID_PARAMS,
          confidence: '0.5',
          similarity: '0.95',
        }),
      );
      expect(res.status).toBe(200);
      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.source).toBe('default');
      expect(Array.isArray(body.directives)).toBe(true);
      expect((body.directives as unknown[]).length).toBe(0);
    });

    it('Branch 1 edge: confidence exactly 0.6 → source: default', async () => {
      const res = await POST(
        makeRequest({
          ...VALID_PARAMS,
          confidence: '0.6',
          similarity: '0.90',
        }),
      );
      expect(res.status).toBe(200);
      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.source).toBe('default');
    });

    it('Branch 2: confidence > 0.6, similarity > 0.85 → source: playbook (no gateway call)', async () => {
      const res = await POST(
        makeRequest({
          ...VALID_PARAMS,
          confidence: '0.75',
          similarity: '0.90',
        }),
      );
      expect(res.status).toBe(200);
      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.source).toBe('playbook');
      expect(Array.isArray(body.directives)).toBe(true);
      // Gateway should NOT be called for high-similarity branch
      expect(mockCallLlmGateway).not.toHaveBeenCalled();
    });

    it('Branch 3: confidence > 0.6, 0.6 < similarity <= 0.85 → calls gateway, falls back to playbook on null', async () => {
      const res = await POST(
        makeRequest({
          ...VALID_PARAMS,
          confidence: '0.80',
          similarity: '0.75',
        }),
      );
      expect(res.status).toBe(200);
      const body = await parseBody<Record<string, unknown>>(res);
      // Gateway returned null → fallback source
      expect(body.source).toBe('playbook_fallback_llm_unavailable');
      expect(Array.isArray(body.directives)).toBe(true);
      expect(mockCallLlmGateway).toHaveBeenCalledOnce();
    });

    it('Branch 3 edge: similarity exactly 0.85 → calls gateway', async () => {
      const res = await POST(
        makeRequest({
          ...VALID_PARAMS,
          confidence: '0.80',
          similarity: '0.85',
        }),
      );
      expect(res.status).toBe(200);
      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.source).toBe('playbook_fallback_llm_unavailable');
      expect(mockCallLlmGateway).toHaveBeenCalledOnce();
    });

    it('Branch 4: confidence > 0.6, similarity <= 0.6 → calls gateway, returns empty directives on null', async () => {
      const res = await POST(
        makeRequest({
          ...VALID_PARAMS,
          confidence: '0.80',
          similarity: '0.45',
        }),
      );
      expect(res.status).toBe(200);
      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.source).toBe('playbook_fallback_llm_unavailable');
      expect(Array.isArray(body.directives)).toBe(true);
      expect(mockCallLlmGateway).toHaveBeenCalledOnce();
    });

    it('Branch 4 edge: similarity exactly 0.6 → calls gateway', async () => {
      const res = await POST(
        makeRequest({
          ...VALID_PARAMS,
          confidence: '0.80',
          similarity: '0.6',
        }),
      );
      expect(res.status).toBe(200);
      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.source).toBe('playbook_fallback_llm_unavailable');
      expect(mockCallLlmGateway).toHaveBeenCalledOnce();
    });
  });

  // ─── Unit: decision tree branches (gateway returns directives) ─────────────────

  describe('POST /api/adapt — decision tree branches (gateway returns directives)', () => {
    const mockDirectives = [
      {
        type: 'text' as const,
        slot: 'headline',
        value: 'Yield-optimized investment',
        archetype: 'yield_hunter' as const,
        confidence: 0.8,
      },
    ];

    beforeEach(() => {
      mockCallLlmGateway.mockClear();
      mockCallLlmGateway.mockResolvedValue({
        directives: mockDirectives,
        model: 'claude-haiku-4-5' as const,
        tokens_in: 200,
        tokens_out: 50,
        cost_usd: 0.0001,
        latency_ms: 300,
      });
    });

    it('Branch 3 with gateway success → source: llm_tweaked, directives from gateway', async () => {
      const res = await POST(
        makeRequest({
          ...VALID_PARAMS,
          confidence: '0.80',
          similarity: '0.75',
        }),
      );
      expect(res.status).toBe(200);
      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.source).toBe('llm_tweaked');
      expect(Array.isArray(body.directives)).toBe(true);
      expect((body.directives as unknown[]).length).toBeGreaterThan(0);
    });

    it('Branch 4 with gateway success → source: llm_full, directives from gateway', async () => {
      const res = await POST(
        makeRequest({
          ...VALID_PARAMS,
          confidence: '0.80',
          similarity: '0.45',
        }),
      );
      expect(res.status).toBe(200);
      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.source).toBe('llm_full');
      expect(Array.isArray(body.directives)).toBe(true);
      expect((body.directives as unknown[]).length).toBeGreaterThan(0);
    });

    it('gateway is called with correct archetypeId and similarity', async () => {
      await POST(
        makeRequest({
          ...VALID_PARAMS,
          archetype: 'family_buyer',
          confidence: '0.80',
          similarity: '0.75',
        }),
      );
      expect(mockCallLlmGateway).toHaveBeenCalledWith(
        expect.objectContaining({
          archetypeId: 'family_buyer',
          confidence: 0.8,
          similarity: 0.75,
        }),
      );
    });

    it('Haiku selected for medium similarity (0.6 < sim <= 0.85)', async () => {
      await POST(
        makeRequest({
          ...VALID_PARAMS,
          confidence: '0.80',
          similarity: '0.75',
        }),
      );
      // The gateway mock captures the call — the model selection happens inside the gateway
      expect(mockCallLlmGateway).toHaveBeenCalledOnce();
    });

    it('Sonnet selected for low similarity (sim <= 0.6)', async () => {
      await POST(
        makeRequest({
          ...VALID_PARAMS,
          confidence: '0.80',
          similarity: '0.50',
        }),
      );
      expect(mockCallLlmGateway).toHaveBeenCalledOnce();
    });
  });

  // ─── Unit: AdaptationDirectives Zod schema validation ────────────────────────

  describe('POST /api/adapt — AdaptationDirectives schema validation', () => {
    beforeEach(() => {
      mockCallLlmGateway.mockClear();
      mockCallLlmGateway.mockResolvedValue(null);
    });

    it('valid request → response matches AdaptationDirectives schema', async () => {
      const res = await POST(makeRequest(VALID_PARAMS));
      expect(res.status).toBe(200);
      const body = await parseBody<unknown>(res);
      const parsed = AdaptationDirectivesSchema.safeParse(body);
      expect(parsed.success).toBe(true);
    });

    it('session_id is echoed back in response', async () => {
      const res = await POST(makeRequest({ ...VALID_PARAMS, session_id: 'my-test-session-123' }));
      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.session_id).toBe('my-test-session-123');
    });

    it('archetype is echoed back in response', async () => {
      const res = await POST(makeRequest({ ...VALID_PARAMS, archetype: 'family_buyer' }));
      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.archetype).toBe('family_buyer');
    });

    it('confidence and similarity are echoed as numbers', async () => {
      const res = await POST(
        makeRequest({ ...VALID_PARAMS, confidence: '0.82', similarity: '0.91' }),
      );
      const body = await parseBody<Record<string, unknown>>(res);
      expect(typeof body.confidence).toBe('number');
      expect(typeof body.similarity).toBe('number');
      expect(body.confidence).toBeCloseTo(0.82);
      expect(body.similarity).toBeCloseTo(0.91);
    });

    it('generated_at is a valid ISO 8601 datetime', async () => {
      const res = await POST(makeRequest(VALID_PARAMS));
      const body = await parseBody<Record<string, unknown>>(res);
      expect(typeof body.generated_at).toBe('string');
      expect(() => new Date(body.generated_at as string)).not.toThrow();
      expect(new Date(body.generated_at as string).getTime()).not.toBeNaN();
    });
  });

  // ─── Integration: valid request → correct AdaptationDirectives ────────────

  describe('POST /api/adapt — integration', () => {
    beforeEach(() => {
      mockCallLlmGateway.mockClear();
      mockCallLlmGateway.mockResolvedValue(null);
    });

    it('yield_hunter + high confidence + high similarity → 200 AdaptationDirectives', async () => {
      const res = await POST(
        makeRequest({
          session_id: 'integ-sess-001',
          archetype: 'yield_hunter',
          confidence: '0.75',
          similarity: '0.90',
        }),
      );
      expect(res.status).toBe(200);
      const body = await parseBody<Record<string, unknown>>(res);
      const parsed = AdaptationDirectivesSchema.safeParse(body);
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.source).toBe('playbook');
        expect(parsed.data.archetype).toBe('yield_hunter');
      }
    });

    it('family_buyer + high confidence + high similarity → 200 with playbook source', async () => {
      const res = await POST(
        makeRequest({
          session_id: 'integ-sess-002',
          archetype: 'family_buyer',
          confidence: '0.80',
          similarity: '0.88',
        }),
      );
      expect(res.status).toBe(200);
      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.source).toBe('playbook');
      expect(body.archetype).toBe('family_buyer');
    });

    it('lifestyle_expat + high confidence + high similarity → 200', async () => {
      const res = await POST(
        makeRequest({
          session_id: 'integ-sess-003',
          archetype: 'lifestyle_expat',
          confidence: '0.70',
          similarity: '0.95',
        }),
      );
      expect(res.status).toBe(200);
      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.source).toBe('playbook');
      expect(body.archetype).toBe('lifestyle_expat');
    });
  });

  // ─── LLM gateway unit tests ───────────────────────────────────────────────────

  describe('LLM gateway integration in route.ts', () => {
    it('gateway returns null with no API key → fallback source returned', async () => {
      mockCallLlmGateway.mockResolvedValue(null);
      const res = await POST(
        makeRequest({
          ...VALID_PARAMS,
          confidence: '0.80',
          similarity: '0.75', // medium → Haiku branch
        }),
      );
      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.source).toBe('playbook_fallback_llm_unavailable');
      expect(res.status).toBe(200);
    });

    it('gateway returns directives → they appear in response', async () => {
      mockCallLlmGateway.mockResolvedValue({
        directives: [
          {
            type: 'text' as const,
            slot: 'headline',
            value: 'LLM-optimized headline',
            archetype: 'yield_hunter' as const,
            confidence: 0.85,
          },
        ],
        model: 'claude-haiku-4-5' as const,
        tokens_in: 150,
        tokens_out: 40,
        cost_usd: 0.00005,
        latency_ms: 250,
      });

      const res = await POST(
        makeRequest({
          ...VALID_PARAMS,
          confidence: '0.80',
          similarity: '0.75',
        }),
      );
      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.source).toBe('llm_tweaked');
      const directives = body.directives as { value: string }[];
      expect(directives.some((d) => d.value === 'LLM-optimized headline')).toBe(true);
    });
  });

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

  describe('POST /api/adapt — AdaptationDirectives response shape', () => {
    beforeEach(() => {
      mockCallLlmGateway.mockClear();
      mockCallLlmGateway.mockResolvedValue(null);
    });

    it('archetype_hint absent → defaults to neutral archetype', async () => {
      const noHint = {
        tenant_id: VALID_POST_BODY.tenant_id,
        session_id: VALID_POST_BODY.session_id,
        page_type: VALID_POST_BODY.page_type,
        confidence: VALID_POST_BODY.confidence,
        similarity: VALID_POST_BODY.similarity,
      };
      const res = await POST(makePostRequest(noHint, 'Bearer demo_key'));
      expect(res.status).toBe(200);
      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.archetype).toBe('neutral');
    });

    it('confidence and similarity absent → default 0.5', async () => {
      const noScores = {
        tenant_id: VALID_POST_BODY.tenant_id,
        session_id: VALID_POST_BODY.session_id,
        page_type: VALID_POST_BODY.page_type,
      };
      const res = await POST(makePostRequest(noScores, 'Bearer demo_key'));
      expect(res.status).toBe(200);
      const body = await parseBody<Record<string, unknown>>(res);
      // confidence <= 0.6 → default (no adaptation)
      expect(body.source).toBe('default');
      expect(body.confidence).toBeCloseTo(0.5);
      expect(body.similarity).toBeCloseTo(0.5);
    });

    it('response matches AdaptationDirectives schema', async () => {
      const res = await POST(makePostRequest(VALID_POST_BODY, 'Bearer demo_key'));
      expect(res.status).toBe(200);
      const body = await parseBody<unknown>(res);
      const parsed = AdaptationDirectivesSchema.safeParse(body);
      expect(parsed.success).toBe(true);
    });

    it('generated_at is a valid ISO datetime', async () => {
      const res = await POST(makePostRequest(VALID_POST_BODY, 'Bearer demo_key'));
      const body = await parseBody<Record<string, unknown>>(res);
      expect(typeof body.generated_at).toBe('string');
      expect(new Date(body.generated_at as string).getTime()).not.toBeNaN();
    });
  });

  // ─── POST /api/adapt — ReorderDirective ──────────────────────────────────────

  describe('POST /api/adapt — ReorderDirective', () => {
    /** Give every listing a distinct cosine against a unit archetype vector (FOLLOW-1202). */
    function embedAll(ids: string[]): void {
      vi.mocked(fetchArchetypeEmbedding).mockResolvedValueOnce([1, 0]);
      vi.mocked(fetchListingEmbeddings).mockResolvedValueOnce(
        new Map(ids.map((id, i) => [id, [0.1 * (i + 1), 1]])),
      );
    }

    beforeEach(() => {
      mockCallLlmGateway.mockClear();
      mockCallLlmGateway.mockResolvedValue(null);
    });

    it('POST with listing_ids returns ReorderDirective for est_demo_tenant', async () => {
      embedAll(['listing-a', 'listing-b', 'listing-c']);
      const body = {
        ...VALID_POST_BODY,
        listing_ids: ['listing-a', 'listing-b', 'listing-c'],
      };
      const res = await POST(makePostRequest(body, 'Bearer demo_key'));
      expect(res.status).toBe(200);
      const resBody = await parseBody<Record<string, unknown>>(res);
      const directives = resBody.directives as { type: string }[];
      const reorderDirectives = directives.filter((d) => d.type === 'reorder');
      expect(reorderDirectives.length).toBe(1);

      const rd = reorderDirectives[0] as {
        type: string;
        container_selector: string;
        item_selector: string;
        score_function: string;
        scores: { listing_id: string; score: number }[];
        archetype: string;
        confidence: number;
      };
      expect(rd.container_selector).toBe('[data-estalara-listings-grid]');
      expect(rd.item_selector).toBe('[data-estalara-listing-id]');
      expect(rd.score_function).toBe('archetype_affinity');
      expect(rd.scores).toHaveLength(3);
      expect(rd.archetype).toBe('yield_hunter');
      // Validate schema
      const parsed = ReorderDirectiveSchema.safeParse(rd);
      expect(parsed.success).toBe(true);
    });

    it('POST without listing_ids returns no ReorderDirective', async () => {
      const res = await POST(makePostRequest(VALID_POST_BODY, 'Bearer demo_key'));
      expect(res.status).toBe(200);
      const resBody = await parseBody<Record<string, unknown>>(res);
      const directives = resBody.directives as { type: string }[];
      const reorderDirectives = directives.filter((d) => d.type === 'reorder');
      expect(reorderDirectives.length).toBe(0);
    });

    it('POST with empty listing_ids array returns no ReorderDirective', async () => {
      const body = {
        ...VALID_POST_BODY,
        listing_ids: [],
      };
      const res = await POST(makePostRequest(body, 'Bearer demo_key'));
      expect(res.status).toBe(200);
      const resBody = await parseBody<Record<string, unknown>>(res);
      const directives = resBody.directives as { type: string }[];
      const reorderDirectives = directives.filter((d) => d.type === 'reorder');
      expect(reorderDirectives.length).toBe(0);
    });

    it('POST with reorder_capable=false tenant (non-demo) returns no ReorderDirective', async () => {
      const body = {
        tenant_id: 'some_other_tenant',
        session_id: 'sess-reorder-004',
        page_type: 'listing_list' as const,
        archetype_hint: 'yield_hunter',
        confidence: 0.8,
        similarity: 0.9,
        listing_ids: ['listing-x', 'listing-y'],
      };
      const res = await POST(makePostRequest(body, 'Bearer demo_key'));
      expect(res.status).toBe(200);
      const resBody = await parseBody<Record<string, unknown>>(res);
      const directives = resBody.directives as { type: string }[];
      const reorderDirectives = directives.filter((d) => d.type === 'reorder');
      expect(reorderDirectives.length).toBe(0);
    });

    it('ReorderDirective scores are sorted descending', async () => {
      embedAll(['alpha', 'beta', 'gamma']);
      const body = {
        ...VALID_POST_BODY,
        listing_ids: ['alpha', 'beta', 'gamma'],
      };
      const res = await POST(makePostRequest(body, 'Bearer demo_key'));
      const resBody = await parseBody<Record<string, unknown>>(res);
      const directives = resBody.directives as { type: string }[];
      const rd = directives.find((d) => d.type === 'reorder') as unknown as {
        scores: { listing_id: string; score: number }[];
      };
      expect(rd).toBeDefined();
      const scores = rd.scores.map((s) => s.score);
      for (let i = 0; i < scores.length - 1; i++) {
        expect(scores[i]!).toBeGreaterThanOrEqual(scores[i + 1]!);
      }
    });

    it('listing_ids over max (101) → 400 validation error', async () => {
      const body = {
        ...VALID_POST_BODY,
        listing_ids: Array.from({ length: 101 }, (_, i) => `listing-${String(i)}`),
      };
      const res = await POST(makePostRequest(body, 'Bearer demo_key'));
      expect(res.status).toBe(400);
    });
  });

  // ─── POST /api/adapt — page_context derived from page_type (FOLLOW-357 / FOLLOW-356) ──

  describe('POST /api/adapt — page_context derived from page_type', () => {
    beforeEach(() => {
      mockCallLlmGateway.mockClear();
      mockCallLlmGateway.mockResolvedValue(null);
    });

    // FOLLOW-356 AC-1 / AC-2: listing_detail → page_context === 2 AND headline directive present.
    //
    // FOLLOW-1140 changed the archetype these two cases use from `yield_hunter` to
    // `diaspora_buyer`, and the reason is the point of the pair. `yield_hunter`'s headline is
    // `'Rental Yield: {yield}% | Gross Income: {income}/yr'`, and neither token is resolvable
    // from any data this route holds, so the route now discards that directive server-side
    // rather than shipping raw braces (ESC-074 (b), reaffirming FOLLOW-1018). With it, AC-1
    // would be asserting the placeholder contract, not the page_type filter it is named for.
    // `diaspora_buyer` carries no placeholder in any slot or variant, so the ONLY variable
    // between the two cases below is `page_type` — which is what FOLLOW-356 is about.
    /**
     * FOLLOW-1163 / MASTER_DESIGN §E.7.0 moved where these two cases can be OBSERVED, and the
     * reason is worth reading before editing them again.
     *
     * FOLLOW-356's contract is `filterDirectivesByPageType`: a headline is meaningful on a detail
     * page and must be suppressed on a list/search/home page. Both cases used to run on branch 2
     * (`similarity: 0.95`, playbook served verbatim). Under §E.7.0 that branch withholds every
     * property-asserting directive, so a playbook headline never reaches the wire there at all —
     * which does not just break AC-1, it makes **AC-2 pass for the wrong reason**: the headline
     * would be absent whether the page-type filter worked or not.
     *
     * So both now run on the LLM path, where a headline IS served, and the filter is the only thing
     * that can remove it. Same contract, an observation point that still exists, and AC-2 is
     * falsifiable again.
     */
    const LLM_HEADLINE = [
      {
        type: 'text' as const,
        slot: 'headline',
        value: 'A calm, well-connected home in the old town',
        archetype: 'diaspora_buyer' as const,
        confidence: 0.9,
      },
    ];
    const llmServesAHeadline = () => {
      mockCallLlmGateway.mockResolvedValue({
        directives: LLM_HEADLINE,
        model: 'claude-haiku-4-5',
        tokens_in: 100,
        tokens_out: 20,
        cost_usd: 0,
        latency_ms: 1,
      });
    };

    it('listing_detail page_type → page_context === 2 AND headline directive present (FOLLOW-356 AC-1)', async () => {
      llmServesAHeadline();
      const body = {
        ...VALID_POST_BODY,
        page_type: 'listing_detail' as const,
        archetype_hint: 'diaspora_buyer',
        confidence: 0.9,
        // FOLLOW-1163: 0.85 routes to branch 3 (llm_tweaked), where a headline is actually served.
        similarity: 0.85,
      };
      const res = await POST(makePostRequest(body, 'Bearer demo_key'));
      expect(res.status).toBe(200);
      const resBody = await parseBody<Record<string, unknown>>(res);
      expect(resBody.page_context).toBe(2);
      expect(resBody.tier).toBeUndefined();
      // Headline directive must be present on listing_detail pages (FOLLOW-356 AC-1).
      const directives = resBody.directives as { slot?: string; type: string }[];
      expect(directives.some((d) => d.slot === 'headline')).toBe(true);
    });

    // FOLLOW-356 AC-2: listing_list → page_context === 1 AND headline ABSENT for same archetype.
    it('listing_list page_type → page_context === 1 AND headline absent (FOLLOW-356 AC-2)', async () => {
      // FOLLOW-1163: the LLM path serves a headline, so the filter is the ONLY thing that can
      // remove it here. On branch 2 this assertion would now hold vacuously.
      llmServesAHeadline();
      const body = {
        ...VALID_POST_BODY,
        page_type: 'listing_list' as const,
        archetype_hint: 'diaspora_buyer',
        confidence: 0.9,
        similarity: 0.85,
      };
      const res = await POST(makePostRequest(body, 'Bearer demo_key'));
      expect(res.status).toBe(200);
      const resBody = await parseBody<Record<string, unknown>>(res);
      expect(resBody.page_context).toBe(1);
      expect(resBody.tier).toBeUndefined();
      // Headline directive must be absent on list/search/home pages (FOLLOW-356 AC-2).
      const directives = resBody.directives as { slot?: string; type: string }[];
      expect(directives.every((d) => d.type === 'reorder' || d.slot !== 'headline')).toBe(true);
    });

    it('search page_type → page_context === 1', async () => {
      const body = {
        ...VALID_POST_BODY,
        page_type: 'search' as const,
      };
      const res = await POST(makePostRequest(body, 'Bearer demo_key'));
      expect(res.status).toBe(200);
      const resBody = await parseBody<Record<string, unknown>>(res);
      expect(resBody.page_context).toBe(1);
    });

    it('home page_type → page_context === 1', async () => {
      const body = {
        ...VALID_POST_BODY,
        page_type: 'home' as const,
      };
      const res = await POST(makePostRequest(body, 'Bearer demo_key'));
      expect(res.status).toBe(200);
      const resBody = await parseBody<Record<string, unknown>>(res);
      expect(resBody.page_context).toBe(1);
    });
  });

  // ─── FOLLOW-1056: the fallback REASON reaches the response body ───────────────

  describe('POST /api/adapt — FOLLOW-1056: `fallback_reason` distinguishes the two fallbacks', () => {
    // Rule H wiring proof for the new field: the gateway unit tests prove the gateway REPORTS a
    // reason, this proves the route CARRIES it to the caller. Without this pair, `fallback_reason`
    // would be a field with a producer and no demonstrated path to any consumer — and its consumer
    // of record is the FOLLOW-1022 canary, which reads it off the wire.
    beforeEach(() => {
      vi.clearAllMocks();
      mockCallLlmGateway.mockResolvedValue(null);
    });

    const bandParams = { ...VALID_PARAMS, confidence: '0.80', similarity: '0.75' };

    it('reports `llm_unavailable` when the gateway returns null without naming a reason', async () => {
      const res = await POST(makeRequest(bandParams));
      const body = await parseBody<Record<string, unknown>>(res);

      expect(body.source).toBe('playbook_fallback_llm_unavailable');
      expect(body.fallback_reason).toBe('llm_unavailable');
    });

    it('reports `fact_check_refused` when the gateway names that reason — same `source`, different meaning', async () => {
      mockCallLlmGateway.mockImplementationOnce((input) => {
        input.onFallback?.('fact_check_refused');
        return Promise.resolve(null);
      });

      const res = await POST(makeRequest(bandParams));
      const body = await parseBody<Record<string, unknown>>(res);

      // The `source` is deliberately IDENTICAL to the test above — it is a strict `z.enum` in the
      // SDK's response schema, so it cannot carry the split without breaking deployed bundles.
      expect(body.source).toBe('playbook_fallback_llm_unavailable');
      expect(body.fallback_reason).toBe('fact_check_refused');
    });

    it('POSITIVE CONTROL: a served generation carries NO `fallback_reason` at all', async () => {
      mockCallLlmGateway.mockResolvedValueOnce({
        directives: [
          {
            type: 'text' as const,
            slot: 'headline',
            value: 'Generated copy',
            archetype: 'yield_hunter' as const,
            confidence: 0.8,
          },
        ],
        model: 'claude-haiku-4-5-20251001',
        tokens_in: 100,
        tokens_out: 40,
        cost_usd: 0.0001,
        latency_ms: 900,
      });

      const res = await POST(makeRequest(bandParams));
      const body = await parseBody<Record<string, unknown>>(res);

      expect(body.source).toBe('llm_tweaked');
      expect(body.fallback_reason).toBeUndefined();
    });
  });

  __H.active = null;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.llm-call.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.llm-call.test.ts — FOLLOW-1287 — characterisation of the LLM branches of `POST /api/adapt`.', () => {
  /**
   * FOLLOW-1287 — characterisation of the LLM branches of `POST /api/adapt`.
   *
   * Written BEFORE `llm_full` and `llm_tweaked` were merged into one gateway call, and run green
   * against the two-call code first. Every inline snapshot below was recorded from that code; the
   * merge had to keep them byte-identical. Pinned per case, for identical inputs:
   *
   *   - the response body (minus the per-request `adapt_decision_id` / `generated_at`);
   *   - the exact `callLlmGateway` input (minus the `onFallback` callback, whose presence is
   *     asserted separately, and with `basePlaybook` pinned by identity to the registry entry);
   *   - the `adaptation_decisions` row the route writes to ClickHouse (minus `ts` and the
   *     per-request id).
   *
   * Cases: both source labels (`llm_tweaked` at similarity 0.7, `llm_full` at 0.5) × gateway
   * success / null with no reason / null + `fact_check_refused` / null + `listing_context_unavailable`
   * (the listing fetch fails, so the route flags `groundingMissing`), plus the DEMO MODE
   * `forceModel` pass-through.
   *
   * @module apps/control-plane/src/app/api/adapt/route.llm-call.test
   */

  const __reg = new Map<string, Record<string, unknown>>();
  __reg.set(
    '@/lib/demo-jwt-verify',
    (() => ({
      verifyDemoJwt: vi.fn().mockResolvedValue({}),
      DemoJwtSecretMissingError: class DemoJwtSecretMissingError extends Error {},
      DemoJwtInvalidError: class DemoJwtInvalidError extends Error {},
    }))(),
  );
  __reg.set(
    '@/lib/llm-gateway',
    (() => ({
      callLlmGateway: vi.fn(),
    }))(),
  );
  __reg.set(
    '@estalara/auth',
    (() => ({
      getAuthClaims: vi.fn().mockResolvedValue(null),
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
    '@/lib/bandit-query',
    (() => ({
      SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
      getBanditArms: vi.fn().mockResolvedValue([]),
    }))(),
  );
  __reg.set(
    '@/lib/demo-override-store',
    (() => ({
      getDemoOverride: vi.fn().mockResolvedValue({ enabled: false }),
      DEMO_OVERRIDE_CONFIDENCE: 0.95,
      DEMO_OVERRIDE_SIMILARITY: 0.75,
    }))(),
  );
  __H.active = __reg;
  beforeAll(() => {
    __H.active = __reg;
  });
  afterAll(() => {
    __H.active = null;
  });

  const LISTING_ID = 'follow-1287-fixture-listing';

  const LISTING_JSON = {
    uuid: '11111111-2222-3333-4444-555555555555',
    headline: 'Sunlit apartment with river views',
    description: 'A calm, well-connected home in the old town.',
    bedrooms: 3,
    livingArea: 128.5,
    district: 'Alfama',
    city: 'Lisbon',
    publicLocationLabel: 'Alfama, Lisbon',
    highlights: ['Renovated kitchen', 'River views'],
    price: 450000,
    currency: 'EUR',
  };

  const GENERATED = [
    {
      type: 'text' as const,
      slot: 'headline',
      value: 'Generated headline',
      archetype: 'yield_hunter',
      confidence: 0.9,
    },
  ];

  type GatewayOutcome =
    | { kind: 'success' }
    | { kind: 'null' }
    | { kind: 'null_with_reason'; reason: 'fact_check_refused' | 'listing_context_unavailable' };

  interface Captured {
    body: Record<string, unknown>;
    gatewayInput: Record<string, unknown> | null;
    onFallbackWasFunction: boolean | null;
    decisionRow: Record<string, string> | null;
  }

  /** Strip a ClickHouse insert's params down to the deterministic ones. */
  function paramsOf(url: URL, drop: string[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of url.searchParams.entries()) {
      if (!k.startsWith('param_p_') || drop.includes(k)) continue;
      out[k] = v;
    }
    return out;
  }

  async function run(opts: {
    similarity: number;
    outcome: GatewayOutcome;
    listingFetchOk?: boolean;
    locale?: 'en' | 'pl' | 'es';
  }): Promise<Captured> {
    const inserts: { url: URL; body: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown, init?: { body?: string }) => {
        const url = String(input);
        if (url.includes('/api/v1/listing/details')) {
          return Promise.resolve(
            opts.listingFetchOk === false
              ? new Response('nope', { status: 503 })
              : new Response(JSON.stringify(LISTING_JSON), {
                  status: 200,
                  headers: { 'Content-Type': 'application/json' },
                }),
          );
        }
        if (url.startsWith('http://clickhouse.test')) {
          inserts.push({ url: new URL(url), body: init?.body ?? '' });
        }
        return Promise.resolve(new Response('', { status: 200 }));
      }),
    );

    vi.mocked(callLlmGateway).mockImplementation((input: LlmGatewayInput) => {
      if (opts.outcome.kind === 'success') {
        return Promise.resolve({
          directives: GENERATED,
          model: 'mock-model',
          tokensIn: 1,
          tokensOut: 1,
          costUsd: 0,
          latencyMs: 1,
        } as unknown as Awaited<ReturnType<typeof callLlmGateway>>);
      }
      if (opts.outcome.kind === 'null_with_reason') input.onFallback?.(opts.outcome.reason);
      return Promise.resolve(null);
    });

    const res = await POST(
      new NextRequest('http://localhost/api/adapt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer demo_key' },
        body: JSON.stringify({
          tenant_id: 'tenant-follow1287',
          session_id: 'sess-follow1287',
          page_type: 'listing_detail',
          archetype_hint: 'yield_hunter',
          confidence: 0.9,
          similarity: opts.similarity,
          listing_id: LISTING_ID,
          ...(opts.locale ? { locale: opts.locale } : {}),
        }),
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    delete body.adapt_decision_id;
    delete body.generated_at;

    // afterResponse() falls back to a microtask outside a request scope — let the sinks run.
    await new Promise((r) => setTimeout(r, 0));

    const call = vi.mocked(callLlmGateway).mock.calls[0]?.[0] as
      | (Record<string, unknown> & { onFallback?: unknown })
      | undefined;
    let gatewayInput: Record<string, unknown> | null = null;
    let onFallbackWasFunction: boolean | null = null;
    if (call) {
      const { onFallback, basePlaybook, ...rest } = call;
      // The playbook object is pinned by identity to the archetype's registry entry rather than
      // by value, so this file does not churn whenever playbook copy is edited.
      gatewayInput = {
        ...rest,
        basePlaybook:
          basePlaybook === getPlaybook(String(rest.archetypeId) as ArchetypeId)
            ? `getPlaybook(${String(rest.archetypeId)})`
            : 'NOT THE REGISTRY PLAYBOOK',
      };
      onFallbackWasFunction = typeof onFallback === 'function';
    }

    const decision = inserts.find((i) => i.body.includes('adaptation_decisions'));
    return {
      body,
      gatewayInput,
      onFallbackWasFunction,
      decisionRow: decision
        ? paramsOf(decision.url, ['param_p_ts', 'param_p_adapt_decision_id'])
        : null,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getDemoOverride).mockResolvedValue({ enabled: false } as Awaited<
      ReturnType<typeof getDemoOverride>
    >);
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test/');
    vi.stubEnv('ESTALARA_BACKEND_URL', 'http://listing-backend.test');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  describe('POST /api/adapt — FOLLOW-1287 characterisation of the single LLM call', () => {
    it('llm_tweaked band (similarity 0.7), gateway success', async () => {
      expect(await run({ similarity: 0.7, outcome: { kind: 'success' } })).toMatchInlineSnapshot(`
      {
        "body": {
          "archetype": "yield_hunter",
          "confidence": 0.9,
          "directives": [
            {
              "archetype": "yield_hunter",
              "confidence": 0.9,
              "slot": "headline",
              "type": "text",
              "value": "Generated headline",
            },
          ],
          "page_context": 2,
          "session_id": "sess-follow1287",
          "similarity": 0.7,
          "source": "llm_tweaked",
          "variant": "control",
        },
        "decisionRow": {
          "param_p_archetype": "yield_hunter",
          "param_p_confidence": "0.9",
          "param_p_demo_override": "0",
          "param_p_directive_count": "1",
          "param_p_features_snapshot": "{"archetype":"yield_hunter","confidence":0.9,"similarity":0.7,"source":"llm_tweaked","page_context":2,"page_context_source":"page_type_derived","holdout":false,"variant":"control"}",
          "param_p_holdout_group": "0",
          "param_p_holdout_pct": "0",
          "param_p_lead_id": "",
          "param_p_model_version": "rulebased-bandit-v1",
          "param_p_page_context": "2",
          "param_p_page_context_source": "page_type_derived",
          "param_p_session_id": "sess-follow1287",
          "param_p_similarity": "0.7",
          "param_p_source": "llm_tweaked",
          "param_p_tenant_id": "tenant-follow1287",
          "param_p_variant": "control",
        },
        "gatewayInput": {
          "archetypeId": "yield_hunter",
          "basePlaybook": "getPlaybook(yield_hunter)",
          "confidence": 0.9,
          "groundingMissing": false,
          "listingContext": {
            "listing_description": "A calm, well-connected home in the old town.",
            "listing_location": "Lisbon",
            "listing_price": "450000 EUR",
            "listing_title": "Sunlit apartment with river views",
          },
          "sessionId": "sess-follow1287",
          "similarity": 0.7,
          "tenantId": "tenant-follow1287",
        },
        "onFallbackWasFunction": true,
      }
    `);
    });

    it('llm_tweaked band, gateway null without a reason', async () => {
      expect(await run({ similarity: 0.7, outcome: { kind: 'null' } })).toMatchInlineSnapshot(`
      {
        "body": {
          "archetype": "yield_hunter",
          "confidence": 0.9,
          "directives": [
            {
              "archetype": "yield_hunter",
              "confidence": 0.9,
              "slot": "cta",
              "type": "text",
              "value": "Request Investment Pack",
            },
          ],
          "fallback_reason": "llm_unavailable",
          "page_context": 2,
          "session_id": "sess-follow1287",
          "similarity": 0.7,
          "source": "playbook_fallback_llm_unavailable",
          "variant": "control",
        },
        "decisionRow": {
          "param_p_archetype": "yield_hunter",
          "param_p_confidence": "0.9",
          "param_p_demo_override": "0",
          "param_p_directive_count": "1",
          "param_p_features_snapshot": "{"archetype":"yield_hunter","confidence":0.9,"similarity":0.7,"source":"playbook_fallback_llm_unavailable","page_context":2,"page_context_source":"page_type_derived","holdout":false,"variant":"control"}",
          "param_p_holdout_group": "0",
          "param_p_holdout_pct": "0",
          "param_p_lead_id": "",
          "param_p_model_version": "rulebased-bandit-v1",
          "param_p_page_context": "2",
          "param_p_page_context_source": "page_type_derived",
          "param_p_session_id": "sess-follow1287",
          "param_p_similarity": "0.7",
          "param_p_source": "playbook_fallback_llm_unavailable",
          "param_p_tenant_id": "tenant-follow1287",
          "param_p_variant": "control",
        },
        "gatewayInput": {
          "archetypeId": "yield_hunter",
          "basePlaybook": "getPlaybook(yield_hunter)",
          "confidence": 0.9,
          "groundingMissing": false,
          "listingContext": {
            "listing_description": "A calm, well-connected home in the old town.",
            "listing_location": "Lisbon",
            "listing_price": "450000 EUR",
            "listing_title": "Sunlit apartment with river views",
          },
          "sessionId": "sess-follow1287",
          "similarity": 0.7,
          "tenantId": "tenant-follow1287",
        },
        "onFallbackWasFunction": true,
      }
    `);
    });

    it('llm_tweaked band, gateway null with fact_check_refused', async () => {
      expect(
        await run({
          similarity: 0.7,
          outcome: { kind: 'null_with_reason', reason: 'fact_check_refused' },
        }),
      ).toMatchInlineSnapshot(`
      {
        "body": {
          "archetype": "yield_hunter",
          "confidence": 0.9,
          "directives": [
            {
              "archetype": "yield_hunter",
              "confidence": 0.9,
              "slot": "cta",
              "type": "text",
              "value": "Request Investment Pack",
            },
          ],
          "fallback_reason": "fact_check_refused",
          "page_context": 2,
          "session_id": "sess-follow1287",
          "similarity": 0.7,
          "source": "playbook_fallback_llm_unavailable",
          "variant": "control",
        },
        "decisionRow": {
          "param_p_archetype": "yield_hunter",
          "param_p_confidence": "0.9",
          "param_p_demo_override": "0",
          "param_p_directive_count": "1",
          "param_p_features_snapshot": "{"archetype":"yield_hunter","confidence":0.9,"similarity":0.7,"source":"playbook_fallback_llm_unavailable","page_context":2,"page_context_source":"page_type_derived","holdout":false,"variant":"control"}",
          "param_p_holdout_group": "0",
          "param_p_holdout_pct": "0",
          "param_p_lead_id": "",
          "param_p_model_version": "rulebased-bandit-v1",
          "param_p_page_context": "2",
          "param_p_page_context_source": "page_type_derived",
          "param_p_session_id": "sess-follow1287",
          "param_p_similarity": "0.7",
          "param_p_source": "playbook_fallback_llm_unavailable",
          "param_p_tenant_id": "tenant-follow1287",
          "param_p_variant": "control",
        },
        "gatewayInput": {
          "archetypeId": "yield_hunter",
          "basePlaybook": "getPlaybook(yield_hunter)",
          "confidence": 0.9,
          "groundingMissing": false,
          "listingContext": {
            "listing_description": "A calm, well-connected home in the old town.",
            "listing_location": "Lisbon",
            "listing_price": "450000 EUR",
            "listing_title": "Sunlit apartment with river views",
          },
          "sessionId": "sess-follow1287",
          "similarity": 0.7,
          "tenantId": "tenant-follow1287",
        },
        "onFallbackWasFunction": true,
      }
    `);
    });

    it('llm_tweaked band, listing fetch fails → groundingMissing, listing_context_unavailable', async () => {
      expect(
        await run({
          similarity: 0.7,
          listingFetchOk: false,
          outcome: { kind: 'null_with_reason', reason: 'listing_context_unavailable' },
        }),
      ).toMatchInlineSnapshot(`
      {
        "body": {
          "archetype": "yield_hunter",
          "confidence": 0.9,
          "directives": [
            {
              "archetype": "yield_hunter",
              "confidence": 0.9,
              "slot": "cta",
              "type": "text",
              "value": "Request Investment Pack",
            },
          ],
          "fallback_reason": "listing_context_unavailable",
          "page_context": 2,
          "session_id": "sess-follow1287",
          "similarity": 0.7,
          "source": "playbook_fallback_llm_unavailable",
          "variant": "control",
        },
        "decisionRow": {
          "param_p_archetype": "yield_hunter",
          "param_p_confidence": "0.9",
          "param_p_demo_override": "0",
          "param_p_directive_count": "1",
          "param_p_features_snapshot": "{"archetype":"yield_hunter","confidence":0.9,"similarity":0.7,"source":"playbook_fallback_llm_unavailable","page_context":2,"page_context_source":"page_type_derived","holdout":false,"variant":"control"}",
          "param_p_holdout_group": "0",
          "param_p_holdout_pct": "0",
          "param_p_lead_id": "",
          "param_p_model_version": "rulebased-bandit-v1",
          "param_p_page_context": "2",
          "param_p_page_context_source": "page_type_derived",
          "param_p_session_id": "sess-follow1287",
          "param_p_similarity": "0.7",
          "param_p_source": "playbook_fallback_llm_unavailable",
          "param_p_tenant_id": "tenant-follow1287",
          "param_p_variant": "control",
        },
        "gatewayInput": {
          "archetypeId": "yield_hunter",
          "basePlaybook": "getPlaybook(yield_hunter)",
          "confidence": 0.9,
          "groundingMissing": true,
          "listingContext": {},
          "sessionId": "sess-follow1287",
          "similarity": 0.7,
          "tenantId": "tenant-follow1287",
        },
        "onFallbackWasFunction": true,
      }
    `);
    });

    it('llm_tweaked band, locale pl, gateway null', async () => {
      expect(await run({ similarity: 0.7, locale: 'pl', outcome: { kind: 'null' } }))
        .toMatchInlineSnapshot(`
      {
        "body": {
          "archetype": "yield_hunter",
          "confidence": 0.9,
          "directives": [
            {
              "archetype": "yield_hunter",
              "confidence": 0.9,
              "slot": "cta",
              "type": "text",
              "value": "Request Investment Pack",
            },
          ],
          "fallback_reason": "llm_unavailable",
          "page_context": 2,
          "session_id": "sess-follow1287",
          "similarity": 0.7,
          "source": "playbook_fallback_llm_unavailable",
          "variant": "control",
        },
        "decisionRow": {
          "param_p_archetype": "yield_hunter",
          "param_p_confidence": "0.9",
          "param_p_demo_override": "0",
          "param_p_directive_count": "1",
          "param_p_features_snapshot": "{"archetype":"yield_hunter","confidence":0.9,"similarity":0.7,"source":"playbook_fallback_llm_unavailable","page_context":2,"page_context_source":"page_type_derived","holdout":false,"variant":"control"}",
          "param_p_holdout_group": "0",
          "param_p_holdout_pct": "0",
          "param_p_lead_id": "",
          "param_p_model_version": "rulebased-bandit-v1",
          "param_p_page_context": "2",
          "param_p_page_context_source": "page_type_derived",
          "param_p_session_id": "sess-follow1287",
          "param_p_similarity": "0.7",
          "param_p_source": "playbook_fallback_llm_unavailable",
          "param_p_tenant_id": "tenant-follow1287",
          "param_p_variant": "control",
        },
        "gatewayInput": {
          "archetypeId": "yield_hunter",
          "basePlaybook": "getPlaybook(yield_hunter)",
          "confidence": 0.9,
          "groundingMissing": false,
          "listingContext": {
            "listing_description": "A calm, well-connected home in the old town.",
            "listing_location": "Lisbon",
            "listing_price": "450000 EUR",
            "listing_title": "Sunlit apartment with river views",
          },
          "sessionId": "sess-follow1287",
          "similarity": 0.7,
          "tenantId": "tenant-follow1287",
        },
        "onFallbackWasFunction": true,
      }
    `);
    });

    it('llm_full band (similarity 0.5), gateway success', async () => {
      expect(await run({ similarity: 0.5, outcome: { kind: 'success' } })).toMatchInlineSnapshot(`
      {
        "body": {
          "archetype": "yield_hunter",
          "confidence": 0.9,
          "directives": [
            {
              "archetype": "yield_hunter",
              "confidence": 0.9,
              "slot": "headline",
              "type": "text",
              "value": "Generated headline",
            },
          ],
          "page_context": 2,
          "session_id": "sess-follow1287",
          "similarity": 0.5,
          "source": "llm_full",
          "variant": "control",
        },
        "decisionRow": {
          "param_p_archetype": "yield_hunter",
          "param_p_confidence": "0.9",
          "param_p_demo_override": "0",
          "param_p_directive_count": "1",
          "param_p_features_snapshot": "{"archetype":"yield_hunter","confidence":0.9,"similarity":0.5,"source":"llm_full","page_context":2,"page_context_source":"page_type_derived","holdout":false,"variant":"control"}",
          "param_p_holdout_group": "0",
          "param_p_holdout_pct": "0",
          "param_p_lead_id": "",
          "param_p_model_version": "rulebased-bandit-v1",
          "param_p_page_context": "2",
          "param_p_page_context_source": "page_type_derived",
          "param_p_session_id": "sess-follow1287",
          "param_p_similarity": "0.5",
          "param_p_source": "llm_full",
          "param_p_tenant_id": "tenant-follow1287",
          "param_p_variant": "control",
        },
        "gatewayInput": {
          "archetypeId": "yield_hunter",
          "basePlaybook": "getPlaybook(yield_hunter)",
          "confidence": 0.9,
          "groundingMissing": false,
          "listingContext": {
            "listing_description": "A calm, well-connected home in the old town.",
            "listing_location": "Lisbon",
            "listing_price": "450000 EUR",
            "listing_title": "Sunlit apartment with river views",
          },
          "sessionId": "sess-follow1287",
          "similarity": 0.5,
          "tenantId": "tenant-follow1287",
        },
        "onFallbackWasFunction": true,
      }
    `);
    });

    it('llm_full band, gateway null without a reason', async () => {
      expect(await run({ similarity: 0.5, outcome: { kind: 'null' } })).toMatchInlineSnapshot(`
      {
        "body": {
          "archetype": "yield_hunter",
          "confidence": 0.9,
          "directives": [],
          "fallback_reason": "llm_unavailable",
          "page_context": 2,
          "session_id": "sess-follow1287",
          "similarity": 0.5,
          "source": "playbook_fallback_llm_unavailable",
          "variant": "control",
        },
        "decisionRow": {
          "param_p_archetype": "yield_hunter",
          "param_p_confidence": "0.9",
          "param_p_demo_override": "0",
          "param_p_directive_count": "0",
          "param_p_features_snapshot": "{"archetype":"yield_hunter","confidence":0.9,"similarity":0.5,"source":"playbook_fallback_llm_unavailable","page_context":2,"page_context_source":"page_type_derived","holdout":false,"variant":"control"}",
          "param_p_holdout_group": "0",
          "param_p_holdout_pct": "0",
          "param_p_lead_id": "",
          "param_p_model_version": "rulebased-bandit-v1",
          "param_p_page_context": "2",
          "param_p_page_context_source": "page_type_derived",
          "param_p_session_id": "sess-follow1287",
          "param_p_similarity": "0.5",
          "param_p_source": "playbook_fallback_llm_unavailable",
          "param_p_tenant_id": "tenant-follow1287",
          "param_p_variant": "control",
        },
        "gatewayInput": {
          "archetypeId": "yield_hunter",
          "basePlaybook": "getPlaybook(yield_hunter)",
          "confidence": 0.9,
          "groundingMissing": false,
          "listingContext": {
            "listing_description": "A calm, well-connected home in the old town.",
            "listing_location": "Lisbon",
            "listing_price": "450000 EUR",
            "listing_title": "Sunlit apartment with river views",
          },
          "sessionId": "sess-follow1287",
          "similarity": 0.5,
          "tenantId": "tenant-follow1287",
        },
        "onFallbackWasFunction": true,
      }
    `);
    });

    it('llm_full band, gateway null with fact_check_refused', async () => {
      expect(
        await run({
          similarity: 0.5,
          outcome: { kind: 'null_with_reason', reason: 'fact_check_refused' },
        }),
      ).toMatchInlineSnapshot(`
      {
        "body": {
          "archetype": "yield_hunter",
          "confidence": 0.9,
          "directives": [],
          "fallback_reason": "fact_check_refused",
          "page_context": 2,
          "session_id": "sess-follow1287",
          "similarity": 0.5,
          "source": "playbook_fallback_llm_unavailable",
          "variant": "control",
        },
        "decisionRow": {
          "param_p_archetype": "yield_hunter",
          "param_p_confidence": "0.9",
          "param_p_demo_override": "0",
          "param_p_directive_count": "0",
          "param_p_features_snapshot": "{"archetype":"yield_hunter","confidence":0.9,"similarity":0.5,"source":"playbook_fallback_llm_unavailable","page_context":2,"page_context_source":"page_type_derived","holdout":false,"variant":"control"}",
          "param_p_holdout_group": "0",
          "param_p_holdout_pct": "0",
          "param_p_lead_id": "",
          "param_p_model_version": "rulebased-bandit-v1",
          "param_p_page_context": "2",
          "param_p_page_context_source": "page_type_derived",
          "param_p_session_id": "sess-follow1287",
          "param_p_similarity": "0.5",
          "param_p_source": "playbook_fallback_llm_unavailable",
          "param_p_tenant_id": "tenant-follow1287",
          "param_p_variant": "control",
        },
        "gatewayInput": {
          "archetypeId": "yield_hunter",
          "basePlaybook": "getPlaybook(yield_hunter)",
          "confidence": 0.9,
          "groundingMissing": false,
          "listingContext": {
            "listing_description": "A calm, well-connected home in the old town.",
            "listing_location": "Lisbon",
            "listing_price": "450000 EUR",
            "listing_title": "Sunlit apartment with river views",
          },
          "sessionId": "sess-follow1287",
          "similarity": 0.5,
          "tenantId": "tenant-follow1287",
        },
        "onFallbackWasFunction": true,
      }
    `);
    });

    it('llm_full band, listing fetch fails → groundingMissing, listing_context_unavailable', async () => {
      expect(
        await run({
          similarity: 0.5,
          listingFetchOk: false,
          outcome: { kind: 'null_with_reason', reason: 'listing_context_unavailable' },
        }),
      ).toMatchInlineSnapshot(`
      {
        "body": {
          "archetype": "yield_hunter",
          "confidence": 0.9,
          "directives": [],
          "fallback_reason": "listing_context_unavailable",
          "page_context": 2,
          "session_id": "sess-follow1287",
          "similarity": 0.5,
          "source": "playbook_fallback_llm_unavailable",
          "variant": "control",
        },
        "decisionRow": {
          "param_p_archetype": "yield_hunter",
          "param_p_confidence": "0.9",
          "param_p_demo_override": "0",
          "param_p_directive_count": "0",
          "param_p_features_snapshot": "{"archetype":"yield_hunter","confidence":0.9,"similarity":0.5,"source":"playbook_fallback_llm_unavailable","page_context":2,"page_context_source":"page_type_derived","holdout":false,"variant":"control"}",
          "param_p_holdout_group": "0",
          "param_p_holdout_pct": "0",
          "param_p_lead_id": "",
          "param_p_model_version": "rulebased-bandit-v1",
          "param_p_page_context": "2",
          "param_p_page_context_source": "page_type_derived",
          "param_p_session_id": "sess-follow1287",
          "param_p_similarity": "0.5",
          "param_p_source": "playbook_fallback_llm_unavailable",
          "param_p_tenant_id": "tenant-follow1287",
          "param_p_variant": "control",
        },
        "gatewayInput": {
          "archetypeId": "yield_hunter",
          "basePlaybook": "getPlaybook(yield_hunter)",
          "confidence": 0.9,
          "groundingMissing": true,
          "listingContext": {},
          "sessionId": "sess-follow1287",
          "similarity": 0.5,
          "tenantId": "tenant-follow1287",
        },
        "onFallbackWasFunction": true,
      }
    `);
    });

    // The two band EDGES, where only the label (and the null fallback) tells the bands apart:
    // similarity exactly 0.6 is `llm_full`, exactly 0.85 is `llm_tweaked`.
    it('band edge: similarity exactly 0.6 → llm_full (success) and its empty null fallback', async () => {
      const success = await run({ similarity: 0.6, outcome: { kind: 'success' } });
      vi.mocked(callLlmGateway).mockClear();
      const fallback = await run({ similarity: 0.6, outcome: { kind: 'null' } });
      expect({
        success: success.body.source,
        fallback: fallback.body.source,
        fallbackDirectives: fallback.body.directives,
        fallbackReason: fallback.body.fallback_reason,
      }).toMatchInlineSnapshot(`
        {
          "fallback": "playbook_fallback_llm_unavailable",
          "fallbackDirectives": [],
          "fallbackReason": "llm_unavailable",
          "success": "llm_full",
        }
      `);
    });

    it('band edge: similarity exactly 0.85 → llm_tweaked (success) and its playbook null fallback', async () => {
      const success = await run({ similarity: 0.85, outcome: { kind: 'success' } });
      vi.mocked(callLlmGateway).mockClear();
      const fallback = await run({ similarity: 0.85, outcome: { kind: 'null' } });
      expect({
        success: success.body.source,
        fallback: fallback.body.source,
        fallbackDirectives: fallback.body.directives,
        fallbackReason: fallback.body.fallback_reason,
      }).toMatchInlineSnapshot(`
        {
          "fallback": "playbook_fallback_llm_unavailable",
          "fallbackDirectives": [
            {
              "archetype": "yield_hunter",
              "confidence": 0.9,
              "slot": "cta",
              "type": "text",
              "value": "Request Investment Pack",
            },
          ],
          "fallbackReason": "llm_unavailable",
          "success": "llm_tweaked",
        }
      `);
    });

    it('DEMO MODE override forces the model through to the one call', async () => {
      vi.mocked(getDemoOverride).mockResolvedValue({
        enabled: true,
        overrideArchetype: 'family_buyer',
        overrideModel: 'claude-forced-model',
      });
      expect(await run({ similarity: 0.2, outcome: { kind: 'success' } })).toMatchInlineSnapshot(`
      {
        "body": {
          "archetype": "family_buyer",
          "confidence": 0.95,
          "demo_override": true,
          "directives": [
            {
              "archetype": "yield_hunter",
              "confidence": 0.9,
              "slot": "headline",
              "type": "text",
              "value": "Generated headline",
            },
          ],
          "page_context": 2,
          "session_id": "sess-follow1287",
          "similarity": 0.75,
          "source": "llm_tweaked",
          "variant": "control",
        },
        "decisionRow": {
          "param_p_archetype": "family_buyer",
          "param_p_confidence": "0.95",
          "param_p_demo_override": "1",
          "param_p_directive_count": "1",
          "param_p_features_snapshot": "{"archetype":"family_buyer","confidence":0.95,"similarity":0.75,"source":"llm_tweaked","page_context":2,"page_context_source":"page_type_derived","holdout":false,"variant":"control"}",
          "param_p_holdout_group": "0",
          "param_p_holdout_pct": "0",
          "param_p_lead_id": "",
          "param_p_model_version": "rulebased-bandit-v1",
          "param_p_page_context": "2",
          "param_p_page_context_source": "page_type_derived",
          "param_p_session_id": "sess-follow1287",
          "param_p_similarity": "0.75",
          "param_p_source": "llm_tweaked",
          "param_p_tenant_id": "tenant-follow1287",
          "param_p_variant": "control",
        },
        "gatewayInput": {
          "archetypeId": "family_buyer",
          "basePlaybook": "getPlaybook(family_buyer)",
          "confidence": 0.95,
          "forceModel": "claude-forced-model",
          "groundingMissing": false,
          "listingContext": {
            "listing_description": "A calm, well-connected home in the old town.",
            "listing_location": "Lisbon",
            "listing_price": "450000 EUR",
            "listing_title": "Sunlit apartment with river views",
          },
          "sessionId": "sess-follow1287",
          "similarity": 0.75,
          "tenantId": "tenant-follow1287",
        },
        "onFallbackWasFunction": true,
      }
    `);
    });

    it('exactly one gateway call per LLM-band request, and none on branches 1 and 2', async () => {
      await run({ similarity: 0.7, outcome: { kind: 'null' } });
      expect(callLlmGateway).toHaveBeenCalledTimes(1);
      vi.mocked(callLlmGateway).mockClear();
      await run({ similarity: 0.95, outcome: { kind: 'success' } });
      expect(callLlmGateway).not.toHaveBeenCalled();
    });
  });

  __H.active = null;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.variant.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.variant.test.ts — Tests for FOLLOW-007 / FOLLOW-342 — Thompson sampling variant selection wired into', () => {
  /**
   * Tests for FOLLOW-007 / FOLLOW-342 — Thompson sampling variant selection wired into
   * the canonical POST /api/adapt route, and variant reaching copy selection.
   *
   * Coverage:
   *  - Response body includes `variant` field (non-empty string)
   *  - All-paused arms → `variant: 'control'` (thompsonSample returns null)
   *  - `getBanditArms` called with (tenant_id, archetype) — auto-seed path
   *  - ClickHouse INSERT carries the selected variant in the column list
   *  - FOLLOW-342: 3 arms produce distinct textDirectives[0].value when playbook has variants.en
   *  - FOLLOW-342 AC-2: fallback to slot.en when variants is absent from the slot
   *
   * @module apps/control-plane/src/app/api/adapt/route.variant.test
   */

  const mockGetBanditArms = (() => vi.fn())();
  const __reg = new Map<string, Record<string, unknown>>();
  // Bypass JWT verification — these tests focus on variant/bandit wiring, not auth.
  __reg.set(
    '@/lib/demo-jwt-verify',
    (() => ({
      verifyDemoJwt: vi.fn().mockResolvedValue({}),
      DemoJwtSecretMissingError: class DemoJwtSecretMissingError extends Error {},
      DemoJwtInvalidError: class DemoJwtInvalidError extends Error {},
    }))(),
  );
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
    '@/lib/rag-retrieval',
    (() => ({
      retrieveListingContext: vi.fn().mockResolvedValue({}),
    }))(),
  );
  // FOLLOW-1163 / ESC-077: the `cta` carries variants, and that is load-bearing for this file.
  //
  // This file's subject is that a sampled arm reaches the response, the ClickHouse log AND the
  // served copy. Under MASTER_DESIGN §E.7.0 the playbook `headline` is withheld on the paths that
  // serve template copy, so a headline is no longer anywhere to observe that. Worse, ESC-077 option
  // 2 then records `control` whenever NOTHING served differs between arms — correctly — so a
  // fixture whose only variant-bearing slot is the headline can no longer demonstrate the
  // mechanism at all.
  //
  // Putting the variants on the `cta`, which survives the withhold, restores the end-to-end
  // observation. **No shipped playbook has cta variants today** — `headline` is the only slot with
  // `variants.en` in all 18 — so this is a MECHANISM fixture, not a claim about shipped shape. It
  // is also the shape FOLLOW-1164 is expected to produce once slots become briefs.
  __reg.set(
    '@estalara/sdk/playbooks',
    (() => ({
      getPlaybook: vi.fn(() => ({
        slots: [
          { slot: 'headline', en: 'High-yield investment property' },
          {
            slot: 'cta',
            en: 'View ROI Analysis',
            variants: { en: ['View ROI Analysis', 'See the Numbers', 'Request the Pack'] },
          },
        ],
      })),
    }))(),
  );
  __reg.set(
    '@/lib/tenant-schema',
    (() => ({
      getTenantSchema: vi.fn().mockResolvedValue({
        reorder_capable: true,
        container_selector: '[data-estalara-listings-grid]',
        item_selector: '[data-estalara-listing-id]',
      }),
    }))(),
  );
  // FOLLOW-397: include SEED_VARIANTS so VARIANT_INDEX is derived correctly at module load.
  __reg.set(
    '@/lib/bandit-query',
    (() => ({
      SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
      getBanditArms: mockGetBanditArms,
    }))(),
  );
  __H.active = __reg;
  beforeAll(() => {
    __H.active = __reg;
  });
  afterAll(() => {
    __H.active = null;
  });

  // ── Mocks (must be hoisted before route import) ──────────────────────────────

  const VALID_BODY = {
    tenant_id: 'est_demo_tenant',
    session_id: 'sess-variant-001',
    page_type: 'listing_list' as const,
    archetype_hint: 'yield_hunter',
    confidence: 0.8,
    similarity: 0.9,
    holdout_pct: 0.0,
    consent_state: 'granted',
    consent_mode_enabled: false,
  };

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

  // FOLLOW-1286 (D3): this file pins the pre-freeze bandit behaviour, which now runs only with
  // BANDIT_ENABLED=true. The frozen default (flag off) is pinned by `lib/__tests__/bandit-flag.test.ts`,
  // `api/adapt/route.bandit-freeze.test.ts` and each frozen route's own `BANDIT_ENABLED off` block.
  beforeEach(() => {
    vi.stubEnv('BANDIT_ENABLED', 'true');
  });

  describe('POST /api/adapt — FOLLOW-007: response includes variant', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockGetBanditArms.mockResolvedValue([
        { variant: 'control', alpha: 1, beta: 1, paused: false },
        { variant: 'v1', alpha: 1, beta: 1, paused: false },
        { variant: 'v2', alpha: 1, beta: 1, paused: false },
      ]);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it('response body includes a non-empty `variant` string', async () => {
      const res = await POST(makePostRequest(VALID_BODY));
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(typeof body.variant).toBe('string');
      expect((body.variant as string).length).toBeGreaterThan(0);
      expect(['control', 'v1', 'v2']).toContain(body.variant);
    });

    it('getBanditArms is called with the tenant_id and archetype from the request', async () => {
      await POST(makePostRequest({ ...VALID_BODY, archetype_hint: 'family_buyer' }));

      expect(getBanditArms).toHaveBeenCalledOnce();
      expect(getBanditArms).toHaveBeenCalledWith('est_demo_tenant', 'family_buyer');
    });

    it('all-paused arms → variant: "control" in response', async () => {
      mockGetBanditArms.mockResolvedValue([
        { variant: 'control', alpha: 5, beta: 1, paused: true },
        { variant: 'v1', alpha: 1, beta: 10, paused: true },
        { variant: 'v2', alpha: 3, beta: 2, paused: true },
      ]);

      const res = await POST(makePostRequest(VALID_BODY));
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.variant).toBe('control');
    });

    it('empty arms (DB unavailable) → variant: "control" in response', async () => {
      mockGetBanditArms.mockResolvedValue([]);

      const res = await POST(makePostRequest(VALID_BODY));
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.variant).toBe('control');
    });

    it('single active arm → that variant is returned deterministically', async () => {
      mockGetBanditArms.mockResolvedValue([
        { variant: 'control', alpha: 1, beta: 1, paused: true },
        { variant: 'v1', alpha: 1, beta: 1, paused: false },
        { variant: 'v2', alpha: 1, beta: 1, paused: true },
      ]);

      const res = await POST(makePostRequest(VALID_BODY));
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.variant).toBe('v1');
    });

    it('existing fields (directives, source, archetype) coexist with variant', async () => {
      const res = await POST(makePostRequest(VALID_BODY));
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.directives).toBeDefined();
      expect(body.source).toBeDefined();
      expect(body.archetype).toBeDefined();
      expect(body.variant).toBeDefined();
    });
  });

  describe('POST /api/adapt — FOLLOW-007: ClickHouse INSERT carries variant', () => {
    let lastFetchBody: string | null = null;
    let lastFetchUrl: string | null = null;

    beforeEach(() => {
      vi.clearAllMocks();
      lastFetchBody = null;
      lastFetchUrl = null;
      vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: unknown, opts?: { body?: string }) => {
          // FOLLOW-1061: the route now writes TWO ClickHouse rows per treatment request —
          // the `adaptation_decisions` row and the `llm_calls` pre-LLM segment row. This
          // capture names the one this suite is about instead of trusting call order.
          if (!(opts?.body ?? '').includes('INSERT INTO adaptation_decisions')) {
            return Promise.resolve(new Response('', { status: 200 }));
          }
          lastFetchUrl = typeof url === 'string' ? url : null;
          lastFetchBody = opts?.body ?? null;
          return Promise.resolve(new Response('', { status: 200 }));
        }),
      );
      // Make thompsonSample deterministic: only `v1` is active.
      mockGetBanditArms.mockResolvedValue([
        { variant: 'control', alpha: 1, beta: 1, paused: true },
        { variant: 'v1', alpha: 1, beta: 1, paused: false },
        { variant: 'v2', alpha: 1, beta: 1, paused: true },
      ]);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it('INSERT includes the variant column name', async () => {
      await POST(makePostRequest(VALID_BODY));
      expect(lastFetchBody).not.toBeNull();
      expect(lastFetchBody).toContain('variant');
    });

    it('INSERT passes selected variant value as URL param (FOLLOW-261 parameterized)', async () => {
      await POST(makePostRequest(VALID_BODY));
      expect(lastFetchUrl).not.toBeNull();
      const parsedUrl = new URL(lastFetchUrl!);
      expect(parsedUrl.searchParams.get('param_p_variant')).toBe('v1');
    });

    it('all-paused path passes `control` to ClickHouse as URL param (FOLLOW-261)', async () => {
      mockGetBanditArms.mockResolvedValue([
        { variant: 'control', alpha: 1, beta: 1, paused: true },
        { variant: 'v1', alpha: 1, beta: 1, paused: true },
        { variant: 'v2', alpha: 1, beta: 1, paused: true },
      ]);

      await POST(makePostRequest(VALID_BODY));
      expect(lastFetchUrl).not.toBeNull();
      const parsedUrl = new URL(lastFetchUrl!);
      expect(parsedUrl.searchParams.get('param_p_variant')).toBe('control');
    });
  });

  // ─── FOLLOW-342: variant reaches copy selection ───────────────────────────────

  describe('POST /api/adapt — FOLLOW-342: bandit variant reaches playbook copy selection', () => {
    /**
     * A mock playbook where the headline slot has 3 distinct variants.en entries.
     * Simulates the structure already present on non-neutral archetypes (e.g. yield_hunter).
     */
    const PLAYBOOK_WITH_VARIANTS = {
      slots: [
        { slot: 'headline', en: 'Default headline' },
        {
          // FOLLOW-1163: the variants live on the SERVED slot — see the note on the module-level
          // playbook mock above. §E.7.0 withholds the headline, so observing arm→copy through it
          // is no longer possible.
          slot: 'cta',
          en: 'Default cta (control)',
          variants: {
            en: ['Default cta (control)', 'Variant 1 cta', 'Variant 2 cta'],
          },
        },
      ],
    };

    beforeEach(() => {
      vi.clearAllMocks();
      vi.mocked(getPlaybook).mockReturnValue(
        PLAYBOOK_WITH_VARIANTS as ReturnType<typeof getPlaybook>,
      );
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    /**
     * AC-4 (FOLLOW-342): The 3 bandit arms must produce distinct served values when the slot
     * carries variants.en with 3 entries.
     *
     * FOLLOW-1163: observed on the `cta`, because §E.7.0 withholds the playbook `headline`. The
     * property under test — a sampled arm index reaching served copy — is unchanged.
     *
     * Strategy: force each arm to be the sole active arm in turn, then assert the
     * returned headline value matches the expected variants.en[index] entry.
     * This is deterministic — thompsonSample returns the only active arm's variant.
     */
    it('control arm → textDirectives[0].value is variants.en[0]', async () => {
      mockGetBanditArms.mockResolvedValue([
        { variant: 'control', alpha: 1, beta: 1, paused: false },
        { variant: 'v1', alpha: 1, beta: 1, paused: true },
        { variant: 'v2', alpha: 1, beta: 1, paused: true },
      ]);

      const res = await POST(makePostRequest({ ...VALID_BODY, page_type: 'listing_detail' }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        directives: { type: string; slot: string; value: string }[];
      };
      const cta = body.directives.find((d) => d.type === 'text' && d.slot === 'cta');
      expect(cta?.value).toBe('Default cta (control)');
    });

    it('v1 arm → textDirectives[0].value is variants.en[1]', async () => {
      mockGetBanditArms.mockResolvedValue([
        { variant: 'control', alpha: 1, beta: 1, paused: true },
        { variant: 'v1', alpha: 1, beta: 1, paused: false },
        { variant: 'v2', alpha: 1, beta: 1, paused: true },
      ]);

      const res = await POST(makePostRequest({ ...VALID_BODY, page_type: 'listing_detail' }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        directives: { type: string; slot: string; value: string }[];
      };
      const cta = body.directives.find((d) => d.type === 'text' && d.slot === 'cta');
      expect(cta?.value).toBe('Variant 1 cta');
    });

    it('v2 arm → textDirectives[0].value is variants.en[2]', async () => {
      mockGetBanditArms.mockResolvedValue([
        { variant: 'control', alpha: 1, beta: 1, paused: true },
        { variant: 'v1', alpha: 1, beta: 1, paused: true },
        { variant: 'v2', alpha: 1, beta: 1, paused: false },
      ]);

      const res = await POST(makePostRequest({ ...VALID_BODY, page_type: 'listing_detail' }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        directives: { type: string; slot: string; value: string }[];
      };
      const cta = body.directives.find((d) => d.type === 'text' && d.slot === 'cta');
      expect(cta?.value).toBe('Variant 2 cta');
    });

    it('all 3 arms produce distinct served values', async () => {
      // FOLLOW-1163: collected from the `cta`, the slot that survives §E.7.0's withhold.
      const results: string[] = [];

      for (const activeVariant of ['control', 'v1', 'v2'] as const) {
        mockGetBanditArms.mockResolvedValue([
          { variant: 'control', alpha: 1, beta: 1, paused: activeVariant !== 'control' },
          { variant: 'v1', alpha: 1, beta: 1, paused: activeVariant !== 'v1' },
          { variant: 'v2', alpha: 1, beta: 1, paused: activeVariant !== 'v2' },
        ]);

        const res = await POST(makePostRequest({ ...VALID_BODY, page_type: 'listing_detail' }));
        const body = (await res.json()) as {
          directives: { type: string; slot: string; value: string }[];
        };
        const cta = body.directives.find((d) => d.type === 'text' && d.slot === 'cta');
        results.push(cta?.value ?? '');
      }

      // All 3 values must be non-empty and distinct from each other.
      expect(results).toHaveLength(3);
      expect(new Set(results).size).toBe(3);
    });

    /**
     * AC-2 (FOLLOW-342): fallback-to-slot.en when a slot has no variants array.
     * The copy selection chain is: locale override ?? variants.en[index] ?? slot.en.
     * When variants is undefined, slot.en must be returned regardless of the bandit index.
     */
    it('AC-2 fallback: slot without variants.en returns slot.en regardless of bandit index', async () => {
      // Playbook with NO variants on the cta slot — only en is present.
      const PLAYBOOK_NO_VARIANTS = {
        slots: [
          {
            slot: 'headline',
            en: 'Headline with no variants',
            // variants intentionally absent
          },
          { slot: 'cta', en: 'CTA with no variants' },
        ],
      };

      vi.mocked(getPlaybook).mockReturnValue(
        PLAYBOOK_NO_VARIANTS as ReturnType<typeof getPlaybook>,
      );

      // Drive v2 arm (index 2) — there is no variants.en[2], so must fall back to slot.en.
      mockGetBanditArms.mockResolvedValue([
        { variant: 'control', alpha: 1, beta: 1, paused: true },
        { variant: 'v1', alpha: 1, beta: 1, paused: true },
        { variant: 'v2', alpha: 1, beta: 1, paused: false },
      ]);

      const res = await POST(makePostRequest({ ...VALID_BODY, page_type: 'listing_detail' }));
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        directives: { type: string; slot: string; value: string }[];
      };

      // FOLLOW-1163: read on the `cta` — the headline is withheld by §E.7.0, and the `cta`
      // assertion this test already made is now the whole test. The property is unchanged: a slot
      // with no `variants.en` must serve `slot.en`, never undefined or ''.
      const cta = body.directives.find((d) => d.type === 'text' && d.slot === 'cta');
      expect(cta?.value).toBe('CTA with no variants');
      // ...and the withheld headline is gone, pinned so the withhold cannot silently stop.
      expect(body.directives.find((d) => d.slot === 'headline')).toBeUndefined();
    });
  });

  __H.active = null;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.follow397.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.follow397.test.ts — FOLLOW-397 — Derive VARIANT_INDEX from SEED_VARIANTS (Rule K.1).', () => {
  /**
   * FOLLOW-397 — Derive VARIANT_INDEX from SEED_VARIANTS (Rule K.1).
   *
   * AC-2 (TG-3 from RETRO-095): verifies that a variant name NOT in SEED_VARIANTS
   * (e.g. a stray 'v3' or 'default') does NOT silently map to index 0 (control copy).
   *
   * Two parts:
   *  Part A (unit): import the exported VARIANT_INDEX and assert directly that unknown
   *    keys are `undefined`. This test is RED if `'default': 0` is present in the map.
   *  Part B (integration): mock thompsonSample to return 'v3' (a stray variant not in
   *    SEED_VARIANTS) and verify the route returns 200 with the base `s.en` copy —
   *    NOT `s.variants.en[0]` (which would be served by the old `?? 0` fallback).
   *    Uses a synthetic playbook where `s.en` differs from `s.variants.en[0]` so the
   *    two code paths produce distinct outputs.
   *
   * AC-3 grep: 'default' must not appear in VARIANT_INDEX after AC-1 (see Part A
   * assertion `expect(VARIANT_INDEX['default']).toBeUndefined()`).
   *
   * @module apps/control-plane/src/app/api/adapt/route.follow397.test
   */

  const __reg = new Map<string, Record<string, unknown>>();
  __reg.set(
    '@/lib/demo-jwt-verify',
    (() => ({
      verifyDemoJwt: vi.fn().mockResolvedValue({}),
      DemoJwtSecretMissingError: class DemoJwtSecretMissingError extends Error {},
      DemoJwtInvalidError: class DemoJwtInvalidError extends Error {},
    }))(),
  );
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
    '@/lib/demo-override-store',
    (() => ({
      getDemoOverride: vi.fn().mockResolvedValue({ enabled: false }),
      DEMO_OVERRIDE_CONFIDENCE: 0.95,
      DEMO_OVERRIDE_SIMILARITY: 0.75,
    }))(),
  );
  __reg.set(
    '@/lib/chat-intent-cache',
    (() => ({
      readShadowChatIntent: vi.fn().mockResolvedValue(null),
      flattenIntentDimensions: vi.fn().mockReturnValue({}),
    }))(),
  );
  __reg.set(
    '@estalara/db',
    (() => ({
      createAdminClient: vi.fn(),
      tenants: { tenantId: 'tenant_id' },
    }))(),
  );
  __reg.set(
    'drizzle-orm',
    (() => ({
      eq: vi.fn(),
    }))(),
  );
  __reg.set(
    '@/lib/embedding-lookup',
    (() => ({
      fetchListingEmbeddings: vi.fn().mockResolvedValue([]),
      fetchArchetypeEmbedding: vi.fn().mockResolvedValue(null),
      LISTING_EMBEDDING_BATCH_LIMIT: 20,
    }))(),
  );
  __reg.set(
    '@estalara/sdk/playbooks',
    (() => ({
      getPlaybook: vi.fn(() => PLAYBOOK_WITH_DISTINCT_BASE),
    }))(),
  );
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
  // Mock @estalara/shared: make thompsonSample return 'v3' (stray variant not in SEED_VARIANTS).
  // vi.clearAllMocks() clears call history only — mockReturnValue('v3') persists across tests.
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
        // 'v3' is not in SEED_VARIANTS — exercises the stray-variant code path.
        thompsonSample: vi.fn().mockReturnValue('v3'),
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

  // ── Mocks (hoisted before route import) ──────────────────────────────────────

  /**
   * Synthetic playbook where `s.en` is intentionally different from `s.variants.en[0]`.
   * This makes the two code paths (old ?? 0 fallback vs new undefined passthrough)
   * produce distinct directive values, so the test can verify which path was taken.
   *
   * With the old `?? 0` fallback: variantIndex = 0 → serves 'CONTROL_VARIANT_COPY'.
   * With the fix (undefined passthrough): variantIndex = undefined → serves 'BASE_EN_COPY'.
   */
  // FOLLOW-1163 / ESC-077: the slot is `cta`, not `headline`.
  //
  // This file's subject is the STRAY-ARM contract — an unrecognised arm name must leave
  // `variantIndex` undefined and fall through to `s.en`, never be coerced to index 0. That is a
  // property of copy SELECTION and is slot-agnostic. It was observed through the headline, and under
  // MASTER_DESIGN §E.7.0 a playbook headline is no longer served at all, so the observation point
  // moves to the `cta`, which survives the withhold. Nothing about the property changes.
  const PLAYBOOK_WITH_DISTINCT_BASE = {
    slots: [
      {
        slot: 'cta',
        en: 'BASE_EN_COPY',
        variants: {
          en: ['CONTROL_VARIANT_COPY', 'V1_VARIANT_COPY', 'V2_VARIANT_COPY'],
        },
      },
    ],
  };

  // VARIANT_INDEX lives in its own module (not exported from the Next.js route file
  // to satisfy Next.js route-export constraints). The @/lib/bandit-query mock above
  // propagates to variant-index.ts via the shared SEED_VARIANTS import.

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  const BASE_POST_BODY = {
    tenant_id: 'est_demo_tenant',
    session_id: 'sess-follow397-001',
    page_type: 'listing_detail' as const,
    archetype_hint: 'yield_hunter',
    confidence: 0.9,
    similarity: 0.9,
    holdout_pct: 0.0,
    consent_state: 'granted',
    consent_mode_enabled: false,
  };

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

  // ─── Part A: unit assertions on VARIANT_INDEX ─────────────────────────────────

  // FOLLOW-1286 (D3): this file pins the pre-freeze bandit behaviour, which now runs only with
  // BANDIT_ENABLED=true. The frozen default (flag off) is pinned by `lib/__tests__/bandit-flag.test.ts`,
  // `api/adapt/route.bandit-freeze.test.ts` and each frozen route's own `BANDIT_ENABLED off` block.
  beforeEach(() => {
    vi.stubEnv('BANDIT_ENABLED', 'true');
  });

  describe('VARIANT_INDEX — FOLLOW-397 AC-2 (Part A): derived from SEED_VARIANTS', () => {
    it('maps known variants to their zero-based index', () => {
      expect(VARIANT_INDEX.control).toBe(0);
      expect(VARIANT_INDEX.v1).toBe(1);
      expect(VARIANT_INDEX.v2).toBe(2);
    });

    it('VARIANT_INDEX["v3"] is undefined — stray variant not in SEED_VARIANTS', () => {
      // RED if a hardcoded entry `v3: <number>` exists in the map.
      expect(VARIANT_INDEX.v3).toBeUndefined();
    });

    it('VARIANT_INDEX["default"] is undefined — RED if `default: 0` is present (AC-2)', () => {
      // Key RED-condition check from AC-2: if someone adds `default: 0` back to a
      // hardcoded VARIANT_INDEX, this test fails. GREEN after AC-1.
      expect(VARIANT_INDEX.default).toBeUndefined();
    });

    it('VARIANT_INDEX contains exactly the entries from SEED_VARIANTS — no extras', () => {
      const keys = Object.keys(VARIANT_INDEX).sort();
      expect(keys).toEqual(['control', 'v1', 'v2']);
    });
  });

  // ─── Part B: integration — stray variant handled gracefully ──────────────────

  describe('POST /api/adapt — FOLLOW-397 AC-2 (Part B): stray variant falls through to s.en', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it('returns HTTP 200 when thompsonSample returns a stray variant ("v3")', async () => {
      const res = await POST(makePostRequest(BASE_POST_BODY));
      expect(res.status).toBe(200);
    });

    it(
      'directive value is s.en ("BASE_EN_COPY"), not s.variants.en[0] ("CONTROL_VARIANT_COPY") ' +
        '— proves undefined variantIndex is not coerced to 0',
      async () => {
        const res = await POST(makePostRequest(BASE_POST_BODY));
        expect(res.status).toBe(200);

        const body = (await res.json()) as {
          variant: string;
          directives: { type: string; slot: string; value: string }[];
        };

        // The selected (and logged) variant is the stray 'v3'.
        expect(body.variant).toBe('v3');

        // With the old `?? 0` fallback: variantIndex = 0 → 'CONTROL_VARIANT_COPY'.
        // With the fix (undefined passthrough): variantIndex = undefined → s.en = 'BASE_EN_COPY'.
        // The two values are deliberately distinct in PLAYBOOK_WITH_DISTINCT_BASE.
        const cta = body.directives.find((d) => d.type === 'text' && d.slot === 'cta');
        expect(cta?.value).toBe('BASE_EN_COPY');
        expect(cta?.value).not.toBe('CONTROL_VARIANT_COPY');
      },
    );
  });

  __H.active = null;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.follow362.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.follow362.test.ts — FOLLOW-362 — Fix locale/A/B variant logging mismatch.', () => {
  /**
   * FOLLOW-362 — Fix locale/A/B variant logging mismatch.
   *
   * Problem (RETRO-095 §4a LG-2): `thompsonSample()` ran for every locale and
   * logged v1/v2 to ClickHouse, but no playbook has `variants.pl` or `variants.es`
   * arrays. For `pl`/`es` sessions `runDecisionTree` always served the single
   * locale string (`s.pl`/`s.es`), which is indistinguishable from control copy —
   * so the logged variant did NOT match the copy actually served.
   *
   * Fix: suppress bandit sampling (and log `variant: 'control'`) whenever
   * `locale !== 'en'`, on the POST handler (the GET handler was retired by FOLLOW-1287).
   *
   * AC-3 assertion: a `pl` locale request must have `response.variant` equal to
   * `ClickHouse param_p_variant`, and both must equal `'control'` (not v1/v2),
   * even when only the v1 arm is active.
   *
   * Rule S: all three supported locales are exercised (en / pl / es).
   * Rule K.1: the logged variant and the copy-selection variant agree on one
   *   variable (`getHandlerVariant` / `selectedVariant`) for every code path.
   *
   * @module apps/control-plane/src/app/api/adapt/route.follow362.test
   */

  const mockGetBanditArms = (() => vi.fn())();
  const __reg = new Map<string, Record<string, unknown>>();
  __reg.set(
    '@/lib/demo-jwt-verify',
    (() => ({
      verifyDemoJwt: vi.fn().mockResolvedValue({}),
      DemoJwtSecretMissingError: class DemoJwtSecretMissingError extends Error {},
      DemoJwtInvalidError: class DemoJwtInvalidError extends Error {},
    }))(),
  );
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
    '@estalara/sdk/playbooks',
    (() => ({
      getPlaybook: vi.fn(() => PLAYBOOK_EN_VARIANTS_ONLY),
    }))(),
  );
  // FOLLOW-397: include SEED_VARIANTS so VARIANT_INDEX is derived correctly at module load.
  __reg.set(
    '@/lib/bandit-query',
    (() => ({
      SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
      getBanditArms: mockGetBanditArms,
    }))(),
  );
  // Mock @estalara/shared so thompsonSample is deterministic.
  // This mock makes v1 the only active variant when called — used to confirm
  // that despite v1 being "available", non-en locales suppress it.
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
        // Returns 'v1' when called (single-active-arm scenario).
        thompsonSample: vi.fn().mockReturnValue('v1'),
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

  // ── Mocks (hoisted before route import) ──────────────────────────────────────

  /**
   * Playbook where the headline slot has `variants.en` (only en, no pl/es arrays).
   * This mirrors the real playbooks which never populate `variants.pl` or `variants.es`.
   */
  const PLAYBOOK_EN_VARIANTS_ONLY = {
    slots: [
      {
        slot: 'headline',
        en: 'Control headline (en)',
        pl: 'Nagłówek kontrolny (pl)',
        es: 'Titular de control (es)',
        variants: {
          en: ['Control headline (en)', 'Variant 1 headline (en)', 'Variant 2 headline (en)'],
          // variants.pl and variants.es intentionally absent — reflects real playbook state
        },
      },
      {
        slot: 'cta',
        en: 'View Details (en)',
        pl: 'Zobacz szczegóły (pl)',
        es: 'Ver detalles (es)',
        // FOLLOW-1163 / ESC-077: the `cta` carries en variants HERE so this file can keep testing
        // the LOCALE axis end-to-end. Under MASTER_DESIGN §E.7.0 the headline is withheld on the
        // playbook paths, so it is no longer a place to observe served copy at all — but `cta`
        // survives, and giving it the same en-only variant shape moves the observation point
        // without changing the property under test. `variants.pl` / `variants.es` remain absent,
        // which is the whole point of this file. **No shipped playbook has cta variants**; this is
        // a mechanism fixture, and ESC-077's suppression keys on served slots precisely so that
        // shape works.
        variants: {
          en: ['View Details (en)', 'Variant 1 CTA (en)', 'Variant 2 CTA (en)'],
        },
      },
    ],
  };

  // ─── Helpers ──────────────────────────────────────────────────────────────────

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

  const BASE_POST_BODY = {
    tenant_id: 'est_demo_tenant',
    session_id: 'sess-follow362-post',
    page_type: 'listing_detail' as const,
    archetype_hint: 'yield_hunter',
    confidence: 0.8,
    similarity: 0.9,
    holdout_pct: 0.0,
    consent_state: 'granted',
    consent_mode_enabled: false,
  };

  // Single-active-v1 arms: thompsonSample would pick v1 if called.
  const V1_ONLY_ARMS = [
    { variant: 'control', alpha: 1, beta: 1, paused: true },
    { variant: 'v1', alpha: 1, beta: 1, paused: false },
    { variant: 'v2', alpha: 1, beta: 1, paused: true },
  ];

  // ─── POST handler — AC-3 core suite ──────────────────────────────────────────

  // FOLLOW-1286 (D3): this file pins the pre-freeze bandit behaviour, which now runs only with
  // BANDIT_ENABLED=true. The frozen default (flag off) is pinned by `lib/__tests__/bandit-flag.test.ts`,
  // `api/adapt/route.bandit-freeze.test.ts` and each frozen route's own `BANDIT_ENABLED off` block.
  beforeEach(() => {
    vi.stubEnv('BANDIT_ENABLED', 'true');
  });

  describe('POST /api/adapt — FOLLOW-362: non-en locale suppresses variant sampling', () => {
    let capturedUrl: URL | null = null;

    beforeEach(() => {
      vi.clearAllMocks();
      capturedUrl = null;
      vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: unknown, opts?: { body?: string }) => {
          // FOLLOW-1061: the POST route now writes TWO ClickHouse rows per treatment request —
          // the `adaptation_decisions` row and the `llm_calls` pre-LLM segment row. This capture
          // names the one this suite is about instead of trusting call order.
          if (!(opts?.body ?? '').includes('INSERT INTO adaptation_decisions')) {
            return Promise.resolve(new Response('', { status: 200 }));
          }
          try {
            capturedUrl = new URL(typeof url === 'string' ? url : '');
          } catch {
            capturedUrl = null;
          }
          return Promise.resolve(new Response('', { status: 200 }));
        }),
      );
      // v1 is the only active arm — thompsonSample would return 'v1' if called.
      mockGetBanditArms.mockResolvedValue(V1_ONLY_ARMS);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    // ── AC-3 (core): pl locale → variant in response and ClickHouse both = 'control' ──

    it(
      'AC-3 pl: response.variant=control AND ClickHouse param_p_variant=control ' +
        'even when v1 is the only active arm',
      async () => {
        const res = await POST(makePostRequest({ ...BASE_POST_BODY, locale: 'pl' }));
        expect(res.status).toBe(200);

        const body = (await res.json()) as Record<string, unknown>;

        // Response body must carry 'control', not 'v1'.
        expect(body.variant).toBe('control');

        // ClickHouse INSERT must also carry 'control' (Rule K.1: same variable used for
        // copy selection and logging).
        expect(capturedUrl, 'ClickHouse INSERT URL must be present').not.toBeNull();
        expect(capturedUrl!.searchParams.get('param_p_variant')).toBe('control');
      },
    );

    // Rule S: same assertion for es locale

    it(
      'AC-3 es: response.variant=control AND ClickHouse param_p_variant=control ' +
        'even when v1 is the only active arm',
      async () => {
        const res = await POST(makePostRequest({ ...BASE_POST_BODY, locale: 'es' }));
        expect(res.status).toBe(200);

        const body = (await res.json()) as Record<string, unknown>;

        expect(body.variant).toBe('control');

        expect(capturedUrl, 'ClickHouse INSERT URL must be present').not.toBeNull();
        expect(capturedUrl!.searchParams.get('param_p_variant')).toBe('control');
      },
    );

    // en locale must continue to use the bandit (unchanged behaviour)

    it('en locale: response.variant=v1 AND ClickHouse param_p_variant=v1 (bandit unchanged)', async () => {
      const res = await POST(makePostRequest({ ...BASE_POST_BODY, locale: 'en' }));
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;

      // thompsonSample returns 'v1' (the only non-paused arm).
      expect(body.variant).toBe('v1');

      expect(capturedUrl, 'ClickHouse INSERT URL must be present').not.toBeNull();
      expect(capturedUrl!.searchParams.get('param_p_variant')).toBe('v1');
    });

    // getBanditArms must NOT be called for non-en locales (no wasted DB round-trip)

    it('pl locale: getBanditArms is NOT called (sampling suppressed)', async () => {
      await POST(makePostRequest({ ...BASE_POST_BODY, locale: 'pl' }));
      expect(getBanditArms).not.toHaveBeenCalled();
    });

    it('es locale: getBanditArms is NOT called (sampling suppressed)', async () => {
      await POST(makePostRequest({ ...BASE_POST_BODY, locale: 'es' }));
      expect(getBanditArms).not.toHaveBeenCalled();
    });

    it('en locale: getBanditArms IS called (sampling active)', async () => {
      await POST(makePostRequest({ ...BASE_POST_BODY, locale: 'en' }));
      expect(getBanditArms).toHaveBeenCalledOnce();
    });

    // Verify served copy: pl slot served (not the en variant 1 text)

    it('pl locale: served directive value is the pl slot string, not an en variant', async () => {
      const res = await POST(makePostRequest({ ...BASE_POST_BODY, locale: 'pl' }));
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        directives: { type: string; slot: string; value: string }[];
      };

      // FOLLOW-1163: observed on the `cta`, because §E.7.0 withholds the headline on this path.
      // The property is unchanged and is still the point of the test: a `pl` session must be served
      // the POLISH slot string, never an `en` variant, because `variants.pl` does not exist.
      const cta = body.directives.find((d) => d.type === 'text' && d.slot === 'cta');
      // Must serve the Polish slot string, NOT 'Variant 1 CTA (en)'.
      expect(cta?.value).toBe('Zobacz szczegóły (pl)');
      // The §E.7.0 half of the same response, pinned so the withhold cannot silently stop happening.
      expect(body.directives.find((d) => d.slot === 'headline')).toBeUndefined();
      expect(cta?.value).not.toContain('(en)');
    });
  });

  __H.active = null;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.follow359.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.follow359.test.ts — FOLLOW-359 tests: the response `variant` and the logged `param_p_variant` are ONE value.', () => {
  /**
   * FOLLOW-359 tests: the response `variant` and the logged `param_p_variant` are ONE value.
   *
   * Root cause (FOLLOW-359): the since-retired GET handler sampled a bandit variant, passed it to
   * copy selection and to `logDecisionAsync`, but omitted it from the JSON body — so a consumer
   * could not echo the served arm back. The fix threaded one variable through all three.
   *
   * FOLLOW-1287 retired `GET /api/adapt`. What this file still pins, now on `POST`, is the
   * load-bearing half of that fix: the body's `variant` equals the value logged to ClickHouse,
   * because both read the same variable (`recordedVariant` since FOLLOW-1163). The GET-only cases
   * (AC1 "body has a variant" — duplicated by `route.variant.test.ts`; AC4 GET body shape with
   * `tier`; HOLDOUT COMPAT on a GET body — a POST holdout body carries no `variant`, and its logged
   * `control` is pinned by `route.follow360.test.ts` / `route.holdout.test.ts`) left with the
   * handler.
   *
   * @module apps/control-plane/src/app/api/adapt/route.follow359.test
   */

  const __reg = new Map<string, Record<string, unknown>>();
  __reg.set(
    '@/lib/demo-jwt-verify',
    (() => ({
      verifyDemoJwt: vi.fn().mockResolvedValue({}),
      DemoJwtSecretMissingError: class DemoJwtSecretMissingError extends Error {},
      DemoJwtInvalidError: class DemoJwtInvalidError extends Error {},
    }))(),
  );
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
    '@/lib/rag-retrieval',
    (() => ({
      retrieveListingContext: vi.fn().mockResolvedValue({}),
    }))(),
  );
  __reg.set(
    '@estalara/sdk/playbooks',
    (() => ({
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
    }))(),
  );
  // Return 3 arms so Thompson sampling has something to pick from.
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
  // Deterministic thompsonSample: returns 'v1' for non-holdout requests.
  // This makes the AC2 equality assertion deterministic — both the response
  // body and ClickHouse param must equal 'v1'.
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
        thompsonSample: vi.fn().mockReturnValue('v1'),
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

  // ── Mocks (hoisted before route import) ──────────────────────────────────────

  // FOLLOW-473: GET auth is now the shared two-step resolver (resolveAdaptGetAuth).
  // Mock it to the deterministic tenant this suite exercises — the real auth
  // mechanics are covered end-to-end in route.follow473.test.ts.
  // FOLLOW-1163: read back through the mocked module so AC2 can assert that sampling still RAN,
  // which is what stops "always control" from satisfying the case vacuously.

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  function makePostRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest('http://localhost/api/adapt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer demo_key' },
      body: JSON.stringify(body),
    });
  }

  const BASE_BODY = {
    tenant_id: 'tenant-follow359',
    session_id: 'sess-follow359-001',
    page_type: 'listing_detail',
    archetype_hint: 'yield_hunter',
    confidence: 0.8,
    similarity: 0.9,
  };

  // ─── FOLLOW-359 test suite ─────────────────────────────────────────────────────

  // FOLLOW-1286 (D3): this file pins the pre-freeze bandit behaviour, which now runs only with
  // BANDIT_ENABLED=true. The frozen default (flag off) is pinned by `lib/__tests__/bandit-flag.test.ts`,
  // `api/adapt/route.bandit-freeze.test.ts` and each frozen route's own `BANDIT_ENABLED off` block.
  beforeEach(() => {
    vi.stubEnv('BANDIT_ENABLED', 'true');
  });

  describe('POST /api/adapt — FOLLOW-359: response variant equals the logged variant', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
      vi.stubEnv('ADAPT_API_KEY', '');
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    // Both fields must be set from the SAME variable (`recordedVariant`, FOLLOW-1163 / ESC-077).
    //
    // The concrete value: this request lands on branch 2 with no listing context, so under
    // MASTER_DESIGN §E.7.0 the headline is withheld and the `cta` alone is served — and this file's
    // playbook fixture gives `cta` no `variants.en`, so all three arms serve identical copy and the
    // recorded variant is `control`. The test therefore also asserts that sampling still RAN.
    // Without that, "always control" would satisfy this case even if the bandit had been ripped out.
    it(
      'AC2: response `variant` equals ClickHouse param_p_variant — same variable used for both ' +
        '(FOLLOW-359 core assertion)',
      async () => {
        let capturedUrl: URL | null = null;
        vi.stubGlobal(
          'fetch',
          vi.fn().mockImplementation((url: unknown, opts?: { body?: string }) => {
            if (typeof url === 'string' && (opts?.body ?? '').includes('adaptation_decisions')) {
              capturedUrl = new URL(url);
            }
            return Promise.resolve(new Response('', { status: 200 }));
          }),
        );

        const res = await POST(makePostRequest(BASE_BODY));
        expect(res.status).toBe(200);

        const body = (await res.json()) as Record<string, unknown>;
        const responseVariant = body.variant as string;
        await new Promise((r) => setTimeout(r, 0));

        // ClickHouse INSERT must have fired.
        expect(capturedUrl, 'ClickHouse INSERT URL must be present').not.toBeNull();
        const clickhouseVariant = capturedUrl!.searchParams.get('param_p_variant');

        // Core: the same value must appear in both the response body and the log.
        expect(responseVariant).toBe(clickhouseVariant);

        // FOLLOW-1163 / ESC-077: `control`, because this response carried no slot that differs
        // between arms. See the note above.
        expect(responseVariant).toBe('control');

        // ...and the suppression is a RECORDING decision, not the bandit being switched off:
        // sampling still ran for this request.
        expect(getBanditArms).toHaveBeenCalled();
      },
    );
  });

  __H.active = null;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.bandit-freeze.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.bandit-freeze.test.ts — FOLLOW-1286 (CEO ruling D3) — the Thompson-sampling bandit is frozen by default.', () => {
  /**
   * FOLLOW-1286 (CEO ruling D3) — the Thompson-sampling bandit is frozen by default.
   *
   * With `BANDIT_ENABLED` unset (the default) or anything but `'true'`, `POST /api/adapt` (GET was retired by FOLLOW-1287):
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

  const mockGetBanditArms = (() => vi.fn())();
  const mockThompsonSample = (() => vi.fn())();
  const __reg = new Map<string, Record<string, unknown>>();
  __reg.set(
    '@/lib/demo-jwt-verify',
    (() => ({
      verifyDemoJwt: vi.fn().mockResolvedValue({}),
      DemoJwtSecretMissingError: class DemoJwtSecretMissingError extends Error {},
      DemoJwtInvalidError: class DemoJwtInvalidError extends Error {},
    }))(),
  );
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
    '@estalara/sdk/playbooks',
    (() => ({
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
    }))(),
  );
  __reg.set(
    '@/lib/bandit-query',
    (() => ({
      SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
      getBanditArms: mockGetBanditArms,
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
        thompsonSample: mockThompsonSample,
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

  function makePost(): NextRequest {
    return new NextRequest('http://localhost/api/adapt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer demo_key' },
      body: JSON.stringify(POST_BODY),
    });
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
  });

  __H.active = null;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.demo.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.demo.test.ts — DEMO MODE tests for POST /api/adapt — DEMO-001.', () => {
  /**
   * DEMO MODE tests for POST /api/adapt — DEMO-001.
   *
   * Coverage (AC4, AC6, AC7a, AC7b):
   *   - When DEMO MODE is on: endpoint uses the override archetype (not archetype_hint)
   *     at DEMO_OVERRIDE_CONFIDENCE/SIMILARITY so the decision tree runs adaptation.
   *   - When DEMO MODE is off: endpoint uses the SDK's archetype_hint unchanged.
   *   - Response includes demo_override=true flag when active (AC6).
   *   - When getDemoOverride throws (DB configured-but-failed), falls back to SDK hint
   *     and does NOT set demo_override flag (Rule K.2 degrade gracefully on decision path).
   *
   * @module apps/control-plane/src/app/api/adapt/route.demo.test
   */

  const { mockGetDemoOverride } = (() => ({
    mockGetDemoOverride: vi.fn(),
  }))();
  const __reg = new Map<string, Record<string, unknown>>();
  // Bypass JWT verification — these tests focus on demo-override logic, not auth.
  __reg.set(
    '@/lib/demo-jwt-verify',
    (() => ({
      verifyDemoJwt: vi.fn().mockResolvedValue({}),
      DemoJwtSecretMissingError: class DemoJwtSecretMissingError extends Error {},
      DemoJwtInvalidError: class DemoJwtInvalidError extends Error {},
    }))(),
  );
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
      getDemoOverride: mockGetDemoOverride,
      DEMO_OVERRIDE_CONFIDENCE: 0.95,
      DEMO_OVERRIDE_SIMILARITY: 0.75,
    }))(),
  );
  __reg.set(
    '@estalara/shared',
    (() => {
      // Spread the real shared module and override only the functions the adapt route uses
      // from this module. We import it explicitly to avoid using forbidden `import()` generics.
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

  // ─── Hoisted stubs ────────────────────────────────────────────────────────────

  // ─── Mocks ────────────────────────────────────────────────────────────────────

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  const TENANT_ID = '550e8400-e29b-41d4-a716-446655440001';

  function makePostRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest('http://localhost/api/adapt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_key',
      },
      body: JSON.stringify(body),
    });
  }

  const BASE_BODY = {
    tenant_id: TENANT_ID,
    session_id: 'sess-demo-001',
    page_type: 'listing_detail',
    archetype_hint: 'neutral',
    confidence: 0.5,
    similarity: 0.5,
  };

  async function parseBody<T>(res: Response): Promise<T> {
    return (await res.json()) as T;
  }

  // ─── Tests ────────────────────────────────────────────────────────────────────

  describe('POST /api/adapt — DEMO MODE override (DEMO-001 AC4, AC6, AC7a, AC7b)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      // Default: demo mode off
      mockGetDemoOverride.mockResolvedValue({
        enabled: false,
        overrideArchetype: null,
        overrideModel: 'claude-sonnet-4-6',
      });
    });

    it('AC7b — when DEMO MODE is off, uses archetype_hint from body unchanged', async () => {
      mockGetDemoOverride.mockResolvedValue({
        enabled: false,
        overrideArchetype: 'luxury_buyer',
        overrideModel: 'claude-sonnet-4-6',
      });

      const res = await POST(makePostRequest({ ...BASE_BODY, archetype_hint: 'neutral' }));
      expect(res.status).toBe(200);

      const body = await parseBody<Record<string, unknown>>(res);
      // Since DEMO is off, archetype from response must be the SDK hint (neutral)
      expect(body.archetype).toBe('neutral');
      expect(body.demo_override).toBeUndefined();
    });

    it('AC7a — when DEMO MODE is on, uses override archetype regardless of archetype_hint', async () => {
      mockGetDemoOverride.mockResolvedValue({
        enabled: true,
        overrideArchetype: 'yield_hunter',
        overrideModel: 'claude-haiku-4-5-20251001',
      });

      const res = await POST(makePostRequest({ ...BASE_BODY, archetype_hint: 'neutral' }));
      expect(res.status).toBe(200);

      const body = await parseBody<Record<string, unknown>>(res);
      // DEMO MODE is on — archetype must be yield_hunter not neutral
      expect(body.archetype).toBe('yield_hunter');
      // Confidence must be DEMO_OVERRIDE_CONFIDENCE (0.95)
      expect(body.confidence).toBe(0.95);
    });

    it('AC6 — demo_override flag is true in response when DEMO MODE is on', async () => {
      mockGetDemoOverride.mockResolvedValue({
        enabled: true,
        overrideArchetype: 'family_buyer',
        overrideModel: 'claude-sonnet-4-6',
      });

      const res = await POST(makePostRequest({ ...BASE_BODY }));
      expect(res.status).toBe(200);

      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.demo_override).toBe(true);
    });

    it('AC6 — demo_override flag is absent in response when DEMO MODE is off', async () => {
      mockGetDemoOverride.mockResolvedValue({
        enabled: false,
        overrideArchetype: null,
        overrideModel: 'claude-sonnet-4-6',
      });

      const res = await POST(makePostRequest({ ...BASE_BODY }));
      expect(res.status).toBe(200);

      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.demo_override).toBeUndefined();
    });

    it('falls back to SDK hint when getDemoOverride throws (Rule K.2 degrade)', async () => {
      mockGetDemoOverride.mockRejectedValue(new Error('DB connection refused'));

      const res = await POST(makePostRequest({ ...BASE_BODY, archetype_hint: 'downsizer' }));
      expect(res.status).toBe(200);

      const body = await parseBody<Record<string, unknown>>(res);
      // Should fall back to the SDK hint (downsizer) with normal confidence
      expect(body.archetype).toBe('downsizer');
      expect(body.confidence).toBe(0.5);
      expect(body.demo_override).toBeUndefined();
    });
  });

  __H.active = null;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.chat-intent.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.chat-intent.test.ts — FOLLOW-101 tests for POST /api/adapt — chat-intent shadow prior bridge (AC-1, AC-2, AC-3).', () => {
  /**
   * FOLLOW-101 tests for POST /api/adapt — chat-intent shadow prior bridge (AC-1, AC-2, AC-3).
   *
   * Coverage:
   *   AC-1: Redis contains a valid shadow key → response includes chat_intent_dimensions
   *         with flattened (non-null) dimensions.
   *   AC-2: Redis key absent → response has no chat_intent_dimensions field.
   *   AC-3: Redis throws → response proceeds normally with no chat_intent_dimensions
   *         (fail-open).
   *   AC-extra: tax_aware=true → included as 'true' string; null/undefined values omitted.
   *
   * @module apps/control-plane/src/app/api/adapt/route.chat-intent.test
   */

  const { mockReadShadowChatIntent } = (() => ({
    mockReadShadowChatIntent: vi.fn(),
  }))();
  const __reg = new Map<string, Record<string, unknown>>();
  // Demo JWT bypass — these tests focus on chat-intent logic, not auth.
  __reg.set(
    '@/lib/demo-jwt-verify',
    (() => ({
      verifyDemoJwt: vi.fn().mockResolvedValue({}),
      DemoJwtSecretMissingError: class DemoJwtSecretMissingError extends Error {},
      DemoJwtInvalidError: class DemoJwtInvalidError extends Error {},
    }))(),
  );
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
      getDemoOverride: vi.fn().mockResolvedValue({ enabled: false, overrideArchetype: null }),
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
  // Mock the chat-intent cache helper — unit under test is the route, not the cache.
  __reg.set(
    '@/lib/chat-intent-cache',
    (() => ({
      readShadowChatIntent: mockReadShadowChatIntent,
      flattenIntentDimensions: (dims: Record<string, unknown>) => {
        // Thin wrapper matching the real implementation for test predictability.
        const result: Record<string, string> = {};
        for (const [k, v] of Object.entries(dims)) {
          if (v === null || v === undefined) continue;
          if (typeof v === 'boolean') {
            if (v) result[k] = 'true';
          } else if (typeof v === 'string' && v.length > 0) {
            result[k] = v;
          }
        }
        return result;
      },
    }))(),
  );
  __H.active = __reg;
  beforeAll(() => {
    __H.active = __reg;
  });
  afterAll(() => {
    __H.active = null;
  });

  // ─── Hoisted stubs ────────────────────────────────────────────────────────────

  // ─── Mocks ────────────────────────────────────────────────────────────────────

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  const TENANT_ID = '550e8400-e29b-41d4-a716-446655440099';

  function makePostRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest('http://localhost/api/adapt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_key',
      },
      body: JSON.stringify(body),
    });
  }

  const BASE_BODY = {
    tenant_id: TENANT_ID,
    session_id: 'sess-chat-001',
    page_type: 'listing_detail',
    archetype_hint: 'neutral',
    confidence: 0.5,
    similarity: 0.5,
  };

  async function parseBody<T>(res: Response): Promise<T> {
    return (await res.json()) as T;
  }

  // ─── Tests ────────────────────────────────────────────────────────────────────

  describe('POST /api/adapt — chat-intent shadow bridge (FOLLOW-101)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('AC-1: Redis contains valid shadow key → response includes chat_intent_dimensions', async () => {
      mockReadShadowChatIntent.mockResolvedValue({
        intent_dimensions: {
          purchase_purpose: 'investment',
          geo_priority: 'school_district',
          tax_aware: null, // null → should be omitted
          urgency: null, // null → should be omitted
        },
        archetype_hint: 'yield_hunter',
        confidence: 0.82,
      });

      const res = await POST(makePostRequest(BASE_BODY));
      expect(res.status).toBe(200);

      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.chat_intent_dimensions).toEqual({
        purchase_purpose: 'investment',
        geo_priority: 'school_district',
      });
    });

    it('AC-1: tax_aware=true → included as string "true"', async () => {
      mockReadShadowChatIntent.mockResolvedValue({
        intent_dimensions: {
          tax_aware: true,
          purchase_purpose: 'investment',
        },
      });

      const res = await POST(makePostRequest(BASE_BODY));
      expect(res.status).toBe(200);

      const body = await parseBody<Record<string, unknown>>(res);
      const dims = body.chat_intent_dimensions as Record<string, string> | undefined;
      expect(dims?.tax_aware).toBe('true');
      expect(dims?.purchase_purpose).toBe('investment');
    });

    it('AC-2: Redis key absent (returns null) → no chat_intent_dimensions in response', async () => {
      mockReadShadowChatIntent.mockResolvedValue(null);

      const res = await POST(makePostRequest(BASE_BODY));
      expect(res.status).toBe(200);

      const body = await parseBody<Record<string, unknown>>(res);
      // Field should be absent (not included when null / empty)
      expect(body.chat_intent_dimensions).toBeUndefined();
    });

    it('AC-3: Redis read throws → response proceeds normally, no chat_intent_dimensions', async () => {
      mockReadShadowChatIntent.mockRejectedValue(new Error('Redis connection timeout'));

      const res = await POST(makePostRequest(BASE_BODY));
      // Response must still be 200 (fail-open)
      expect(res.status).toBe(200);

      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.chat_intent_dimensions).toBeUndefined();
      // Standard required fields are present
      expect(typeof body.adapt_decision_id).toBe('string');
      expect(typeof body.archetype).toBe('string');
    });

    it('AC-3: readShadowChatIntent returns shadow with all-null dimensions → no chat_intent_dimensions', async () => {
      mockReadShadowChatIntent.mockResolvedValue({
        intent_dimensions: {
          purchase_purpose: null,
          urgency: null,
          tax_aware: null,
        },
      });

      const res = await POST(makePostRequest(BASE_BODY));
      expect(res.status).toBe(200);

      const body = await parseBody<Record<string, unknown>>(res);
      // All dims were null → flattenIntentDimensions returns {} → field omitted
      expect(body.chat_intent_dimensions).toBeUndefined();
    });
  });

  __H.active = null;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.follow346.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.follow346.test.ts — FOLLOW-346 / FOLLOW-635 tests: chat-intent shadow-read bridge on POST /api/adapt.', () => {
  /**
   * FOLLOW-346 / FOLLOW-635 tests: chat-intent shadow-read bridge on POST /api/adapt.
   *
   * FOLLOW-635 (CEO ruling, option A, 2026-07-24): the `CHAT_NLP_LIVE` flag was
   * vestigial (it gated a `console.info` only) and has been deleted. There is no
   * server-side gate on this path: `chat_intent_dimensions` is attached
   * unconditionally whenever the Redis shadow key has data, and it IS
   * live-influencing across calls via the SDK's `applyChatIntentPrior` → next-call
   * `archetype_hint` loop (tested in `packages/sdk`), not "shadow-only." This file
   * covers only the server-side POST /api/adapt read+response contract.
   *
   * Coverage:
   *   AC-LIVE-1: chat_intent_dimensions is attached unconditionally (no flag/env
   *              var required) when the shadow key has data, for the CURRENT
   *              request/response — the directive-influence happens on the NEXT
   *              adapt call via the SDK client loop, not on this one.
   *   AC-LIVE-2: shadow key absent → no chat_intent_dimensions, adaptation unchanged.
   *   AC-LIVE-3: No raw chat text fields appear in the adapt response (DPIA C-07).
   *   AC-LIVE-4: Shadow key read failure (fail-open) does not change the directives.
   *
   * @module apps/control-plane/src/app/api/adapt/route.follow346.test
   */

  const { mockReadShadowChatIntent } = (() => ({
    mockReadShadowChatIntent: vi.fn(),
  }))();
  const __reg = new Map<string, Record<string, unknown>>();
  __reg.set(
    '@/lib/demo-jwt-verify',
    (() => ({
      verifyDemoJwt: vi.fn().mockResolvedValue({}),
      DemoJwtSecretMissingError: class DemoJwtSecretMissingError extends Error {},
      DemoJwtInvalidError: class DemoJwtInvalidError extends Error {},
    }))(),
  );
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
      getDemoOverride: vi.fn().mockResolvedValue({ enabled: false, overrideArchetype: null }),
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
    '@/lib/chat-intent-cache',
    (() => ({
      readShadowChatIntent: mockReadShadowChatIntent,
      flattenIntentDimensions: (dims: Record<string, unknown>) => {
        const result: Record<string, string> = {};
        for (const [k, v] of Object.entries(dims)) {
          if (v === null || v === undefined) continue;
          if (typeof v === 'boolean') {
            if (v) result[k] = 'true';
          } else if (typeof v === 'string' && v.length > 0) {
            result[k] = v;
          }
        }
        return result;
      },
    }))(),
  );
  __H.active = __reg;
  beforeAll(() => {
    __H.active = __reg;
  });
  afterAll(() => {
    __H.active = null;
  });

  // ─── Hoisted stubs ────────────────────────────────────────────────────────────

  // ─── Mocks ────────────────────────────────────────────────────────────────────

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  const TENANT_ID = '550e8400-e29b-41d4-a716-446655440099';

  function makePostRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest('http://localhost/api/adapt', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test_key',
      },
      body: JSON.stringify(body),
    });
  }

  const BASE_BODY = {
    tenant_id: TENANT_ID,
    session_id: 'sess-follow346-001',
    page_type: 'listing_detail',
    archetype_hint: 'neutral',
    confidence: 0.5,
    similarity: 0.5,
  };

  async function parseBody<T>(res: Response): Promise<T> {
    return (await res.json()) as T;
  }

  // ─── Tests ────────────────────────────────────────────────────────────────────

  describe('FOLLOW-346 / FOLLOW-635: chat-intent shadow-read bridge (no CHAT_NLP_LIVE gate)', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('AC-LIVE-1: chat_intent_dimensions is attached unconditionally when the shadow key has data', async () => {
      // Shadow key returns intent dimensions
      mockReadShadowChatIntent.mockResolvedValue({
        intent_dimensions: {
          purchase_purpose: 'investment',
          urgency: '0-3mo',
        },
        archetype_hint: 'yield_hunter',
        confidence: 0.8,
      });

      // No CHAT_NLP_LIVE (or any equivalent) env var is set — the flag no longer
      // exists and the read/response is not gated by anything.
      const res = await POST(makePostRequest(BASE_BODY));
      expect(res.status).toBe(200);

      const body = await parseBody<Record<string, unknown>>(res);

      // chat_intent_dimensions IS returned (for SDK applyChatIntentPrior)
      expect(body.chat_intent_dimensions).toBeDefined();
      expect((body.chat_intent_dimensions as Record<string, string>).purchase_purpose).toBe(
        'investment',
      );

      // Directives for THIS response are empty because confidence=0.5 is below the
      // 0.6 threshold (no adaptation on this call) — this is unrelated to chat
      // intent; the chat-driven influence happens on the SDK's NEXT adapt() call
      // via archetype_hint (applyChatIntentPrior), not within this request.
      expect(Array.isArray(body.directives)).toBe(true);
      // source is 'default' because confidence=0.5 <= 0.6 threshold
      expect(body.source).toBe('default');
    });

    it('AC-LIVE-2: shadow key absent → no chat_intent_dimensions, adaptation unchanged', async () => {
      mockReadShadowChatIntent.mockResolvedValue(null);

      const res = await POST(makePostRequest(BASE_BODY));
      expect(res.status).toBe(200);

      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.chat_intent_dimensions).toBeUndefined();
      // Standard adapt response fields are present
      expect(typeof body.adapt_decision_id).toBe('string');
      expect(body.source).toBe('default');
    });

    it('AC-LIVE-3: no raw chat text fields appear in the adapt response (DPIA C-07)', async () => {
      // Shadow key with real intent dimensions
      mockReadShadowChatIntent.mockResolvedValue({
        intent_dimensions: {
          purchase_purpose: 'primary_residence',
          family_stage: 'young_family',
        },
      });

      const res = await POST(makePostRequest(BASE_BODY));
      expect(res.status).toBe(200);

      const body = await parseBody<Record<string, unknown>>(res);

      // chat_intent_dimensions must only contain the 12-dim intent vector fields
      const dims = body.chat_intent_dimensions as Record<string, string> | undefined;
      if (dims !== undefined) {
        // Confirm no raw text fields (e.g. 'content', 'message', 'text', 'raw_message')
        const rawTextKeys = ['content', 'message', 'text', 'raw_message', 'chat_text'];
        for (const key of rawTextKeys) {
          expect(dims).not.toHaveProperty(key);
        }
      }
      // The top-level response should not contain raw chat text fields either
      expect(body).not.toHaveProperty('raw_chat_text');
      expect(body).not.toHaveProperty('chat_message_content');
    });

    it('AC-LIVE-4: shadow read failure → fail-open, directives unaffected', async () => {
      mockReadShadowChatIntent.mockRejectedValue(new Error('Upstash timeout'));

      const res = await POST(makePostRequest(BASE_BODY));
      // Must still be 200 (fail-open)
      expect(res.status).toBe(200);

      const body = await parseBody<Record<string, unknown>>(res);
      // No chat_intent_dimensions when read fails
      expect(body.chat_intent_dimensions).toBeUndefined();
      // Standard response fields still present
      expect(typeof body.adapt_decision_id).toBe('string');
      expect(body.source).toBe('default');
    });
  });

  __H.active = null;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.follow796.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.follow796.test.ts — FOLLOW-796 AC-4 (re-files RETRO-093 §4c TG-1) — POST /api/adapt slot_selectors gate.', () => {
  /**
   * FOLLOW-796 AC-4 (re-files RETRO-093 §4c TG-1) — POST /api/adapt slot_selectors gate.
   *
   * The `slot_selectors` response field was shipped by FOLLOW-340 with no route-level test.
   * This pins the PRE-EXISTING omit-when-empty gate (route.ts: `slotSelectors` is
   * `tenantSchema?.slot_selectors` only when it has ≥1 key, otherwise `undefined`, and the
   * field is spread in conditionally) — none of it is changed by FOLLOW-796.
   *
   * It also pins the VOCABULARY BOUNDARY that FOLLOW-796 depends on: the route emits the
   * DETECTION-vocabulary keys verbatim (`cta_primary`), and the SDK — not the server —
   * translates them to the ADAPTATION vocabulary (`cta`) in
   * packages/sdk/src/core/annotate-slots.ts. If a future change renames server-side, this
   * test fails and forces the SDK translation table to be revisited in the same PR.
   *
   * @module apps/control-plane/src/app/api/adapt/route.follow796.test
   */

  const __reg = new Map<string, Record<string, unknown>>();
  __reg.set(
    '@/lib/demo-jwt-verify',
    (() => ({
      verifyDemoJwt: vi.fn().mockResolvedValue({}),
      DemoJwtSecretMissingError: class DemoJwtSecretMissingError extends Error {},
      DemoJwtInvalidError: class DemoJwtInvalidError extends Error {},
    }))(),
  );
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
    '@/lib/rag-retrieval',
    (() => ({
      retrieveListingContext: vi.fn().mockResolvedValue({}),
    }))(),
  );
  __reg.set(
    '@estalara/sdk/playbooks',
    (() => ({
      getPlaybook: vi.fn(() => ({
        slots: [
          { slot: 'headline', en: 'High-yield investment property' },
          { slot: 'cta', en: 'View ROI Analysis' },
          { slot: 'feature', en: 'Investment Performance' },
        ],
      })),
    }))(),
  );
  __reg.set(
    '@/lib/tenant-schema',
    (() => ({
      getTenantSchema: vi.fn(),
    }))(),
  );
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
  __H.active = __reg;
  beforeAll(() => {
    __H.active = __reg;
  });
  afterAll(() => {
    __H.active = null;
  });

  // ── Mock external dependencies (mirrors route.ab010.test.ts) ─────────────────

  const mockGetTenantSchema = vi.mocked(getTenantSchema);

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  function makePostRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest('http://localhost/api/adapt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer demo_key' },
      body: JSON.stringify(body),
    });
  }

  const BASE_BODY = {
    tenant_id: 'est_demo_tenant',
    session_id: 'sess-follow796-001',
    page_type: 'listing_detail' as const,
    archetype_hint: 'yield_hunter',
    confidence: 0.9,
    similarity: 0.9,
    holdout_pct: 0.0,
  };

  async function postAndParse(): Promise<Record<string, unknown>> {
    const res = await POST(makePostRequest(BASE_BODY));
    expect(res.status).toBe(200);
    return (await res.json()) as Record<string, unknown>;
  }

  // ─── Tests ────────────────────────────────────────────────────────────────────

  describe('POST /api/adapt — FOLLOW-796 AC-4: slot_selectors omit-when-empty gate', () => {
    beforeEach(() => {
      vi.clearAllMocks();
      vi.stubEnv('CLICKHOUSE_URL', '');
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    });

    it('non-empty slot_selectors → included in the response, keys verbatim', async () => {
      mockGetTenantSchema.mockResolvedValue({
        reorder_capable: true,
        slot_selectors: { headline: 'h1.listing-title', cta_primary: 'a.btn-book' },
      });

      const body = await postAndParse();

      expect(body.slot_selectors).toEqual({
        headline: 'h1.listing-title',
        cta_primary: 'a.btn-book',
      });
      // Vocabulary boundary: the server does NOT rename cta_primary → cta.
      // The SDK's annotateSlots() owns that translation (FOLLOW-796).
      expect((body.slot_selectors as Record<string, string>).cta).toBeUndefined();
    });

    it('empty slot_selectors object → field OMITTED from the response', async () => {
      mockGetTenantSchema.mockResolvedValue({ reorder_capable: true, slot_selectors: {} });

      const body = await postAndParse();

      // Omitted, not present-as-{} — the SDK's `if (resp.slot_selectors)` guard and the
      // response payload size both depend on this.
      expect('slot_selectors' in body).toBe(false);
    });

    it('tenant schema without slot_selectors → field omitted', async () => {
      mockGetTenantSchema.mockResolvedValue({
        reorder_capable: true,
        container_selector: '[data-estalara-listings-grid]',
        item_selector: '[data-estalara-listing-id]',
      });

      const body = await postAndParse();

      expect('slot_selectors' in body).toBe(false);
    });

    it('tenant schema lookup returns null → field omitted, response still 200', async () => {
      mockGetTenantSchema.mockResolvedValue(null);

      const body = await postAndParse();

      expect('slot_selectors' in body).toBe(false);
      expect(body.session_id).toBe(BASE_BODY.session_id);
      expect(Array.isArray(body.directives)).toBe(true);
    });
  });

  __H.active = null;
});

// ══════════════════════════════════════════════════════════════════════════════════════════════
// Origin: route.follow1202.test.ts
// ══════════════════════════════════════════════════════════════════════════════════════════════

describe('route.follow1202.test.ts — FOLLOW-1202 / CEO decision #3 (2026-09-13) — `reorder` fails CLOSED when any listing in the', () => {
  /**
   * FOLLOW-1202 / CEO decision #3 (2026-09-13) — `reorder` fails CLOSED when any listing in the
   * batch cannot be scored by cosine. Text directives stay fail-open.
   *
   * WHAT THIS PINS. Before this ticket `buildReorderDirective()` scored an un-embedded listing with
   * a djb2 hash (uniform on `[0, 1)`) and sorted it in ONE array with the embedded listings' cosine
   * similarities (`[-1, 1]`, unclamped, typically ~0.1-0.5 for text pairs), then served the result
   * as `score_function: 'archetype_affinity'`. In a mixed batch the un-embedded listings therefore
   * outranked the embedded ones more often than not (audit 2026-09-13 E-3): a pseudo-random order
   * read as a fitted ranking.
   *
   * THE RULE. A batch is all-cosine, or it gets no `reorder`. The withholding is countable:
   *   - the decision row's `features_snapshot` carries `reorder_withheld` (written on every
   *     deployment, no flag-gated column needed);
   *   - `scoring_path` keeps its FOLLOW-560 value (`djb2_fallback` / `djb2_guard`), so a localhost
   *     run with an unseeded listing still shows WHY in AC(3)'s distribution (RETRO-332 §5a);
   *   - one `console.warn` per withheld batch names the reason code.
   *
   * @module apps/control-plane/src/app/api/adapt/route.follow1202.test
   */

  const __reg = new Map<string, Record<string, unknown>>();
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
  __reg.set(
    '@/lib/adapt-get-auth',
    (() => ({
      resolveAdaptGetAuth: vi
        .fn()
        .mockResolvedValue({ ok: true, tenantId: '550e8400-e29b-41d4-a716-446655440001' }),
    }))(),
  );
  __H.active = __reg;
  beforeAll(() => {
    __H.active = __reg;
  });
  afterAll(() => {
    __H.active = null;
  });

  const mockGetTenantSchema = vi.mocked(getTenantSchema);
  const mockFetchArchetypeEmbedding = vi.mocked(fetchArchetypeEmbedding);
  const mockFetchListingEmbeddings = vi.mocked(fetchListingEmbeddings);

  const TENANT_ID = '550e8400-e29b-41d4-a716-446655440001';
  const CLICKHOUSE_URL = 'http://localhost:8123';

  const REORDER_SCHEMA = {
    reorder_capable: true,
    container_selector: '[data-estalara-listings-grid]',
    item_selector: '[data-estalara-listing-id]',
  };

  /** Above the server gate, so the text-directive branch runs and serves something to compare. */
  const BODY = {
    tenant_id: TENANT_ID,
    session_id: 'sess-follow1202',
    page_type: 'listing_list' as const,
    archetype_hint: 'diaspora_buyer',
    confidence: 0.8,
    similarity: 0.9,
  };

  /** Unit archetype vector: a listing's cosine against it is exactly its first component. */
  const ARCHETYPE_VEC = [1, 0];
  /** A unit vector whose cosine against `ARCHETYPE_VEC` is `c`. */
  const unitWithCosine = (c: number): number[] => [c, Math.sqrt(1 - c * c)];

  const FOUR_IDS = ['embedded-high', 'unembedded-a', 'embedded-low', 'unembedded-b'];

  /** The audit's E-3 batch: two embedded listings (cosine 0.3, 0.25), two with no row. */
  const MIXED = new Map<string, number[] | null>([
    ['embedded-high', unitWithCosine(0.3)],
    ['embedded-low', unitWithCosine(0.25)],
  ]);

  /** The same four listings, all embedded. */
  const ALL_EMBEDDED = new Map<string, number[] | null>([
    ['embedded-high', unitWithCosine(0.3)],
    ['unembedded-a', unitWithCosine(0.1)],
    ['embedded-low', unitWithCosine(0.25)],
    ['unembedded-b', unitWithCosine(-0.2)],
  ]);

  interface Directive {
    type: string;
    slot?: string;
    scores?: { listing_id: string; score: number }[];
  }

  function makePostRequest(body: Record<string, unknown>): NextRequest {
    return new NextRequest('http://localhost/api/adapt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify(body),
    });
  }

  describe('FOLLOW-1202 — reorder fails closed on any non-cosine score', () => {
    let mockFetch: ReturnType<typeof vi.fn>;
    let warnSpy: ReturnType<typeof vi.spyOn>;

    async function adapt(listingIds: string[]): Promise<{
      directives: Directive[];
      snapshot: Record<string, unknown>;
      scoringPath: string | null;
    }> {
      mockFetch.mockClear();
      const res = await POST(makePostRequest({ ...BODY, listing_ids: listingIds }));
      expect(res.status).toBe(200);
      const json = (await res.json()) as { directives: Directive[] };
      await new Promise((r) => setTimeout(r, 0));
      // The adaptation_decisions INSERT is the first ClickHouse write of the request.
      const insert = mockFetch.mock.calls
        .map(([u, init]) => ({
          url: new URL(String(u)),
          body: (init as { body?: string } | undefined)?.body ?? '',
        }))
        .find((c) => c.body.includes('adaptation_decisions'));
      expect(insert, 'an adaptation_decisions INSERT was issued').toBeDefined();
      return {
        directives: json.directives,
        snapshot: JSON.parse(
          insert!.url.searchParams.get('param_p_features_snapshot') ?? '{}',
        ) as Record<string, unknown>,
        scoringPath: insert!.url.searchParams.get('param_p_scoring_path'),
      };
    }

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', mockFetch);
      vi.stubEnv('CLICKHOUSE_URL', CLICKHOUSE_URL);
      vi.stubEnv('SCORING_PATH_COLUMN_ENABLED', 'true');
      vi.stubEnv('DEMO_MODE_JWT_SECRET', 'test-secret-32-chars-long-enough!!');
      mockGetTenantSchema.mockResolvedValue(REORDER_SCHEMA);
      mockFetchArchetypeEmbedding.mockResolvedValue(ARCHETYPE_VEC);
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    afterEach(() => {
      warnSpy.mockRestore();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    });

    it('4-listing rank test: 2 embedded + 2 not → NO reorder, reason code on the decision row', async () => {
      mockFetchListingEmbeddings.mockResolvedValue(MIXED);

      const { directives, snapshot, scoringPath } = await adapt(FOUR_IDS);

      // The behaviour, asserted first so a pre-fix run fails HERE, printing the mixed ranking.
      const reorder = directives.find((d) => d.type === 'reorder');
      expect(reorder?.scores ?? null, 'a mixed batch must not be served as a ranking').toBeNull();

      expect(snapshot.reorder_withheld).toBe('embeddings_missing');
      // FOLLOW-560's value is kept, so the unseeded listing stays visible to AC(3).
      expect(scoringPath).toBe('djb2_fallback');
      const warned = warnSpy.mock.calls.map((c) => c.map(String).join(' ')).join('\n');
      expect(warned).toContain('reorder_withheld=embeddings_missing');
    });

    it('the same four listings, all embedded → reorder ranked by cosine alone', async () => {
      mockFetchListingEmbeddings.mockResolvedValue(ALL_EMBEDDED);

      const { directives, snapshot, scoringPath } = await adapt(FOUR_IDS);

      const reorder = directives.find((d) => d.type === 'reorder');
      expect(reorder).toBeDefined();
      expect(reorder!.scores!.map((s) => s.listing_id)).toEqual([
        'embedded-high',
        'embedded-low',
        'unembedded-a',
        'unembedded-b',
      ]);
      // Cosine is NOT clamped to [0, 1]: the negative score reaches the wire as computed.
      expect(reorder!.scores!.map((s) => s.score)).toEqual([
        expect.closeTo(0.3, 10),
        expect.closeTo(0.25, 10),
        expect.closeTo(0.1, 10),
        expect.closeTo(-0.2, 10),
      ]);
      expect(snapshot).not.toHaveProperty('reorder_withheld');
      expect(scoringPath).toBe('cosine');
    });

    it('text directives are unaffected: a withheld batch serves the same text as a ranked one', async () => {
      mockFetchListingEmbeddings.mockResolvedValue(ALL_EMBEDDED);
      const ranked = await adapt(FOUR_IDS);
      mockFetchListingEmbeddings.mockResolvedValue(MIXED);
      const withheld = await adapt(FOUR_IDS);

      const text = (ds: Directive[]) => ds.filter((d) => d.type !== 'reorder');
      expect(text(ranked.directives).length).toBeGreaterThan(0);
      expect(text(withheld.directives)).toEqual(text(ranked.directives));
      expect(withheld.directives.some((d) => d.type === 'reorder')).toBe(false);
    });

    it('archetype embedding missing → every listing is un-scorable → no reorder', async () => {
      mockFetchArchetypeEmbedding.mockResolvedValue(null);
      mockFetchListingEmbeddings.mockResolvedValue(ALL_EMBEDDED);

      const { directives, snapshot, scoringPath } = await adapt(FOUR_IDS);

      expect(directives.some((d) => d.type === 'reorder')).toBe(false);
      expect(snapshot.reorder_withheld).toBe('embeddings_missing');
      expect(scoringPath).toBe('djb2_fallback');
    });

    it('one listing with a dimension-mismatched embedding → no reorder', async () => {
      mockFetchListingEmbeddings.mockResolvedValue(
        new Map([...ALL_EMBEDDED, ['unembedded-b', [0.1, 0.2, 0.3]]]),
      );

      const { directives, snapshot } = await adapt(FOUR_IDS);

      expect(directives.some((d) => d.type === 'reorder')).toBe(false);
      expect(snapshot.reorder_withheld).toBe('embeddings_missing');
    });

    it('batch over LISTING_EMBEDDING_BATCH_LIMIT (never attempted) → no reorder, own reason code', async () => {
      const manyIds = Array.from({ length: 21 }, (_, i) => `listing-${String(i)}`);

      const { directives, snapshot, scoringPath } = await adapt(manyIds);

      expect(mockFetchArchetypeEmbedding).not.toHaveBeenCalled();
      expect(directives.some((d) => d.type === 'reorder')).toBe(false);
      expect(snapshot.reorder_withheld).toBe('embeddings_not_attempted');
      expect(scoringPath).toBe('djb2_guard');
    });

    it('a request with no listing_ids records no reason code (nothing was withheld)', async () => {
      const { snapshot, scoringPath } = await adapt([]);

      expect(snapshot).not.toHaveProperty('reorder_withheld');
      expect(scoringPath).toBe('not_applicable');
    });
  });

  __H.active = null;
});
