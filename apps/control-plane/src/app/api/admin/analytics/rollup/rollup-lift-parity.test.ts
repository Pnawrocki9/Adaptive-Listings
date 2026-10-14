/**
 * FOLLOW-1303 + FOLLOW-1203 — the staff rollup (`getPlatformAnalyticsRollup`, whose
 * `rollup.ctaLift` the FOLLOW-819 harness reads for AC(5)) and the tenant lift route's query
 * builder (`fetchLiftRaw` + `buildResponseFromRaw`, `/api/dashboard/analytics/lift`) must count the
 * SAME sessions and report the SAME lift from the same ClickHouse sample:
 *
 *   - FOLLOW-371 contaminated holdout rows (`holdout_group = 1` with a non-control variant) are in
 *     neither (FOLLOW-1303);
 *   - a conversion is a SIGNED `inquiry.completed` / `live.signup` received at or after the
 *     session's first decision (FOLLOW-1203, CEO decision #4 + ESC-084). A `cta.clicked`, an
 *     unsigned (browser-emitted) conversion and a signed conversion from before the first decision
 *     are each REPORTED and never in the numerator.
 *
 * The ClickHouse stand-in below evaluates an EVENT-LEVEL fixture itself and honours each rule ONLY
 * when the SQL it receives carries that rule's text, pinned verbatim here (not imported from the
 * code under test) — so a query that drops `caller_signed = 1` counts browser conversions, and one
 * that drops the attribution clause counts pre-exposure ones, exactly as real ClickHouse would. The
 * expected numbers are hand-checkable from the fixture.
 *
 * RED-FIRST (run 2026-10-14, each by editing `route-helpers.ts` and reverting): dropping
 * `AND caller_signed = 1` from the signed predicate reds "a forged browser inquiry.completed…";
 * dropping `AND ev.last_signed_conversion_at >= ad.ts` reds "a signed conversion BEFORE the first
 * decision…"; counting `cta.clicked` as the conversion (the pre-FOLLOW-1203 reader) reds all of
 * them. Against main's readers the file does not compile (no `conversions` on the response).
 *
 * A second tenant is in the fixture so the per-tenant rollup row is compared with the lift route
 * for that tenant, and the staff aggregate with the hand-summed counts (FOLLOW-1303 amendment,
 * 2026-10-11: the rollup joins on tenant AND session, so its unfenced aggregate does not mix
 * tenants inside a per-tenant row).
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

/** The rules, pinned verbatim. The stand-in applies each one only when the SQL contains it. */
const CONTAMINATION_PREDICATE = `NOT (ad.holdout_group = 1 AND ad.variant != 'control')`;
const SIGNED_PREDICATE = `type IN ('inquiry.completed', 'live.signup') AND caller_signed = 1`;
const ATTRIBUTION_PREDICATE = `ev.signed_conversions > 0 AND ev.last_signed_conversion_at >= ad.ts`;

// ─── Fixture ──────────────────────────────────────────────────────────────────

interface DecisionRow {
  tenant_id: string;
  session_id: string;
  holdout_group: 0 | 1;
  variant: string;
  /** Decision time, in arbitrary ticks. */
  ts: number;
}
interface EventRow {
  tenant_id: string;
  session_id: string;
  type: string;
  caller_signed: 0 | 1;
  /** `ingest_received_at`, same ticks. */
  at: number;
}

const decisions: DecisionRow[] = [];
const events: EventRow[] = [];

/** What the sessions `[from, to)` of a cohort did, relative to their first decision at tick 100. */
type Behaviour =
  | 'signed_after' // a signed inquiry.completed AFTER the first decision → the numerator
  | 'signed_before' // a signed live.signup BEFORE the first decision → pre_exposure
  | 'unsigned' // a browser-emitted inquiry.completed after the decision → unsigned funnel count
  | 'click_only' // a cta.clicked and nothing else → funnel stage
  | 'none';

function addSessions(
  tenant: string,
  prefix: string,
  holdout: 0 | 1,
  variant: string,
  plan: readonly (readonly [Behaviour, number])[],
): void {
  let i = 0;
  for (const [behaviour, count] of plan) {
    for (let k = 0; k < count; k++, i++) {
      const sid = `${prefix}-${String(i)}`;
      const base = { tenant_id: tenant, session_id: sid };
      // Two decision rows per session (ticks 100 and 200): every count is DISTINCT sessions, and
      // "first decision" is the earlier one.
      decisions.push({ ...base, holdout_group: holdout, variant, ts: 100 });
      decisions.push({ ...base, holdout_group: holdout, variant, ts: 200 });
      if (behaviour === 'signed_after') {
        // Between the two decisions: at/after the FIRST, before the second.
        events.push({ ...base, type: 'inquiry.completed', caller_signed: 1, at: 150 });
        events.push({ ...base, type: 'cta.clicked', caller_signed: 0, at: 140 });
      } else if (behaviour === 'signed_before') {
        events.push({ ...base, type: 'live.signup', caller_signed: 1, at: 50 });
      } else if (behaviour === 'unsigned') {
        events.push({ ...base, type: 'inquiry.completed', caller_signed: 0, at: 150 });
      } else if (behaviour === 'click_only') {
        events.push({ ...base, type: 'cta.clicked', caller_signed: 0, at: 150 });
      }
    }
  }
}

// Tenant A — adapted 120: 30 confirmed, 9 pre-exposure, 20 forged/browser, 25 click-only, 36 none.
addSessions(TENANT_A, 'a-ad', 0, 'v1', [
  ['signed_after', 30],
  ['signed_before', 9],
  ['unsigned', 20],
  ['click_only', 25],
  ['none', 36],
]);
// Tenant A — clean holdout 40: 6 confirmed, 2 pre-exposure, 5 browser, 27 none.
addSessions(TENANT_A, 'a-ho', 1, 'control', [
  ['signed_after', 6],
  ['signed_before', 2],
  ['unsigned', 5],
  ['none', 27],
]);
// Tenant A — contaminated holdout 25, every one confirmed: must be in no count at all.
addSessions(TENANT_A, 'a-bad', 1, 'v1', [['signed_after', 25]]);
// Tenant B — adapted 50: 5 confirmed, 45 none. Clean holdout 20: 4 confirmed, 16 none.
addSessions(TENANT_B, 'b-ad', 0, 'v2', [
  ['signed_after', 5],
  ['none', 45],
]);
addSessions(TENANT_B, 'b-ho', 1, 'control', [
  ['signed_after', 4],
  ['none', 16],
]);
addSessions(TENANT_B, 'b-bad', 1, 'v2', [['signed_after', 10]]);
// A signed conversion under tenant A for a session id tenant B also uses: the join is on tenant
// AND session, so it must never convert tenant B's session.
decisions.push({
  tenant_id: TENANT_B,
  session_id: 'shared-0',
  holdout_group: 1,
  variant: 'control',
  ts: 100,
});
events.push({
  tenant_id: TENANT_A,
  session_id: 'shared-0',
  type: 'inquiry.completed',
  caller_signed: 1,
  at: 150,
});
// A signed conversion for a session `/api/adapt` never saw (no decision row): in no arm, no count.
events.push({
  tenant_id: TENANT_A,
  session_id: 'never-adapted-0',
  type: 'inquiry.completed',
  caller_signed: 1,
  at: 150,
});

const keyOf = (r: { tenant_id: string; session_id: string }): string =>
  `${r.tenant_id}|${r.session_id}`;

function distinct(rows: DecisionRow[], pred: (d: DecisionRow) => boolean): number {
  return new Set(rows.filter(pred).map(keyOf)).size;
}

const isConversionType = (e: EventRow): boolean =>
  e.type === 'inquiry.completed' || e.type === 'live.signup';

/** The conversion columns of one arm, computed the way the SQL the stand-in received asks. */
function conversionColumns(
  sql: string,
  rows: DecisionRow[],
  prefix: string,
): Record<string, number> {
  const eventsOf = (d: DecisionRow): EventRow[] => events.filter((e) => keyOf(e) === keyOf(d));
  const out: Record<string, number> = {
    [`${prefix}cta_sessions`]: distinct(rows, (d) =>
      eventsOf(d).some((e) => e.type === 'cta.clicked'),
    ),
  };
  if (!sql.includes('caller_signed')) return out; // the flag-off query: no class columns at all
  // A query that names the column but not as the pinned signed predicate counts every class.
  const signedOnly = sql.includes(SIGNED_PREDICATE);
  const attributed = sql.includes(ATTRIBUTION_PREDICATE);
  const signedEvents = (d: DecisionRow): EventRow[] =>
    eventsOf(d).filter((e) => isConversionType(e) && (!signedOnly || e.caller_signed === 1));
  out[`${prefix}signed_conversion_sessions`] = distinct(rows, (d) => signedEvents(d).length > 0);
  out[`${prefix}conversions`] = distinct(rows, (d) => {
    const s = signedEvents(d);
    if (s.length === 0) return false;
    // Row-level, as in the SQL: THIS decision row is at or before the last signed conversion.
    return !attributed || Math.max(...s.map((e) => e.at)) >= d.ts;
  });
  out[`${prefix}unsigned_conversion_sessions`] = distinct(rows, (d) =>
    eventsOf(d).some((e) => isConversionType(e) && e.caller_signed === 0),
  );
  return out;
}

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
      const adaptedRows = rows.filter((d) => d.holdout_group === 0);
      const holdoutRows = rows.filter((d) => d.holdout_group === 1);
      lines.push({
        tenant_id: tenant,
        sessions: distinct(rows, () => true),
        adapted: distinct(adaptedRows, () => true),
        holdout: distinct(holdoutRows, () => true),
        adapted_n: distinct(adaptedRows, () => true),
        holdout_n: distinct(holdoutRows, () => true),
        ...conversionColumns(sql, rows, 'all_'),
        ...conversionColumns(sql, adaptedRows, 'adapted_'),
        ...conversionColumns(sql, holdoutRows, 'holdout_'),
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
        ...conversionColumns(sql, arm, ''),
      });
    }
  } else {
    return new Response(`unrecognised query: ${sql}`, { status: 400 });
  }
  return new Response(lines.map((l) => JSON.stringify(l)).join('\n'), { status: 200 });
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** Every SQL statement the code under test sent to the stand-in, in order. */
const sentQueries: string[] = [];

function stubStores(callerSignedFlag: string): void {
  vi.clearAllMocks();
  vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123');
  vi.stubEnv('DATABASE_URL_ADMIN', 'postgres://rollup-parity.test/db');
  vi.stubEnv('SCORING_PATH_COLUMN_ENABLED', '');
  vi.stubEnv('CALLER_SIGNED_COLUMN_ENABLED', callerSignedFlag);
  mockWhere.mockResolvedValue([
    { id: TENANT_A, name: 'Brand A', slug: 'brand-a' },
    { id: TENANT_B, name: 'Brand B', slug: 'brand-b' },
  ]);
  mockGroupBy.mockResolvedValue([]);
  sentQueries.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation((u: unknown) => {
      const url = String(u);
      sentQueries.push(new URL(url).searchParams.get('query') ?? '');
      return Promise.resolve(clickhouseSimulator(url));
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('FOLLOW-1303 / FOLLOW-1203: the rollup and the lift route count the same conversions', () => {
  beforeEach(() => {
    stubStores('true');
  });

  it('reader parity: per tenant, the rollup row reports the same sessions, numerator, excluded classes and lift as the lift route', async () => {
    const result = await getPlatformAnalyticsRollup();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.data_source).toBe('clickhouse');
    expect(result.data.conversion_source).toBe('signed_events');

    for (const tenant of [TENANT_A, TENANT_B]) {
      const raw = await fetchLiftRaw(tenant, result.data.window_days);
      expect(raw).not.toBeNull();
      const lift = buildResponseFromRaw(tenant, result.data.window_days, raw!, 'clickhouse');
      const brand = result.data.brands.find((b) => b.tenant_id === tenant);
      expect(brand).toBeDefined();
      expect(lift.conversion_source).toBe('signed_events');

      expect(brand!.adapted).toBe(lift.summary!.adapted_sessions);
      expect(brand!.holdout).toBe(lift.summary!.holdout_sessions);
      expect(brand!.ctaLift).not.toBeNull();
      expect(round2(brand!.ctaLift!)).toBe(lift.summary!.relative_lift_pct);

      const { adapted, holdout } = lift.conversions;
      expect(brand!.conversions).toEqual({
        adaptedN: lift.summary!.adapted_sessions,
        holdoutN: lift.summary!.holdout_sessions,
        adaptedConversions: adapted.confirmed_conversions,
        holdoutConversions: holdout.confirmed_conversions,
        preExposureConversions:
          adapted.pre_exposure_conversions! + holdout.pre_exposure_conversions!,
        unsignedConversions: adapted.unsigned_conversions! + holdout.unsigned_conversions!,
        ctaClickedSessions: adapted.cta_clicked_sessions + holdout.cta_clicked_sessions,
      });
    }
  });

  it('a signed inquiry.completed after the first decision moves the lift numerator — golden numbers, contaminated rows excluded', async () => {
    const result = await getPlatformAnalyticsRollup();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = result.data.brands.find((b) => b.tenant_id === TENANT_A)!;
    const b = result.data.brands.find((x) => x.tenant_id === TENANT_B)!;

    // Tenant A: 30/120 vs 6/40 → (0.25 − 0.15) / 0.15 = +66.67 %. With the 25 contaminated
    // all-converting rows it would read 30/120 vs 31/65 → −47.58 %.
    expect(a).toMatchObject({ sessions: 160, adapted: 120, holdout: 40 });
    expect(a.conversions).toMatchObject({ adaptedConversions: 30, holdoutConversions: 6 });
    expect(a.ctaLift).toBeCloseTo(66.6667, 3);
    // Tenant B: 5/50 vs 4/21 (the shared-0 session is held out and did NOT convert under B).
    expect(b).toMatchObject({ sessions: 71, adapted: 50, holdout: 21 });
    expect(b.conversions).toMatchObject({ adaptedConversions: 5, holdoutConversions: 4 });
    expect(b.ctaLift).toBeCloseTo(((0.1 - 4 / 21) / (4 / 21)) * 100, 6);

    // Staff aggregate = the summed clean counts: 35/170 vs 10/61.
    expect(result.data.rollup).toMatchObject({ sessions: 231, adapted: 170, holdout: 61 });
    expect(result.data.rollup.conversions).toMatchObject({
      adaptedN: 170,
      holdoutN: 61,
      adaptedConversions: 35,
      holdoutConversions: 10,
    });
    expect(result.data.rollup.ctaLift).toBeCloseTo(((35 / 170 - 10 / 61) / (10 / 61)) * 100, 6);
  });

  it('a forged browser inquiry.completed does not move the lift numerator — it is reported as an unsigned conversion', async () => {
    const result = await getPlatformAnalyticsRollup();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = result.data.brands.find((b) => b.tenant_id === TENANT_A)!;
    // 20 adapted + 5 holdout sessions POSTed an unsigned inquiry.completed after their decision.
    // Counted as conversions they would make it 50/120 vs 11/40 = +51.5 %, not +66.67 %.
    expect(a.conversions.unsignedConversions).toBe(25);
    expect(a.conversions.adaptedConversions).toBe(30);
    expect(a.conversions.holdoutConversions).toBe(6);
    expect(a.ctaLift).toBeCloseTo(66.6667, 3);

    const raw = await fetchLiftRaw(TENANT_A, 7);
    const lift = buildResponseFromRaw(TENANT_A, 7, raw!, 'clickhouse');
    expect(lift.conversions.adapted).toMatchObject({
      confirmed_conversions: 30,
      unsigned_conversions: 20,
    });
    expect(lift.conversions.holdout).toMatchObject({
      confirmed_conversions: 6,
      unsigned_conversions: 5,
    });
    expect(lift.summary!.adapted_cta_rate).toBeCloseTo(0.25, 4);
  });

  it('a signed conversion BEFORE the first decision lands in pre_exposure_conversions, not in the numerator', async () => {
    const result = await getPlatformAnalyticsRollup();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = result.data.brands.find((b) => b.tenant_id === TENANT_A)!;
    // 9 adapted + 2 holdout sessions carry a signed live.signup from BEFORE their first decision.
    // Attributed they would make it 39/120 vs 8/40 = +62.5 %.
    expect(a.conversions.preExposureConversions).toBe(11);
    expect(a.conversions.adaptedConversions).toBe(30);
    expect(a.ctaLift).toBeCloseTo(66.6667, 3);

    const raw = await fetchLiftRaw(TENANT_A, 7);
    const lift = buildResponseFromRaw(TENANT_A, 7, raw!, 'clickhouse');
    expect(lift.conversions.adapted.pre_exposure_conversions).toBe(9);
    expect(lift.conversions.holdout.pre_exposure_conversions).toBe(2);
    expect(lift.conversions.adapted.confirmed_conversions).toBe(30);
  });

  it('cta.clicked stays a reported funnel stage and never enters the numerator', async () => {
    const result = await getPlatformAnalyticsRollup();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const a = result.data.brands.find((b) => b.tenant_id === TENANT_A)!;
    // 30 adapted + 6 holdout confirmed sessions clicked on the way, plus 25 click-only sessions;
    // the numerator stays 30.
    expect(a.conversions.ctaClickedSessions).toBe(61);
    expect(a.conversions.adaptedConversions).toBe(30);
  });

  it('a signed conversion for a session /api/adapt never saw is in no count', async () => {
    const result = await getPlatformAnalyticsRollup();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const total = result.data.rollup.conversions;
    // `never-adapted-0` and tenant A's `shared-0` have no decision row under their tenant.
    expect(total.adaptedConversions! + total.holdoutConversions!).toBe(45);
    expect(total.preExposureConversions).toBe(11);
  });
});

describe('FOLLOW-1203 Rule K.2: without the caller-class column neither reader reports a lift', () => {
  it.each(['', 'false'])(
    'CALLER_SIGNED_COLUMN_ENABLED=%j → conversion_source disabled, null lift, the column never named',
    async (flag) => {
      stubStores(flag);
      const result = await getPlatformAnalyticsRollup();
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.conversion_source).toBe('disabled');
      expect(result.data.rollup.ctaLift).toBeNull();
      expect(result.data.rollup.conversions).toEqual({
        adaptedN: 170,
        holdoutN: 61,
        adaptedConversions: null,
        holdoutConversions: null,
        preExposureConversions: null,
        unsignedConversions: null,
        ctaClickedSessions: 70,
      });
      for (const brand of result.data.brands) expect(brand.ctaLift).toBeNull();
      // Sessions and arms do not depend on the column and stay live.
      expect(result.data.rollup).toMatchObject({ sessions: 231, adapted: 170, holdout: 61 });

      const raw = await fetchLiftRaw(TENANT_A, 7);
      const lift = buildResponseFromRaw(TENANT_A, 7, raw!, 'clickhouse');
      expect(lift.conversion_source).toBe('disabled');
      expect(lift.summary).toBeNull();

      expect(sentQueries.length).toBeGreaterThan(0);
      for (const q of sentQueries) expect(q).not.toContain('caller_signed');
    },
  );
});
