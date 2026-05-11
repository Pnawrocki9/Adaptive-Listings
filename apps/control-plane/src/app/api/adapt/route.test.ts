/**
 * Tests for GET /api/adapt — Decision API real logic.
 *
 * Coverage:
 *   - Decision tree: all 4 branches
 *   - AdaptationDirectives shape validation
 *   - Valid GET request → correct AdaptationDirectives
 *   - Missing/invalid params → 400 with canonical error format
 *
 * Handler is called directly — no HTTP server needed.
 */

import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { GET } from './route';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

function makeRequest(params: Record<string, string>, tenantId = 'tenant-abc'): NextRequest {
  const url = new URL('http://localhost/api/adapt');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url, {
    headers: tenantId ? { 'x-tenant-id': tenantId } : {},
  });
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

const AdaptationDirectivesSchema = z.object({
  session_id: z.string(),
  archetype: z.string(),
  confidence: z.number().min(0).max(1),
  similarity: z.number().min(0).max(1),
  tier: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  directives: z.array(z.union([TextDirectiveSchema, ClassDirectiveSchema])),
  source: z.enum(['playbook', 'llm_tweaked', 'llm_full', 'default']),
  generated_at: z.string().datetime(),
});

// ─── Unit: decision tree branches ────────────────────────────────────────────

describe('GET /api/adapt — decision tree branches', () => {
  it('Branch 1: confidence <= 0.6 → source: default, directives: []', async () => {
    const res = GET(
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
    const res = GET(
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

  it('Branch 2: confidence > 0.6, similarity > 0.85 → source: playbook', async () => {
    const res = GET(
      makeRequest({
        ...VALID_PARAMS,
        confidence: '0.75',
        similarity: '0.90',
      }),
    );
    expect(res.status).toBe(200);
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.source).toBe('playbook');
    // Stub returns empty slots — directives will be []
    expect(Array.isArray(body.directives)).toBe(true);
  });

  it('Branch 3: confidence > 0.6, 0.6 < similarity <= 0.85 → source: llm_tweaked', async () => {
    const res = GET(
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
  });

  it('Branch 3 edge: similarity exactly 0.85 → source: llm_tweaked', async () => {
    const res = GET(
      makeRequest({
        ...VALID_PARAMS,
        confidence: '0.80',
        similarity: '0.85',
      }),
    );
    expect(res.status).toBe(200);
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.source).toBe('llm_tweaked');
  });

  it('Branch 4: confidence > 0.6, similarity <= 0.6 → source: llm_full, directives: []', async () => {
    const res = GET(
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
    expect((body.directives as unknown[]).length).toBe(0);
  });

  it('Branch 4 edge: similarity exactly 0.6 → source: llm_full', async () => {
    const res = GET(
      makeRequest({
        ...VALID_PARAMS,
        confidence: '0.80',
        similarity: '0.6',
      }),
    );
    expect(res.status).toBe(200);
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.source).toBe('llm_full');
  });
});

// ─── Unit: AdaptationDirectives Zod schema validation ────────────────────────

describe('GET /api/adapt — AdaptationDirectives schema validation', () => {
  it('valid request → response matches AdaptationDirectives schema', async () => {
    const res = GET(makeRequest(VALID_PARAMS));
    expect(res.status).toBe(200);
    const body = await parseBody<unknown>(res);
    const parsed = AdaptationDirectivesSchema.safeParse(body);
    expect(parsed.success).toBe(true);
  });

  it('session_id is echoed back in response', async () => {
    const res = GET(makeRequest({ ...VALID_PARAMS, session_id: 'my-test-session-123' }));
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.session_id).toBe('my-test-session-123');
  });

  it('archetype is echoed back in response', async () => {
    const res = GET(makeRequest({ ...VALID_PARAMS, archetype: 'family_buyer' }));
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.archetype).toBe('family_buyer');
  });

  it('confidence and similarity are echoed as numbers', async () => {
    const res = GET(makeRequest({ ...VALID_PARAMS, confidence: '0.82', similarity: '0.91' }));
    const body = await parseBody<Record<string, unknown>>(res);
    expect(typeof body.confidence).toBe('number');
    expect(typeof body.similarity).toBe('number');
    expect(body.confidence).toBeCloseTo(0.82);
    expect(body.similarity).toBeCloseTo(0.91);
  });

  it('tier is echoed as a number (not string)', async () => {
    const res = GET(makeRequest({ ...VALID_PARAMS, tier: '2' }));
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.tier).toBe(2);
    expect(typeof body.tier).toBe('number');
  });

  it('generated_at is a valid ISO 8601 datetime', async () => {
    const res = GET(makeRequest(VALID_PARAMS));
    const body = await parseBody<Record<string, unknown>>(res);
    expect(typeof body.generated_at).toBe('string');
    expect(() => new Date(body.generated_at as string)).not.toThrow();
    expect(new Date(body.generated_at as string).getTime()).not.toBeNaN();
  });
});

// ─── Integration: valid GET request → correct AdaptationDirectives ────────────

describe('GET /api/adapt — integration', () => {
  it('yield_hunter + high confidence + high similarity → 200 AdaptationDirectives', async () => {
    const res = GET(
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
    const res = GET(
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
    const res = GET(
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
      const res = GET(makeRequest({ ...VALID_PARAMS, tier }));
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
    const res = GET(makeRequest(withoutSessionId));
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
    const res = GET(makeRequest(withoutArchetype));
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
    const res = GET(makeRequest(withoutConfidence));
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
    const res = GET(makeRequest(withoutSimilarity));
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
    const res = GET(makeRequest(withoutTier));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('confidence = 1.5 (out of range) → 400', async () => {
    const res = GET(makeRequest({ ...VALID_PARAMS, confidence: '1.5' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('confidence = -0.1 (negative) → 400', async () => {
    const res = GET(makeRequest({ ...VALID_PARAMS, confidence: '-0.1' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('confidence = "not-a-number" → 400', async () => {
    const res = GET(makeRequest({ ...VALID_PARAMS, confidence: 'not-a-number' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('similarity = 2.0 (out of range) → 400', async () => {
    const res = GET(makeRequest({ ...VALID_PARAMS, similarity: '2.0' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('tier = 4 (invalid) → 400', async () => {
    const res = GET(makeRequest({ ...VALID_PARAMS, tier: '4' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('tier = 0 (invalid) → 400', async () => {
    const res = GET(makeRequest({ ...VALID_PARAMS, tier: '0' }));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('completely empty params → 400', async () => {
    const res = GET(makeRequest({}));
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 response includes request_id for correlation', async () => {
    const res = GET(makeRequest({}));
    const body = await parseBody<{ error: { request_id: string } }>(res);
    expect(typeof body.error.request_id).toBe('string');
    expect(body.error.request_id.length).toBeGreaterThan(0);
  });
});
