/**
 * Tests for /admin/tenants/[id]/quiz-accuracy (staff quiz accuracy tab, FOLLOW-1363).
 *
 * The page is a server component that validates `[id]` with `tenantExists` (404 on an unknown
 * tenant), fails closed when that check cannot run, and renders `QuizAccuracyView` for a known
 * tenant. The view has its own suite; it is mocked here so the test covers the page's control flow.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/quiz-accuracy/page.test
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/session-auth', () => ({
  tenantExists: vi.fn(),
}));

const NOT_FOUND = new Error('NEXT_NOT_FOUND');
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
}));

vi.mock('./quiz-accuracy-view', () => ({
  QuizAccuracyView: ({ tenantId }: { tenantId?: string }) => (
    <div data-testid="quiz-accuracy-view">tenant:{tenantId ?? 'none'}</div>
  ),
}));

import { tenantExists } from '@/lib/session-auth';
import { notFound } from 'next/navigation';
import StaffTenantQuizAccuracyPage from './page';

const mockTenantExists = vi.mocked(tenantExists);
const mockNotFound = vi.mocked(notFound);

const KNOWN_TENANT = '11111111-1111-4111-8111-111111111111';
const UNKNOWN_TENANT = '99999999-9999-4999-8999-999999999999';

describe('StaffTenantQuizAccuracyPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders notFound() (404) for an unknown tenant without mounting the view', async () => {
    mockTenantExists.mockResolvedValue(false);
    await expect(
      StaffTenantQuizAccuracyPage({ params: Promise.resolve({ id: UNKNOWN_TENANT }) }),
    ).rejects.toBe(NOT_FOUND);
    expect(mockTenantExists).toHaveBeenCalledWith(UNKNOWN_TENANT);
    expect(mockNotFound).toHaveBeenCalledOnce();
    expect(screen.queryByTestId('quiz-accuracy-view')).toBeNull();
  });

  it('renders the heading, the tenant id and the view for a known tenant', async () => {
    mockTenantExists.mockResolvedValue(true);
    render(await StaffTenantQuizAccuracyPage({ params: Promise.resolve({ id: KNOWN_TENANT }) }));
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Quiz Accuracy');
    expect(screen.getByText(KNOWN_TENANT)).toBeDefined();
    expect(screen.getByTestId('quiz-accuracy-view').textContent).toBe(`tenant:${KNOWN_TENANT}`);
  });

  it('fails closed when tenant validation cannot run: the error propagates', async () => {
    const outage = new Error('Tenant validation unavailable');
    mockTenantExists.mockRejectedValue(outage);
    await expect(
      StaffTenantQuizAccuracyPage({ params: Promise.resolve({ id: KNOWN_TENANT }) }),
    ).rejects.toBe(outage);
    expect(mockNotFound).not.toHaveBeenCalled();
    expect(screen.queryByTestId('quiz-accuracy-view')).toBeNull();
  });
});
