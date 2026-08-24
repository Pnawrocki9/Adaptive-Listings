/**
 * Route-driven PGlite integration tests for FOLLOW-250 (AC2):
 * POST /api/dsr/erase handler against real PGlite SQL.
 *
 * Rule T compliance: this file imports and drives the ACTUAL POST handler from
 * apps/control-plane/src/app/api/dsr/erase/route.ts against a real PGlite
 * in-memory Postgres engine. Any WHERE-clause divergence in the production
 * erase route (dropped tenant_id, swapped namespace key, removed ne('')) BREAKS
 * these tests — unlike the SQL-semantics mirror (runEraseTransaction) in
 * packages/db/src/__tests__/crm-dsr-harness.test.ts and
 * packages/db/src/__tests__/dsr-crm-erasure.test.ts which only re-type the
 * predicates locally without importing the route.
 *
 * @vitest-environment node
 *
 * Why node environment?
 *   PGlite (WebAssembly Postgres) requires the Node.js WebAssembly runtime.
 *   The `@vitest-environment node` directive overrides the package default for
 *   this file only.
 *
 * Mocking strategy:
 *   - createAdminClient() → returns the PGlite-backed Drizzle client (factory
 *     pattern: _testDb set in beforeAll, getTestDb() called lazily by the mock).
 *   - writeDsrAuditLog → no-op (fire-and-forget ClickHouse audit, irrelevant).
 *   - @sentry/nextjs → no-op (not wired in test env).
 *   - CLICKHOUSE_URL unset → readClickHouseConfig() returns null →
 *     issueClickHouseEraseMutations() inserts 'done' no-op rows (built-in route
 *     behaviour, no mock needed). dsr_clickhouse_mutations table is in the fixture.
 *   - UPSTASH_REDIS_URL unset → deleteSessionFromRedis() is a structural no-op.
 *
 * ACs covered:
 *   AC2 (FOLLOW-250): the actual erase handler runs Pass A + Pass B deletes
 *     against PGlite. A WHERE-clause divergence in production BREAKS these tests.
 *
 * @module apps/control-plane/src/app/api/dsr/erase/route-driven-pglite.test
 */

import { NextRequest } from 'next/server';
import { createHash } from 'crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';

// ─── PGlite factory reference ─────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PGlite db; schema type is wide
let _testDb: ReturnType<typeof drizzlePglite<any>> | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- same reason
function getTestDb(): ReturnType<typeof drizzlePglite<any>> {
  if (!_testDb) throw new Error('PGlite test DB not initialised — is beforeAll() running?');
  return _testDb;
}

// ─── Module mocks (hoisted) ───────────────────────────────────────────────────

vi.mock('@estalara/db', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.mock importOriginal generic requires inline import() type
  const real = await importOriginal<typeof import('@estalara/db')>();
  return {
    ...real,
    createAdminClient: () => getTestDb(),
  };
});

vi.mock('../_clickhouse', () => ({
  DSR_AUDIT_ACTIONS: {
    initiated: 'initiated',
    completed: 'completed',
    expired: 'expired',
    failed: 'failed',
    crm_unverifiable: 'crm_unverifiable',
  },
  writeDsrAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/clickhouse-dsr', () => ({
  DSR_CLICKHOUSE_TABLES: [
    { table: 'events', column: 'session_id' },
    { table: 'adaptation_decisions', column: 'session_id' },
    { table: 'llm_calls', column: 'session_id' },
    { table: 'session_quality', column: 'session_id' },
    // intent_events omitted from this mocked inventory — this file's scope is
    // the conversion_labels/engagement_scores cascades. Since FOLLOW-581,
    // intent_events erases on `session_id` like every other table (covered in
    // apps/control-plane/src/app/api/dsr/erase/route.test.ts and
    // apps/control-plane/src/lib/__tests__/clickhouse-dsr.test.ts).
  ],
  readClickHouseConfig: vi.fn().mockReturnValue(null), // unset → no-op path
  issueEraseMutation: vi.fn(),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

// ─── Fixture DDL ──────────────────────────────────────────────────────────────
//
// All tables touched by the erase route:
//   - tenants, dsr_verifications (OTP lookup)
//   - session_embeddings, consent_records, engagement_scores (erase targets)
//   - conversion_labels (Pass A + Pass B)
//   - dsr_clickhouse_mutations (inserted when ClickHouse URL is unset = no-op rows)
//
// RLS policies are omitted — the admin client bypasses RLS.

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

  CREATE TABLE IF NOT EXISTS dsr_verifications (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id      text NOT NULL,
    email           text NOT NULL DEFAULT 'test@example.com',
    dsr_type        text NOT NULL DEFAULT 'erase',
    otp_hash        text NOT NULL,
    expires_at      timestamptz NOT NULL,
    used_at         timestamptz,
    durable_lead_id text,
    attempt_count   integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS intent_sessions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id        text NOT NULL,
    cross_session_id  text,
    started_at        timestamptz NOT NULL DEFAULT now(),
    last_event_at     timestamptz NOT NULL DEFAULT now(),
    finalized_at      timestamptz,
    final_archetype   text,
    final_confidence  numeric(4,3),
    signal_count      integer NOT NULL DEFAULT 0,
    quiz_completed    boolean NOT NULL DEFAULT false,
    quiz_leaf         text,
    chat_turns        integer NOT NULL DEFAULT 0,
    intent_state      jsonb
  );

  CREATE UNIQUE INDEX IF NOT EXISTS intent_sessions_tenant_session_unique
    ON intent_sessions (tenant_id, session_id);

  CREATE TABLE IF NOT EXISTS quiz_completions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id          text NOT NULL,
    resolved_archetype  text NOT NULL DEFAULT 'neutral',
    branch              text,
    q1_answer           integer,
    q2_answer           integer,
    q3_answer           integer,
    language            text NOT NULL DEFAULT 'en',
    created_at          timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS session_embeddings (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id        text NOT NULL,
    final_archetype   text,
    matched_archetype text,
    similarity_score  numeric(6,5),
    signal_count      integer NOT NULL DEFAULT 0,
    quiz_archetype    text,
    embedding         text,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS consent_records (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id   text NOT NULL,
    consent_type text NOT NULL,
    granted      boolean NOT NULL DEFAULT false,
    tos_version  text NOT NULL,
    granted_at   timestamptz NOT NULL DEFAULT now(),
    revoked_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS consent_records_tenant_session_idx
    ON consent_records (tenant_id, session_id);

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

  CREATE TABLE IF NOT EXISTS engagement_scores (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         uuid NOT NULL,
    session_id        text NOT NULL,
    engagement_score  numeric(6,5),
    dwell_score       numeric(6,5),
    interaction_score numeric(6,5),
    scroll_score      numeric(6,5),
    computed_at       timestamptz NOT NULL DEFAULT now(),
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
  );

  CREATE UNIQUE INDEX IF NOT EXISTS engagement_scores_tenant_session_idx
    ON engagement_scores (tenant_id, session_id);

  CREATE TABLE IF NOT EXISTS dsr_clickhouse_mutations (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dsr_verification_id  uuid NOT NULL REFERENCES dsr_verifications(id) ON DELETE CASCADE,
    tenant_id            uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id           text NOT NULL,
    table_name           text NOT NULL,
    mutation_id          text NOT NULL DEFAULT '',
    status               text NOT NULL DEFAULT 'pending',
    retry_count          integer NOT NULL DEFAULT 0,
    last_failed_reason   text,
    next_retry_at        timestamptz,
    alter_sql            text NOT NULL DEFAULT '',
    issued_at            timestamptz NOT NULL DEFAULT now(),
    completed_at         timestamptz,
    updated_at           timestamptz NOT NULL DEFAULT now()
  );
`;

// ─── Suite globals ─────────────────────────────────────────────────────────────

let pg: PGlite;
let TENANT_ID: string;
/**
 * FOLLOW-1108: a SECOND tenant used to prove the consent_records erasure is
 * tenant-scoped. session_id is a device fingerprint (packages/sdk/src/core/
 * session.ts generateSessionId()), not a per-tenant identifier, so the same
 * value legitimately exists under more than one tenant.
 */
let OTHER_TENANT_ID: string;

// ─── Helper: hash OTP (must match @/lib/dsr-otp hashOtp) ─────────────────────
//
// The production route calls hashOtp(token) and looks up dsr_verifications
// WHERE otp_hash = hash. We seed the DB with hashOtp(OTP) so the route finds
// the right row when we send that OTP in the request body.

function hashOtpLocal(otp: string): string {
  return createHash('sha256').update(otp).digest('hex');
}

// ─── Suite setup / teardown ───────────────────────────────────────────────────

beforeAll(async () => {
  pg = new PGlite();
  await pg.waitReady;
  await pg.exec(FIXTURE_DDL);

  _testDb = drizzlePglite(pg);

  const row = await pg.query<{ id: string }>(
    `INSERT INTO tenants (name, slug) VALUES ('DSR Erase Test Tenant', 'dsr-erase-pglite') RETURNING id`,
  );
  const t = row.rows[0];
  if (!t) throw new Error('Failed to insert test tenant');
  TENANT_ID = t.id;

  // FOLLOW-1108: second tenant — same session_id fingerprint, different tenant.
  const otherRow = await pg.query<{ id: string }>(
    `INSERT INTO tenants (name, slug) VALUES ('DSR Erase Other Tenant', 'dsr-erase-pglite-other') RETURNING id`,
  );
  const other = otherRow.rows[0];
  if (!other) throw new Error('Failed to insert second test tenant');
  OTHER_TENANT_ID = other.id;
});

afterAll(async () => {
  _testDb = null;
  await pg.close();
});

beforeEach(async () => {
  // Clean all data-bearing tables between tests.
  await pg.exec('DELETE FROM dsr_clickhouse_mutations');
  await pg.exec('DELETE FROM conversion_labels');
  await pg.exec('DELETE FROM engagement_scores');
  await pg.exec('DELETE FROM quiz_completions');
  await pg.exec('DELETE FROM intent_sessions');
  await pg.exec('DELETE FROM consent_records');
  await pg.exec('DELETE FROM session_embeddings');
  await pg.exec('DELETE FROM dsr_verifications');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── Import production handler ────────────────────────────────────────────────

import { POST as postErase } from './route';

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface LabelRow {
  prediction_id: string;
  lead_id: string;
  outcome_class: string;
}

async function getLabels(tenantId: string): Promise<LabelRow[]> {
  const res = await pg.query<LabelRow>(
    `SELECT prediction_id, lead_id, outcome_class
       FROM conversion_labels
      WHERE tenant_id = $1
      ORDER BY prediction_id`,
    [tenantId],
  );
  return res.rows;
}

/**
 * Seed a dsr_verifications row for the erase test.
 * Returns the OTP string (raw) so the request can include it.
 */
async function seedDsrVerification(opts: {
  sessionId: string;
  durableLeadId?: string | null;
}): Promise<{ otp: string; verificationId: string }> {
  const otp = '123456';
  const otpHash = hashOtpLocal(otp);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const res = await pg.query<{ id: string }>(
    `INSERT INTO dsr_verifications
       (tenant_id, session_id, email, dsr_type, otp_hash, expires_at, durable_lead_id)
     VALUES ($1, $2, 'test@example.com', 'erase', $3, $4, $5)
     RETURNING id`,
    [TENANT_ID, opts.sessionId, otpHash, expiresAt, opts.durableLeadId ?? null],
  );
  const row = res.rows[0];
  if (!row) throw new Error('Failed to insert dsr_verifications');
  return { otp, verificationId: row.id };
}

/** Insert a conversion_labels row for erasure testing. */
async function insertLabel(opts: {
  predictionId: string;
  leadId: string;
  outcomeClass: string;
}): Promise<void> {
  await pg.query(
    `INSERT INTO conversion_labels
       (tenant_id, prediction_id, lead_id, outcome_class, label_source)
     VALUES ($1, $2, $3, $4, 'system')`,
    [TENANT_ID, opts.predictionId, opts.leadId, opts.outcomeClass],
  );
}

/** FOLLOW-1108: insert a consent_records row for a given tenant + session. */
async function insertConsent(opts: {
  tenantId: string;
  sessionId: string;
  consentType: string;
}): Promise<void> {
  await pg.query(
    `INSERT INTO consent_records (tenant_id, session_id, consent_type, granted, tos_version)
     VALUES ($1, $2, $3, true, 'tos-v1')`,
    [opts.tenantId, opts.sessionId, opts.consentType],
  );
}

/** FOLLOW-1108: read back consent rows for a tenant. */
async function getConsent(
  tenantId: string,
): Promise<{ session_id: string; consent_type: string }[]> {
  const res = await pg.query<{ session_id: string; consent_type: string }>(
    `SELECT session_id, consent_type FROM consent_records WHERE tenant_id = $1 ORDER BY consent_type`,
    [tenantId],
  );
  return res.rows;
}

function makeEraseRequest(otp: string, requestId: string): NextRequest {
  return new NextRequest('http://localhost/api/dsr/erase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: requestId, token: otp }),
  });
}

// ─── AC2 (FOLLOW-250): erase handler — Pass A deletes SDK-ping labels ─────────

describe('AC2a (FOLLOW-250): erase handler erases SDK-ping labels (Pass A)', () => {
  it('deletes conversion_labels WHERE lead_id = session_id', async () => {
    const SESSION_ID = 'sess-erase-passA-001';
    const { otp, verificationId } = await seedDsrVerification({ sessionId: SESSION_ID });

    await insertLabel({
      predictionId: 'pred-passA-sdk',
      leadId: SESSION_ID,
      outcomeClass: 'viewing_booked',
    });

    const before = await getLabels(TENANT_ID);
    expect(before).toHaveLength(1);

    const res = await postErase(makeEraseRequest(otp, verificationId));
    expect(res.status).toBe(200);

    const after = await getLabels(TENANT_ID);
    expect(after).toHaveLength(0);
  });

  it('leaves rows for other sessions untouched (tenant isolation within Pass A)', async () => {
    const SESSION_ID = 'sess-erase-passA-iso';
    const OTHER_SESSION = 'sess-erase-other';
    const { otp, verificationId } = await seedDsrVerification({ sessionId: SESSION_ID });

    // Row for the target session — should be erased.
    await insertLabel({
      predictionId: 'pred-passA-target',
      leadId: SESSION_ID,
      outcomeClass: 'viewing_booked',
    });
    // Row for a different session — must survive.
    await insertLabel({
      predictionId: 'pred-passA-other',
      leadId: OTHER_SESSION,
      outcomeClass: 'viewing_booked',
    });

    const res = await postErase(makeEraseRequest(otp, verificationId));
    expect(res.status).toBe(200);

    const after = await getLabels(TENANT_ID);
    expect(after).toHaveLength(1);
    expect(after[0]!.lead_id).toBe(OTHER_SESSION);
  });
});

// ─── AC2 (FOLLOW-250): erase handler — Pass B deletes CRM labels ──────────────

describe('AC2b (FOLLOW-250): erase handler erases CRM labels (Pass B)', () => {
  it('deletes conversion_labels WHERE lead_id = durable_lead_id when supplied', async () => {
    const SESSION_ID = 'sess-erase-passB-001';
    const CRM_LEAD = 'crm-token-passB-001';
    const { otp, verificationId } = await seedDsrVerification({
      sessionId: SESSION_ID,
      durableLeadId: CRM_LEAD,
    });

    await insertLabel({
      predictionId: 'pred-passB-crm',
      leadId: CRM_LEAD,
      outcomeClass: 'purchased',
    });

    const before = await getLabels(TENANT_ID);
    expect(before).toHaveLength(1);

    const res = await postErase(makeEraseRequest(otp, verificationId));
    expect(res.status).toBe(200);

    const after = await getLabels(TENANT_ID);
    expect(after).toHaveLength(0);
  });

  it('erases both Pass A (session_id) and Pass B (durable_lead_id) in one call', async () => {
    const SESSION_ID = 'sess-erase-both-001';
    const CRM_LEAD = 'crm-token-both-001';
    const { otp, verificationId } = await seedDsrVerification({
      sessionId: SESSION_ID,
      durableLeadId: CRM_LEAD,
    });

    await insertLabel({
      predictionId: 'pred-both-sdk',
      leadId: SESSION_ID,
      outcomeClass: 'viewing_booked',
    });
    await insertLabel({
      predictionId: 'pred-both-crm',
      leadId: CRM_LEAD,
      outcomeClass: 'purchased',
    });

    const before = await getLabels(TENANT_ID);
    expect(before).toHaveLength(2);

    const res = await postErase(makeEraseRequest(otp, verificationId));
    expect(res.status).toBe(200);

    const after = await getLabels(TENANT_ID);
    expect(after).toHaveLength(0);
  });

  it('does NOT erase CRM row when durable_lead_id is NULL (Pass B skipped)', async () => {
    const SESSION_ID = 'sess-erase-null-durable';
    const CRM_LEAD = 'crm-token-null-durable';
    const { otp, verificationId } = await seedDsrVerification({
      sessionId: SESSION_ID,
      durableLeadId: null, // Pass B must not run
    });

    await insertLabel({
      predictionId: 'pred-null-crm',
      leadId: CRM_LEAD,
      outcomeClass: 'purchased',
    });

    const res = await postErase(makeEraseRequest(otp, verificationId));
    expect(res.status).toBe(200);

    // CRM row must survive — Pass B was skipped.
    const after = await getLabels(TENANT_ID);
    expect(after).toHaveLength(1);
    expect(after[0]!.lead_id).toBe(CRM_LEAD);
  });
});

// ─── AC2 (FOLLOW-250): LG-2 empty lead_id guard ──────────────────────────────

describe('AC2c (FOLLOW-250): LG-2 guard — empty lead_id rows are never erased', () => {
  it('does NOT erase a row where lead_id is empty string', async () => {
    const SESSION_ID = 'sess-erase-empty-guard';
    const { otp, verificationId } = await seedDsrVerification({ sessionId: SESSION_ID });

    // Row with empty lead_id — the ne(conversionLabels.leadId, '') guard must protect it.
    await insertLabel({
      predictionId: 'pred-empty-lead',
      leadId: '',
      outcomeClass: 'no_response',
    });

    const res = await postErase(makeEraseRequest(otp, verificationId));
    expect(res.status).toBe(200);

    // Empty-lead_id row must survive — the guard prevents tenant-wide erasure.
    const after = await getLabels(TENANT_ID);
    expect(after).toHaveLength(1);
    expect(after[0]!.lead_id).toBe('');
  });
});

// ─── AC2 (FOLLOW-250): OTP validation errors ─────────────────────────────────

describe('AC2d (FOLLOW-250): erase handler OTP validation', () => {
  it('returns 404 when request_id does not match any dsr_verifications row', async () => {
    const res = await postErase(makeEraseRequest('999999', '00000000-0000-0000-0000-000000000000'));
    expect(res.status).toBe(404);
  });

  it('returns 401 when OTP is expired', async () => {
    const otp = '654321';
    const otpHash = hashOtpLocal(otp);
    // Insert a row with expires_at in the past.
    const inserted = await pg.query<{ id: string }>(
      `INSERT INTO dsr_verifications
         (tenant_id, session_id, email, dsr_type, otp_hash, expires_at)
       VALUES ($1, 'sess-expired', 'e@example.com', 'erase', $2, NOW() - INTERVAL '1 hour')
       RETURNING id`,
      [TENANT_ID, otpHash],
    );
    const expiredRequestId = inserted.rows[0]?.id;
    if (!expiredRequestId) throw new Error('Failed to insert expired dsr_verifications row');

    const res = await postErase(makeEraseRequest(otp, expiredRequestId));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('token_expired');
  });

  it('returns 401 when OTP has already been used', async () => {
    const SESSION_ID = 'sess-erase-already-used';
    const { otp, verificationId } = await seedDsrVerification({ sessionId: SESSION_ID });

    // First call — marks the token as used.
    await postErase(makeEraseRequest(otp, verificationId));

    // Second call — must be rejected.
    const res = await postErase(makeEraseRequest(otp, verificationId));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('token_already_used');
  });
});

// ─── AC2 (FOLLOW-250): crm_erasure_status in the 200 response ────────────────

describe('AC2e (FOLLOW-250): crm_erasure_status field in the 200 response', () => {
  it('returns crm_erasure_status=complete when Pass B ran', async () => {
    const SESSION_ID = 'sess-erase-status-complete';
    const CRM_LEAD = 'crm-token-status-complete';
    const { otp, verificationId } = await seedDsrVerification({
      sessionId: SESSION_ID,
      durableLeadId: CRM_LEAD,
    });

    await insertLabel({
      predictionId: 'pred-status-complete',
      leadId: CRM_LEAD,
      outcomeClass: 'purchased',
    });

    const res = await postErase(makeEraseRequest(otp, verificationId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { crm_erasure_status: string };
    expect(body.crm_erasure_status).toBe('complete');
  });

  it('returns crm_erasure_status=complete when no CRM rows exist for the tenant', async () => {
    const SESSION_ID = 'sess-erase-status-no-crm';
    const { otp, verificationId } = await seedDsrVerification({ sessionId: SESSION_ID });
    // No CRM rows exist at all → complete (no capability gap).

    const res = await postErase(makeEraseRequest(otp, verificationId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { crm_erasure_status: string };
    expect(body.crm_erasure_status).toBe('complete');
  });

  it('returns crm_erasure_status=crm_tenant_unverifiable when Pass B was skipped but CRM rows exist', async () => {
    const SESSION_ID = 'sess-erase-status-unverifiable';
    const CRM_LEAD = 'crm-token-unverifiable';
    // No durable_lead_id supplied — Pass B skipped.
    const { otp, verificationId } = await seedDsrVerification({
      sessionId: SESSION_ID,
      durableLeadId: null,
    });

    // Seed a CRM-namespace row (non-empty lead_id != session_id).
    await insertLabel({
      predictionId: 'pred-unverifiable-crm',
      leadId: CRM_LEAD,
      outcomeClass: 'purchased',
    });

    const res = await postErase(makeEraseRequest(otp, verificationId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { crm_erasure_status: string };
    expect(body.crm_erasure_status).toBe('crm_tenant_unverifiable');
  });
});

// ─── FOLLOW-1108: consent_records erasure must be tenant-scoped ──────────────
//
// The erase transaction previously deleted consent_records on session_id ALONE
// (no tenant_id predicate) while both sibling conversion_labels deletes in the
// same transaction carried eq(tenantId) + ne(leadId, ''). session_id is a device
// fingerprint (unkeyed SHA-256 over user-agent/screen/timezone/language —
// packages/sdk/src/core/session.ts), so the same value can belong to different
// people and to different tenants. These tests fail against the pre-fix route.

describe('FOLLOW-1108: consent_records erasure is tenant-scoped', () => {
  it("erases only the requesting tenant's consent rows when two tenants share a session_id", async () => {
    const SHARED_SESSION = 'sess-shared-fingerprint-1108';
    const { otp, verificationId } = await seedDsrVerification({ sessionId: SHARED_SESSION });

    // Same fingerprint, two tenants — the DSR belongs to TENANT_ID only.
    await insertConsent({
      tenantId: TENANT_ID,
      sessionId: SHARED_SESSION,
      consentType: 'behavioral_tracking',
    });
    await insertConsent({
      tenantId: OTHER_TENANT_ID,
      sessionId: SHARED_SESSION,
      consentType: 'behavioral_tracking',
    });

    expect(await getConsent(TENANT_ID)).toHaveLength(1);
    expect(await getConsent(OTHER_TENANT_ID)).toHaveLength(1);

    const res = await postErase(makeEraseRequest(otp, verificationId));
    expect(res.status).toBe(200);

    // Requesting tenant's row is erased (Art. 17 completeness preserved)...
    expect(await getConsent(TENANT_ID)).toHaveLength(0);
    // ...and the OTHER tenant's row — a different controller's legal proof of
    // consent — survives. This is the assertion that fails without tenant_id.
    const survivors = await getConsent(OTHER_TENANT_ID);
    expect(survivors).toHaveLength(1);
    expect(survivors[0]!.session_id).toBe(SHARED_SESSION);
  });

  it("does not touch the requesting tenant's OTHER sessions", async () => {
    const SESSION_ID = 'sess-1108-target';
    const UNRELATED_SESSION = 'sess-1108-unrelated';
    const { otp, verificationId } = await seedDsrVerification({ sessionId: SESSION_ID });

    await insertConsent({
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      consentType: 'behavioral_tracking',
    });
    await insertConsent({
      tenantId: TENANT_ID,
      sessionId: UNRELATED_SESSION,
      consentType: 'quiz_completion',
    });

    const res = await postErase(makeEraseRequest(otp, verificationId));
    expect(res.status).toBe(200);

    const remaining = await getConsent(TENANT_ID);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.session_id).toBe(UNRELATED_SESSION);
  });

  it('never erases wholesale when the DSR session_id is empty (LG-2 analogue)', async () => {
    // dsr_verifications.session_id is text NOT NULL and POST /api/dsr/initiate
    // validates z.string().min(1), so '' cannot enter through the API — this is
    // the same defence-in-depth the conversion_labels ne(leadId, '') guard gives.
    const { otp, verificationId } = await seedDsrVerification({ sessionId: '' });

    await insertConsent({ tenantId: TENANT_ID, sessionId: '', consentType: 'behavioral_tracking' });
    await insertConsent({
      tenantId: TENANT_ID,
      sessionId: 'sess-1108-bystander',
      consentType: 'quiz_completion',
    });

    const res = await postErase(makeEraseRequest(otp, verificationId));
    expect(res.status).toBe(200);

    // Both rows survive: the empty key matches nothing.
    expect(await getConsent(TENANT_ID)).toHaveLength(2);
  });
});
