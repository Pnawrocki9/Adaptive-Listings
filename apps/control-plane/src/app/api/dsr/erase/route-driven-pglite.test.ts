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
 *   - UPSTASH_REDIS_URL unset → the session Redis erase reports `not_configured` (FOLLOW-1308);
 *     the FOLLOW-1316 block below runs it against the Redis test double.
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
    // intent_events omitted from this mocked inventory — this file's scope is
    // the conversion_labels cascade. Since FOLLOW-581,
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

// FOLLOW-1316: the buyer-profile describe below restores through the real `/api/adapt`. These only
// replace what that route reads beyond the store; the erase route uses none of them.
vi.mock('@/lib/llm-gateway', () => ({
  callLlmGateway: vi.fn().mockResolvedValue({
    directives: [{ type: 'text', slot: 'cta', value: 'copy', archetype: 'x', confidence: 0.9 }],
  }),
}));
vi.mock('@/lib/al-enablement', () => ({
  resolveAlEnablement: vi.fn().mockResolvedValue({ off: false, reason: null }),
}));
vi.mock('@/lib/rag-retrieval', () => ({ retrieveListingContext: vi.fn().mockResolvedValue({}) }));
vi.mock('@/lib/tenant-schema', () => ({ getTenantSchema: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/demo-override-store', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getDemoOverride: vi.fn().mockResolvedValue({ enabled: false }),
}));

// ─── Fixture DDL ──────────────────────────────────────────────────────────────
//
// All tables touched by the erase route:
//   - tenants, dsr_verifications (OTP lookup)
//   - consent_records (erase target). engagement_scores (dropped by FOLLOW-1268) and
//     session_embeddings (dropped by handover H004, FOLLOW-1308) are deliberately ABSENT: a
//     route that still touched either would fail here with `relation ... does not exist`.
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
  await pg.exec('DELETE FROM quiz_completions');
  await pg.exec('DELETE FROM intent_sessions');
  await pg.exec('DELETE FROM consent_records');
  await pg.exec('DELETE FROM dsr_verifications');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── Import production handler ────────────────────────────────────────────────

import { POST as postErase } from './route';
import { POST as postAdapt } from '../../adapt/route';
import { writeDsrAuditLog } from '../_clickhouse';
import * as Sentry from '@sentry/nextjs';
import { createRedisTestDouble, type RedisTestDouble } from '@/lib/__tests__/redis-test-double';

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

// ─── FOLLOW-1316 (R31, R34, NC-4): optional `xid`, awaited inline ─────────────

describe('FOLLOW-1316: POST /api/dsr/erase with an xid', () => {
  const OPS_KEY = 'buyer-profile-ops-key';
  const DAY_MS = 24 * 60 * 60 * 1000;
  const XID = '7f3f1c6e-2b1a-4c3d-9e8f-1a2b3c4d5e6f';
  const createdAt = Date.now() - DAY_MS;
  // TENANT_ID is assigned in beforeAll, so this runs per test, not at collection.
  const key = (): string =>
    `buyer_profile:${TENANT_ID}:${createHash('sha256').update(XID).digest('hex')}`;
  const realFetch = globalThis.fetch;
  let redis: RedisTestDouble;

  const adapt = async (body: Record<string, unknown>): Promise<Record<string, unknown>> => {
    const res = await postAdapt(
      new NextRequest('http://localhost/api/adapt', {
        method: 'POST',
        headers: { authorization: `Bearer ${OPS_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          tenant_id: TENANT_ID,
          session_id: `s${String(Math.random()).slice(2)}`,
          page_type: 'listing_list',
          holdout_pct: 0,
          consent_state: 'consented',
          xid: XID,
          xid_created_at: createdAt,
          ...body,
        }),
      }),
    );
    return (await res.json()) as Record<string, unknown>;
  };

  const seedAndProveRestore = async (): Promise<void> => {
    await adapt({ archetype_hint: 'yield_hunter', confidence: 0.86, archetype_source: 'quiz' });
    await vi.waitFor(
      async () => {
        expect(await redis.raw(['EXISTS', key()])).toBe(1);
      },
      { timeout: 10_000 },
    );
    const restored = await adapt({});
    expect(restored.archetype).toBe('yield_hunter');
    expect(restored.profile_restore).toBe('restored');
  };

  const eraseWith = async (body: Record<string, unknown>): Promise<Response> => {
    const { otp, verificationId } = await seedDsrVerification({ sessionId: 'dsr-session' });
    return postErase(
      new NextRequest('http://localhost/api/dsr/erase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: verificationId, token: otp, ...body }),
      }),
    );
  };

  beforeEach(() => {
    redis = createRedisTestDouble(realFetch);
    vi.mocked(writeDsrAuditLog).mockClear();
    vi.mocked(Sentry.captureException).mockClear();
    vi.stubEnv('BUYER_PROFILE_ENABLED', 'true');
    vi.stubEnv('UPSTASH_REDIS_URL', redis.url);
    vi.stubEnv('UPSTASH_REDIS_TOKEN', 'local-dev-token');
    vi.stubEnv('ADAPT_API_KEY', OPS_KEY);
    vi.stubEnv('OPS_TENANT_ID', TENANT_ID);
    vi.stubEnv('DEMO_MODE', '1');
    vi.stubEnv('DEMO_MODE_JWT_SECRET', 'x'.repeat(40));
    vi.stubEnv('CLICKHOUSE_URL', '');
    vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) => {
      const url = input.toString();
      if (url.startsWith(redis.url)) return redis.handle(url, init);
      return Promise.reject(new Error(`unexpected fetch ${url}`));
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await redis.cleanup([
      key(),
      `buyer_profile_tombstone:${TENANT_ID}:${createHash('sha256').update(XID).digest('hex')}`,
    ]);
  });

  it('deletes the key before answering, and the same xid then gets neutral (NC-4)', async () => {
    await seedAndProveRestore();

    const res = await eraseWith({ xid: XID });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.buyer_profile_erasure).toBe('deleted');
    expect(body.deleted_at).toBeDefined();
    // Inline: gone at the moment the response exists, no settling needed.
    expect(await redis.raw(['EXISTS', key()])).toBe(0);
    const replay = await adapt({});
    expect(replay.archetype).toBe('neutral');
    expect(replay.directives).toEqual([]);
  });

  it('with no xid the profile stays and the response says none was asked for', async () => {
    await seedAndProveRestore();

    const res = await eraseWith({});

    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).buyer_profile_erasure).toBe(
      'not_requested',
    );
    expect(await redis.raw(['EXISTS', key()])).toBe(1);
  });

  const post = (body: Record<string, unknown>): Promise<Response> =>
    postErase(
      new NextRequest('http://localhost/api/dsr/erase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
  const usedAt = async (id: string): Promise<unknown> =>
    (
      await pg.query<{ used_at: unknown }>('SELECT used_at FROM dsr_verifications WHERE id = $1', [
        id,
      ])
    ).rows[0]?.used_at;
  const consentRows = async (): Promise<number> =>
    (
      await pg.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM consent_records WHERE session_id = 'dsr-session'",
      )
    ).rows[0]?.n ?? -1;

  it('a store failure spends nothing and touches nothing, and the same OTP then succeeds', async () => {
    if (redis.real) return;
    await seedAndProveRestore();
    await insertConsent({
      tenantId: TENANT_ID,
      sessionId: 'dsr-session',
      consentType: 'profiling',
    });
    const { otp, verificationId } = await seedDsrVerification({ sessionId: 'dsr-session' });
    const request = { request_id: verificationId, token: otp, xid: XID };
    redis.failHttp(403);

    const failed = await post(request);

    expect(failed.status).toBe(503);
    const body = (await failed.json()) as Record<string, unknown>;
    expect(body.buyer_profile_erasure).toBe('failed');
    expect(body.deleted_at).toBeUndefined();
    expect(await usedAt(verificationId)).toBeNull();
    expect(await consentRows()).toBe(1);
    await vi.waitFor(() => {
      expect(vi.mocked(writeDsrAuditLog)).toHaveBeenCalled();
    });
    expect(vi.mocked(writeDsrAuditLog).mock.lastCall?.[0].action).toBe('failed');
    redis.failHttp(null);
    expect(await redis.raw(['EXISTS', key()])).toBe(1);

    const retry = await post(request);

    expect(retry.status).toBe(200);
    expect(((await retry.json()) as Record<string, unknown>).buyer_profile_erasure).toBe('deleted');
    expect(await redis.raw(['EXISTS', key()])).toBe(0);
    expect(await usedAt(verificationId)).not.toBeNull();
    expect(await consentRows()).toBe(0);
  });

  // ── FOLLOW-1308 (Codex R-01): the session's Redis keys, checked and confirmed ──
  // A function: TENANT_ID is assigned in beforeAll.
  const sessionKeys = (): string[] => [
    'session:dsr-session:intent',
    'session:dsr-session:adapt',
    `shadow:${TENANT_ID}:dsr-session:chat_intent`,
  ];
  const seedSessionKeys = async (): Promise<void> => {
    for (const k of sessionKeys()) await redis.raw(['SET', k, '1']);
  };

  it('R-01: erases session:{id}:* and the chat-intent shadow key, absence confirmed, before answering', async () => {
    await seedSessionKeys();
    await redis.raw(['SET', 'session:other-session:intent', '1']);

    const res = await eraseWith({});

    expect(res.status).toBe(200);
    expect(((await res.json()) as Record<string, unknown>).redis_erasure).toBe('erased');
    for (const k of sessionKeys()) expect(await redis.raw(['EXISTS', k])).toBe(0);
    expect(await redis.raw(['EXISTS', 'session:other-session:intent'])).toBe(1);
    await redis.cleanup(['session:other-session:intent']);
  });

  it.each(['SCAN', 'DEL', 'EXISTS'])(
    'R-01: a %s error is an explicit 503, never completed; the OTP stays unspent and the retry confirms absence',
    async (command) => {
      if (redis.real) return;
      await seedSessionKeys();
      await insertConsent({
        tenantId: TENANT_ID,
        sessionId: 'dsr-session',
        consentType: 'profiling',
      });
      const { otp, verificationId } = await seedDsrVerification({ sessionId: 'dsr-session' });
      const request = { request_id: verificationId, token: otp };
      redis.failCommand(command);

      const failed = await post(request);

      expect(failed.status).toBe(503);
      const body = (await failed.json()) as Record<string, unknown>;
      expect((body.error as { code: string }).code).toBe('redis_erase_failed');
      expect(body.redis_erasure).toBe('failed');
      expect(body.deleted_at).toBeUndefined();
      expect(await usedAt(verificationId)).toBeNull();
      expect(await consentRows()).toBe(1);
      await vi.waitFor(() => {
        expect(vi.mocked(writeDsrAuditLog)).toHaveBeenCalled();
      });
      const actions = vi.mocked(writeDsrAuditLog).mock.calls.map((c) => c[0].action);
      expect(actions).not.toContain('completed');

      redis.failCommand(null);
      const retry = await post(request);

      expect(retry.status).toBe(200);
      expect(((await retry.json()) as Record<string, unknown>).redis_erasure).toBe('erased');
      for (const k of sessionKeys()) expect(await redis.raw(['EXISTS', k])).toBe(0);
      expect(await usedAt(verificationId)).not.toBeNull();
    },
  );

  it('R-01: an HTTP 403 from the store (a read-only token) is a 503, never completed', async () => {
    if (redis.real) return;
    await seedSessionKeys();
    const { otp, verificationId } = await seedDsrVerification({ sessionId: 'dsr-session' });
    redis.failHttp(403);

    const res = await post({ request_id: verificationId, token: otp });

    redis.failHttp(null);
    expect(res.status).toBe(503);
    expect(((await res.json()) as Record<string, unknown>).redis_erasure).toBe('failed');
    expect(await usedAt(verificationId)).toBeNull();
    expect(await redis.raw(['EXISTS', sessionKeys()[0] ?? ''])).toBe(1);
  });

  it('a Postgres failure leaves the OTP unspent and no profile, and the same OTP then succeeds', async () => {
    await seedAndProveRestore();
    await insertConsent({
      tenantId: TENANT_ID,
      sessionId: 'dsr-session',
      consentType: 'profiling',
    });
    const { otp, verificationId } = await seedDsrVerification({ sessionId: 'dsr-session' });
    const request = { request_id: verificationId, token: otp, xid: XID };
    await pg.exec('ALTER TABLE intent_sessions RENAME TO intent_sessions_away');

    let failed: Response;
    try {
      failed = await post(request);
    } finally {
      await pg.exec('ALTER TABLE intent_sessions_away RENAME TO intent_sessions');
    }

    expect(failed.status).toBe(500);
    const body = (await failed.json()) as Record<string, unknown>;
    expect(body.deleted_at).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('intent_sessions');
    // The profile is gone, and the rolled-back transaction spent nothing and deleted nothing.
    expect(await redis.raw(['EXISTS', key()])).toBe(0);
    expect(await usedAt(verificationId)).toBeNull();
    expect(await consentRows()).toBe(1);
    expect((await adapt({})).archetype).toBe('neutral');

    const retry = await post(request);

    expect(retry.status).toBe(200);
    expect(((await retry.json()) as Record<string, unknown>).buyer_profile_erasure).toBe(
      'not_found',
    );
    expect(await usedAt(verificationId)).not.toBeNull();
    expect(await consentRows()).toBe(0);

    // Spent exactly once: a third attempt is refused.
    expect((await post(request)).status).toBe(401);
  });

  it('a wrong OTP reaches neither the store nor the transaction', async () => {
    await seedAndProveRestore();
    const { verificationId } = await seedDsrVerification({ sessionId: 'dsr-session' });
    redis.requests.length = 0;

    const res = await post({ request_id: verificationId, token: '000000', xid: XID });

    expect(res.status).toBe(401);
    expect(redis.requests).toEqual([]);
    expect(await redis.raw(['EXISTS', key()])).toBe(1);
  });

  it('after a DSR erase the tombstone lasts 90 days and holds only a hash, because that browser keeps writing', async () => {
    await seedAndProveRestore();
    await eraseWith({ xid: XID });

    const tombstone = `buyer_profile_tombstone:${TENANT_ID}:${createHash('sha256').update(XID).digest('hex')}`;
    const ttl = Number(await redis.raw(['PTTL', tombstone]));
    expect(ttl).toBeGreaterThan(89.9 * DAY_MS);
    expect(ttl).toBeLessThanOrEqual(90 * DAY_MS);
    expect(await redis.raw(['GET', tombstone])).toBe('1');
    expect(tombstone).not.toContain(XID);

    await adapt({ archetype_hint: 'family_buyer', confidence: 0.9, archetype_source: 'quiz' });
    await new Promise((resolve) => setTimeout(resolve, redis.real ? 500 : 25));

    expect(await redis.raw(['EXISTS', key()])).toBe(0);
    expect((await adapt({})).archetype).toBe('neutral');
  });

  it('the audit call and Sentry carry no xid and no hash of it (R34, R16)', async () => {
    await seedAndProveRestore();
    await eraseWith({ xid: XID });
    await vi.waitFor(() => {
      expect(vi.mocked(writeDsrAuditLog)).toHaveBeenCalled();
    });

    const sinks = JSON.stringify([
      vi.mocked(writeDsrAuditLog).mock.calls as unknown,
      vi.mocked(Sentry.captureException).mock.calls.map((c) => String(c[0])),
    ]);
    expect(sinks).not.toContain(XID);
    expect(sinks).not.toContain(createHash('sha256').update(XID).digest('hex'));
    expect(vi.mocked(writeDsrAuditLog).mock.lastCall?.[0].action).toBe('completed');
  });

  it('an xid that is not a strict v4 is a 400 and the OTP is not spent', async () => {
    const { otp, verificationId } = await seedDsrVerification({ sessionId: 'dsr-session' });
    const res = await postErase(
      new NextRequest('http://localhost/api/dsr/erase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: verificationId, token: otp, xid: 'nope' }),
      }),
    );
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toContain('nope');
    const row = await pg.query<{ used_at: unknown }>(
      'SELECT used_at FROM dsr_verifications WHERE id = $1',
      [verificationId],
    );
    expect(row.rows[0]?.used_at).toBeNull();
  });
});
