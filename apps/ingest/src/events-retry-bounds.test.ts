/**
 * FOLLOW-1310 — the retry path is byte-bounded and covers the snapshot side-writes (Codex F-15),
 * and the producer can never be thrown out of a batch by one row (Codex F-06).
 *
 * Bounds are asserted on `JSON.stringify(message)` — the exact bytes a `contentType: 'json'`
 * Queue send carries — not on a per-record estimate.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@sentry/cloudflare', () => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

import { pushToClickHouse } from './clickhouse-producer.js';
import {
  chunkRecordsForRetryQueue,
  MAX_RETRY_MESSAGE_BYTES,
  singleRecordRetryBytes,
} from './events-retry-queue.js';
import { handleEventsRetryQueue } from './handlers/events-retry-consumer.js';

/** The exact bytes a `contentType: 'json'` Queue send carries. */
function wireBytes(message: unknown): number {
  return new TextEncoder().encode(JSON.stringify(message)).length;
}

const meta = {
  tenant_id: 'cbc51cfa-1056-40aa-b0a9-6e982b52b1de',
  batch_id: '11111111-1111-4111-8111-111111111111',
  first_failed_at: 1_748_539_000_000,
  attempt: 0,
};

function record(blob = 0, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    event_id: '01928f00-7000-7000-8000-deadbeefcafe',
    tenant_id: meta.tenant_id,
    session_id: 'a'.repeat(40),
    ts: 1748538900000,
    ingest_received_at: 1748538900100,
    region: 'eu',
    type: 'page.view',
    schema_version: 1,
    consent_state: 'legitimate-interest',
    // A quote-heavy blob: JSON escaping makes the serialized record LARGER than its raw string,
    // which is exactly what the old per-row estimate (over `toClickHouseRow`) mis-measured.
    payload: { blob: '"'.repeat(blob) },
    ...extra,
  };
}

describe('F-15: every retry message fits the queue limit, measured on its exact bytes', () => {
  it('the bound sits strictly under the 131,072 B Cloudflare Queues per-message limit', () => {
    expect(MAX_RETRY_MESSAGE_BYTES).toBeLessThan(131_072);
  });

  it('splits near-limit records so that no message — measured whole — exceeds the bound', () => {
    // 30 k quotes escape to ~60 KB on the wire per record: the packer must measure escaped bytes.
    const records = [record(30_000), record(30_000), record(30_000), record(10), record(10)];
    const { messages, oversize } = chunkRecordsForRetryQueue(records, meta);
    expect(oversize).toEqual([]);
    for (const m of messages) {
      expect(wireBytes(m)).toBeLessThanOrEqual(MAX_RETRY_MESSAGE_BYTES);
    }
    expect(messages.reduce((n, m) => n + m.records.length, 0)).toBe(records.length);
  });

  it('a single record that cannot fit alone is reported as oversize, never sent', () => {
    const { messages, oversize } = chunkRecordsForRetryQueue(
      [record(10), record(70_000), record(10)],
      meta,
    );
    expect(oversize).toEqual([1]);
    for (const m of messages) {
      expect(wireBytes(m)).toBeLessThanOrEqual(MAX_RETRY_MESSAGE_BYTES);
    }
    expect(messages.reduce((n, m) => n + m.records.length, 0)).toBe(2);
  });

  it('the byte arithmetic is exact: the ingest-time size gate predicts the wire size', () => {
    const r = record(5);
    const { messages } = chunkRecordsForRetryQueue([r], meta);
    expect(messages).toHaveLength(1);
    expect(singleRecordRetryBytes(r, meta)).toBe(wireBytes(messages[0]));
  });

  it('packs up to the byte, never one past it (boundary)', () => {
    // Size two records so that together they land exactly on the bound, then one byte over.
    const probe = chunkRecordsForRetryQueue([record(0), record(0)], meta).messages[0];
    const twoEmpty = wireBytes(probe);
    const fill = MAX_RETRY_MESSAGE_BYTES - twoEmpty; // bytes left, each quote costs 2
    const exact = [record(0), record(Math.floor(fill / 2))];
    const atBound = chunkRecordsForRetryQueue(exact, meta).messages;
    expect(atBound).toHaveLength(1);
    expect(wireBytes(atBound[0])).toBeLessThanOrEqual(MAX_RETRY_MESSAGE_BYTES);
    const over = [record(0), record(Math.floor(fill / 2) + 1)];
    const split = chunkRecordsForRetryQueue(over, meta).messages;
    expect(split).toHaveLength(2);
    for (const m of split) expect(wireBytes(m)).toBeLessThanOrEqual(MAX_RETRY_MESSAGE_BYTES);
  });
});

describe('F-15: the consumer replays a snapshot side-write message into its sink', () => {
  function msg(body: unknown): {
    message: unknown;
    ack: ReturnType<typeof vi.fn>;
    retry: ReturnType<typeof vi.fn>;
  } {
    const ack = vi.fn();
    const retry = vi.fn();
    return {
      message: { id: 'm1', timestamp: new Date(), body, attempts: 1, ack, retry },
      ack,
      retry,
    };
  }
  const sideWrite = {
    schema_version: 2,
    kind: 'intent_snapshot',
    sink: 'supabase',
    batch_id: meta.batch_id,
    tenant_id: meta.tenant_id,
    first_failed_at: meta.first_failed_at,
    attempt: 0,
    snapshot: {
      session_id: 's'.repeat(40),
      tenant_id: meta.tenant_id,
      ts: 1748538900000,
      payload: {
        archetype: 'family_buyer',
        confidence: 0.6,
        signal_count: 5,
        probabilities: { family_buyer: 0.6, neutral: 0.4 },
        quiz_completed: false,
        quiz_leaf: null,
        chat_turns: 0,
      },
    },
  };
  const env = { SUPABASE_URL: 'https://pg.example.co', SUPABASE_SERVICE_ROLE_KEY: 'srk' };

  it('acks after the Supabase head write lands, touching ONLY that sink', async () => {
    const original = globalThis.fetch;
    const urls: string[] = [];
    globalThis.fetch = (input: string | URL | Request) => {
      urls.push(typeof input === 'string' ? input : (input as URL).toString());
      return Promise.resolve(new Response(null, { status: 201 }));
    };
    try {
      const { message, ack, retry } = msg(sideWrite);
      await handleEventsRetryQueue({ messages: [message] } as never, env as never);
      expect(ack).toHaveBeenCalledTimes(1);
      expect(retry).not.toHaveBeenCalled();
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.every((u) => u.includes('/rest/v1/intent_sessions'))).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('retries (does not ack) while the sink is still failing', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = () => Promise.resolve(new Response(null, { status: 503 }));
    try {
      const { message, ack, retry } = msg(sideWrite);
      await handleEventsRetryQueue({ messages: [message] } as never, env as never);
      expect(ack).not.toHaveBeenCalled();
      expect(retry).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('F-06: the producer never throws a whole batch away for one unencodable row', () => {
  it('skips the bad row, inserts the rest, and reports how many it skipped', async () => {
    let body = '';
    const fetchImpl: typeof fetch = (_input, init) => {
      body = typeof init?.body === 'string' ? init.body : '';
      return Promise.resolve(new Response('', { status: 200 }));
    };
    const result = await pushToClickHouse(
      [record(1), record(1, { ts: 1e16 }), record(1)],
      { CLICKHOUSE_URL: 'https://ch.example.com:8443' },
      { fetchImpl, backoffMs: [0, 0, 0] },
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.skippedRows).toBe(1);
    expect(body.split('\n')).toHaveLength(2);
  });
});
