/**
 * Route-driven PGlite integration tests for FOLLOW-256 (AC1 + AC2 + AC3):
 * GET /api/dsr/access and GET /api/dsr/portability handlers against real PGlite SQL.
 *
 * Rule T compliance: this file imports and drives the ACTUAL GET handlers from
 * apps/control-plane/src/app/api/dsr/access/route.ts and
 * apps/control-plane/src/app/api/dsr/portability/route.ts against a real PGlite
 * in-memory Postgres engine. Any WHERE-clause divergence in either production
 * disclosure route (dropped tenant_id, swapped namespace key, removed ne(''))
 * BREAKS these tests — unlike the SQL-semantics mirror (runDisclosureRead) in
 * packages/db/src/__tests__/dsr-crm-disclosure.test.ts which only re-types the
 * predicates without importing the routes.
 *
 * @vitest-environment node
 *
 * Why node environment?
 *   PGlite (WebAssembly Postgres) requires the Node.js WebAssembly runtime.
 *   The `@vitest-environment node` directive overrides the package default for
 *   this file only.
 *
 * Mocking strategy:
 *   - createAdminClient() → PGlite-backed Drizzle client (lazy factory pattern).
 *   - writeDsrAuditLog → no-op (fire-and-forget ClickHouse audit, irrelevant).
 *   - @sentry/nextjs → no-op.
 *
 * ACs covered:
 *   AC1 (FOLLOW-256): both the access GET and the portability GET handlers read
 *     conversion_labels on BOTH identifier namespaces (Pass A + Pass B). A WHERE-
 *     clause divergence (dropped tenant_id, swapped namespace key, removed ne(''))
 *     in either production handler BREAKS these tests.
 *   AC2 (FOLLOW-256): route-driven tenant isolation — a second tenant's rows with
 *     the same lead_id values do NOT appear in tenant 1's output.
 *   AC3 (FOLLOW-256): seed once, drive BOTH handlers, assert access and portability
 *     produce an identical conversion_labels set (true access/portability parity).
 *
 *   FOLLOW-558 / audit A3-F-06: engagement_scores, quiz_completions, and
 *     intent_sessions — all three already covered by the DSR erase cascade in
 *     `apps/control-plane/src/app/api/dsr/erase/route.ts` (Postgres DELETE
 *     targets, as of that file's docstring step 3, current HEAD:
 *     session_embeddings, consent_records, conversion_labels,
 *     engagement_scores, quiz_completions, intent_sessions) — must ALSO be
 *     disclosed by GET /api/dsr/access and GET /api/dsr/portability. The
 *     "PARITY" describe block below seeds one row per erased Postgres table
 *     and asserts every one of them appears in both disclosure responses.
 *     This file is READ-ONLY against `erase/route.ts` (do not edit it here —
 *     see FOLLOW-557, a concurrent PR touching that file's Redis leg); if a
 *     future change adds a new Postgres DELETE target to erase/route.ts, the
 *     PARITY block's table list below must be updated by hand to match.
 *
 * @module apps/control-plane/src/app/api/dsr/disclosure-route-driven-pglite.test
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

vi.mock('./_clickhouse', () => ({
  DSR_AUDIT_ACTIONS: {
    initiated: 'initiated',
    completed: 'completed',
    expired: 'expired',
    failed: 'failed',
    crm_unverifiable: 'crm_unverifiable',
  },
  writeDsrAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

// ─── Fixture DDL ──────────────────────────────────────────────────────────────
//
// Tables needed by the access + portability routes:
//   - tenants, dsr_verifications (OTP lookup)
//   - session_embeddings, consent_records (read targets)
//   - conversion_labels (Pass A + Pass B reads)
//
// vector extension needed for session_embeddings.embedding column.
// PGlite does not include pgvector; we define the column as text to avoid
// the extension requirement while still exercising all query predicates.
// The access/portability routes do not query the embedding column — they only
// read sessionId, tenantId, finalArchetype, matchedArchetype, createdAt, updatedAt.

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
    dsr_type        text NOT NULL DEFAULT 'access',
    otp_hash        text NOT NULL,
    expires_at      timestamptz NOT NULL,
    used_at         timestamptz,
    durable_lead_id text,
    attempt_count   integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now()
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
    session_id   text NOT NULL,
    consent_type text NOT NULL,
    granted      boolean NOT NULL DEFAULT false,
    granted_at   timestamptz NOT NULL DEFAULT now(),
    revoked_at   timestamptz,
    created_at   timestamptz NOT NULL DEFAULT now()
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

  -- FOLLOW-558 / audit A3-F-06: three additional erase-cascade tables that
  -- must now also be disclosed by access/portability.
  CREATE TABLE IF NOT EXISTS engagement_scores (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id          uuid NOT NULL,
    session_id         text NOT NULL,
    engagement_score   numeric(6,5),
    dwell_score        numeric(6,5),
    interaction_score  numeric(6,5),
    scroll_score       numeric(6,5),
    computed_at        timestamptz NOT NULL DEFAULT now(),
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
  );

  CREATE TABLE IF NOT EXISTS quiz_completions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id          text NOT NULL,
    resolved_archetype  text NOT NULL,
    branch              text,
    q1_answer           integer,
    q2_answer           integer,
    q3_answer           integer,
    language            text NOT NULL DEFAULT 'en',
    created_at          timestamptz NOT NULL DEFAULT now()
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
`;

// ─── Suite globals ─────────────────────────────────────────────────────────────

let pg: PGlite;
let TENANT_ID: string;
let TENANT_ID_2: string;

// ─── Helper: hash OTP ─────────────────────────────────────────────────────────

function hashOtpLocal(otp: string): string {
  return createHash('sha256').update(otp).digest('hex');
}

// ─── Suite setup / teardown ───────────────────────────────────────────────────

beforeAll(async () => {
  pg = new PGlite();
  await pg.waitReady;
  await pg.exec(FIXTURE_DDL);

  _testDb = drizzlePglite(pg);

  const row1 = await pg.query<{ id: string }>(
    `INSERT INTO tenants (name, slug) VALUES ('DSR Disclosure Tenant', 'dsr-disclosure-pglite') RETURNING id`,
  );
  const t1 = row1.rows[0];
  if (!t1) throw new Error('Failed to insert tenant 1');
  TENANT_ID = t1.id;

  const row2 = await pg.query<{ id: string }>(
    `INSERT INTO tenants (name, slug) VALUES ('DSR Disclosure Tenant 2', 'dsr-disclosure-pglite-2') RETURNING id`,
  );
  const t2 = row2.rows[0];
  if (!t2) throw new Error('Failed to insert tenant 2');
  TENANT_ID_2 = t2.id;
});

afterAll(async () => {
  _testDb = null;
  await pg.close();
});

beforeEach(async () => {
  await pg.exec('DELETE FROM conversion_labels');
  await pg.exec('DELETE FROM consent_records');
  await pg.exec('DELETE FROM session_embeddings');
  await pg.exec('DELETE FROM dsr_verifications');
  await pg.exec('DELETE FROM engagement_scores');
  await pg.exec('DELETE FROM quiz_completions');
  await pg.exec('DELETE FROM intent_sessions');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ─── Import production handlers ───────────────────────────────────────────────

import { GET as getAccess } from './access/route';
import { GET as getPortability } from './portability/route';

// ─── Helpers ──────────────────────────────────────────────────────────────────

interface DisclosedLabel {
  id: string;
  prediction_id: string;
  lead_id: string;
  outcome_class: string;
  label_source: string;
}

/**
 * Seed a dsr_verifications row and return the raw OTP.
 * dsrType can be 'access' or 'portability'.
 */
async function seedVerification(opts: {
  sessionId: string;
  dsrType: 'access' | 'portability';
  durableLeadId?: string | null;
}): Promise<{ otp: string; requestId: string }> {
  const otp = '123456';
  const otpHash = hashOtpLocal(otp);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const res = await pg.query<{ id: string }>(
    `INSERT INTO dsr_verifications
       (tenant_id, session_id, email, dsr_type, otp_hash, expires_at, durable_lead_id)
     VALUES ($1, $2, 'test@example.com', $3, $4, $5, $6)
     RETURNING id`,
    [TENANT_ID, opts.sessionId, opts.dsrType, otpHash, expiresAt, opts.durableLeadId ?? null],
  );
  const row = res.rows[0];
  if (!row) throw new Error('Failed to insert dsr_verifications');
  return { otp, requestId: row.id };
}

/** Insert a conversion_labels row for disclosure testing. */
async function insertLabel(opts: {
  tenantId: string;
  predictionId: string;
  leadId: string;
  outcomeClass: string;
}): Promise<string> {
  const res = await pg.query<{ id: string }>(
    `INSERT INTO conversion_labels
       (tenant_id, prediction_id, lead_id, outcome_class, label_source)
     VALUES ($1, $2, $3, $4, 'system')
     RETURNING id`,
    [opts.tenantId, opts.predictionId, opts.leadId, opts.outcomeClass],
  );
  const row = res.rows[0];
  if (!row) throw new Error('INSERT did not return id');
  return row.id;
}

/** Insert an engagement_scores row (FOLLOW-558). */
async function insertEngagementScore(opts: { tenantId: string; sessionId: string }): Promise<void> {
  await pg.query(
    `INSERT INTO engagement_scores
       (tenant_id, session_id, engagement_score, dwell_score, interaction_score, scroll_score)
     VALUES ($1, $2, 0.75, 0.60, 0.80, 0.90)`,
    [opts.tenantId, opts.sessionId],
  );
}

/** Insert a quiz_completions row (FOLLOW-558). */
async function insertQuizCompletion(opts: {
  tenantId: string;
  sessionId: string;
  resolvedArchetype: string;
}): Promise<void> {
  await pg.query(
    `INSERT INTO quiz_completions
       (tenant_id, session_id, resolved_archetype, branch, q1_answer, language)
     VALUES ($1, $2, $3, 'INWESTOR', 0, 'en')`,
    [opts.tenantId, opts.sessionId, opts.resolvedArchetype],
  );
}

/** Insert an intent_sessions row (FOLLOW-558). */
async function insertIntentSession(opts: {
  tenantId: string;
  sessionId: string;
  finalArchetype: string;
}): Promise<void> {
  await pg.query(
    `INSERT INTO intent_sessions
       (tenant_id, session_id, final_archetype, final_confidence, signal_count)
     VALUES ($1, $2, $3, 0.900, 5)`,
    [opts.tenantId, opts.sessionId, opts.finalArchetype],
  );
}

function makeAccessRequest(otp: string, requestId: string): NextRequest {
  return new NextRequest(`http://localhost/api/dsr/access?request_id=${requestId}&token=${otp}`);
}

function makePortabilityRequest(otp: string, requestId: string): NextRequest {
  return new NextRequest(
    `http://localhost/api/dsr/portability?request_id=${requestId}&token=${otp}`,
  );
}

/** Extract conversion_labels from an access response body. */
async function getAccessLabels(res: Response): Promise<DisclosedLabel[]> {
  const body = (await res.json()) as { conversion_labels?: DisclosedLabel[] };
  return body.conversion_labels ?? [];
}

/** Extract conversion_labels from a portability response body (downloadable JSON). */
async function getPortabilityLabels(res: Response): Promise<DisclosedLabel[]> {
  const text = await res.text();
  const body = JSON.parse(text) as { conversion_labels?: DisclosedLabel[] };
  return body.conversion_labels ?? [];
}

// ─── AC1 (FOLLOW-256): both handlers disclose both namespaces ─────────────────
//
// Pass A (lead_id = session_id) AND Pass B (lead_id = durable_lead_id) must both
// appear in the output. Dropping the tenant_id WHERE predicate, swapping Pass A
// and Pass B keys, or removing the ne('') guard all BREAK these tests.

describe('AC1 (FOLLOW-256): access handler discloses both identifier namespaces', () => {
  it('includes the SDK-ping row (Pass A) AND the CRM row (Pass B) in access output', async () => {
    const SESSION_ID = 'sess-access-ac1-001';
    const CRM_LEAD = 'crm-token-ac1-001';

    const { otp, requestId } = await seedVerification({
      sessionId: SESSION_ID,
      dsrType: 'access',
      durableLeadId: CRM_LEAD,
    });

    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-access-sdk',
      leadId: SESSION_ID,
      outcomeClass: 'viewing_booked',
    });
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-access-crm',
      leadId: CRM_LEAD,
      outcomeClass: 'purchased',
    });

    const res = await getAccess(makeAccessRequest(otp, requestId));
    expect(res.status).toBe(200);

    const labels = await getAccessLabels(res);
    expect(labels).toHaveLength(2);
    const predIds = labels.map((l) => l.prediction_id).sort();
    expect(predIds).toEqual(['pred-access-crm', 'pred-access-sdk']);
  });

  it('only discloses Pass A rows when durable_lead_id is null (Pass B skipped)', async () => {
    const SESSION_ID = 'sess-access-ac1-null';
    const CRM_LEAD = 'crm-token-ac1-null';

    const { otp, requestId } = await seedVerification({
      sessionId: SESSION_ID,
      dsrType: 'access',
      durableLeadId: null,
    });

    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-access-sdk-only',
      leadId: SESSION_ID,
      outcomeClass: 'viewing_booked',
    });
    // CRM row — must NOT be disclosed when durable_lead_id is null.
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-access-crm-not-disclosed',
      leadId: CRM_LEAD,
      outcomeClass: 'purchased',
    });

    const res = await getAccess(makeAccessRequest(otp, requestId));
    expect(res.status).toBe(200);

    const labels = await getAccessLabels(res);
    expect(labels).toHaveLength(1);
    expect(labels[0]!.prediction_id).toBe('pred-access-sdk-only');
  });

  it('discloses an empty list when no labels exist for this subject', async () => {
    const SESSION_ID = 'sess-access-empty';
    const { otp, requestId } = await seedVerification({ sessionId: SESSION_ID, dsrType: 'access' });

    const res = await getAccess(makeAccessRequest(otp, requestId));
    expect(res.status).toBe(200);
    const labels = await getAccessLabels(res);
    expect(labels).toHaveLength(0);
  });
});

describe('AC1 (FOLLOW-256): portability handler discloses both identifier namespaces', () => {
  it('includes the SDK-ping row (Pass A) AND the CRM row (Pass B) in portability output', async () => {
    const SESSION_ID = 'sess-portability-ac1-001';
    const CRM_LEAD = 'crm-token-portability-001';

    const { otp, requestId } = await seedVerification({
      sessionId: SESSION_ID,
      dsrType: 'portability',
      durableLeadId: CRM_LEAD,
    });

    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-port-sdk',
      leadId: SESSION_ID,
      outcomeClass: 'viewing_booked',
    });
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-port-crm',
      leadId: CRM_LEAD,
      outcomeClass: 'offer_made',
    });

    const res = await getPortability(makePortabilityRequest(otp, requestId));
    expect(res.status).toBe(200);

    const labels = await getPortabilityLabels(res);
    expect(labels).toHaveLength(2);
    const predIds = labels.map((l) => l.prediction_id).sort();
    expect(predIds).toEqual(['pred-port-crm', 'pred-port-sdk']);
  });

  it('portability response includes Content-Disposition attachment header', async () => {
    const SESSION_ID = 'sess-portability-header';
    const { otp, requestId } = await seedVerification({
      sessionId: SESSION_ID,
      dsrType: 'portability',
    });

    const res = await getPortability(makePortabilityRequest(otp, requestId));
    expect(res.status).toBe(200);
    const disposition = res.headers.get('Content-Disposition');
    expect(disposition).toMatch(/attachment/);
    expect(disposition).toMatch(/filename=/);
  });

  it('portability route does not disclose with wrong dsr_type OTP (access token fails)', async () => {
    const SESSION_ID = 'sess-portability-wrongtype';
    // Seed an 'access' OTP — must NOT work for the portability endpoint.
    const otp = '111111';
    const inserted = await pg.query<{ id: string }>(
      `INSERT INTO dsr_verifications
         (tenant_id, session_id, email, dsr_type, otp_hash, expires_at)
       VALUES ($1, $2, 'test@example.com', 'access', $3, NOW() + INTERVAL '15 minutes')
       RETURNING id`,
      [TENANT_ID, SESSION_ID, hashOtpLocal(otp)],
    );
    const wrongTypeRequestId = inserted.rows[0]?.id;
    if (!wrongTypeRequestId) throw new Error('Failed to insert dsr_verifications row');

    const res = await getPortability(makePortabilityRequest(otp, wrongTypeRequestId));
    expect(res.status).toBe(404);
  });
});

// ─── AC2 (FOLLOW-256): route-driven tenant isolation ─────────────────────────
//
// A second tenant's rows with the same lead_id values must NOT appear in
// tenant 1's access or portability output. The WHERE tenant_id predicate is
// on the production handler's call-stack — any change to it BREAKS this test.

describe('AC2 (FOLLOW-256): route-driven tenant isolation', () => {
  it('access response for tenant 1 excludes tenant 2 rows with identical lead_ids', async () => {
    const SESSION_ID = 'sess-iso-shared';
    const CRM_LEAD = 'crm-iso-shared';

    // Tenant 1 DSR.
    const { otp, requestId } = await seedVerification({
      sessionId: SESSION_ID,
      dsrType: 'access',
      durableLeadId: CRM_LEAD,
    });

    // Tenant 1 rows.
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-t1-sdk',
      leadId: SESSION_ID,
      outcomeClass: 'viewing_booked',
    });
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-t1-crm',
      leadId: CRM_LEAD,
      outcomeClass: 'purchased',
    });

    // Tenant 2 rows — SAME lead_id values, different tenant.
    await insertLabel({
      tenantId: TENANT_ID_2,
      predictionId: 'pred-t2-sdk',
      leadId: SESSION_ID,
      outcomeClass: 'quiz_completed',
    });
    await insertLabel({
      tenantId: TENANT_ID_2,
      predictionId: 'pred-t2-crm',
      leadId: CRM_LEAD,
      outcomeClass: 'offer_made',
    });

    const res = await getAccess(makeAccessRequest(otp, requestId));
    expect(res.status).toBe(200);

    const labels = await getAccessLabels(res);
    // Only tenant 1's 2 rows must appear.
    expect(labels).toHaveLength(2);
    const predIds = labels.map((l) => l.prediction_id).sort();
    expect(predIds).toEqual(['pred-t1-crm', 'pred-t1-sdk']);
  });

  it('portability response for tenant 1 excludes tenant 2 rows with identical lead_ids', async () => {
    const SESSION_ID = 'sess-iso-port';
    const CRM_LEAD = 'crm-iso-port';

    const { otp, requestId } = await seedVerification({
      sessionId: SESSION_ID,
      dsrType: 'portability',
      durableLeadId: CRM_LEAD,
    });

    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-port-t1',
      leadId: SESSION_ID,
      outcomeClass: 'viewing_booked',
    });
    await insertLabel({
      tenantId: TENANT_ID_2,
      predictionId: 'pred-port-t2',
      leadId: SESSION_ID,
      outcomeClass: 'quiz_completed',
    });

    const res = await getPortability(makePortabilityRequest(otp, requestId));
    expect(res.status).toBe(200);

    const labels = await getPortabilityLabels(res);
    expect(labels).toHaveLength(1);
    expect(labels[0]!.prediction_id).toBe('pred-port-t1');
  });
});

// ─── AC3 (FOLLOW-256): access and portability produce identical conversion_labels ─
//
// Seed once, drive BOTH handlers (one access OTP + one portability OTP for the
// same subject / same data), assert the conversion_labels arrays are identical.
// This is the true parity test — any SELECT-predicate or merge-logic divergence
// between the two routes BREAKS this test.

describe('AC3 (FOLLOW-256): access and portability produce identical conversion_labels', () => {
  it('both handlers return the same conversion_labels set for the same subject data', async () => {
    const SESSION_ID = 'sess-parity-ac3';
    const CRM_LEAD = 'crm-parity-ac3';

    // Seed access OTP for tenant 1.
    const accessOtp = '111222';
    const accessInserted = await pg.query<{ id: string }>(
      `INSERT INTO dsr_verifications
         (tenant_id, session_id, email, dsr_type, otp_hash, expires_at, durable_lead_id)
       VALUES ($1, $2, 'test@example.com', 'access', $3, NOW() + INTERVAL '15 minutes', $4)
       RETURNING id`,
      [TENANT_ID, SESSION_ID, hashOtpLocal(accessOtp), CRM_LEAD],
    );
    const accessRequestId = accessInserted.rows[0]?.id;
    if (!accessRequestId) throw new Error('Failed to insert access dsr_verifications row');

    // Seed portability OTP for the same subject.
    const portabilityOtp = '333444';
    const portabilityInserted = await pg.query<{ id: string }>(
      `INSERT INTO dsr_verifications
         (tenant_id, session_id, email, dsr_type, otp_hash, expires_at, durable_lead_id)
       VALUES ($1, $2, 'test@example.com', 'portability', $3, NOW() + INTERVAL '15 minutes', $4)
       RETURNING id`,
      [TENANT_ID, SESSION_ID, hashOtpLocal(portabilityOtp), CRM_LEAD],
    );
    const portabilityRequestId = portabilityInserted.rows[0]?.id;
    if (!portabilityRequestId)
      throw new Error('Failed to insert portability dsr_verifications row');

    // Seed conversion_labels on both namespaces.
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-parity-sdk',
      leadId: SESSION_ID,
      outcomeClass: 'viewing_booked',
    });
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-parity-crm',
      leadId: CRM_LEAD,
      outcomeClass: 'purchased',
    });

    // Drive both handlers.
    const accessRes = await getAccess(makeAccessRequest(accessOtp, accessRequestId));
    expect(accessRes.status).toBe(200);

    const portabilityRes = await getPortability(
      makePortabilityRequest(portabilityOtp, portabilityRequestId),
    );
    expect(portabilityRes.status).toBe(200);

    const accessLabels = await getAccessLabels(accessRes);
    const portabilityLabels = await getPortabilityLabels(portabilityRes);

    // Both must return the same 2 rows.
    expect(accessLabels).toHaveLength(2);
    expect(portabilityLabels).toHaveLength(2);

    const accessPredIds = accessLabels.map((l) => l.prediction_id).sort();
    const portabilityPredIds = portabilityLabels.map((l) => l.prediction_id).sort();
    expect(accessPredIds).toEqual(portabilityPredIds);
    expect(accessPredIds).toEqual(['pred-parity-crm', 'pred-parity-sdk']);

    // lead_id values must also match between the two responses (same rows, same data).
    const accessLeadIds = accessLabels.map((l) => l.lead_id).sort();
    const portabilityLeadIds = portabilityLabels.map((l) => l.lead_id).sort();
    expect(accessLeadIds).toEqual(portabilityLeadIds);
  });

  it('both handlers return empty conversion_labels when no labels exist', async () => {
    const SESSION_ID = 'sess-parity-empty';

    const accessOtp = '555666';
    const portabilityOtp = '777888';
    const accessInserted = await pg.query<{ id: string }>(
      `INSERT INTO dsr_verifications
         (tenant_id, session_id, email, dsr_type, otp_hash, expires_at)
       VALUES ($1, $2, 'test@example.com', 'access', $3, NOW() + INTERVAL '15 minutes')
       RETURNING id`,
      [TENANT_ID, SESSION_ID, hashOtpLocal(accessOtp)],
    );
    const accessRequestId = accessInserted.rows[0]?.id;
    if (!accessRequestId) throw new Error('Failed to insert access dsr_verifications row');

    const portabilityInserted = await pg.query<{ id: string }>(
      `INSERT INTO dsr_verifications
         (tenant_id, session_id, email, dsr_type, otp_hash, expires_at)
       VALUES ($1, $2, 'test@example.com', 'portability', $3, NOW() + INTERVAL '15 minutes')
       RETURNING id`,
      [TENANT_ID, SESSION_ID, hashOtpLocal(portabilityOtp)],
    );
    const portabilityRequestId = portabilityInserted.rows[0]?.id;
    if (!portabilityRequestId)
      throw new Error('Failed to insert portability dsr_verifications row');

    const accessRes = await getAccess(makeAccessRequest(accessOtp, accessRequestId));
    const portabilityRes = await getPortability(
      makePortabilityRequest(portabilityOtp, portabilityRequestId),
    );

    expect(accessRes.status).toBe(200);
    expect(portabilityRes.status).toBe(200);

    const accessLabels = await getAccessLabels(accessRes);
    const portabilityLabels = await getPortabilityLabels(portabilityRes);

    expect(accessLabels).toHaveLength(0);
    expect(portabilityLabels).toHaveLength(0);
  });
});

// ─── AC1 (FOLLOW-256): LG-2 guard — empty lead_id rows are never disclosed ───

describe('AC1-LG2 (FOLLOW-256): ne() guard — empty lead_id rows are never disclosed', () => {
  it('access handler does NOT include a row with lead_id empty string', async () => {
    const SESSION_ID = 'sess-access-lg2';
    const CRM_LEAD = 'crm-lg2-token';

    const { otp, requestId } = await seedVerification({
      sessionId: SESSION_ID,
      dsrType: 'access',
      durableLeadId: CRM_LEAD,
    });

    // Empty-lead_id row — must never be disclosed.
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-empty-lg2',
      leadId: '',
      outcomeClass: 'no_response',
    });
    // Real SDK-ping row.
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-real-lg2',
      leadId: SESSION_ID,
      outcomeClass: 'viewing_booked',
    });

    const res = await getAccess(makeAccessRequest(otp, requestId));
    expect(res.status).toBe(200);

    const labels = await getAccessLabels(res);
    expect(labels).toHaveLength(1);
    expect(labels[0]!.prediction_id).toBe('pred-real-lg2');
    expect(labels[0]!.lead_id).toBe(SESSION_ID);
  });

  it('portability handler does NOT include a row with lead_id empty string', async () => {
    const SESSION_ID = 'sess-port-lg2';
    const CRM_LEAD = 'crm-port-lg2';

    const { otp, requestId } = await seedVerification({
      sessionId: SESSION_ID,
      dsrType: 'portability',
      durableLeadId: CRM_LEAD,
    });

    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-port-empty-lg2',
      leadId: '',
      outcomeClass: 'no_response',
    });
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-port-real-lg2',
      leadId: CRM_LEAD,
      outcomeClass: 'purchased',
    });

    const res = await getPortability(makePortabilityRequest(otp, requestId));
    expect(res.status).toBe(200);

    const labels = await getPortabilityLabels(res);
    expect(labels).toHaveLength(1);
    expect(labels[0]!.lead_id).toBe(CRM_LEAD);
  });
});

// ─── FOLLOW-558 / audit A3-F-06: engagement_scores, quiz_completions, intent_sessions ──
//
// PARITY: the erase route's Postgres DELETE targets, as of `erase/route.ts`
// current HEAD (this file is READ-ONLY against that route — see FOLLOW-557),
// are: session_embeddings, consent_records, conversion_labels,
// engagement_scores, quiz_completions, intent_sessions. session_embeddings /
// consent_records / conversion_labels disclosure is already covered above
// (AC1-AC3, LG-2). This block proves the remaining three ALSO round-trip
// through both disclosure routes — closing the Art. 15/20 gap this ticket
// exists to fix, and giving a future erase/route.ts table addition a test
// that must be updated in lockstep (documented exception: none — every
// erased Postgres table is disclosed).

interface DisclosedEngagementScore {
  engagement_score: string | null;
  dwell_score: string | null;
  interaction_score: string | null;
  scroll_score: string | null;
  computed_at: string;
}

interface DisclosedQuizCompletion {
  id: string;
  resolved_archetype: string;
  branch: string | null;
}

interface DisclosedIntentSession {
  id: string;
  final_archetype: string | null;
  signal_count: number;
}

interface FullDisclosureBody {
  engagement_score: DisclosedEngagementScore | null;
  quiz_completions: DisclosedQuizCompletion[];
  intent_session: DisclosedIntentSession | null;
}

async function getAccessDisclosure(res: Response): Promise<FullDisclosureBody> {
  return (await res.json()) as FullDisclosureBody;
}

async function getPortabilityDisclosure(res: Response): Promise<FullDisclosureBody> {
  const text = await res.text();
  return JSON.parse(text) as FullDisclosureBody;
}

describe('FOLLOW-558: access handler discloses engagement_scores, quiz_completions, intent_sessions', () => {
  it('includes all three stores when rows exist for the subject', async () => {
    const SESSION_ID = 'sess-558-access-full';

    const { otp, requestId } = await seedVerification({ sessionId: SESSION_ID, dsrType: 'access' });

    await insertEngagementScore({ tenantId: TENANT_ID, sessionId: SESSION_ID });
    await insertQuizCompletion({
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      resolvedArchetype: 'family_upsizer',
    });
    await insertIntentSession({
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      finalArchetype: 'family_upsizer',
    });

    const res = await getAccess(makeAccessRequest(otp, requestId));
    expect(res.status).toBe(200);

    const body = await getAccessDisclosure(res);

    expect(body.engagement_score).not.toBeNull();
    expect(body.engagement_score?.engagement_score).toBe('0.75000');

    expect(body.quiz_completions).toHaveLength(1);
    expect(body.quiz_completions[0]!.resolved_archetype).toBe('family_upsizer');

    expect(body.intent_session).not.toBeNull();
    expect(body.intent_session?.final_archetype).toBe('family_upsizer');
    expect(body.intent_session?.signal_count).toBe(5);
  });

  it('reports null / empty when no rows exist for the subject (never fabricates)', async () => {
    const SESSION_ID = 'sess-558-access-empty';
    const { otp, requestId } = await seedVerification({ sessionId: SESSION_ID, dsrType: 'access' });

    const res = await getAccess(makeAccessRequest(otp, requestId));
    expect(res.status).toBe(200);

    const body = await getAccessDisclosure(res);
    expect(body.engagement_score).toBeNull();
    expect(body.quiz_completions).toHaveLength(0);
    expect(body.intent_session).toBeNull();
  });

  it('excludes a second tenant rows with the same session_id (tenant isolation)', async () => {
    const SESSION_ID = 'sess-558-iso';
    const { otp, requestId } = await seedVerification({ sessionId: SESSION_ID, dsrType: 'access' });

    // Tenant 1 row.
    await insertQuizCompletion({
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      resolvedArchetype: 'investor_cashflow',
    });
    // Tenant 2 row — same session_id, different tenant. Must NOT appear.
    await insertQuizCompletion({
      tenantId: TENANT_ID_2,
      sessionId: SESSION_ID,
      resolvedArchetype: 'family_upsizer',
    });

    const res = await getAccess(makeAccessRequest(otp, requestId));
    expect(res.status).toBe(200);

    const body = await getAccessDisclosure(res);
    expect(body.quiz_completions).toHaveLength(1);
    expect(body.quiz_completions[0]!.resolved_archetype).toBe('investor_cashflow');
  });
});

describe('FOLLOW-558: portability handler discloses engagement_scores, quiz_completions, intent_sessions', () => {
  it('includes all three stores when rows exist for the subject', async () => {
    const SESSION_ID = 'sess-558-port-full';

    const { otp, requestId } = await seedVerification({
      sessionId: SESSION_ID,
      dsrType: 'portability',
    });

    await insertEngagementScore({ tenantId: TENANT_ID, sessionId: SESSION_ID });
    await insertQuizCompletion({
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      resolvedArchetype: 'cross_border_diversifier',
    });
    await insertIntentSession({
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      finalArchetype: 'cross_border_diversifier',
    });

    const res = await getPortability(makePortabilityRequest(otp, requestId));
    expect(res.status).toBe(200);

    const body = await getPortabilityDisclosure(res);

    expect(body.engagement_score).not.toBeNull();
    expect(body.quiz_completions).toHaveLength(1);
    expect(body.quiz_completions[0]!.resolved_archetype).toBe('cross_border_diversifier');
    expect(body.intent_session).not.toBeNull();
    expect(body.intent_session?.final_archetype).toBe('cross_border_diversifier');
  });
});

describe('FOLLOW-558 PARITY: access and portability disclose the identical erase Postgres table set', () => {
  it('seeds one row per erased Postgres table and both routes disclose all six', async () => {
    const SESSION_ID = 'sess-558-parity';
    const CRM_LEAD = 'crm-558-parity';

    // Seed one row in EVERY Postgres table the erase route deletes
    // (erase/route.ts current HEAD, step 3 of its docstring):
    //   session_embeddings, consent_records, conversion_labels,
    //   engagement_scores, quiz_completions, intent_sessions.
    await pg.query(
      `INSERT INTO session_embeddings (tenant_id, session_id, final_archetype)
       VALUES ($1, $2, 'family_upsizer')`,
      [TENANT_ID, SESSION_ID],
    );
    await pg.query(
      `INSERT INTO consent_records (session_id, consent_type, granted)
       VALUES ($1, 'behavioral_tracking', true)`,
      [SESSION_ID],
    );
    await insertLabel({
      tenantId: TENANT_ID,
      predictionId: 'pred-558-parity',
      leadId: SESSION_ID,
      outcomeClass: 'viewing_booked',
    });
    await insertEngagementScore({ tenantId: TENANT_ID, sessionId: SESSION_ID });
    await insertQuizCompletion({
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      resolvedArchetype: 'family_upsizer',
    });
    await insertIntentSession({
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      finalArchetype: 'family_upsizer',
    });

    const { otp: accessOtp, requestId: accessRequestId } = await seedVerification({
      sessionId: SESSION_ID,
      dsrType: 'access',
      durableLeadId: CRM_LEAD,
    });
    const { otp: portOtp, requestId: portRequestId } = await seedVerification({
      sessionId: SESSION_ID,
      dsrType: 'portability',
      durableLeadId: CRM_LEAD,
    });

    const accessRes = await getAccess(makeAccessRequest(accessOtp, accessRequestId));
    const portabilityRes = await getPortability(makePortabilityRequest(portOtp, portRequestId));
    expect(accessRes.status).toBe(200);
    expect(portabilityRes.status).toBe(200);

    interface ParityBody extends FullDisclosureBody {
      matched_archetype: string | null;
      consent_records: unknown[];
      conversion_labels: unknown[];
    }

    const accessBody = (await accessRes.json()) as ParityBody;
    const portabilityText = await portabilityRes.text();
    const portabilityBody = JSON.parse(portabilityText) as ParityBody;

    for (const body of [accessBody, portabilityBody]) {
      // session_embeddings (surfaced as matched_archetype).
      expect(body.matched_archetype).toBe('family_upsizer');
      // consent_records.
      expect(body.consent_records).toHaveLength(1);
      // conversion_labels.
      expect(body.conversion_labels).toHaveLength(1);
      // engagement_scores (FOLLOW-558).
      expect(body.engagement_score).not.toBeNull();
      // quiz_completions (FOLLOW-558).
      expect(body.quiz_completions).toHaveLength(1);
      // intent_sessions (FOLLOW-558).
      expect(body.intent_session).not.toBeNull();
    }
  });
});
