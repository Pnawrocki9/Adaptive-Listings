/**
 * RTL tests for CalibrationSection — the Calibration + Conversion Aggregates panel of the staff
 * labels page (FOLLOW-173/FOLLOW-174; staff port FOLLOW-1334; agency page deleted by FOLLOW-1335).
 *
 * Covers: loading skeleton → rendered tables; empty state; HTTP 500 → visible error banner and NO
 * numbers (Rule K.2); `data_source !== 'clickhouse'` → MOCK DATA badge; window selector re-fetches;
 * the tenant scoping of the GET (`&tenant_id=` with the prop, byte-identical URL without it).
 *
 * @module apps/control-plane/src/components/analytics/calibration-panel.test
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CalibrationResponse } from '@/app/api/pilot/calibration/route-helpers';
import { CalibrationSection } from './calibration-panel';

const TENANT = '550e8400-e29b-41d4-a716-446655440001';

const DATA: CalibrationResponse = {
  window_days: 7,
  tenant_id: TENANT,
  calibration: [
    {
      confidence_decile: 0.8,
      predicted_rate: 0.85,
      actual_conversion_rate: 0.5,
      sample_size: 41,
      model_version: 'rulebased-bandit-v1',
    },
  ],
  conversion_aggregates: [
    { outcome_class: 'offer_made', model_version: 'rulebased-bandit-v1', count: 17, rate: 0.25 },
  ],
  generated_at: '2026-10-19T12:00:00.000Z',
  data_source: 'clickhouse',
};

function stubFetch(res: { ok: boolean; status: number; body: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: res.ok,
    status: res.status,
    json: () => Promise.resolve(res.body),
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CalibrationSection', () => {
  it('renders the aggregates and the reliability curve on a clickhouse read (no MOCK badge)', async () => {
    stubFetch({ ok: true, status: 200, body: DATA });

    render(<CalibrationSection />);

    await waitFor(() => {
      expect(screen.getByText('Conversion Aggregates')).toBeInTheDocument();
    });
    expect(screen.getByText('17')).toBeInTheDocument();
    expect(screen.getByText('25.0%')).toBeInTheDocument();
    expect(screen.getByText('Reliability Curve (score vs actual)')).toBeInTheDocument();
    expect(screen.getByText('41')).toBeInTheDocument();
    expect(screen.queryByLabelText('MOCK DATA')).not.toBeInTheDocument();
  });

  it('shows the MOCK DATA badge when the route reports data_source=mock', async () => {
    stubFetch({ ok: true, status: 200, body: { ...DATA, data_source: 'mock' } });

    render(<CalibrationSection />);

    await waitFor(() => {
      expect(screen.getByLabelText('MOCK DATA')).toBeInTheDocument();
    });
  });

  it('renders the empty state when there is no calibration data', async () => {
    stubFetch({
      ok: true,
      status: 200,
      body: { ...DATA, calibration: [], conversion_aggregates: [] },
    });

    render(<CalibrationSection />);

    await waitFor(() => {
      expect(screen.getByText(/No calibration data yet/)).toBeInTheDocument();
    });
  });

  it('HTTP 500 → error banner with the server message, NO tables or numbers (Rule K.2)', async () => {
    stubFetch({
      ok: false,
      status: 500,
      body: {
        error: { code: 'clickhouse_query_failed', message: 'ClickHouse query failed: down' },
      },
    });

    render(<CalibrationSection />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('ClickHouse query failed: down');
    });
    expect(screen.queryByText('Conversion Aggregates')).not.toBeInTheDocument();
    expect(screen.queryByText('Reliability Curve (score vs actual)')).not.toBeInTheDocument();
  });

  it('a network failure is a visible error, not an empty panel', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    render(<CalibrationSection />);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('ECONNREFUSED');
    });
  });

  it('with a tenantId prop the GET carries &tenant_id (staff-override route)', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, body: DATA });

    render(<CalibrationSection tenantId={TENANT} />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/pilot/calibration?window_days=7&tenant_id=${TENANT}`,
      );
    });
  });

  it('without a tenantId prop no tenant_id is sent; the window re-fetches', async () => {
    const fetchMock = stubFetch({ ok: true, status: 200, body: DATA });

    render(<CalibrationSection />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/pilot/calibration?window_days=7');
    });
    fireEvent.change(screen.getByLabelText(/Window/), { target: { value: '30' } });
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/pilot/calibration?window_days=30');
    });
  });
});
