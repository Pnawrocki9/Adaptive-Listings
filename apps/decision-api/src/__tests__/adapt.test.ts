/**
 * Tests for POST /api/adapt and GET /api/health handlers.
 * No HTTP server — handlers are called directly with mock Requests.
 */

import { describe, expect, it } from 'vitest';

import { handleAdaptRequest } from '../app/api/adapt/route.js';
import { handleHealthRequest } from '../app/api/health/route.js';
import type { Directive } from '../app/api/adapt/route.js';

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
    const body = await res.json();
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
    const body = await res.json();
    expect(body.archetype).toBe('family');
    const headline = body.directives.find((d: Directive) => d.slot === 'hero_headline');
    expect(headline?.value).toContain('family');
  });

  it('no hint → returns neutral directives', async () => {
    const res = await handleAdaptRequest(makeAdaptRequest(BASE_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.archetype).toBe('neutral');
    expect(body.session_id).toBe(BASE_BODY.session_id);
    expect(body.ttl_seconds).toBeGreaterThan(0);
  });

  it('partial hint match — "invest_opportunity" → investor', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest({ ...BASE_BODY, archetype_hint: 'invest_opportunity' }),
    );
    const body = await res.json();
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
    const body = await res.json();
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
    const body = await res.json();
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
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('decision-api');
  });
});
