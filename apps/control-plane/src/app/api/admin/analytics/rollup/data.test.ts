/**
 * Tests for `getPlatformAnalyticsRollup` (FOLLOW-638).
 *
 * Coverage:
 *   T1: neither store configured (dev/CI) → full deterministic mock,
 *       data_source: 'mock', quiz_data_source: 'mock'.
 *   T2: both configured, all queries succeed → data_source: 'clickhouse',
 *       quiz_data_source: 'live', per-brand rows merge tenant roster + CH +
 *       quiz counts correctly (including a tenant with zero CH activity).
 *   T3: ClickHouse configured but the query throws → ok: false, status 500
 *       (Rule K.2 — the primary metric group fails loud, never fabricated).
 *   T4: Postgres tenant-roster query throws → ok: false, status 500.
 *   T5: quiz_completions query throws while roster + ClickHouse succeed →
 *       ok: true, quiz_data_source: 'error', every quizCompletions field is
 *       null (never a fabricated 0) — Rule K.2 independent degrade.
 *   T6: FOLLOW-560 — SCORING_PATH_COLUMN_ENABLED unset → scoring_path_source
 *       'disabled', split null, and the scoring_path query is never issued
 *       (the column may not exist on this instance).
 *   T7: FOLLOW-560 — flag on and the split query succeeds → 'live', missing
 *       paths zero-filled.
 *   T8: FOLLOW-560 — flag on but the split query throws → 'error', split null,
 *       primary metrics unaffected (third independent degrade).
 *
 * @module apps/control-plane/src/app/api/admin/analytics/rollup/data.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

const mockWhere = vi.fn();
const mockGroupBy = vi.fn();
const mockFrom = vi.fn(() => ({ where: mockWhere, groupBy: mockGroupBy }));
const mockSelect = vi.fn(() => ({ from: mockFrom }));

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({ select: mockSelect })),
  tenants: { id: 'id', name: 'name', slug: 'slug', deletedAt: 'deleted_at' },
  quizCompletions: { tenantId: 'tenant_id' },
}));

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

describe('getPlatformAnalyticsRollup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    mockWhere.mockResolvedValue([]);
    mockGroupBy.mockResolvedValue([]);
  });

  it('T1: neither CLICKHOUSE_URL nor DATABASE_URL_ADMIN configured → full mock', async () => {
    vi.stubEnv('CLICKHOUSE_URL', '');
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');

    const { getPlatformAnalyticsRollup } = await import('./data.js');
    const result = await getPlatformAnalyticsRollup();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.data_source).toBe('mock');
    expect(result.data.quiz_data_source).toBe('mock');
    expect(result.data.brands.length).toBeGreaterThan(0);
    expect(result.data.rollup.tenantCount).toBe(result.data.brands.length);
  });

  it('T2: both configured, live path merges tenant roster + CH + quiz counts', async () => {
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');

    // Tenant roster: two tenants, only A has ClickHouse activity + a quiz row.
    mockWhere.mockResolvedValue([
      { id: TENANT_A, name: 'Brand A', slug: 'brand-a' },
      { id: TENANT_B, name: 'Brand B', slug: 'brand-b' },
    ]);
    mockGroupBy.mockResolvedValue([{ tenantId: TENANT_A, cnt: 5 }]);

    const chRow = JSON.stringify({
      tenant_id: TENANT_A,
      sessions: 100,
      adapted: 80,
      holdout: 20,
      adapted_n: 80,
      adapted_conversions: 40,
      holdout_n: 20,
      holdout_conversions: 5,
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(chRow, { status: 200 })));

    const { getPlatformAnalyticsRollup } = await import('./data.js');
    const result = await getPlatformAnalyticsRollup();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.data_source).toBe('clickhouse');
    expect(result.data.quiz_data_source).toBe('live');
    expect(result.data.brands).toHaveLength(2);

    const brandA = result.data.brands.find((b) => b.tenant_id === TENANT_A);
    expect(brandA?.sessions).toBe(100);
    expect(brandA?.adapted).toBe(80);
    expect(brandA?.holdout).toBe(20);
    expect(brandA?.quizCompletions).toBe(5);
    expect(brandA?.ctaLift).not.toBeNull();

    // Brand B has zero ClickHouse activity and zero quiz completions — real
    // zeros (query succeeded, just no rows), NOT fabricated.
    const brandB = result.data.brands.find((b) => b.tenant_id === TENANT_B);
    expect(brandB?.sessions).toBe(0);
    expect(brandB?.adapted).toBe(0);
    expect(brandB?.holdout).toBe(0);
    expect(brandB?.quizCompletions).toBe(0);
    expect(brandB?.ctaLift).toBeNull();

    expect(result.data.rollup.tenantCount).toBe(2);
    expect(result.data.rollup.sessions).toBe(100);
    expect(result.data.rollup.quizCompletions).toBe(5);
  });

  it('T3: ClickHouse configured but the query fails → ok:false, status 500 (Rule K.2)', async () => {
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    mockWhere.mockResolvedValue([{ id: TENANT_A, name: 'Brand A', slug: 'brand-a' }]);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('Internal Server Error', { status: 500 })),
    );

    const { getPlatformAnalyticsRollup } = await import('./data.js');
    const result = await getPlatformAnalyticsRollup();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(500);
    expect(result.error).toContain('ClickHouse cross-brand rollup query failed');
  });

  it('T4: tenant roster Postgres query fails → ok:false, status 500 (Rule K.2)', async () => {
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    mockWhere.mockRejectedValue(new Error('connection reset'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    const { getPlatformAnalyticsRollup } = await import('./data.js');
    const result = await getPlatformAnalyticsRollup();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.status).toBe(500);
    expect(result.error).toContain('connection reset');
  });

  it('T5: quiz_completions query fails while roster + ClickHouse succeed → degrades independently', async () => {
    vi.stubEnv('CLICKHOUSE_URL', 'http://clickhouse.test');
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://test:test@localhost:5432/test');
    mockWhere.mockResolvedValue([{ id: TENANT_A, name: 'Brand A', slug: 'brand-a' }]);
    mockGroupBy.mockRejectedValue(new Error('quiz_completions table unreachable'));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 200 })));

    const { getPlatformAnalyticsRollup } = await import('./data.js');
    const result = await getPlatformAnalyticsRollup();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    // Primary metrics still live — the route is NOT a hard failure.
    expect(result.data.data_source).toBe('clickhouse');
    // Secondary metric explicitly flagged as degraded, never a fabricated 0.
    expect(result.data.quiz_data_source).toBe('error');
    expect(result.data.rollup.quizCompletions).toBeNull();
    expect(result.data.brands[0]?.quizCompletions).toBeNull();
  });

  // ─── FOLLOW-560: scoring_path split ──────────────────────────────────────

  const CH_ROLLUP_ROW = JSON.stringify({
    tenant_id: TENANT_A,
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
    mockWhere.mockResolvedValue([{ id: TENANT_A, name: 'Brand A', slug: 'brand-a' }]);
  }

  it('T6: SCORING_PATH_COLUMN_ENABLED unset → disabled, split null, query never issued', async () => {
    stubLiveStores();
    const fetchMock = vi.fn().mockResolvedValue(new Response(CH_ROLLUP_ROW, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { getPlatformAnalyticsRollup } = await import('./data.js');
    const result = await getPlatformAnalyticsRollup();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.scoring_path_source).toBe('disabled');
    expect(result.data.scoringPathSplit).toBeNull();
    // The whole point of the gate: the column may not exist here, so it is not named in any
    // query. Exactly one ClickHouse call was made — the rollup one.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('scoring_path');
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

    const { getPlatformAnalyticsRollup } = await import('./data.js');
    const result = await getPlatformAnalyticsRollup();

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

    const { getPlatformAnalyticsRollup } = await import('./data.js');
    const result = await getPlatformAnalyticsRollup();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.data.scoring_path_source).toBe('error');
    expect(result.data.scoringPathSplit).toBeNull();
    // Third independent degrade — the primary group and quizCompletions are untouched.
    expect(result.data.data_source).toBe('clickhouse');
    expect(result.data.rollup.sessions).toBe(100);
  });
});
