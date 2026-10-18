/**
 * Tests for /admin/tenants/[id]/analytics (staff per-tenant analytics, FOLLOW-594).
 *
 * The page is a server component that:
 *   - validates `[id]` via the exported `tenantExists` (same fence as the API
 *     staff-override path) and renders `notFound()` (404) on an unknown tenant, and
 *   - renders the shared `AnalyticsView` with `tenantId={id}` on a known tenant, and
 *   - (FOLLOW-1330) renders the decision-telemetry panels from `getTenantAnalyticsRollup(id)` —
 *     the scoring-path / reorder-withheld panels moved here from the removed `/admin/analytics`.
 *
 * `tenantExists`, `AnalyticsView`, the rollup data layer and the panels are mocked so the test
 * exercises the page's own control flow (existence gate + prop wiring), not ClickHouse/DB.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/analytics/page.test
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/session-auth', () => ({
  tenantExists: vi.fn(),
}));

// notFound() throws in Next.js to halt rendering — mirror that here so the test
// can assert the page short-circuits on an unknown tenant.
const NOT_FOUND = new Error('NEXT_NOT_FOUND');
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));

// Stub the heavy client component — we only assert it is mounted with the tenantId.
vi.mock('@/components/analytics/analytics-view', () => ({
  AnalyticsView: ({ tenantId }: { tenantId?: string }) => (
    <div data-testid="analytics-view">tenant:{tenantId ?? 'none'}</div>
  ),
}));

vi.mock('@/app/api/admin/analytics/rollup/data', () => ({
  getTenantAnalyticsRollup: vi.fn(),
}));

vi.mock('@/components/analytics/decision-telemetry-panels', () => ({
  DecisionTelemetryPanels: ({
    result,
  }: {
    result: { ok: boolean; data?: { tenant_id: string } };
  }) => (
    <div data-testid="decision-telemetry">
      {result.ok ? `telemetry:${result.data?.tenant_id ?? ''}` : 'telemetry:error'}
    </div>
  ),
}));

import { tenantExists } from '@/lib/session-auth';
import { notFound } from 'next/navigation';
import { getTenantAnalyticsRollup } from '@/app/api/admin/analytics/rollup/data';
import type { TenantAnalyticsRollup } from '@/app/api/admin/analytics/rollup/data';
import StaffTenantAnalyticsPage from './page';

const mockTenantExists = vi.mocked(tenantExists);
const mockGetRollup = vi.mocked(getTenantAnalyticsRollup);
const mockNotFound = vi.mocked(notFound);

const KNOWN_TENANT = '11111111-1111-4111-8111-111111111111';
const UNKNOWN_TENANT = '99999999-9999-4999-8999-999999999999';

describe('StaffTenantAnalyticsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders notFound() (404) when the tenant does not exist', async () => {
    mockTenantExists.mockResolvedValue(false);

    await expect(
      StaffTenantAnalyticsPage({ params: Promise.resolve({ id: UNKNOWN_TENANT }) }),
    ).rejects.toBe(NOT_FOUND);

    expect(mockTenantExists).toHaveBeenCalledWith(UNKNOWN_TENANT);
    expect(mockNotFound).toHaveBeenCalledOnce();
    // The gate runs first: an unknown tenant never reaches the analytics stores.
    expect(mockGetRollup).not.toHaveBeenCalled();
  });

  it('renders AnalyticsView with tenantId on a known tenant', async () => {
    mockTenantExists.mockResolvedValue(true);
    mockGetRollup.mockResolvedValue({
      ok: true,
      data: { tenant_id: KNOWN_TENANT } as TenantAnalyticsRollup,
    });

    const ui = await StaffTenantAnalyticsPage({
      params: Promise.resolve({ id: KNOWN_TENANT }),
    });
    render(ui);

    expect(mockTenantExists).toHaveBeenCalledWith(KNOWN_TENANT);
    expect(mockNotFound).not.toHaveBeenCalled();
    const view = screen.getByTestId('analytics-view');
    expect(view).toBeDefined();
    expect(view.textContent).toBe(`tenant:${KNOWN_TENANT}`);
    // The tenant id is also shown in the page header.
    expect(screen.getByText(KNOWN_TENANT)).toBeDefined();
  });

  it('FOLLOW-1330: renders the decision-telemetry panels from the rollup of THIS tenant', async () => {
    mockTenantExists.mockResolvedValue(true);
    mockGetRollup.mockResolvedValue({
      ok: true,
      data: { tenant_id: KNOWN_TENANT } as TenantAnalyticsRollup,
    });

    render(await StaffTenantAnalyticsPage({ params: Promise.resolve({ id: KNOWN_TENANT }) }));

    expect(mockGetRollup).toHaveBeenCalledWith(KNOWN_TENANT);
    expect(screen.getByTestId('decision-telemetry').textContent).toBe(`telemetry:${KNOWN_TENANT}`);
  });

  it('FOLLOW-1330: a failed rollup is handed to the panels (they render the error), not thrown', async () => {
    mockTenantExists.mockResolvedValue(true);
    mockGetRollup.mockResolvedValue({ ok: false, status: 500, error: 'boom' });

    render(await StaffTenantAnalyticsPage({ params: Promise.resolve({ id: KNOWN_TENANT }) }));

    expect(screen.getByTestId('analytics-view')).toBeDefined();
    expect(screen.getByTestId('decision-telemetry').textContent).toBe('telemetry:error');
  });
});
