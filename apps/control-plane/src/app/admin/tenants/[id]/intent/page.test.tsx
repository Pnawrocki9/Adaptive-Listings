/**
 * Tests for /admin/tenants/[id]/intent (staff per-tenant intent weights editor,
 * FOLLOW-597).
 *
 * The page is a server component that:
 *   - validates `[id]` via the exported `tenantExists` (same fence as the API
 *     staff-override path) and renders `notFound()` (404) on an unknown tenant, and
 *   - renders the staff {@link StaffIntentWeightsEditor} with `tenantId={id}` on a
 *     known tenant.
 *
 * `tenantExists` and the editor are mocked so the test exercises the page's own
 * control flow (existence gate + prop wiring), not DB or fetch.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/intent/page.test
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

vi.mock('./intent-weights-editor', () => ({
  StaffIntentWeightsEditor: ({ tenantId }: { tenantId?: string }) => (
    <div data-testid="intent-weights-editor">tenant:{tenantId ?? 'none'}</div>
  ),
}));

import { tenantExists } from '@/lib/session-auth';
import { notFound } from 'next/navigation';
import StaffTenantIntentPage from './page';

const mockTenantExists = vi.mocked(tenantExists);
const mockNotFound = vi.mocked(notFound);

const KNOWN_TENANT = '11111111-1111-4111-8111-111111111111';
const UNKNOWN_TENANT = '99999999-9999-4999-8999-999999999999';

describe('StaffTenantIntentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders notFound() (404) when the tenant does not exist', async () => {
    mockTenantExists.mockResolvedValue(false);

    await expect(
      StaffTenantIntentPage({ params: Promise.resolve({ id: UNKNOWN_TENANT }) }),
    ).rejects.toBe(NOT_FOUND);

    expect(mockTenantExists).toHaveBeenCalledWith(UNKNOWN_TENANT);
    expect(mockNotFound).toHaveBeenCalledOnce();
  });

  it('renders StaffIntentWeightsEditor with tenantId on a known tenant', async () => {
    mockTenantExists.mockResolvedValue(true);

    const ui = await StaffTenantIntentPage({
      params: Promise.resolve({ id: KNOWN_TENANT }),
    });
    render(ui);

    expect(mockTenantExists).toHaveBeenCalledWith(KNOWN_TENANT);
    expect(mockNotFound).not.toHaveBeenCalled();
    const editor = screen.getByTestId('intent-weights-editor');
    expect(editor).toBeDefined();
    expect(editor.textContent).toBe(`tenant:${KNOWN_TENANT}`);
    expect(screen.getByText(KNOWN_TENANT)).toBeDefined();
  });
});
