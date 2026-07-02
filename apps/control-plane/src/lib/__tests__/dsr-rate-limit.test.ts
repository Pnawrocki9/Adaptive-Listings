/**
 * PGlite-driven tests for `checkInitiateRateLimit` (FOLLOW-455 / audit F-20).
 *
 * Drives the ACTUAL production function against a real PGlite (in-memory
 * Postgres) engine, counting real `dsr_verifications` rows rather than a
 * mocked count() result.
 *
 * @vitest-environment node
 *
 * Why node environment?
 *   PGlite (WebAssembly Postgres) requires the Node.js WebAssembly runtime.
 *
 * @module apps/control-plane/src/lib/__tests__/dsr-rate-limit.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import type { createAdminClient } from '@estalara/db';

import {
  checkInitiateRateLimit,
  INITIATE_RATE_LIMIT_MAX,
  INITIATE_RATE_LIMIT_WINDOW_MS,
} from '../dsr-rate-limit.js';

// The fns under test are typed against the production admin client; the pglite
// engine is structurally compatible at runtime, so we cast the test db to it.
type TestDb = ReturnType<typeof createAdminClient>;

const FIXTURE_DDL = /* sql */ `
  CREATE TABLE IF NOT EXISTS tenants (
    id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    slug text NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS dsr_verifications (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id      text NOT NULL,
    email           text NOT NULL DEFAULT 'test@example.com',
    dsr_type        text NOT NULL DEFAULT 'erase',
    otp_hash        text NOT NULL DEFAULT '',
    expires_at      timestamptz NOT NULL DEFAULT now() + interval '15 minutes',
    used_at         timestamptz,
    durable_lead_id text,
    attempt_count   integer NOT NULL DEFAULT 0,
    created_at      timestamptz NOT NULL DEFAULT now()
  );
`;

let pg: PGlite;
let db: TestDb;
let TENANT_ID: string;

beforeAll(async () => {
  pg = new PGlite();
  await pg.waitReady;
  await pg.exec(FIXTURE_DDL);
  db = drizzlePglite(pg) as unknown as TestDb;

  const row = await pg.query<{ id: string }>(
    `INSERT INTO tenants (name, slug) VALUES ('DSR Rate Limit Test Tenant', 'dsr-rate-limit-pglite') RETURNING id`,
  );
  const t = row.rows[0];
  if (!t) throw new Error('Failed to insert test tenant');
  TENANT_ID = t.id;
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec('DELETE FROM dsr_verifications');
});

async function seedInitiateRow(email: string, createdAt: Date): Promise<void> {
  await pg.query(
    `INSERT INTO dsr_verifications (tenant_id, session_id, email, dsr_type, otp_hash, created_at)
     VALUES ($1, 'sess-rate-limit', $2, 'access', 'hash', $3)`,
    [TENANT_ID, email, createdAt.toISOString()],
  );
}

describe('checkInitiateRateLimit', () => {
  it('allows the request when there are zero prior rows for (tenant, email)', async () => {
    const result = await checkInitiateRateLimit(db, TENANT_ID, 'fresh@example.com');
    expect(result.allowed).toBe(true);
    expect(result.count).toBe(0);
  });

  it(`allows up to INITIATE_RATE_LIMIT_MAX (${String(INITIATE_RATE_LIMIT_MAX)}) rows in the window`, async () => {
    const email = 'retrying@example.com';
    for (let i = 0; i < INITIATE_RATE_LIMIT_MAX - 1; i++) {
      await seedInitiateRow(email, new Date());
    }
    const result = await checkInitiateRateLimit(db, TENANT_ID, email);
    expect(result.count).toBe(INITIATE_RATE_LIMIT_MAX - 1);
    expect(result.allowed).toBe(true);
  });

  it('blocks once INITIATE_RATE_LIMIT_MAX rows already exist in the window (anti email-bomb)', async () => {
    const email = 'bombed@example.com';
    for (let i = 0; i < INITIATE_RATE_LIMIT_MAX; i++) {
      await seedInitiateRow(email, new Date());
    }
    const result = await checkInitiateRateLimit(db, TENANT_ID, email);
    expect(result.count).toBe(INITIATE_RATE_LIMIT_MAX);
    expect(result.allowed).toBe(false);
  });

  it('does not count rows outside the rolling window', async () => {
    const email = 'stale@example.com';
    const outsideWindow = new Date(Date.now() - INITIATE_RATE_LIMIT_WINDOW_MS - 60_000);
    for (let i = 0; i < INITIATE_RATE_LIMIT_MAX + 2; i++) {
      await seedInitiateRow(email, outsideWindow);
    }
    const result = await checkInitiateRateLimit(db, TENANT_ID, email);
    expect(result.count).toBe(0);
    expect(result.allowed).toBe(true);
  });

  it('does not count rows for a DIFFERENT email at the same tenant', async () => {
    for (let i = 0; i < INITIATE_RATE_LIMIT_MAX; i++) {
      await seedInitiateRow('other-subject@example.com', new Date());
    }
    const result = await checkInitiateRateLimit(db, TENANT_ID, 'unrelated@example.com');
    expect(result.count).toBe(0);
    expect(result.allowed).toBe(true);
  });
});
