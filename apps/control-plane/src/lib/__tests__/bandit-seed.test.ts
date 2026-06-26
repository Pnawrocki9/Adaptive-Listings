/**
 * Unit tests for bandit-seed.ts — TICKET-AB-006 / FOLLOW-361.
 *
 * Tests:
 *  - seedBanditWeightsForTenant inserts exactly 54 rows (18 archetypes × 3 variants)
 *  - All rows have variant in SEED_VARIANTS (control / v1 / v2), NOT 'default'
 *  - Each archetype is seeded with all three variants from SEED_VARIANTS
 *  - Idempotency: calling seed twice for the same tenant uses onConflictDoNothing
 *  - No-op when DATABASE_URL_ADMIN is not configured
 *  - Archetype list includes all expected names (investor, own-use, cross-border, neutral)
 *  - AC-3 parity: variant list used by seedBanditWeightsForTenant equals SEED_VARIANTS
 *    from bandit-query.ts (Rule K.1 — prevents future divergence)
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
import { SEED_VARIANTS } from '../bandit-query.js';

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('seedBanditWeightsForTenant — row count and shape', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('inserts exactly 54 rows — 18 archetypes × 3 variants (control/v1/v2)', async () => {
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

    expect(rows).toHaveLength(54);
  });

  it('all inserted rows have tenantId matching the argument', async () => {
    const tenantId = 'tenant-uuid-002';
    await seedBanditWeightsForTenant(tenantId);

    const rows = mockValues.mock.calls[0]?.[0] as { tenantId: string }[];
    expect(rows.every((r) => r.tenantId === tenantId)).toBe(true);
  });

  it('all inserted rows have variant in SEED_VARIANTS — never "default"', async () => {
    await seedBanditWeightsForTenant('tenant-uuid-003');

    const rows = mockValues.mock.calls[0]?.[0] as { variant: string }[];
    const validVariants: readonly string[] = SEED_VARIANTS;
    expect(rows.every((r) => validVariants.includes(r.variant))).toBe(true);
    expect(rows.some((r) => r.variant === 'default')).toBe(false);
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

  it('no duplicate (archetype, variant) pairs in inserted rows', async () => {
    await seedBanditWeightsForTenant('tenant-uuid-009');

    const rows = mockValues.mock.calls[0]?.[0] as { archetype: string; variant: string }[];
    const keys = rows.map((r) => `${r.archetype}:${r.variant}`);
    const unique = new Set(keys);

    expect(unique.size).toBe(54);
  });

  it('each archetype is seeded exactly once for each variant in SEED_VARIANTS', async () => {
    await seedBanditWeightsForTenant('tenant-uuid-010');

    const rows = mockValues.mock.calls[0]?.[0] as { archetype: string; variant: string }[];
    const byArchetype = new Map<string, string[]>();
    for (const r of rows) {
      const list = byArchetype.get(r.archetype) ?? [];
      list.push(r.variant);
      byArchetype.set(r.archetype, list);
    }

    for (const [, variants] of byArchetype) {
      expect([...variants].sort()).toEqual([...SEED_VARIANTS].sort());
    }
    expect(byArchetype.size).toBe(18);
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
    await seedBanditWeightsForTenant('tenant-uuid-011');

    expect(mockOnConflictDoNothing).toHaveBeenCalledOnce();
  });

  it('calling seed twice for same tenant calls onConflictDoNothing twice', async () => {
    await seedBanditWeightsForTenant('tenant-uuid-012');
    await seedBanditWeightsForTenant('tenant-uuid-012');

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

    await seedBanditWeightsForTenant('tenant-uuid-013');

    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('calls createAdminClient when DATABASE_URL_ADMIN is set', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');

    await seedBanditWeightsForTenant('tenant-uuid-014');

    expect(mockCreateAdminClient).toHaveBeenCalledOnce();
  });

  it('falls back to DATABASE_URL_DIRECT when DATABASE_URL_ADMIN is absent (undefined)', async () => {
    // DATABASE_URL_ADMIN must be truly absent (undefined), not empty string,
    // for the ?? fallback to pick up DATABASE_URL_DIRECT.
    const originalAdmin = process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_ADMIN;
    vi.stubEnv('DATABASE_URL_DIRECT', 'postgresql://user:pass@localhost:5432/db-direct');

    try {
      await seedBanditWeightsForTenant('tenant-uuid-015');
      expect(mockCreateAdminClient).toHaveBeenCalledOnce();
    } finally {
      if (originalAdmin !== undefined) {
        process.env.DATABASE_URL_ADMIN = originalAdmin;
      }
    }
  });
});

// ─── AC-3: Parity test — FOLLOW-361 / Rule K.1 ────────────────────────────────
// Asserts that the variant list written by seedBanditWeightsForTenant is
// exactly equal to SEED_VARIANTS exported from bandit-query.ts.
// If the two lists diverge, this test fails — preventing a future engineer
// from changing one side without the other.

describe('seedBanditWeightsForTenant — parity with SEED_VARIANTS from bandit-query (Rule K.1 / FOLLOW-361)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('seeds exactly the variants in SEED_VARIANTS — no more, no less, no "default"', async () => {
    await seedBanditWeightsForTenant('tenant-parity-001');

    const rows = mockValues.mock.calls[0]?.[0] as { variant: string }[];
    const seededVariants = [...new Set(rows.map((r) => r.variant))].sort();
    const expectedVariants = [...SEED_VARIANTS].sort();

    expect(seededVariants).toEqual(expectedVariants);
    expect(seededVariants).not.toContain('default');
  });

  it('SEED_VARIANTS constant itself does not include "default"', () => {
    // Guard: confirms the source-of-truth list was not accidentally patched
    // to re-introduce the stale 'default' arm.
    expect(Array.from(SEED_VARIANTS)).not.toContain('default');
    expect(Array.from(SEED_VARIANTS)).toContain('control');
    expect(Array.from(SEED_VARIANTS)).toContain('v1');
    expect(Array.from(SEED_VARIANTS)).toContain('v2');
  });
});
