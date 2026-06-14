/**
 * PGlite-based integration test for migration 0030_seed_global_intent_weights
 * (FOLLOW-266 Phase 2, FOLLOW-302).
 *
 * Verifies:
 *   SEED-1: After the seed SQL runs, exactly one active global-default row exists
 *           (tenant_id IS NULL, is_active = true, weights = '{}').
 *   SEED-2: Re-running the seed SQL is idempotent — still exactly one active global row.
 *   SEED-3: The seed row weights is the empty object '{}', confirming the Option A
 *           identity seed (all SDK defaults apply; no overrides present).
 *
 * The GET /api/intent/config LIVE coverage for the global seed (data_source: 'live'
 * when weights = {}) is in apps/control-plane route.test.ts (SEED-LIVE test added
 * in the same PR). This file covers the SQL-layer assertions via real PGlite.
 *
 * RLS policies are omitted — the admin client bypasses RLS and these tests verify
 * SQL-layer idempotency semantics, not RLS enforcement (Supabase-only).
 *
 * @module @estalara/db/src/__tests__/intent-weight-seed.test
 */

import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// ─── Fixture DDL ─────────────────────────────────────────────────────────────
//
// Minimal schema matching migrations 0029 (intent_weight_configs table + partial
// unique index). The users and tenants FK references are omitted — PGlite does not
// need them for the idempotency proof, and the seed INSERT uses NULL for both
// tenant_id and created_by (no FK rows needed).
//
// The partial unique index uses COALESCE(tenant_id, sentinel_uuid) to enforce
// at-most-one-active-per-scope, mirroring the production 0029 index exactly.

const FIXTURE_DDL = /* sql */ `
  CREATE TABLE IF NOT EXISTS intent_weight_configs (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   uuid,
    is_active   boolean NOT NULL DEFAULT true,
    weights     jsonb NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    created_by  uuid
  );

  CREATE UNIQUE INDEX IF NOT EXISTS intent_weight_configs_one_active
    ON intent_weight_configs (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid))
    WHERE is_active = true;
`;

// ─── Seed SQL (must exactly match 0030_seed_global_intent_weights.sql) ────────
//
// Copied verbatim so that any future edit to the migration file triggers a diff
// visible to reviewers (they must update both). The WHERE NOT EXISTS guard is the
// core of the idempotency proof.

const SEED_SQL = /* sql */ `
  INSERT INTO intent_weight_configs (tenant_id, is_active, weights, created_by)
  SELECT
    NULL::uuid,
    true,
    '{}'::jsonb,
    NULL::uuid
  WHERE NOT EXISTS (
    SELECT 1
    FROM intent_weight_configs
    WHERE tenant_id IS NULL
      AND is_active = true
  );
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface WeightRow {
  id: string;
  tenant_id: string | null;
  is_active: boolean;
  weights: Record<string, unknown>;
  created_at: string;
  created_by: string | null;
}

async function countActiveGlobalRows(pg: PGlite): Promise<number> {
  const res = await pg.query<{ count: string }>(
    `SELECT COUNT(*) AS count
       FROM intent_weight_configs
      WHERE tenant_id IS NULL
        AND is_active = true`,
  );
  return parseInt(res.rows[0]?.count ?? '0', 10);
}

async function getActiveGlobalRow(pg: PGlite): Promise<WeightRow | undefined> {
  const res = await pg.query<WeightRow>(
    `SELECT id, tenant_id, is_active, weights, created_at::text AS created_at, created_by
       FROM intent_weight_configs
      WHERE tenant_id IS NULL
        AND is_active = true
      LIMIT 1`,
  );
  return res.rows[0];
}

// ─── Suite ────────────────────────────────────────────────────────────────────

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  await pg.exec(FIXTURE_DDL);
});

afterAll(async () => {
  await pg.close();
});

describe('0030_seed_global_intent_weights — PGlite idempotency harness', () => {
  it('SEED-1: after first seed run, exactly one active global-default row exists', async () => {
    await pg.exec(SEED_SQL);

    const count = await countActiveGlobalRows(pg);
    expect(count).toBe(1);
  });

  it('SEED-2: re-running the seed SQL is idempotent — still exactly one active global row', async () => {
    // Run the seed a second time; the WHERE NOT EXISTS guard must suppress the INSERT.
    await pg.exec(SEED_SQL);

    const count = await countActiveGlobalRows(pg);
    expect(count).toBe(1);
  });

  it('SEED-3: the seeded row has tenant_id IS NULL, is_active = true, weights = {}', async () => {
    const row = await getActiveGlobalRow(pg);

    expect(row).toBeDefined();
    if (!row) return;

    expect(row.tenant_id).toBeNull();
    expect(row.is_active).toBe(true);
    // PGlite returns JSONB as a parsed JS value; {} should be an empty object.
    expect(row.weights).toEqual({});
    expect(row.created_by).toBeNull();
  });

  it('SEED-4: the partial unique index blocks a second active global row even without the guard', async () => {
    // Confirm the DB-level constraint (the partial unique index on COALESCE) also
    // prevents a duplicate active global row independently of the WHERE NOT EXISTS guard.
    // A direct INSERT bypassing the guard must fail with a unique constraint violation.
    await expect(
      pg.exec(/* sql */ `
        INSERT INTO intent_weight_configs (tenant_id, is_active, weights, created_by)
        VALUES (NULL::uuid, true, '{}'::jsonb, NULL::uuid)
      `),
    ).rejects.toThrow();
  });
});
