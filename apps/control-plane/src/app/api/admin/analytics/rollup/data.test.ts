/**
 * Tests for `getTenantAnalyticsRollup` (FOLLOW-638; scoped to one tenant by FOLLOW-1330).
 *
 * Coverage:
 *   T1: stores unconfigured (dev/CI) → deterministic mock for the tenant,
 *       data_source: 'mock', quiz_data_source: 'mock'.
 *   T2: both configured, all queries succeed → data_source: 'clickhouse',
 *       quiz_data_source: 'live', the CH counts and the tenant's quiz count merge.
 *   T2b: a tenant with no decisions in the window → real zeros and a null lift.
 *   T3: ClickHouse configured but the query throws → ok: false, status 500
 *       (Rule K.2 — the primary metric group fails loud, never fabricated).
 *   T4: every ClickHouse query is fenced on the tenant, bound as a parameter.
 *   T5: quiz_completions query throws while ClickHouse succeeds →
 *       ok: true, quiz_data_source: 'error', quizCompletions null
 *       (never a fabricated 0) — Rule K.2 independent degrade.
 *   T6: FOLLOW-560 — SCORING_PATH_COLUMN_ENABLED unset → scoring_path_source
 *       'disabled', split null, and the scoring_path query is never issued
 *       (the column may not exist on this instance).
 *   T7: FOLLOW-560 — flag on and the split query succeeds → 'live', missing
 *       paths zero-filled.
 *   T8: FOLLOW-560 — flag on but the split query throws → 'error', split null,
 *       primary metrics unaffected (third independent degrade).
 *   T9/T10: FOLLOW-1220 — reorder_withheld read without the flag; its failure degrades alone.
 *
 * @module apps/control-plane/src/app/api/admin/analytics/rollup/data.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

const mockWhere = vi.fn();
const mockFrom = vi.fn(() => ({ where: mockWhere }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({ select: mockSelect })),
  quizCompletions: { tenantId: 'tenant_id' },
}));

const TENANT_A = '11111111-1111-1111-1111-111111111111';

describe('getTenantAnalyticsRollup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    mockWhere.mockResolvedValue([{ cnt: 0 }]);
  });

  it('T1: neither CLICKHOUSE_URL nor DATABASE_URL_ADMIN configured → mock for the tenant', async () => {
    vi.stubEnv('CLICKHOUSE_URL', '');
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');

    const { getTenantAnalyticsRollup } = await import('./data.js');
    const result = await getTenantAnalyticsRollup(TENANT_A);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.tenant_id).toBe(TENANT_A);
    expect(result.data.data_source).toBe('mock');
    expect(result.data.quiz_data_source).toBe('mock');
    expect(result.data.rollup.sessions).toBeGreaterThan(0);
    expect(result.data.rollup.adapted + result.data.rollup.holdout).toBe(
      result.data.rollup.sessions,
    );
  });

  it('T2: both configured, live path merges the CH counts and the tenant quiz count', async () => {
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    vi.stubEnv('CALLER_SIGNED_COLUMN_ENABLED', 'true');
    mockWhere.mockResolvedValue([{ cnt: 5 }]);

    const chRow = JSON.stringify({
      sessions: 100,
      adapted: 80,
      holdout: 20,
      adapted_n: 80,
      holdout_n: 20,
      // FOLLOW-1203: the columns conversionCountColumns() selects, per arm and over both.
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
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(chRow, { status: 200 })));

    const { getTenantAnalyticsRollup } = await import('./data.js');
    const result = await getTenantAnalyticsRollup(TENANT_A);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.tenant_id).toBe(TENANT_A);
    expect(result.data.data_source).toBe('clickhouse');
    expect(result.data.quiz_data_source).toBe('live');

    const r = result.data.rollup;
    expect(r).toMatchObject({ sessions: 100, adapted: 80, holdout: 20, quizCompletions: 5 });
    // 40/80 vs 5/20 → (0.5 − 0.25) / 0.25 = +100 %, from the CONFIRMED counts only.
    expect(r.ctaLift).toBeCloseTo(100, 6);
    expect(r.conversions).toEqual({
      adaptedN: 80,
      holdoutN: 20,
      adaptedConversions: 40,
      holdoutConversions: 5,
      preExposureConversions: 3,
      unsignedConversions: 8,
      ctaClickedSessions: 69,
    });
    expect(result.data.conversion_source).toBe('signed_events');
  });

  it('T2b: no decisions in the window → real zeros (query succeeded) and a null lift', async () => {
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    vi.stubEnv('CALLER_SIGNED_COLUMN_ENABLED', 'true');
    // ClickHouse answers an aggregate without GROUP BY with one all-zero row.
    const zeroRow = JSON.stringify({ sessions: 0, adapted: 0, holdout: 0, adapted_n: 0 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(zeroRow, { status: 200 })));

    const { getTenantAnalyticsRollup } = await import('./data.js');
    const result = await getTenantAnalyticsRollup(TENANT_A);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.rollup).toMatchObject({
      sessions: 0,
      adapted: 0,
      holdout: 0,
      quizCompletions: 0,
    });
    expect(result.data.rollup.ctaLift).toBeNull();
    expect(result.data.rollup.conversions.adaptedConversions).toBe(0);
  });

  it('T3: ClickHouse configured but the query fails → ok:false, status 500 (Rule K.2)', async () => {
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Internal Server Error', { status: 500 })),
    );

    const { getTenantAnalyticsRollup } = await import('./data.js');
    const result = await getTenantAnalyticsRollup(TENANT_A);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(500);
    expect(result.error).toContain('ClickHouse rollup query failed');
  });

  it('T4: every ClickHouse query is fenced on the tenant, bound as a parameter (never interpolated)', async () => {
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    vi.stubEnv('SCORING_PATH_COLUMN_ENABLED', 'true');
    const fetchMock = vi
      .fn()
      .mockImplementation(() => Promise.resolve(new Response('', { status: 200 })));
    vi.stubGlobal('fetch', fetchMock);

    const { getTenantAnalyticsRollup } = await import('./data.js');
    const result = await getTenantAnalyticsRollup(TENANT_A);

    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const call of fetchMock.mock.calls) {
      const url = new URL(String(call[0]));
      const sql = url.searchParams.get('query') ?? '';
      expect(url.searchParams.get('param_tenant_id')).toBe(TENANT_A);
      expect(sql).toContain('tenant_id = {tenant_id:String}');
      expect(sql).not.toContain(TENANT_A);
      expect(sql).not.toContain('GROUP BY ad.tenant_id');
    }
  });

  it('T5: quiz_completions query fails while ClickHouse succeeds → degrades independently', async () => {
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    mockWhere.mockRejectedValue(new Error('quiz_completions table unreachable'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    const { getTenantAnalyticsRollup } = await import('./data.js');
    const result = await getTenantAnalyticsRollup(TENANT_A);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    // Primary metrics still live — the route is NOT a hard failure.
    expect(result.data.data_source).toBe('clickhouse');
    // Secondary metric explicitly flagged as degraded, never a fabricated 0.
    expect(result.data.quiz_data_source).toBe('error');
    expect(result.data.rollup.quizCompletions).toBeNull();
  });

  // ─── FOLLOW-560: scoring_path split ──────────────────────────────────────

  const CH_ROLLUP_ROW = JSON.stringify({
    sessions: 100,
    adapted: 80,
    holdout: 20,
    adapted_n: 80,
    adapted_conversions: 40,
    holdout_n: 20,
    holdout_conversions: 5,
  });

  function stubLiveStores(): void {
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
  }

  it('T6: SCORING_PATH_COLUMN_ENABLED unset → disabled, split null, query never issued', async () => {
    stubLiveStores();
    const fetchMock = vi.fn().mockResolvedValue(new Response(CH_ROLLUP_ROW, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { getTenantAnalyticsRollup } = await import('./data.js');
    const result = await getTenantAnalyticsRollup(TENANT_A);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.scoring_path_source).toBe('disabled');
    expect(result.data.scoringPathSplit).toBeNull();
    // The whole point of the gate: the column may not exist here, so it is not named in any
    // query. Only the rollup and the (flag-independent, FOLLOW-1220) reorder_withheld call ran.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      expect(new URL(String(call[0])).searchParams.get('query')).not.toContain('scoring_path');
    }
  });

  it('T7: flag on and split query succeeds → live, missing paths zero-filled', async () => {
    stubLiveStores();
    vi.stubEnv('SCORING_PATH_COLUMN_ENABLED', 'true');

    // Only two of the four paths appear in the result set; the other two must read 0, not vanish.
    const splitRows = [
      JSON.stringify({ scoring_path: 'djb2_fallback', n: 7 }),
      JSON.stringify({ scoring_path: 'not_applicable', n: 3 }),
    ].join('\n');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(CH_ROLLUP_ROW, { status: 200 }))
      .mockResolvedValueOnce(new Response(splitRows, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { getTenantAnalyticsRollup } = await import('./data.js');
    const result = await getTenantAnalyticsRollup(TENANT_A);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.scoring_path_source).toBe('live');
    expect(result.data.scoringPathSplit).toEqual({
      cosine: 0,
      djb2_fallback: 7,
      djb2_guard: 0,
      not_applicable: 3,
    });
  });

  it('T8: flag on but split query throws → error, split null, primary metrics unaffected', async () => {
    stubLiveStores();
    vi.stubEnv('SCORING_PATH_COLUMN_ENABLED', 'true');

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(CH_ROLLUP_ROW, { status: 200 }))
      // What an unapplied migration 0022 actually looks like on the read side.
      .mockResolvedValueOnce(new Response('NO_SUCH_COLUMN_IN_BLOCK', { status: 400 }));
    vi.stubGlobal('fetch', fetchMock);

    const { getTenantAnalyticsRollup } = await import('./data.js');
    const result = await getTenantAnalyticsRollup(TENANT_A);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.scoring_path_source).toBe('error');
    expect(result.data.scoringPathSplit).toBeNull();
    // Third independent degrade — the primary group and quizCompletions are untouched.
    expect(result.data.data_source).toBe('clickhouse');
    expect(result.data.rollup.sessions).toBe(100);
  });

  // ─── FOLLOW-1220: reorder_withheld counts, independent of the scoring_path flag ───────────

  it('T9: flag OFF → reorderWithheld is still read, per reason, from features_snapshot', async () => {
    stubLiveStores();
    const reasonRows = [
      JSON.stringify({ reason: 'embeddings_missing', n: 9 }),
      JSON.stringify({ reason: 'embeddings_lookup_failed', n: 2 }),
    ].join('\n');
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(CH_ROLLUP_ROW, { status: 200 }))
      .mockResolvedValueOnce(new Response(reasonRows, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { getTenantAnalyticsRollup } = await import('./data.js');
    const result = await getTenantAnalyticsRollup(TENANT_A);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.scoring_path_source).toBe('disabled');
    expect(result.data.reorder_withheld_source).toBe('live');
    // A reason with no rows reads 0, not absent.
    expect(result.data.reorderWithheld).toEqual({
      embeddings_missing: 9,
      embeddings_not_attempted: 0,
      embeddings_lookup_failed: 2,
    });
    const sql = new URL(String(fetchMock.mock.calls[1]?.[0])).searchParams.get('query') ?? '';
    expect(sql).toContain("JSONExtractString(features_snapshot, 'reorder_withheld')");
    expect(sql).not.toContain('scoring_path');
  });

  it('T10: reorder_withheld query throws → error, null (never a zero), primary metrics unaffected', async () => {
    stubLiveStores();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(CH_ROLLUP_ROW, { status: 200 }))
      .mockResolvedValueOnce(new Response('boom', { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);

    const { getTenantAnalyticsRollup } = await import('./data.js');
    const result = await getTenantAnalyticsRollup(TENANT_A);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.reorder_withheld_source).toBe('error');
    expect(result.data.reorderWithheld).toBeNull();
    expect(result.data.data_source).toBe('clickhouse');
    expect(result.data.rollup.sessions).toBe(100);
  });
});
