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
    await pushToClickHouse(
      [validEvent],
      { ...env, CLICKHOUSE_USER: undefined, CLICKHOUSE_PASSWORD: undefined },
      { fetchImpl: cap.fetchImpl, backoffMs: NO_BACKOFF },
    );
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
