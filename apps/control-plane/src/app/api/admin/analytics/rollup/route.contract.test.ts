/**
 * FOLLOW-1330 — contract pin for GET /api/admin/analytics/rollup, as the FOLLOW-819 harness reads
 * it for AC(5). The harness cannot import this module, so the shape it depends on is pinned here;
 * a renamed or dropped key fails this file instead of turning the measurement series RED.
 *
 * What the harness does (`tests/e2e/follow-819/differentiator-e2e.mjs`):
 *   - `fetch(`${DECISION_ORIGIN}/api/admin/analytics/rollup`, { Authorization: Bearer
 *     ADMIN_API_SECRET })` — NO `tenant_id` query (:4997); grades `res.ok` (:5073) and reports
 *     `res.status` (:5081);
 *   - `body.data_source === 'clickhouse'` (:5002, :5082, :5128; `'mock'` is the anti-fixture
 *     guard, :5216);
 *   - `body.rollup.ctaLift` (:5003, a conjunct as `lift !== null`, :5076);
 *   - `body.conversion_source === 'signed_events'` (:5010, :5071);
 *   - `body.scoring_path_source` (:5131, evidence);
 *   - `body.rollup.sessions` / `.adapted` / `.holdout` (:5133-:5135, evidence);
 *   - `body.rollup.conversions.{adaptedN, holdoutN}` must be numbers, and `adaptedConversions`,
 *     `holdoutConversions`, `preExposureConversions`, `unsignedConversions`, `ctaClickedSessions`
 *     are read beside them (`readRollupConversionCounts`, :3583-:3594; feeds
 *     `unmetPreconditions`, :5087-:5097).
 *
 * Only the network edges are stubbed: ClickHouse (global `fetch`), Postgres (`@estalara/db`) and
 * the Supabase SSR client the staff-session path calls. The route, the data layer and the real
 * `verifyTracerAdminAuth` (constant-time Bearer compare) run as written.
 *
 * @module apps/control-plane/src/app/api/admin/analytics/rollup/route.contract.test
 */

import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const mockGetUser = vi.fn();
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({ auth: { getUser: mockGetUser } })),
}));

import { ESTALARA_TENANT_ID } from '@/lib/estalara-tenant';

// Hoisted: `vi.mock` factories run before the module body, so their inputs must be too.
const { TENANTS_TABLE, QUIZ_TABLE, mockFrom } = vi.hoisted(() => {
  const tenantsTable = { id: 'id', name: 'name', slug: 'slug', deletedAt: 'deleted_at' };
  const quizTable = { tenantId: 'tenant_id' };
  /** Postgres stand-in: the tenant roster and the quiz_completions count, by table. */
  const from = (table: unknown) => {
    // Read at call time: by then the `ESTALARA_TENANT_ID` import is initialised.
    const tenantId = currentTenantId();
    if (table === tenantsTable) {
      return {
        where: vi.fn().mockResolvedValue([{ id: tenantId, name: 'Estalara', slug: 'e' }]),
      };
    }
    return {
      where: vi.fn().mockResolvedValue([{ cnt: 3 }]),
      groupBy: vi.fn().mockResolvedValue([{ tenantId, cnt: 3 }]),
    };
  };
  return { TENANTS_TABLE: tenantsTable, QUIZ_TABLE: quizTable, mockFrom: from };
});

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({ select: vi.fn(() => ({ from: mockFrom })) })),
  tenants: TENANTS_TABLE,
  quizCompletions: QUIZ_TABLE,
}));

import { GET } from './route';

function currentTenantId(): string {
  return ESTALARA_TENANT_ID;
}

const ADMIN_SECRET = 'contract-test-admin-secret';

/** One ClickHouse row for the rollup query: 40/80 adapted vs 5/20 holdout → lift +100 %. */
const ROLLUP_ROW = {
  tenant_id: ESTALARA_TENANT_ID,
  sessions: 100,
  adapted: 80,
  holdout: 20,
  adapted_n: 80,
  holdout_n: 20,
  adapted_conversions: 40,
  adapted_signed_conversion_sessions: 43,
  adapted_unsigned_conversion_sessions: 7,
  adapted_cta_sessions: 60,
  holdout_conversions: 5,
  holdout_signed_conversion_sessions: 5,
  holdout_unsigned_conversion_sessions: 1,
  holdout_cta_sessions: 9,
  all_conversions: 45,
  all_signed_conversion_sessions: 48,
  all_unsigned_conversion_sessions: 8,
  all_cta_sessions: 69,
};

/** Every query URL the code under test sent to ClickHouse. */
const sentUrls: URL[] = [];

function clickhouseStandIn(failRollup: boolean) {
  return vi.fn((input: unknown) => {
    const url = new URL(String(input));
    sentUrls.push(url);
    const sql = url.searchParams.get('query') ?? '';
    const jsonLines = (rows: unknown[]) =>
      new Response(rows.map((r) => JSON.stringify(r)).join('\n'), { status: 200 });
    if (sql.includes('AS adapted_n')) {
      return Promise.resolve(
        failRollup ? new Response('boom', { status: 500 }) : jsonLines([ROLLUP_ROW]),
      );
    }
    if (sql.includes('scoring_path AS scoring_path')) {
      return Promise.resolve(jsonLines([{ scoring_path: 'cosine', n: 4 }]));
    }
    if (sql.includes('reorder_withheld')) {
      return Promise.resolve(jsonLines([{ reason: 'embeddings_missing', n: 2 }]));
    }
    return Promise.resolve(new Response(`unrecognised query: ${sql}`, { status: 400 }));
  });
}

function stubLiveStores(opts: { failRollup?: boolean } = {}): void {
  vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
  vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.contract.test:8123');
  vi.stubEnv('DATABASE_URL_ADMIN', 'postgres://rollup-contract.test/db');
  vi.stubEnv('CALLER_SIGNED_COLUMN_ENABLED', 'true');
  vi.stubEnv('SCORING_PATH_COLUMN_ENABLED', 'true');
  vi.stubGlobal('fetch', clickhouseStandIn(opts.failRollup ?? false));
}

/** The harness's own request: Bearer ADMIN_API_SECRET, no query string. */
function harnessRequest(query = ''): NextRequest {
  return new NextRequest(`http://localhost:3000/api/admin/analytics/rollup${query}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${ADMIN_SECRET}` },
  });
}

/** Asserts every key the harness dereferences is present with the type it assumes. */
function expectHarnessShape(body: Record<string, unknown>): void {
  expect(typeof body.data_source).toBe('string');
  expect(typeof body.conversion_source).toBe('string');
  expect(typeof body.scoring_path_source).toBe('string');
  const rollup = body.rollup as Record<string, unknown>;
  expect(rollup).toBeTypeOf('object');
  expect(rollup).toHaveProperty('ctaLift');
  expect(rollup.ctaLift === null || typeof rollup.ctaLift === 'number').toBe(true);
  for (const k of ['sessions', 'adapted', 'holdout']) expect(typeof rollup[k]).toBe('number');
  const c = rollup.conversions as Record<string, unknown>;
  expect(c).toBeTypeOf('object');
  for (const k of ['adaptedN', 'holdoutN', 'ctaClickedSessions']) {
    expect(typeof c[k], `rollup.conversions.${k}`).toBe('number');
  }
  for (const k of [
    'adaptedConversions',
    'holdoutConversions',
    'preExposureConversions',
    'unsignedConversions',
  ]) {
    expect(c, `rollup.conversions.${k}`).toHaveProperty(k);
    expect(c[k] === null || typeof c[k] === 'number', `rollup.conversions.${k}`).toBe(true);
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  sentUrls.length = 0;
  mockGetUser.mockResolvedValue({ data: { user: null } });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('FOLLOW-1330 contract: the rollup response the FOLLOW-819 harness grades AC(5) on', () => {
  it('Bearer ADMIN_API_SECRET, no tenant_id → 200 with every key AC(5) reads, live literals', async () => {
    stubLiveStores();

    const res = await GET(harnessRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expectHarnessShape(body);

    // The literals the harness compares against (a different spelling is a RED, not a type error).
    expect(body.data_source).toBe('clickhouse');
    expect(body.conversion_source).toBe('signed_events');
    expect(body.scoring_path_source).toBe('live');
    const rollup = body.rollup as Record<string, unknown>;
    expect(rollup.ctaLift).toBeCloseTo(100, 6);
    expect(rollup).toMatchObject({ sessions: 100, adapted: 80, holdout: 20 });
    expect(rollup.conversions).toEqual({
      adaptedN: 80,
      holdoutN: 20,
      adaptedConversions: 40,
      holdoutConversions: 5,
      preExposureConversions: 3,
      unsignedConversions: 8,
      ctaClickedSessions: 69,
    });
  });

  it('CALLER_SIGNED_COLUMN_ENABLED off → conversion_source disabled and a null lift (the RED the harness names)', async () => {
    stubLiveStores();
    vi.stubEnv('CALLER_SIGNED_COLUMN_ENABLED', '');

    const res = await GET(harnessRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expectHarnessShape(body);
    expect(body.conversion_source).toBe('disabled');
    expect((body.rollup as Record<string, unknown>).ctaLift).toBeNull();
  });

  it("stores unconfigured → data_source 'mock' (the harness's anti-fixture guard) with the same keys", async () => {
    vi.stubEnv('ADMIN_API_SECRET', ADMIN_SECRET);
    vi.stubEnv('CLICKHOUSE_URL', '');
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');

    const res = await GET(harnessRequest());
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expectHarnessShape(body);
    expect(body.data_source).toBe('mock');
    expect(body.conversion_source).toBe('mock');
  });

  it('configured ClickHouse fails → HTTP 500 (the harness reports http_status, never a fabricated lift)', async () => {
    stubLiveStores({ failRollup: true });

    const res = await GET(harnessRequest());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('query_failed');
  });

  it('staff SSR session path (no Bearer) → 200 with the same keys and values', async () => {
    stubLiveStores();
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://supabase.contract.test');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
    mockGetUser.mockResolvedValue({
      data: {
        user: {
          id: 'staff-user',
          app_metadata: { estalara_staff: true, estalara_role: 'estalara:readonly' },
        },
      },
    });

    const res = await GET(
      new NextRequest('http://localhost:3000/api/admin/analytics/rollup', { method: 'GET' }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expectHarnessShape(body);
    expect(body.data_source).toBe('clickhouse');
    expect(body.conversion_source).toBe('signed_events');
    expect((body.rollup as Record<string, unknown>).ctaLift).toBeCloseTo(100, 6);
  });

  it('a wrong Bearer and no staff session → 401, the data layer never queried', async () => {
    stubLiveStores();
    const res = await GET(
      new NextRequest('http://localhost:3000/api/admin/analytics/rollup', {
        method: 'GET',
        headers: { Authorization: 'Bearer not-the-secret' },
      }),
    );
    expect(res.status).toBe(401);
    expect(sentUrls).toHaveLength(0);
  });
});
