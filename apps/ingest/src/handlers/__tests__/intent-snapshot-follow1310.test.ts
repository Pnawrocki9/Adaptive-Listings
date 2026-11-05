/**
 * FOLLOW-1310 — one snapshot byte contract and a monotonic head (Codex F-07 / F-16).
 *
 * F-07: `intent_state` was sent as `JSON.stringify(probabilities)`, so the JSONB column held a
 * STRING and every reader (which expects `{ weights, topArchetype, confidence }`) saw nulls.
 * F-16: the PostgREST merge-upsert rewrote `started_at` and `last_event_at` with whatever snapshot
 * arrived last, so an out-of-order or replayed snapshot moved the head BACKWARDS.
 *
 * The fake PostgREST below applies the request semantics the writer relies on (insert-or-ignore on
 * the conflict target; PATCH filtered by `eq.` / `lt.` / `gt.`), so the assertions are about the
 * resulting ROW, not about which URL was built.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/cloudflare', () => ({ captureException: vi.fn() }));

import { buildIntentStateEnvelope } from '@estalara/shared';

import {
  handleIntentSnapshot,
  upsertIntentSessionToSupabase,
  type IntentSnapshotEnv,
  type IntentSnapshotEvent,
} from '../intent-snapshot.js';

const ENV: IntentSnapshotEnv = {
  SUPABASE_URL: 'https://pg.example.co',
  SUPABASE_SERVICE_ROLE_KEY: 'srk',
};

type Row = Record<string, unknown>;

/** Minimal PostgREST for `intent_sessions`, keyed on (tenant_id, session_id). */
function fakePostgrest(): { fetchImpl: typeof fetch; rows: Map<string, Row> } {
  const rows = new Map<string, Row>();
  const fetchImpl = ((input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : (input as URL).toString());
    const method = init?.method ?? 'GET';
    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Row;
    const prefer = new Headers(init?.headers).get('Prefer') ?? '';
    if (method === 'POST') {
      const key = `${String(body.tenant_id)}|${String(body.session_id)}`;
      const existing = rows.get(key);
      if (existing && prefer.includes('ignore-duplicates')) {
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      if (existing && prefer.includes('merge-duplicates')) {
        rows.set(key, { ...existing, ...body });
        return Promise.resolve(new Response(null, { status: 201 }));
      }
      if (existing) return Promise.resolve(new Response('dup', { status: 409 }));
      rows.set(key, { ...body });
      return Promise.resolve(new Response(null, { status: 201 }));
    }
    if (method === 'PATCH') {
      for (const row of rows.values()) {
        let match = true;
        for (const [col, expr] of url.searchParams) {
          const [op, ...rest] = expr.split('.');
          const value = rest.join('.');
          const actual = row[col];
          if (op === 'eq') match &&= String(actual) === value;
          else if (op === 'lt') match &&= Date.parse(String(actual)) < Date.parse(value);
          else if (op === 'gt') match &&= Date.parse(String(actual)) > Date.parse(value);
          else throw new Error(`fake postgrest: unsupported filter ${col}=${expr}`);
        }
        if (match) Object.assign(row, body);
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    }
    throw new Error(`fake postgrest: unsupported method ${method}`);
  }) as typeof fetch;
  return { fetchImpl, rows };
}

function snapshot(ts: number, signalCount: number): IntentSnapshotEvent {
  return {
    session_id: 's'.repeat(40),
    tenant_id: 'aaaaaaaa-0000-4000-8000-000000000001',
    ts,
    payload: {
      archetype: signalCount >= 10 ? 'family_buyer' : 'neutral',
      confidence: signalCount / 20,
      signal_count: signalCount,
      probabilities: { family_buyer: signalCount / 20, neutral: 1 - signalCount / 20 },
      quiz_completed: false,
      quiz_leaf: null,
      chat_turns: 0,
      last_signal_delta: undefined,
    },
  };
}

const T1 = Date.UTC(2026, 10, 5, 10, 0, 0);
const T2 = T1 + 60_000;
const T3 = T2 + 60_000;

describe('F-07: intent_state is ONE JSON object envelope, never a JSON string', () => {
  it('writes { weights, topArchetype, confidence } as an object the readers can destructure', async () => {
    const { fetchImpl, rows } = fakePostgrest();
    const event = snapshot(T1, 10);
    await upsertIntentSessionToSupabase(event, ENV, fetchImpl);
    const row = [...rows.values()][0];
    expect(typeof row?.intent_state).toBe('object');
    expect(row?.intent_state).toEqual({
      weights: event.payload.probabilities,
      topArchetype: 'family_buyer',
      confidence: 0.5,
    });
    // …and it is exactly the shared builder's output — the reader side parses the same contract.
    expect(row?.intent_state).toEqual(buildIntentStateEnvelope(event.payload));
  });
});

describe('F-16: the session head is monotonic and started_at is never overwritten', () => {
  it('out-of-order delivery (T2, T3, T1) ends with started_at = T1 and the head at T3', async () => {
    const { fetchImpl, rows } = fakePostgrest();
    await upsertIntentSessionToSupabase(snapshot(T2, 10), ENV, fetchImpl);
    await upsertIntentSessionToSupabase(snapshot(T3, 15), ENV, fetchImpl);
    // A replayed (retry-queue) or late snapshot from BEFORE the head.
    await upsertIntentSessionToSupabase(snapshot(T1, 5), ENV, fetchImpl);

    expect(rows.size).toBe(1);
    const row = [...rows.values()][0];
    expect(row?.started_at).toBe(new Date(T1).toISOString());
    expect(row?.last_event_at).toBe(new Date(T3).toISOString());
    expect(row?.signal_count).toBe(15);
    expect((row?.intent_state as { topArchetype: string }).topArchetype).toBe('family_buyer');
  });

  it('a newer snapshot advances the head but leaves started_at at the first observation', async () => {
    const { fetchImpl, rows } = fakePostgrest();
    await upsertIntentSessionToSupabase(snapshot(T1, 5), ENV, fetchImpl);
    await upsertIntentSessionToSupabase(snapshot(T2, 10), ENV, fetchImpl);
    const row = [...rows.values()][0];
    expect(row?.started_at).toBe(new Date(T1).toISOString());
    expect(row?.last_event_at).toBe(new Date(T2).toISOString());
    expect(row?.signal_count).toBe(10);
  });

  it('replaying the same snapshot twice is a no-op on the head', async () => {
    const { fetchImpl, rows } = fakePostgrest();
    await upsertIntentSessionToSupabase(snapshot(T2, 10), ENV, fetchImpl);
    await upsertIntentSessionToSupabase(snapshot(T2, 10), ENV, fetchImpl);
    const row = [...rows.values()][0];
    expect(row?.last_event_at).toBe(new Date(T2).toISOString());
    expect(row?.signal_count).toBe(10);
  });
});

describe('F-15: handleIntentSnapshot reports WHICH sink failed so the caller can re-queue it', () => {
  it('returns the failed sink names (supabase down, clickhouse ok)', async () => {
    const fetchImpl = ((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : (input as URL).toString();
      return Promise.resolve(
        new Response(null, { status: url.includes('pg.example.co') ? 503 : 200 }),
      );
    }) as typeof fetch;
    const result = await handleIntentSnapshot(
      snapshot(T1, 5),
      { ...ENV, CLICKHOUSE_URL: 'https://ch.example:8443' },
      fetchImpl,
    );
    expect(result.failedSinks).toEqual(['supabase']);
  });
});
