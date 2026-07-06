import { describe, expect, it } from 'vitest';

import {
  chunkRecordsForRetryQueue,
  EventsRetryMessageSchema,
  MAX_RETRY_MESSAGE_BYTES,
} from './events-retry-queue.js';

const smallEvent: Record<string, unknown> = {
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

function bigEvent(blobSize: number): Record<string, unknown> {
  return { ...smallEvent, payload: { blob: 'x'.repeat(blobSize) } };
}

const meta = {
  tenant_id: 'cbc51cfa-1056-40aa-b0a9-6e982b52b1de',
  batch_id: '11111111-1111-4111-8111-111111111111',
  first_failed_at: 1_748_539_000_000,
  attempt: 0,
};

describe('chunkRecordsForRetryQueue — empty-records guard', () => {
  it('returns [] for an empty records array', () => {
    expect(chunkRecordsForRetryQueue([], meta)).toEqual([]);
  });
});

describe('chunkRecordsForRetryQueue — happy path', () => {
  it('packs small records into a single chunk carrying the message envelope', () => {
    const chunks = chunkRecordsForRetryQueue([smallEvent, smallEvent], meta);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({
      schema_version: 1,
      batch_id: meta.batch_id,
      tenant_id: meta.tenant_id,
      first_failed_at: meta.first_failed_at,
      attempt: 0,
    });
    expect(chunks[0]?.records).toHaveLength(2);
  });
});

describe('chunkRecordsForRetryQueue — oversized batch forces multi-chunk .send()', () => {
  it('splits records across multiple messages once the running total would exceed the byte cap', () => {
    // Two ~60 KB records: the first alone fits under MAX_RETRY_MESSAGE_BYTES (100 KB), but
    // adding the second would cross it — the chunker must flush before appending it.
    const blobSize = 60_000;
    const records = [bigEvent(blobSize), bigEvent(blobSize), bigEvent(blobSize)];
    const chunks = chunkRecordsForRetryQueue(records, meta);

    expect(chunks.length).toBeGreaterThan(1);
    // Every chunk stays under the 128 KB Cloudflare Queues hard cap (with headroom).
    for (const chunk of chunks) {
      const size = new TextEncoder().encode(JSON.stringify(chunk)).length;
      expect(size).toBeLessThan(128_000);
    }
    // No record is dropped across the split.
    const totalRecords = chunks.reduce((sum, c) => sum + c.records.length, 0);
    expect(totalRecords).toBe(records.length);
  });

  it('never exceeds MAX_RETRY_MESSAGE_BYTES per chunk for many small records', () => {
    const records = Array.from({ length: 500 }, () => smallEvent);
    const chunks = chunkRecordsForRetryQueue(records, meta);
    expect(chunks.length).toBeGreaterThan(0);
    const totalRecords = chunks.reduce((sum, c) => sum + c.records.length, 0);
    expect(totalRecords).toBe(500);
    for (const chunk of chunks.slice(0, -1)) {
      // Every non-terminal chunk should have been flushed at/under the threshold.
      const bytes = chunk.records.reduce(
        (sum, r) => sum + new TextEncoder().encode(JSON.stringify(r)).length,
        0,
      );
      expect(bytes).toBeLessThanOrEqual(MAX_RETRY_MESSAGE_BYTES + 1000);
    }
  });
});

describe('EventsRetryMessageSchema — malformed message from a hypothetical bad producer', () => {
  it('accepts a well-formed message', () => {
    const chunks = chunkRecordsForRetryQueue([smallEvent], meta);
    expect(EventsRetryMessageSchema.safeParse(chunks[0]).success).toBe(true);
  });

  it('rejects a message missing required fields', () => {
    const result = EventsRetryMessageSchema.safeParse({
      schema_version: 1,
      batch_id: 'b1',
      // tenant_id missing
      first_failed_at: 123,
      attempt: 0,
      records: [{ a: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a message with an empty records array', () => {
    const result = EventsRetryMessageSchema.safeParse({
      schema_version: 1,
      batch_id: 'b1',
      tenant_id: 't1',
      first_failed_at: 123,
      attempt: 0,
      records: [],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a message with the wrong schema_version', () => {
    const result = EventsRetryMessageSchema.safeParse({
      schema_version: 2,
      batch_id: 'b1',
      tenant_id: 't1',
      first_failed_at: 123,
      attempt: 0,
      records: [{ a: 1 }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a completely unrelated shape', () => {
    expect(EventsRetryMessageSchema.safeParse({ foo: 'bar' }).success).toBe(false);
    expect(EventsRetryMessageSchema.safeParse(null).success).toBe(false);
    expect(EventsRetryMessageSchema.safeParse('not-an-object').success).toBe(false);
  });
});
