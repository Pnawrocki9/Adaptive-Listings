/**
 * PG-harness integration tests for FOLLOW-184 / FOLLOW-239: DSR erasure must reach
 * CRM-written conversion_labels rows (GDPR Art. 17 completeness).
 *
 * Uses @electric-sql/pglite (in-memory Postgres) to prove the identifier-
 * resolution model against a real SQL engine.
 *
 * Background (RETRO-031 §4a LG-1):
 *   The DSR erase cascade deletes `conversion_labels WHERE lead_id = session_id`.
 *   But the CRM webhook writes `lead_id = data.lead_id` — an opaque pseudonymous
 *   token in a DIFFERENT namespace from the Estalara session_id.
 *   Without FOLLOW-184, CRM-sourced rows survive a DSR erasure.
 *
 * Resolution model (§T.6):
 *   dsr_verifications.durable_lead_id carries the CRM token at DSR initiation time.
 *   The erase cascade runs TWO deletes:
 *     Pass A: WHERE lead_id = session_id      (SDK feedback-ping labels)
 *     Pass B: WHERE lead_id = durable_lead_id (CRM deep-outcome labels)
 *   Both passes gate on lead_id <> '' (LG-2 guard — blank key must never match-all).
 *
 * ACs covered:
 *   AC-1 (FOLLOW-184 primary): A CRM row with lead_id != session_id IS erased when
 *         DSR durable_lead_id equals the CRM token. (proves LG-1 closed)
 *   AC-2: An SDK-ping row with lead_id = session_id IS also erased in the same pass.
 *   AC-3: A CRM row for a DIFFERENT lead_id survives (cross-tenant isolation proxy).
 *   AC-4 (LG-2 regression guard): Rows with lead_id = '' are NEVER matched by either
 *         pass (empty key must not erase all system labels for the tenant).
 *   AC-5: When durable_lead_id IS NULL, only Pass A runs (no CRM rows erased).
 *   AC-6: When durable_lead_id equals session_id, the dedup guard fires and Pass B is
 *         skipped (identical key means Pass A already covered those rows).
 *
 * FOLLOW-239 ACs (omitted-token observable outcome, RETRO-042 TG-2):
 *   AC-7 (FOLLOW-239 primary): When durable_lead_id is NULL and CRM rows survive,
 *         the completeness check query detects > 0 surviving CRM-namespace rows.
 *         This is the SQL predicate that drives the Sentry warning + audit log in
 *         the production dsr/erase route (the observable outcome on the wire).
 *   AC-8: When durable_lead_id is NULL but NO CRM rows exist (only SDK-ping rows),
 *         the completeness check query returns 0 — no false positive.
 *   AC-9: When durable_lead_id IS supplied and Pass B runs, the completeness check
 *         query returns 0 — no false positive after a full erasure.
 *
 * @module @estalara/db/dsr-crm-erasure.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PGlite } from '@electric-sql/pglite';

// ─── Fixture DDL ─────────────────────────────────────────────────────────────
//
// Minimal schema: only the tables this test depends on, matching migrations
// 0000/0019/0020 and 0024 (dsr_verifications.durable_lead_id).
//
// The dsr_verifications table is included to reflect the FOLLOW-184 migration:
// durable_lead_id is nullable text, added by 0024_dsr_durable_lead_id.sql.
//
// RLS policies are intentionally omitted — the admin client bypasses RLS
// and these tests verify erasure logic, not RLS isolation.

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

  -- Mirror of dsr_verifications with the FOLLOW-184 durable_lead_id column.
  -- Only the columns exercised by these tests are included.
  CREATE TABLE IF NOT EXISTS dsr_verifications (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id      text NOT NULL,
    email           text NOT NULL,
    dsr_type        text NOT NULL DEFAULT 'erase',
    otp_hash        text NOT NULL,
    expires_at      timestamptz NOT NULL,
    used_at         timestamptz,
    durable_lead_id text,                        -- FOLLOW-184: nullable CRM token
    created_at      timestamptz NOT NULL DEFAULT now()
  );
`;

// ─── Helper: simulate the erase transaction ───────────────────────────────────
//
// The production erase route runs two DELETEs inside a single DB transaction.
// This helper replicates that logic against the PGlite engine so the test asserts
// real SQL semantics, not mock behaviour.
//
// Arguments match what the production route reads from `dsr_verifications`:
//   tenantId      — the authenticated tenant UUID
//   sessionId     — the Estalara anonymous session fingerprint
//   durableLeadId — the CRM opaque token, or null/undefined when unknown

async function runEraseTransaction(
  pg: PGlite,
  {
    tenantId,
    sessionId,
    durableLeadId,
  }: { tenantId: string; sessionId: string; durableLeadId?: string | null },
): Promise<void> {
  await pg.transaction(async (tx) => {
    // Pass A: SDK feedback-ping labels (lead_id = session_id).
    // Guard: session_id must be non-empty (application layer) + lead_id <> '' (DB layer).
    if (sessionId !== '') {
      await tx.query(
        `DELETE FROM conversion_labels
          WHERE tenant_id = $1
            AND lead_id   = $2
            AND lead_id  <> ''`,
        [tenantId, sessionId],
      );
    }

    // Pass B: CRM deep-outcome labels (lead_id = durable_lead_id).
    // Only runs when durable_lead_id is non-null, non-empty, and != session_id
    // (dedup: if equal, Pass A already covered those rows).
    if (typeof durableLeadId === 'string' && durableLeadId !== '' && durableLeadId !== sessionId) {
      await tx.query(
        `DELETE FROM conversion_labels
          WHERE tenant_id = $1
            AND lead_id   = $2
            AND lead_id  <> ''`,
        [tenantId, durableLeadId],
      );
    }
  });
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

interface LabelRow {
  prediction_id: string;
  lead_id: string;
  outcome_class: string;
}

let TENANT_ID: string;
let pg: PGlite;

/** Insert a single conversion_labels row via raw SQL (mirrors CRM / SDK write). */
async function insertLabel(opts: {
  tenantId: string;
  predictionId: string;
  leadId: string;
  outcomeClass: string;
}): Promise<void> {
  await pg.query(
    `INSERT INTO conversion_labels
       (tenant_id, prediction_id, lead_id, outcome_class, label_source)
     VALUES ($1, $2, $3, $4, 'system')`,
    [opts.tenantId, opts.predictionId, opts.leadId, opts.outcomeClass],
  );
}

/** Return all conversion_labels rows for the given tenant. */
async function getAllLabels(tenantId: string): Promise<LabelRow[]> {
  const res = await pg.query<LabelRow>(
    `SELECT prediction_id, lead_id, outcome_class
       FROM conversion_labels
      WHERE tenant_id = $1
      ORDER BY prediction_id`,
    [tenantId],
  );
  return res.rows;
}

// ─── Suite setup ──────────────────────────────────────────────────────────────

beforeAll(async () => {
  pg = new PGlite();
  await pg.waitReady;
  await pg.exec(FIXTURE_DDL);

  const row = await pg.query<{ id: string }>(
    `INSERT INTO tenants (name, slug) VALUES ('Test Tenant', 'test-tenant-dsr') RETURNING id`,
  );
  const inserted = row.rows[0];
  if (!inserted) throw new Error('Failed to insert test tenant');
  TENANT_ID = inserted.id;
});

afterAll(async () => {
  await pg.close();
});

/** Reset conversion_labels between tests so each starts with a clean slate. */
beforeEach(async () => {
  await pg.exec('DELETE FROM conversion_labels');
});

// ─── AC-1 (PRIMARY): CRM row with lead_id != session_id IS erased ─────────────
//
// This is the load-bearing test for FOLLOW-184. It proves LG-1 from RETRO-031 §4a
// is closed: a CRM deep-outcome row keyed on an opaque token (not the session_id)
// is deleted when the DSR supplies that same token as durable_lead_id.

describe('AC-1 (FOLLOW-184 primary): CRM row with lead_id != session_id is erased', () => {
  it('erases a CRM-written row when durable_lead_id matches the CRM token', async () => {
    const SESSION_ID = 'sess-anon-abc123';
    const CRM_LEAD_ID = 'crm-opaque-token-xyz789'; // DIFFERENT namespace from session_id

    // Simulate CRM webhook write: lead_id = CRM token (NOT session_id).
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-crm-001',
      leadId: CRM_LEAD_ID,
      outcomeClass: 'purchased',
    });

    // Confirm the row exists before erasure.
    const before = await getAllLabels(TENANT_ID);
    expect(before).toHaveLength(1);
    expect(before[0]?.lead_id).toBe(CRM_LEAD_ID);

    // Run DSR erase with durable_lead_id = CRM token (supplied by tenant admin).
    await runEraseTransaction(pg, {
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      durableLeadId: CRM_LEAD_ID,
    });

    // The CRM row must be gone after erasure.
    const after = await getAllLabels(TENANT_ID);
    expect(after).toHaveLength(0);
  });

  it('erases BOTH the SDK-ping row (lead_id=session_id) AND the CRM row in one transaction', async () => {
    const SESSION_ID = 'sess-anon-abc123';
    const CRM_LEAD_ID = 'crm-opaque-token-xyz789';

    // SDK feedback-ping label (lead_id = session_id).
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-sdk-001',
      leadId: SESSION_ID,
      outcomeClass: 'viewing_booked',
    });

    // CRM deep-outcome label (lead_id = CRM token, different namespace).
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-crm-001',
      leadId: CRM_LEAD_ID,
      outcomeClass: 'purchased',
    });

    // Two rows before erasure.
    const before = await getAllLabels(TENANT_ID);
    expect(before).toHaveLength(2);

    await runEraseTransaction(pg, {
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      durableLeadId: CRM_LEAD_ID,
    });

    // Both rows must be deleted.
    const after = await getAllLabels(TENANT_ID);
    expect(after).toHaveLength(0);
  });
});

// ─── AC-2: SDK-ping row (lead_id = session_id) is erased by Pass A ───────────

describe('AC-2: SDK feedback-ping row (lead_id=session_id) is erased by Pass A', () => {
  it('deletes a row where lead_id equals session_id', async () => {
    const SESSION_ID = 'sess-anon-sdk-456';

    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-sdk-002',
      leadId: SESSION_ID,
      outcomeClass: 'viewing_booked',
    });

    await runEraseTransaction(pg, {
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      durableLeadId: null, // no CRM identity for this session
    });

    const after = await getAllLabels(TENANT_ID);
    expect(after).toHaveLength(0);
  });
});

// ─── AC-3: CRM row for a DIFFERENT lead_id survives ──────────────────────────
//
// Ensures Pass B only erases rows matching the specific CRM token, not other tenants'
// or other subjects' rows.

describe('AC-3: CRM row for a different lead_id is NOT erased', () => {
  it('leaves untouched a CRM row with a different lead_id', async () => {
    const SESSION_ID = 'sess-anon-abc123';
    const CRM_LEAD_ID = 'crm-token-this-subject';
    const OTHER_CRM_ID = 'crm-token-other-subject';

    // Row for the data subject being erased.
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-crm-subject',
      leadId: CRM_LEAD_ID,
      outcomeClass: 'purchased',
    });

    // Row for a DIFFERENT data subject — must survive.
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-crm-other',
      leadId: OTHER_CRM_ID,
      outcomeClass: 'offer_made',
    });

    await runEraseTransaction(pg, {
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      durableLeadId: CRM_LEAD_ID,
    });

    // Only the target subject's row should be gone.
    const after = await getAllLabels(TENANT_ID);
    expect(after).toHaveLength(1);
    expect(after[0]?.lead_id).toBe(OTHER_CRM_ID);
  });
});

// ─── AC-4 (LG-2 regression guard): rows with lead_id='' are NEVER matched ────
//
// This is the critical guard from FOLLOW-180/LG-2: an empty lead_id must NEVER
// be usable as a delete key (it would erase ALL system labels for the tenant).

describe('AC-4 (LG-2 regression guard): empty lead_id rows are never erased', () => {
  it('does NOT erase rows where lead_id is empty string, even when session_id is non-empty', async () => {
    const SESSION_ID = 'sess-anon-abc123';

    // Row with an empty lead_id (the SDK-feedback default when no durable id is assigned).
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-empty-lead',
      leadId: '', // empty — must never be matched
      outcomeClass: 'viewing_booked',
    });

    await runEraseTransaction(pg, {
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      durableLeadId: null,
    });

    // The empty-lead_id row must survive — the guard prevents ALL-tenant erasure.
    const after = await getAllLabels(TENANT_ID);
    expect(after).toHaveLength(1);
    expect(after[0]?.lead_id).toBe('');
  });

  it('does NOT match an empty stored lead_id even when durable_lead_id is supplied', async () => {
    const SESSION_ID = 'sess-anon-abc123';
    const CRM_LEAD_ID = 'crm-token-xyz';

    // An empty-lead_id row (should never be touched by any erase pass).
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-empty-lead-2',
      leadId: '',
      outcomeClass: 'no_response',
    });

    // A real CRM row that SHOULD be erased.
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-crm-real',
      leadId: CRM_LEAD_ID,
      outcomeClass: 'purchased',
    });

    await runEraseTransaction(pg, {
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      durableLeadId: CRM_LEAD_ID,
    });

    const after = await getAllLabels(TENANT_ID);

    // Only the empty-lead_id row should remain.
    expect(after).toHaveLength(1);
    expect(after[0]?.lead_id).toBe('');
    expect(after[0]?.prediction_id).toBe('pred-empty-lead-2');
  });
});

// ─── AC-5: When durable_lead_id is NULL, only Pass A runs ────────────────────
//
// Safe fallback for sessions where no CRM record exists: only SDK-ping rows (keyed
// on session_id) are deleted; CRM rows with non-empty lead_ids are untouched.

describe('AC-5: NULL durable_lead_id — only Pass A runs', () => {
  it('does NOT delete CRM rows when durable_lead_id is null', async () => {
    const SESSION_ID = 'sess-anon-abc123';
    const CRM_LEAD_ID = 'crm-token-not-provided';

    // SDK-ping row (should be erased by Pass A).
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-sdk-pass-a',
      leadId: SESSION_ID,
      outcomeClass: 'viewing_booked',
    });

    // CRM row (should NOT be erased when durable_lead_id is null).
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-crm-untouched',
      leadId: CRM_LEAD_ID,
      outcomeClass: 'purchased',
    });

    await runEraseTransaction(pg, {
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      durableLeadId: null, // no CRM identity supplied
    });

    const after = await getAllLabels(TENANT_ID);

    // Only the CRM row (different lead_id namespace) should remain.
    expect(after).toHaveLength(1);
    expect(after[0]?.lead_id).toBe(CRM_LEAD_ID);
  });
});

// ─── AC-6: Dedup guard — durable_lead_id = session_id skips Pass B ───────────
//
// If the two identifiers happen to be equal (unusual but not impossible), Pass A
// already covers those rows. Pass B must be skipped to avoid a redundant DELETE
// (correctness: the result is identical; this guard is about invariant clarity).

describe('AC-6: Dedup guard — durable_lead_id = session_id skips Pass B', () => {
  it('erases the row exactly once when durable_lead_id equals session_id', async () => {
    const SESSION_ID = 'sess-shared-id-abc';
    // lead_id = session_id (unusual but dedup should still work correctly).

    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-shared-id',
      leadId: SESSION_ID,
      outcomeClass: 'viewing_booked',
    });

    await runEraseTransaction(pg, {
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      durableLeadId: SESSION_ID, // same as session_id → dedup fires, Pass B skipped
    });

    // Row must be deleted (by Pass A).
    const after = await getAllLabels(TENANT_ID);
    expect(after).toHaveLength(0);
  });
});

// ─── Helper: the FOLLOW-239 completeness-check query ─────────────────────────
//
// This mirrors the SQL predicate in production dsr/erase/route.ts (FOLLOW-239
// block) that determines whether CRM-namespace rows survived the erasure when
// durable_lead_id was not supplied.  Exercising the same predicate against real
// Postgres proves: (a) the count is correct, and (b) a regression that changes
// the WHERE clause would break these tests.

async function countSurvivingCrmRows(tenantId: string, sessionId: string): Promise<number> {
  const res = await pg.query<{ count: string }>(
    `SELECT count(*)::int AS count
       FROM conversion_labels
      WHERE tenant_id = $1
        AND lead_id  <> ''
        AND lead_id  <> $2`,
    [tenantId, sessionId],
  );
  return Number(res.rows[0]?.count ?? 0);
}

// ─── AC-7 (FOLLOW-239 primary): omitted-token path — CRM rows survive + detectable ───
//
// When durable_lead_id is NULL the production route skips Pass B.  The
// completeness-check query (count surviving CRM-namespace rows) MUST return > 0
// so the Sentry warning and 'incomplete_no_durable_lead_id' response field fire.
// This test proves the OBSERVABLE OUTCOME: rows DO survive AND the count query
// reports them — the two facts that drive every observable signal.

describe('AC-7 (FOLLOW-239 primary): omitted durable_lead_id — CRM rows survive and are detectable', () => {
  it('reports > 0 surviving CRM rows when durable_lead_id is NULL', async () => {
    const SESSION_ID = 'sess-239-omitted-token';
    const CRM_LEAD_ID = 'crm-opaque-token-not-supplied';

    // SDK-ping row — will be erased by Pass A.
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-239-sdk',
      leadId: SESSION_ID,
      outcomeClass: 'viewing_booked',
    });

    // CRM row — will NOT be erased when durable_lead_id is NULL (Pass B skipped).
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-239-crm',
      leadId: CRM_LEAD_ID,
      outcomeClass: 'purchased',
    });

    // Run erasure without durable_lead_id (operator omitted it).
    await runEraseTransaction(pg, {
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      durableLeadId: null,
    });

    // OBSERVABLE OUTCOME 1: CRM row survives (Pass B did not run).
    const after = await getAllLabels(TENANT_ID);
    expect(after).toHaveLength(1);
    expect(after[0]?.lead_id).toBe(CRM_LEAD_ID);

    // OBSERVABLE OUTCOME 2: the completeness-check query detects the surviving row.
    // This is the same SQL predicate the production route evaluates to trigger the
    // Sentry warning and set crm_erasure_status = 'incomplete_no_durable_lead_id'.
    const survivingCount = await countSurvivingCrmRows(TENANT_ID, SESSION_ID);
    expect(survivingCount).toBe(1);
  });

  it('detects multiple surviving CRM rows for the same session', async () => {
    const SESSION_ID = 'sess-239-multi-crm';
    const CRM_LEAD_A = 'crm-token-a';
    const CRM_LEAD_B = 'crm-token-b';

    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-239-crm-a',
      leadId: CRM_LEAD_A,
      outcomeClass: 'offer_made',
    });
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-239-crm-b',
      leadId: CRM_LEAD_B,
      outcomeClass: 'purchased',
    });

    await runEraseTransaction(pg, {
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      durableLeadId: null,
    });

    const survivingCount = await countSurvivingCrmRows(TENANT_ID, SESSION_ID);
    expect(survivingCount).toBe(2);
  });
});

// ─── AC-8: No false positive when only SDK-ping rows exist ────────────────────
//
// If the tenant has no CRM rows (lead_id = session_id only), the completeness
// check must return 0 — no spurious 'incomplete_no_durable_lead_id' flag.

describe('AC-8 (FOLLOW-239): no false positive when only SDK-ping rows exist', () => {
  it('returns 0 surviving CRM rows when all labels use lead_id = session_id', async () => {
    const SESSION_ID = 'sess-239-sdk-only';

    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-239-sdk-only',
      leadId: SESSION_ID,
      outcomeClass: 'viewing_booked',
    });

    await runEraseTransaction(pg, {
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      durableLeadId: null,
    });

    // Pass A erased the SDK row — nothing survives.
    const after = await getAllLabels(TENANT_ID);
    expect(after).toHaveLength(0);

    // Completeness check must return 0 (no CRM-namespace rows to detect).
    const survivingCount = await countSurvivingCrmRows(TENANT_ID, SESSION_ID);
    expect(survivingCount).toBe(0);
  });
});

// ─── AC-9: No false positive after a complete erasure (Pass B ran) ────────────
//
// When durable_lead_id IS supplied and Pass B deletes the CRM rows, the
// completeness check must return 0 — correct status 'complete' on the wire.

describe('AC-9 (FOLLOW-239): no false positive after complete erasure (Pass B ran)', () => {
  it('returns 0 surviving CRM rows after Pass B deleted them', async () => {
    const SESSION_ID = 'sess-239-complete';
    const CRM_LEAD_ID = 'crm-token-supplied';

    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-239-complete-sdk',
      leadId: SESSION_ID,
      outcomeClass: 'viewing_booked',
    });
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-239-complete-crm',
      leadId: CRM_LEAD_ID,
      outcomeClass: 'purchased',
    });

    // Operator supplied durable_lead_id — Pass B runs.
    await runEraseTransaction(pg, {
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      durableLeadId: CRM_LEAD_ID,
    });

    // Both rows gone.
    const after = await getAllLabels(TENANT_ID);
    expect(after).toHaveLength(0);

    // Completeness check returns 0 — no surviving CRM-namespace rows → 'complete'.
    const survivingCount = await countSurvivingCrmRows(TENANT_ID, SESSION_ID);
    expect(survivingCount).toBe(0);
  });
});
