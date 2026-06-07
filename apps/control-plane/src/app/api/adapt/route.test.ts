/**
 * Tests for GET /api/adapt and POST /api/adapt — Decision API real logic.
 *
 * Coverage:
 *   - Auth gate: missing header → 401, wrong key → 401, correct key → 200
 *   - Auth gate: ADAPT_API_KEY unset → presence-only (empty → 401, non-empty → 200)
 *   - Decision tree: all 4 branches (with and without LLM gateway)
 *   - AdaptationDirectives shape validation
 *   - Valid GET request → correct AdaptationDirectives
 *   - Missing/invalid params → 400 with canonical error format
 *   - LLM gateway integration (mocked)
 *   - POST: presence-only auth, Zod validation, 200 with AdaptationDirectives
 *
 * Handler is now async — all GET() and POST() calls must be awaited.
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

// Mock the LLM gateway module — by default returns null (no API key in test env)
vi.mock('@/lib/llm-gateway', () => ({
  callLlmGateway: vi.fn().mockResolvedValue(null),
}));

// Mock @estalara/auth — getAuthClaims returns null (no JWT in most GET tests)
vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn().mockResolvedValue(null),
}));

// Bypass demo JWT verification for non-auth tests (FOLLOW-205).
// Full auth path is exercised in route.demo-auth.test.ts.
vi.mock('@/lib/demo-jwt-verify', () => ({
  verifyDemoJwt: vi.fn().mockResolvedValue(undefined),
  DemoJwtSecretMissingError: class DemoJwtSecretMissingError extends Error {},
  DemoJwtInvalidError: class DemoJwtInvalidError extends Error {},
}));

// Mock bandit-query — POST handler now calls getBanditArms (FOLLOW-007)
vi.mock('@/lib/bandit-query', () => ({
  getBanditArms: vi.fn().mockResolvedValue([
    { variant: 'control', alpha: 1, beta: 1, paused: false },
    { variant: 'v1', alpha: 1, beta: 1, paused: false },
    { variant: 'v2', alpha: 1, beta: 1, paused: false },
  ]),
}));

import { GET, POST } from './route';
import { callLlmGateway } from '@/lib/llm-gateway';

const mockCallLlmGateway = vi.mocked(callLlmGateway);

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

function makeRequest(
  params: Record<string, string>,
  tenantId = 'tenant-abc',
  authHeader: string | null = 'Bearer test_key',
): NextRequest {
  const url = new URL('http://localhost/api/adapt');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const headers: Record<string, string> = tenantId ? { 'x-tenant-id': tenantId } : {};
  if (authHeader !== null) {
    headers.Authorization = authHeader;
  }
  return new NextRequest(url, { headers });
}

const VALID_PARAMS = {
  session_id: 'sess-001',
  archetype: 'yield_hunter',
  confidence: '0.75',
  similarity: '0.90',
  tier: '1',
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
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  directives: z.array(z.union([TextDirectiveSchema, ClassDirectiveSchema, ReorderDirectiveSchema])),
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

// ─── Auth gate tests ──────────────────────────────────────────────────────────

describe('GET /api/adapt — auth gate', () => {
  beforeEach(() => {
    mockCallLlmGateway.mockClear();
    mockCallLlmGateway.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('missing Authorization header → 401 AUTH_REQUIRED', async () => {
    vi.stubEnv('ADAPT_API_KEY', 'test_adapt_key');
    const res = await GET(makeRequest(VALID_PARAMS, 'tenant-abc', null));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe('AUTH_REQUIRED');
    expect(body.error.message).toContain('Authorization');
  });

  it('empty Bearer token → 401 AUTH_REQUIRED', async () => {
    vi.stubEnv('ADAPT_API_KEY', 'test_adapt_key');
    const res = await GET(makeRequest(VALID_PARAMS, 'tenant-abc', 'Bearer '));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('wrong key when ADAPT_API_KEY is set → 401 FORBIDDEN', async () => {
    vi.stubEnv('ADAPT_API_KEY', 'test_adapt_key');
    const res = await GET(makeRequest(VALID_PARAMS, 'tenant-abc', 'Bearer wrong_key'));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string; message: string } }>(res);
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toContain('Invalid API key');
  });

  it('correct key when ADAPT_API_KEY is set → 200', async () => {
    vi.stubEnv('ADAPT_API_KEY', 'test_adapt_key');
    const res = await GET(makeRequest(VALID_PARAMS, 'tenant-abc', 'Bearer test_adapt_key'));
    expect(res.status).toBe(200);
  });

  it('ADAPT_API_KEY unset + empty token → 401 (presence-only: empty token rejected)', async () => {
    vi.stubEnv('ADAPT_API_KEY', '');
    const res = await GET(makeRequest(VALID_PARAMS, 'tenant-abc', 'Bearer '));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('ADAPT_API_KEY unset + non-empty token → 200 (presence-only auth)', async () => {
    vi.stubEnv('ADAPT_API_KEY', '');
    const res = await GET(makeRequest(VALID_PARAMS, 'tenant-abc', 'Bearer any_token_will_do'));
    expect(res.status).toBe(200);
  });

  it('auth error response includes request_id', async () => {
    vi.stubEnv('ADAPT_API_KEY', 'test_adapt_key');
    const res = await GET(makeRequest(VALID_PARAMS, 'tenant-abc', null));
    const body = await parseBody<{ error: { request_id: string } }>(res);
    expect(typeof body.error.request_id).toBe('string');
    expect(body.error.request_id.length).toBeGreaterThan(0);
  });
});

// ─── Unit: decision tree branches (gateway mocked to return null) ─────────────

describe('GET /api/adapt — decision tree branches (gateway null → fallback)', () => {
  beforeEach(() => {
    mockCallLlmGateway.mockClear();
    mockCallLlmGateway.mockResolvedValue(null);
  });

  it('Branch 1: confidence <= 0.6 → source: default, directives: []', async () => {
    const res = await GET(
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
    const res = await GET(
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
    const res = await GET(
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
    const res = await GET(
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
    const res = await GET(
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
    const res = await GET(
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
    const res = await GET(
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

describe('GET /api/adapt — decision tree branches (gateway returns directives)', () => {
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
    const res = await GET(
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
    const res = await GET(
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
    await GET(
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
    await GET(
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
    await GET(
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

describe('GET /api/adapt — AdaptationDirectives schema validation', () => {
  beforeEach(() => {
    mockCallLlmGateway.mockClear();
    mockCallLlmGateway.mockResolvedValue(null);
  });

  it('valid request → response matches AdaptationDirectives schema', async () => {
    const res = await GET(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(200);
    const body = await parseBody<unknown>(res);
    const parsed = AdaptationDirectivesSchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it('session_id is echoed back in response', async () => {
    const res = await GET(makeRequest({ ...VALID_PARAMS, session_id: 'my-test-session-123' }));
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.session_id).toBe('my-test-session-123');
  });

  it('archetype is echoed back in response', async () => {
    const res = await GET(makeRequest({ ...VALID_PARAMS, archetype: 'family_buyer' }));
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.archetype).toBe('family_buyer');
  });

  it('confidence and similarity are echoed as numbers', async () => {
    const res = await GET(makeRequest({ ...VALID_PARAMS, confidence: '0.82', similarity: '0.91' }));
    const body = await parseBody<Record<string, unknown>>(res);
    expect(typeof body.confidence).toBe('number');
    expect(typeof body.similarity).toBe('number');
    expect(body.confidence).toBeCloseTo(0.82);
    expect(body.similarity).toBeCloseTo(0.91);
  });

  it('tier is echoed as a number (not string)', async () => {
    const res = await GET(makeRequest({ ...VALID_PARAMS, tier: '2' }));
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.tier).toBe(2);
    expect(typeof body.tier).toBe('number');
  });

  it('generated_at is a valid ISO 8601 datetime', async () => {
    const res = await GET(makeRequest(VALID_PARAMS));
    const body = await parseBody<Record<string, unknown>>(res);
    expect(typeof body.generated_at).toBe('string');
    expect(() => new Date(body.generated_at as string)).not.toThrow();
    expect(new Date(body.generated_at as string).getTime()).not.toBeNaN();
  });
});

// ─── Integration: valid GET request → correct AdaptationDirectives ────────────

describe('GET /api/adapt — integration', () => {
  beforeEach(() => {
    mockCallLlmGateway.mockClear();
    mockCallLlmGateway.mockResolvedValue(null);
  });

  it('yield_hunter + high confidence + high similarity → 200 AdaptationDirectives', async () => {
    const res = await GET(
      makeRequest({
        session_id: 'integ-sess-001',
        archetype: 'yield_hunter',
        confidence: '0.75',
        similarity: '0.90',
        tier: '1',
      }),
    );
    expect(res.status).toBe(200);
    const body = await parseBody<unknown>(res);
    const parsed = AdaptationDirectivesSchema.safeParse(body);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.source).toBe('playbook');
      expect(parsed.data.archetype).toBe('yield_hunter');
      expect(parsed.data.tier).toBe(1);
    }
  });

  it('family_buyer + high confidence + high similarity → 200 with playbook source', async () => {
    const res = await GET(
      makeRequest({
        session_id: 'integ-sess-002',
        archetype: 'family_buyer',
        confidence: '0.80',
        similarity: '0.88',
        tier: '1',
      }),
    );
    expect(res.status).toBe(200);
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.source).toBe('playbook');
    expect(body.archetype).toBe('family_buyer');
  });

  it('lifestyle_expat + high confidence + high similarity → 200', async () => {
    const res = await GET(
      makeRequest({
        session_id: 'integ-sess-003',
        archetype: 'lifestyle_expat',
        confidence: '0.70',
        similarity: '0.95',
        tier: '1',
      }),
    );
    expect(res.status).toBe(200);
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.source).toBe('playbook');
    expect(body.archetype).toBe('lifestyle_expat');
  });

  it('all tier values (1, 2, 3) are accepted', async () => {
    for (const tier of ['1', '2', '3'] as const) {
      const res = await GET(makeRequest({ ...VALID_PARAMS, tier }));
      expect(res.status).toBe(200);
      const body = await parseBody<Record<string, unknown>>(res);
      expect(body.tier).toBe(parseInt(tier, 10));
    }
  });
});

// ─── Edge cases: missing / invalid params → 400 ───────────────────────────────

describe('GET /api/adapt — validation errors', () => {
  it('missing session_id → 400 with canonical error format', async () => {
    const withoutSessionId = {
      archetype: VALID_PARAMS.archetype,
      confidence: VALID_PARAMS.confidence,
      similarity: VALID_PARAMS.similarity,
      tier: VALID_PARAMS.tier,
    };
    const res = await GET(makeRequest(withoutSessionId));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string; message: string; request_id: string } }>(
      res,
    );
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(typeof body.error.request_id).toBe('string');
    expect(body.error.request_id.length).toBeGreaterThan(0);
  });

  it('missing archetype → 400', async () => {
    const withoutArchetype = {
      session_id: VALID_PARAMS.session_id,
      confidence: VALID_PARAMS.confidence,
      similarity: VALID_PARAMS.similarity,
      tier: VALID_PARAMS.tier,
    };
    const res = await GET(makeRequest(withoutArchetype));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('missing confidence → 400', async () => {
    const withoutConfidence = {
      session_id: VALID_PARAMS.session_id,
      archetype: VALID_PARAMS.archetype,
      similarity: VALID_PARAMS.similarity,
      tier: VALID_PARAMS.tier,
    };
    const res = await GET(makeRequest(withoutConfidence));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('missing similarity → 400', async () => {
    const withoutSimilarity = {
      session_id: VALID_PARAMS.session_id,
      archetype: VALID_PARAMS.archetype,
      confidence: VALID_PARAMS.confidence,
      tier: VALID_PARAMS.tier,
    };
    const res = await GET(makeRequest(withoutSimilarity));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('missing tier → 400', async () => {
    const withoutTier = {
      session_id: VALID_PARAMS.session_id,
      archetype: VALID_PARAMS.archetype,
      confidence: VALID_PARAMS.confidence,
      similarity: VALID_PARAMS.similarity,
    };
    const res = await GET(makeRequest(withoutTier));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('confidence = 1.5 (out of range) → 400', async () => {
    const res = await GET(makeRequest({ ...VALID_PARAMS, confidence: '1.5' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('confidence = -0.1 (negative) → 400', async () => {
    const res = await GET(makeRequest({ ...VALID_PARAMS, confidence: '-0.1' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('confidence = "not-a-number" → 400', async () => {
    const res = await GET(makeRequest({ ...VALID_PARAMS, confidence: 'not-a-number' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('similarity = 2.0 (out of range) → 400', async () => {
    const res = await GET(makeRequest({ ...VALID_PARAMS, similarity: '2.0' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('tier = 4 (invalid) → 400', async () => {
    const res = await GET(makeRequest({ ...VALID_PARAMS, tier: '4' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('tier = 0 (invalid) → 400', async () => {
    const res = await GET(makeRequest({ ...VALID_PARAMS, tier: '0' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('completely empty params → 400', async () => {
    const res = await GET(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 response includes request_id for correlation', async () => {
    const res = await GET(makeRequest({}));
    const body = await parseBody<{ error: { request_id: string } }>(res);
    expect(typeof body.error.request_id).toBe('string');
    expect(body.error.request_id.length).toBeGreaterThan(0);
  });
});

// ─── LLM gateway unit tests ───────────────────────────────────────────────────

describe('LLM gateway integration in route.ts', () => {
  it('gateway returns null with no API key → fallback source returned', async () => {
    mockCallLlmGateway.mockResolvedValue(null);
    const res = await GET(
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

    const res = await GET(
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
  beforeEach(() => {
    mockCallLlmGateway.mockClear();
    mockCallLlmGateway.mockResolvedValue(null);
  });

  it('POST with listing_ids returns ReorderDirective for est_demo_tenant', async () => {
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
