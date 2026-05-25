/**
 * Tests for the DEPRECATED POST /api/adapt Worker handler.
 *
 * FOLLOW-105 substep 1c (ADR-0006 §Decision 3): the Worker `/api/adapt` handler
 * was retired to a `410 Gone` response with structured deprecation logging. The
 * prior archetype-selection / consent-gate / A/B-holdout / ab.assignment / reorder
 * tests were removed with the handler logic they exercised — the canonical
 * control-plane route owns the production equivalents (see
 * apps/control-plane/src/app/api/adapt/route.*.test.ts).
 *
 * These tests assert: 410 status, the exact body shape, and that the
 * deprecation log fires (the only signal gating FOLLOW-107 Phase-2 retirement).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { handleAdaptRequest } from '../app/api/adapt/route.js';
import { handleHealthRequest } from '../app/api/health/route.js';
import type { Env } from '../index.js';

const BEARER = 'Bearer est_live_test_key';
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const EMPTY_ENV: Env = { ENVIRONMENT: 'test' };

async function parseBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  return raw as T;
}

function makeAdaptRequest(
  body: Record<string, unknown> | null = null,
  headers: Record<string, string> = {},
): Request {
  return new Request('https://decision.estalara.com/api/adapt', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: BEARER,
      ...headers,
    },
    ...(body !== null ? { body: JSON.stringify(body) } : {}),
  });
}

interface DeprecatedBody {
  error: string;
  canonical: string;
  since: string;
}

describe('POST /api/adapt — 410 Gone (FOLLOW-105 / ADR-0006 §Decision 3)', () => {
  beforeEach(() => {
    // Silence the structured deprecation log noise for these status/body assertions.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns HTTP 410', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest({ tenant_id: TENANT_ID, session_id: 's1', page_type: 'listing_list' }),
      EMPTY_ENV,
    );
    expect(res.status).toBe(410);
  });

  it('returns the exact deprecation body shape', async () => {
    const res = await handleAdaptRequest(makeAdaptRequest({ tenant_id: TENANT_ID }), EMPTY_ENV);
    const body = await parseBody<DeprecatedBody>(res);
    expect(body).toEqual({
      error: 'deprecated',
      canonical: 'https://admin.estalara.com/api/adapt',
      since: '2026-05-25',
    });
  });

  it('uses the canonical admin.estalara.com host (NOT the stale control-plane.estalara.com)', async () => {
    const res = await handleAdaptRequest(makeAdaptRequest(), EMPTY_ENV);
    const body = await parseBody<DeprecatedBody>(res);
    expect(body.canonical).toBe('https://admin.estalara.com/api/adapt');
    expect(body.canonical).not.toContain('control-plane.estalara.com');
    expect(body.canonical).not.toContain('decision.estalara.com');
  });

  it('does NOT perform archetype selection (no archetype/directives/source in body)', async () => {
    const res = await handleAdaptRequest(
      makeAdaptRequest({ tenant_id: TENANT_ID, archetype_hint: 'investor' }),
      EMPTY_ENV,
    );
    const body = await parseBody<Record<string, unknown>>(res);
    expect(body.archetype).toBeUndefined();
    expect(body.directives).toBeUndefined();
    expect(body.source).toBeUndefined();
  });

  it('returns 410 even for an unauthenticated / malformed request (fail-closed deprecation)', async () => {
    const noAuth = new Request('https://decision.estalara.com/api/adapt', {
      method: 'POST',
      body: 'not json',
    });
    const res = await handleAdaptRequest(noAuth, EMPTY_ENV);
    expect(res.status).toBe(410);
  });
});

describe('POST /api/adapt — structured deprecation logging (audit §C.2)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('logs each call with timestamp, User-Agent, Referer, tenant_id, canonical, and a stack', async () => {
    await handleAdaptRequest(
      makeAdaptRequest(
        { tenant_id: TENANT_ID, session_id: 's1' },
        { 'User-Agent': 'EstalaraSDK/1.2', Referer: 'https://tenant.example.com/listing/42' },
      ),
      EMPTY_ENV,
    );

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = warnSpy.mock.calls[0]?.[1] as string;
    expect(typeof logged).toBe('string');
    const parsed = JSON.parse(logged) as Record<string, unknown>;
    expect(parsed.event).toBe('worker_adapt_deprecated_call');
    expect(typeof parsed.timestamp).toBe('string');
    expect(parsed.user_agent).toBe('EstalaraSDK/1.2');
    expect(parsed.referer).toBe('https://tenant.example.com/listing/42');
    expect(parsed.tenant_id).toBe(TENANT_ID);
    expect(parsed.canonical).toBe('https://admin.estalara.com/api/adapt');
    expect(typeof parsed.stack).toBe('string');
  });

  it('best-effort tenant_id is null when the body is not JSON', async () => {
    const req = new Request('https://decision.estalara.com/api/adapt', {
      method: 'POST',
      headers: { Authorization: BEARER },
      body: 'garbage-not-json',
    });
    await handleAdaptRequest(req, EMPTY_ENV);
    const logged = warnSpy.mock.calls[0]?.[1] as string;
    const parsed = JSON.parse(logged) as Record<string, unknown>;
    expect(parsed.tenant_id).toBeNull();
  });

  it('fires the log on every call (one per request)', async () => {
    await handleAdaptRequest(makeAdaptRequest({ tenant_id: TENANT_ID }), EMPTY_ENV);
    await handleAdaptRequest(makeAdaptRequest({ tenant_id: TENANT_ID }), EMPTY_ENV);
    await handleAdaptRequest(makeAdaptRequest({ tenant_id: TENANT_ID }), EMPTY_ENV);
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });
});

describe('GET /api/health (unchanged)', () => {
  it('returns 200 with status ok', async () => {
    const res = handleHealthRequest();
    expect(res.status).toBe(200);
    const body = await parseBody<{ status: string; service: string }>(res);
    expect(body.status).toBe('ok');
    expect(body.service).toBe('decision-api');
  });
});
