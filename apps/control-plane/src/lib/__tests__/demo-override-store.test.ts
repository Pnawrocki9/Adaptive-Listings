/**
 * Tests for `upsertDemoOverride`'s optional `tx` parameter (FOLLOW-609).
 *
 * FOLLOW-609 dedupes the byte-duplicated staff/agency demo-override write
 * (RETRO-193) by giving `upsertDemoOverride` an optional 4th `tx` argument: when
 * supplied, the upsert runs on that handle instead of opening a new
 * `createAdminClient()`, so a caller's own `db.transaction(async (tx) => ...)`
 * can pass its `tx` through and have this write commit/roll back atomically
 * with whatever else runs inside that transaction (e.g. a `staff_audit_log`
 * insert, ADR-0018 §3a). This file proves that dispatch directly, independent
 * of the route-level integration coverage in
 * `api/demo/override/route.test.ts` (which already exercises the full staff
 * tx-atomicity behaviour end-to-end).
 *
 * @module apps/control-plane/src/lib/__tests__/demo-override-store.test
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@estalara/db', () => ({
  createAdminClient: vi.fn(),
  demoOverrides: {
    tenantId: 'demo_overrides.tenant_id',
    enabled: 'demo_overrides.enabled',
    overrideArchetype: 'demo_overrides.override_archetype',
    overrideModel: 'demo_overrides.override_model',
    updatedBy: 'demo_overrides.updated_by',
    updatedAt: 'demo_overrides.updated_at',
  },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((col: unknown, val: unknown) => ({ col, val })),
}));

import { createAdminClient } from '@estalara/db';
import { upsertDemoOverride } from '../demo-override-store';

const TENANT_A = '550e8400-e29b-41d4-a716-446655440001';

const PATCH = {
  enabled: true,
  overrideArchetype: 'family_buyer',
  overrideModel: 'claude-sonnet-4-6',
};

function makeFakeDb(): { insert: ReturnType<typeof vi.fn> } {
  return {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: vi.fn(() => ({
          returning: vi.fn(() =>
            Promise.resolve([
              {
                id: 'demo-uuid-1',
                tenantId: TENANT_A,
                enabled: PATCH.enabled,
                overrideArchetype: PATCH.overrideArchetype,
                overrideModel: PATCH.overrideModel,
                updatedBy: 'user-1',
                createdAt: new Date('2026-07-21T00:00:00Z'),
                updatedAt: new Date('2026-07-21T00:00:00Z'),
              },
            ]),
          ),
        })),
      })),
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('upsertDemoOverride — optional tx handle (FOLLOW-609)', () => {
  it('opens its own createAdminClient() when no tx is supplied (agency path, unchanged)', async () => {
    const standaloneDb = makeFakeDb();
    vi.mocked(createAdminClient).mockReturnValue(
      standaloneDb as unknown as ReturnType<typeof createAdminClient>,
    );

    const row = await upsertDemoOverride(TENANT_A, PATCH, 'user-1');

    expect(createAdminClient).toHaveBeenCalledTimes(1);
    expect(standaloneDb.insert).toHaveBeenCalledTimes(1);
    expect(row.tenantId).toBe(TENANT_A);
  });

  it('writes on the supplied tx handle and never calls createAdminClient() (staff path)', async () => {
    const tx = makeFakeDb();

    const row = await upsertDemoOverride(
      TENANT_A,
      PATCH,
      'staff-uuid-777',
      tx as unknown as Parameters<typeof upsertDemoOverride>[3],
    );

    expect(createAdminClient).not.toHaveBeenCalled();
    expect(tx.insert).toHaveBeenCalledTimes(1);
    expect(row.tenantId).toBe(TENANT_A);
  });
});
