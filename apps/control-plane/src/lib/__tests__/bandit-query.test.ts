/**
 * Unit tests for bandit-query.ts — FOLLOW-007.
 *
 * Coverage:
 *  - Returns BanditArm[] from DB rows correctly mapped
 *  - Auto-seeds 3 rows (control / v1 / v2) when DB returns empty
 *  - Upsert uses onConflictDoNothing (idempotent re-seed)
 *  - No-op (returns []) when DATABASE_URL_ADMIN and DATABASE_URL_DIRECT are unset
 *  - DB error swallowed — returns []
 *
 * @module apps/control-plane/src/lib/__tests__/bandit-query.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock @estalara/db before import ─────────────────────────────────────────
const { mockOnConflictDoNothing, mockInsertValues, mockInsert, mockWhere, mockCreateAdminClient } =
  vi.hoisted(() => {
    const mockOnConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const mockInsertValues = vi
      .fn()
      .mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });
    const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });
    // db.select().from().where() resolves directly to an array of rows.
    const mockWhere = vi.fn().mockResolvedValue([]);
    const mockFrom = vi.fn().mockReturnValue({ where: mockWhere });
    const mockSelect = vi.fn().mockReturnValue({ from: mockFrom });
    const mockCreateAdminClient = vi.fn(() => ({ select: mockSelect, insert: mockInsert }));
    return {
      mockOnConflictDoNothing,
      mockInsertValues,
      mockInsert,
      mockWhere,
      mockCreateAdminClient,
    };
  });

vi.mock('@estalara/db', () => ({
  createAdminClient: mockCreateAdminClient,
  abBanditWeights: {
    tenantId: 'tenant_id',
    archetype: 'archetype',
    variant: 'variant',
    alpha: 'alpha',
    beta: 'beta',
    paused: 'paused',
  },
}));

vi.mock('drizzle-orm', () => ({
  and: vi.fn((...preds: unknown[]) => ({ kind: 'and', preds })),
  eq: vi.fn((col: unknown, val: unknown) => ({ kind: 'eq', col, val })),
}));

import { getBanditArms } from '../bandit-query.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface RawRow {
  variant: string;
  alpha: number;
  beta: number;
  paused: boolean;
}

function mockSelectReturns(rows: RawRow[]): void {
  mockWhere.mockResolvedValueOnce(rows);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('getBanditArms — happy path (rows present)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('maps DB rows to BanditArm[] with all fields preserved', async () => {
    mockSelectReturns([
      { variant: 'control', alpha: 5.0, beta: 3.0, paused: false },
      { variant: 'v1', alpha: 12.0, beta: 4.0, paused: false },
    ]);

    const arms = await getBanditArms('tenant-abc', 'family_buyer');

    expect(arms).toHaveLength(2);
    expect(arms[0]).toEqual({ variant: 'control', alpha: 5.0, beta: 3.0, paused: false });
    expect(arms[1]).toEqual({ variant: 'v1', alpha: 12.0, beta: 4.0, paused: false });
  });

  it('does NOT insert when rows already exist', async () => {
    mockSelectReturns([{ variant: 'control', alpha: 1.0, beta: 1.0, paused: false }]);

    await getBanditArms('tenant-abc', 'family_buyer');

    expect(mockInsert).not.toHaveBeenCalled();
    expect(mockOnConflictDoNothing).not.toHaveBeenCalled();
  });

  it('preserves paused=true on returned arms', async () => {
    mockSelectReturns([
      { variant: 'control', alpha: 1.0, beta: 1.0, paused: false },
      { variant: 'v1', alpha: 1.0, beta: 1.0, paused: true },
    ]);

    const arms = await getBanditArms('tenant-abc', 'yield_hunter');
    const v1 = arms.find((a) => a.variant === 'v1');
    expect(v1?.paused).toBe(true);
  });
});

describe('getBanditArms — auto-seed path (empty rows)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    // Default mockWhere returns [] (empty rows) — triggers auto-seed
    mockWhere.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('inserts 3 seed rows (control, v1, v2) when DB returns empty', async () => {
    await getBanditArms('tenant-new', 'lifestyle_expat');

    expect(mockInsert).toHaveBeenCalledOnce();
    expect(mockInsertValues).toHaveBeenCalledOnce();
    const seedRows = mockInsertValues.mock.calls[0]?.[0] as {
      tenantId: string;
      archetype: string;
      variant: string;
      alpha: number;
      beta: number;
      paused: boolean;
    }[];
    expect(seedRows).toHaveLength(3);
    const variants = seedRows.map((r) => r.variant);
    expect(variants).toEqual(['control', 'v1', 'v2']);
  });

  it('seed rows carry the correct tenantId and archetype', async () => {
    await getBanditArms('tenant-xyz', 'first_time_buyer');

    const seedRows = mockInsertValues.mock.calls[0]?.[0] as {
      tenantId: string;
      archetype: string;
    }[];
    expect(seedRows.every((r) => r.tenantId === 'tenant-xyz')).toBe(true);
    expect(seedRows.every((r) => r.archetype === 'first_time_buyer')).toBe(true);
  });

  it('seed rows use Beta(1, 1) uniform prior — alpha=1, beta=1, paused=false', async () => {
    await getBanditArms('tenant-xyz', 'family_buyer');

    const seedRows = mockInsertValues.mock.calls[0]?.[0] as {
      alpha: number;
      beta: number;
      paused: boolean;
    }[];
    expect(seedRows.every((r) => r.alpha === 1.0)).toBe(true);
    expect(seedRows.every((r) => r.beta === 1.0)).toBe(true);
    expect(seedRows.every((r) => !r.paused)).toBe(true);
  });

  it('returns 3 BanditArm objects with Beta(1, 1) after auto-seed', async () => {
    const arms = await getBanditArms('tenant-new', 'neutral');

    expect(arms).toHaveLength(3);
    expect(arms.every((a) => a.alpha === 1.0 && a.beta === 1.0)).toBe(true);
    expect(arms.every((a) => a.paused === false)).toBe(true);
    expect(arms.map((a) => a.variant)).toEqual(['control', 'v1', 'v2']);
  });

  it('uses onConflictDoNothing for idempotent re-seed', async () => {
    await getBanditArms('tenant-new', 'neutral');

    expect(mockOnConflictDoNothing).toHaveBeenCalledOnce();
  });

  it('calling auto-seed twice for the same (tenant, archetype) calls onConflictDoNothing twice', async () => {
    await getBanditArms('tenant-new', 'neutral');
    await getBanditArms('tenant-new', 'neutral');

    expect(mockOnConflictDoNothing).toHaveBeenCalledTimes(2);
  });
});

describe('getBanditArms — degraded mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns [] when DATABASE_URL_ADMIN and DATABASE_URL_DIRECT are both unset', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');

    const arms = await getBanditArms('tenant-x', 'neutral');

    expect(arms).toEqual([]);
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it('returns [] when DB query throws', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    mockWhere.mockRejectedValueOnce(new Error('connection refused'));

    const arms = await getBanditArms('tenant-x', 'neutral');

    expect(arms).toEqual([]);
  });

  it('returns [] when createAdminClient throws', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
    mockCreateAdminClient.mockImplementationOnce(() => {
      throw new Error('init failed');
    });

    const arms = await getBanditArms('tenant-x', 'neutral');

    expect(arms).toEqual([]);
  });
});
