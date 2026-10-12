/**
 * FOLLOW-1303 — the staff rollup (`getPlatformAnalyticsRollup`, whose `rollup.ctaLift` the
 * FOLLOW-819 harness grades for AC(5)) and the tenant lift route's query builder (`fetchLiftRaw` +
 * `buildResponseFromRaw`, `/api/dashboard/analytics/lift`) must count the SAME sessions and report
 * the SAME lift from the same ClickHouse sample — including FOLLOW-371 contaminated holdout rows
 * (`holdout_group = 1` with a non-control variant), which the lift route excludes.
 *
 * The ClickHouse stand-in below evaluates the fixture itself and honours the contamination
 * predicate ONLY when the SQL it receives carries it, verbatim — so a query that omits the
 * predicate counts the contaminated rows, exactly as real ClickHouse would. The expected numbers
 * are hand-checkable from the fixture and do not come from the code under test.
 *
 * A second tenant is in the fixture so the per-tenant rollup row is compared with the lift route
 * for that tenant, and the staff aggregate with the hand-summed clean counts (FOLLOW-1303
 * amendment, 2026-10-11: the rollup joins on tenant AND session, so its unfenced aggregate does
 * not mix tenants inside a per-tenant row — that premise was withdrawn, the aggregate stays).
 *
 * @module apps/control-plane/src/app/api/admin/analytics/rollup/rollup-lift-parity.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const TENANT_A = '550e8400-e29b-41d4-a716-446655441303';
const TENANT_B = '550e8400-e29b-41d4-a716-446655442303';

const mockWhere = vi.fn();
const mockGroupBy = vi.fn();
const mockFrom = vi.fn(() => ({ where: mockWhere, groupBy: mockGroupBy }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({ select: mockSelect })),
  tenants: { id: 'id', name: 'name', slug: 'slug', deletedAt: 'deleted_at' },
  quizCompletions: { tenantId: 'tenant_id' },
}));

import { getPlatformAnalyticsRollup } from './data';
import {
  buildResponseFromRaw,
  fetchLiftRaw,
} from '@/app/api/dashboard/analytics/lift/route-helpers';

/** The lift route's FOLLOW-371 predicate, pinned verbatim (not imported from the code under test). */
const CONTAMINATION_PREDICATE = `NOT (ad.holdout_group = 1 AND ad.variant != 'control')`;

// ─── Fixture ──────────────────────────────────────────────────────────────────

interface DecisionRow {
  tenant_id: string;
  session_id: string;
  holdout_group: 0 | 1;
  variant: string;
}

const decisions: DecisionRow[] = [];
/** `${tenant_id}|${session_id}` of every session with a cta.clicked event. */
const ctaKeys = new Set<string>();

function addSessions(
  tenant: string,
  prefix: string,
  holdout: 0 | 1,
  variant: string,
  total: number,
  converting: number,
): void {
  for (let i = 0; i < total; i++) {
    const sid = `${prefix}-${String(i)}`;
    // Two decision rows per session: every count must be DISTINCT sessions.
    decisions.push({ tenant_id: tenant, session_id: sid, holdout_group: holdout, variant });
    decisions.push({ tenant_id: tenant, session_id: sid, holdout_group: holdout, variant });
    if (i < converting) ctaKeys.add(`${tenant}|${sid}`);
  }
}

// Tenant A: adapted 120 / 30 converting; clean holdout 40 / 6; contaminated holdout 25 / 25.
addSessions(TENANT_A, 'a-ad', 0, 'v1', 120, 30);
addSessions(TENANT_A, 'a-ho', 1, 'control', 40, 6);
addSessions(TENANT_A, 'a-bad', 1, 'v1', 25, 25);
// Tenant B: adapted 50 / 5; clean holdout 20 / 4; contaminated holdout 10 / 10.
addSessions(TENANT_B, 'b-ad', 0, 'v2', 50, 5);
addSessions(TENANT_B, 'b-ho', 1, 'control', 20, 4);
addSessions(TENANT_B, 'b-bad', 1, 'v2', 10, 10);
// cta.clicked for a session id that tenant B also uses, but under tenant A: joins on tenant AND
// session, so it must never convert tenant B's session.
decisions.push({
  tenant_id: TENANT_B,
  session_id: 'shared-0',
  holdout_group: 1,
  variant: 'control',
});
ctaKeys.add(`${TENANT_A}|shared-0`);

function distinct(rows: DecisionRow[], pred: (d: DecisionRow) => boolean): number {
  return new Set(rows.filter(pred).map((d) => `${d.tenant_id}|${d.session_id}`)).size;
}

const converted = (d: DecisionRow): boolean => ctaKeys.has(`${d.tenant_id}|${d.session_id}`);

/** Minimal ClickHouse stand-in for the two queries under comparison. */
function clickhouseSimulator(urlStr: string): Response {
  const url = new URL(urlStr);
  const sql = url.searchParams.get('query') ?? '';
  const excludesContaminated = sql.includes(CONTAMINATION_PREDICATE);
  const visible = decisions.filter(
    (d) => !excludesContaminated || !(d.holdout_group === 1 && d.variant !== 'control'),
  );
  const lines: unknown[] = [];

  if (sql.includes('GROUP BY ad.tenant_id')) {
    // Staff rollup: one row per tenant.
    for (const tenant of [...new Set(visible.map((d) => d.tenant_id))]) {
      const rows = visible.filter((d) => d.tenant_id === tenant);
      const adapted = distinct(rows, (d) => d.holdout_group === 0);
      const holdout = distinct(rows, (d) => d.holdout_group === 1);
      lines.push({
        tenant_id: tenant,
        sessions: distinct(rows, () => true),
        adapted,
        holdout,
        adapted_n: adapted,
        adapted_conversions: distinct(rows, (d) => d.holdout_group === 0 && converted(d)),
        holdout_n: holdout,
        holdout_conversions: distinct(rows, (d) => d.holdout_group === 1 && converted(d)),
      });
    }
  } else if (
    sql.includes('GROUP BY ad.archetype, ad.holdout_group') ||
    sql.includes('FROM events AS ev')
  ) {
    // Per-archetype and funnel breakdowns are not compared here (the summary is).
  } else if (/GROUP BY ad\.holdout_group\s*(FORMAT|$)/.test(sql)) {
    // Lift route per-arm totals, fenced on the bound tenant.
    const tenant = url.searchParams.get('param_tenant_id');
    const rows = visible.filter((d) => d.tenant_id === tenant);
    for (const holdout of [0, 1] as const) {
      const arm = rows.filter((d) => d.holdout_group === holdout);
      if (arm.length === 0) continue;
      lines.push({
        holdout,
        sessions: distinct(arm, () => true),
        cta_sessions: distinct(arm, converted),
      });
    }
  } else {
    return new Response(`unrecognised query: ${sql}`, { status: 400 });
  }
  return new Response(lines.map((l) => JSON.stringify(l)).join('\n'), { status: 200 });
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

describe('FOLLOW-1303: rollup ctaLift parity with the lift route (contaminated holdout rows)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgres://rollup-parity.test/db');
    vi.stubEnv('SCORING_PATH_COLUMN_ENABLED', '');
    mockWhere.mockResolvedValue([
      { id: TENANT_A, name: 'Brand A', slug: 'brand-a' },
      { id: TENANT_B, name: 'Brand B', slug: 'brand-b' },
    ]);
    mockGroupBy.mockResolvedValue([]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((u: unknown) => Promise.resolve(clickhouseSimulator(String(u)))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('per tenant, the rollup row counts the same sessions and reports the same lift as the lift route', async () => {
    const result = await getPlatformAnalyticsRollup();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.data_source).toBe('clickhouse');

    for (const tenant of [TENANT_A, TENANT_B]) {
      const raw = await fetchLiftRaw(tenant, result.data.window_days);
      expect(raw).not.toBeNull();
      const lift = buildResponseFromRaw(tenant, result.data.window_days, raw!, 'clickhouse');
      const brand = result.data.brands.find((b) => b.tenant_id === tenant);
      expect(brand).toBeDefined();

      expect(brand!.adapted).toBe(lift.summary.adapted_sessions);
      expect(brand!.holdout).toBe(lift.summary.holdout_sessions);
      expect(brand!.ctaLift).not.toBeNull();
      expect(round2(brand!.ctaLift!)).toBe(lift.summary.relative_lift_pct);
    }
  });

  it('excludes contaminated holdout rows — golden numbers from the fixture', async () => {
    const result = await getPlatformAnalyticsRollup();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = result.data.brands.find((b) => b.tenant_id === TENANT_A)!;
    const b = result.data.brands.find((x) => x.tenant_id === TENANT_B)!;

    // Tenant A: 30/120 vs 6/40 → (0.25 − 0.15) / 0.15 = +66.67 %. With the 25 contaminated
    // all-converting rows it would read 30/120 vs 31/65 → −47.58 %.
    expect(a).toMatchObject({ sessions: 160, adapted: 120, holdout: 40 });
    expect(a.ctaLift).toBeCloseTo(66.6667, 3);
    // Tenant B: 5/50 vs 4/21 (the shared-0 session is held out and did NOT convert under B).
    expect(b).toMatchObject({ sessions: 71, adapted: 50, holdout: 21 });
    expect(b.ctaLift).toBeCloseTo(((0.1 - 4 / 21) / (4 / 21)) * 100, 6);

    // Staff aggregate = the summed clean counts: 35/170 vs 10/61.
    expect(result.data.rollup).toMatchObject({ sessions: 231, adapted: 170, holdout: 61 });
    expect(result.data.rollup.ctaLift).toBeCloseTo(((35 / 170 - 10 / 61) / (10 / 61)) * 100, 6);
  });
});
