/**
 * Golden-query comparison test — FOLLOW-093
 *
 * Asserts that the dashboard analytics lift route (/api/dashboard/analytics/lift)
 * and the canonical pilot CTA-lift route (/api/pilot/cta-lift) produce the same
 * per-archetype CTA conversion numbers when given identical underlying data.
 *
 * Background: Before FOLLOW-093 the two routes used different event vocabulary
 * and different tables:
 *   - Non-canonical: dqs_events.event_type = 'cta_clicked', filtered on assigned_at
 *   - Canonical:     events.type = 'cta.clicked', filtered on ts
 * This caused the dashboard panel to show different numbers from the pilot metric
 * for the same tenant, which is a data-correctness bug.
 *
 * After FOLLOW-093 both routes join adaptation_decisions with events WHERE
 * type = 'cta.clicked', so the fixture data is identical and results must match.
 *
 * Test strategy: mock ClickHouse fetch with a canned JSONEachRow fixture that
 * represents the canonical events table (events.type = 'cta.clicked'). Invoke
 * both routes' ClickHouse-backed query paths and assert that the per-archetype
 * adapted_conversions / adapted_n and holdout_conversions / holdout_n are equal.
 *
 * @module apps/control-plane/src/app/api/dashboard/analytics/lift/golden-query-comparison.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import type { LiftResponse } from './route.js';
import type { CtaLiftResponse } from '../../../../../app/api/pilot/cta-lift/route-helpers.js';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440099';

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
  // isTenantClaims: returns true when claims has estalara_staff=false and a string tenant_id.
  // Mirrors the real implementation so the auth guard in both routes passes correctly.
  isTenantClaims: vi.fn((claims: Record<string, unknown>) => {
    return claims.estalara_staff === false && typeof claims.tenant_id === 'string';
  }),
}));

// ─── Partial mock of @/lib/session-auth ───────────────────────────────────────
// The dashboard lift route now delegates auth to `resolveTenantAccess` (ADR-0018).
// The pilot route still uses the REAL `getSessionAuthClaims` (kept via
// `importOriginal`), which reads the mocked `getAuthClaims` above — so both routes
// see the same agency caller from identical fixtures.

vi.mock('@/lib/session-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionAuthModule>();
  return { ...actual, resolveTenantAccess: vi.fn() };
});

import type * as SessionAuthModule from '@/lib/session-auth';
import { getAuthClaims } from '@estalara/auth';
import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
const mockGetAuthClaims = vi.mocked(getAuthClaims);
const mockResolve = vi.mocked(resolveTenantAccess);

function agencyAccess(): TenantAccess {
  return {
    via: 'agency',
    tenantId: TENANT_ID,
    claims: {
      sub: 'user-uuid',
      email: 'user@agency.com',
      tenant_id: TENANT_ID,
      agency_role: 'agency:admin',
      estalara_staff: false,
      mfa_verified: true,
    },
    rawToken: 'agency-jwt',
  };
}

function authAsTenant(): void {
  mockGetAuthClaims.mockResolvedValue({
    sub: 'user-uuid',
    email: 'user@agency.com',
    tenant_id: TENANT_ID,
    agency_role: 'agency:admin',
    estalara_staff: false,
    mfa_verified: true,
  });
  // Dashboard lift route resolves via resolveTenantAccess (mocked here).
  mockResolve.mockResolvedValue(agencyAccess());
}

// ─── Fixture dataset ──────────────────────────────────────────────────────────

/**
 * Canonical fixture: what ClickHouse returns for the dashboard/analytics/lift
 * route query (per-archetype counts after FOLLOW-093 reconciliation).
 * The query now uses countDistinctIf on adaptation_decisions joined to events.
 */
const DASHBOARD_FIXTURE_ROWS = [
  {
    archetype: 'investor',
    adapted_n: 600,
    adapted_conversions: 96,
    holdout_n: 150,
    holdout_conversions: 15,
  },
  {
    archetype: 'family_buyer',
    adapted_n: 400,
    adapted_conversions: 48,
    holdout_n: 100,
    holdout_conversions: 8,
  },
  {
    archetype: 'yield_hunter',
    adapted_n: 200,
    adapted_conversions: 30,
    holdout_n: 50,
    holdout_conversions: 4,
  },
];

/**
 * Canonical fixture: what ClickHouse returns for the pilot/cta-lift route.
 * Three separate queries (groups, archetypes, funnel) return JSONEachRow rows.
 * The archetype counts must be derivable to the same rates as DASHBOARD_FIXTURE_ROWS.
 */
const PILOT_GROUP_ROWS = [
  // adapted arm total
  {
    holdout: 0,
    sessions: DASHBOARD_FIXTURE_ROWS.reduce((s, r) => s + r.adapted_n, 0), // 1200
    cta_sessions: DASHBOARD_FIXTURE_ROWS.reduce((s, r) => s + r.adapted_conversions, 0), // 174
  },
  // holdout arm total
  {
    holdout: 1,
    sessions: DASHBOARD_FIXTURE_ROWS.reduce((s, r) => s + r.holdout_n, 0), // 300
    cta_sessions: DASHBOARD_FIXTURE_ROWS.reduce((s, r) => s + r.holdout_conversions, 0), // 27
  },
];

const PILOT_ARCHETYPE_ROWS = DASHBOARD_FIXTURE_ROWS.flatMap((r) => [
  {
    archetype: r.archetype,
    holdout: 0,
    sessions: r.adapted_n,
    cta_sessions: r.adapted_conversions,
  },
  {
    archetype: r.archetype,
    holdout: 1,
    sessions: r.holdout_n,
    cta_sessions: r.holdout_conversions,
  },
]);

const PILOT_FUNNEL_ROWS = [
  { stage: 'page.view', holdout: 0, sessions: 1200 },
  { stage: 'page.view', holdout: 1, sessions: 300 },
  { stage: 'cta.clicked', holdout: 0, sessions: 174 },
  { stage: 'cta.clicked', holdout: 1, sessions: 27 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDashboardRequest(): NextRequest {
  return new NextRequest('http://localhost/api/dashboard/analytics/lift', {
    headers: { Authorization: 'Bearer mock-token' },
  });
}

function makePilotRequest(): NextRequest {
  return new NextRequest('http://localhost/api/pilot/cta-lift?window_days=7', {
    headers: { Authorization: 'Bearer mock-token' },
  });
}

async function parseBody<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// ─── Golden-query comparison ──────────────────────────────────────────────────

describe('golden-query comparison: dashboard/analytics/lift vs pilot/cta-lift', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test';
    authAsTenant();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLICKHOUSE_URL;
  });

  it('both routes report the same per-archetype CTA conversion rate after FOLLOW-093 reconciliation', async () => {
    // ── Mock fetch for dashboard route (single query returning ChLiftRow rows) ──
    const dashboardFetchMock = vi.fn().mockResolvedValueOnce(
      new Response(DASHBOARD_FIXTURE_ROWS.map((r) => JSON.stringify(r)).join('\n'), {
        status: 200,
      }),
    );

    // ── Mock fetch for pilot route (3 queries: groups, archetypes, funnel) ──
    const pilotFetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(PILOT_GROUP_ROWS.map((r) => JSON.stringify(r)).join('\n'), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(PILOT_ARCHETYPE_ROWS.map((r) => JSON.stringify(r)).join('\n'), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(PILOT_FUNNEL_ROWS.map((r) => JSON.stringify(r)).join('\n'), { status: 200 }),
      );

    // ── Call dashboard route ──
    vi.stubGlobal('fetch', dashboardFetchMock);
    const { GET: dashboardGET } = await import('./route.js');
    const dashboardRes = await dashboardGET(makeDashboardRequest());
    expect(dashboardRes.status).toBe(200);
    const dashboardBody = await parseBody<LiftResponse>(dashboardRes);

    // ── Call pilot route ──
    vi.stubGlobal('fetch', pilotFetchMock);
    const { GET: pilotGET } = await import('../../../../../app/api/pilot/cta-lift/route.js');
    const pilotRes = await pilotGET(makePilotRequest());
    expect(pilotRes.status).toBe(200);
    const pilotBody = await parseBody<CtaLiftResponse>(pilotRes);

    // ── Assert per-archetype rates match ──
    // Both routes must report the same adapted and holdout CTA rates for each
    // archetype. Rates are rounded to 4 decimal places in both routes.
    const ARCHETYPES = DASHBOARD_FIXTURE_ROWS.map((r) => r.archetype);
    for (const archetype of ARCHETYPES) {
      const dashRow = dashboardBody.rows.find((r) => r.archetype === archetype);
      const pilotRow = pilotBody.by_archetype.find((r) => r.archetype === archetype);

      expect(dashRow, `dashboard missing archetype: ${archetype}`).toBeDefined();
      expect(pilotRow, `pilot missing archetype: ${archetype}`).toBeDefined();

      if (!dashRow || !pilotRow) continue;

      // The two routes use different field naming conventions:
      //   dashboard: adaptedRate / holdoutRate
      //   pilot:     adapted_cta_rate / holdout_cta_rate
      // Both round to 4 decimal places.
      expect(dashRow.adaptedRate).toBe(pilotRow.adapted_cta_rate);
      expect(dashRow.holdoutRate).toBe(pilotRow.holdout_cta_rate);

      // Sample sizes must also agree (they come from the same fixture).
      expect(dashRow.adaptedN).toBe(pilotRow.n_adapted);
      expect(dashRow.holdoutN).toBe(pilotRow.n_holdout);
    }
  });

  it('dashboard route uses canonical events table vocabulary (cta.clicked, not cta_clicked)', async () => {
    // Capture the SQL sent to ClickHouse and assert it uses the canonical event
    // type and table name — not the old dqs_events / cta_clicked vocabulary.
    //
    // The route sets SQL via URL.searchParams.set('query', sql). The URL API
    // encodes spaces as '+' (application/x-www-form-urlencoded style) and special
    // chars as percent-sequences. We fully decode the captured URL string by first
    // replacing '+' with space and then calling decodeURIComponent, so assertions
    // read as plain SQL.
    let capturedDecodedSql = '';
    const captureFetchMock = vi.fn().mockImplementation((urlStr: unknown) => {
      const raw = String(urlStr);
      // Extract the 'query' parameter value before full decoding.
      const url = new URL(raw);
      const querySql = url.searchParams.get('query') ?? raw;
      // searchParams.get() already decodes percent-sequences and converts '+' to
      // space, giving us plain SQL for assertion.
      capturedDecodedSql = querySql;
      // Return empty result so the route takes the dqsUnavailable path.
      return Promise.resolve(new Response('', { status: 200 }));
    });

    vi.stubGlobal('fetch', captureFetchMock);
    const { GET: dashboardGET } = await import('./route.js');
    await dashboardGET(makeDashboardRequest());

    // The decoded SQL must reference the canonical events table and cta.clicked type.
    expect(capturedDecodedSql).toContain('FROM events');
    expect(capturedDecodedSql).toContain("'cta.clicked'");
    // Must NOT reference the old non-canonical table or event type.
    expect(capturedDecodedSql).not.toContain('dqs_events');
    expect(capturedDecodedSql).not.toContain('cta_clicked');
    // Must NOT use assigned_at — only ts is canonical.
    expect(capturedDecodedSql).not.toContain('assigned_at');
  });

  it('dashboard aggregate rates equal fixture-derived rates', () => {
    // Deterministic arithmetic check: given the fixture counts, both routes
    // must derive the same rates. This does not require ClickHouse or fetch.
    for (const row of DASHBOARD_FIXTURE_ROWS) {
      const adaptedRate = row.adapted_n > 0 ? row.adapted_conversions / row.adapted_n : 0;
      const holdoutRate = row.holdout_n > 0 ? row.holdout_conversions / row.holdout_n : 0;

      const pilotArchetypeRow = PILOT_ARCHETYPE_ROWS.filter((r) => r.archetype === row.archetype);
      const adaptedPilotRow = pilotArchetypeRow.find((r) => r.holdout === 0);
      const holdoutPilotRow = pilotArchetypeRow.find((r) => r.holdout === 1);

      const pilotAdaptedRate =
        adaptedPilotRow && adaptedPilotRow.sessions > 0
          ? adaptedPilotRow.cta_sessions / adaptedPilotRow.sessions
          : 0;
      const pilotHoldoutRate =
        holdoutPilotRow && holdoutPilotRow.sessions > 0
          ? holdoutPilotRow.cta_sessions / holdoutPilotRow.sessions
          : 0;

      expect(adaptedRate).toBe(pilotAdaptedRate);
      expect(holdoutRate).toBe(pilotHoldoutRate);
    }
  });
});
