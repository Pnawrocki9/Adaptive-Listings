/**
 * PGlite-driven tests for `resolveIntentSessionId` (FOLLOW-455 / audit F-20).
 *
 * @vitest-environment node
 *
 * Why node environment?
 *   PGlite (WebAssembly Postgres) requires the Node.js WebAssembly runtime.
 *
 * @module apps/control-plane/src/lib/__tests__/intent-session-lookup.test
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite';
import type { createAdminClient } from '@estalara/db';

import { resolveIntentSessionId } from '../intent-session-lookup.js';

// The fns under test are typed against the production admin client; the pglite
// engine is structurally compatible at runtime, so we cast the test db to it.
type TestDb = ReturnType<typeof createAdminClient>;

const FIXTURE_DDL = /* sql */ `
  CREATE TABLE IF NOT EXISTS tenants (
    id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name text NOT NULL,
    slug text NOT NULL UNIQUE
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

let pg: PGlite;
let db: TestDb;
let TENANT_ID: string;
let TENANT_ID_2: string;

beforeAll(async () => {
  pg = new PGlite();
  await pg.waitReady;
  await pg.exec(FIXTURE_DDL);
  db = drizzlePglite(pg) as unknown as TestDb;

  const row1 = await pg.query<{ id: string }>(
    `INSERT INTO tenants (name, slug) VALUES ('Intent Lookup Tenant 1', 'intent-lookup-1') RETURNING id`,
  );
  const t1 = row1.rows[0];
  if (!t1) throw new Error('Failed to insert tenant 1');
  TENANT_ID = t1.id;

  const row2 = await pg.query<{ id: string }>(
    `INSERT INTO tenants (name, slug) VALUES ('Intent Lookup Tenant 2', 'intent-lookup-2') RETURNING id`,
  );
  const t2 = row2.rows[0];
  if (!t2) throw new Error('Failed to insert tenant 2');
  TENANT_ID_2 = t2.id;
});

afterAll(async () => {
  await pg.close();
});

beforeEach(async () => {
  await pg.exec('DELETE FROM intent_sessions');
});

describe('resolveIntentSessionId', () => {
  it('returns null when no intent_sessions row exists for the subject', async () => {
    const result = await resolveIntentSessionId(db, TENANT_ID, 'sess-no-tracer');
    expect(result).toBeNull();
  });

  it('returns the intent_sessions.id when a row exists for (tenant_id, session_id)', async () => {
    const inserted = await pg.query<{ id: string }>(
      `INSERT INTO intent_sessions (tenant_id, session_id) VALUES ($1, $2) RETURNING id`,
      [TENANT_ID, 'sess-with-tracer'],
    );
    const expectedId = inserted.rows[0]?.id;

    const result = await resolveIntentSessionId(db, TENANT_ID, 'sess-with-tracer');
    expect(result).toBe(expectedId);
  });

  it("tenant isolation: does not resolve a different tenant's row with the same session_id", async () => {
    await pg.query(`INSERT INTO intent_sessions (tenant_id, session_id) VALUES ($1, $2)`, [
      TENANT_ID_2,
      'sess-shared-id',
    ]);

    const result = await resolveIntentSessionId(db, TENANT_ID, 'sess-shared-id');
    expect(result).toBeNull();
  });
});
