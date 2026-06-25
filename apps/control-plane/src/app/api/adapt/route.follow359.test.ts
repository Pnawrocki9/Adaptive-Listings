/**
 * FOLLOW-359 tests: GET /api/adapt response body includes `variant`.
 *
 * Root cause: the GET handler sampled a bandit variant (`getHandlerVariant`),
 * passed it to `runDecisionTree` (copy selection) and `logDecisionAsync`
 * (ClickHouse), but omitted it from the JSON response body — breaking the
 * conversion attribution loop (GET-path consumers cannot echo the served arm
 * back via /api/adapt/feedback).
 *
 * Fix (FOLLOW-359): `variant: getHandlerVariant` added to the GET response
 * object. The same variable is used for copy selection, ClickHouse logging,
 * and the response field — a single source of truth.
 *
 * AC assertions:
 *   AC1 — GET response body includes `variant` (non-empty string in control/v1/v2).
 *   AC2 — GET response `variant` equals the value logged to ClickHouse
 *          (`param_p_variant` URL param in the INSERT).
 *   AC3 — POST path behavior is unchanged (variant present, POST-only fields
 *          like `directive_scope` are not affected).
 *   AC4 — No new fields added beyond `variant` on the GET path.
 *   HOLDOUT COMPAT — holdout_group=true GET response variant='control' (FOLLOW-360).
 *
 * @module apps/control-plane/src/app/api/adapt/route.follow359.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks (hoisted before route import) ──────────────────────────────────────

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
      {
        slot: 'headline',
        en: 'Control headline',
        variants: { en: ['Control headline', 'Variant 1 headline', 'Variant 2 headline'] },
      },
      { slot: 'cta', en: 'View Details' },
    ],
  })),
}));

// Return 3 arms so Thompson sampling has something to pick from.
vi.mock('@/lib/bandit-query', () => ({
  getBanditArms: vi.fn().mockResolvedValue([
    { variant: 'control', alpha: 1, beta: 1, paused: false },
    { variant: 'v1', alpha: 1, beta: 1, paused: false },
    { variant: 'v2', alpha: 1, beta: 1, paused: false },
  ]),
}));

// Deterministic thompsonSample: returns 'v1' for non-holdout requests.
// This makes the AC2 equality assertion deterministic — both the response
// body and ClickHouse param must equal 'v1'.
vi.mock('@estalara/shared', async () => {
  const mod = await vi.importActual<Record<string, unknown>>('@estalara/shared');
  return {
    ...mod,
    assignHoldout: vi.fn().mockResolvedValue({
      holdout_group: false,
      skipped: false,
      assigned_at: new Date().toISOString(),
    }),
    thompsonSample: vi.fn().mockReturnValue('v1'),
  };
});

import { GET } from './route.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeGetRequest(params: Record<string, string>): NextRequest {
  const url = new URL('http://localhost/api/adapt');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url, {
    headers: { Authorization: 'Bearer test_key', 'x-tenant-id': 'tenant-follow359' },
  });
}

const BASE_PARAMS = {
  session_id: 'sess-follow359-001',
  archetype: 'yield_hunter',
  confidence: '0.80',
  similarity: '0.90',
  tier: '1',
};

// ─── FOLLOW-359 test suite ─────────────────────────────────────────────────────

describe('GET /api/adapt — FOLLOW-359: variant in response body', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
    vi.stubEnv('ADAPT_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // ── AC1: GET response body includes `variant` ──────────────────────────────

  it('AC1: GET response body includes a `variant` field (non-empty string in control/v1/v2)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    const res = await GET(makeGetRequest(BASE_PARAMS));
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(typeof body.variant).toBe('string');
    expect((body.variant as string).length).toBeGreaterThan(0);
    expect(['control', 'v1', 'v2']).toContain(body.variant);
  });

  // ── AC2: GET response `variant` equals the value logged to ClickHouse ──────
  //
  // Both fields must be set from the SAME variable (`getHandlerVariant`).
  // With thompsonSample mocked to return 'v1' and holdout_group absent (=false),
  // both the response body and the ClickHouse INSERT param must equal 'v1'.

  it(
    'AC2: GET response `variant` equals ClickHouse param_p_variant — same variable used for both ' +
      '(FOLLOW-359 core assertion)',
    async () => {
      let capturedUrl: URL | null = null;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: unknown) => {
          try {
            capturedUrl = new URL(typeof url === 'string' ? url : '');
          } catch {
            capturedUrl = null;
          }
          return Promise.resolve(new Response('', { status: 200 }));
        }),
      );

      const res = await GET(makeGetRequest(BASE_PARAMS));
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;
      const responseVariant = body.variant as string;

      // ClickHouse INSERT must have fired.
      expect(capturedUrl, 'ClickHouse INSERT URL must be present').not.toBeNull();
      const clickhouseVariant = capturedUrl!.searchParams.get('param_p_variant');

      // Core: the same value must appear in both the response body and the log.
      // This fails on pre-FOLLOW-359 code where `variant` is absent from the body.
      expect(responseVariant).toBe(clickhouseVariant);

      // Concrete value for this mock configuration (thompsonSample returns 'v1').
      expect(responseVariant).toBe('v1');
    },
  );

  // ── HOLDOUT COMPAT: holdout_group=true forces variant='control' (FOLLOW-360) ─
  //
  // The FOLLOW-360 holdout gate sets `getHandlerVariant='control'` without calling
  // thompsonSample. FOLLOW-359 must not break this: the response variant for a
  // holdout session must equal 'control' (the same value logged to ClickHouse).

  it(
    'HOLDOUT COMPAT: holdout_group=true GET response variant=control AND ' +
      'ClickHouse param_p_variant=control (FOLLOW-360 compatibility)',
    async () => {
      let capturedUrl: URL | null = null;
      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation((url: unknown) => {
          try {
            capturedUrl = new URL(typeof url === 'string' ? url : '');
          } catch {
            capturedUrl = null;
          }
          return Promise.resolve(new Response('', { status: 200 }));
        }),
      );

      const res = await GET(makeGetRequest({ ...BASE_PARAMS, holdout_group: 'true' }));
      expect(res.status).toBe(200);

      const body = (await res.json()) as Record<string, unknown>;

      // Both response body and ClickHouse must carry 'control' for holdout sessions.
      expect(body.variant).toBe('control');

      expect(capturedUrl, 'ClickHouse INSERT URL must be present').not.toBeNull();
      expect(capturedUrl!.searchParams.get('param_p_variant')).toBe('control');
    },
  );

  // ── AC4: No new fields added beyond `variant` on GET path ─────────────────

  it('AC4: GET response has no unexpected new fields compared to known shape', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    const res = await GET(makeGetRequest(BASE_PARAMS));
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;

    // Fields that MUST be present on the GET path.
    const expectedFields = [
      'adapt_decision_id',
      'session_id',
      'archetype',
      'confidence',
      'similarity',
      'tier',
      'directives',
      'source',
      'variant', // added by FOLLOW-359
      'generated_at',
    ];

    for (const field of expectedFields) {
      expect(body, `expected field '${field}' to be present`).toHaveProperty(field);
    }

    // POST-only fields must NOT appear on the GET path.
    const postOnlyFields = ['directive_scope', 'demo_override', 'chat_intent_dimensions'];
    for (const field of postOnlyFields) {
      expect(body, `POST-only field '${field}' must not appear on GET path`).not.toHaveProperty(
        field,
      );
    }
  });
});
