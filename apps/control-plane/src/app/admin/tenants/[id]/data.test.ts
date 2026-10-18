/**
 * Tests for the `/admin/tenants/[id]` hub data layer (FOLLOW-593, Rule K.2; moved by FOLLOW-1329).
 *
 * Coverage:
 *   - getTenantById: mock lookup hit/miss when DB unconfigured
 *   - getTenantById: live lookup hit/miss when DB configured (mocked db)
 *   - getTenantById: malformed id never reaches the DB when configured
 *   - getTenantById: DB configured but query throws → fail loud (data_source 'error')
 *
 * @module apps/control-plane/src/app/admin/tenants/[id]/data.test
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
import { getTenantById } from './data';
import { MOCK_TENANTS } from '../mock-data';

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

describe('getTenantById', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    wireChain([]);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('K.2 fallback: finds a mock tenant by id when DB is unconfigured', async () => {
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_DIRECT;

    const target = MOCK_TENANTS[0]!;
    const result = await getTenantById(target.id);

    expect(result.dataSource).toBe('mock');
    expect(result.tenant?.id).toBe(target.id);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('K.2 fallback: unknown mock id → tenant null, no DB call', async () => {
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_DIRECT;

    const result = await getTenantById('does-not-exist');

    expect(result.dataSource).toBe('mock');
    expect(result.tenant).toBeNull();
  });

  it('real-data path: finds a live tenant by id (mocked db)', async () => {
    process.env.DATABASE_URL_ADMIN = 'postgres://mock';
    mockLimit.mockResolvedValue([ROW]);
    mockWhere.mockReturnValue({ orderBy: mockOrderBy, limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });

    const result = await getTenantById(ROW.id);

    expect(result.dataSource).toBe('live');
    expect(result.tenant?.id).toBe(ROW.id);
    expect(mockCreateAdminClient).toHaveBeenCalledTimes(1);
  });

  it('real-data path: unknown live id → tenant null (not an error)', async () => {
    process.env.DATABASE_URL_ADMIN = 'postgres://mock';
    mockLimit.mockResolvedValue([]);
    mockWhere.mockReturnValue({ orderBy: mockOrderBy, limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });

    const result = await getTenantById('22222222-2222-2222-2222-222222222222');

    expect(result.dataSource).toBe('live');
    expect(result.tenant).toBeNull();
  });

  it('malformed id never reaches the DB when configured', async () => {
    process.env.DATABASE_URL_ADMIN = 'postgres://mock';

    const result = await getTenantById('not-a-uuid');

    expect(result.dataSource).toBe('live');
    expect(result.tenant).toBeNull();
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('fail loud: DB configured but query throws → data_source "error", Sentry captured', async () => {
    process.env.DATABASE_URL_ADMIN = 'postgres://mock';
    mockLimit.mockRejectedValue(new Error('timeout'));
    mockWhere.mockReturnValue({ orderBy: mockOrderBy, limit: mockLimit });
    mockFrom.mockReturnValue({ where: mockWhere });
    mockSelect.mockReturnValue({ from: mockFrom });

    const result = await getTenantById(ROW.id);

    expect(result.dataSource).toBe('error');
    expect(result.tenant).toBeNull();
    expect(result.errorMessage).toContain('timeout');
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
