/**
 * Tests for /admin/tenants/[id]/listings/[listingId]/answers (staff FAQ answers, FOLLOW-1334).
 *
 * The page validates `[id]` via `tenantExists` (404 on unknown, before anything is mounted) and
 * mounts the shared ListingAnswersManager with the tenant and the DECODED listing id. The manager's
 * own load / empty / error / write states are covered in `components/listing-answers-manager.test`.
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/listings/[listingId]/answers/page.test
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
}));

vi.mock('@/components/listing-answers-manager', () => ({
  ListingAnswersManager: ({ tenantId, listingId }: { tenantId: string; listingId: string }) => (
    <div data-testid="answers-manager">
      {tenantId}|{listingId}
    </div>
  ),
}));

import { tenantExists } from '@/lib/session-auth';
import { notFound } from 'next/navigation';
import StaffListingAnswersPage from './page';

const mockTenantExists = vi.mocked(tenantExists);
const mockNotFound = vi.mocked(notFound);

const KNOWN_TENANT = '11111111-1111-4111-8111-111111111111';
const UNKNOWN_TENANT = '99999999-9999-4999-8999-999999999999';

describe('StaffListingAnswersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders notFound() (404) when the tenant does not exist', async () => {
    mockTenantExists.mockResolvedValue(false);

    await expect(
      StaffListingAnswersPage({
        params: Promise.resolve({ id: UNKNOWN_TENANT, listingId: 'L-1' }),
      }),
    ).rejects.toBe(NOT_FOUND);

    expect(mockTenantExists).toHaveBeenCalledWith(UNKNOWN_TENANT);
    expect(mockNotFound).toHaveBeenCalledOnce();
  });

  it('mounts the manager with the tenant and the decoded listing id', async () => {
    mockTenantExists.mockResolvedValue(true);

    render(
      await StaffListingAnswersPage({
        params: Promise.resolve({ id: KNOWN_TENANT, listingId: 'a%2Fb%20c' }),
      }),
    );

    expect(screen.getByTestId('answers-manager').textContent).toBe(`${KNOWN_TENANT}|a/b c`);
  });

  it('a malformed percent-escape is used as typed instead of throwing', async () => {
    mockTenantExists.mockResolvedValue(true);

    render(
      await StaffListingAnswersPage({
        params: Promise.resolve({ id: KNOWN_TENANT, listingId: '100%' }),
      }),
    );

    expect(screen.getByTestId('answers-manager').textContent).toBe(`${KNOWN_TENANT}|100%`);
  });
});
