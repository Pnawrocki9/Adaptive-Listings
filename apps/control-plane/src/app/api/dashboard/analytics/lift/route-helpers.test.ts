/**
 * Unit tests for the lift report assembly (FOLLOW-1289; moved from the retired
 * `pilot/cta-lift/route.test.ts`). The statistics themselves are covered by
 * `src/lib/pilot-stats.test.ts`; here we pin how raw ClickHouse counts become the public response.
 *
 * @module apps/control-plane/src/app/api/dashboard/analytics/lift/route-helpers.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  parseWindowDays,
  buildResponseFromRaw,
  conversionCountColumns,
  conversionEventsSubquery,
  fetchLiftDaily,
  fetchLiftRaw,
  readConversionCounts,
} from './route-helpers';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';

/**
 * One arm's conversion counts with `n` server-confirmed conversions (the lift numerator since
 * FOLLOW-1203). The click count is deliberately a DIFFERENT number, so a lift that read clicks
 * again would move every expectation below.
 */
function conv(n: number): {
  cta_sessions: number;
  conversions: number;
  pre_exposure_conversions: number;
  unsigned_conversions: number;
} {
  return {
    cta_sessions: n * 3 + 7,
    conversions: n,
    pre_exposure_conversions: 0,
    unsigned_conversions: 0,
  };
}

// ─── parseWindowDays ──────────────────────────────────────────────────────────

describe('parseWindowDays', () => {
  it('accepts 7, 14, 30', () => {
    expect(parseWindowDays('7')).toBe(7);
    expect(parseWindowDays('14')).toBe(14);
    expect(parseWindowDays('30')).toBe(30);
  });

  it('defaults to 7 for missing or invalid input', () => {
    expect(parseWindowDays(null)).toBe(7);
    expect(parseWindowDays('999')).toBe(7);
    expect(parseWindowDays('abc')).toBe(7);
  });
});

// ─── buildResponseFromRaw (assembly + stats integration) ────────────────────────

describe('buildResponseFromRaw', () => {
  it('computes summary, funnel and archetype rows from raw counts', () => {
    const raw = {
      groups: [
        { holdout: 0, sessions: 1000, ...conv(150) },
        { holdout: 1, sessions: 1000, ...conv(100) },
      ],
      archetypes: [
        { archetype: 'investor', holdout: 0, sessions: 600, ...conv(96) },
        { archetype: 'investor', holdout: 1, sessions: 600, ...conv(60) },
        { archetype: 'family_buyer', holdout: 0, sessions: 400, ...conv(54) },
        { archetype: 'family_buyer', holdout: 1, sessions: 400, ...conv(40) },
      ],
      funnel: [
        { stage: 'page.view', holdout: 0, sessions: 1000 },
        { stage: 'page.view', holdout: 1, sessions: 1000 },
        { stage: 'cta.clicked', holdout: 0, sessions: 150 },
        { stage: 'cta.clicked', holdout: 1, sessions: 100 },
      ],
      callerClass: true,
    };

    const out = buildResponseFromRaw(TENANT_ID, 14, raw, 'clickhouse');

    expect(out.window_days).toBe(14);
    expect(out.tenant_id).toBe(TENANT_ID);
    // Summary: 0.15 vs 0.10 with n=1000 each → significant.
    expect(out.summary!.adapted_cta_rate).toBeCloseTo(0.15, 4);
    expect(out.summary!.holdout_cta_rate).toBeCloseTo(0.1, 4);
    expect(out.summary!.absolute_lift).toBeCloseTo(0.05, 4);
    expect(out.summary!.relative_lift_pct).toBeCloseTo(50, 1);
    expect(out.summary!.p_value).toBeLessThan(0.05);
    expect(out.summary!.is_significant).toBe(true);
    expect(out.summary!.confidence).toBe('95%');

    // Funnel always has all five stages, ordered.
    expect(out.funnel.map((f) => f.stage)).toEqual([
      'page.view',
      'listing.viewed',
      'cta.clicked',
      'inquiry.started',
      'inquiry.completed',
    ]);
    // Missing stage (listing.viewed) → zero counts, not undefined.
    const lv = out.funnel.find((f) => f.stage === 'listing.viewed')!;
    expect(lv.adapted_count).toBe(0);
    expect(lv.adapted_rate).toBe(0);

    // By-archetype sorted by adapted volume desc.
    expect(out.by_archetype.map((a) => a.archetype)).toEqual(['investor', 'family_buyer']);
    const investor = out.by_archetype[0]!;
    expect(investor.n_adapted).toBe(600);
    expect(investor.n_holdout).toBe(600);
    expect(typeof investor.p_value).toBe('number');
  });

  it('sets relative_lift_pct to null when holdout CTA rate is 0', () => {
    const raw = {
      groups: [
        { holdout: 0, sessions: 500, ...conv(75) },
        { holdout: 1, sessions: 500, ...conv(0) },
      ],
      archetypes: [],
      funnel: [],
      callerClass: true,
    };
    const out = buildResponseFromRaw(TENANT_ID, 7, raw, 'clickhouse');
    expect(out.summary!.holdout_cta_rate).toBe(0);
    expect(out.summary!.relative_lift_pct).toBeNull();
  });

  it('returns not_significant when sample is below 30 per arm', () => {
    const raw = {
      groups: [
        { holdout: 0, sessions: 20, ...conv(10) },
        { holdout: 1, sessions: 20, ...conv(2) },
      ],
      archetypes: [],
      funnel: [],
      callerClass: true,
    };
    const out = buildResponseFromRaw(TENANT_ID, 7, raw, 'clickhouse');
    expect(out.summary!.is_significant).toBe(false);
    expect(out.summary!.confidence).toBe('not_significant');
    expect(out.summary!.p_value).toBe(1);
  });
});

// ─── Both row shapes come from ONE computation (FOLLOW-1289) ───────────────────

describe('buildResponseFromRaw — by_archetype and rows share one lift computation', () => {
  it('agrees on counts, rates, lift and p-value for every archetype', () => {
    const raw = {
      groups: [],
      archetypes: [
        { archetype: 'investor', holdout: 0, sessions: 600, ...conv(96) },
        { archetype: 'investor', holdout: 1, sessions: 600, ...conv(60) },
        { archetype: 'family_buyer', holdout: 0, sessions: 400, ...conv(54) },
        { archetype: 'family_buyer', holdout: 1, sessions: 400, ...conv(40) },
      ],
      funnel: [],
      callerClass: true,
    };
    const out = buildResponseFromRaw(TENANT_ID, 7, raw, 'clickhouse');
    expect(out.rows.map((r) => r.archetype)).toEqual(out.by_archetype.map((a) => a.archetype));
    out.rows.forEach((row, i) => {
      const a = out.by_archetype[i]!;
      expect(row.adaptedN).toBe(a.n_adapted);
      expect(row.holdoutN).toBe(a.n_holdout);
      expect(row.adaptedRate).toBe(a.adapted_cta_rate);
      expect(row.holdoutRate).toBe(a.holdout_cta_rate);
      expect(row.lift).toBe(a.lift_pct);
      expect(row.pValue).toBe(a.p_value);
    });
  });

  it('rows report lift 0 (wire-compatible) where by_archetype reports null for a zero holdout rate', () => {
    const raw = {
      groups: [],
      archetypes: [
        { archetype: 'investor', holdout: 0, sessions: 300, ...conv(30) },
        { archetype: 'investor', holdout: 1, sessions: 300, ...conv(0) },
      ],
      funnel: [],
      callerClass: true,
    };
    const out = buildResponseFromRaw(TENANT_ID, 7, raw, 'clickhouse');
    expect(out.by_archetype[0]!.lift_pct).toBeNull();
    expect(out.rows[0]!.lift).toBe(0);
  });

  it('flags dqsUnavailable only for a live window with no archetype data', () => {
    const empty = { groups: [], archetypes: [], funnel: [], callerClass: true };
    expect(buildResponseFromRaw(TENANT_ID, 7, empty, 'clickhouse').dqsUnavailable).toBe(true);
    expect(buildResponseFromRaw(TENANT_ID, 7, empty, 'mock').dqsUnavailable).toBe(false);
  });

  it('marks significance only with n >= 200 per arm', () => {
    const raw = {
      groups: [],
      archetypes: [
        { archetype: 'big', holdout: 0, sessions: 1000, ...conv(200) },
        { archetype: 'big', holdout: 1, sessions: 1000, ...conv(100) },
        { archetype: 'small', holdout: 0, sessions: 100, ...conv(40) },
        { archetype: 'small', holdout: 1, sessions: 100, ...conv(10) },
      ],
      funnel: [],
      callerClass: true,
    };
    const out = buildResponseFromRaw(TENANT_ID, 7, raw, 'clickhouse');
    expect(out.rows.find((r) => r.archetype === 'big')!.status).toBe('significant');
    expect(out.rows.find((r) => r.archetype === 'small')!.status).toBe('trending');
  });
});

// ─── FOLLOW-1203: what counts as a conversion ──────────────────────────────────

describe('FOLLOW-1203 — the lift counts confirmed conversions, and reports the rest', () => {
  const groups = [
    {
      holdout: 0,
      sessions: 1000,
      cta_sessions: 400,
      conversions: 150,
      pre_exposure_conversions: 12,
      unsigned_conversions: 90,
    },
    {
      holdout: 1,
      sessions: 1000,
      cta_sessions: 380,
      conversions: 100,
      pre_exposure_conversions: 5,
      unsigned_conversions: 70,
    },
  ];

  it('the rate is confirmed conversions over sessions — clicks, unsigned and pre-exposure never enter it', () => {
    const out = buildResponseFromRaw(
      TENANT_ID,
      7,
      { groups, archetypes: [], funnel: [], callerClass: true },
      'clickhouse',
    );
    expect(out.conversion_source).toBe('signed_events');
    expect(out.summary!.adapted_cta_rate).toBeCloseTo(0.15, 4);
    expect(out.summary!.holdout_cta_rate).toBeCloseTo(0.1, 4);
    expect(out.conversions).toEqual({
      adapted: {
        cta_clicked_sessions: 400,
        confirmed_conversions: 150,
        pre_exposure_conversions: 12,
        unsigned_conversions: 90,
      },
      holdout: {
        cta_clicked_sessions: 380,
        confirmed_conversions: 100,
        pre_exposure_conversions: 5,
        unsigned_conversions: 70,
      },
    });
  });

  it('Rule K.2: without the caller class there is NO lift — null summary, empty breakdowns, never a zero', () => {
    const off = (g: (typeof groups)[number]) => ({
      ...g,
      conversions: null,
      pre_exposure_conversions: null,
      unsigned_conversions: null,
    });
    const out = buildResponseFromRaw(
      TENANT_ID,
      7,
      {
        groups: groups.map(off),
        archetypes: [{ archetype: 'investor', ...off(groups[0]!) }],
        funnel: [{ stage: 'cta.clicked', holdout: 0, sessions: 400 }],
        callerClass: false,
      },
      'clickhouse',
    );
    expect(out.conversion_source).toBe('disabled');
    expect(out.summary).toBeNull();
    expect(out.by_archetype).toEqual([]);
    expect(out.rows).toEqual([]);
    expect(out.conversions.adapted).toEqual({
      cta_clicked_sessions: 400,
      confirmed_conversions: null,
      pre_exposure_conversions: null,
      unsigned_conversions: null,
    });
    // The funnel needs no caller class and stays live.
    expect(out.funnel.find((f) => f.stage === 'cta.clicked')!.adapted_count).toBe(400);
  });

  it('mock data is tagged mock on the conversion provenance too', () => {
    const out = buildResponseFromRaw(
      TENANT_ID,
      7,
      { groups, archetypes: [], funnel: [], callerClass: true },
      'mock',
    );
    expect(out.conversion_source).toBe('mock');
  });
});

describe('FOLLOW-1203 — the shared SQL builders', () => {
  it('with the caller class: signed conversions only, bucketed on ingest_received_at, attributed against ad.ts', () => {
    const sub = conversionEventsSubquery({
      callerClass: true,
      tenantFence: 'tenant_id = {tenant_id:String}',
      windowDays: '{window_days:UInt16}',
    });
    expect(sub).toContain("type IN ('inquiry.completed', 'live.signup') AND caller_signed = 1");
    expect(sub).toContain('maxIf(ingest_received_at,');
    expect(sub).toContain('WHERE tenant_id = {tenant_id:String} AND type IN');
    // The client-supplied `ts` is in no predicate (FOLLOW-1201 AC(4)).
    expect(sub).not.toMatch(/[^_a-z]ts\b/);
    expect(sub).not.toContain('chat.contact_initiated');

    const cols = conversionCountColumns({ callerClass: true, prefix: 'adapted_', arm: 'ad.x = 0' });
    expect(cols).toContain(
      'countDistinctIf(ad.session_id, ad.x = 0 AND ev.signed_conversions > 0 AND ev.last_signed_conversion_at >= ad.ts) AS adapted_conversions',
    );
    expect(cols).toContain('AS adapted_cta_sessions');
    expect(cols).toContain('AS adapted_unsigned_conversion_sessions');
  });

  it('without it: the column is never named, and only the click stage is selected', () => {
    const sub = conversionEventsSubquery({
      callerClass: false,
      tenantFence: null,
      windowDays: '7',
    });
    expect(sub).not.toContain('caller_signed');
    expect(sub).toContain("WHERE type IN ('cta.clicked', 'inquiry.completed', 'live.signup')");
    const cols = conversionCountColumns({ callerClass: false, prefix: '', arm: null });
    expect(cols).toBe('countDistinctIf(ad.session_id, ev.cta_clicks > 0) AS cta_sessions');
  });

  it('readConversionCounts: pre-exposure is the signed-converting sessions the attribution left out', () => {
    const row = {
      h_cta_sessions: '9',
      h_conversions: '4',
      h_signed_conversion_sessions: '6',
      h_unsigned_conversion_sessions: '3',
    };
    expect(readConversionCounts(row, 'h_', true)).toEqual({
      cta_sessions: 9,
      conversions: 4,
      pre_exposure_conversions: 2,
      unsigned_conversions: 3,
    });
    expect(readConversionCounts(row, 'h_', false)).toEqual({
      cta_sessions: 9,
      conversions: null,
      pre_exposure_conversions: null,
      unsigned_conversions: null,
    });
  });
});

// ─── FOLLOW-1457: an aggregate alias must not shadow a column of its own WHERE ────────────────

/**
 * Aliases of aggregates that a sibling WHERE also names bare. ClickHouse binds that name to the alias
 * (`prefer_column_name_to_alias` is off), so the WHERE holds an aggregate: code 184,
 * ILLEGAL_AGGREGATION. Only innermost SELECTs are read, and a qualified `ad.x` is not a bare name.
 */
function shadowingAggregateAliases(sql: string): string[] {
  const found: string[] = [];
  const block =
    /\bSELECT\b((?:(?!\bSELECT\b)[\s\S])*?)\bFROM\b((?:(?!\bSELECT\b)[\s\S])*?)\bGROUP BY\b/g;
  const aggregate = /\b(?:any|argM|max|min|count|sum|uniq|avg)\w*\([\s\S]*?\)\s+AS\s+(\w+)/g;
  for (const [, select = '', rest = ''] of sql.matchAll(block)) {
    for (const [, alias = ''] of select.matchAll(aggregate)) {
      if (new RegExp(`(?<![.\\w])${alias}\\b`).test(rest)) found.push(alias);
    }
  }
  return found;
}

describe('FOLLOW-1457 lift queries against the alias-shadowing trap', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  /** Every SQL string `read` sends, with ClickHouse answering nothing. */
  async function sentSql(read: () => Promise<unknown>): Promise<string[]> {
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123');
    vi.stubEnv('CALLER_SIGNED_COLUMN_ENABLED', 'true');
    const fetchMock = vi.fn(() => Promise.resolve(new Response('', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await read();
    return (fetchMock.mock.calls as unknown as [string][]).map(
      ([url]) => new URL(url).searchParams.get('query') ?? '',
    );
  }

  it('the detector names the alias that broke the route', () => {
    expect(
      shadowingAggregateAliases(`SELECT session_id, anyHeavy(holdout_group) AS holdout_group
        FROM adaptation_decisions WHERE NOT (holdout_group = 1 AND variant != 'control')
        GROUP BY session_id`),
    ).toEqual(['holdout_group']);
  });

  it('no query of the rolling report has one', async () => {
    const queries = await sentSql(() => fetchLiftRaw(TENANT_ID, 7));
    expect(queries.length).toBeGreaterThanOrEqual(3);
    expect(queries.flatMap(shadowingAggregateAliases)).toEqual([]);
  });

  it('no query of the per-day report has one', async () => {
    const queries = await sentSql(() => fetchLiftDaily(TENANT_ID, '2026-11-01', '2026-11-02'));
    expect(queries.length).toBeGreaterThanOrEqual(1);
    expect(queries.flatMap(shadowingAggregateAliases)).toEqual([]);
  });
});

// ─── FOLLOW-1458: one visit, one arm ──────────────────────────────────────────────────────────

describe('FOLLOW-1458 a session has the arm of its first decision', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  async function sentSql(read: () => Promise<unknown>): Promise<string[]> {
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test:8123');
    vi.stubEnv('CALLER_SIGNED_COLUMN_ENABLED', 'true');
    const fetchMock = vi.fn(() => Promise.resolve(new Response('', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);
    await read();
    return (fetchMock.mock.calls as unknown as [string][]).map(
      ([url]) => new URL(url).searchParams.get('query') ?? '',
    );
  }

  it('every query takes the arm from argMin and never groups on the row arm', async () => {
    const queries = [
      ...(await sentSql(() => fetchLiftRaw(TENANT_ID, 7))),
      ...(await sentSql(() => fetchLiftDaily(TENANT_ID, '2026-11-01', '2026-11-02'))),
    ];
    expect(queries).toHaveLength(4);
    for (const sql of queries) {
      expect(sql).toContain('argMin(holdout_group, ts) AS first_arm');
      expect(sql).not.toMatch(/GROUP BY[^\n]*holdout_group/);
      expect(sql).not.toMatch(/\bad\.holdout_group AS holdout\b/);
    }
  });

  it('sessions_in_both_arms sums what the per-arm rows report, and is 0 when none', () => {
    const row = { sessions: 10, ...conv(1) };
    const raw = (a: number, h: number) => ({
      groups: [
        { holdout: 0, ...row, both_arm_sessions: a },
        { holdout: 1, ...row, both_arm_sessions: h },
      ],
      archetypes: [],
      funnel: [],
      callerClass: true,
    });
    expect(buildResponseFromRaw(TENANT_ID, 7, raw(2, 1), 'clickhouse').sessions_in_both_arms).toBe(
      3,
    );
    expect(buildResponseFromRaw(TENANT_ID, 7, raw(0, 0), 'clickhouse').sessions_in_both_arms).toBe(
      0,
    );
  });
});
