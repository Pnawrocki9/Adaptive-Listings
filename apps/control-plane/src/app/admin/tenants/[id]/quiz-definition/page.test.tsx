/**
 * Tests for /admin/tenants/[id]/quiz-definition (staff per-tenant quiz definition editor, FOLLOW-639).
 *
 * The page is a server component that:
 *   - validates `[id]` via the exported `tenantExists` (same fence as the API
 *     staff-override path) and renders `notFound()` (404) on an unknown tenant,
 *   - fails closed: when `tenantExists` itself cannot run it throws, the error propagates to the
 *     route error boundary and the page NEVER renders as "found" (and never as a 404), and
 *   - renders `StaffQuizDefinitionEditor` with `tenantId={id}` on a known tenant.
 *
 * `tenantExists` and the editor are mocked so the test exercises the page's own control flow
 * (existence gate + heading + prop wiring), not DB or fetch. The editor has its own tests.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-definition/page.test
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

vi.mock('./quiz-definition-editor', () => ({
  StaffQuizDefinitionEditor: ({ tenantId }: { tenantId?: string }) => (
    <div data-testid="quiz-definition-editor">tenant:{tenantId ?? 'none'}</div>
  ),
}));

import { tenantExists } from '@/lib/session-auth';
import { notFound } from 'next/navigation';
import StaffTenantQuizDefinitionPage from './page';

const mockTenantExists = vi.mocked(tenantExists);
const mockNotFound = vi.mocked(notFound);

const KNOWN_TENANT = '11111111-1111-4111-8111-111111111111';
const UNKNOWN_TENANT = '99999999-9999-4999-8999-999999999999';

describe('StaffTenantQuizDefinitionPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders notFound() (404) when the tenant does not exist, without mounting the editor', async () => {
    mockTenantExists.mockResolvedValue(false);

    await expect(
      StaffTenantQuizDefinitionPage({ params: Promise.resolve({ id: UNKNOWN_TENANT }) }),
    ).rejects.toBe(NOT_FOUND);

    expect(mockTenantExists).toHaveBeenCalledWith(UNKNOWN_TENANT);
    expect(mockNotFound).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('quiz-definition-editor')).toBeNull();
  });

  it('renders the heading, the tenant id and the editor for a known tenant', async () => {
    mockTenantExists.mockResolvedValue(true);

    render(await StaffTenantQuizDefinitionPage({ params: Promise.resolve({ id: KNOWN_TENANT }) }));

    expect(mockTenantExists).toHaveBeenCalledWith(KNOWN_TENANT);
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Tenant Quiz Definition');
    expect(screen.getByText(KNOWN_TENANT)).toBeDefined();
    expect(screen.getByTestId('quiz-definition-editor').textContent).toBe(`tenant:${KNOWN_TENANT}`);
  });

  it('fails closed when tenant validation cannot run: the error propagates, never a 404 or a page', async () => {
    const outage = new Error('Tenant validation unavailable');
    mockTenantExists.mockRejectedValue(outage);

    await expect(
      StaffTenantQuizDefinitionPage({ params: Promise.resolve({ id: KNOWN_TENANT }) }),
    ).rejects.toBe(outage);

    // A lookup failure is not "tenant does not exist": the route error boundary owns it.
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(screen.queryByTestId('quiz-definition-editor')).toBeNull();
  });
});
