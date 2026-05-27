/**
 * RTL tests for the Pilot Dashboard page (FOLLOW-122).
 *
 * Covers:
 *   - HTTP 500 → error banner rendered, NO metric numbers shown
 *   - data_source === 'mock' → MOCK DATA badge visible
 *   - data_source === 'clickhouse' → no badge, numbers render
 */

import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import PilotDashboardPage from './page';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_CTA_CLICKHOUSE = {
  window_days: 7,
  tenant_id: 'test-tenant',
  data_source: 'clickhouse' as const,
  generated_at: '2026-05-27T12:00:00.000Z',
  summary: {
    adapted_sessions: 1000,
    holdout_sessions: 111,
    adapted_cta_rate: 0.08,
    holdout_cta_rate: 0.05,
    absolute_lift: 0.03,
    relative_lift_pct: 60,
    p_value: 0.032,
    is_significant: true,
    confidence: '95%' as const,
  },
  funnel: [
    {
      stage: 'page.view',
      adapted_count: 1000,
      holdout_count: 111,
      adapted_rate: 1.0,
      holdout_rate: 1.0,
    },
    {
      stage: 'cta.clicked',
      adapted_count: 80,
      holdout_count: 5,
      adapted_rate: 0.08,
      holdout_rate: 0.045,
    },
  ],
  by_archetype: [
    {
      archetype: 'yield_hunter',
      adapted_cta_rate: 0.1,
      holdout_cta_rate: 0.04,
      lift_pct: 150,
      n_adapted: 200,
      n_holdout: 22,
      p_value: 0.01,
    },
  ],
};

const MOCK_CTA_MOCK_SOURCE = {
  ...MOCK_CTA_CLICKHOUSE,
  data_source: 'mock' as const,
};

const MOCK_INQUIRY_CLICKHOUSE = {
  tenant_id: 'test-tenant',
  total_inquiry_starts: 120,
  adapted_count: 100,
  holdout_count: 20,
  adapted_rate: 0.1,
  holdout_rate: 0.05,
  lift_pct: 100,
  daily_breakdown: [{ date: '2026-05-27', adapted: 10, holdout: 2 }],
  window_days: 7,
  generated_at: '2026-05-27T12:00:00.000Z',
  data_source: 'clickhouse' as const,
};

const MOCK_INQUIRY_MOCK_SOURCE = {
  ...MOCK_INQUIRY_CLICKHOUSE,
  data_source: 'mock' as const,
};

const CTA_500_BODY = {
  error: { code: 'clickhouse_error', message: 'ClickHouse query failed: connection refused' },
};

const INQUIRY_500_BODY = {
  error: { code: 'clickhouse_error', message: 'ClickHouse daily query failed: timeout' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeFetchMock(
  ctaResponse: { ok: boolean; status: number; body: unknown },
  inquiryResponse: { ok: boolean; status: number; body: unknown },
) {
  const globalFetch = vi.fn((url: unknown) => {
    const urlStr = String(url);
    const response = urlStr.includes('cta-lift') ? ctaResponse : inquiryResponse;
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

describe('PilotDashboardPage — HTTP 500 (fail loud)', () => {
  it('shows error banner when cta-lift returns HTTP 500', async () => {
    makeFetchMock(
      { ok: false, status: 500, body: CTA_500_BODY },
      { ok: true, status: 200, body: MOCK_INQUIRY_CLICKHOUSE },
    );

    render(<PilotDashboardPage />);

    // Wait for async fetch to resolve.
    await waitFor(() => {
      // Multiple panels share the cta-lift error so there will be several banners.
      const banners = screen.getAllByRole('alert', { name: /ClickHouse unavailable/i });
      expect(banners.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('does NOT render adapted session numbers when cta-lift returns HTTP 500', async () => {
    makeFetchMock(
      { ok: false, status: 500, body: CTA_500_BODY },
      { ok: true, status: 200, body: MOCK_INQUIRY_CLICKHOUSE },
    );

    render(<PilotDashboardPage />);

    await waitFor(() => {
      expect(
        screen.getAllByRole('alert', { name: /ClickHouse unavailable/i }).length,
      ).toBeGreaterThanOrEqual(1);
    });

    // The KPI value "1,000" (adapted_sessions from mock) must NOT appear
    // because the 500 path must never fabricate zeros or swallow the error.
    expect(screen.queryByText('1,000')).not.toBeInTheDocument();
    expect(screen.queryByText(/8\.00%/)).not.toBeInTheDocument();
  });

  it('shows error banner when inquiry-starts returns HTTP 500', async () => {
    makeFetchMock(
      { ok: true, status: 200, body: MOCK_CTA_CLICKHOUSE },
      { ok: false, status: 500, body: INQUIRY_500_BODY },
    );

    render(<PilotDashboardPage />);

    await waitFor(() => {
      const banners = screen.getAllByRole('alert', { name: /ClickHouse unavailable/i });
      expect(banners.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('does NOT render inquiry metric numbers when inquiry-starts returns HTTP 500', async () => {
    makeFetchMock(
      { ok: true, status: 200, body: MOCK_CTA_CLICKHOUSE },
      { ok: false, status: 500, body: INQUIRY_500_BODY },
    );

    render(<PilotDashboardPage />);

    await waitFor(() => {
      expect(
        screen.getAllByRole('alert', { name: /ClickHouse unavailable/i }).length,
      ).toBeGreaterThanOrEqual(1);
    });

    // "120" is total_inquiry_starts from the mock fixture — must NOT appear.
    expect(screen.queryByText('120')).not.toBeInTheDocument();
  });

  it('error banner includes the server error message', async () => {
    makeFetchMock(
      { ok: false, status: 500, body: CTA_500_BODY },
      { ok: true, status: 200, body: MOCK_INQUIRY_CLICKHOUSE },
    );

    render(<PilotDashboardPage />);

    await waitFor(() => {
      // Multiple panels share the cta-lift error — use getAllByText to find any.
      const matches = screen.getAllByText(/connection refused/i);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('PilotDashboardPage — mock data badge (data_source !== clickhouse)', () => {
  it('shows MOCK DATA badge when cta-lift returns data_source=mock', async () => {
    makeFetchMock(
      { ok: true, status: 200, body: MOCK_CTA_MOCK_SOURCE },
      { ok: true, status: 200, body: MOCK_INQUIRY_CLICKHOUSE },
    );

    render(<PilotDashboardPage />);

    await waitFor(() => {
      const badges = screen.getAllByLabelText('MOCK DATA');
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows MOCK DATA badge when inquiry-starts returns data_source=mock', async () => {
    makeFetchMock(
      { ok: true, status: 200, body: MOCK_CTA_CLICKHOUSE },
      { ok: true, status: 200, body: MOCK_INQUIRY_MOCK_SOURCE },
    );

    render(<PilotDashboardPage />);

    await waitFor(() => {
      const badges = screen.getAllByLabelText('MOCK DATA');
      expect(badges.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders metric numbers alongside mock badge (mock ≠ error)', async () => {
    makeFetchMock(
      { ok: true, status: 200, body: MOCK_CTA_MOCK_SOURCE },
      { ok: true, status: 200, body: MOCK_INQUIRY_CLICKHOUSE },
    );

    render(<PilotDashboardPage />);

    await waitFor(() => {
      expect(screen.getAllByLabelText('MOCK DATA').length).toBeGreaterThanOrEqual(1);
    });

    // Adapted sessions value "1,000" should still be visible.
    expect(screen.getByText('1,000')).toBeInTheDocument();
  });
});

describe('PilotDashboardPage — clean render (data_source=clickhouse)', () => {
  it('does NOT show MOCK DATA badge when both sources return clickhouse', async () => {
    makeFetchMock(
      { ok: true, status: 200, body: MOCK_CTA_CLICKHOUSE },
      { ok: true, status: 200, body: MOCK_INQUIRY_CLICKHOUSE },
    );

    render(<PilotDashboardPage />);

    await waitFor(() => {
      // "1,000" is the adapted sessions count — proves data rendered.
      expect(screen.getByText('1,000')).toBeInTheDocument();
    });

    expect(screen.queryByLabelText('MOCK DATA')).not.toBeInTheDocument();
  });

  it('does NOT show error banner when both sources return 200', async () => {
    makeFetchMock(
      { ok: true, status: 200, body: MOCK_CTA_CLICKHOUSE },
      { ok: true, status: 200, body: MOCK_INQUIRY_CLICKHOUSE },
    );

    render(<PilotDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('1,000')).toBeInTheDocument();
    });

    expect(
      screen.queryByRole('alert', { name: /ClickHouse unavailable/i }),
    ).not.toBeInTheDocument();
  });

  it('renders total inquiry starts when inquiry source is clickhouse', async () => {
    makeFetchMock(
      { ok: true, status: 200, body: MOCK_CTA_CLICKHOUSE },
      { ok: true, status: 200, body: MOCK_INQUIRY_CLICKHOUSE },
    );

    render(<PilotDashboardPage />);

    await waitFor(() => {
      expect(screen.getByText('120')).toBeInTheDocument();
    });
  });
});
