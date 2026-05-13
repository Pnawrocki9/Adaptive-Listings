/**
 * Tests for POST /api/adapt and GET /api/health handlers.
 * No HTTP server — handlers are called directly with mock Requests.
 *
 * Includes A/B holdout integration tests (TICKET-AB-001 AC-5 and AC-6).
 */

import { describe, expect, it } from 'vitest';

import type { AdaptResponse, Directive } from '../app/api/adapt/route.js';
import { handleAdaptRequest } from '../app/api/adapt/route.js';
import { handleHealthRequest } from '../app/api/health/route.js';

// Helper: parse a Response body as a known shape without `as` casts
// (which Prettier may strip in some configurations).
async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const BEARER = 'Bearer est_live_test_key';

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
  tenant_id: '550e8400-e29b-41d4-a716-446655440000',
  session_id: 'sess_abc123',
  page_type: 'listing_list',
};

// ─── Archetype routing ────────────────────────────────────────────────────────

describe('POST /api/adapt — archetype routing', () => {
  it('investor hint → returns investor directives', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest({ ...BASE_BODY, archetype_hint: 'investor' }),
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
    );
    expect(res.status).toBe(200);
    const body = await parseBody<AdaptResponse>(res);
    expect(body.archetype).toBe('family');
    const headline = body.directives.find((d: Directive) => d.slot === 'hero_headline');
    expect(headline?.value).toContain('family');
  });

  it('no hint → returns neutral directives', async () => {
    const res = await handleAdaptRequest(makeAdaptRequest(BASE_BODY));
    expect(res.status).toBe(200);
    const body = await parseBody<AdaptResponse>(res);
    expect(body.archetype).toBe('neutral');
    expect(body.session_id).toBe(BASE_BODY.session_id);
    expect(body.ttl_seconds).toBeGreaterThan(0);
  });

  it('partial hint match — "invest_opportunity" → investor', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest({ ...BASE_BODY, archetype_hint: 'invest_opportunity' }),
    );
    const body = await parseBody<AdaptResponse>(res);
    expect(body.archetype).toBe('investor');
  });
});

// ─── Validation errors ────────────────────────────────────────────────────────

describe('POST /api/adapt — validation', () => {
  it('missing tenant_id → 400', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest({ session_id: 'sess_x', page_type: 'home' }),
    );
    expect(res.status).toBe(400);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('validation_failed');
  });

  it('invalid tenant_id (not UUID) → 400', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest({ ...BASE_BODY, tenant_id: 'not-a-uuid' }),
    );
    expect(res.status).toBe(400);
  });

  it('invalid page_type → 400', async () => {
    const res = await handleAdaptRequest(makeAdaptRequest({ ...BASE_BODY, page_type: 'checkout' }));
    expect(res.status).toBe(400);
  });
});

// ─── Auth ─────────────────────────────────────────────────────────────────────

describe('POST /api/adapt — auth', () => {
  it('missing Authorization header → 401', async () => {
    const res = await handleAdaptRequest(makeAdaptRequest(BASE_BODY, ''));
    expect(res.status).toBe(401);
    const body = await parseBody<{ error: { code: string } }>(res);
    expect(body.error.code).toBe('unauthorized');
  });

  it('Bearer with empty token → 401', async () => {
    const res = await handleAdaptRequest(makeAdaptRequest(BASE_BODY, 'Bearer '));
    expect(res.status).toBe(401);
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
    );
    expect(res.status).toBe(200);
    const body = await parseBody<AdaptResponse>(res);
    expect(typeof body.holdout_group).toBe('boolean');
  });

  it('AC-6: no consent fields → holdout_group boolean is present (consent mode disabled)', async () => {
    // Default: consent_mode_enabled is false, so assignment always proceeds
    const res = await handleAdaptRequest(makeAdaptRequest(BASE_BODY));
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

    const res1 = await handleAdaptRequest(makeAdaptRequest(requestBody));
    const res2 = await handleAdaptRequest(makeAdaptRequest(requestBody));

    const body1 = await parseBody<AdaptResponse>(res1);
    const body2 = await parseBody<AdaptResponse>(res2);

    expect(body1.holdout_group).toBe(body2.holdout_group);
  });
});
