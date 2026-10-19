/**
 * RTL tests for the Pilot tab (FOLLOW-122; moved under /dashboard/analytics by FOLLOW-1289).
 *
 * Covers:
 *   - HTTP 500 → error banner rendered, NO metric numbers shown
 *   - data_source === 'mock' → MOCK DATA badge visible
 *   - data_source === 'clickhouse' → no badge, numbers render
 */

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { PilotView } from './pilot-view';

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

const HISTORY_EMPTY = {
  ok: true,
  status: 200,
  body: { tenant_id: 'test-tenant', data_source: 'postgres', rows: [] },
};

function makeFetchMock(
  ctaResponse: { ok: boolean; status: number; body: unknown },
  inquiryResponse: { ok: boolean; status: number; body: unknown },
  historyResponse: { ok: boolean; status: number; body: unknown } = HISTORY_EMPTY,
) {
  const globalFetch = vi.fn((url: unknown) => {
    const urlStr = String(url);
    const response = urlStr.includes('lift/history')
      ? historyResponse
      : urlStr.includes('analytics/lift')
        ? ctaResponse
        : inquiryResponse;
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

describe('PilotView — HTTP 500 (fail loud)', () => {
  it('shows error banner when cta-lift returns HTTP 500', async () => {
    makeFetchMock(
      { ok: false, status: 500, body: CTA_500_BODY },
      { ok: true, status: 200, body: MOCK_INQUIRY_CLICKHOUSE },
    );

    render(<PilotView />);

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

    render(<PilotView />);

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

    render(<PilotView />);

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

    render(<PilotView />);

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

    render(<PilotView />);

    await waitFor(() => {
      // Multiple panels share the cta-lift error — use getAllByText to find any.
      const matches = screen.getAllByText(/connection refused/i);
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('PilotView — mock data badge (data_source !== clickhouse)', () => {
  it('shows MOCK DATA badge when cta-lift returns data_source=mock', async () => {
    makeFetchMock(
      { ok: true, status: 200, body: MOCK_CTA_MOCK_SOURCE },
      { ok: true, status: 200, body: MOCK_INQUIRY_CLICKHOUSE },
    );

    render(<PilotView />);

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

    render(<PilotView />);

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

    render(<PilotView />);

    await waitFor(() => {
      expect(screen.getAllByLabelText('MOCK DATA').length).toBeGreaterThanOrEqual(1);
    });

    // Adapted sessions value "1,000" should still be visible.
    expect(screen.getByText('1,000')).toBeInTheDocument();
  });
});

describe('PilotView — clean render (data_source=clickhouse)', () => {
  it('does NOT show MOCK DATA badge when both sources return clickhouse', async () => {
    makeFetchMock(
      { ok: true, status: 200, body: MOCK_CTA_CLICKHOUSE },
      { ok: true, status: 200, body: MOCK_INQUIRY_CLICKHOUSE },
    );

    render(<PilotView />);

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

    render(<PilotView />);

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

    render(<PilotView />);

    await waitFor(() => {
      expect(screen.getByText('120')).toBeInTheDocument();
    });
  });
});

describe('PilotView — tenant scoping (ADR-0018, FOLLOW-1334)', () => {
  const TENANT = '550e8400-e29b-41d4-a716-446655440001';

  it('with a tenantId prop, BOTH GETs carry &tenant_id (staff-override routes)', async () => {
    const fetchMock = makeFetchMock(
      { ok: true, status: 200, body: MOCK_CTA_CLICKHOUSE },
      { ok: true, status: 200, body: MOCK_INQUIRY_CLICKHOUSE },
    );

    render(<PilotView tenantId={TENANT} />);

    await waitFor(() => {
      // the two window readers + the snapshot history (FOLLOW-1338)
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain(`/api/dashboard/analytics/lift?window_days=7&tenant_id=${TENANT}`);
    expect(urls).toContain(`/api/pilot/inquiry-starts?window_days=7&tenant_id=${TENANT}`);
    expect(urls).toContain(`/api/dashboard/analytics/lift/history?tenant_id=${TENANT}`);
  });

  it('without a tenantId prop the URLs are byte-identical to the agency dashboard’s', async () => {
    const fetchMock = makeFetchMock(
      { ok: true, status: 200, body: MOCK_CTA_CLICKHOUSE },
      { ok: true, status: 200, body: MOCK_INQUIRY_CLICKHOUSE },
    );

    render(<PilotView />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toEqual([
      '/api/dashboard/analytics/lift?window_days=7',
      '/api/pilot/inquiry-starts?window_days=7',
    ]);
  });
});

// ─── FOLLOW-1338: D-J breakdown, 90-day window, CSV, History ──────────────────────

describe('PilotView — lift report (FOLLOW-1338)', () => {
  const TENANT = '550e8400-e29b-41d4-a716-446655440001';
  const WITH_BREAKDOWN = {
    ...MOCK_CTA_CLICKHOUSE,
    conversion_source: 'signed_events' as const,
    conversion_breakdown: {
      adapted: {
        sessions: 1000,
        conversions: 80,
        conversion_rate: 0.08,
        live_signups: 50,
        live_signup_rate: 0.05,
        agent_contacts: 40,
        agent_contact_rate: 0.04,
      },
      holdout: {
        sessions: 111,
        conversions: 5,
        conversion_rate: 0.045,
        live_signups: null,
        live_signup_rate: null,
        agent_contacts: null,
        agent_contact_rate: null,
      },
    },
  };

  it('shows LIVE signup rate and agent contact rate per arm beside the combined conversion', async () => {
    makeFetchMock(
      { ok: true, status: 200, body: WITH_BREAKDOWN },
      { ok: true, status: 200, body: MOCK_INQUIRY_CLICKHOUSE },
    );
    render(<PilotView tenantId={TENANT} />);
    const table = await screen.findByLabelText('Conversion breakdown');
    const rows = within(table).getAllByRole('row');
    expect(within(rows[1]!).getByText('Adapted')).toBeTruthy();
    expect(rows[1]!.textContent).toContain('8.00% (80)');
    expect(rows[1]!.textContent).toContain('5.00% (50)');
    expect(rows[1]!.textContent).toContain('4.00% (40)');
    // a part that was not read is a dash, never 0%
    expect(rows[2]!.textContent).toContain('4.50% (5)');
    expect(rows[2]!.textContent).toContain('—');
    expect(rows[2]!.textContent).not.toContain('0.00%');
  });

  it('offers 90 days and refetches both readers with window_days=90', async () => {
    const fetchMock = makeFetchMock(
      { ok: true, status: 200, body: WITH_BREAKDOWN },
      { ok: true, status: 200, body: MOCK_INQUIRY_CLICKHOUSE },
    );
    render(<PilotView tenantId={TENANT} />);
    const select = await screen.findByLabelText(/Window/);
    expect(within(select).getByRole('option', { name: '90 days' })).toBeTruthy();
    fireEvent.change(select, { target: { value: '90' } });
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(urls).toContain(`/api/dashboard/analytics/lift?window_days=90&tenant_id=${TENANT}`);
      expect(urls).toContain(`/api/pilot/inquiry-starts?window_days=90&tenant_id=${TENANT}`);
    });
  });

  it('Download CSV points at the export for the selected window and tenant (staff only)', async () => {
    makeFetchMock(
      { ok: true, status: 200, body: WITH_BREAKDOWN },
      { ok: true, status: 200, body: MOCK_INQUIRY_CLICKHOUSE },
    );
    const { unmount } = render(<PilotView tenantId={TENANT} />);
    const link = await screen.findByRole('link', { name: 'Download CSV' });
    expect(link.getAttribute('href')).toBe(
      `/api/dashboard/analytics/lift/export?window=7&tenant_id=${TENANT}`,
    );
    fireEvent.change(screen.getByLabelText(/Window/), { target: { value: '30' } });
    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Download CSV' }).getAttribute('href')).toContain(
        'window=30',
      );
    });
    unmount();

    // no tenant id (the agency wrapper) -> no export link, no history request
    const fetchMock = makeFetchMock(
      { ok: true, status: 200, body: WITH_BREAKDOWN },
      { ok: true, status: 200, body: MOCK_INQUIRY_CLICKHOUSE },
    );
    render(<PilotView />);
    await screen.findByLabelText('Conversion breakdown');
    expect(screen.queryByRole('link', { name: 'Download CSV' })).toBeNull();
    expect(fetchMock.mock.calls.some((c) => String(c[0]).includes('lift/history'))).toBe(false);
  });

  it('History: empty state, rows, and an error banner when the table is missing', async () => {
    makeFetchMock(
      { ok: true, status: 200, body: WITH_BREAKDOWN },
      { ok: true, status: 200, body: MOCK_INQUIRY_CLICKHOUSE },
    );
    const empty = render(<PilotView tenantId={TENANT} />);
    expect(await screen.findByText(/No snapshots yet/)).toBeTruthy();
    expect(screen.queryByRole('alert', { name: 'History unavailable' })).toBeNull();
    empty.unmount();

    makeFetchMock(
      { ok: true, status: 200, body: WITH_BREAKDOWN },
      { ok: true, status: 200, body: MOCK_INQUIRY_CLICKHOUSE },
      {
        ok: true,
        status: 200,
        body: {
          tenant_id: TENANT,
          data_source: 'postgres',
          rows: [
            {
              day: '2026-10-18',
              arm: 'adapted',
              sessions: 60,
              conversions: 9,
              live_signups: 6,
              agent_contacts: 5,
              relative_lift_pct: 100,
              p_value: 0.1234,
              confidence: 'not_significant',
              computed_at: '2026-10-19T01:15:02.123Z',
            },
          ],
        },
      },
    );
    const filled = render(<PilotView tenantId={TENANT} />);
    const history = await screen.findByRole('region', { name: 'Lift history' });
    await waitFor(() => {
      expect(history.textContent).toContain('2026-10-18');
    });
    expect(history.textContent).toContain('+100.0%');
    expect(history.textContent).toContain('0.1234');
    filled.unmount();

    makeFetchMock(
      { ok: true, status: 200, body: WITH_BREAKDOWN },
      { ok: true, status: 200, body: MOCK_INQUIRY_CLICKHOUSE },
      {
        ok: false,
        status: 500,
        body: {
          error: {
            code: 'lift_snapshot_table_missing',
            message: 'lift_daily_snapshots does not exist',
          },
        },
      },
    );
    render(<PilotView tenantId={TENANT} />);
    const banner = await screen.findByRole('alert', { name: 'History unavailable' });
    expect(banner.textContent).toContain('lift_snapshot_table_missing');
    expect(screen.queryByText(/No snapshots yet/)).toBeNull();
  });
});
