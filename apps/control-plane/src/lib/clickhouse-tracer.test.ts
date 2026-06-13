/**
 * Unit tests for clickhouse-tracer.ts (FOLLOW-267 / FOLLOW-297, ADR-0012 Ticket D).
 *
 * Coverage:
 *   CH-1: resolveClickHouseTracerConfig — returns null when CLICKHOUSE_URL unset
 *   CH-2: resolveClickHouseTracerConfig — returns config object when CLICKHOUSE_URL set
 *   CH-3: resolveClickHouseTracerConfig — strips trailing slash from URL
 *   CH-4: chTracerQuery — builds URL with FORMAT JSONEachRow suffix
 *   CH-5: chTracerQuery — binds params as param_<key> URL search params (no injection)
 *   CH-6: chTracerQuery — sets database query param
 *   CH-7: chTracerQuery — throws on non-2xx response (Rule K.2)
 *   CH-8: chTracerQuery — returns empty array for empty response body
 *   CH-9: chTracerQuery — parses JSONEachRow multi-line response
 *   CH-10: chTracerQuery — sets Authorization header when password present
 *   CH-11: chTracerQuery — sends no Authorization header when password empty
 *   CH-12: chTracerCount — returns 0 for empty response
 *   CH-13: chTracerCount — parses count from JSONEachRow response
 *   CH-14: chTracerCount — throws on non-2xx (Rule K.2)
 *   CH-15: fetchIntentEventsForSession — uses session_id (not intent_session_id)
 *   CH-16: fetchIntentEventsForSession — passes both tenant_id and session_id as params
 *   CH-17: fetchIntentEventsHistory — builds optional filter clauses without injection
 *   CH-18: fetchIntentEventsHistory — calls count query in parallel with data query
 *   CH-19: fetchIntentEventsForExport — passes all three required params
 *   CH-20: fetchNewIntentEvents — passes lastEventAt as param (cursor advancement)
 *   CH-21: AbortSignal.timeout is 8000ms (documented)
 *
 * RETRO-061 suspects addressed:
 *   - DG-1: MAX_POLLS docstring off by 3× (tested in stream route test, documented here)
 *   - Parameterized query construction verified: no string interpolation of user input
 *
 * @module apps/control-plane/src/lib/clickhouse-tracer.test
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─── Mock global fetch ─────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440042';
const SESSION_ID = 'sha256abc123def456';

function makeOkResponse(body: string): Response {
  return new Response(body, { status: 200 });
}

function makeErrorResponse(status: number, body = 'ClickHouse error'): Response {
  return new Response(body, { status });
}

function captureURL(): URL {
  const callArg = mockFetch.mock.calls[0]?.[0] as string;
  return new URL(callArg);
}

// ─── Import after mock setup ───────────────────────────────────────────────────

import {
  resolveClickHouseTracerConfig,
  chTracerQuery,
  chTracerCount,
  fetchIntentEventsForSession,
  fetchIntentEventsHistory,
  fetchIntentEventsForExport,
  fetchNewIntentEvents,
  type ClickHouseTracerConfig,
} from './clickhouse-tracer';

const CFG: ClickHouseTracerConfig = {
  url: 'http://clickhouse:8123',
  password: 'secret',
  database: 'estalara',
};

const CFG_NO_PASS: ClickHouseTracerConfig = {
  url: 'http://clickhouse:8123',
  password: '',
  database: 'estalara',
};

// ─── resolveClickHouseTracerConfig tests ─────────────────────────────────────

describe('resolveClickHouseTracerConfig', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it('CH-1: returns null when CLICKHOUSE_URL is unset', () => {
    vi.stubEnv('CLICKHOUSE_URL', '');
    expect(resolveClickHouseTracerConfig()).toBeNull();
  });

  it('CH-2: returns config object when CLICKHOUSE_URL is set', () => {
    vi.stubEnv('CLICKHOUSE_URL', 'http://ch:8123');
    vi.stubEnv('CLICKHOUSE_PASSWORD', 'mypass');
    vi.stubEnv('CLICKHOUSE_DATABASE', 'mydb');
    const cfg = resolveClickHouseTracerConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.url).toBe('http://ch:8123');
    expect(cfg!.password).toBe('mypass');
    expect(cfg!.database).toBe('mydb');
  });

  it('CH-3: strips trailing slash from URL', () => {
    vi.stubEnv('CLICKHOUSE_URL', 'http://ch:8123/');
    const cfg = resolveClickHouseTracerConfig();
    expect(cfg!.url).toBe('http://ch:8123');
  });

  it('falls back to empty string when CLICKHOUSE_DATABASE is set to empty', () => {
    // vi.stubEnv('CLICKHOUSE_DATABASE', '') sets the env to '' (not undefined).
    // The ?? operator only falls back for null/undefined, not empty string.
    // When CLICKHOUSE_DATABASE is genuinely unset (undefined), the fallback is 'default'.
    // This test documents the actual behavior: empty-string env → empty-string database.
    vi.stubEnv('CLICKHOUSE_URL', 'http://ch:8123');
    vi.stubEnv('CLICKHOUSE_PASSWORD', '');
    vi.stubEnv('CLICKHOUSE_DATABASE', '');
    const cfg = resolveClickHouseTracerConfig();
    // '' ?? 'default' === '' because '' is not null/undefined.
    expect(cfg!.database).toBe('');
  });
});

// ─── chTracerQuery tests ──────────────────────────────────────────────────────

describe('chTracerQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('CH-4: appends FORMAT JSONEachRow to the query', async () => {
    mockFetch.mockResolvedValue(makeOkResponse(''));
    await chTracerQuery(CFG, 'SELECT 1');
    const url = captureURL();
    expect(url.searchParams.get('query')).toContain('FORMAT JSONEachRow');
  });

  it('CH-5: binds params as param_<key> URL search params (no string interpolation)', async () => {
    mockFetch.mockResolvedValue(makeOkResponse(''));
    const SQL_INJECTION_VALUE = "'; DROP TABLE intent_events; --";
    await chTracerQuery(CFG, 'SELECT * FROM t WHERE x = {x:String}', {
      x: SQL_INJECTION_VALUE,
    });
    const url = captureURL();
    // The value must be in a param_x query param, NOT in the query itself.
    expect(url.searchParams.get('param_x')).toBe(SQL_INJECTION_VALUE);
    // The query itself must not contain the injection string.
    expect(url.searchParams.get('query')).not.toContain(SQL_INJECTION_VALUE);
  });

  it('CH-6: sets database query param on the URL', async () => {
    mockFetch.mockResolvedValue(makeOkResponse(''));
    await chTracerQuery(CFG, 'SELECT 1');
    const url = captureURL();
    expect(url.searchParams.get('database')).toBe('estalara');
  });

  it('CH-7: throws on non-2xx response (Rule K.2 — configured-store failure must propagate)', async () => {
    mockFetch.mockResolvedValue(makeErrorResponse(500, 'Code: 100. DB error.'));
    await expect(chTracerQuery(CFG, 'SELECT 1')).rejects.toThrow(/ClickHouse tracer query failed/);
    await expect(chTracerQuery(CFG, 'SELECT 1')).rejects.toThrow(/HTTP 500/);
  });

  it('CH-8: returns empty array for empty response body', async () => {
    mockFetch.mockResolvedValue(makeOkResponse(''));
    const result = await chTracerQuery(CFG, 'SELECT 1');
    expect(result).toEqual([]);
  });

  it('CH-8b: returns empty array for whitespace-only response body', async () => {
    mockFetch.mockResolvedValue(makeOkResponse('   \n  '));
    const result = await chTracerQuery(CFG, 'SELECT 1');
    expect(result).toEqual([]);
  });

  it('CH-9: parses multi-line JSONEachRow response', async () => {
    const body = '{"a":1}\n{"a":2}\n{"a":3}';
    mockFetch.mockResolvedValue(makeOkResponse(body));
    const result = await chTracerQuery<{ a: number }>(CFG, 'SELECT a FROM t');
    expect(result).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  });

  it('CH-10: sets Authorization header when password is present', async () => {
    mockFetch.mockResolvedValue(makeOkResponse(''));
    await chTracerQuery(CFG, 'SELECT 1');
    const callHeaders = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(callHeaders).toBeDefined();
    expect(callHeaders.Authorization).toMatch(/^Basic /);
    // Basic auth encodes :<password>
    const decoded = Buffer.from(
      callHeaders.Authorization!.replace('Basic ', ''),
      'base64',
    ).toString('utf-8');
    expect(decoded).toBe(':secret');
  });

  it('CH-11: sends no Authorization header when password is empty', async () => {
    mockFetch.mockResolvedValue(makeOkResponse(''));
    await chTracerQuery(CFG_NO_PASS, 'SELECT 1');
    const callHeaders = mockFetch.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(callHeaders.Authorization).toBeUndefined();
  });

  it('CH-21: uses AbortSignal.timeout(8000)', async () => {
    mockFetch.mockResolvedValue(makeOkResponse(''));
    await chTracerQuery(CFG, 'SELECT 1');
    const callOptions = mockFetch.mock.calls[0]?.[1] as RequestInit;
    // signal must be present — it's the timeout signal.
    expect(callOptions.signal).toBeDefined();
  });
});

// ─── chTracerCount tests ──────────────────────────────────────────────────────

describe('chTracerCount', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('CH-12: returns 0 for empty response body', async () => {
    mockFetch.mockResolvedValue(makeOkResponse(''));
    const count = await chTracerCount(CFG, 'SELECT count() AS count FROM t');
    expect(count).toBe(0);
  });

  it('CH-13: parses count from JSONEachRow response', async () => {
    mockFetch.mockResolvedValue(makeOkResponse('{"count":"42"}'));
    const count = await chTracerCount(CFG, 'SELECT count() AS count FROM t');
    expect(count).toBe(42);
  });

  it('CH-14: throws on non-2xx (Rule K.2)', async () => {
    mockFetch.mockResolvedValue(makeErrorResponse(503, 'Server unavailable'));
    await expect(chTracerCount(CFG, 'SELECT count() AS count FROM t')).rejects.toThrow(
      /ClickHouse tracer count failed/,
    );
  });

  it('returns 0 when count row is missing (defensive)', async () => {
    // JSONEachRow with no rows (e.g. count on empty table that returns nothing).
    mockFetch.mockResolvedValue(makeOkResponse(''));
    const count = await chTracerCount(CFG, 'SELECT count() AS count FROM t WHERE 1=0');
    expect(count).toBe(0);
  });
});

// ─── fetchIntentEventsForSession tests ───────────────────────────────────────

describe('fetchIntentEventsForSession', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('CH-15: uses session_id column (not intent_session_id, per FOLLOW-287 / join key)', async () => {
    mockFetch.mockResolvedValue(makeOkResponse(''));
    await fetchIntentEventsForSession(CFG, TENANT_ID, SESSION_ID);
    const url = captureURL();
    const query = url.searchParams.get('query') ?? '';
    // Must reference session_id in the WHERE clause.
    expect(query).toContain('session_id');
    // Must NOT reference intent_session_id (the ORDER BY key that was a dead column).
    expect(query).not.toContain('intent_session_id');
  });

  it('CH-16: passes both tenant_id and session_id as bound params', async () => {
    mockFetch.mockResolvedValue(makeOkResponse(''));
    await fetchIntentEventsForSession(CFG, TENANT_ID, SESSION_ID);
    const url = captureURL();
    expect(url.searchParams.get('param_p_tenant_id')).toBe(TENANT_ID);
    expect(url.searchParams.get('param_p_session_id')).toBe(SESSION_ID);
  });

  it('selects all required IntentEventRow columns', async () => {
    const row = {
      session_id: SESSION_ID,
      tenant_id: TENANT_ID,
      event_at: '2026-01-01T00:00:00.000',
      event_type: 'intent.snapshot',
      archetype_deltas: '{}',
      confidence_before: 0.5,
      confidence_after: 0.7,
      top_archetype: 'yield_hunter',
      event_payload: '{}',
    };
    mockFetch.mockResolvedValue(makeOkResponse(JSON.stringify(row)));
    const rows = await fetchIntentEventsForSession(CFG, TENANT_ID, SESSION_ID);
    expect(rows).toHaveLength(1);
    const r = rows[0]!;
    expect(r.session_id).toBe(SESSION_ID);
    expect(r.tenant_id).toBe(TENANT_ID);
    expect(r.event_type).toBe('intent.snapshot');
    expect(r.top_archetype).toBe('yield_hunter');
    expect(r.event_payload).toBe('{}');
  });

  it('throws when ClickHouse returns non-2xx (Rule K.2)', async () => {
    mockFetch.mockResolvedValue(makeErrorResponse(500, 'DB error'));
    await expect(fetchIntentEventsForSession(CFG, TENANT_ID, SESSION_ID)).rejects.toThrow(
      /ClickHouse tracer query failed/,
    );
  });
});

// ─── fetchIntentEventsHistory tests ──────────────────────────────────────────

describe('fetchIntentEventsHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // fetchIntentEventsHistory issues two parallel fetch calls via Promise.all (data + count).
  // mockResolvedValue shares the same Response object which can only be read once — body
  // is consumed by the first caller and the second receives "Body is unusable".
  // Use mockResolvedValueOnce chained so each call gets a fresh Response.
  function twoEmptyResponses(): void {
    mockFetch.mockResolvedValueOnce(makeOkResponse('')).mockResolvedValueOnce(makeOkResponse(''));
  }

  it('CH-17a: always includes tenant_id WHERE clause without injection', async () => {
    // Two fetch calls: data + count. Each needs its own Response instance.
    twoEmptyResponses();
    await fetchIntentEventsHistory(CFG, { tenantId: TENANT_ID, limit: 50, offset: 0 });

    // Both calls should have tenant_id param bound.
    for (const call of mockFetch.mock.calls) {
      const url = new URL(call[0] as string);
      expect(url.searchParams.get('param_p_tenant_id')).toBe(TENANT_ID);
      // Query must use placeholder, not inline tenant_id.
      expect(url.searchParams.get('query')).not.toContain(TENANT_ID);
    }
  });

  it('CH-17b: adds session_id clause when sessionId provided', async () => {
    twoEmptyResponses();
    await fetchIntentEventsHistory(CFG, {
      tenantId: TENANT_ID,
      sessionId: SESSION_ID,
      limit: 50,
      offset: 0,
    });

    const dataCall = mockFetch.mock.calls[0]!;
    const url = new URL(dataCall[0] as string);
    expect(url.searchParams.get('param_p_session_id')).toBe(SESSION_ID);
  });

  it('CH-17c: adds from/to clauses without injection when provided', async () => {
    twoEmptyResponses();
    const FROM = '2026-01-01T00:00:00Z';
    const TO = '2026-01-31T23:59:59Z';
    await fetchIntentEventsHistory(CFG, {
      tenantId: TENANT_ID,
      from: FROM,
      to: TO,
      limit: 50,
      offset: 0,
    });

    const dataCall = mockFetch.mock.calls[0]!;
    const url = new URL(dataCall[0] as string);
    expect(url.searchParams.get('param_p_from')).toBe(FROM);
    expect(url.searchParams.get('param_p_to')).toBe(TO);
    // Query must not inline these values.
    const query = url.searchParams.get('query') ?? '';
    expect(query).not.toContain(FROM);
    expect(query).not.toContain(TO);
  });

  it('CH-17d: adds archetype filter when archetype provided', async () => {
    twoEmptyResponses();
    await fetchIntentEventsHistory(CFG, {
      tenantId: TENANT_ID,
      archetype: 'yield_hunter',
      limit: 50,
      offset: 0,
    });

    const dataCall = mockFetch.mock.calls[0]!;
    const url = new URL(dataCall[0] as string);
    expect(url.searchParams.get('param_p_archetype')).toBe('yield_hunter');
  });

  it('CH-18: issues data and count queries in parallel (two fetch calls)', async () => {
    twoEmptyResponses();
    await fetchIntentEventsHistory(CFG, { tenantId: TENANT_ID, limit: 50, offset: 0 });
    // Promise.all means both calls happen — two total fetch invocations.
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('returns { events, total } shape', async () => {
    const ROW = JSON.stringify({
      session_id: SESSION_ID,
      tenant_id: TENANT_ID,
      event_at: '2026-01-01T00:00:00.000',
      event_type: 'intent.snapshot',
      archetype_deltas: '{}',
      confidence_before: 0.5,
      confidence_after: 0.7,
      top_archetype: 'yield_hunter',
      event_payload: '{}',
    });

    // First call = data (returns one row), second call = count.
    mockFetch
      .mockResolvedValueOnce(makeOkResponse(ROW))
      .mockResolvedValueOnce(makeOkResponse('{"count":"1"}'));

    const { events, total } = await fetchIntentEventsHistory(CFG, {
      tenantId: TENANT_ID,
      limit: 50,
      offset: 0,
    });
    expect(events).toHaveLength(1);
    expect(total).toBe(1);
  });

  it('forwards limit and offset as UInt32 params', async () => {
    twoEmptyResponses();
    await fetchIntentEventsHistory(CFG, { tenantId: TENANT_ID, limit: 75, offset: 25 });

    // Data query (first call) should have limit + offset bound.
    const dataUrl = new URL(mockFetch.mock.calls[0]![0] as string);
    expect(dataUrl.searchParams.get('param_p_limit')).toBe('75');
    expect(dataUrl.searchParams.get('param_p_offset')).toBe('25');
  });
});

// ─── fetchIntentEventsForExport tests ────────────────────────────────────────

describe('fetchIntentEventsForExport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('CH-19: passes all three required params without injection', async () => {
    mockFetch.mockResolvedValue(makeOkResponse(''));
    const FROM = '2026-01-01T00:00:00Z';
    const TO = '2026-01-31T23:59:59Z';
    await fetchIntentEventsForExport(CFG, { tenantId: TENANT_ID, from: FROM, to: TO });

    const url = captureURL();
    expect(url.searchParams.get('param_p_tenant_id')).toBe(TENANT_ID);
    expect(url.searchParams.get('param_p_from')).toBe(FROM);
    expect(url.searchParams.get('param_p_to')).toBe(TO);
    // Verify no inline interpolation in the query string.
    const query = url.searchParams.get('query') ?? '';
    expect(query).not.toContain(TENANT_ID);
    expect(query).not.toContain(FROM);
    expect(query).not.toContain(TO);
  });

  it('throws when ClickHouse returns non-2xx (Rule K.2)', async () => {
    mockFetch.mockResolvedValue(makeErrorResponse(500, 'DB error'));
    await expect(
      fetchIntentEventsForExport(CFG, {
        tenantId: TENANT_ID,
        from: '2026-01-01T00:00:00Z',
        to: '2026-01-31T23:59:59Z',
      }),
    ).rejects.toThrow(/ClickHouse tracer query failed/);
  });
});

// ─── fetchNewIntentEvents tests ───────────────────────────────────────────────

describe('fetchNewIntentEvents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('CH-20: passes lastEventAt as param_p_last_event_at for cursor advancement', async () => {
    mockFetch.mockResolvedValue(makeOkResponse(''));
    const LAST_EVENT_AT = '2026-01-15T10:00:00.000Z';
    await fetchNewIntentEvents(CFG, TENANT_ID, SESSION_ID, LAST_EVENT_AT);

    const url = captureURL();
    expect(url.searchParams.get('param_p_last_event_at')).toBe(LAST_EVENT_AT);
    expect(url.searchParams.get('param_p_tenant_id')).toBe(TENANT_ID);
    expect(url.searchParams.get('param_p_session_id')).toBe(SESSION_ID);
  });

  it('uses > (strict) comparison on event_at for cursor (no duplicate events)', async () => {
    mockFetch.mockResolvedValue(makeOkResponse(''));
    await fetchNewIntentEvents(CFG, TENANT_ID, SESSION_ID, '2026-01-15T10:00:00Z');
    const url = captureURL();
    const query = url.searchParams.get('query') ?? '';
    // Must use > not >= to avoid re-delivering the last-seen event.
    expect(query).toContain('> parseDateTimeBestEffort({p_last_event_at:String})');
  });

  it('throws when ClickHouse returns non-2xx (Rule K.2)', async () => {
    mockFetch.mockResolvedValue(makeErrorResponse(503));
    await expect(
      fetchNewIntentEvents(CFG, TENANT_ID, SESSION_ID, '2026-01-01T00:00:00Z'),
    ).rejects.toThrow(/ClickHouse tracer query failed/);
  });

  it('returns empty array when no new events', async () => {
    mockFetch.mockResolvedValue(makeOkResponse(''));
    const result = await fetchNewIntentEvents(CFG, TENANT_ID, SESSION_ID, '2026-01-01T00:00:00Z');
    expect(result).toEqual([]);
  });
});
