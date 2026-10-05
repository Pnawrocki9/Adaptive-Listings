/**
 * Unit tests for the lift report assembly (FOLLOW-1289; moved from the retired
 * `pilot/cta-lift/route.test.ts`). The statistics themselves are covered by
 * `src/lib/pilot-stats.test.ts`; here we pin how raw ClickHouse counts become the public response.
 *
 * @module apps/control-plane/src/app/api/dashboard/analytics/lift/route-helpers.test
 */

import { describe, expect, it } from 'vitest';

import { parseWindowDays, buildResponseFromRaw } from './route-helpers';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';

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
        { holdout: 0, sessions: 1000, cta_sessions: 150 },
        { holdout: 1, sessions: 1000, cta_sessions: 100 },
      ],
      archetypes: [
        { archetype: 'investor', holdout: 0, sessions: 600, cta_sessions: 96 },
        { archetype: 'investor', holdout: 1, sessions: 600, cta_sessions: 60 },
        { archetype: 'family_buyer', holdout: 0, sessions: 400, cta_sessions: 54 },
        { archetype: 'family_buyer', holdout: 1, sessions: 400, cta_sessions: 40 },
      ],
      funnel: [
        { stage: 'page.view', holdout: 0, sessions: 1000 },
        { stage: 'page.view', holdout: 1, sessions: 1000 },
        { stage: 'cta.clicked', holdout: 0, sessions: 150 },
        { stage: 'cta.clicked', holdout: 1, sessions: 100 },
      ],
    };

    const out = buildResponseFromRaw(TENANT_ID, 14, raw, 'clickhouse');

    expect(out.window_days).toBe(14);
    expect(out.tenant_id).toBe(TENANT_ID);
    // Summary: 0.15 vs 0.10 with n=1000 each → significant.
    expect(out.summary.adapted_cta_rate).toBeCloseTo(0.15, 4);
    expect(out.summary.holdout_cta_rate).toBeCloseTo(0.1, 4);
    expect(out.summary.absolute_lift).toBeCloseTo(0.05, 4);
    expect(out.summary.relative_lift_pct).toBeCloseTo(50, 1);
    expect(out.summary.p_value).toBeLessThan(0.05);
    expect(out.summary.is_significant).toBe(true);
    expect(out.summary.confidence).toBe('95%');

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
        { holdout: 0, sessions: 500, cta_sessions: 75 },
        { holdout: 1, sessions: 500, cta_sessions: 0 },
      ],
      archetypes: [],
      funnel: [],
    };
    const out = buildResponseFromRaw(TENANT_ID, 7, raw, 'clickhouse');
    expect(out.summary.holdout_cta_rate).toBe(0);
    expect(out.summary.relative_lift_pct).toBeNull();
  });

  it('returns not_significant when sample is below 30 per arm', () => {
    const raw = {
      groups: [
        { holdout: 0, sessions: 20, cta_sessions: 10 },
        { holdout: 1, sessions: 20, cta_sessions: 2 },
      ],
      archetypes: [],
      funnel: [],
    };
    const out = buildResponseFromRaw(TENANT_ID, 7, raw, 'clickhouse');
    expect(out.summary.is_significant).toBe(false);
    expect(out.summary.confidence).toBe('not_significant');
    expect(out.summary.p_value).toBe(1);
  });
});

// ─── Both row shapes come from ONE computation (FOLLOW-1289) ───────────────────

describe('buildResponseFromRaw — by_archetype and rows share one lift computation', () => {
  it('agrees on counts, rates, lift and p-value for every archetype', () => {
    const raw = {
      groups: [],
      archetypes: [
        { archetype: 'investor', holdout: 0, sessions: 600, cta_sessions: 96 },
        { archetype: 'investor', holdout: 1, sessions: 600, cta_sessions: 60 },
        { archetype: 'family_buyer', holdout: 0, sessions: 400, cta_sessions: 54 },
        { archetype: 'family_buyer', holdout: 1, sessions: 400, cta_sessions: 40 },
      ],
      funnel: [],
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
        { archetype: 'investor', holdout: 0, sessions: 300, cta_sessions: 30 },
        { archetype: 'investor', holdout: 1, sessions: 300, cta_sessions: 0 },
      ],
      funnel: [],
    };
    const out = buildResponseFromRaw(TENANT_ID, 7, raw, 'clickhouse');
    expect(out.by_archetype[0]!.lift_pct).toBeNull();
    expect(out.rows[0]!.lift).toBe(0);
  });

  it('flags dqsUnavailable only for a live window with no archetype data', () => {
    const empty = { groups: [], archetypes: [], funnel: [] };
    expect(buildResponseFromRaw(TENANT_ID, 7, empty, 'clickhouse').dqsUnavailable).toBe(true);
    expect(buildResponseFromRaw(TENANT_ID, 7, empty, 'mock').dqsUnavailable).toBe(false);
  });

  it('marks significance only with n >= 200 per arm', () => {
    const raw = {
      groups: [],
      archetypes: [
        { archetype: 'big', holdout: 0, sessions: 1000, cta_sessions: 200 },
        { archetype: 'big', holdout: 1, sessions: 1000, cta_sessions: 100 },
        { archetype: 'small', holdout: 0, sessions: 100, cta_sessions: 40 },
        { archetype: 'small', holdout: 1, sessions: 100, cta_sessions: 10 },
      ],
      funnel: [],
    };
    const out = buildResponseFromRaw(TENANT_ID, 7, raw, 'clickhouse');
    expect(out.rows.find((r) => r.archetype === 'big')!.status).toBe('significant');
    expect(out.rows.find((r) => r.archetype === 'small')!.status).toBe('trending');
  });
});
