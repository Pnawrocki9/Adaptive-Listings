/**
 * Tests for /admin/tenants/[id]/quiz (staff per-tenant quiz config, FOLLOW-595).
 *
 * The page is a server component that:
 *   - validates `[id]` via the exported `tenantExists` (same fence as the API
 *     staff-override path) and renders `notFound()` (404) on an unknown tenant, and
 *   - renders the staff {@link StaffQuizConfigEditor} with `tenantId={id}` on a known
 *     tenant.
 *
 * `tenantExists` and the editor are mocked so the test exercises the page's own
 * control flow (existence gate + prop wiring), not DB or fetch.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz/page.test
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

vi.mock('./quiz-config-editor', () => ({
  StaffQuizConfigEditor: ({ tenantId }: { tenantId?: string }) => (
    <div data-testid="quiz-config-editor">tenant:{tenantId ?? 'none'}</div>
  ),
}));

import { tenantExists } from '@/lib/session-auth';
import { notFound } from 'next/navigation';
import StaffTenantQuizPage from './page';

const mockTenantExists = vi.mocked(tenantExists);
const mockNotFound = vi.mocked(notFound);

const KNOWN_TENANT = '11111111-1111-4111-8111-111111111111';
const UNKNOWN_TENANT = '99999999-9999-4999-8999-999999999999';

describe('StaffTenantQuizPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders notFound() (404) when the tenant does not exist', async () => {
    mockTenantExists.mockResolvedValue(false);

    await expect(
      StaffTenantQuizPage({ params: Promise.resolve({ id: UNKNOWN_TENANT }) }),
    ).rejects.toBe(NOT_FOUND);

    expect(mockTenantExists).toHaveBeenCalledWith(UNKNOWN_TENANT);
    expect(mockNotFound).toHaveBeenCalledOnce();
  });

  it('renders StaffQuizConfigEditor with tenantId on a known tenant', async () => {
    mockTenantExists.mockResolvedValue(true);

    const ui = await StaffTenantQuizPage({
      params: Promise.resolve({ id: KNOWN_TENANT }),
    });
    render(ui);

    expect(mockTenantExists).toHaveBeenCalledWith(KNOWN_TENANT);
    expect(mockNotFound).not.toHaveBeenCalled();
    const editor = screen.getByTestId('quiz-config-editor');
    expect(editor).toBeDefined();
    expect(editor.textContent).toBe(`tenant:${KNOWN_TENANT}`);
    // The tenant id is also shown in the page header.
    expect(screen.getByText(KNOWN_TENANT)).toBeDefined();
  });
});
