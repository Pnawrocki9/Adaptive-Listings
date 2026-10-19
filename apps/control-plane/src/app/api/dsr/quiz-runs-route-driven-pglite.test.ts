/**
 * @vitest-environment node
 *
 * FOLLOW-1358 (ESC-086 item 2, privacy check): the DSR routes cover `quiz_runs`, the handover table
 * created by `docs/handover/migrations/H002_quiz_runs.sql`. Route-driven against PGlite with the
 * REAL handover SQL applied, the REAL erase / access / portability handlers and the real
 * `lib/quiz-runs.ts` helpers (no mock of the SQL).
 *
 * Pinned:
 *   - erase deletes the subject's runs on (tenant_id, session_id) and leaves another session's and
 *     another tenant's runs alone (same fingerprint under another tenant);
 *   - access and portability disclose the subject's runs (and only theirs);
 *   - with H002 NOT applied, erase still answers 200 and the rest of the cascade still commits (the
 *     42P01 is caught inside a SAVEPOINT, for this table only), and access answers 200 with
 *     `quiz_runs: []` — a table that does not exist holds no personal data.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- PGlite db; schema type is wide
let testDb: ReturnType<typeof drizzlePglite<any>> | null = null;

vi.mock('@estalara/db', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.mock importOriginal generic requires inline import() type
  const real = await importOriginal<typeof import('@estalara/db')>();
  return {
    ...real,
    createAdminClient: () => {
      if (!testDb) throw new Error('test db not initialised');
      return testDb;
    },
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

// ClickHouse unconfigured: erase records no-op mutation rows, access reports `available: false`.
vi.mock('@/lib/clickhouse-dsr', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vi.mock importOriginal generic requires inline import() type
  const real = await importOriginal<typeof import('@/lib/clickhouse-dsr')>();
  return { ...real, readClickHouseConfig: vi.fn().mockReturnValue(null) };
});

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

import { POST as postErase } from './erase/route';
import { GET as getAccess } from './access/route';
import { GET as getPortability } from './portability/route';

const H002 = readFileSync(
  new URL('../../../../../../docs/handover/migrations/H002_quiz_runs.sql', import.meta.url),
  'utf8',
);

const TENANT = '550e8400-e29b-41d4-a716-446655441358';
const OTHER_TENANT = '550e8400-e29b-41d4-a716-446655449999';
const SUBJECT = 'c'.repeat(64);
const OTHER_SESSION = 'd'.repeat(64);
const OTP = '123456';

const FIXTURE_DDL = /* sql */ `
  CREATE TABLE tenants (id uuid PRIMARY KEY);
  CREATE TABLE dsr_verifications (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id      text NOT NULL,
    email           text NOT NULL DEFAULT 'test@example.com',
    dsr_type        text NOT NULL,
    otp_hash        text NOT NULL,
    expires_at      timestamptz NOT NULL,
    used_at         timestamptz,
    durable_lead_id text,
    attempt_count   integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE session_embeddings (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, session_id text NOT NULL,
    final_archetype text, matched_archetype text, similarity_score numeric(6,5),
    signal_count integer NOT NULL DEFAULT 0, quiz_archetype text, embedding text,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE consent_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, session_id text NOT NULL,
    consent_type text NOT NULL, granted boolean NOT NULL DEFAULT false, tos_version text NOT NULL,
    granted_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE conversion_labels (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL,
    prediction_id text NOT NULL, lead_id text NOT NULL DEFAULT '', outcome_class text NOT NULL,
    outcome_raw jsonb, labeled_at timestamptz NOT NULL DEFAULT now(), label_source text NOT NULL,
    confidence real, notes text, created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE quiz_completions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, session_id text NOT NULL,
    resolved_archetype text NOT NULL, branch text, q1_answer integer, q2_answer integer,
    q3_answer integer, language text NOT NULL DEFAULT 'en', created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE intent_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, session_id text NOT NULL,
    cross_session_id text, started_at timestamptz NOT NULL DEFAULT now(),
    last_event_at timestamptz NOT NULL DEFAULT now(), finalized_at timestamptz,
    final_archetype text, final_confidence numeric(4,3), signal_count integer NOT NULL DEFAULT 0,
    quiz_completed boolean NOT NULL DEFAULT false, quiz_leaf text,
    chat_turns integer NOT NULL DEFAULT 0, intent_state jsonb
  );
  CREATE TABLE dsr_clickhouse_mutations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dsr_verification_id uuid NOT NULL,
    tenant_id uuid NOT NULL, session_id text NOT NULL, table_name text NOT NULL,
    mutation_id text NOT NULL DEFAULT '', status text NOT NULL DEFAULT 'pending',
    retry_count integer NOT NULL DEFAULT 0, last_failed_reason text, next_retry_at timestamptz,
    alter_sql text NOT NULL DEFAULT '', issued_at timestamptz NOT NULL DEFAULT now(),
    completed_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
  );
  INSERT INTO tenants (id) VALUES ('${TENANT}'), ('${OTHER_TENANT}');
`;

let pg: PGlite | null = null;

async function engine(): Promise<PGlite> {
  if (!pg) {
    pg = new PGlite();
    await pg.exec(FIXTURE_DDL);
    testDb = drizzlePglite(pg);
  }
  return pg;
}

async function seedRun(tenantId: string, sessionId: string, status = 'completed'): Promise<void> {
  await pg!.query(
    `INSERT INTO quiz_runs (id, tenant_id, session_id, status, resolved_archetype, step_ms, traits)
     VALUES (gen_random_uuid(), $1, $2, $3, 'family_buyer', '{1200,800}', '["has_children"]')`,
    [tenantId, sessionId, status],
  );
}

async function seedVerification(dsrType: 'erase' | 'access' | 'portability'): Promise<string> {
  const res = await pg!.query<{ id: string }>(
    `INSERT INTO dsr_verifications (tenant_id, session_id, dsr_type, otp_hash, expires_at)
     VALUES ($1, $2, $3, $4, now() + interval '15 minutes') RETURNING id`,
    [TENANT, SUBJECT, dsrType, createHash('sha256').update(OTP).digest('hex')],
  );
  return res.rows[0]!.id;
}

function eraseRequest(requestId: string): NextRequest {
  return new NextRequest('http://localhost/api/dsr/erase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: requestId, token: OTP }),
  });
}

function getRequest(kind: 'access' | 'portability', requestId: string): NextRequest {
  return new NextRequest(`http://localhost/api/dsr/${kind}?request_id=${requestId}&token=${OTP}`);
}

async function runsOf(tenantId: string, sessionId: string): Promise<number> {
  const res = await pg!.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM quiz_runs WHERE tenant_id = $1 AND session_id = $2`,
    [tenantId, sessionId],
  );
  return res.rows[0]!.n;
}

interface Disclosure {
  quiz_runs: { status: string; resolved_archetype: string | null; step_ms: number[] | null }[];
}

// PGlite (WASM) start-up takes seconds, more under memory pressure: pay it once, outside any test's
// own timeout.
beforeAll(async () => {
  await engine();
}, 120_000);

beforeEach(async () => {
  const db = await engine();
  await db.exec(`DROP TABLE IF EXISTS quiz_runs`);
  await db.exec(`DELETE FROM dsr_verifications; DELETE FROM quiz_completions;`);
  await db.exec(`DELETE FROM dsr_clickhouse_mutations;`);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterAll(async () => {
  testDb = null;
  await pg?.close();
  pg = null;
});

describe('quiz_runs present (H002 applied)', () => {
  it("erase deletes the subject's runs only — not another session's, not another tenant's", async () => {
    await pg!.exec(H002);
    await seedRun(TENANT, SUBJECT, 'confirmed');
    await seedRun(TENANT, SUBJECT, 'dismissed');
    await seedRun(TENANT, OTHER_SESSION);
    await seedRun(OTHER_TENANT, SUBJECT); // same fingerprint, another controller
    const res = await postErase(eraseRequest(await seedVerification('erase')));
    expect(res.status).toBe(200);
    expect(await runsOf(TENANT, SUBJECT)).toBe(0);
    expect(await runsOf(TENANT, OTHER_SESSION)).toBe(1);
    expect(await runsOf(OTHER_TENANT, SUBJECT)).toBe(1);
  });

  it("access and portability disclose the subject's runs, and only theirs", async () => {
    await pg!.exec(H002);
    await seedRun(TENANT, SUBJECT, 'confirmed');
    await seedRun(TENANT, OTHER_SESSION);
    await seedRun(OTHER_TENANT, SUBJECT);

    const access = await getAccess(getRequest('access', await seedVerification('access')));
    expect(access.status).toBe(200);
    const a = (await access.json()) as Disclosure;
    expect(a.quiz_runs).toHaveLength(1);
    expect(a.quiz_runs[0]).toMatchObject({
      status: 'confirmed',
      resolved_archetype: 'family_buyer',
      step_ms: [1200, 800],
    });

    const port = await getPortability(
      getRequest('portability', await seedVerification('portability')),
    );
    expect(port.status).toBe(200);
    const p = JSON.parse(await port.text()) as Disclosure;
    expect(p.quiz_runs).toHaveLength(1);
    expect(p.quiz_runs[0]!.status).toBe('confirmed');
  });
});

describe('quiz_runs absent (H002 not applied) — tolerated for this table only', () => {
  it('erase still answers 200 and the rest of the cascade commits', async () => {
    await pg!.query(
      `INSERT INTO quiz_completions (tenant_id, session_id, resolved_archetype) VALUES ($1, $2, 'neutral')`,
      [TENANT, SUBJECT],
    );
    const res = await postErase(eraseRequest(await seedVerification('erase')));
    expect(res.status).toBe(200);
    const left = await pg!.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM quiz_completions WHERE session_id = $1`,
      [SUBJECT],
    );
    expect(left.rows[0]!.n).toBe(0);
  });

  it('access answers 200 with quiz_runs: []', async () => {
    const res = await getAccess(getRequest('access', await seedVerification('access')));
    expect(res.status).toBe(200);
    expect(((await res.json()) as Disclosure).quiz_runs).toEqual([]);
  });
});
