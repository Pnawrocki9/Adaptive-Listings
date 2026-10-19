/**
 * Tests for /admin/tenants/[id]/demo (staff per-tenant Archetype Simulator, FOLLOW-596).
 *
 * The page is a server component that:
 *   - validates `[id]` via the exported `tenantExists` (same fence as the API
 *     staff-override path) and renders `notFound()` (404) on an unknown tenant,
 *   - fails closed: when `tenantExists` itself cannot run it throws, the error propagates to the
 *     route error boundary and the page NEVER renders as "found" (and never as a 404), and
 *   - renders `StaffDemoOverrideEditor` with `tenantId={id}` on a known tenant.
 *
 * `tenantExists` and the editor are mocked so the test exercises the page's own control flow
 * (existence gate + heading + prop wiring), not DB or fetch. The editor has its own tests.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/demo/page.test
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('@/lib/session-auth', () => ({
  tenantExists: vi.fn(),
}));

// notFound() throws in Next.js to halt rendering — mirror that here.
const NOT_FOUND = new Error('NEXT_NOT_FOUND');
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));

vi.mock('./demo-override-editor', () => ({
  StaffDemoOverrideEditor: ({ tenantId }: { tenantId?: string }) => (
    <div data-testid="demo-override-editor">tenant:{tenantId ?? 'none'}</div>
  ),
}));

import { tenantExists } from '@/lib/session-auth';
import { notFound } from 'next/navigation';
import StaffTenantDemoPage from './page';

const mockTenantExists = vi.mocked(tenantExists);
const mockNotFound = vi.mocked(notFound);

const KNOWN_TENANT = '11111111-1111-4111-8111-111111111111';
const UNKNOWN_TENANT = '99999999-9999-4999-8999-999999999999';

describe('StaffTenantDemoPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders notFound() (404) when the tenant does not exist, without mounting the editor', async () => {
    mockTenantExists.mockResolvedValue(false);

    await expect(
      StaffTenantDemoPage({ params: Promise.resolve({ id: UNKNOWN_TENANT }) }),
    ).rejects.toBe(NOT_FOUND);

    expect(mockTenantExists).toHaveBeenCalledWith(UNKNOWN_TENANT);
    expect(mockNotFound).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('demo-override-editor')).toBeNull();
  });

  it('renders the heading, the tenant id and the editor for a known tenant', async () => {
    mockTenantExists.mockResolvedValue(true);

    render(await StaffTenantDemoPage({ params: Promise.resolve({ id: KNOWN_TENANT }) }));

    expect(mockTenantExists).toHaveBeenCalledWith(KNOWN_TENANT);
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(
      'Tenant Archetype Simulator',
    );
    expect(screen.getByText(KNOWN_TENANT)).toBeDefined();
    expect(screen.getByTestId('demo-override-editor').textContent).toBe(`tenant:${KNOWN_TENANT}`);
  });

  it('fails closed when tenant validation cannot run: the error propagates, never a 404 or a page', async () => {
    const outage = new Error('Tenant validation unavailable');
    mockTenantExists.mockRejectedValue(outage);

    await expect(
      StaffTenantDemoPage({ params: Promise.resolve({ id: KNOWN_TENANT }) }),
    ).rejects.toBe(outage);

    // A lookup failure is not "tenant does not exist": the route error boundary owns it.
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(screen.queryByTestId('demo-override-editor')).toBeNull();
  });
});
