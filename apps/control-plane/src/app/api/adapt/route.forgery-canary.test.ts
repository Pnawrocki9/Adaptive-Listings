/**
 * `forgery_canary` — the control-plane half of FOLLOW-1201 AC(5) (audit SEC-4, FOLLOW-1102).
 *
 * CLAIM (Rule AU): a caller holding only a public tenant credential cannot choose the holdout
 * rate that is persisted as the experiment's configuration; only a caller authenticated with
 * `ADAPT_API_KEY` can override it (the FOLLOW-819 harness's control arm, FOLLOW-1102 AC3).
 *
 * ASSERTION: the real `POST` handler with a captured `adaptation_decisions` INSERT — the
 * `param_p_holdout_pct` the row is written with, and the arm in the response.
 *
 * Red-first (Rule AS §3): at the pre-fix commit `body.holdout_pct` is honoured for every caller,
 * so case 1 persists `0` (the caller's value) and reads red.
 *
 * Mocks mirror `route.holdout.test.ts` — the suites must exercise the same route surface.
 *
 * @module apps/control-plane/src/app/api/adapt/route.forgery-canary.test
 */

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
      { slot: 'headline', en: 'High-yield investment property' },
      { slot: 'cta', en: 'View ROI Analysis' },
    ],
  })),
}));

vi.mock('@/lib/bandit-query', () => ({
  SEED_VARIANTS: ['control', 'v1', 'v2'] as const,
  getBanditArms: vi.fn().mockResolvedValue([
    { variant: 'control', alpha: 1, beta: 1, paused: false },
    { variant: 'v1', alpha: 1, beta: 1, paused: false },
    { variant: 'v2', alpha: 1, beta: 1, paused: false },
  ]),
}));

vi.mock('@/lib/adapt-get-auth', () => ({
  resolveAdaptGetAuth: vi.fn().mockResolvedValue({ ok: true, tenantId: 'tenant-test' }),
}));

import { POST } from './route.js';

const OPS_TENANT_ID = '22222222-2222-4222-8222-222222222222';
// Built with `.repeat()` so no 40+ char token literal lands in the diff (gitleaks).
const OPS_KEY = 'ops-key-'.repeat(6);
const HOLDOUT_SECRET = 'holdout-secret-'.repeat(3);

/** Captures the URL of the most recent `adaptation_decisions` INSERT (the params ride on it). */
function captureDecisionInsert(): { lastUrl: () => URL | null } {
  let lastUrl: URL | null = null;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((url: unknown, opts?: { body?: string }) => {
      if ((opts?.body ?? '').includes('INSERT INTO adaptation_decisions')) {
        lastUrl = typeof url === 'string' ? new URL(url) : null;
      }
      return Promise.resolve(new Response('', { status: 200 }));
    }),
  );
  return { lastUrl: () => lastUrl };
}

function postRequest(body: Record<string, unknown>, bearer: string): NextRequest {
  return new NextRequest('http://localhost/api/adapt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${bearer}` },
    body: JSON.stringify(body),
  });
}

const PUBLIC_BODY = {
  tenant_id: OPS_TENANT_ID,
  session_id: 'sess-forgery-canary-0001',
  page_type: 'listing_detail' as const,
  archetype_hint: 'yield_hunter',
  confidence: 0.8,
  similarity: 0.9,
  consent_mode_enabled: false,
};

describe('forgery_canary — client-chosen holdout rate [FOLLOW-1201 AC(3)/(5)]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
    vi.stubEnv('HOLDOUT_ASSIGNMENT_SECRET', HOLDOUT_SECRET);
    vi.stubEnv('HOLDOUT_PCT', '0.25');
    vi.stubEnv('ADAPT_API_KEY', OPS_KEY);
    vi.stubEnv('OPS_TENANT_ID', OPS_TENANT_ID);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('case 1: a public-credential caller sending holdout_pct: 0 does NOT change the persisted rate', async () => {
    const capture = captureDecisionInsert();
    // `demo_key` is NOT the ops key — verifyDemoJwt is mocked to accept it as a demo session.
    const res = await POST(postRequest({ ...PUBLIC_BODY, holdout_pct: 0 }, 'demo_key'));
    expect(res.status).toBe(200);

    const url = capture.lastUrl();
    expect(url, 'expected an adaptation_decisions INSERT').not.toBeNull();
    // Pre-fix this reads '0' — the caller's number, persisted as if it were configuration.
    expect(url!.searchParams.get('param_p_holdout_pct')).toBe('0.25');
  });

  it('case 1b: a public-credential caller sending holdout_pct: 1 cannot force itself into holdout', async () => {
    captureDecisionInsert();
    const res = await POST(postRequest({ ...PUBLIC_BODY, holdout_pct: 1 }, 'demo_key'));
    expect(res.status).toBe(200);
    const json = (await res.json()) as { holdout_group?: boolean; directives: unknown[] };
    // With the configured 25% and this fixed session the real secret-keyed draw is treatment;
    // a caller-honoured `1` would make it holdout with certainty.
    expect(json.holdout_group).not.toBe(true);
  });

  it('positive control: the ADAPT_API_KEY caller (FOLLOW-819 harness control arm) CAN set holdout_pct: 1', async () => {
    const capture = captureDecisionInsert();
    const res = await POST(postRequest({ ...PUBLIC_BODY, holdout_pct: 1 }, OPS_KEY));
    expect(res.status, await res.clone().text()).toBe(200);
    const json = (await res.json()) as { holdout_group?: boolean };
    expect(json.holdout_group).toBe(true);
    const url = capture.lastUrl();
    expect(url).not.toBeNull();
    expect(url!.searchParams.get('param_p_holdout_pct')).toBe('1');
    expect(url!.searchParams.get('param_p_holdout_group')).toBe('1');
  });

  it('positive control: with no body holdout_pct the configured rate is what is persisted', async () => {
    const capture = captureDecisionInsert();
    const res = await POST(postRequest(PUBLIC_BODY, 'demo_key'));
    expect(res.status).toBe(200);
    expect(capture.lastUrl()!.searchParams.get('param_p_holdout_pct')).toBe('0.25');
  });

  it('fails LOUD, not open, when HOLDOUT_ASSIGNMENT_SECRET is unset in a configured deployment', async () => {
    vi.stubEnv('HOLDOUT_ASSIGNMENT_SECRET', '');
    captureDecisionInsert();
    const res = await POST(postRequest(PUBLIC_BODY, 'demo_key'));
    expect(res.status).toBe(500);
    const json = (await res.json()) as { error: string };
    expect(json.error).toBe('holdout_secret_unconfigured');
  });
});
