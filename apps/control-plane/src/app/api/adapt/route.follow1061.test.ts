/**
 * FOLLOW-1061 — POST /api/adapt books its pre-LLM segment on the `llm_calls` register.
 *
 * WHY THIS EXISTS. On 2026-08-20 12:45:51 UTC a production `/api/adapt` invocation ran for
 * 103 551 ms and issued its Anthropic call 101 470 ms in. `llm_calls.latency_ms` recorded that
 * request as `1962` — correctly, because it measures the model call and nothing else — so the
 * only number the estate held about the event said the opposite of what happened. [MP-014]
 *
 * This suite asserts the WIRING, not the presence of a name (Rule AU): drive the real POST
 * handler with a deliberately slow pre-LLM dependency and prove a row lands on the register
 * carrying that delay, on the same `session_id` the generation row uses.
 *
 * @module apps/control-plane/src/app/api/adapt/route.follow1061.test
 */

// ─── next/server mock (must be before all imports) ───────────────────────────
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

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

// `@/lib/llm-gateway` is mocked (as in every other adapt suite) — the register itself lives in
// `@/lib/llm-calls-register` and is deliberately NOT mocked here, because it is the thing under
// test.
vi.mock('@/lib/llm-gateway', () => ({
  callLlmGateway: vi.fn().mockResolvedValue(null),
}));

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
  getBanditArms: vi
    .fn()
    .mockResolvedValue([{ variant: 'control', alpha: 1, beta: 1, paused: false }]),
}));

/** The injected stall. Real milliseconds, so no fake-timer interplay with the route's awaits. */
const SLOW_STEP_MS = 40;

vi.mock('@/lib/rag-retrieval', () => ({
  retrieveListingContext: vi.fn(async () => {
    await new Promise((r) => setTimeout(r, SLOW_STEP_MS));
    return {};
  }),
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

vi.mock('@/lib/adapt-get-auth', () => ({
  resolveAdaptGetAuth: vi
    .fn()
    .mockResolvedValue({ ok: true, tenantId: '550e8400-e29b-41d4-a716-446655440001' }),
}));

import { PRE_LLM_SEGMENT_SOURCE } from '@/lib/adapt-segment-timing';
import { POST } from './route';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440001';
const CLICKHOUSE_URL = 'http://localhost:8123';
const SESSION_ID = 'sess-follow1061-001';

function makePostRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost/api/adapt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify(body),
  });
}

const BASE_BODY = {
  tenant_id: TENANT_ID,
  session_id: SESSION_ID,
  page_type: 'listing_detail' as const,
  archetype_hint: 'yield_hunter',
  confidence: 0.8,
  similarity: 0.7,
  holdout_pct: 0,
};

/** Every ClickHouse INSERT the handler issued, parsed into its `param_p_*` values. */
function insertParams(mockFetch: ReturnType<typeof vi.fn>): URLSearchParams[] {
  return mockFetch.mock.calls.map(([url]) => new URL(String(url)).searchParams);
}

describe('FOLLOW-1061 — the pre-LLM segment lands on the llm_calls register', () => {
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

  it('writes exactly one row with source=route_pre_llm, on the request session', async () => {
    await POST(makePostRequest(BASE_BODY));
    await new Promise((r) => setTimeout(r, 0));

    const segmentRows = insertParams(mockFetch).filter(
      (p) => p.get('param_p_source') === PRE_LLM_SEGMENT_SOURCE,
    );

    expect(segmentRows).toHaveLength(1);
    expect(segmentRows[0]?.get('param_p_session_id')).toBe(SESSION_ID);
    expect(segmentRows[0]?.get('param_p_tenant_id')).toBe(TENANT_ID);
  });

  it('the recorded latency contains the injected pre-LLM delay', async () => {
    await POST(makePostRequest(BASE_BODY));
    await new Promise((r) => setTimeout(r, 0));

    const row = insertParams(mockFetch).find(
      (p) => p.get('param_p_source') === PRE_LLM_SEGMENT_SOURCE,
    );

    expect(row).toBeDefined();
    expect(Number(row?.get('param_p_latency_ms'))).toBeGreaterThanOrEqual(SLOW_STEP_MS);
  });

  it('books no spend — the segment row must not move the $100/day breaker', async () => {
    await POST(makePostRequest(BASE_BODY));
    await new Promise((r) => setTimeout(r, 0));

    const row = insertParams(mockFetch).find(
      (p) => p.get('param_p_source') === PRE_LLM_SEGMENT_SOURCE,
    );

    expect(Number(row?.get('param_p_cost_usd'))).toBe(0);
    expect(Number(row?.get('param_p_tokens_in'))).toBe(0);
    expect(Number(row?.get('param_p_tokens_out'))).toBe(0);
  });

  it('still writes the adaptation_decisions row — the segment row is additive', async () => {
    await POST(makePostRequest(BASE_BODY));
    await new Promise((r) => setTimeout(r, 0));

    const decisionInserts = mockFetch.mock.calls.filter(([, opts]) =>
      ((opts as { body?: string } | undefined)?.body ?? '').includes(
        'INSERT INTO adaptation_decisions',
      ),
    );

    expect(decisionInserts).toHaveLength(1);
  });

  it('writes nothing when ClickHouse is unconfigured (dev/CI), rather than throwing', async () => {
    vi.stubEnv('CLICKHOUSE_URL', '');

    const res = await POST(makePostRequest(BASE_BODY));
    await new Promise((r) => setTimeout(r, 0));

    expect(res.status).toBe(200);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
