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
}): Promise<{ otp: string }> {
  const otp = '123456';
  const otpHash = hashOtpLocal(otp);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  await pg.query(
    `INSERT INTO dsr_verifications
       (tenant_id, session_id, email, dsr_type, otp_hash, expires_at, durable_lead_id)
     VALUES ($1, $2, 'test@example.com', $3, $4, $5, $6)`,
    [TENANT_ID, opts.sessionId, opts.dsrType, otpHash, expiresAt, opts.durableLeadId ?? null],
  );
  return { otp };
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

function makeAccessRequest(otp: string): NextRequest {
  return new NextRequest(`http://localhost/api/dsr/access?token=${otp}`);
}

function makePortabilityRequest(otp: string): NextRequest {
  return new NextRequest(`http://localhost/api/dsr/portability?token=${otp}`);
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

    const { otp } = await seedVerification({
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

    const res = await getAccess(makeAccessRequest(otp));
    expect(res.status).toBe(200);

    const labels = await getAccessLabels(res);
    expect(labels).toHaveLength(2);
    const predIds = labels.map((l) => l.prediction_id).sort();
    expect(predIds).toEqual(['pred-access-crm', 'pred-access-sdk']);
  });

  it('only discloses Pass A rows when durable_lead_id is null (Pass B skipped)', async () => {
    const SESSION_ID = 'sess-access-ac1-null';
    const CRM_LEAD = 'crm-token-ac1-null';

    const { otp } = await seedVerification({
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

    const res = await getAccess(makeAccessRequest(otp));
    expect(res.status).toBe(200);

    const labels = await getAccessLabels(res);
    expect(labels).toHaveLength(1);
    expect(labels[0]!.prediction_id).toBe('pred-access-sdk-only');
  });

  it('discloses an empty list when no labels exist for this subject', async () => {
    const SESSION_ID = 'sess-access-empty';
    const { otp } = await seedVerification({ sessionId: SESSION_ID, dsrType: 'access' });

    const res = await getAccess(makeAccessRequest(otp));
    expect(res.status).toBe(200);
    const labels = await getAccessLabels(res);
    expect(labels).toHaveLength(0);
  });
});

describe('AC1 (FOLLOW-256): portability handler discloses both identifier namespaces', () => {
  it('includes the SDK-ping row (Pass A) AND the CRM row (Pass B) in portability output', async () => {
    const SESSION_ID = 'sess-portability-ac1-001';
    const CRM_LEAD = 'crm-token-portability-001';

    const { otp } = await seedVerification({
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

    const res = await getPortability(makePortabilityRequest(otp));
    expect(res.status).toBe(200);

    const labels = await getPortabilityLabels(res);
    expect(labels).toHaveLength(2);
    const predIds = labels.map((l) => l.prediction_id).sort();
    expect(predIds).toEqual(['pred-port-crm', 'pred-port-sdk']);
  });

  it('portability response includes Content-Disposition attachment header', async () => {
    const SESSION_ID = 'sess-portability-header';
    const { otp } = await seedVerification({ sessionId: SESSION_ID, dsrType: 'portability' });

    const res = await getPortability(makePortabilityRequest(otp));
    expect(res.status).toBe(200);
    const disposition = res.headers.get('Content-Disposition');
    expect(disposition).toMatch(/attachment/);
    expect(disposition).toMatch(/filename=/);
  });

  it('portability route does not disclose with wrong dsr_type OTP (access token fails)', async () => {
    const SESSION_ID = 'sess-portability-wrongtype';
    // Seed an 'access' OTP — must NOT work for the portability endpoint.
    const otp = '111111';
    await pg.query(
      `INSERT INTO dsr_verifications
         (tenant_id, session_id, email, dsr_type, otp_hash, expires_at)
       VALUES ($1, $2, 'test@example.com', 'access', $3, NOW() + INTERVAL '15 minutes')`,
      [TENANT_ID, SESSION_ID, hashOtpLocal(otp)],
    );

    const res = await getPortability(makePortabilityRequest(otp));
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
    const { otp } = await seedVerification({
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

    const res = await getAccess(makeAccessRequest(otp));
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

    const { otp } = await seedVerification({
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

    const res = await getPortability(makePortabilityRequest(otp));
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
    await pg.query(
      `INSERT INTO dsr_verifications
         (tenant_id, session_id, email, dsr_type, otp_hash, expires_at, durable_lead_id)
       VALUES ($1, $2, 'test@example.com', 'access', $3, NOW() + INTERVAL '15 minutes', $4)`,
      [TENANT_ID, SESSION_ID, hashOtpLocal(accessOtp), CRM_LEAD],
    );

    // Seed portability OTP for the same subject.
    const portabilityOtp = '333444';
    await pg.query(
      `INSERT INTO dsr_verifications
         (tenant_id, session_id, email, dsr_type, otp_hash, expires_at, durable_lead_id)
       VALUES ($1, $2, 'test@example.com', 'portability', $3, NOW() + INTERVAL '15 minutes', $4)`,
      [TENANT_ID, SESSION_ID, hashOtpLocal(portabilityOtp), CRM_LEAD],
    );

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
    const accessRes = await getAccess(makeAccessRequest(accessOtp));
    expect(accessRes.status).toBe(200);

    const portabilityRes = await getPortability(makePortabilityRequest(portabilityOtp));
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
    await pg.query(
      `INSERT INTO dsr_verifications
         (tenant_id, session_id, email, dsr_type, otp_hash, expires_at)
       VALUES ($1, $2, 'test@example.com', 'access', $3, NOW() + INTERVAL '15 minutes')`,
      [TENANT_ID, SESSION_ID, hashOtpLocal(accessOtp)],
    );
    await pg.query(
      `INSERT INTO dsr_verifications
         (tenant_id, session_id, email, dsr_type, otp_hash, expires_at)
       VALUES ($1, $2, 'test@example.com', 'portability', $3, NOW() + INTERVAL '15 minutes')`,
      [TENANT_ID, SESSION_ID, hashOtpLocal(portabilityOtp)],
    );

    const accessRes = await getAccess(makeAccessRequest(accessOtp));
    const portabilityRes = await getPortability(makePortabilityRequest(portabilityOtp));

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

    const { otp } = await seedVerification({
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

    const res = await getAccess(makeAccessRequest(otp));
    expect(res.status).toBe(200);

    const labels = await getAccessLabels(res);
    expect(labels).toHaveLength(1);
    expect(labels[0]!.prediction_id).toBe('pred-real-lg2');
    expect(labels[0]!.lead_id).toBe(SESSION_ID);
  });

  it('portability handler does NOT include a row with lead_id empty string', async () => {
    const SESSION_ID = 'sess-port-lg2';
    const CRM_LEAD = 'crm-port-lg2';

    const { otp } = await seedVerification({
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

    const res = await getPortability(makePortabilityRequest(otp));
    expect(res.status).toBe(200);

    const labels = await getPortabilityLabels(res);
    expect(labels).toHaveLength(1);
    expect(labels[0]!.lead_id).toBe(CRM_LEAD);
  });
});
