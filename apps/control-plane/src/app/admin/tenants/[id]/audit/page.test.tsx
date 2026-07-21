/**
 * Tests for /admin/tenants/[id]/audit (staff per-tenant audit view, FOLLOW-599).
 *
 * The page is a server component that:
 *   - validates `[id]` via the exported `tenantExists` (same fence as the API
 *     staff-override path) and renders `notFound()` (404) on an unknown tenant, and
 *   - renders the read-only {@link StaffAuditView} with `tenantId={id}` on a known
 *     tenant.
 *
 * `tenantExists` and the view are mocked so the test exercises the page's own
 * control flow (existence gate + prop wiring), not DB or fetch.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/audit/page.test
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/session-auth', () => ({
  tenantExists: vi.fn(),
}));

const NOT_FOUND = new Error('NEXT_NOT_FOUND');
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));

vi.mock('./audit-view', () => ({
  StaffAuditView: ({ tenantId }: { tenantId?: string }) => (
    <div data-testid="audit-view">tenant:{tenantId ?? 'none'}</div>
  ),
}));

import { tenantExists } from '@/lib/session-auth';
import { notFound } from 'next/navigation';
import StaffTenantAuditPage from './page';

const mockTenantExists = vi.mocked(tenantExists);
const mockNotFound = vi.mocked(notFound);

const KNOWN_TENANT = '11111111-1111-4111-8111-111111111111';
const UNKNOWN_TENANT = '99999999-9999-4999-8999-999999999999';

describe('StaffTenantAuditPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders notFound() (404) when the tenant does not exist', async () => {
    mockTenantExists.mockResolvedValue(false);

    await expect(
      StaffTenantAuditPage({ params: Promise.resolve({ id: UNKNOWN_TENANT }) }),
    ).rejects.toBe(NOT_FOUND);

    expect(mockTenantExists).toHaveBeenCalledWith(UNKNOWN_TENANT);
    expect(mockNotFound).toHaveBeenCalledOnce();
  });

  it('renders StaffAuditView with tenantId on a known tenant', async () => {
    mockTenantExists.mockResolvedValue(true);

    const ui = await StaffTenantAuditPage({
      params: Promise.resolve({ id: KNOWN_TENANT }),
    });
    render(ui);

    expect(mockTenantExists).toHaveBeenCalledWith(KNOWN_TENANT);
    expect(mockNotFound).not.toHaveBeenCalled();
    const view = screen.getByTestId('audit-view');
    expect(view).toBeDefined();
    expect(view.textContent).toBe(`tenant:${KNOWN_TENANT}`);
    expect(screen.getByText(KNOWN_TENANT)).toBeDefined();
  });
});
