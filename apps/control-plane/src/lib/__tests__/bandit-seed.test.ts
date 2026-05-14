/**
 * Unit tests for bandit-seed.ts — TICKET-AB-006.
 *
 * Tests:
 *  - seedBanditWeightsForTenant inserts exactly 18 rows (one per canonical archetype)
 *  - All rows have variant='default', alpha=1.0, beta=1.0, paused=false
 *  - Idempotency: calling seed twice for the same tenant uses onConflictDoNothing
 *  - No-op when DATABASE_URL_ADMIN is not configured
 *  - Archetype list includes all expected names (investor, own-use, cross-border, neutral)
 *
 * @module apps/control-plane/src/lib/__tests__/bandit-seed.test
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// ─── Mock @estalara/db ────────────────────────────────────────────────────────
// vi.mock() is hoisted to the top of the file before const declarations,
// so mocks must be created inside vi.hoisted() for the variables to be reachable.

const { mockOnConflictDoNothing, mockValues, mockInsert, mockCreateAdminClient } = vi.hoisted(
  () => {
    const mockOnConflictDoNothing = vi.fn().mockResolvedValue(undefined);
    const mockValues = vi.fn().mockReturnValue({ onConflictDoNothing: mockOnConflictDoNothing });
    const mockInsert = vi.fn().mockReturnValue({ values: mockValues });
    const mockCreateAdminClient = vi.fn(() => ({ insert: mockInsert }));
    return { mockOnConflictDoNothing, mockValues, mockInsert, mockCreateAdminClient };
  },
);

vi.mock('@estalara/db', () => ({
  createAdminClient: mockCreateAdminClient,
  abBanditWeights: { tenantId: 'tenant_id', archetype: 'archetype', variant: 'variant' },
}));

import { seedBanditWeightsForTenant } from '../bandit-seed.js';

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('seedBanditWeightsForTenant — row count and shape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('inserts exactly 18 rows — one per canonical archetype', async () => {
    await seedBanditWeightsForTenant('tenant-uuid-001');

    expect(mockValues).toHaveBeenCalledOnce();
    const rows = mockValues.mock.calls[0]?.[0] as {
      tenantId: string;
      archetype: string;
      variant: string;
      alpha: number;
      beta: number;
      paused: boolean;
    }[];

    expect(rows).toHaveLength(18);
  });

  it('all inserted rows have tenantId matching the argument', async () => {
    const tenantId = 'tenant-uuid-002';
    await seedBanditWeightsForTenant(tenantId);

    const rows = mockValues.mock.calls[0]?.[0] as { tenantId: string }[];
    expect(rows.every((r) => r.tenantId === tenantId)).toBe(true);
  });

  it('all inserted rows have variant="default"', async () => {
    await seedBanditWeightsForTenant('tenant-uuid-003');

    const rows = mockValues.mock.calls[0]?.[0] as { variant: string }[];
    expect(rows.every((r) => r.variant === 'default')).toBe(true);
  });

  it('all inserted rows have alpha=1.0, beta=1.0 (Beta(1,1) uniform prior)', async () => {
    await seedBanditWeightsForTenant('tenant-uuid-004');

    const rows = mockValues.mock.calls[0]?.[0] as { alpha: number; beta: number }[];
    expect(rows.every((r) => r.alpha === 1.0 && r.beta === 1.0)).toBe(true);
  });

  it('all inserted rows have paused=false', async () => {
    await seedBanditWeightsForTenant('tenant-uuid-005');

    const rows = mockValues.mock.calls[0]?.[0] as { paused: boolean }[];
    expect(rows.every((r) => !r.paused)).toBe(true);
  });

  it('inserted archetype names include all canonical investor archetypes', async () => {
    await seedBanditWeightsForTenant('tenant-uuid-006');

    const rows = mockValues.mock.calls[0]?.[0] as { archetype: string }[];
    const names = rows.map((r) => r.archetype);

    expect(names).toContain('yield_hunter');
    expect(names).toContain('vacation_rental_investor');
    expect(names).toContain('flip_investor');
    expect(names).toContain('portfolio_builder');
    expect(names).toContain('golden_visa_buyer');
    expect(names).toContain('commercial_investor');
  });

  it('inserted archetype names include all canonical own-use archetypes', async () => {
    await seedBanditWeightsForTenant('tenant-uuid-007');

    const rows = mockValues.mock.calls[0]?.[0] as { archetype: string }[];
    const names = rows.map((r) => r.archetype);

    expect(names).toContain('family_buyer');
    expect(names).toContain('first_time_buyer');
    expect(names).toContain('upsizer');
    expect(names).toContain('downsizer');
    expect(names).toContain('luxury_buyer');
    expect(names).toContain('remote_worker');
  });

  it('inserted archetype names include all cross-border and neutral archetypes', async () => {
    await seedBanditWeightsForTenant('tenant-uuid-008');

    const rows = mockValues.mock.calls[0]?.[0] as { archetype: string }[];
    const names = rows.map((r) => r.archetype);

    expect(names).toContain('lifestyle_expat');
    expect(names).toContain('retiree_relocator');
    expect(names).toContain('diaspora_buyer');
    expect(names).toContain('second_home_buyer');
    expect(names).toContain('student_parent');
    expect(names).toContain('neutral');
  });

  it('no duplicate archetypes in inserted rows', async () => {
    await seedBanditWeightsForTenant('tenant-uuid-009');

    const rows = mockValues.mock.calls[0]?.[0] as { archetype: string }[];
    const names = rows.map((r) => r.archetype);
    const unique = new Set(names);

    expect(unique.size).toBe(18);
  });
});

describe('seedBanditWeightsForTenant — idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses onConflictDoNothing for idempotency', async () => {
    await seedBanditWeightsForTenant('tenant-uuid-010');

    expect(mockOnConflictDoNothing).toHaveBeenCalledOnce();
  });

  it('calling seed twice for same tenant calls onConflictDoNothing twice', async () => {
    await seedBanditWeightsForTenant('tenant-uuid-011');
    await seedBanditWeightsForTenant('tenant-uuid-011');

    expect(mockOnConflictDoNothing).toHaveBeenCalledTimes(2);
  });
});

describe('seedBanditWeightsForTenant — no-op when DB not configured', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is a no-op when DATABASE_URL_ADMIN and DATABASE_URL_DIRECT are both unset/empty', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');

    await seedBanditWeightsForTenant('tenant-uuid-012');

    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('calls createAdminClient when DATABASE_URL_ADMIN is set', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');

    await seedBanditWeightsForTenant('tenant-uuid-013');

    expect(mockCreateAdminClient).toHaveBeenCalledOnce();
  });

  it('falls back to DATABASE_URL_DIRECT when DATABASE_URL_ADMIN is absent (undefined)', async () => {
    // DATABASE_URL_ADMIN must be truly absent (undefined), not empty string,
    // for the ?? fallback to pick up DATABASE_URL_DIRECT.
    const originalAdmin = process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_ADMIN;
    vi.stubEnv('DATABASE_URL_DIRECT', 'postgresql://user:pass@localhost:5432/db-direct');

    try {
      await seedBanditWeightsForTenant('tenant-uuid-014');
      expect(mockCreateAdminClient).toHaveBeenCalledOnce();
    } finally {
      if (originalAdmin !== undefined) {
        process.env.DATABASE_URL_ADMIN = originalAdmin;
      }
    }
  });
});
