/**
 * Tests for /admin/tenants (Tenant Fleet hub, FOLLOW-593).
 *
 * FOLLOW-593 (ADR-0018 §Decision 0) un-hides this page and wires it to the
 * real `tenants` table via `getTenantsList()` (`./data`). This suite mocks
 * `./data` directly (the DB-access layer is covered separately by
 * `data.test.ts`) and asserts the PAGE renders correctly for each of the
 * three `data_source` states:
 *
 *   T1: 'live' — renders real rows + per-tenant Tracer/Overview links (FOLLOW-311)
 *   T2: 'mock' — renders MOCK_TENANTS rows with a visible "data_source: mock" badge
 *   T3: 'error' — renders a visible error banner, NEVER a table (Rule K.2 fail-loud)
 *
 * @module apps/control-plane/src/app/admin/tenants/page.test
 */

import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { getTenantsList } from './data';
import type { TenantRow } from './data';

vi.mock('./data', () => ({
  getTenantsList: vi.fn(),
}));

const mockGetTenantsList = vi.mocked(getTenantsList);

import AdminTenantsPage from './page';

const LIVE_TENANT: TenantRow = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Real Tenant Co',
  plan: 'growth',
  status: 'active',
  createdAt: '2026-07-01T00:00:00.000Z',
  profileModeEnabled: true,
};

describe('AdminTenantsPage — FOLLOW-593 real-data wiring', () => {
  it('T1 (live): renders real tenant rows + Overview/Tracer links built from real ids', async () => {
    mockGetTenantsList.mockResolvedValue({ dataSource: 'live', tenants: [LIVE_TENANT] });

    render(await AdminTenantsPage());

    expect(screen.getByText(/Tenant Fleet/i)).toBeDefined();
    expect(screen.getByText('data_source: live')).toBeDefined();
    expect(screen.getByText('Real Tenant Co')).toBeDefined();

    const overviewLink = screen.getByText('Overview').closest('a');
    expect(overviewLink?.getAttribute('href')).toBe(`/admin/tenants/${LIVE_TENANT.id}`);

    const liveMonitorLink = screen.getByText('Live Monitor').closest('a');
    expect(liveMonitorLink?.getAttribute('href')).toBe(`/admin/tenants/${LIVE_TENANT.id}/tracer`);

    const historyLink = screen.getByText('History').closest('a');
    expect(historyLink?.getAttribute('href')).toBe(
      `/admin/tenants/${LIVE_TENANT.id}/tracer/history`,
    );

    const exportLink = screen.getByText('Export').closest('a');
    expect(exportLink?.getAttribute('href')).toBe(`/admin/tenants/${LIVE_TENANT.id}/tracer/export`);
  });

  it('T1: stats row is computed from the real rows returned (1 total, 1 active)', async () => {
    mockGetTenantsList.mockResolvedValue({ dataSource: 'live', tenants: [LIVE_TENANT] });

    render(await AdminTenantsPage());

    expect(screen.getByText('Total Tenants')).toBeDefined();
    const total = screen.getByText('Total Tenants').previousSibling;
    expect(total?.textContent).toBe('1');
  });

  it('T2 (mock fallback): renders MOCK_TENANTS with a visible "data_source: mock" badge', async () => {
    mockGetTenantsList.mockResolvedValue({
      dataSource: 'mock',
      tenants: [
        {
          id: 'tenant-001',
          name: 'Costa Sol Properties',
          plan: 'growth',
          status: 'active',
          createdAt: '2026-04-15T10:00:00.000Z',
          profileModeEnabled: false,
        },
      ],
    });

    render(await AdminTenantsPage());

    expect(screen.getByText('data_source: mock')).toBeDefined();
    expect(screen.getByText('Costa Sol Properties')).toBeDefined();
  });

  it('T3 (fail loud): renders a visible error banner and NO table when data_source is "error"', async () => {
    mockGetTenantsList.mockResolvedValue({
      dataSource: 'error',
      tenants: [],
      errorMessage: 'connection reset',
    });

    render(await AdminTenantsPage());

    expect(screen.getByText('data_source: error')).toBeDefined();
    expect(screen.getByText(/Error loading tenants/i)).toBeDefined();
    expect(screen.getByText(/connection reset/i)).toBeDefined();
    // Never render fabricated rows/stats alongside an error (Rule K.2).
    expect(screen.queryByText('Total Tenants')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
  });
});
