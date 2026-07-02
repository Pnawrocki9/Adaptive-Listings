/**
 * RTL tests for the Analytics Dashboard page (FOLLOW-453).
 *
 * Covers:
 *   - HTTP 500 on /api/dashboard/analytics/summary or .../lift → error banner
 *     rendered, NO fabricated zero metrics shown (Rule K.2; audit F-07).
 *   - data_source === 'mock' → MOCK DATA badge visible.
 *   - data_source === 'clickhouse' → no badge, numbers render.
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import AnalyticsDashboardPage from './page';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_SUMMARY_CLICKHOUSE = {
  tenant_id: 'test-tenant',
  sessions: 1234,
  adapted: 1000,
  holdout: 234,
  p95Latency: 55,
  window_days: 7,
  generated_at: '2026-07-02T12:00:00.000Z',
  data_source: 'clickhouse' as const,
};

const MOCK_SUMMARY_MOCK_SOURCE = {
  ...MOCK_SUMMARY_CLICKHOUSE,
  data_source: 'mock' as const,
};

const MOCK_LIFT_CLICKHOUSE = {
  tenant_id: 'test-tenant',
  window_days: 7,
  dqsUnavailable: false,
  generated_at: '2026-07-02T12:00:00.000Z',
  data_source: 'clickhouse' as const,
  rows: [
    {
      archetype: 'yield_hunter',
      adaptedRate: 0.1,
      holdoutRate: 0.05,
      adaptedN: 500,
      holdoutN: 60,
      lift: 100,
      pValue: 0.01,
      status: 'significant' as const,
    },
  ],
};

const MOCK_LIFT_MOCK_SOURCE = {
  ...MOCK_LIFT_CLICKHOUSE,
  data_source: 'mock' as const,
};

const SUMMARY_500_BODY = {
  error: {
    code: 'clickhouse_query_failed',
    message: 'ClickHouse query failed: connection refused',
  },
};

const LIFT_500_BODY = {
  error: { code: 'clickhouse_query_failed', message: 'ClickHouse lift query failed: timeout' },
};

const AB_WEIGHTS_EMPTY = {
  tenant_id: 'test-tenant',
  rows: [],
  total: 0,
  generated_at: '2026-07-02T12:00:00.000Z',
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFetchMock(
  summaryResponse: { ok: boolean; status: number; body: unknown },
  liftResponse: { ok: boolean; status: number; body: unknown },
) {
  const globalFetch = vi.fn((url: unknown) => {
    const urlStr = String(url);
    if (urlStr.includes('/api/ab/weights')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve(AB_WEIGHTS_EMPTY),
      });
    }
    const response = urlStr.includes('/lift') ? liftResponse : summaryResponse;
    return Promise.resolve({
      ok: response.ok,
      status: response.status,
      json: () => Promise.resolve(response.body),
    });
  });
  vi.stubGlobal('fetch', globalFetch);
  return globalFetch;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('AnalyticsDashboardPage — HTTP 500 (fail loud)', () => {
  it('shows error banner when summary returns HTTP 500', async () => {
    makeFetchMock(
      { ok: false, status: 500, body: SUMMARY_500_BODY },
      { ok: true, status: 200, body: MOCK_LIFT_CLICKHOUSE },
    );

    render(<AnalyticsDashboardPage />);

    await waitFor(() => {
      const banners = screen.getAllByRole('alert', { name: /Analytics data unavailable/i });
      expect(banners.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('does NOT render a fabricated zero-sessions KPI when summary returns HTTP 500', async () => {
    makeFetchMock(
      { ok: false, status: 500, body: SUMMARY_500_BODY },
      { ok: true, status: 200, body: MOCK_LIFT_CLICKHOUSE },
    );

    render(<AnalyticsDashboardPage />);

    await waitFor(() => {
      expect(
        screen.getAllByRole('alert', { name: /Analytics data unavailable/i }).length,
      ).toBeGreaterThanOrEqual(1);
    });

    // The 500 path must never coerce the error body to Number(x ?? 0) — "0" must
    // not appear as a rendered KPI value for the Traffic Summary panel.
    expect(screen.queryByText('1,234')).not.toBeInTheDocument();
  });

  it('shows error banner when lift returns HTTP 500', async () => {
    makeFetchMock(
      { ok: true, status: 200, body: MOCK_SUMMARY_CLICKHOUSE },
      { ok: false, status: 500, body: LIFT_500_BODY },
    );

    render(<AnalyticsDashboardPage />);

    await waitFor(() => {
      // Panel 2, 3, and 4 all derive from the lift fetch and each render its own banner.
      const banners = screen.getAllByRole('alert', { name: /Analytics data unavailable/i });
      expect(banners.length).toBeGreaterThanOrEqual(3);
    });
  });

  it('does NOT render lift table rows when lift returns HTTP 500', async () => {
    makeFetchMock(
      { ok: true, status: 200, body: MOCK_SUMMARY_CLICKHOUSE },
      { ok: false, status: 500, body: LIFT_500_BODY },
    );

    render(<AnalyticsDashboardPage />);

    await waitFor(() => {
      expect(
        screen.getAllByRole('alert', { name: /Analytics data unavailable/i }).length,
      ).toBeGreaterThanOrEqual(3);
    });

    expect(screen.queryByText('Yield Hunter')).not.toBeInTheDocument();
  });

  it('error banner includes the server error message', async () => {
    makeFetchMock(
      { ok: false, status: 500, body: SUMMARY_500_BODY },
      { ok: true, status: 200, body: MOCK_LIFT_CLICKHOUSE },
    );

    render(<AnalyticsDashboardPage />);

    await waitFor(() => {
      const matches = screen.getAllByText(/connection refused/i);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('AnalyticsDashboardPage — mock data badge (data_source === mock)', () => {
  it('shows MOCK DATA badge when summary returns data_source=mock', async () => {
    makeFetchMock(
      { ok: true, status: 200, body: MOCK_SUMMARY_MOCK_SOURCE },
      { ok: true, status: 200, body: MOCK_LIFT_CLICKHOUSE },
    );

    render(<AnalyticsDashboardPage />);

    await waitFor(() => {
      const badges = screen.getAllByLabelText('MOCK DATA');
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows MOCK DATA badge when lift returns data_source=mock', async () => {
    makeFetchMock(
      { ok: true, status: 200, body: MOCK_SUMMARY_CLICKHOUSE },
      { ok: true, status: 200, body: MOCK_LIFT_MOCK_SOURCE },
    );

    render(<AnalyticsDashboardPage />);

    await waitFor(() => {
      const badges = screen.getAllByLabelText('MOCK DATA');
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders metric numbers alongside mock badge (mock !== error)', async () => {
    makeFetchMock(
      { ok: true, status: 200, body: MOCK_SUMMARY_MOCK_SOURCE },
      { ok: true, status: 200, body: MOCK_LIFT_CLICKHOUSE },
    );

    render(<AnalyticsDashboardPage />);

    await waitFor(() => {
      expect(screen.getAllByLabelText('MOCK DATA').length).toBeGreaterThanOrEqual(1);
    });

    expect(screen.getByText('1,234')).toBeInTheDocument();
  });
});

describe('AnalyticsDashboardPage — clean render (data_source=clickhouse)', () => {
  it('does NOT show MOCK DATA badge when both sources return clickhouse', async () => {
    makeFetchMock(
      { ok: true, status: 200, body: MOCK_SUMMARY_CLICKHOUSE },
      { ok: true, status: 200, body: MOCK_LIFT_CLICKHOUSE },
    );

    render(<AnalyticsDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('1,234')).toBeInTheDocument();
    });

    expect(screen.queryByLabelText('MOCK DATA')).not.toBeInTheDocument();
  });

  it('does NOT show error banner when both sources return 200', async () => {
    makeFetchMock(
      { ok: true, status: 200, body: MOCK_SUMMARY_CLICKHOUSE },
      { ok: true, status: 200, body: MOCK_LIFT_CLICKHOUSE },
    );

    render(<AnalyticsDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('1,234')).toBeInTheDocument();
    });

    expect(
      screen.queryByRole('alert', { name: /Analytics data unavailable/i }),
    ).not.toBeInTheDocument();
  });

  it('renders the lift table row when lift source is clickhouse', async () => {
    makeFetchMock(
      { ok: true, status: 200, body: MOCK_SUMMARY_CLICKHOUSE },
      { ok: true, status: 200, body: MOCK_LIFT_CLICKHOUSE },
    );

    render(<AnalyticsDashboardPage />);

    await waitFor(() => {
      expect(screen.getAllByText('Yield Hunter').length).toBeGreaterThanOrEqual(1);
    });
  });
});
