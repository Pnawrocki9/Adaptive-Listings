/**
 * Tests for the `/admin/tenants` data layer (FOLLOW-593, Rule K.2).
 *
 * Coverage:
 *   - getTenantsList: DB-unconfigured mock fallback (data_source 'mock')
 *   - getTenantsList: live query success (data_source 'live', real rows, mocked db)
 *   - getTenantsList: DB configured but query throws → fail loud (data_source 'error',
 *     empty list, Sentry captured, NEVER falls back to mock)
 *
 * @module apps/control-plane/src/app/admin/tenants/data.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ── Mock @sentry/nextjs ────────────────────────────────────────────────────────
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

// ── Mock @estalara/db ──────────────────────────────────────────────────────────
const mockLimit = vi.fn();
const mockOrderBy = vi.fn();
const mockWhere = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({ select: mockSelect })),
  tenants: {
    id: 'id',
    name: 'name',
    plan: 'plan',
    status: 'status',
    createdAt: 'created_at',
    profileModeEnabled: 'profile_mode_enabled',
    deletedAt: 'deleted_at',
  },
}));

import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@estalara/db';
import { getTenantsList } from './data';
import { MOCK_TENANTS } from './mock-data';

const mockCreateAdminClient = vi.mocked(createAdminClient);

const ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Real Tenant Co',
  plan: 'growth',
  status: 'active',
  createdAt: new Date('2026-07-01T00:00:00Z'),
  profileModeEnabled: false,
};

function wireChain(rows: unknown[]) {
  mockLimit.mockResolvedValue(rows);
  mockOrderBy.mockResolvedValue(rows); // list path ends at .orderBy(), no .limit()
  mockWhere.mockReturnValue({ orderBy: mockOrderBy, limit: mockLimit });
  mockFrom.mockReturnValue({ where: mockWhere });
  mockSelect.mockReturnValue({ from: mockFrom });
}

describe('getTenantsList', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    wireChain([]);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('K.2 fallback: returns mock rows with data_source "mock" when DB is unconfigured', async () => {
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_DIRECT;

    const result = await getTenantsList();

    expect(result.dataSource).toBe('mock');
    expect(result.tenants.length).toBe(MOCK_TENANTS.length);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('real-data path: returns live rows with data_source "live" (mocked db)', async () => {
    process.env.DATABASE_URL_ADMIN = 'postgres://mock';
    wireChain([ROW]);

    const result = await getTenantsList();

    expect(result.dataSource).toBe('live');
    expect(result.tenants).toEqual([
      {
        id: ROW.id,
        name: ROW.name,
        plan: ROW.plan,
        status: ROW.status,
        createdAt: ROW.createdAt.toISOString(),
        profileModeEnabled: ROW.profileModeEnabled,
      },
    ]);
    expect(mockCreateAdminClient).toHaveBeenCalledTimes(1);
  });

  it('fail loud: DB configured but query throws → data_source "error", empty list, Sentry captured', async () => {
    process.env.DATABASE_URL_ADMIN = 'postgres://mock';
    mockOrderBy.mockRejectedValue(new Error('connection reset'));
    mockWhere.mockReturnValue({ orderBy: mockOrderBy, limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });

    const result = await getTenantsList();

    expect(result.dataSource).toBe('error');
    expect(result.tenants).toEqual([]);
    expect(result.errorMessage).toContain('connection reset');
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
