/**
 * Tests for the /admin/registrations data layer (FOLLOW-593, Rule K.2).
 *
 * @module apps/control-plane/src/app/admin/registrations/data.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

const mockOrderBy = vi.fn();
const mockWhere = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({ select: mockSelect })),
  tenantRegistrations: {
    id: 'id',
    agencyName: 'agency_name',
    websiteUrl: 'website_url',
    contactEmail: 'contact_email',
    contactName: 'contact_name',
    country: 'country',
    listingsVolume: 'listings_volume',
    status: 'status',
    createdAt: 'created_at',
  },
  eq: vi.fn((_col: unknown, val: unknown) => ({ eq: val })),
}));

import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@estalara/db';
import { getPendingRegistrations } from './data';
import { MOCK_REGISTRATIONS } from './mock-data';

const mockCreateAdminClient = vi.mocked(createAdminClient);

const ROW = {
  id: 'reg-real-1',
  agencyName: 'Real Agency',
  websiteUrl: 'https://real.example',
  contactEmail: 'ops@real.example',
  contactName: 'Real Contact',
  country: 'Spain',
  listingsVolume: '100-1000',
  createdAt: new Date('2026-07-01T00:00:00Z'),
};

function wireChain(rows: unknown[]) {
  mockOrderBy.mockResolvedValue(rows);
  mockWhere.mockReturnValue({ orderBy: mockOrderBy });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
}

describe('getPendingRegistrations', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    wireChain([]);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('K.2 fallback: mock pending rows when DB is unconfigured', async () => {
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_DIRECT;

    const result = await getPendingRegistrations();

    expect(result.dataSource).toBe('mock');
    expect(result.registrations.length).toBe(
      MOCK_REGISTRATIONS.filter((r) => r.status === 'pending').length,
    );
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('real-data path: returns live rows with data_source "live" (mocked db)', async () => {
    process.env.DATABASE_URL_ADMIN = 'postgres://mock';
    wireChain([ROW]);

    const result = await getPendingRegistrations();

    expect(result.dataSource).toBe('live');
    expect(result.registrations).toEqual([
      {
        id: ROW.id,
        agency_name: ROW.agencyName,
        website_url: ROW.websiteUrl,
        contact_email: ROW.contactEmail,
        contact_name: ROW.contactName,
        country: ROW.country,
        listings_volume: ROW.listingsVolume,
        created_at: ROW.createdAt.toISOString(),
      },
    ]);
  });

  it('fail loud: DB configured but query throws → data_source "error", Sentry captured', async () => {
    process.env.DATABASE_URL_ADMIN = 'postgres://mock';
    mockOrderBy.mockRejectedValue(new Error('connection reset'));
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });

    const result = await getPendingRegistrations();

    expect(result.dataSource).toBe('error');
    expect(result.registrations).toEqual([]);
    expect(result.errorMessage).toContain('connection reset');
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
