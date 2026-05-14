/**
 * Unit tests for bandit-seed.ts — TICKET-AB-006.
 *
 * Tests:
 *  - CANONICAL_ARCHETYPES has exactly 18 entries (matches ArchetypeId in directives.ts)
 *  - All archetype names are non-empty strings
 *  - seedBanditWeightsForTenant inserts 18 rows (one per archetype × variant='default')
 *  - Idempotency: calling seed twice for the same tenant uses onConflictDoNothing
 *  - No-op when DATABASE_URL_ADMIN is not configured
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

import {
  CANONICAL_ARCHETYPES,
  CANONICAL_ARCHETYPE_COUNT,
  seedBanditWeightsForTenant,
} from '../bandit-seed.js';

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('CANONICAL_ARCHETYPES', () => {
  it('has exactly 18 archetypes (matches ArchetypeId type in directives.ts)', () => {
    expect(CANONICAL_ARCHETYPES).toHaveLength(18);
    expect(CANONICAL_ARCHETYPE_COUNT).toBe(18);
  });

  it('all entries are non-empty strings', () => {
    for (const arch of CANONICAL_ARCHETYPES) {
      expect(typeof arch).toBe('string');
      expect(arch.length).toBeGreaterThan(0);
    }
  });

  it('includes neutral as the last archetype', () => {
    expect(CANONICAL_ARCHETYPES[CANONICAL_ARCHETYPES.length - 1]).toBe('neutral');
  });

  it('includes all expected investor archetypes', () => {
    expect(CANONICAL_ARCHETYPES).toContain('yield_hunter');
    expect(CANONICAL_ARCHETYPES).toContain('vacation_rental_investor');
    expect(CANONICAL_ARCHETYPES).toContain('flip_investor');
    expect(CANONICAL_ARCHETYPES).toContain('portfolio_builder');
    expect(CANONICAL_ARCHETYPES).toContain('golden_visa_buyer');
    expect(CANONICAL_ARCHETYPES).toContain('commercial_investor');
  });

  it('includes all expected own-use archetypes', () => {
    expect(CANONICAL_ARCHETYPES).toContain('family_buyer');
    expect(CANONICAL_ARCHETYPES).toContain('first_time_buyer');
    expect(CANONICAL_ARCHETYPES).toContain('upsizer');
    expect(CANONICAL_ARCHETYPES).toContain('downsizer');
    expect(CANONICAL_ARCHETYPES).toContain('luxury_buyer');
    expect(CANONICAL_ARCHETYPES).toContain('remote_worker');
  });

  it('includes all expected special/cross-border archetypes', () => {
    expect(CANONICAL_ARCHETYPES).toContain('lifestyle_expat');
    expect(CANONICAL_ARCHETYPES).toContain('retiree_relocator');
    expect(CANONICAL_ARCHETYPES).toContain('diaspora_buyer');
    expect(CANONICAL_ARCHETYPES).toContain('second_home_buyer');
    expect(CANONICAL_ARCHETYPES).toContain('student_parent');
  });

  it('has no duplicate entries', () => {
    const unique = new Set(CANONICAL_ARCHETYPES);
    expect(unique.size).toBe(CANONICAL_ARCHETYPES.length);
  });
});

// ─── seedBanditWeightsForTenant tests ─────────────────────────────────────────

describe('seedBanditWeightsForTenant', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is a no-op when DATABASE_URL_ADMIN and DATABASE_URL_DIRECT are not set', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', '');
    vi.stubEnv('DATABASE_URL_DIRECT', '');

    await seedBanditWeightsForTenant('tenant-uuid-001');

    expect(mockCreateAdminClient).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('calls createAdminClient when DATABASE_URL_ADMIN is set', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');

    await seedBanditWeightsForTenant('tenant-uuid-001');

    expect(mockCreateAdminClient).toHaveBeenCalledOnce();
  });

  it('inserts exactly 18 rows for the given tenant', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');

    await seedBanditWeightsForTenant('tenant-uuid-002');

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
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');

    const tenantId = 'tenant-uuid-003';
    await seedBanditWeightsForTenant(tenantId);

    const rows = mockValues.mock.calls[0]?.[0] as { tenantId: string }[];
    expect(rows.every((r) => r.tenantId === tenantId)).toBe(true);
  });

  it('all inserted rows have variant="default"', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');

    await seedBanditWeightsForTenant('tenant-uuid-004');

    const rows = mockValues.mock.calls[0]?.[0] as { variant: string }[];
    expect(rows.every((r) => r.variant === 'default')).toBe(true);
  });

  it('all inserted rows have alpha=1.0, beta=1.0 (Beta(1,1) uniform prior)', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');

    await seedBanditWeightsForTenant('tenant-uuid-005');

    const rows = mockValues.mock.calls[0]?.[0] as { alpha: number; beta: number }[];
    expect(rows.every((r) => r.alpha === 1.0 && r.beta === 1.0)).toBe(true);
  });

  it('all inserted rows have paused=false', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');

    await seedBanditWeightsForTenant('tenant-uuid-006');

    const rows = mockValues.mock.calls[0]?.[0] as { paused: boolean }[];
    expect(rows.every((r) => !r.paused)).toBe(true);
  });

  it('uses onConflictDoNothing for idempotency (run twice → same result)', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');

    // Run seed twice for the same tenant
    await seedBanditWeightsForTenant('tenant-uuid-007');
    await seedBanditWeightsForTenant('tenant-uuid-007');

    // onConflictDoNothing should be called twice (once per seed call)
    expect(mockOnConflictDoNothing).toHaveBeenCalledTimes(2);
  });

  it('inserted archetype names match CANONICAL_ARCHETYPES exactly', async () => {
    vi.stubEnv('DATABASE_URL_ADMIN', 'postgresql://user:pass@localhost:5432/db');

    await seedBanditWeightsForTenant('tenant-uuid-008');

    const rows = mockValues.mock.calls[0]?.[0] as { archetype: string }[];
    const insertedArchetypes = rows.map((r) => r.archetype);

    expect(insertedArchetypes).toEqual(CANONICAL_ARCHETYPES);
  });

  it('falls back to DATABASE_URL_DIRECT when DATABASE_URL_ADMIN is absent', async () => {
    // DATABASE_URL_ADMIN must be truly absent (undefined), not empty string,
    // for the ?? fallback to pick up DATABASE_URL_DIRECT.
    // vi.stubEnv cannot unset a var — use delete directly and restore after.
    const originalAdmin = process.env.DATABASE_URL_ADMIN;
    delete process.env.DATABASE_URL_ADMIN;
    vi.stubEnv('DATABASE_URL_DIRECT', 'postgresql://user:pass@localhost:5432/db-direct');

    try {
      await seedBanditWeightsForTenant('tenant-uuid-009');
      // Should NOT be a no-op when DATABASE_URL_DIRECT is set
      expect(mockCreateAdminClient).toHaveBeenCalledOnce();
    } finally {
      // Restore DATABASE_URL_ADMIN if it was previously set
      if (originalAdmin !== undefined) {
        process.env.DATABASE_URL_ADMIN = originalAdmin;
      }
    }
  });
});
