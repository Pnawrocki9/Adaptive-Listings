/**
 * Tests for /admin/analytics (Cross-Brand Analytics, FOLLOW-638).
 *
 * Mocks `@/app/api/admin/analytics/rollup/data` directly (the data-access
 * layer is covered by `data.test.ts`) and asserts the PAGE renders correctly
 * for each `data_source`/`quiz_data_source` state:
 *
 *   T1: ok:true, data_source 'clickhouse' — renders rollup cards + per-brand
 *       table with real values and links to /admin/tenants/[id].
 *   T2: ok:true, data_source 'mock' — renders the same UI with a visible
 *       "data_source: mock" badge.
 *   T3: ok:false — renders a visible error banner, NEVER a table
 *       (Rule K.2 fail-loud).
 *   T4: ok:true, quiz_data_source 'error' — quizCompletions cells render "—"
 *       instead of a fabricated 0.
 *   T5: FOLLOW-560 — a live scoring_path split renders the four counts and the
 *       real-ranking share.
 *   T6: FOLLOW-560 — scoring_path_source 'disabled' renders the REASON (and
 *       says migration 0022 / FOLLOW-820), never a zero split.
 *   T7: FOLLOW-560 — scoring_path_source 'error' renders an error reason, and
 *       is worded differently from the 'disabled' one.
 *
 * @module apps/control-plane/src/app/admin/analytics/page.test
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('@/app/api/admin/analytics/rollup/data', () => ({
  getPlatformAnalyticsRollup: vi.fn(),
}));

import { getPlatformAnalyticsRollup } from '@/app/api/admin/analytics/rollup/data';
import type { PlatformAnalyticsRollup } from '@/app/api/admin/analytics/rollup/data';

const mockGetPlatformAnalyticsRollup = vi.mocked(getPlatformAnalyticsRollup);

import AdminAnalyticsPage from './page';

const LIVE_DATA: PlatformAnalyticsRollup = {
  window_days: 7,
  generated_at: '2026-07-24T00:00:00.000Z',
  rollup: {
    tenantCount: 1,
    sessions: 250,
    adapted: 200,
    holdout: 50,
    ctaLift: 15.25,
    quizCompletions: 30,
  },
  brands: [
    {
      tenant_id: '11111111-1111-1111-1111-111111111111',
      tenant_name: 'Real Brand Co',
      tenant_slug: 'real-brand-co',
      sessions: 250,
      adapted: 200,
      holdout: 50,
      ctaLift: 15.25,
      quizCompletions: 30,
    },
  ],
  data_source: 'clickhouse',
  quiz_data_source: 'live',
  scoringPathSplit: { cosine: 12, djb2_fallback: 7, djb2_guard: 5, not_applicable: 3 },
  scoring_path_source: 'live',
};

describe('AdminAnalyticsPage — FOLLOW-638', () => {
  it('T1 (live): renders rollup cards, per-brand row, and a tenant details link', async () => {
    mockGetPlatformAnalyticsRollup.mockResolvedValue({ ok: true, data: LIVE_DATA });

    render(await AdminAnalyticsPage());

    expect(screen.getByText(/Cross-Brand Analytics/i)).toBeDefined();
    expect(screen.getByText('data_source: clickhouse')).toBeDefined();
    expect(screen.getByText('quiz: live')).toBeDefined();
    expect(screen.getByText('Real Brand Co')).toBeDefined();
    // '250' appears twice: the Sessions rollup card AND the per-brand row.
    expect(screen.getAllByText('250').length).toBe(2);

    const link = screen.getByText('Tenant details').closest('a');
    expect(link?.getAttribute('href')).toBe(`/admin/tenants/${LIVE_DATA.brands[0]!.tenant_id}`);
  });

  it('T2 (mock fallback): renders mock data with a visible "data_source: mock" badge', async () => {
    mockGetPlatformAnalyticsRollup.mockResolvedValue({
      ok: true,
      data: { ...LIVE_DATA, data_source: 'mock', quiz_data_source: 'mock' },
    });

    render(await AdminAnalyticsPage());

    expect(screen.getByText('data_source: mock')).toBeDefined();
    expect(screen.getByText('quiz: mock')).toBeDefined();
  });

  it('T3 (fail loud): renders a visible error banner and NO table when ok:false', async () => {
    mockGetPlatformAnalyticsRollup.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'ClickHouse cross-brand rollup query failed: HTTP 500',
    });

    render(await AdminAnalyticsPage());

    expect(screen.getByText(/Error loading cross-brand analytics/i)).toBeDefined();
    expect(screen.getByText(/ClickHouse cross-brand rollup query failed/i)).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('data_source:')).toBeNull();
  });

  it('T4 (quiz degraded): renders "—" instead of a fabricated 0 when quiz_data_source is error', async () => {
    mockGetPlatformAnalyticsRollup.mockResolvedValue({
      ok: true,
      data: {
        ...LIVE_DATA,
        quiz_data_source: 'error',
        rollup: { ...LIVE_DATA.rollup, quizCompletions: null },
        brands: [{ ...LIVE_DATA.brands[0]!, quizCompletions: null }],
      },
    });

    render(await AdminAnalyticsPage());

    expect(screen.getByText('quiz: error')).toBeDefined();
    // Both the rollup card and the per-brand cell render the placeholder,
    // never a fabricated 0.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  // ─── FOLLOW-560: the cosine-vs-djb2 panel ────────────────────────────────

  it('T5 (scoring path live): renders the four counts and the real-ranking share', async () => {
    mockGetPlatformAnalyticsRollup.mockResolvedValue({ ok: true, data: LIVE_DATA });

    render(await AdminAnalyticsPage());

    expect(screen.getByText('scoring_path: live')).toBeDefined();
    expect(screen.getByText('cosine')).toBeDefined();
    expect(screen.getByText('djb2 fallback')).toBeDefined();
    expect(screen.getByText('djb2 guard')).toBeDefined();
    // 12 of the 24 RANKED decisions (cosine + both djb2 paths) used real embeddings; the 3
    // 'not_applicable' rows never built a ReorderDirective and are excluded from the share.
    expect(screen.getByText('50.0%')).toBeDefined();
  });

  it('T6 (scoring path disabled): renders the reason, never a zero split', async () => {
    mockGetPlatformAnalyticsRollup.mockResolvedValue({
      ok: true,
      data: { ...LIVE_DATA, scoringPathSplit: null, scoring_path_source: 'disabled' },
    });

    render(await AdminAnalyticsPage());

    expect(screen.getByText('scoring_path: disabled')).toBeDefined();
    expect(screen.getByText(/SCORING_PATH_COLUMN_ENABLED is not set/i)).toBeDefined();
    expect(screen.getByText(/migration 0022/i)).toBeDefined();
    expect(screen.queryByText('djb2 fallback')).toBeNull();
  });

  it('T7 (scoring path error): renders an error reason distinct from the disabled one', async () => {
    mockGetPlatformAnalyticsRollup.mockResolvedValue({
      ok: true,
      data: { ...LIVE_DATA, scoringPathSplit: null, scoring_path_source: 'error' },
    });

    render(await AdminAnalyticsPage());

    expect(screen.getByText('scoring_path: error')).toBeDefined();
    expect(screen.getByText(/scoring_path query failed/i)).toBeDefined();
    expect(screen.queryByText(/SCORING_PATH_COLUMN_ENABLED is not set/i)).toBeNull();
  });
});
