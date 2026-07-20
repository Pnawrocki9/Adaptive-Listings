/**
 * Tests for /admin/demo-sessions (Demo Sessions monitor, FOLLOW-593).
 *
 * @module apps/control-plane/src/app/admin/demo-sessions/page.test
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { getDemoSessionsList } from './data';

vi.mock('./data', () => ({
  getDemoSessionsList: vi.fn(),
}));

const mockGetDemoSessionsList = vi.mocked(getDemoSessionsList);

import AdminDemoSessionsPage from './page';

describe('AdminDemoSessionsPage — FOLLOW-593 real-data wiring', () => {
  it('live: renders real sessions with "data_source: live" badge', async () => {
    mockGetDemoSessionsList.mockResolvedValue({
      dataSource: 'live',
      sessions: [
        {
          id: 'ds-1',
          tenant_name: 'Real Tenant',
          scope: 'production',
          visibility: 'self',
          duration: '24h',
          status: 'active',
          created_at: '2026-07-20T10:00:00.000Z',
          expires_at: '2026-07-21T10:00:00.000Z',
        },
      ],
    });

    render(await AdminDemoSessionsPage());

    expect(screen.getByText('data_source: live')).toBeDefined();
    expect(screen.getByText('Real Tenant')).toBeDefined();
    expect(screen.getByText('active')).toBeDefined();
  });

  it('mock fallback: renders MOCK_DEMO_SESSIONS with "data_source: mock" badge', async () => {
    mockGetDemoSessionsList.mockResolvedValue({
      dataSource: 'mock',
      sessions: [
        {
          id: 'dsess-001',
          tenant_name: 'Costa Sol Properties',
          scope: 'mockup',
          visibility: 'public',
          duration: '24h',
          status: 'active',
          created_at: '2026-05-10T10:00:00.000Z',
          expires_at: '2026-05-11T10:00:00.000Z',
        },
      ],
    });

    render(await AdminDemoSessionsPage());

    expect(screen.getByText('data_source: mock')).toBeDefined();
    expect(screen.getByText('Costa Sol Properties')).toBeDefined();
  });

  it('fail loud: renders a visible error banner and no table when data_source is "error"', async () => {
    mockGetDemoSessionsList.mockResolvedValue({
      dataSource: 'error',
      sessions: [],
      errorMessage: 'connection reset',
    });

    render(await AdminDemoSessionsPage());

    expect(screen.getByText('data_source: error')).toBeDefined();
    expect(screen.getByText(/Error loading demo sessions/i)).toBeDefined();
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('empty: renders "No demo sessions yet" when live/mock data is empty', async () => {
    mockGetDemoSessionsList.mockResolvedValue({ dataSource: 'live', sessions: [] });

    render(await AdminDemoSessionsPage());

    expect(screen.getByText('No demo sessions yet')).toBeDefined();
  });
});
