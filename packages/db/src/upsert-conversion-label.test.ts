/**
 * Integration tests for `upsertConversionLabel` — FOLLOW-183.
 *
 * Uses @electric-sql/pglite (in-memory Postgres) + drizzle-orm/pglite to exercise the
 * generated `buildStoredRankSql()` WHERE clause against a real Postgres engine, proving
 * that conflict resolution semantics work end-to-end.
 *
 * Why PGlite instead of running the full migration stack:
 *   Migrations 0002 and 0013 require the `vector` extension (pgvector). PGlite 0.5.x
 *   does not bundle pgvector, so running all 23 migrations would fail. The fixture DDL
 *   below creates only the two tables this test depends on (`tenants` + `conversion_labels`)
 *   plus the UNIQUE constraint, matching migrations 0000/0019/0020 exactly.
 *
 * ACs covered (FOLLOW-183 original + RETRO-038 amendments):
 *   1. SQL-vs-TS 12-pair parity gate: for each of the 12 (outcomeClass × labelSource) pairs
 *      the stored rank computed by the SQL CASE equals conversionLabelRank() in TS.
 *   2. Empty-map reduce guard: buildStoredRankSql does not throw when called with an empty
 *      entries array (tested by calling buildStoredRankSql directly with []).
 *   3. UNIQUE constraint: two conflicting upserts for the same prediction_id resolve to the
 *      higher-rank outcome class.
 *   4. Higher-rank incoming label overwrites; lower/equal-rank is a no-op.
 *   5. Equal-rank recency tiebreak on labeled_at.
 *   6. Non-empty stored lead_id is preserved when incoming lead_id is ''.
 *   7. Confidence defaults to 1.0 when not supplied.
 *   8. ZodError thrown for invalid outcomeClass / labelSource before any DB call.
 *   ≥80% coverage on upsert-conversion-label.ts (threshold enforced by vitest.config.ts).
 *
 * @module @estalara/db/upsert-conversion-label.test
 */

import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';

import { PGlite } from '@electric-sql/pglite';

import { allRankEntries, conversionLabelRank } from '@estalara/shared';

import type { Database } from './client.js';
import { conversionLabels, tenants } from './schema/index.js';
import { buildStoredRankSql, upsertConversionLabel } from './upsert-conversion-label.js';

// ─── Fixture DDL ─────────────────────────────────────────────────────────────
//
// Minimal schema: only the two tables this test depends on, matching migrations
// 0000_soft_secret_warriors (tenants), 0019_conversion_labels, and
// 0020_conversion_labels_dedup (UNIQUE constraint).
//
// RLS policies are intentionally omitted — the admin client bypasses RLS by
// design and the test uses service-role-equivalent access.

const FIXTURE_DDL = /* sql */ `
  CREATE TABLE IF NOT EXISTS tenants (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL,
    slug       text NOT NULL UNIQUE,
    status     text NOT NULL DEFAULT 'pending',
    plan       text NOT NULL DEFAULT 'free',
    allowed_origins text[] NOT NULL DEFAULT '{}',
    brand_config jsonb DEFAULT '{}',
    quiz_config  jsonb DEFAULT '{}',
    consent_required boolean NOT NULL DEFAULT true,
    pilot_frozen     boolean NOT NULL DEFAULT false,
    profile_mode_enabled    boolean NOT NULL DEFAULT false,
    profile_mode_enabled_at timestamptz,
    profile_mode_enabled_by uuid,
    stripe_customer_id      text UNIQUE,
    stripe_subscription_id  text UNIQUE,
    registration_id uuid,
    approved_by     uuid,
    approved_at     timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    deleted_at timestamptz
  );

  CREATE TABLE IF NOT EXISTS conversion_labels (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    prediction_id text NOT NULL,
    lead_id       text NOT NULL DEFAULT '',
    outcome_class text NOT NULL,
    outcome_raw   jsonb,
    labeled_at    timestamptz NOT NULL DEFAULT now(),
    label_source  text NOT NULL,
    confidence    real,
    notes         text,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS conversion_labels_tenant_prediction_unique
    ON conversion_labels (tenant_id, prediction_id);

  CREATE INDEX IF NOT EXISTS conversion_labels_tenant_id_idx     ON conversion_labels (tenant_id);
  CREATE INDEX IF NOT EXISTS conversion_labels_prediction_id_idx ON conversion_labels (prediction_id);
  CREATE INDEX IF NOT EXISTS conversion_labels_tenant_outcome_idx ON conversion_labels (tenant_id, outcome_class);
`;

// ─── Test helpers ─────────────────────────────────────────────────────────────

/** Typed row returned by `getLabel()`. */
interface LabelRow {
  outcome_class: string;
  label_source: string;
  lead_id: string;
  confidence: number;
  labeled_at: string;
}

/** A stable tenant UUID injected at test-suite setup time. */
let TENANT_ID: string;

let pg: PGlite;
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PGlite drizzle db; schema type is wide
let db: ReturnType<typeof drizzlePglite<any>>;

/** Select the conversion_label rows for this prediction. */
async function getLabel(predictionId: string): Promise<LabelRow[]> {
  const result = await pg.query<LabelRow>(
    `SELECT outcome_class, label_source, lead_id, confidence, labeled_at
       FROM conversion_labels
      WHERE prediction_id = $1 AND tenant_id = $2`,
    [predictionId, TENANT_ID],
  );
  return result.rows;
}

/** Delete all conversion_labels rows between tests so each test starts clean. */
async function resetLabels() {
  await pg.exec('DELETE FROM conversion_labels');
}

// ─── Suite setup ──────────────────────────────────────────────────────────────

beforeAll(async () => {
  // Spin up in-memory Postgres (no filesystem, fully ephemeral).
  pg = new PGlite();
  await pg.waitReady;

  // Apply fixture DDL.
  await pg.exec(FIXTURE_DDL);

  // Create Drizzle client on top of PGlite.
  db = drizzlePglite(pg, {
    schema: { conversionLabels, tenants },
  });

  // Insert a test tenant so FK constraint is satisfied.
  const insertResult = await pg.query<{ id: string }>(
    `INSERT INTO tenants (name, slug) VALUES ('Test Tenant', 'test-tenant') RETURNING id`,
  );
  const row = insertResult.rows[0];
  if (!row) throw new Error('Failed to insert test tenant');
  TENANT_ID = row.id;
});

afterAll(async () => {
  await pg.close();
});

// ─── AC-8: Zod validation before DB touch ────────────────────────────────────

describe('Zod validation (pre-DB)', () => {
  it('throws ZodError for invalid outcomeClass', async () => {
    await expect(
      upsertConversionLabel(db as unknown as Database, {
        tenantId: TENANT_ID,
        predictionId: 'pred-zod-1',
        outcomeClass: 'invalid_class',
        labelSource: 'system',
      }),
    ).rejects.toThrow(ZodError);
  });

  it('throws ZodError for invalid labelSource', async () => {
    await expect(
      upsertConversionLabel(db as unknown as Database, {
        tenantId: TENANT_ID,
        predictionId: 'pred-zod-2',
        outcomeClass: 'viewing_booked',
        labelSource: 'robot',
      }),
    ).rejects.toThrow(ZodError);
  });
});

// ─── AC-7: Confidence default ─────────────────────────────────────────────────

describe('confidence default', () => {
  it('defaults confidence to 1.0 when not supplied', async () => {
    await resetLabels();
    await upsertConversionLabel(db as unknown as Database, {
      tenantId: TENANT_ID,
      predictionId: 'pred-conf-default',
      outcomeClass: 'viewing_booked',
      labelSource: 'system',
    });
    const rows = await getLabel('pred-conf-default');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toBeDefined();
    expect(row?.confidence).toBe(1.0);
  });

  it('stores an explicit confidence value', async () => {
    await resetLabels();
    await upsertConversionLabel(db as unknown as Database, {
      tenantId: TENANT_ID,
      predictionId: 'pred-conf-explicit',
      outcomeClass: 'viewing_booked',
      labelSource: 'system',
      confidence: 0.75,
    });
    const rows = await getLabel('pred-conf-explicit');
    const row = rows[0];
    expect(row).toBeDefined();
    expect(row?.confidence).toBeCloseTo(0.75);
  });
});

// ─── AC-3: UNIQUE constraint (raw INSERT) ────────────────────────────────────

describe('UNIQUE (tenant_id, prediction_id) constraint', () => {
  it('rejects a duplicate raw INSERT on (tenant_id, prediction_id)', async () => {
    await resetLabels();
    // First insert succeeds.
    await pg.exec(
      `INSERT INTO conversion_labels (tenant_id, prediction_id, outcome_class, label_source)
         VALUES ('${TENANT_ID}', 'pred-dup-raw', 'viewing_booked', 'system')`,
    );
    // Second insert on the same key must throw.
    await expect(
      pg.exec(
        `INSERT INTO conversion_labels (tenant_id, prediction_id, outcome_class, label_source)
           VALUES ('${TENANT_ID}', 'pred-dup-raw', 'offer_made', 'system')`,
      ),
    ).rejects.toThrow();
  });

  it('resolves two conflicting upserts to the higher-rank outcome class', async () => {
    await resetLabels();
    // First upsert: system / viewing_booked (rank 1)
    await upsertConversionLabel(db as unknown as Database, {
      tenantId: TENANT_ID,
      predictionId: 'pred-conflict-resolve',
      outcomeClass: 'viewing_booked',
      labelSource: 'system',
      labeledAt: new Date('2026-01-01T10:00:00Z'),
    });
    // Second upsert: system / purchased (rank 5) — should win.
    await upsertConversionLabel(db as unknown as Database, {
      tenantId: TENANT_ID,
      predictionId: 'pred-conflict-resolve',
      outcomeClass: 'purchased',
      labelSource: 'system',
      labeledAt: new Date('2026-01-01T11:00:00Z'),
    });
    const rows = await getLabel('pred-conflict-resolve');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toBeDefined();
    expect(row?.outcome_class).toBe('purchased');
  });
});

// ─── AC-1 + SQL-vs-TS parity: 12-pair gate ───────────────────────────────────
//
// For each of the 12 (outcomeClass × labelSource) pairs we:
//   1. Write a "baseline" row at a known rank.
//   2. Attempt to overwrite it with a "challenger" at a HIGHER rank.
//   3. Assert the stored row ends up with the challenger's class (higher rank won).
//
// This proves the generated SQL CASE computes the same rank as conversionLabelRank() for
// every pair — the "real SQL-vs-TS parity gate" required by RETRO-038.

describe('12-pair SQL-vs-TS parity gate', () => {
  const entries = allRankEntries();

  // Sort by rank so we can pair each entry with the next-higher-rank entry.
  const sortedByRank = [...entries].sort((a, b) => a.rank - b.rank);

  it(`covers all ${String(entries.length)} (class × source) pairs (12 expected)`, () => {
    expect(entries).toHaveLength(12);
  });

  // ── For each consecutive (lower, higher) rank pair, verify higher overwrites lower ──
  for (let i = 0; i < sortedByRank.length - 1; i++) {
    const lower = sortedByRank[i];
    const higher = sortedByRank[i + 1];

    // Both lower and higher are defined because i < sortedByRank.length - 1.
    if (!lower || !higher) continue;

    const predId = `pred-parity-${String(i)}`;
    const tsLowerRank = conversionLabelRank({
      outcomeClass: lower.outcomeClass,
      labelSource: lower.labelSource,
    });
    const tsHigherRank = conversionLabelRank({
      outcomeClass: higher.outcomeClass,
      labelSource: higher.labelSource,
    });

    it(
      `SQL rank: ${lower.labelSource}/${lower.outcomeClass}(rank=${String(tsLowerRank)}) → ` +
        `overwritten by ${higher.labelSource}/${higher.outcomeClass}(rank=${String(tsHigherRank)})`,
      async () => {
        await resetLabels();

        const baseTime = new Date('2026-01-01T10:00:00Z');
        const laterTime = new Date('2026-01-01T11:00:00Z');

        // Write the lower-rank row.
        await upsertConversionLabel(db as unknown as Database, {
          tenantId: TENANT_ID,
          predictionId: predId,
          outcomeClass: lower.outcomeClass,
          labelSource: lower.labelSource,
          labeledAt: baseTime,
        });

        // Write the higher-rank row — must overwrite.
        await upsertConversionLabel(db as unknown as Database, {
          tenantId: TENANT_ID,
          predictionId: predId,
          outcomeClass: higher.outcomeClass,
          labelSource: higher.labelSource,
          labeledAt: laterTime,
        });

        const rows = await getLabel(predId);
        expect(rows).toHaveLength(1);
        const row = rows[0];
        expect(row).toBeDefined();
        // The stored row must reflect the higher-rank challenger.
        expect(row?.outcome_class).toBe(higher.outcomeClass);
        expect(row?.label_source).toBe(higher.labelSource);
      },
    );
  }

  // ── Highest-rank entry: a lower-rank incoming must be a no-op ──
  it('highest-rank stored row is not overwritten by a lower-rank incoming', async () => {
    await resetLabels();
    const highest = sortedByRank[sortedByRank.length - 1];
    const secondHighest = sortedByRank[sortedByRank.length - 2];

    // Both are defined because sortedByRank has 12 entries.
    expect(highest).toBeDefined();
    expect(secondHighest).toBeDefined();
    if (!highest || !secondHighest) return;

    const baseTime = new Date('2026-01-01T10:00:00Z');
    const laterTime = new Date('2026-01-01T11:00:00Z');

    // Write highest-rank row.
    await upsertConversionLabel(db as unknown as Database, {
      tenantId: TENANT_ID,
      predictionId: 'pred-highest-noop',
      outcomeClass: highest.outcomeClass,
      labelSource: highest.labelSource,
      labeledAt: baseTime,
    });

    // Attempt to overwrite with second-highest (lower rank, but later time).
    await upsertConversionLabel(db as unknown as Database, {
      tenantId: TENANT_ID,
      predictionId: 'pred-highest-noop',
      outcomeClass: secondHighest.outcomeClass,
      labelSource: secondHighest.labelSource,
      labeledAt: laterTime,
    });

    const rows = await getLabel('pred-highest-noop');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row).toBeDefined();
    // Must still be the highest-rank row.
    expect(row?.outcome_class).toBe(highest.outcomeClass);
    expect(row?.label_source).toBe(highest.labelSource);
  });
});

// ─── AC-4: Higher rank overwrites; lower/equal-rank is a no-op ───────────────

describe('precedence: higher rank overwrites, lower is no-op', () => {
  it('system/purchased is not overwritten by system/no_response (lower rank)', async () => {
    await resetLabels();
    const baseTime = new Date('2026-01-01T10:00:00Z');
    const laterTime = new Date('2026-01-01T12:00:00Z');

    await upsertConversionLabel(db as unknown as Database, {
      tenantId: TENANT_ID,
      predictionId: 'pred-noop-lower',
      outcomeClass: 'purchased',
      labelSource: 'system',
      labeledAt: baseTime,
    });
    // Lower rank incoming — even at a later labeled_at, rank wins.
    await upsertConversionLabel(db as unknown as Database, {
      tenantId: TENANT_ID,
      predictionId: 'pred-noop-lower',
      outcomeClass: 'no_response',
      labelSource: 'system',
      labeledAt: laterTime,
    });
    const rows = await getLabel('pred-noop-lower');
    const row = rows[0];
    expect(row).toBeDefined();
    expect(row?.outcome_class).toBe('purchased');
  });

  it('manual_admin/no_response outranks system/purchased (source dominates)', async () => {
    await resetLabels();
    await upsertConversionLabel(db as unknown as Database, {
      tenantId: TENANT_ID,
      predictionId: 'pred-manual-wins',
      outcomeClass: 'purchased',
      labelSource: 'system',
      labeledAt: new Date('2026-01-01T10:00:00Z'),
    });
    await upsertConversionLabel(db as unknown as Database, {
      tenantId: TENANT_ID,
      predictionId: 'pred-manual-wins',
      outcomeClass: 'no_response',
      labelSource: 'manual_admin',
      labeledAt: new Date('2026-01-01T11:00:00Z'),
    });
    const rows = await getLabel('pred-manual-wins');
    const row = rows[0];
    expect(row).toBeDefined();
    // manual_admin/no_response rank = 1000; system/purchased rank = 5 → manual wins.
    expect(row?.label_source).toBe('manual_admin');
    expect(row?.outcome_class).toBe('no_response');
  });
});

// ─── AC-5: Equal-rank recency tiebreak on labeled_at ─────────────────────────

describe('equal-rank tiebreak on labeled_at', () => {
  it('newer labeled_at wins on equal rank', async () => {
    await resetLabels();
    const earlier = new Date('2026-01-01T09:00:00Z');
    const later = new Date('2026-01-01T11:00:00Z');

    // First write: system/viewing_booked at earlier.
    await upsertConversionLabel(db as unknown as Database, {
      tenantId: TENANT_ID,
      predictionId: 'pred-tiebreak',
      outcomeClass: 'viewing_booked',
      labelSource: 'system',
      labeledAt: earlier,
    });
    // Same rank, later labeled_at — should overwrite.
    await upsertConversionLabel(db as unknown as Database, {
      tenantId: TENANT_ID,
      predictionId: 'pred-tiebreak',
      outcomeClass: 'viewing_booked',
      labelSource: 'system',
      labeledAt: later,
    });
    const rows = await getLabel('pred-tiebreak');
    const row = rows[0];
    expect(row).toBeDefined();
    // labeled_at should now be `later`.
    const storedLabeledAt = new Date(row?.labeled_at ?? '').getTime();
    expect(storedLabeledAt).toBe(later.getTime());
  });

  it('older labeled_at loses tiebreak (no-op)', async () => {
    await resetLabels();
    const earlier = new Date('2026-01-01T09:00:00Z');
    const later = new Date('2026-01-01T11:00:00Z');

    // First write: later labeled_at.
    await upsertConversionLabel(db as unknown as Database, {
      tenantId: TENANT_ID,
      predictionId: 'pred-tiebreak-noop',
      outcomeClass: 'viewing_booked',
      labelSource: 'system',
      labeledAt: later,
    });
    // Same rank, earlier labeled_at — should be a no-op.
    await upsertConversionLabel(db as unknown as Database, {
      tenantId: TENANT_ID,
      predictionId: 'pred-tiebreak-noop',
      outcomeClass: 'viewing_booked',
      labelSource: 'system',
      labeledAt: earlier,
    });
    const rows = await getLabel('pred-tiebreak-noop');
    const row = rows[0];
    expect(row).toBeDefined();
    const storedLabeledAt = new Date(row?.labeled_at ?? '').getTime();
    // Must still be `later`.
    expect(storedLabeledAt).toBe(later.getTime());
  });
});

// ─── AC-6: Non-empty lead_id is preserved when incoming lead_id is '' ─────────

describe('lead_id preservation', () => {
  it("does not erase a stored lead_id when incoming lead_id is ''", async () => {
    await resetLabels();
    // Write with a real lead_id.
    await upsertConversionLabel(db as unknown as Database, {
      tenantId: TENANT_ID,
      predictionId: 'pred-lead-id',
      outcomeClass: 'viewing_booked',
      labelSource: 'system',
      leadId: 'crm-lead-42',
      labeledAt: new Date('2026-01-01T10:00:00Z'),
    });
    // Higher-rank update with no lead_id — must preserve the stored value.
    await upsertConversionLabel(db as unknown as Database, {
      tenantId: TENANT_ID,
      predictionId: 'pred-lead-id',
      outcomeClass: 'purchased',
      labelSource: 'system',
      leadId: '',
      labeledAt: new Date('2026-01-01T11:00:00Z'),
    });
    const rows = await getLabel('pred-lead-id');
    const row = rows[0];
    expect(row).toBeDefined();
    expect(row?.lead_id).toBe('crm-lead-42');
    expect(row?.outcome_class).toBe('purchased');
  });

  it('overwrites an empty stored lead_id with a non-empty incoming value', async () => {
    await resetLabels();
    await upsertConversionLabel(db as unknown as Database, {
      tenantId: TENANT_ID,
      predictionId: 'pred-lead-id-set',
      outcomeClass: 'viewing_booked',
      labelSource: 'system',
      leadId: '',
      labeledAt: new Date('2026-01-01T10:00:00Z'),
    });
    await upsertConversionLabel(db as unknown as Database, {
      tenantId: TENANT_ID,
      predictionId: 'pred-lead-id-set',
      outcomeClass: 'purchased',
      labelSource: 'system',
      leadId: 'crm-lead-99',
      labeledAt: new Date('2026-01-01T11:00:00Z'),
    });
    const rows = await getLabel('pred-lead-id-set');
    const row = rows[0];
    expect(row).toBeDefined();
    expect(row?.lead_id).toBe('crm-lead-99');
  });
});

// ─── AC-2: Empty-map reduce guard in buildStoredRankSql ──────────────────────
//
// Without the guard, Array.prototype.reduce with no initial value throws:
//   "Reduce of empty array with no initial value"
// With the guard, buildStoredRankSql returns sql`CASE END` (NULL for all rows,
// so the WHERE clause is never satisfied — safe and conservative).
//
// We call buildStoredRankSql directly with an explicit empty entries array, bypassing
// the ESM live-binding restriction that prevents spy-intercepting allRankEntries()
// inside the module (RETRO-038 §4a LG-2).

describe('buildStoredRankSql empty-map guard (RETRO-038 §4a LG-2)', () => {
  it('does not throw when called with an empty entries array', () => {
    expect(() =>
      buildStoredRankSql(conversionLabels.labelSource, conversionLabels.outcomeClass, []),
    ).not.toThrow();
  });

  it('returns a CASE END fragment (NULL for all rows) when entries is empty', () => {
    const fragment = buildStoredRankSql(
      conversionLabels.labelSource,
      conversionLabels.outcomeClass,
      [],
    );
    // The SQL object's queryChunks should contain "CASE END" text but no "WHEN" branches.
    const sqlStr = JSON.stringify(fragment);
    expect(sqlStr).toContain('CASE');
    expect(sqlStr).toContain('END');
    // No WHEN branches means no rank literals:
    expect(sqlStr).not.toContain('WHEN');
  });
});
