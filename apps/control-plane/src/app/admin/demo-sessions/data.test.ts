/**
 * Tests for the /admin/demo-sessions data layer (FOLLOW-593, Rule K.2).
 *
 * Coverage includes the derived-status logic (revoked / expired / active)
 * and the tenant-name left-join fallback for an orphaned session.
 *
 * @module apps/control-plane/src/app/admin/demo-sessions/data.test
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

const mockLimit = vi.fn();
const mockOrderBy = vi.fn();
const mockLeftJoin = vi.fn();
const mockFrom = vi.fn();
const mockSelect = vi.fn();

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(() => ({ select: mockSelect })),
  demoSessions: {
    id: 'id',
    tenantId: 'tenant_id',
    scope: 'scope',
    visibility: 'visibility',
    duration: 'duration',
    createdAt: 'created_at',
    expiresAt: 'expires_at',
    revokedAt: 'revoked_at',
  },
  tenants: { id: 'id', name: 'name' },
  eq: vi.fn((_col: unknown, val: unknown) => ({ eq: val })),
}));

import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@estalara/db';
import { getDemoSessionsList } from './data';
import { MOCK_DEMO_SESSIONS } from './mock-data';

const mockCreateAdminClient = vi.mocked(createAdminClient);

const NOW = new Date('2026-07-20T12:00:00Z');

function wireChain(rows: unknown[]) {
  mockLimit.mockResolvedValue(rows);
  mockOrderBy.mockReturnValue({ limit: mockLimit });
  mockLeftJoin.mockReturnValue({ orderBy: mockOrderBy });
  mockFrom.mockReturnValue({ leftJoin: mockLeftJoin });
  mockSelect.mockReturnValue({ from: mockFrom });
}

describe('getDemoSessionsList', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    wireChain([]);
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.useRealTimers();
  });

  it('K.2 fallback: mock sessions when DB is unconfigured', async () => {
    delete process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_DIRECT;

    const result = await getDemoSessionsList();

    expect(result.dataSource).toBe('mock');
    expect(result.sessions.length).toBe(MOCK_DEMO_SESSIONS.length);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('real-data path: derives "active" when not revoked and not yet expired', async () => {
    process.env.DATABASE_URL_ADMIN = 'postgres://mock';
    wireChain([
      {
        id: 'ds-1',
        tenantName: 'Real Tenant',
        scope: 'production',
        visibility: 'self',
        duration: '24h',
        createdAt: new Date('2026-07-20T10:00:00Z'),
        expiresAt: new Date('2026-07-21T10:00:00Z'),
        revokedAt: null,
      },
    ]);

    const result = await getDemoSessionsList();

    expect(result.dataSource).toBe('live');
    expect(result.sessions[0]?.status).toBe('active');
    expect(result.sessions[0]?.tenant_name).toBe('Real Tenant');
  });

  it('real-data path: derives "revoked" when revoked_at is set (even if not yet expired)', async () => {
    process.env.DATABASE_URL_ADMIN = 'postgres://mock';
    wireChain([
      {
        id: 'ds-2',
        tenantName: 'Real Tenant',
        scope: 'mockup',
        visibility: 'self',
        duration: 'session',
        createdAt: new Date('2026-07-20T09:00:00Z'),
        expiresAt: new Date('2026-07-21T09:00:00Z'),
        revokedAt: new Date('2026-07-20T11:00:00Z'),
      },
    ]);

    const result = await getDemoSessionsList();

    expect(result.sessions[0]?.status).toBe('revoked');
  });

  it('real-data path: derives "expired" when expires_at is in the past and not revoked', async () => {
    process.env.DATABASE_URL_ADMIN = 'postgres://mock';
    wireChain([
      {
        id: 'ds-3',
        tenantName: 'Real Tenant',
        scope: 'mockup',
        visibility: 'self',
        duration: 'session',
        createdAt: new Date('2026-07-19T09:00:00Z'),
        expiresAt: new Date('2026-07-20T09:00:00Z'),
        revokedAt: null,
      },
    ]);

    const result = await getDemoSessionsList();

    expect(result.sessions[0]?.status).toBe('expired');
  });

  it('real-data path: falls back to "(unknown tenant)" when the join finds no tenant row', async () => {
    process.env.DATABASE_URL_ADMIN = 'postgres://mock';
    wireChain([
      {
        id: 'ds-4',
        tenantName: null,
        scope: 'mockup',
        visibility: 'self',
        duration: 'session',
        createdAt: new Date('2026-07-20T09:00:00Z'),
        expiresAt: new Date('2026-07-21T09:00:00Z'),
        revokedAt: null,
      },
    ]);

    const result = await getDemoSessionsList();

    expect(result.sessions[0]?.tenant_name).toBe('(unknown tenant)');
  });

  it('fail loud: DB configured but query throws → data_source "error", Sentry captured', async () => {
    process.env.DATABASE_URL_ADMIN = 'postgres://mock';
    mockLimit.mockRejectedValue(new Error('connection reset'));
    mockOrderBy.mockReturnValue({ limit: mockLimit });
    mockLeftJoin.mockReturnValue({ orderBy: mockOrderBy });
    mockFrom.mockReturnValue({ leftJoin: mockLeftJoin });
    mockSelect.mockReturnValue({ from: mockFrom });

    const result = await getDemoSessionsList();

    expect(result.dataSource).toBe('error');
    expect(result.sessions).toEqual([]);
    expect(result.errorMessage).toContain('connection reset');
    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
  });
});
