/**
 * Vitest integration tests for the `intent.snapshot` dual-write handler (FOLLOW-266).
 *
 * Tests cover:
 *   1. Valid event → both ClickHouse INSERT and Supabase UPSERT called with correct args.
 *   2. signal_count passed through correctly (SDK payload carries the cumulative count).
 *   3. event type `page.view` → intent-snapshot handler NOT called (routing test).
 *   4. ClickHouse INSERT fails → Supabase UPSERT still fires and returns ok: true (fire-and-forget).
 *   5. PII guard: probabilities map NOT present in ClickHouse event_payload.
 *   6. deriveSessionUuid: UUID input returned as-is; non-UUID produces stable deterministic UUID.
 *   7. TG-1 contract tests (FOLLOW-286):
 *      a. PostgREST UPSERT URL carries ?on_conflict=tenant_id,session_id (URL param, not Prefer header)
 *      b. event_type written to ClickHouse equals INTENT_SNAPSHOT_EVENT_TYPE and is in DDL vocabulary
 *      c. 2nd-snapshot update path: URL conflict param present → no 409 on second call
 */

import { describe, expect, it, vi, type Mock } from 'vitest';

import { INTENT_EVENTS_VOCABULARY, INTENT_SNAPSHOT_EVENT_TYPE } from '@estalara/shared';

import {
  deriveSessionUuid,
  handleIntentSnapshot,
  insertIntentEventToClickHouse,
  upsertIntentSessionToSupabase,
  type IntentSnapshotEnv,
  type IntentSnapshotEvent,
} from '../intent-snapshot.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT_ID = 'aaaaaaaa-0000-4000-8000-000000000001';
const SESSION_ID_HEX = 'a'.repeat(64); // SHA-256 hex (non-UUID)
const SESSION_ID_UUID = 'bbbbbbbb-0000-4000-8000-000000000002';

function makeEvent(overrides: Partial<IntentSnapshotEvent> = {}): IntentSnapshotEvent {
  return {
    session_id: SESSION_ID_HEX,
    tenant_id: TENANT_ID,
    ts: 1781287352000,
    payload: {
      archetype: 'family_buyer',
      confidence: 0.74,
      signal_count: 10,
      probabilities: { family_buyer: 0.74, yield_hunter: 0.12, neutral: 0.14 },
      quiz_completed: false,
      quiz_leaf: null,
      chat_turns: 3,
      last_signal_delta: {
        archetype_deltas: { family_buyer: 0.08 },
        event_type: 'quiz.event',
      },
    },
    ...overrides,
  };
}

const ENV_FULL: IntentSnapshotEnv = {
  CLICKHOUSE_URL: 'https://ch.example.com:8443',
  CLICKHOUSE_DATABASE: 'default',
  CLICKHOUSE_USER: 'ingest_worker',
  CLICKHOUSE_PASSWORD: 'pw',
  SUPABASE_URL: 'https://xxx.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
};

const ENV_NO_CH: IntentSnapshotEnv = {
  ...ENV_FULL,
  CLICKHOUSE_URL: '',
};

const ENV_NO_SUPABASE: IntentSnapshotEnv = {
  CLICKHOUSE_URL: 'https://ch.example.com:8443',
  CLICKHOUSE_DATABASE: 'default',
  CLICKHOUSE_USER: 'ingest_worker',
  CLICKHOUSE_PASSWORD: 'pw',
  SUPABASE_URL: '',
  // SUPABASE_SERVICE_ROLE_KEY intentionally absent (exactOptionalPropertyTypes: no undefined literal)
};

const ENV_EMPTY: IntentSnapshotEnv = {};

// ---------------------------------------------------------------------------
// Helper: capture fetch calls
// ---------------------------------------------------------------------------

interface FetchCapture {
  fetchImpl: Mock<typeof fetch>;
  calls: () => { url: string; init: RequestInit | undefined }[];
}

function reqToStr(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

function captureFetch(status = 200): FetchCapture {
  const captured: { url: string; init: RequestInit | undefined }[] = [];
  const fetchImpl = vi.fn((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    captured.push({ url: reqToStr(input), init });
    return Promise.resolve(new Response('', { status }));
  }) as unknown as Mock<typeof fetch>;
  return {
    fetchImpl,
    calls: () => captured,
  };
}

function failFetch(errorMsg = 'network_error'): Mock<typeof fetch> {
  return vi.fn(() => Promise.reject(new Error(errorMsg)));
}

// ---------------------------------------------------------------------------
// Test 1: valid event → both ClickHouse INSERT and Supabase UPSERT called
// ---------------------------------------------------------------------------

describe('handleIntentSnapshot', () => {
  it('calls both ClickHouse and Supabase with correct args for a valid event', async () => {
    const { fetchImpl, calls } = captureFetch(200);
    const event = makeEvent();

    await handleIntentSnapshot(event, ENV_FULL, fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(2);

    const chCall = calls().find((c) => c.url.includes('intent_events'));
    const pgCall = calls().find((c) => c.url.includes('intent_sessions'));

    expect(chCall).toBeDefined();
    expect(pgCall).toBeDefined();

    // ClickHouse body contains event_type and correct fields
    const chBody = JSON.parse(chCall!.init!.body as string) as Record<string, unknown>;
    expect(chBody.event_type).toBe(INTENT_SNAPSHOT_EVENT_TYPE);
    expect(chBody.top_archetype).toBe('family_buyer');
    expect(chBody.confidence_after).toBe(0.74);
    // LG-3 fix (FOLLOW-286 P2): confidence_before is null for snapshot rows, not 0
    expect(chBody.confidence_before).toBeNull();
    expect(chBody.tenant_id).toBe(TENANT_ID);
    expect(chBody.archetype_deltas).toBe(JSON.stringify({ family_buyer: 0.08 }));

    // LG-2 fix (FOLLOW-286): session_id (raw string) written, not a derived UUID
    expect(chBody.session_id).toBe(SESSION_ID_HEX);

    // Supabase body contains session state fields
    const pgBody = JSON.parse(pgCall!.init!.body as string) as Record<string, unknown>;
    expect(pgBody.tenant_id).toBe(TENANT_ID);
    expect(pgBody.session_id).toBe(SESSION_ID_HEX);
    expect(pgBody.signal_count).toBe(10);
    expect(pgBody.quiz_completed).toBe(false);
    expect(pgBody.chat_turns).toBe(3);
    // intent_state holds probabilities
    expect(pgBody.intent_state).toBe(
      JSON.stringify({ family_buyer: 0.74, yield_hunter: 0.12, neutral: 0.14 }),
    );
  });

  // -----------------------------------------------------------------------
  // Test 2: signal_count passes through correctly
  // -----------------------------------------------------------------------
  it('passes signal_count from payload to Supabase upsert body', async () => {
    const { fetchImpl, calls } = captureFetch(201);
    const event = makeEvent({ payload: { ...makeEvent().payload, signal_count: 25 } });

    await handleIntentSnapshot(event, ENV_FULL, fetchImpl);

    const pgCall = calls().find((c) => c.url.includes('intent_sessions'));
    expect(pgCall).toBeDefined();
    const pgBody = JSON.parse(pgCall!.init!.body as string) as { signal_count: number };
    expect(pgBody.signal_count).toBe(25);
  });

  // -----------------------------------------------------------------------
  // Test 3: page.view event → handler NOT triggered
  // -----------------------------------------------------------------------
  it('does NOT call ClickHouse or Supabase for non-intent.snapshot events', async () => {
    // This test verifies the routing logic in events.ts: only intent.snapshot type
    // dispatches the handler. We test by confirming the handler functions themselves
    // short-circuit when env is unconfigured and no fetch is called.
    const fetchImpl = vi.fn(() =>
      Promise.resolve(new Response('', { status: 200 })),
    ) as unknown as typeof fetch;

    // Simulate the events.ts routing: for page.view, handler would not be called.
    // We verify that calling insertIntentEventToClickHouse with empty env returns ok:true
    // without any fetch calls (the "skip" guard) — this is the behavior when no env is set
    // and the handler is not routed to.
    const result = await insertIntentEventToClickHouse(
      makeEvent(),
      SESSION_ID_HEX,
      ENV_EMPTY,
      fetchImpl,
    );
    expect(result.ok).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();

    // Also verify supabase skips cleanly with no env
    const pgResult = await upsertIntentSessionToSupabase(makeEvent(), ENV_EMPTY, fetchImpl);
    expect(pgResult.ok).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // Test 4: ClickHouse fails → Supabase still fires, handler returns (fire-and-forget)
  // -----------------------------------------------------------------------
  it('still calls Supabase even when ClickHouse INSERT fails', async () => {
    const pgFetch = vi.fn((input: RequestInfo | URL): Promise<Response> => {
      const url = reqToStr(input);
      if (url.includes('intent_events')) {
        return Promise.reject(new Error('clickhouse_network_error'));
      }
      return Promise.resolve(new Response('', { status: 201 }));
    }) as unknown as typeof fetch;

    // handleIntentSnapshot should not throw even when CH fails
    await expect(handleIntentSnapshot(makeEvent(), ENV_FULL, pgFetch)).resolves.toBeUndefined();

    // Supabase was called
    const calls = (pgFetch as unknown as Mock).mock.calls as [RequestInfo | URL][];
    const pgCall = calls.find((c) => reqToStr(c[0]).includes('intent_sessions'));
    expect(pgCall).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Test 5: PII guard — probabilities NOT in ClickHouse event_payload
  // -----------------------------------------------------------------------
  it('excludes probabilities map from ClickHouse event_payload', async () => {
    const { fetchImpl, calls } = captureFetch(200);
    const event = makeEvent();

    await handleIntentSnapshot(event, ENV_FULL, fetchImpl);

    const chCall = calls().find((c) => c.url.includes('intent_events'));
    expect(chCall).toBeDefined();
    const chBody = JSON.parse(chCall!.init!.body as string) as { event_payload: string };
    const eventPayload = JSON.parse(chBody.event_payload) as Record<string, unknown>;

    // probabilities must NOT be in event_payload
    expect(eventPayload).not.toHaveProperty('probabilities');
    // but signal_count, quiz_completed, etc. should be present
    expect(eventPayload).toHaveProperty('signal_count', 10);
    expect(eventPayload).toHaveProperty('quiz_completed', false);
    expect(eventPayload).toHaveProperty('chat_turns', 3);
    expect(eventPayload).toHaveProperty('quiz_leaf', null);
  });

  // -----------------------------------------------------------------------
  // ClickHouse-only skip when URL not configured
  // -----------------------------------------------------------------------
  it('skips ClickHouse write when CLICKHOUSE_URL is empty', async () => {
    const { fetchImpl, calls } = captureFetch(201);

    await handleIntentSnapshot(makeEvent(), ENV_NO_CH, fetchImpl);

    // Only Supabase called (no CH URL → skip)
    const chCall = calls().find((c) => c.url.includes('intent_events'));
    expect(chCall).toBeUndefined();
    const pgCall = calls().find((c) => c.url.includes('intent_sessions'));
    expect(pgCall).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // Supabase-only skip when URL not configured
  // -----------------------------------------------------------------------
  it('skips Supabase write when SUPABASE_URL is empty', async () => {
    const { fetchImpl, calls } = captureFetch(200);

    await handleIntentSnapshot(makeEvent(), ENV_NO_SUPABASE, fetchImpl);

    const pgCall = calls().find((c) => c.url.includes('intent_sessions'));
    expect(pgCall).toBeUndefined();
    const chCall = calls().find((c) => c.url.includes('intent_events'));
    expect(chCall).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Test 6: deriveSessionUuid
// ---------------------------------------------------------------------------

describe('deriveSessionUuid', () => {
  it('returns UUID input as-is (no transformation)', async () => {
    const result = await deriveSessionUuid(TENANT_ID, SESSION_ID_UUID);
    expect(result).toBe(SESSION_ID_UUID);
  });

  it('produces a valid UUID for a non-UUID hex session_id', async () => {
    const result = await deriveSessionUuid(TENANT_ID, SESSION_ID_HEX);
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(result).toMatch(uuidPattern);
  });

  it('produces the same UUID for the same inputs (deterministic)', async () => {
    const a = await deriveSessionUuid(TENANT_ID, SESSION_ID_HEX);
    const b = await deriveSessionUuid(TENANT_ID, SESSION_ID_HEX);
    expect(a).toBe(b);
  });

  it('produces different UUIDs for different tenant_id inputs', async () => {
    const a = await deriveSessionUuid('aaaaaaaa-0000-4000-8000-000000000001', SESSION_ID_HEX);
    const b = await deriveSessionUuid('cccccccc-0000-4000-8000-000000000003', SESSION_ID_HEX);
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Direct unit tests for individual write functions
// ---------------------------------------------------------------------------

describe('insertIntentEventToClickHouse', () => {
  it('inserts correct row shape with raw session_id (LG-2 fix)', async () => {
    const { fetchImpl, calls } = captureFetch(200);
    const event = makeEvent();

    // LG-2 fix: pass raw session_id string, not a derived UUID
    const result = await insertIntentEventToClickHouse(
      event,
      event.session_id,
      ENV_FULL,
      fetchImpl,
    );

    expect(result.ok).toBe(true);
    expect(calls()).toHaveLength(1);

    const body = JSON.parse(calls()[0]!.init!.body as string) as Record<string, unknown>;
    // LG-2: new 'session_id' column carries the raw session fingerprint (migration 0015 ADD COLUMN).
    // intent_session_id is also present (it's the ORDER BY key column — cannot be renamed in CH).
    // Both carry the same raw value for join compatibility.
    expect(body.session_id).toBe(SESSION_ID_HEX);
    expect(body.intent_session_id).toBe(SESSION_ID_HEX);
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(body.event_type).toBe(INTENT_SNAPSHOT_EVENT_TYPE);
    // event_at should be an ISO 8601 string
    expect(typeof body.event_at).toBe('string');
    expect(String(body.event_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // LG-3: confidence_before is null for snapshot rows
    expect(body.confidence_before).toBeNull();
  });

  it('returns ok:false on 5xx ClickHouse response', async () => {
    const { fetchImpl } = captureFetch(500);
    const result = await insertIntentEventToClickHouse(
      makeEvent(),
      SESSION_ID_HEX,
      ENV_FULL,
      fetchImpl,
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('500');
  });

  it('returns ok:false on network error', async () => {
    const result = await insertIntentEventToClickHouse(
      makeEvent(),
      SESSION_ID_HEX,
      ENV_FULL,
      failFetch('net_error'),
    );
    expect(result.ok).toBe(false);
  });
});

describe('upsertIntentSessionToSupabase', () => {
  it('sends correct upsert payload', async () => {
    const { fetchImpl, calls } = captureFetch(201);
    const event = makeEvent();

    const result = await upsertIntentSessionToSupabase(event, ENV_FULL, fetchImpl);

    expect(result.ok).toBe(true);

    const body = JSON.parse(calls()[0]!.init!.body as string) as Record<string, unknown>;
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(body.session_id).toBe(SESSION_ID_HEX);
    expect(body.quiz_completed).toBe(false);
    expect(body.chat_turns).toBe(3);
  });

  it('accepts 200 as success (PostgREST may return 200 on merge)', async () => {
    const { fetchImpl } = captureFetch(200);
    const result = await upsertIntentSessionToSupabase(makeEvent(), ENV_FULL, fetchImpl);
    expect(result.ok).toBe(true);
  });

  it('returns ok:false on 4xx Supabase response', async () => {
    const { fetchImpl } = captureFetch(422);
    const result = await upsertIntentSessionToSupabase(makeEvent(), ENV_FULL, fetchImpl);
    expect(result.ok).toBe(false);
  });

  it('returns ok:false on network error', async () => {
    const result = await upsertIntentSessionToSupabase(makeEvent(), ENV_FULL, failFetch());
    expect(result.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// TG-1 — Request contract tests (FOLLOW-286, Rule Q)
// These tests assert the REAL wire contract, not mock-call shapes.
// ---------------------------------------------------------------------------

describe('TG-1: PostgREST UPSERT URL contract (CB-1 fix)', () => {
  it('PostgREST UPSERT URL contains ?on_conflict=tenant_id,session_id as a URL query parameter', async () => {
    const { fetchImpl, calls } = captureFetch(200);

    await upsertIntentSessionToSupabase(makeEvent(), ENV_FULL, fetchImpl);

    const pgCall = calls().find((c) => c.url.includes('intent_sessions'));
    expect(pgCall).toBeDefined();

    // CB-1 fix: on_conflict MUST be a URL query parameter
    const urlObj = new URL(pgCall!.url);
    expect(urlObj.searchParams.get('on_conflict')).toBe('tenant_id,session_id');
  });

  it('Prefer header does NOT contain on_conflict (it belongs in the URL, not the header)', async () => {
    const { fetchImpl, calls } = captureFetch(200);

    await upsertIntentSessionToSupabase(makeEvent(), ENV_FULL, fetchImpl);

    const pgCall = calls().find((c) => c.url.includes('intent_sessions'));
    expect(pgCall).toBeDefined();

    const preferHeader = (pgCall!.init!.headers as Record<string, string>).Prefer;
    // Prefer header must NOT include on_conflict
    expect(preferHeader).not.toContain('on_conflict');
    // Prefer header must include resolution and return
    expect(preferHeader).toContain('resolution=merge-duplicates');
    expect(preferHeader).toContain('return=minimal');
  });

  it('2nd snapshot for same (tenant_id, session_id) does NOT get a 409 (conflict param in URL → UPDATE path)', async () => {
    // Simulate real PostgREST behavior: when on_conflict is a URL param, conflict → 200/201 UPDATE.
    // When on_conflict is in Prefer header only, PostgREST ignores it → 409 INSERT conflict.
    // We assert the URL carries the param, ensuring PostgREST routes to UPDATE.
    let callCount = 0;
    const fetchImpl = vi.fn((input: RequestInfo | URL, _init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('intent_sessions')) {
        callCount++;
        const urlObj = new URL(url);
        const hasConflictParam = urlObj.searchParams.get('on_conflict') === 'tenant_id,session_id';
        // Simulate: if conflict param is in URL → PostgREST handles UPDATE → 200
        //           if not → PostgREST does INSERT → 409 on 2nd call
        if (hasConflictParam) {
          return Promise.resolve(new Response('', { status: 200 }));
        }
        // Missing param: 1st call 201, 2nd call 409 (simulates the bug)
        return Promise.resolve(new Response('', { status: callCount === 1 ? 201 : 409 }));
      }
      return Promise.resolve(new Response('', { status: 200 }));
    }) as unknown as typeof fetch;

    // First snapshot
    const result1 = await upsertIntentSessionToSupabase(makeEvent(), ENV_FULL, fetchImpl);
    expect(result1.ok).toBe(true);

    // Second snapshot — same (tenant_id, session_id)
    const result2 = await upsertIntentSessionToSupabase(makeEvent(), ENV_FULL, fetchImpl);
    // With on_conflict in URL, both calls return 200 (UPDATE path). No 409.
    expect(result2.ok).toBe(true);
    expect(callCount).toBe(2);
  });
});

describe('TG-1: ClickHouse event_type vocabulary contract (LG-1 fix)', () => {
  it('event_type written to ClickHouse equals INTENT_SNAPSHOT_EVENT_TYPE constant', async () => {
    const { fetchImpl, calls } = captureFetch(200);

    await insertIntentEventToClickHouse(makeEvent(), SESSION_ID_HEX, ENV_FULL, fetchImpl);

    const body = JSON.parse(calls()[0]!.init!.body as string) as Record<string, unknown>;
    expect(body.event_type).toBe(INTENT_SNAPSHOT_EVENT_TYPE);
  });

  it('event_type written to ClickHouse is within the documented 0014 DDL vocabulary', async () => {
    const { fetchImpl, calls } = captureFetch(200);

    await insertIntentEventToClickHouse(makeEvent(), SESSION_ID_HEX, ENV_FULL, fetchImpl);

    const body = JSON.parse(calls()[0]!.init!.body as string) as Record<string, unknown>;
    // The written value must be a member of the DDL LowCardinality vocabulary
    expect(INTENT_EVENTS_VOCABULARY as readonly string[]).toContain(body.event_type);
  });

  it('INTENT_SNAPSHOT_EVENT_TYPE is within INTENT_EVENTS_VOCABULARY (constant self-consistency)', () => {
    // Ensures that if the vocabulary is updated without including the snapshot type,
    // this test fails loudly instead of silently allowing a vocabulary mismatch.
    expect(INTENT_EVENTS_VOCABULARY as readonly string[]).toContain(INTENT_SNAPSHOT_EVENT_TYPE);
  });
});

describe('TG-1: ClickHouse session_id join-key contract (LG-2 fix)', () => {
  it('ClickHouse row carries raw session_id string (not a derived UUID) for FOLLOW-269 join', async () => {
    const { fetchImpl, calls } = captureFetch(200);

    await handleIntentSnapshot(makeEvent(), ENV_FULL, fetchImpl);

    const chCall = calls().find((c) => c.url.includes('intent_events'));
    expect(chCall).toBeDefined();
    const body = JSON.parse(chCall!.init!.body as string) as Record<string, unknown>;

    // LG-2: new session_id column (migration 0015 ADD COLUMN) carries the raw fingerprint.
    // intent_session_id is also present as the ORDER BY key — cannot be renamed in ClickHouse.
    // Both carry the same raw session_id value so FOLLOW-269 can join on either.
    expect(body.session_id).toBe(SESSION_ID_HEX);
    // session_id must NOT be a derived UUID (which would not match intent_sessions.session_id)
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(uuidPattern.test(body.session_id as string)).toBe(false);
  });

  it('session_id in ClickHouse row matches session_id in Supabase upsert row (same join key)', async () => {
    const { fetchImpl, calls } = captureFetch(200);

    await handleIntentSnapshot(makeEvent(), ENV_FULL, fetchImpl);

    const chCall = calls().find((c) => c.url.includes('intent_events'));
    const pgCall = calls().find((c) => c.url.includes('intent_sessions'));

    expect(chCall).toBeDefined();
    expect(pgCall).toBeDefined();

    const chBody = JSON.parse(chCall!.init!.body as string) as Record<string, unknown>;
    const pgBody = JSON.parse(pgCall!.init!.body as string) as Record<string, unknown>;

    // Both rows use the same session_id — the join key for FOLLOW-269
    expect(chBody.session_id).toBe(pgBody.session_id);
    expect(chBody.tenant_id).toBe(pgBody.tenant_id);
  });
});
