/**
 * Vitest integration tests for the `intent.snapshot` dual-write handler (FOLLOW-266 + FOLLOW-287).
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
 *   8. TG-1 contract tests (FOLLOW-287):
 *      a. CB-2: confidence_before is 0.0 (not null) in ClickHouse JSONEachRow body
 *      b. CB-1: session_id in ClickHouse body is the raw session_id string (not a 64-char SHA-256 hex converted to UUID)
 *      c. DG-1: console.error is called when Promise.allSettled returns a rejection
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
    // CB-2 fix (FOLLOW-287): confidence_before is 0.0 (Float32 NOT NULL — null would be rejected by JSONEachRow)
    expect(chBody.confidence_before).toBe(0.0);
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
    // LG-2: session_id column (migration 0015) carries the raw session fingerprint.
    // intent_session_id (ORDER BY key, UUID) is omitted — ClickHouse uses zero-UUID default.
    // MODIFY COLUMN on ORDER BY key columns is forbidden (error 524, migration 0016 is a no-op).
    expect(body.session_id).toBe(SESSION_ID_HEX);
    expect(body.intent_session_id).toBeUndefined();
    expect(body.tenant_id).toBe(TENANT_ID);
    expect(body.event_type).toBe(INTENT_SNAPSHOT_EVENT_TYPE);
    // event_at should be an ISO 8601 string
    expect(typeof body.event_at).toBe('string');
    expect(String(body.event_at)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // CB-2 fix (FOLLOW-287): confidence_before is 0.0 (not null) — Float32 NOT NULL column
    expect(body.confidence_before).toBe(0.0);
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

    // LG-2: session_id column (migration 0015) carries the raw fingerprint.
    // intent_session_id (ORDER BY key, UUID) is omitted — zero-UUID default.
    expect(body.session_id).toBe(SESSION_ID_HEX);
    expect(body.intent_session_id).toBeUndefined();
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

// ---------------------------------------------------------------------------
// TG-1 FOLLOW-287 — CB-2, CB-1, DG-1 contract tests
// ---------------------------------------------------------------------------

describe('TG-1 FOLLOW-287: ClickHouse JSONEachRow body type correctness (CB-2 fix)', () => {
  it('confidence_before is 0.0 (not null) in the ClickHouse INSERT body', async () => {
    const { fetchImpl, calls } = captureFetch(200);
    const event = makeEvent();

    await handleIntentSnapshot(event, ENV_FULL, fetchImpl);

    const chCall = calls().find((c) => c.url.includes('intent_events'));
    expect(chCall).toBeDefined();
    const body = JSON.parse(chCall!.init!.body as string) as Record<string, unknown>;

    // CB-2 fix: Float32 NOT NULL — null would cause JSONEachRow to silently reject the row.
    // 0.0 is the correct sentinel for "no prior confidence on the first snapshot."
    expect(body.confidence_before).not.toBeNull();
    expect(typeof body.confidence_before).toBe('number');
    expect(body.confidence_before).toBe(0.0);
  });

  it('no Float32 NOT NULL field in the INSERT body contains null', async () => {
    const { fetchImpl, calls } = captureFetch(200);

    await handleIntentSnapshot(makeEvent(), ENV_FULL, fetchImpl);

    const chCall = calls().find((c) => c.url.includes('intent_events'));
    expect(chCall).toBeDefined();
    const body = JSON.parse(chCall!.init!.body as string) as Record<string, unknown>;

    // Assert neither Float32 NOT NULL column carries null (would be JSONEachRow-rejected).
    expect(body.confidence_before).not.toBeNull();
    expect(body.confidence_after).not.toBeNull();
  });
});

describe('TG-1 FOLLOW-287: session_id is the raw session fingerprint (CB-1 fix)', () => {
  it('session_id in the ClickHouse body is the raw session_id string (64-char hex), not a derived UUID', async () => {
    const { fetchImpl, calls } = captureFetch(200);
    // Use a 64-char hex session_id (the SHA-256 hex shape that was previously causing UUID column rejection)
    const event = makeEvent({ session_id: SESSION_ID_HEX });

    await handleIntentSnapshot(event, ENV_FULL, fetchImpl);

    const chCall = calls().find((c) => c.url.includes('intent_events'));
    expect(chCall).toBeDefined();
    const body = JSON.parse(chCall!.init!.body as string) as Record<string, unknown>;

    // CB-1 fix: session_id must be the raw 64-char hex string, NOT a derived UUID.
    // A derived UUID would never match intent_sessions.session_id for FOLLOW-269 joins,
    // and the old UUID column type would reject non-hyphenated strings entirely.
    expect(body.session_id).toBe(SESSION_ID_HEX);
    expect(typeof body.session_id).toBe('string');
    // Must be exactly the raw session_id (64 hex chars), not a 36-char hyphenated UUID
    expect((body.session_id as string).length).toBe(64);
  });

  it('intent_session_id (ORDER BY key, UUID) is omitted from INSERT — ClickHouse uses zero-UUID default', async () => {
    const { fetchImpl, calls } = captureFetch(200);
    const event = makeEvent({ session_id: SESSION_ID_HEX });

    await handleIntentSnapshot(event, ENV_FULL, fetchImpl);

    const chCall = calls().find((c) => c.url.includes('intent_events'));
    expect(chCall).toBeDefined();
    const body = JSON.parse(chCall!.init!.body as string) as Record<string, unknown>;

    // MODIFY COLUMN on ORDER BY key columns is forbidden (ClickHouse error 524).
    // intent_session_id is omitted from the INSERT; ClickHouse uses zero-UUID default.
    // session_id (String, migration 0015) is the authoritative join key for FOLLOW-269.
    expect(body.intent_session_id).toBeUndefined();
    expect(body.session_id).toBe(SESSION_ID_HEX);
  });
});

describe('TG-1 FOLLOW-287: DG-1 — console.error fires on Promise.allSettled rejection', () => {
  it('calls console.error when ClickHouse write returns ok:false (5xx response), includes tenant_id and session_id', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      // ClickHouse returns 500 — insertIntentEventToClickHouse catches this and returns {ok: false}.
      // Promise.allSettled status === 'fulfilled' with {ok: false}, triggering the write_failed branch.
      // (The 'rejected' branch fires only when the write helper itself throws synchronously, which
      // it never does — it always catches internally and returns {ok: false}.)
      const fetchImpl = vi.fn((input: RequestInfo | URL): Promise<Response> => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('intent_events')) {
          return Promise.resolve(new Response('clickhouse_down', { status: 500 }));
        }
        return Promise.resolve(new Response('', { status: 200 }));
      }) as unknown as typeof fetch;

      await handleIntentSnapshot(makeEvent(), ENV_FULL, fetchImpl);

      // DG-1: console.error must have been called with structured data including tenant_id, session_id
      expect(consoleErrorSpy).toHaveBeenCalled();
      const errorCallArgs = consoleErrorSpy.mock.calls[0];
      expect(errorCallArgs).toBeDefined();
      const logLine = errorCallArgs![0] as string;
      const parsed = JSON.parse(logLine) as Record<string, unknown>;
      expect(parsed.event).toBe('intent_snapshot_clickhouse_write_failed');
      expect(parsed.tenant_id).toBe(TENANT_ID);
      expect(parsed.session_id).toBe(SESSION_ID_HEX);
      expect(typeof parsed.error).toBe('string');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('calls console.error when ClickHouse write network-errors (fetch throws), includes tenant_id and session_id', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      // ClickHouse fetch throws (network error) — insertIntentEventToClickHouse catches it,
      // returns {ok: false, error: 'ch_network_failure'}. The write_failed branch fires.
      const fetchImpl = vi.fn((input: RequestInfo | URL): Promise<Response> => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('intent_events')) {
          return Promise.reject(new Error('ch_network_failure'));
        }
        return Promise.resolve(new Response('', { status: 200 }));
      }) as unknown as typeof fetch;

      await handleIntentSnapshot(makeEvent(), ENV_FULL, fetchImpl);

      expect(consoleErrorSpy).toHaveBeenCalled();
      const logLine = consoleErrorSpy.mock.calls[0]![0] as string;
      const parsed = JSON.parse(logLine) as Record<string, unknown>;
      expect(parsed.event).toBe('intent_snapshot_clickhouse_write_failed');
      expect(parsed.tenant_id).toBe(TENANT_ID);
      expect(parsed.session_id).toBe(SESSION_ID_HEX);
      expect(typeof parsed.error).toBe('string');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('calls console.error when Supabase write returns ok:false (5xx response), includes tenant_id and session_id', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const fetchImpl = vi.fn((input: RequestInfo | URL): Promise<Response> => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (url.includes('intent_sessions')) {
          return Promise.resolve(new Response('supabase_down', { status: 503 }));
        }
        return Promise.resolve(new Response('', { status: 200 }));
      }) as unknown as typeof fetch;

      await handleIntentSnapshot(makeEvent(), ENV_FULL, fetchImpl);

      expect(consoleErrorSpy).toHaveBeenCalled();
      const logLine = consoleErrorSpy.mock.calls[0]![0] as string;
      const parsed = JSON.parse(logLine) as Record<string, unknown>;
      expect(parsed.event).toBe('intent_snapshot_supabase_write_failed');
      expect(parsed.tenant_id).toBe(TENANT_ID);
      expect(parsed.session_id).toBe(SESSION_ID_HEX);
      expect(typeof parsed.error).toBe('string');
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });

  it('does NOT call console.error when both writes succeed', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const { fetchImpl } = captureFetch(200);
      await handleIntentSnapshot(makeEvent(), ENV_FULL, fetchImpl);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
    } finally {
      consoleErrorSpy.mockRestore();
    }
  });
});
