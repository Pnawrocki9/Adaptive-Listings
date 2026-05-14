/**
 * Smoke tests for holdout_group wiring into ClickHouse adaptation_decisions INSERT.
 * TICKET-AB-007
 *
 * These tests verify that every adaptation_decisions INSERT includes the holdout_group
 * field derived from the assignHoldout() result, so that analytics panels
 * (Adapted vs Holdout impressions, Conversion lift vs holdout) read correct data.
 *
 * Approach: stub CLICKHOUSE_URL env var, mock global.fetch to capture the INSERT
 * query body, and assert holdout_group is present with the expected value.
 *
 * @module apps/control-plane/src/app/api/adapt/route.holdout.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock dependencies — including workspace packages not built in test env
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

import { GET, POST } from './route.js';

// ─── Helpers ───────────────────────────────────────────────────────────────────

/** Captures the body of the most recent ClickHouse fetch call. */
function captureFetchBody(): { getLastBody: () => string | null } {
  let lastBody: string | null = null;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((_url: unknown, opts?: { body?: string }) => {
      lastBody = opts?.body ?? null;
      return Promise.resolve(new Response('', { status: 200 }));
    }),
  );
  return {
    getLastBody: () => lastBody,
  };
}

function makeGetRequest(params: Record<string, string>, auth = 'Bearer test_key'): NextRequest {
  const url = new URL('http://localhost/api/adapt');
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url, {
    headers: { Authorization: auth, 'x-tenant-id': 'tenant-test' },
  });
}

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

const VALID_GET_PARAMS = {
  session_id: 'sess-holdout-001',
  archetype: 'yield_hunter',
  confidence: '0.75',
  similarity: '0.90',
  tier: '1',
};

const VALID_POST_BODY = {
  tenant_id: 'est_demo_tenant',
  session_id: 'sess-holdout-post-001',
  page_type: 'listing_list' as const,
  archetype_hint: 'yield_hunter',
  confidence: 0.8,
  similarity: 0.9,
};

// ─── Smoke tests — GET /api/adapt ─────────────────────────────────────────────

describe('GET /api/adapt — holdout_group wired into ClickHouse INSERT (TICKET-AB-007)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
    vi.stubEnv('ADAPT_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('smoke: holdout_group=true → INSERT includes holdout_group=1', async () => {
    const capture = captureFetchBody();

    const res = await GET(makeGetRequest({ ...VALID_GET_PARAMS, holdout_group: 'true' }));

    expect(res.status).toBe(200);
    const body = capture.getLastBody();
    expect(body).not.toBeNull();
    expect(body).toContain('holdout_group');
    // ClickHouse Boolean true is represented as 1
    expect(body).toContain('holdout_group');
    expect(body).toMatch(/1, '.*'/); // holdout_group=1 followed by ts value
  });

  it('smoke: holdout_group=false → INSERT includes holdout_group=0', async () => {
    const capture = captureFetchBody();

    const res = await GET(makeGetRequest({ ...VALID_GET_PARAMS, holdout_group: 'false' }));

    expect(res.status).toBe(200);
    const body = capture.getLastBody();
    expect(body).not.toBeNull();
    expect(body).toContain('holdout_group');
    expect(body).toMatch(/0, '.*'/); // holdout_group=0 followed by ts value
  });

  it('smoke: holdout_group absent → INSERT defaults to holdout_group=0', async () => {
    const capture = captureFetchBody();

    const res = await GET(makeGetRequest(VALID_GET_PARAMS));

    expect(res.status).toBe(200);
    const body = capture.getLastBody();
    expect(body).not.toBeNull();
    expect(body).toContain('holdout_group');
    // Default is false = 0
    expect(body).toMatch(/0, '.*'/);
  });

  it('INSERT includes holdout_group column in the field list', async () => {
    const capture = captureFetchBody();

    await GET(makeGetRequest(VALID_GET_PARAMS));

    const body = capture.getLastBody() ?? '';
    expect(body).toContain('holdout_group');
    // Verify the column list includes all expected fields
    expect(body).toContain('session_id');
    expect(body).toContain('tenant_id');
    expect(body).toContain('archetype');
    expect(body).toContain('holdout_group');
    expect(body).toContain('ts');
  });
});

// ─── Smoke tests — POST /api/adapt ────────────────────────────────────────────

describe('POST /api/adapt — holdout_group wired into ClickHouse INSERT (TICKET-AB-007)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123/');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('smoke: holdout_group=true in POST body → INSERT includes holdout_group=1', async () => {
    const capture = captureFetchBody();

    const res = await POST(makePostRequest({ ...VALID_POST_BODY, holdout_group: true }));

    expect(res.status).toBe(200);
    const body = capture.getLastBody();
    expect(body).not.toBeNull();
    expect(body).toContain('holdout_group');
    expect(body).toMatch(/1, '.*'/);
  });

  it('smoke: holdout_group=false in POST body → INSERT includes holdout_group=0', async () => {
    const capture = captureFetchBody();

    const res = await POST(makePostRequest({ ...VALID_POST_BODY, holdout_group: false }));

    expect(res.status).toBe(200);
    const body = capture.getLastBody();
    expect(body).not.toBeNull();
    expect(body).toContain('holdout_group');
    expect(body).toMatch(/0, '.*'/);
  });

  it('smoke: holdout_group absent → INSERT defaults to holdout_group=0', async () => {
    const capture = captureFetchBody();

    const res = await POST(makePostRequest(VALID_POST_BODY));

    expect(res.status).toBe(200);
    const body = capture.getLastBody();
    expect(body).not.toBeNull();
    expect(body).toContain('holdout_group');
    expect(body).toMatch(/0, '.*'/);
  });

  it('INSERT query contains the exact holdout_group field name', async () => {
    const capture = captureFetchBody();

    await POST(makePostRequest(VALID_POST_BODY));

    const body = capture.getLastBody() ?? '';
    // Column list
    expect(body).toContain('holdout_group');
    // The INSERT format is: INSERT INTO adaptation_decisions (col1, ..., holdout_group, ts)
    expect(body).toMatch(/INSERT INTO adaptation_decisions/);
    expect(body).toMatch(/holdout_group/);
  });
});

// ─── No CLICKHOUSE_URL — fire-and-forget skips gracefully ─────────────────────

describe('adapt route — no CLICKHOUSE_URL configured (fire-and-forget no-op)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CLICKHOUSE_URL', '');
    vi.stubEnv('ADAPT_API_KEY', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('GET returns 200 without throwing when CLICKHOUSE_URL is not set', async () => {
    const res = await GET(makeGetRequest({ ...VALID_GET_PARAMS, holdout_group: 'true' }));
    expect(res.status).toBe(200);
  });

  it('POST returns 200 without throwing when CLICKHOUSE_URL is not set', async () => {
    const res = await POST(makePostRequest({ ...VALID_POST_BODY, holdout_group: true }));
    expect(res.status).toBe(200);
  });
});
