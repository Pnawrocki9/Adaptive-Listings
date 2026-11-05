/**
 * FOLLOW-1310 (Codex F-07) — the legacy `intent_sessions.intent_state` repair, run for real.
 *
 * Before FOLLOW-1310 the ingest writer stored `JSON.stringify(probabilities)`, so the JSONB value
 * is a STRING. The repair script unwraps it into the `{ weights }` envelope, in place, without
 * inventing `topArchetype` / `confidence` and without touching `started_at`. Asserted through the
 * same shared reader the control-plane routes use.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { PGlite } from '@electric-sql/pglite';
import { readIntentStateEnvelope } from '@estalara/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const REPAIR_SQL = readFileSync(
  join(__dirname, '../../scripts/repair-intent-state-follow1310.sql'),
  'utf8',
);

const TENANT = '11111111-1111-4111-8111-111111111111';
const STARTED = '2026-10-01T10:00:00.000Z';

let pg: PGlite;

beforeAll(async () => {
  pg = new PGlite();
  // Columns as in migrations/0028_intent_sessions.sql (no FK — tenants is not under test).
  await pg.exec(`
    CREATE TABLE intent_sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, session_id text NOT NULL,
      cross_session_id text, started_at timestamptz NOT NULL DEFAULT now(),
      last_event_at timestamptz NOT NULL DEFAULT now(), finalized_at timestamptz,
      final_archetype text, final_confidence numeric(4,3), signal_count int NOT NULL DEFAULT 0,
      quiz_completed boolean NOT NULL DEFAULT false, quiz_leaf text, chat_turns int NOT NULL DEFAULT 0,
      intent_state jsonb,
      CONSTRAINT intent_sessions_tenant_session_unique UNIQUE (tenant_id, session_id)
    );
  `);
  const legacy = JSON.stringify(JSON.stringify({ family_buyer: 0.6, neutral: 0.4 }));
  const current = JSON.stringify({
    weights: { yield_hunter: 0.7, neutral: 0.3 },
    topArchetype: 'yield_hunter',
    confidence: 0.7,
  });
  await pg.query(
    `INSERT INTO intent_sessions (tenant_id, session_id, started_at, intent_state) VALUES
       ($1, 'legacy', $2, $3::jsonb),
       ($1, 'current', $2, $4::jsonb),
       ($1, 'empty', $2, NULL),
       ($1, 'garbage', $2, '"not json"'::jsonb)`,
    [TENANT, STARTED, legacy, current],
  );
});

afterAll(async () => {
  await pg.close();
});

async function stateOf(sessionId: string): Promise<unknown> {
  const res = await pg.query<{ intent_state: unknown }>(
    'SELECT intent_state FROM intent_sessions WHERE session_id = $1',
    [sessionId],
  );
  return res.rows[0]?.intent_state;
}

describe('repair-intent-state-follow1310.sql', () => {
  it('before the repair the legacy row is a JSONB string the reader flags as legacy', async () => {
    expect(typeof (await stateOf('legacy'))).toBe('string');
    expect(readIntentStateEnvelope(await stateOf('legacy')).legacy).toBe(true);
  });

  it('unwraps legacy rows into the envelope, leaves every other row and started_at alone', async () => {
    const before = await pg.query('SELECT session_id, started_at FROM intent_sessions ORDER BY 1');
    await pg.exec(REPAIR_SQL);

    expect(await stateOf('legacy')).toEqual({ weights: { family_buyer: 0.6, neutral: 0.4 } });
    expect(readIntentStateEnvelope(await stateOf('legacy'))).toEqual({
      weights: { family_buyer: 0.6, neutral: 0.4 },
      topArchetype: null,
      confidence: null,
      legacy: false,
    });
    expect(await stateOf('current')).toEqual({
      weights: { yield_hunter: 0.7, neutral: 0.3 },
      topArchetype: 'yield_hunter',
      confidence: 0.7,
    });
    expect(await stateOf('empty')).toBeNull();
    // A string that is not a JSON object is left for a human, never coerced.
    expect(await stateOf('garbage')).toBe('not json');

    const after = await pg.query('SELECT session_id, started_at FROM intent_sessions ORDER BY 1');
    expect(after.rows).toEqual(before.rows);
  });

  it('is idempotent: a second run changes nothing', async () => {
    const snapshot = await pg.query(
      'SELECT session_id, intent_state FROM intent_sessions ORDER BY 1',
    );
    await pg.exec(REPAIR_SQL);
    const again = await pg.query('SELECT session_id, intent_state FROM intent_sessions ORDER BY 1');
    expect(again.rows).toEqual(snapshot.rows);
  });
});
