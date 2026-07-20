/**
 * Tests for /admin/tenants/[id]/analytics (staff per-tenant analytics, FOLLOW-594).
 *
 * The page is a server component that:
 *   - validates `[id]` via the exported `tenantExists` (same fence as the API
 *     staff-override path) and renders `notFound()` (404) on an unknown tenant, and
 *   - renders the shared `AnalyticsView` with `tenantId={id}` on a known tenant.
 *
 * `tenantExists` and `AnalyticsView` are mocked so the test exercises the page's
 * own control flow (existence gate + prop wiring), not ClickHouse/DB.
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

import { tenantExists } from '@/lib/session-auth';
import { notFound } from 'next/navigation';
import StaffTenantAnalyticsPage from './page';

const mockTenantExists = vi.mocked(tenantExists);
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
  });

  it('renders AnalyticsView with tenantId on a known tenant', async () => {
    mockTenantExists.mockResolvedValue(true);

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
});
