/**
 * FOLLOW-1338 (a): the lift reader's D-J breakdown and the 90-day window, and (b/c) the per-day
 * reader the snapshot cron and the CSV export share.
 *
 * Pinned here:
 *   - window 90 is accepted (and `window_days=90` is bound as the query parameter); the existing
 *     default (7) is unchanged;
 *   - `conversion_breakdown` carries `live_signup_rate` / `agent_contact_rate` per arm beside the
 *     combined conversion, all over the SAME sessions denominator as `summary`;
 *   - one session with BOTH events is ONE conversion: the combined count is a distinct-session
 *     count over the attribution rule (SQL), and the parts overlap (7 + 5 - 2 = 10 combined);
 *   - the rollup's SQL is untouched: `byType` is opt-in, so the default subquery / columns carry no
 *     per-type fragment;
 *   - per-day cells -> two rows per day, the same `computeArmLift` figures on both arm rows, a
 *     truthful zero row for an empty arm / day.
 *
 * @module apps/control-plane/src/app/api/dashboard/analytics/lift/route.follow1338.test
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { computeArmLift } from '@/lib/pilot-stats';
import {
  buildLiftDayRows,
  buildMockRaw,
  buildResponseFromRaw,
  conversionCountColumns,
  conversionEventsSubquery,
  fetchLiftDaily,
  fetchLiftRaw,
  parseWindowDays,
  readConversionCounts,
  utcDay,
  utcDaysEndingAt,
} from './route-helpers';

const TENANT = '550e8400-e29b-41d4-a716-446655440042';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('parseWindowDays — 90 (FOLLOW-1338)', () => {
  it('accepts 90 and keeps the existing set and the default of 7', () => {
    expect(parseWindowDays('90')).toBe(90);
    expect(parseWindowDays('30')).toBe(30);
    expect(parseWindowDays('91')).toBe(7);
    expect(parseWindowDays(null)).toBe(7);
  });
});

describe('conversion_breakdown (ruling D-J)', () => {
  const arm = (sessions: number, conversions: number, live: number, agent: number) => ({
    sessions,
    cta_sessions: 0,
    conversions,
    pre_exposure_conversions: 0,
    unsigned_conversions: 0,
    live_signups: live,
    agent_contacts: agent,
  });

  it('splits the combined conversion into its two events per arm; a session with both is counted once', () => {
    const out = buildResponseFromRaw(
      TENANT,
      90,
      {
        groups: [
          // 7 live-signup sessions + 5 agent-contact sessions, 2 of them did both -> 10 sessions
          { holdout: 0, ...arm(100, 10, 7, 5) },
          { holdout: 1, ...arm(100, 4, 1, 3) },
        ],
        archetypes: [],
        funnel: [],
        callerClass: true,
      },
      'clickhouse',
    );
    expect(out.window_days).toBe(90);
    expect(out.conversion_breakdown).toEqual({
      adapted: {
        sessions: 100,
        conversions: 10,
        conversion_rate: 0.1,
        live_signups: 7,
        live_signup_rate: 0.07,
        agent_contacts: 5,
        agent_contact_rate: 0.05,
      },
      holdout: {
        sessions: 100,
        conversions: 4,
        conversion_rate: 0.04,
        live_signups: 1,
        live_signup_rate: 0.01,
        agent_contacts: 3,
        agent_contact_rate: 0.03,
      },
    });
    // The combined rate is the summary's own number (one formula), not 0.07 + 0.05.
    expect(out.conversion_breakdown?.adapted.conversion_rate).toBe(out.summary?.adapted_cta_rate);
    // Existing fields are untouched.
    expect(out.summary?.relative_lift_pct).toBeCloseTo(150, 1);
  });

  it('is null (not zeros) when the caller class is unavailable, and parts are null when not read', () => {
    const off = buildResponseFromRaw(
      TENANT,
      7,
      { groups: [], archetypes: [], funnel: [], callerClass: false },
      'clickhouse',
    );
    expect(off.conversion_breakdown).toBeNull();
    expect(off.summary).toBeNull();

    const noParts = buildResponseFromRaw(
      TENANT,
      7,
      {
        groups: [
          {
            holdout: 0,
            sessions: 50,
            cta_sessions: 0,
            conversions: 5,
            pre_exposure_conversions: 0,
            unsigned_conversions: 0,
          },
        ],
        archetypes: [],
        funnel: [],
        callerClass: true,
      },
      'clickhouse',
    );
    expect(noParts.conversion_breakdown?.adapted.live_signups).toBeNull();
    expect(noParts.conversion_breakdown?.adapted.live_signup_rate).toBeNull();
    expect(noParts.conversion_breakdown?.adapted.conversion_rate).toBe(0.1);
  });

  it('the mock is tagged mock and carries the breakdown', () => {
    const out = buildResponseFromRaw(TENANT, 30, buildMockRaw(TENANT, 30), 'mock');
    expect(out.data_source).toBe('mock');
    expect(out.conversion_breakdown?.adapted.live_signup_rate).toEqual(expect.any(Number));
  });
});

describe('SQL: per-type columns are opt-in (the rollup SQL is unchanged)', () => {
  const base = { callerClass: true, tenantFence: null, windowDays: '30' } as const;

  it('default subquery / columns carry no per-type fragment', () => {
    expect(conversionEventsSubquery(base)).not.toContain('live_signup');
    expect(conversionCountColumns({ callerClass: true, prefix: 'all_', arm: null })).not.toContain(
      'live_signup',
    );
    expect(
      readConversionCounts({ conversions: 1, live_signup_sessions: 1 }, '', true),
    ).not.toHaveProperty('live_signups');
  });

  it('byType adds per-event signed counts, and counts DISTINCT sessions under the same attribution', () => {
    const sub = conversionEventsSubquery({ ...base, byType: true });
    expect(sub).toContain(`type = 'live.signup' AND caller_signed = 1`);
    expect(sub).toContain(`type = 'inquiry.completed' AND caller_signed = 1`);
    const cols = conversionCountColumns({ callerClass: true, prefix: '', arm: null, byType: true });
    // combined = one distinct session, however many of its events qualify
    expect(cols).toContain(
      'countDistinctIf(ad.session_id, ev.signed_conversions > 0 AND ev.last_signed_conversion_at >= ad.ts) AS conversions',
    );
    expect(cols).toContain('AS live_signup_sessions');
    expect(cols).toContain('AS agent_contact_sessions');
    expect(cols).toContain('ev.last_signed_live_signup_at >= ad.ts');
    expect(cols).toContain('ev.last_signed_agent_contact_at >= ad.ts');
  });

  it('since replaces the rolling window lower bound', () => {
    const sub = conversionEventsSubquery({
      callerClass: true,
      tenantFence: 'tenant_id = {tenant_id:String}',
      since: `toDateTime({from_day:Date}, 'UTC')`,
    });
    expect(sub).toContain(`ingest_received_at >= toDateTime({from_day:Date}, 'UTC')`);
    expect(sub).not.toContain('toIntervalDay');
  });
});

describe('fetchLiftRaw / fetchLiftDaily against a ClickHouse stand-in', () => {
  function stubClickHouse(answer: (sql: string) => unknown[]) {
    const calls: URL[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn((url: unknown) => {
        const u = new URL(String(url));
        calls.push(u);
        const lines = answer(u.searchParams.get('query') ?? '');
        return Promise.resolve(
          new Response(lines.map((l) => JSON.stringify(l)).join('\n'), { status: 200 }),
        );
      }),
    );
    return calls;
  }

  it('reader: window_days=90 is bound and the per-type columns are read from the group row', async () => {
    vi.stubEnv('CLICKHOUSE_URL', 'http://ch.test:8123');
    vi.stubEnv('CALLER_SIGNED_COLUMN_ENABLED', 'true');
    const calls = stubClickHouse((sql) =>
      sql.includes('GROUP BY ad.holdout_group')
        ? [
            {
              holdout: 0,
              sessions: 200,
              cta_sessions: 0,
              conversions: 20,
              signed_conversion_sessions: 20,
              unsigned_conversion_sessions: 0,
              live_signup_sessions: 12,
              agent_contact_sessions: 10,
            },
            {
              holdout: 1,
              sessions: 100,
              cta_sessions: 0,
              conversions: 5,
              signed_conversion_sessions: 5,
              unsigned_conversion_sessions: 0,
              live_signup_sessions: 2,
              agent_contact_sessions: 3,
            },
          ]
        : [],
    );
    const raw = await fetchLiftRaw(TENANT, 90);
    expect(calls.every((c) => c.searchParams.get('param_window_days') === '90')).toBe(true);
    const out = buildResponseFromRaw(TENANT, 90, raw!, 'clickhouse');
    expect(out.conversion_breakdown?.adapted.live_signup_rate).toBe(0.06);
    expect(out.conversion_breakdown?.adapted.agent_contact_rate).toBe(0.05);
    expect(out.conversion_breakdown?.holdout.live_signup_rate).toBe(0.02);
  });

  it('daily: binds from/to as Date params, reads UTC-bucketed cells, no second formula', async () => {
    vi.stubEnv('CLICKHOUSE_URL', 'http://ch.test:8123');
    vi.stubEnv('CALLER_SIGNED_COLUMN_ENABLED', 'true');
    const calls = stubClickHouse(() => [
      {
        day_utc: '2026-10-18',
        holdout: 0,
        sessions: 40,
        cta_sessions: 0,
        conversions: 8,
        signed_conversion_sessions: 8,
        unsigned_conversion_sessions: 0,
        live_signup_sessions: 5,
        agent_contact_sessions: 4,
      },
      {
        day_utc: '2026-10-18',
        holdout: 1,
        sessions: 40,
        cta_sessions: 0,
        conversions: 4,
        signed_conversion_sessions: 4,
        unsigned_conversion_sessions: 0,
        live_signup_sessions: 2,
        agent_contact_sessions: 2,
      },
    ]);
    const daily = await fetchLiftDaily(TENANT, '2026-10-18', '2026-10-18');
    expect(calls).toHaveLength(1);
    const q = calls[0]!;
    expect(q.searchParams.get('param_tenant_id')).toBe(TENANT);
    expect(q.searchParams.get('param_from_day')).toBe('2026-10-18');
    expect(q.searchParams.get('param_to_day')).toBe('2026-10-18');
    const sql = q.searchParams.get('query') ?? '';
    expect(sql).toContain(`toDate(ad.ts, 'UTC')`);
    expect(sql).toContain(`ad.ts < toDateTime({to_day:Date}, 'UTC') + toIntervalDay(1)`);
    expect(sql).toContain("NOT (ad.holdout_group = 1 AND ad.variant != 'control')");
    expect(daily?.callerClass).toBe(true);

    const rows = buildLiftDayRows(daily!.rows, ['2026-10-18']);
    const expected = computeArmLift({
      adaptedN: 40,
      adaptedConversions: 8,
      holdoutN: 40,
      holdoutConversions: 4,
    });
    expect(rows.map((r) => r.arm)).toEqual(['adapted', 'holdout']);
    expect(rows[0]).toMatchObject({
      sessions: 40,
      conversions: 8,
      live_signups: 5,
      agent_contacts: 4,
    });
    expect(rows[1]).toMatchObject({
      sessions: 40,
      conversions: 4,
      live_signups: 2,
      agent_contacts: 2,
    });
    for (const r of rows) {
      expect(r.relative_lift_pct).toBeCloseTo(expected.relativeLiftPct!, 1);
      expect(r.p_value).toBeCloseTo(expected.pValue, 3);
      expect(r.confidence).toBe(expected.confidence);
    }
  });

  it('daily: unset CLICKHOUSE_URL is null; flag off is callerClass=false with NO query', async () => {
    vi.stubEnv('CLICKHOUSE_URL', '');
    expect(await fetchLiftDaily(TENANT, '2026-10-18', '2026-10-18')).toBeNull();
    vi.stubEnv('CLICKHOUSE_URL', 'http://ch.test:8123');
    vi.stubEnv('CALLER_SIGNED_COLUMN_ENABLED', 'false');
    const calls = stubClickHouse(() => []);
    expect(await fetchLiftDaily(TENANT, '2026-10-18', '2026-10-18')).toEqual({
      rows: [],
      callerClass: false,
    });
    expect(calls).toHaveLength(0);
  });

  it('daily: rejects a malformed day before any request', async () => {
    vi.stubEnv('CLICKHOUSE_URL', 'http://ch.test:8123');
    await expect(fetchLiftDaily(TENANT, "2026-10-18' OR 1=1", '2026-10-18')).rejects.toThrow(
      /YYYY-MM-DD/,
    );
  });
});

describe('buildLiftDayRows / day helpers', () => {
  it('an empty day is two truthful zero rows; a one-armed day has a zero other arm', () => {
    const rows = buildLiftDayRows(
      [
        {
          day: '2026-10-17',
          holdout: 0,
          sessions: 10,
          conversions: 1,
          live_signups: 1,
          agent_contacts: 0,
        },
      ],
      ['2026-10-16', '2026-10-17'],
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      day: '2026-10-16',
      arm: 'adapted',
      sessions: 0,
      conversions: 0,
    });
    expect(rows[0]!.relative_lift_pct).toBeNull();
    expect(rows[0]!.confidence).toBe('not_significant');
    expect(rows[3]).toMatchObject({ day: '2026-10-17', arm: 'holdout', sessions: 0 });
    expect(rows[2]).toMatchObject({
      day: '2026-10-17',
      arm: 'adapted',
      sessions: 10,
      live_signups: 1,
    });
  });

  it('utcDaysEndingAt lists N UTC days oldest first, ending today', () => {
    const end = new Date('2026-10-19T00:30:00Z');
    expect(utcDaysEndingAt(end, 3)).toEqual(['2026-10-17', '2026-10-18', '2026-10-19']);
    expect(utcDay(end)).toBe('2026-10-19');
  });
});
