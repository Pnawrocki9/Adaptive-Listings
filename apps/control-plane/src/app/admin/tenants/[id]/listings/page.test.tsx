/**
 * Tests for /admin/tenants/[id]/listings (staff listings index, FOLLOW-1334).
 *
 * The page validates `[id]` via `tenantExists` (404 on unknown), reads the listings that carry FAQ
 * answers, and renders: the list (links into the per-listing manager), an empty state, or — on a
 * failed lookup — a visible error banner instead of an empty list (Rule K.2).
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/listings/page.test
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/session-auth', () => ({ tenantExists: vi.fn() }));

const NOT_FOUND = new Error('NEXT_NOT_FOUND');
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw NOT_FOUND;
  }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('./data', () => ({ getListingAnswerSummaries: vi.fn() }));

vi.mock('./open-listing-form', () => ({
  OpenListingForm: ({ tenantId }: { tenantId: string }) => (
    <div data-testid="open-listing-form">form:{tenantId}</div>
  ),
}));

import { tenantExists } from '@/lib/session-auth';
import { notFound } from 'next/navigation';
import { getListingAnswerSummaries } from './data';
import StaffTenantListingsPage from './page';

const mockTenantExists = vi.mocked(tenantExists);
const mockSummaries = vi.mocked(getListingAnswerSummaries);
const mockNotFound = vi.mocked(notFound);

const KNOWN_TENANT = '11111111-1111-4111-8111-111111111111';
const UNKNOWN_TENANT = '99999999-9999-4999-8999-999999999999';

describe('StaffTenantListingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders notFound() (404) for an unknown tenant, before reading any listings', async () => {
    mockTenantExists.mockResolvedValue(false);

    await expect(
      StaffTenantListingsPage({ params: Promise.resolve({ id: UNKNOWN_TENANT }) }),
    ).rejects.toBe(NOT_FOUND);

    expect(mockTenantExists).toHaveBeenCalledWith(UNKNOWN_TENANT);
    expect(mockNotFound).toHaveBeenCalledOnce();
    expect(mockSummaries).not.toHaveBeenCalled();
  });

  it('lists the tenant’s listings with links into the answers manager', async () => {
    mockTenantExists.mockResolvedValue(true);
    mockSummaries.mockResolvedValue({
      ok: true,
      listings: [
        { listingId: 'L-1', answerCount: 3, lastUpdatedAt: '2026-10-02T10:00:00.000Z' },
        { listingId: 'a b', answerCount: 1, lastUpdatedAt: null },
      ],
    });

    render(await StaffTenantListingsPage({ params: Promise.resolve({ id: KNOWN_TENANT }) }));

    expect(mockSummaries).toHaveBeenCalledWith(KNOWN_TENANT);
    expect(screen.getByTestId('open-listing-form').textContent).toBe(`form:${KNOWN_TENANT}`);
    expect(screen.getByRole('link', { name: 'L-1' }).getAttribute('href')).toBe(
      `/admin/tenants/${KNOWN_TENANT}/listings/L-1/answers`,
    );
    // The id is percent-encoded into the path.
    expect(screen.getByRole('link', { name: 'a b' }).getAttribute('href')).toBe(
      `/admin/tenants/${KNOWN_TENANT}/listings/a%20b/answers`,
    );
    expect(screen.getByText(/3 answers/)).toBeDefined();
    expect(screen.getByText(/1 answer(?!s)/)).toBeDefined();
  });

  it('renders the empty state when no listing has answers', async () => {
    mockTenantExists.mockResolvedValue(true);
    mockSummaries.mockResolvedValue({ ok: true, listings: [] });

    render(await StaffTenantListingsPage({ params: Promise.resolve({ id: KNOWN_TENANT }) }));

    expect(screen.getByText(/No listing has FAQ answers yet/)).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a failed lookup renders an error banner, NOT the empty state (Rule K.2)', async () => {
    mockTenantExists.mockResolvedValue(true);
    mockSummaries.mockResolvedValue({ ok: false, error: 'connection refused' });

    render(await StaffTenantListingsPage({ params: Promise.resolve({ id: KNOWN_TENANT }) }));

    expect(screen.getByRole('alert').textContent).toContain('connection refused');
    expect(screen.queryByText(/No listing has FAQ answers yet/)).toBeNull();
  });
});
