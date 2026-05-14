/**
 * Tests for POST /api/adapt and GET /api/health handlers.
 * No HTTP server — handlers are called directly with mock Requests.
 *
 * Includes A/B holdout integration tests (TICKET-AB-001 AC-5 and AC-6).
 * Includes ab.assignment event emission tests (TICKET-AB-005).
 * Includes ReorderDirective integration tests (TICKET-AB-009).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AdaptResponse, Directive } from '../app/api/adapt/route.js';
import { detectArchetype, handleAdaptRequest } from '../app/api/adapt/route.js';
import { handleHealthRequest } from '../app/api/health/route.js';
import type { Env } from '../index.js';
import { recordSpend, resetTenantSpend } from '../lib/llm-gateway.js';
import { z } from 'zod';
import * as abEvents from '../lib/ab-events.js';

/**
 * Inline replica of AbAssignmentPayloadSchema from @estalara/shared — used here because
 * @estalara/shared is not yet a dependency of decision-api and the shared package does not
 * export the sub-path. This replica is intentionally kept in sync with the canonical schema
 * (packages/shared/src/schemas/events/ab-assignment.ts). [TICKET-AB-005]
 */
const AbAssignmentPayloadSchema = z.object({
  session_id: z.string().min(1),
  tenant_id: z.string().uuid(),
  holdout_group: z.boolean(),
  holdout_pct: z.number().min(0).max(1),
  assigned_at: z.string().datetime(),
});

// Helper: parse a Response body as a known shape without `as` casts
// (which Prettier may strip in some configurations).
async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BEARER = 'Bearer est_live_test_key';
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';

/** Minimal env — ADAPT_API_KEY unset → presence-only auth. */
const EMPTY_ENV: Env = { ENVIRONMENT: 'test' };

function makeAdaptRequest(body: Record<string, unknown>, auth = BEARER): Request {
  return new Request('https://api.estalara.io/api/adapt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: auth } : {}),
    },
    body: JSON.stringify(body),
  });
}

const BASE_BODY = {
  tenant_id: TENANT_ID,
  session_id: 'sess_abc123',
  page_type: 'listing_list',
};

// ─── Archetype routing ────────────────────────────────────────────────────────

describe('POST /api/adapt — archetype routing', () => {
  it('investor hint → returns investor directives', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest({ ...BASE_BODY, archetype_hint: 'investor' }),
      EMPTY_ENV,
    );
    expect(res.status).toBe(200);
    const body = await parseBody<AdaptResponse>(res);
    expect(body.archetype).toBe('investor');
    expect(body.confidence).toBeGreaterThanOrEqual(0.8);
    const slots = body.directives.map((d: Directive) => d.slot);
    expect(slots).toContain('hero_headline');
    expect(slots).toContain('cta_text');
    const headline = body.directives.find((d: Directive) => d.slot === 'hero_headline');
    expect(headline?.value).toContain('investment');
  });

  it('family hint → returns family directives', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest({ ...BASE_BODY, archetype_hint: 'family' }),
      EMPTY_ENV,
    );
    expect(res.status).toBe(200);
    const body = await parseBody<AdaptResponse>(res);
    expect(body.archetype).toBe('family');
    const headline = body.directives.find((d: Directive) => d.slot === 'hero_headline');
    expect(headline?.value).toContain('family');
  });

  it('no hint → returns neutral directives', async () => {
    const res = await handleAdaptRequest(makeAdaptRequest(BASE_BODY), EMPTY_ENV);
    expect(res.status).toBe(200);
    const body = await parseBody<AdaptResponse>(res);
    expect(body.archetype).toBe('neutral');
    expect(body.session_id).toBe(BASE_BODY.session_id);
    expect(body.ttl_seconds).toBeGreaterThan(0);
  });

  it('partial hint match — "invest_opportunity" → investor', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest({ ...BASE_BODY, archetype_hint: 'invest_opportunity' }),
      EMPTY_ENV,
    );
    const body = await parseBody<AdaptResponse>(res);
    expect(body.archetype).toBe('investor');
  });

  it('directives carry archetype and confidence fields', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest({ ...BASE_BODY, archetype_hint: 'investor' }),
    );
    const body = await parseBody<AdaptResponse>(res);
    const headline = body.directives.find((d: Directive) => d.slot === 'hero_headline');
    expect(headline?.archetype).toBe('investor');
    expect(typeof headline?.confidence).toBe('number');
  });

  it('response includes source: playbook', async () => {
    const res = await handleAdaptRequest(makeAdaptRequest(BASE_BODY));
    const body = await parseBody<AdaptResponse>(res);
    expect(body.source).toBe('playbook');
  });
});

// ─── Validation errors ────────────────────────────────────────────────────────

describe('POST /api/adapt — validation', () => {
  it('missing tenant_id → 400', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest({ session_id: 'sess_x', page_type: 'home' }),
      EMPTY_ENV,
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_failed');
  });

  it('invalid tenant_id (not UUID) → 400', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest({ ...BASE_BODY, tenant_id: 'not-a-uuid' }),
      EMPTY_ENV,
    );
    expect(res.status).toBe(400);
  });

  it('invalid page_type → 400', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest({ ...BASE_BODY, page_type: 'checkout' }),
      EMPTY_ENV,
    );
    expect(res.status).toBe(400);
  });
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

describe('POST /api/adapt — auth', () => {
  it('missing Authorization header → 401', async () => {
    const res = await handleAdaptRequest(makeAdaptRequest(BASE_BODY, ''), EMPTY_ENV);
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('Bearer with empty token → 401', async () => {
    const res = await handleAdaptRequest(makeAdaptRequest(BASE_BODY, 'Bearer '), EMPTY_ENV);
    expect(res.status).toBe(401);
  });

  it('ADAPT_API_KEY set and matching token → 200', async () => {
    const env: Env = { ENVIRONMENT: 'test', ADAPT_API_KEY: 'sk_test_secret_key' };
    const res = await handleAdaptRequest(
      makeAdaptRequest(BASE_BODY, 'Bearer sk_test_secret_key'),
      env,
    );
    expect(res.status).toBe(200);
  });

  it('ADAPT_API_KEY set and wrong token → 401', async () => {
    const env: Env = { ENVIRONMENT: 'test', ADAPT_API_KEY: 'sk_test_secret_key' };
    const res = await handleAdaptRequest(makeAdaptRequest(BASE_BODY, 'Bearer wrong_key'), env);
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('ADAPT_API_KEY unset → presence-only auth (any non-empty token passes)', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest(BASE_BODY, 'Bearer any_random_token'),
      EMPTY_ENV,
    );
    expect(res.status).toBe(200);
  });
});

// ─── LLM cap ─────────────────────────────────────────────────────────────────

describe('POST /api/adapt — LLM daily cap', () => {
  afterEach(() => {
    resetTenantSpend(TENANT_ID);
  });

  it('cap not exceeded → source is "playbook"', async () => {
    const env: Env = { ENVIRONMENT: 'test', LLM_DAILY_CAP_USD: '1.00' };
    const res = await handleAdaptRequest(makeAdaptRequest(BASE_BODY), env);
    expect(res.status).toBe(200);
    const body = await parseBody<AdaptResponse>(res);
    expect(body.source).toBe('playbook');
  });

  it('cap exceeded → source is "playbook_fallback_llm_capped"', async () => {
    // Simulate the tenant having already spent $1.00 today.
    recordSpend(TENANT_ID, 4_000_000); // 4M tokens × $0.00000025 = $1.00

    const env: Env = { ENVIRONMENT: 'test', LLM_DAILY_CAP_USD: '1.00' };
    const res = await handleAdaptRequest(makeAdaptRequest(BASE_BODY), env);
    expect(res.status).toBe(200);
    const body = await parseBody<AdaptResponse>(res);
    expect(body.source).toBe('playbook_fallback_llm_capped');
  });

  it('cap exceeded still returns valid adapt directives', async () => {
    // Simulate spend over cap.
    recordSpend(TENANT_ID, 5_000_000);

    const env: Env = { ENVIRONMENT: 'test', LLM_DAILY_CAP_USD: '1.00' };
    const res = await handleAdaptRequest(
      // holdout_pct=0 guarantees treatment (non-holdout) so directives are non-empty
      makeAdaptRequest({ ...BASE_BODY, archetype_hint: 'investor', holdout_pct: 0 }),
      env,
    );
    expect(res.status).toBe(200);
    const body = await parseBody<AdaptResponse>(res);
    expect(body.archetype).toBe('investor');
    expect(body.directives.length).toBeGreaterThan(0);
    expect(body.source).toBe('playbook_fallback_llm_capped');
  });
});

// ─── Health check ─────────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const res = handleHealthRequest();
    expect(res.status).toBe(200);
    const body = await parseBody<{ status: string; service: string }>(res);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('decision-api');
  });
});

// ─── A/B holdout integration (TICKET-AB-001 AC-5, AC-6) ──────────────────────

describe('POST /api/adapt — A/B holdout (TICKET-AB-001)', () => {
  it('AC-5: opted-out session receives default response with no holdout_group field', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest({
        ...BASE_BODY,
        consent_state: 'opted_out',
        consent_mode_enabled: true,
      }),
      EMPTY_ENV,
    );
    expect(res.status).toBe(200);
    const body = await parseBody<AdaptResponse>(res);
    // No adaptation when opted out
    expect(body.holdout_group).toBeUndefined();
  });

  it('AC-5: unknown consent receives default response with no holdout_group field', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest({
        ...BASE_BODY,
        consent_state: 'unknown',
        consent_mode_enabled: true,
      }),
      EMPTY_ENV,
    );
    expect(res.status).toBe(200);
    const body = await parseBody<AdaptResponse>(res);
    expect(body.holdout_group).toBeUndefined();
  });

  it('AC-6: granted consent → holdout_group boolean is present in response', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest({
        ...BASE_BODY,
        consent_state: 'granted',
        consent_mode_enabled: true,
      }),
      EMPTY_ENV,
    );
    expect(res.status).toBe(200);
    const body = await parseBody<AdaptResponse>(res);
    expect(typeof body.holdout_group).toBe('boolean');
  });

  it('AC-6: no consent fields → holdout_group boolean is present (consent mode disabled)', async () => {
    // Default: consent_mode_enabled is false, so assignment always proceeds
    const res = await handleAdaptRequest(makeAdaptRequest(BASE_BODY), EMPTY_ENV);
    expect(res.status).toBe(200);
    const body = await parseBody<AdaptResponse>(res);
    expect(typeof body.holdout_group).toBe('boolean');
  });

  it('holdout session receives empty directives array', async () => {
    // Use holdout_pct=1.0 to guarantee holdout assignment
    const res = await handleAdaptRequest(
      makeAdaptRequest({
        ...BASE_BODY,
        holdout_pct: 1.0,
        consent_state: 'granted',
        consent_mode_enabled: true,
      }),
      EMPTY_ENV,
    );
    expect(res.status).toBe(200);
    const body = await parseBody<AdaptResponse>(res);
    expect(body.holdout_group).toBe(true);
    expect(body.directives).toHaveLength(0);
  });

  it('treatment session receives non-empty directives', async () => {
    // Use holdout_pct=0.0 to guarantee treatment assignment
    const res = await handleAdaptRequest(
      makeAdaptRequest({
        ...BASE_BODY,
        holdout_pct: 0.0,
        archetype_hint: 'investor',
        consent_state: 'granted',
        consent_mode_enabled: true,
      }),
      EMPTY_ENV,
    );
    expect(res.status).toBe(200);
    const body = await parseBody<AdaptResponse>(res);
    expect(body.holdout_group).toBe(false);
    expect(body.directives.length).toBeGreaterThan(0);
  });

  it('A/B assignment is idempotent — same session always gets same holdout_group', async () => {
    const requestBody = {
      ...BASE_BODY,
      session_id: 'idempotency_test_session_padded_to_32chars',
      consent_state: 'granted',
      consent_mode_enabled: true,
    };

    const res1 = await handleAdaptRequest(makeAdaptRequest(requestBody), EMPTY_ENV);
    const res2 = await handleAdaptRequest(makeAdaptRequest(requestBody), EMPTY_ENV);

    const body1 = await parseBody<AdaptResponse>(res1);
    const body2 = await parseBody<AdaptResponse>(res2);

    expect(body1.holdout_group).toBe(body2.holdout_group);
  });
});

// ─── confidence / similarity passthrough (TICKET-FIX-015) ────────────────────

describe('POST /api/adapt — confidence + similarity passthrough (TICKET-FIX-015)', () => {
  it('high confidence (>=0.6) + archetype_hint → archetype and confidence preserved from SDK', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest({
        ...BASE_BODY,
        archetype_hint: 'investor',
        confidence: 0.85,
        similarity: 0.9,
        holdout_pct: 0, // guarantee treatment so directives are non-empty
      }),
      EMPTY_ENV,
    );
    expect(res.status).toBe(200);
    const body = await parseBody<AdaptResponse>(res);
    expect(body.archetype).toBe('investor');
    // Confidence must reflect the value the SDK computed, not the stub's 0.9.
    expect(body.confidence).toBe(0.85);
    // Similarity must be forwarded as-is.
    expect(body.similarity).toBe(0.9);
    // Directives must be non-empty (treatment session).
    expect(body.directives.length).toBeGreaterThan(0);
  });

  it('low confidence (<0.6) → falls back to stub detection, ignores hint confidence', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest({
        ...BASE_BODY,
        archetype_hint: 'investor',
        confidence: 0.3,
        holdout_pct: 0,
      }),
      EMPTY_ENV,
    );
    expect(res.status).toBe(200);
    const body = await parseBody<AdaptResponse>(res);
    // Stub still resolves 'investor' via keyword match, but confidence is stub's 0.9.
    expect(body.archetype).toBe('investor');
    expect(body.confidence).toBe(0.9);
    // similarity absent because it was not sent.
    expect(body.similarity).toBeUndefined();
  });

  it('no confidence / similarity → existing behaviour unchanged (backward compat)', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest({ ...BASE_BODY, archetype_hint: 'family' }),
      EMPTY_ENV,
    );
    expect(res.status).toBe(200);
    const body = await parseBody<AdaptResponse>(res);
    expect(body.archetype).toBe('family');
    expect(body.confidence).toBe(0.9);
    expect(body.similarity).toBeUndefined();
  });

  it('similarity in response is absent when not sent', async () => {
    const res = await handleAdaptRequest(makeAdaptRequest(BASE_BODY), EMPTY_ENV);
    expect(res.status).toBe(200);
    const body = await parseBody<AdaptResponse>(res);
    expect(body.similarity).toBeUndefined();
  });
});

// ─── detectArchetype unit tests (TICKET-FIX-015) ─────────────────────────────

describe('detectArchetype — confidence bypass logic (TICKET-FIX-015)', () => {
  it('confidence=0.85, hint="investor" → archetype investor, confidence=0.85', () => {
    const result = detectArchetype('investor', 0.85, 0.9);
    expect(result.archetype).toBe('investor');
    expect(result.confidence).toBe(0.85);
    expect(result.directives.length).toBeGreaterThan(0);
  });

  it('confidence=0.6 (boundary) + hint → bypasses stub', () => {
    const result = detectArchetype('family', 0.6);
    expect(result.archetype).toBe('family');
    expect(result.confidence).toBe(0.6);
  });

  it('confidence=0.59 (below boundary) → stub takes over', () => {
    const result = detectArchetype('investor', 0.59);
    // Stub keyword match still gives investor, but at stub confidence 0.9.
    expect(result.archetype).toBe('investor');
    expect(result.confidence).toBe(0.9);
  });

  it('confidence=0.85 with empty hint → stub takes over (neutral)', () => {
    const result = detectArchetype('', 0.85);
    expect(result.archetype).toBe('neutral');
    expect(result.confidence).toBe(0.5);
  });

  it('confidence undefined → stub takes over unchanged', () => {
    const result = detectArchetype('investor');
    expect(result.archetype).toBe('investor');
    expect(result.confidence).toBe(0.9);
  });
});

// ─── ab.assignment event emission (TICKET-AB-005) ────────────────────────────

/**
 * Redpanda env stub — triggers the emission path in handleAdaptRequest.
 * The actual HTTP call is intercepted via vi.spyOn on publishAbAssignmentEvent.
 */
const REDPANDA_ENV: Env = {
  ENVIRONMENT: 'test',
  REDPANDA_REST_URL: 'https://pandaproxy.test.example.com',
  REDPANDA_TOPIC_EVENTS: 'estalara.events',
};

describe('POST /api/adapt — ab.assignment event emission (TICKET-AB-005)', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- vi.spyOn generic is wider than the real overload here
  let publishSpy: any;

  beforeEach(() => {
    // Spy on publishAbAssignmentEvent so we can assert call count and capture args
    // without making real HTTP calls to Redpanda.
    publishSpy = vi
      .spyOn(abEvents, 'publishAbAssignmentEvent')
      .mockResolvedValue({ ok: true, attempts: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('consent_state=granted + holdout_pct=0.5 → producer called exactly once per adapt call', async () => {
    const CALLS = 10;
    for (let i = 0; i < CALLS; i++) {
      await handleAdaptRequest(
        makeAdaptRequest({
          ...BASE_BODY,
          session_id: `session_granted_${String(i).padStart(26, '0')}`,
          consent_state: 'granted',
          consent_mode_enabled: true,
          holdout_pct: 0.5,
        }),
        REDPANDA_ENV,
      );
    }

    // Allow any microtasks / fire-and-forget promises to settle.
    await Promise.resolve();

    expect(publishSpy).toHaveBeenCalledTimes(CALLS);
  });

  it('consent_state=opted_out → producer called zero times', async () => {
    await handleAdaptRequest(
      makeAdaptRequest({
        ...BASE_BODY,
        consent_state: 'opted_out',
        consent_mode_enabled: true,
        holdout_pct: 0.5,
      }),
      REDPANDA_ENV,
    );

    await Promise.resolve();

    expect(publishSpy).toHaveBeenCalledTimes(0);
  });

  it('consent_state=unknown → producer called zero times', async () => {
    await handleAdaptRequest(
      makeAdaptRequest({
        ...BASE_BODY,
        consent_state: 'unknown',
        consent_mode_enabled: true,
      }),
      REDPANDA_ENV,
    );

    await Promise.resolve();

    expect(publishSpy).toHaveBeenCalledTimes(0);
  });

  it('REDPANDA_REST_URL absent → producer NOT called (env guard)', async () => {
    await handleAdaptRequest(
      makeAdaptRequest({
        ...BASE_BODY,
        consent_state: 'granted',
        consent_mode_enabled: true,
      }),
      EMPTY_ENV, // no REDPANDA_REST_URL
    );

    await Promise.resolve();

    expect(publishSpy).toHaveBeenCalledTimes(0);
  });

  it('payload passed to producer validates against AbAssignmentPayloadSchema', async () => {
    await handleAdaptRequest(
      makeAdaptRequest({
        ...BASE_BODY,
        session_id: 'payload_validation_session_padded_00',
        consent_state: 'granted',
        consent_mode_enabled: true,
        holdout_pct: 0.1,
      }),
      REDPANDA_ENV,
    );

    await Promise.resolve();

    expect(publishSpy).toHaveBeenCalledTimes(1);

    const callArg: Record<string, unknown> = publishSpy.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(callArg).toBeDefined();

    // Validate the payload sub-object against the canonical schema shape.
    const result = AbAssignmentPayloadSchema.safeParse({
      session_id: callArg.session_id,
      tenant_id: callArg.tenant_id,
      holdout_group: callArg.holdout_group,
      holdout_pct: callArg.holdout_pct,
      assigned_at: callArg.assigned_at,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.tenant_id).toBe(TENANT_ID);
      expect(result.data.holdout_pct).toBe(0.1);
      expect(typeof result.data.holdout_group).toBe('boolean');
    }
  });

  it('producer error is swallowed — response is still 200', async () => {
    publishSpy.mockRejectedValue(new Error('redpanda_unreachable'));

    const res = await handleAdaptRequest(
      makeAdaptRequest({
        ...BASE_BODY,
        consent_state: 'granted',
        consent_mode_enabled: true,
      }),
      REDPANDA_ENV,
    );

    await Promise.resolve();

    expect(res.status).toBe(200);
  });
});

// ─── ReorderDirective integration tests (TICKET-AB-009) ───────────────────────

/**
 * The demo tenant 'est_demo_tenant' is the only reorder-capable tenant in the MVP
 * stub. The TENANT_ID UUID used elsewhere is NOT reorder-capable (getTenantSchema
 * returns null for real UUIDs until FOLLOW-018 adds DB lookup).
 *
 * To test ReorderDirective emission we override tenant_id to 'est_demo_tenant'.
 * Note: 'est_demo_tenant' is not a UUID so we can't use z.string().uuid() — the
 * Zod schema has z.string().uuid() for tenant_id, so we need to use the TENANT_ID
 * UUID for the request but check that reorderDirectives is always [] for it, then
 * test the demo tenant path by calling buildReorderDirective directly from the lib.
 */
describe('POST /api/adapt — ReorderDirective (TICKET-AB-009)', () => {
  it('non-holdout session with listing_ids — reorderDirectives is present in response', async () => {
    // UUID tenant won't be reorder-capable (no schema), so reorderDirectives = []
    const res = await handleAdaptRequest(
      makeAdaptRequest({
        ...BASE_BODY,
        listing_ids: ['listing-a', 'listing-b', 'listing-c'],
        holdout_pct: 0,
        consent_state: 'granted',
        consent_mode_enabled: true,
      }),
      EMPTY_ENV,
    );
    expect(res.status).toBe(200);
    const body = await parseBody<AdaptResponse>(res);
    // reorderDirectives is always present as an array (possibly empty)
    expect(Array.isArray(body.reorderDirectives)).toBe(true);
  });

  it('no listing_ids → reorderDirectives is [] (empty array)', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest({
        ...BASE_BODY,
        holdout_pct: 0,
      }),
      EMPTY_ENV,
    );
    expect(res.status).toBe(200);
    const body = await parseBody<AdaptResponse>(res);
    expect(body.reorderDirectives).toEqual([]);
  });

  it('holdout session with listing_ids → reorderDirectives is [] (holdout gets no adaptation)', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest({
        ...BASE_BODY,
        listing_ids: ['a', 'b', 'c'],
        holdout_pct: 1.0,
        consent_state: 'granted',
        consent_mode_enabled: true,
      }),
      EMPTY_ENV,
    );
    expect(res.status).toBe(200);
    const body = await parseBody<AdaptResponse>(res);
    expect(body.holdout_group).toBe(true);
    expect(body.reorderDirectives).toEqual([]);
  });

  it('listing_ids Zod schema: up to 100 strings, each max 64 chars — accepted', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => `listing-${String(i).padStart(3, '0')}`);
    const res = await handleAdaptRequest(
      makeAdaptRequest({
        ...BASE_BODY,
        listing_ids: ids,
        holdout_pct: 0,
      }),
      EMPTY_ENV,
    );
    expect(res.status).toBe(200);
  });

  it('listing_ids Zod schema: 101 strings → 400 validation error', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `listing-${String(i)}`);
    const res = await handleAdaptRequest(
      makeAdaptRequest({
        ...BASE_BODY,
        listing_ids: ids,
      }),
      EMPTY_ENV,
    );
    expect(res.status).toBe(400);
  });
});

// ─── reorder.ts unit tests (TICKET-AB-009) ────────────────────────────────────
//
// deterministicScore is an internal (non-exported) function tested indirectly
// through buildReorderDirective (Rule H: no orphaned exports).

describe('reorder.ts — getTenantSchema + buildReorderDirective', () => {
  // getTenantSchema is now async (TICKET-AB-011: Redis cache + API fallback).
  // Tests stub global fetch to avoid real network calls.

  beforeEach(() => {
    // Default: no Redis/API configured → only demo tenant works without fetch stubs.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ result: null }), { status: 200 })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getTenantSchema: est_demo_tenant → reorder_capable schema (no network call)', async () => {
    const { getTenantSchema } = await import('../lib/reorder.js');
    const schema = await getTenantSchema('est_demo_tenant', {});
    expect(schema).not.toBeNull();
    expect(schema?.reorder_capable).toBe(true);
    expect(typeof schema?.container_selector).toBe('string');
  });

  it('getTenantSchema: unknown UUID + no env → null (no SCHEMA_API_URL configured)', async () => {
    const { getTenantSchema } = await import('../lib/reorder.js');
    const schema = await getTenantSchema('550e8400-e29b-41d4-a716-446655440000', {});
    expect(schema).toBeNull();
  });

  it('buildReorderDirective: produces directive with scores sorted descending', async () => {
    const { getTenantSchema, buildReorderDirective } = await import('../lib/reorder.js');
    const schema = await getTenantSchema('est_demo_tenant', {});
    expect(schema).not.toBeNull();
    const directive = buildReorderDirective(schema!, ['id-a', 'id-b', 'id-c'], 'investor', 0.85);
    expect(directive).not.toBeNull();
    const d = directive!;
    expect(d.type).toBe('reorder');
    expect(d.score_function).toBe('archetype_affinity');
    expect(d.scores).toHaveLength(3);
    // Scores must be descending.
    for (let i = 0; i < d.scores.length - 1; i++) {
      expect(d.scores[i]!.score).toBeGreaterThanOrEqual(d.scores[i + 1]!.score);
    }
  });

  it('buildReorderDirective: deterministic — same inputs → same ordering on every call', async () => {
    const { getTenantSchema, buildReorderDirective } = await import('../lib/reorder.js');
    const schema = await getTenantSchema('est_demo_tenant', {});
    const ids = ['listing-abc', 'listing-xyz', 'listing-123'];
    const d1 = buildReorderDirective(schema!, ids, 'investor', 0.85);
    const d2 = buildReorderDirective(schema!, ids, 'investor', 0.85);
    expect(d1?.scores.map((s) => s.listing_id)).toEqual(d2?.scores.map((s) => s.listing_id));
    expect(d1?.scores.map((s) => s.score)).toEqual(d2?.scores.map((s) => s.score));
  });

  it('buildReorderDirective: all scores are in [0, 1)', async () => {
    const { getTenantSchema, buildReorderDirective } = await import('../lib/reorder.js');
    const schema = await getTenantSchema('est_demo_tenant', {});
    const ids = ['a', 'b', 'c', 'd', 'e'];
    const d = buildReorderDirective(schema!, ids, 'family', 0.85);
    expect(d?.scores).toHaveLength(5);
    for (const s of d?.scores ?? []) {
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThan(1);
    }
  });

  it('buildReorderDirective: non-reorder-capable schema → null', async () => {
    const { buildReorderDirective } = await import('../lib/reorder.js');
    const schema = { reorder_capable: false };
    const directive = buildReorderDirective(schema, ['a', 'b'], 'neutral', 0.5);
    expect(directive).toBeNull();
  });
});
