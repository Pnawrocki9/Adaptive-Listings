/**
 * Tests for /admin/registrations (Pending Registrations, FOLLOW-593).
 *
 * @module apps/control-plane/src/app/admin/registrations/page.test
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { getPendingRegistrations } from './data';

vi.mock('./data', () => ({
  getPendingRegistrations: vi.fn(),
}));

const mockGetPendingRegistrations = vi.mocked(getPendingRegistrations);

import AdminRegistrationsPage from './page';

describe('AdminRegistrationsPage — FOLLOW-593 real-data wiring', () => {
  it('live: renders real pending registrations with "data_source: live" badge', async () => {
    mockGetPendingRegistrations.mockResolvedValue({
      dataSource: 'live',
      registrations: [
        {
          id: 'reg-real-1',
          agency_name: 'Real Agency',
          website_url: 'https://real.example',
          contact_email: 'ops@real.example',
          contact_name: 'Real Contact',
          country: 'Spain',
          listings_volume: '100-1000',
          created_at: '2026-07-01T00:00:00.000Z',
        },
      ],
    });

    render(await AdminRegistrationsPage());

    expect(screen.getByText('data_source: live')).toBeDefined();
    expect(screen.getByText('Real Agency')).toBeDefined();
  });

  it('mock fallback: renders MOCK_REGISTRATIONS with "data_source: mock" badge', async () => {
    mockGetPendingRegistrations.mockResolvedValue({
      dataSource: 'mock',
      registrations: [
        {
          id: 'reg-001',
          agency_name: 'Costa Sol Properties',
          website_url: 'https://costasolproperties.es',
          contact_email: 'maria@costasolproperties.es',
          contact_name: 'María García',
          country: 'Spain',
          listings_volume: '100-1000',
          created_at: '2026-05-10T09:14:00.000Z',
        },
      ],
    });

    render(await AdminRegistrationsPage());

    expect(screen.getByText('data_source: mock')).toBeDefined();
    expect(screen.getByText('Costa Sol Properties')).toBeDefined();
  });

  it('fail loud: renders a visible error banner and no table when data_source is "error"', async () => {
    mockGetPendingRegistrations.mockResolvedValue({
      dataSource: 'error',
      registrations: [],
      errorMessage: 'connection reset',
    });

    render(await AdminRegistrationsPage());

    expect(screen.getByText('data_source: error')).toBeDefined();
    expect(screen.getByText(/Error loading registrations/i)).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('empty: renders "No pending registrations" when live/mock data is empty', async () => {
    mockGetPendingRegistrations.mockResolvedValue({ dataSource: 'live', registrations: [] });

    render(await AdminRegistrationsPage());

    expect(screen.getByText('No pending registrations')).toBeDefined();
  });
});
