/**
 * FOLLOW-1289 (WP-2.4) — lift parity: the SAME ClickHouse-shaped sample must yield the SAME CTA lift
 * from both lift surfaces.
 *
 * Before the consolidation two routes computed the pilot's primary metric independently
 * (`/api/pilot/cta-lift` and `/api/dashboard/analytics/lift`); this test was written and passed
 * against both, comparing them. It now pins the SAME golden numbers on the one surviving route,
 * where the pilot shape (`by_archetype`/`summary`) and the panel shape (`rows`) must agree.
 *
 * The simulator aggregates the fixture itself (distinct-session counts, the FOLLOW-371 contamination
 * exclusion, ingest-time bucketing is not modelled) so the expected numbers do not come from the code
 * under test.
 *
 * @module apps/control-plane/src/app/api/dashboard/analytics/lift/lift-parity.test
 */

import { NextRequest } from 'next/server';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

import type { LiftResponse } from './route-helpers';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655441289';

vi.mock('@estalara/auth', () => ({
  getAuthClaims: vi.fn(),
  isTenantClaims: vi.fn((claims: Record<string, unknown>) => {
    return claims.estalara_staff === false && typeof claims.tenant_id === 'string';
  }),
}));

import { getAuthClaims } from '@estalara/auth';
const mockGetAuthClaims = vi.mocked(getAuthClaims);

vi.mock('@/lib/session-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof SessionAuthModule>();
  return { ...actual, resolveTenantAccess: vi.fn() };
});

import type * as SessionAuthModule from '@/lib/session-auth';
import { resolveTenantAccess } from '@/lib/session-auth';
const mockResolve = vi.mocked(resolveTenantAccess);

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

// ─── Fixture: session-level rows ──────────────────────────────────────────────

interface DecisionRow {
  session_id: string;
  archetype: string;
  holdout_group: 0 | 1;
  variant: string;
}
interface EventRow {
  session_id: string;
  type: string;
}

const decisions: DecisionRow[] = [];
const events: EventRow[] = [];

function addSessions(
  prefix: string,
  archetype: string,
  holdout: 0 | 1,
  variant: string,
  total: number,
  converting: number,
  inquiring: number,
): void {
  for (let i = 0; i < total; i++) {
    const sid = `${prefix}-${String(i)}`;
    decisions.push({ session_id: sid, archetype, holdout_group: holdout, variant });
    events.push({ session_id: sid, type: 'page.view' });
    if (i < converting) {
      // Two clicks per converting session: counts must be DISTINCT sessions.
      events.push({ session_id: sid, type: 'cta.clicked' });
      events.push({ session_id: sid, type: 'cta.clicked' });
    }
    if (i < inquiring) events.push({ session_id: sid, type: 'inquiry.started' });
  }
}

// yield_hunter: adapted 120 / 30 converting, holdout 40 / 6 converting.
addSessions('yh-a', 'yield_hunter', 0, 'v1', 120, 30, 9);
addSessions('yh-h', 'yield_hunter', 1, 'control', 40, 6, 2);
// family_buyer: adapted 80 / 8 converting, holdout 35 / 7 converting (negative lift).
addSessions('fb-a', 'family_buyer', 0, 'v2', 80, 8, 3);
addSessions('fb-h', 'family_buyer', 1, 'control', 35, 7, 1);
// FOLLOW-371 contaminated holdout rows (holdout=1, variant != control): excluded by both routes.
addSessions('bad-h', 'yield_hunter', 1, 'v1', 25, 25, 25);
// Events for sessions that have no decision row: never counted.
for (let i = 0; i < 10; i++)
  events.push({ session_id: `orphan-${String(i)}`, type: 'cta.clicked' });

const clean = decisions.filter((d) => !(d.holdout_group === 1 && d.variant !== 'control'));
const ctaSessions = new Set(
  events.filter((e) => e.type === 'cta.clicked').map((e) => e.session_id),
);

function distinctCount(rows: DecisionRow[], pred: (d: DecisionRow) => boolean): number {
  return new Set(rows.filter(pred).map((d) => d.session_id)).size;
}

/** Minimal ClickHouse stand-in: answers by recognising which query the route sent. */
function clickhouseSimulator(urlStr: string): Response {
  const sql = new URL(urlStr).searchParams.get('query') ?? '';
  const lines: unknown[] = [];

  if (sql.includes('adapted_conversions')) {
    // dashboard/analytics/lift: one row per archetype.
    for (const archetype of [...new Set(clean.map((d) => d.archetype))]) {
      const inA = clean.filter((d) => d.archetype === archetype);
      lines.push({
        archetype,
        adapted_n: distinctCount(inA, (d) => d.holdout_group === 0),
        adapted_conversions: distinctCount(
          inA,
          (d) => d.holdout_group === 0 && ctaSessions.has(d.session_id),
        ),
        holdout_n: distinctCount(inA, (d) => d.holdout_group === 1),
        holdout_conversions: distinctCount(
          inA,
          (d) => d.holdout_group === 1 && ctaSessions.has(d.session_id),
        ),
      });
    }
  } else if (sql.includes('FROM events AS ev')) {
    // cta-lift funnel.
    const armOf = new Map(clean.map((d) => [d.session_id, d.holdout_group]));
    const key = new Map<string, Set<string>>();
    for (const e of events) {
      const arm = armOf.get(e.session_id);
      if (arm === undefined) continue;
      const k = `${e.type}|${String(arm)}`;
      (key.get(k) ?? key.set(k, new Set()).get(k))!.add(e.session_id);
    }
    for (const [k, sessions] of key) {
      const [stage, holdout] = k.split('|');
      lines.push({ stage, holdout: Number(holdout), sessions: sessions.size });
    }
  } else if (sql.includes('GROUP BY ad.archetype, ad.holdout_group')) {
    // cta-lift per-archetype, per-arm.
    for (const archetype of [...new Set(clean.map((d) => d.archetype))]) {
      for (const holdout of [0, 1] as const) {
        const rows = clean.filter((d) => d.archetype === archetype && d.holdout_group === holdout);
        if (rows.length === 0) continue;
        lines.push({
          archetype,
          holdout,
          sessions: distinctCount(rows, () => true),
          cta_sessions: distinctCount(rows, (d) => ctaSessions.has(d.session_id)),
        });
      }
    }
  } else if (sql.includes('GROUP BY ad.holdout_group')) {
    // cta-lift per-arm totals.
    for (const holdout of [0, 1] as const) {
      const rows = clean.filter((d) => d.holdout_group === holdout);
      lines.push({
        holdout,
        sessions: distinctCount(rows, () => true),
        cta_sessions: distinctCount(rows, (d) => ctaSessions.has(d.session_id)),
      });
    }
  } else {
    return new Response(`unrecognised query: ${sql}`, { status: 400 });
  }

  return new Response(lines.map((l) => JSON.stringify(l)).join('\n'), { status: 200 });
}

function authAsTenant(): void {
  const claims = {
    sub: 'user-uuid',
    email: 'analyst@agency.com',
    tenant_id: TENANT_ID,
    agency_role: 'agency:admin' as const,
    estalara_staff: false as const,
    mfa_verified: true,
  };
  mockGetAuthClaims.mockResolvedValue(claims);
  mockResolve.mockResolvedValue({
    via: 'agency',
    tenantId: TENANT_ID,
    claims,
    rawToken: 'agency-jwt',
  });
}

/** The shape both surfaces are reduced to for comparison. */
interface LiftView {
  adapted: number;
  holdout: number;
  byArchetype: Record<
    string,
    {
      adaptedN: number;
      holdoutN: number;
      adaptedRate: number;
      holdoutRate: number;
      liftPct: number | null;
      pValue: number;
    }
  >;
}

/** GOLDEN numbers — hand-checkable from the fixture (30/120 vs 6/40, 8/80 vs 7/35). */
const EXPECTED_BY_ARCHETYPE = {
  yield_hunter: {
    adaptedN: 120,
    holdoutN: 40,
    adaptedRate: 0.25,
    holdoutRate: 0.15,
    liftPct: 66.67,
  },
  family_buyer: { adaptedN: 80, holdoutN: 35, adaptedRate: 0.1, holdoutRate: 0.2, liftPct: -50 },
} as const;

describe('FOLLOW-1289: lift parity (same sample → same lift)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLICKHOUSE_URL = 'http://clickhouse.test:8123';
    authAsTenant();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((u: unknown) => Promise.resolve(clickhouseSimulator(String(u)))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.CLICKHOUSE_URL;
  });

  it('the single lift route yields, from the same sample, the lift both former surfaces reported', async () => {
    const req = new NextRequest('http://localhost/api/dashboard/analytics/lift?window_days=7', {
      headers: { Authorization: 'Bearer mock-token' },
    });
    const { GET } = await import('./route.js');
    const res = await GET(req);
    expect(res.status).toBe(200);
    const pilot = (await res.json()) as LiftResponse;
    expect(pilot.data_source).toBe('clickhouse');
    const dash = pilot;

    const fromPilot: LiftView = {
      adapted: pilot.summary.adapted_sessions,
      holdout: pilot.summary.holdout_sessions,
      byArchetype: Object.fromEntries(
        pilot.by_archetype.map((r) => [
          r.archetype,
          {
            adaptedN: r.n_adapted,
            holdoutN: r.n_holdout,
            adaptedRate: r.adapted_cta_rate,
            holdoutRate: r.holdout_cta_rate,
            liftPct: r.lift_pct,
            pValue: r.p_value,
          },
        ]),
      ),
    };
    const fromDash: LiftView = {
      adapted: dash.rows.reduce((s, r) => s + r.adaptedN, 0),
      holdout: dash.rows.reduce((s, r) => s + r.holdoutN, 0),
      byArchetype: Object.fromEntries(
        dash.rows.map((r) => [
          r.archetype,
          {
            adaptedN: r.adaptedN,
            holdoutN: r.holdoutN,
            adaptedRate: r.adaptedRate,
            holdoutRate: r.holdoutRate,
            liftPct: r.lift,
            pValue: r.pValue,
          },
        ]),
      ),
    };

    expect(fromDash).toEqual(fromPilot);

    // Anchor to the hand-checkable golden numbers so "both wrong the same way" cannot pass.
    for (const [name, want] of Object.entries(EXPECTED_BY_ARCHETYPE)) {
      expect(fromPilot.byArchetype[name]).toMatchObject(want);
    }
    expect(fromPilot.adapted).toBe(200);
    expect(fromPilot.holdout).toBe(75);
    // Overall summary: (38/200 - 13/75) / (13/75) = 9.62% relative lift.
    expect(pilot.summary.adapted_cta_rate).toBeCloseTo(0.19, 4);
    expect(pilot.summary.holdout_cta_rate).toBeCloseTo(0.1733, 4);
    expect(pilot.summary.relative_lift_pct).toBeCloseTo(9.62, 2);
  });
});
