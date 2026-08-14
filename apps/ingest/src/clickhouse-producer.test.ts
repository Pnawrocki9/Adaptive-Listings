import { describe, expect, it } from 'vitest';

import {
  pushToClickHouse,
  toClickHouseRow,
  type ClickHouseProducerEnv,
} from './clickhouse-producer.js';

const env: ClickHouseProducerEnv = {
  CLICKHOUSE_URL: 'https://ch.example.com:8443',
  CLICKHOUSE_DATABASE: 'default',
  CLICKHOUSE_USER: 'ingest_worker',
  CLICKHOUSE_PASSWORD: 'pw',
};

const envNoCred: ClickHouseProducerEnv = {
  CLICKHOUSE_URL: '',
  CLICKHOUSE_DATABASE: 'default',
};

const NO_BACKOFF = [0, 0, 0] as const;

const validEvent: Record<string, unknown> = {
  event_id: '01928f00-7000-7000-8000-deadbeefcafe',
  tenant_id: 'cbc51cfa-1056-40aa-b0a9-6e982b52b1de',
  session_id: 'a'.repeat(40),
  ts: 1748538900000,
  ingest_received_at: 1748538900100,
  region: 'eu',
  type: 'page.view',
  schema_version: 1,
  consent_state: 'legitimate-interest',
  payload: { url: 'https://app.estalara.com/listings' },
};

function captureFetch(): {
  fetchImpl: typeof fetch;
  lastUrl: () => string;
  lastInit: () => RequestInit | undefined;
  calls: () => number;
} {
  let url = '';
  let init: RequestInit | undefined;
  let n = 0;
  const fetchImpl: typeof fetch = (input, requestInit) => {
    n++;
    url = typeof input === 'string' ? input : (input as URL).toString();
    init = requestInit;
    return Promise.resolve(new Response('', { status: 200 }));
  };
  return {
    fetchImpl,
    lastUrl: () => url,
    lastInit: () => init,
    calls: () => n,
  };
}

function fetchSequence(statuses: number[]): { fetchImpl: typeof fetch; calls: () => number } {
  let i = 0;
  let n = 0;
  return {
    fetchImpl: () => {
      n++;
      const s = statuses[i++] ?? 500;
      return Promise.resolve(new Response('boom', { status: s }));
    },
    calls: () => n,
  };
}

/** A server-generated ClickHouse query id (FOLLOW-845 fixture). */
const CH_QUERY_ID = '53a57251-0991-4c06-b502-80e17c93dda1';

/**
 * A failing response whose `.text()` throws if anything calls it — the executable
 * form of "the body is never read" (FOLLOW-845).
 */
function unreadableBodyResponse(
  status: number,
  headers: Record<string, string> = {},
): { response: Response; bodyReads: () => number } {
  let reads = 0;
  const response = new Response('unread', { status, headers });
  Object.defineProperty(response, 'text', {
    value: () => {
      reads++;
      throw new Error('response body must not be read (FOLLOW-845)');
    },
  });
  return { response, bodyReads: () => reads };
}

describe('toClickHouseRow', () => {
  it('flattens an enriched event into the events-table column shape', () => {
    const row = toClickHouseRow(validEvent);
    expect(row.event_id).toBe('01928f00-7000-7000-8000-deadbeefcafe');
    expect(row.tenant_id).toBe('cbc51cfa-1056-40aa-b0a9-6e982b52b1de');
    expect(row.type).toBe('page.view');
    expect(row.region).toBe('eu');
    expect(row.schema_version).toBe(1);
    expect(row.consent_state).toBe('legitimate-interest');
    expect(typeof row.payload).toBe('string');
    expect(JSON.parse(row.payload as string)).toEqual({
      url: 'https://app.estalara.com/listings',
    });
  });

  it('emits ISO-8601 ms-precision timestamps for ts + ingest_received_at', () => {
    const row = toClickHouseRow(validEvent);
    // 1748538900000 ms epoch → 2025-05-29T17:15:00.000Z (ts kept in fixture-shape
    // rather than re-generated each run so the assertion has a stable value).
    expect(row.ts).toBe('2025-05-29T17:15:00.000Z');
    expect(row.ingest_received_at).toBe('2025-05-29T17:15:00.100Z');
  });

  it('defaults absent optional fields to empty strings', () => {
    const row = toClickHouseRow({
      ...validEvent,
      listing_id: undefined,
      archetype_hint: undefined,
    });
    expect(row.listing_id).toBe('');
    expect(row.archetype_hint).toBe('');
  });
});

describe('pushToClickHouse — no-cred guard (Phase 1 mode)', () => {
  it('returns ok with attempts=0 when CLICKHOUSE_URL is empty', async () => {
    const { fetchImpl, calls } = captureFetch();
    const result = await pushToClickHouse([validEvent], envNoCred, {
      fetchImpl,
      backoffMs: NO_BACKOFF,
    });
    expect(result).toEqual({ ok: true, attempts: 0 });
    expect(calls()).toBe(0);
  });

  it('returns ok with attempts=0 when CLICKHOUSE_URL is absent', async () => {
    const { fetchImpl, calls } = captureFetch();
    const result = await pushToClickHouse(
      [validEvent],
      { CLICKHOUSE_DATABASE: 'default' },
      {
        fetchImpl,
        backoffMs: NO_BACKOFF,
      },
    );
    expect(result).toEqual({ ok: true, attempts: 0 });
    expect(calls()).toBe(0);
  });

  it('returns ok with attempts=0 when the records array is empty', async () => {
    const { fetchImpl, calls } = captureFetch();
    const result = await pushToClickHouse([], env, { fetchImpl, backoffMs: NO_BACKOFF });
    expect(result).toEqual({ ok: true, attempts: 0 });
    expect(calls()).toBe(0);
  });
});

describe('pushToClickHouse — happy path', () => {
  it('POSTs to /?database=…&query=INSERT INTO events FORMAT JSONEachRow with NDJSON body', async () => {
    const cap = captureFetch();
    const result = await pushToClickHouse([validEvent, validEvent], env, {
      fetchImpl: cap.fetchImpl,
      backoffMs: NO_BACKOFF,
    });
    expect(result).toEqual({ ok: true, attempts: 1 });
    expect(cap.calls()).toBe(1);
    const url = cap.lastUrl();
    expect(url.startsWith('https://ch.example.com:8443/?database=default&query=')).toBe(true);
    expect(decodeURIComponent(url.split('query=')[1] ?? '')).toBe(
      'INSERT INTO events FORMAT JSONEachRow',
    );
    const bodyRaw = cap.lastInit()?.body;
    const body = typeof bodyRaw === 'string' ? bodyRaw : '';
    expect(body.split('\n')).toHaveLength(2);
    const first = JSON.parse(body.split('\n')[0] ?? '{}') as Record<string, unknown>;
    expect(first.type).toBe('page.view');
  });

  it('sets Basic auth from CLICKHOUSE_USER + CLICKHOUSE_PASSWORD', async () => {
    const cap = captureFetch();
    await pushToClickHouse([validEvent], env, {
      fetchImpl: cap.fetchImpl,
      backoffMs: NO_BACKOFF,
    });
    const headers = cap.lastInit()?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBe(`Basic ${btoa('ingest_worker:pw')}`);
    expect(headers?.['Content-Type']).toBe('application/x-ndjson');
  });

  it('omits the Authorization header when user/password are absent', async () => {
    const cap = captureFetch();
    const noAuthEnv: ClickHouseProducerEnv = {
      CLICKHOUSE_URL: 'https://ch.example.com:8443',
      CLICKHOUSE_DATABASE: 'default',
    };
    await pushToClickHouse([validEvent], noAuthEnv, {
      fetchImpl: cap.fetchImpl,
      backoffMs: NO_BACKOFF,
    });
    const headers = cap.lastInit()?.headers as Record<string, string> | undefined;
    expect(headers?.Authorization).toBeUndefined();
  });
});

describe('pushToClickHouse — retry semantics', () => {
  it('retries on 5xx and succeeds on the second attempt', async () => {
    const seq = fetchSequence([503, 200]);
    const result = await pushToClickHouse([validEvent], env, {
      fetchImpl: seq.fetchImpl,
      backoffMs: NO_BACKOFF,
    });
    expect(result).toEqual({ ok: true, attempts: 2 });
    expect(seq.calls()).toBe(2);
  });

  it('exhausts all attempts when all 5xx; returns terminal failure', async () => {
    const seq = fetchSequence([502, 503, 504]);
    const result = await pushToClickHouse([validEvent], env, {
      fetchImpl: seq.fetchImpl,
      backoffMs: NO_BACKOFF,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.attempts).toBe(3);
      expect(result.status).toBe(504);
      expect(result.error).toContain('clickhouse_status_504');
    }
  });

  it('reports the last attempt as a transport error when the FINAL retry is a network failure', async () => {
    // FOLLOW-845 ordering guard: attempt 1 gets a real ClickHouse 5xx (so the
    // header-derived fields are populated), attempt 3 rejects at the transport
    // layer. The returned failure must describe attempt 3, not carry attempt 1's
    // code/query id as if it explained the final outcome.
    let call = 0;
    const fetchImpl: typeof fetch = () => {
      call++;
      if (call === 1) {
        return Promise.resolve(
          new Response('', {
            status: 503,
            headers: { 'X-ClickHouse-Exception-Code': '241', 'X-ClickHouse-Query-Id': CH_QUERY_ID },
          }),
        );
      }
      return Promise.reject(new Error('network_failure_test'));
    };
    const result = await pushToClickHouse([validEvent], env, {
      fetchImpl,
      backoffMs: NO_BACKOFF,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('network_failure_test');
      expect(result.chErrorCode).toBeUndefined();
      expect(result.queryId).toBeUndefined();
    }
  });

  it('does NOT retry 4xx — terminal on first attempt (caller bug)', async () => {
    const seq = fetchSequence([400, 200, 200]);
    const result = await pushToClickHouse([validEvent], env, {
      fetchImpl: seq.fetchImpl,
      backoffMs: NO_BACKOFF,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.attempts).toBe(1);
      expect(result.status).toBe(400);
    }
    expect(seq.calls()).toBe(1);
  });
});

// ─── FOLLOW-845 — the failure descriptor comes from headers, never the body ───
//
// The rows this producer POSTs carry the buyer's chat message, and the caller
// puts `error` into a `logger.error` AND a `Sentry.captureException` value. The
// end-to-end proof (real Sentry client, real route, real captured ClickHouse
// body) lives in `clickhouse-sentry-capture-path.test.ts`; these are the
// unit-level properties that fix holds by construction.
describe('pushToClickHouse — failure detail (FOLLOW-845)', () => {
  it('never reads the response body on a 4xx', async () => {
    const { response, bodyReads } = unreadableBodyResponse(400, {
      'X-ClickHouse-Exception-Code': '27',
      'X-ClickHouse-Query-Id': CH_QUERY_ID,
    });
    const result = await pushToClickHouse([validEvent], env, {
      fetchImpl: () => Promise.resolve(response),
      backoffMs: NO_BACKOFF,
    });
    expect(bodyReads()).toBe(0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('clickhouse_status_400:ch_code_27:row_rejected');
      expect(result.chErrorCode).toBe(27);
      expect(result.queryId).toBe(CH_QUERY_ID);
    }
  });

  it('classifies the error code an operator acts on', async () => {
    const cases: [string, string][] = [
      // 27 CANNOT_PARSE_INPUT_ASSERTION_FAILED — the ESC-031 / F-02 drift class.
      ['27', 'clickhouse_status_400:ch_code_27:row_rejected'],
      // 60 UNKNOWN_TABLE — a migration that never ran.
      ['60', 'clickhouse_status_400:ch_code_60:schema_missing'],
      // 516 AUTHENTICATION_FAILED — credential drift, not an outage.
      ['516', 'clickhouse_status_400:ch_code_516:auth'],
      // 241 MEMORY_LIMIT_EXCEEDED — back-pressure.
      ['241', 'clickhouse_status_400:ch_code_241:capacity'],
      // Unmapped: the numeric code still rides, which is the part that matters.
      ['4242', 'clickhouse_status_400:ch_code_4242:unclassified'],
    ];
    for (const [header, expected] of cases) {
      const result = await pushToClickHouse([validEvent], env, {
        fetchImpl: () =>
          Promise.resolve(
            new Response('', { status: 400, headers: { 'X-ClickHouse-Exception-Code': header } }),
          ),
        backoffMs: NO_BACKOFF,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(expected);
    }
  });

  it('falls back to status alone when nothing in front of ClickHouse sets the headers', async () => {
    // e.g. a Cloud load-balancer 502 that never reached ClickHouse itself.
    const { response, bodyReads } = unreadableBodyResponse(502);
    const result = await pushToClickHouse([validEvent], env, {
      fetchImpl: () => Promise.resolve(response),
      backoffMs: NO_BACKOFF,
    });
    expect(bodyReads()).toBe(0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('clickhouse_status_502');
      expect(result.chErrorCode).toBeUndefined();
      expect(result.queryId).toBeUndefined();
    }
  });

  it('ignores header values that are not a bare number / a UUID', async () => {
    // The query id header is ECHOED when a client supplies one. This producer
    // never does, but shape-validating means a future caller cannot turn either
    // header into a free-text channel into Sentry.
    const result = await pushToClickHouse([validEvent], env, {
      fetchImpl: () =>
        Promise.resolve(
          new Response('', {
            status: 400,
            headers: {
              'X-ClickHouse-Exception-Code': 'Code 27: buyer typed this',
              'X-ClickHouse-Query-Id': 'buyer typed this too',
            },
          }),
        ),
      backoffMs: NO_BACKOFF,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('clickhouse_status_400');
      expect(result.chErrorCode).toBeUndefined();
      expect(result.queryId).toBeUndefined();
    }
  });
});

describe('FOLLOW-986 — a 2xx is not the success criterion for an INSERT', () => {
  /** A 200 carrying ClickHouse's own summary header. */
  const respondWithSummary = (writtenRows: string | null): typeof fetch => {
    return () =>
      Promise.resolve(
        new Response('', {
          status: 200,
          headers:
            writtenRows === null
              ? {}
              : { 'X-ClickHouse-Summary': `{"written_rows":"${writtenRows}"}` },
        }),
      );
  };

  it('reports writtenRows when ClickHouse says what it wrote', async () => {
    const result = await pushToClickHouse([{ a: 1 }, { a: 2 }], env, {
      fetchImpl: respondWithSummary('2'),
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.writtenRows).toBe(2);
  });

  it('FAILS on 200 + written_rows=0 — the exact shape the nightly E2E hit', async () => {
    // `attempts: 1`, 50 records sent, HTTP ok, and `SELECT count()` returning 0. Treating the
    // 2xx as success made 50 silently-dropped events indistinguishable from 50 stored ones.
    const result = await pushToClickHouse([{ a: 1 }], env, {
      fetchImpl: respondWithSummary('0'),
    });
    expect(result.ok, 'a write that produced no rows must not report success').toBe(false);
    expect(!result.ok && result.error).toContain('clickhouse_wrote_zero_rows');
  });

  it('stays OK when the header is absent — absence of evidence is not evidence of zero', async () => {
    // Some versions and proxies omit the summary. Failing closed there would turn a working
    // deployment red on a missing diagnostic, which is a worse trade than the gap it closes.
    const result = await pushToClickHouse([{ a: 1 }], env, {
      fetchImpl: respondWithSummary(null),
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.writtenRows).toBeUndefined();
  });

  it('does not fire on an empty batch — zero written for zero sent is correct', async () => {
    const result = await pushToClickHouse([], env, { fetchImpl: respondWithSummary('0') });
    expect(result.ok).toBe(true);
  });
});
