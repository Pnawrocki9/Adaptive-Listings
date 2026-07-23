/**
 * Tests for /admin/tenants/[id]/settings (staff per-tenant settings, FOLLOW-600).
 *
 * The page is a server component that:
 *   - validates `[id]` via the exported `tenantExists` (same fence as the API
 *     staff-override path) and renders `notFound()` (404) on an unknown tenant, and
 *   - renders {@link StaffTenantConfigEditor} with `tenantId={id}` on a known tenant.
 *
 * The MANDATORY "no generation-model control renders here" assertion (CEO Q1,
 * ADR-0018 §5) lives in `tenant-config-editor.test.tsx`, exercised against the
 * REAL (un-mocked) editor component — this file mocks the editor to test only the
 * page's own control flow (existence gate + prop wiring), matching
 * `/admin/tenants/[id]/quiz/page.test.tsx`.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/settings/page.test
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

vi.mock('./tenant-config-editor', () => ({
  StaffTenantConfigEditor: ({ tenantId }: { tenantId?: string }) => (
    <div data-testid="tenant-config-editor">tenant:{tenantId ?? 'none'}</div>
  ),
}));

import { tenantExists } from '@/lib/session-auth';
import { notFound } from 'next/navigation';
import StaffTenantSettingsPage from './page';

const mockTenantExists = vi.mocked(tenantExists);
const mockNotFound = vi.mocked(notFound);

const KNOWN_TENANT = '11111111-1111-4111-8111-111111111111';
const UNKNOWN_TENANT = '99999999-9999-4999-8999-999999999999';

describe('StaffTenantSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders notFound() (404) when the tenant does not exist', async () => {
    mockTenantExists.mockResolvedValue(false);

    await expect(
      StaffTenantSettingsPage({ params: Promise.resolve({ id: UNKNOWN_TENANT }) }),
    ).rejects.toBe(NOT_FOUND);

    expect(mockTenantExists).toHaveBeenCalledWith(UNKNOWN_TENANT);
    expect(mockNotFound).toHaveBeenCalledOnce();
  });

  it('renders StaffTenantConfigEditor with tenantId on a known tenant', async () => {
    mockTenantExists.mockResolvedValue(true);

    const ui = await StaffTenantSettingsPage({
      params: Promise.resolve({ id: KNOWN_TENANT }),
    });
    render(ui);

    expect(mockTenantExists).toHaveBeenCalledWith(KNOWN_TENANT);
    expect(mockNotFound).not.toHaveBeenCalled();
    const editor = screen.getByTestId('tenant-config-editor');
    expect(editor).toBeDefined();
    expect(editor.textContent).toBe(`tenant:${KNOWN_TENANT}`);
    // The tenant id is also shown in the page header.
    expect(screen.getByText(KNOWN_TENANT)).toBeDefined();
  });
});
