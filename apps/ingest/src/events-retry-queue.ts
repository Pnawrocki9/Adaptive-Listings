/**
 * Durable retry queue for the post-ACK ClickHouse `events` insert — FOLLOW-482 / ADR-0017.
 *
 * `apps/ingest` writes the `events` table directly to ClickHouse (ESC-017 — Redpanda Cloud
 * Serverless has no HTTP Proxy, so Redpanda is a prod no-op and ClickHouse is the SOLE events
 * sink). `handlers/events.ts` runs that insert off the ACK path via `ctx.waitUntil()`
 * (FOLLOW-459) with an in-process 3-attempt/backoff retry (`pushToClickHouse`). On terminal
 * failure the batch was previously only Sentry-captured — this module adds the durable retry
 * buffer: a Cloudflare Queue (`estalara-events-retry`) that the producer enqueues to and a
 * `queue()` consumer (`handlers/events-retry-consumer.ts`) drains via the same
 * `pushToClickHouse` path.
 *
 * `EventsRetryMessage` is internal to `apps/ingest` (producer and consumer are the same Worker
 * script) — not a cross-module contract, so it does not need a `packages/shared` schema (ADR-0017
 * Decision §5). It still gets a colocated Zod schema per repo-wide "Zod-validated at every
 * boundary" practice.
 *
 * @module apps/ingest/src/events-retry-queue
 */

import { z } from 'zod';

import { toClickHouseRow } from './clickhouse-producer.js';

/**
 * Cloudflare Queues caps a single message at 128 KB (batch total 256 KB). `chunkRecordsForRetryQueue`
 * flushes a chunk before its accumulated (ClickHouse-row-serialized) record size would cross this
 * threshold, leaving headroom under the hard 128 KB platform limit for the rest of the message
 * envelope (`batch_id`, `tenant_id`, timestamps).
 */
export const MAX_RETRY_MESSAGE_BYTES = 100_000;

/** Zod schema for a retry-queue message. Colocated (not `packages/shared`) — see module doc. */
export const EventsRetryMessageSchema = z.object({
  schema_version: z.literal(1),
  batch_id: z.string(),
  tenant_id: z.string(),
  /** Epoch ms of the first terminal ClickHouse failure that produced this message. */
  first_failed_at: z.number(),
  /** 0 on first enqueue; incremented by the consumer on each Queue-level retry. */
  attempt: z.number().int().nonnegative(),
  /** The same `validated` rows `pushToClickHouse` received on the original attempt. */
  records: z.array(z.record(z.string(), z.unknown())).min(1),
});

export type EventsRetryMessage = z.infer<typeof EventsRetryMessageSchema>;

/** Bindings the retry-queue producer needs from `env`. */
export interface EventsRetryQueueEnv {
  /**
   * Cloudflare Queue producer binding for `estalara-events-retry` (`wrangler.toml`).
   * Absent in an environment that hasn't provisioned the queue yet (dev/local without the
   * binding) — the producer treats this the same as the other "not configured" guards in this
   * app (Phase 1 mode: skip and log, do not throw).
   */
  EVENTS_RETRY_QUEUE?: Queue<EventsRetryMessage>;
}

/** Metadata shared by every chunk produced from one failed batch. */
export interface EventsRetryMessageMeta {
  tenant_id: string;
  batch_id: string;
  first_failed_at: number;
  attempt: number;
}

/**
 * Chunk a failed batch's `records` into one or more `EventsRetryMessage`s bounded by
 * `MAX_RETRY_MESSAGE_BYTES` (ADR-0017 Decision §2 — message-size chunking, load-bearing detail).
 *
 * Size is measured over `JSON.stringify(toClickHouseRow(record))` — the same shape
 * `pushToClickHouse` serializes into the NDJSON body — so the estimate reflects the actual wire
 * weight of each record, not the raw (pre-enrichment) event shape.
 *
 * Returns `[]` for an empty `records` array (empty-records guard).
 */
export function chunkRecordsForRetryQueue(
  records: readonly Record<string, unknown>[],
  meta: EventsRetryMessageMeta,
): EventsRetryMessage[] {
  if (records.length === 0) return [];

  const encoder = new TextEncoder();
  const chunks: EventsRetryMessage[] = [];
  let current: Record<string, unknown>[] = [];
  let currentBytes = 0;

  const flush = (): void => {
    if (current.length === 0) return;
    chunks.push({
      schema_version: 1,
      batch_id: meta.batch_id,
      tenant_id: meta.tenant_id,
      first_failed_at: meta.first_failed_at,
      attempt: meta.attempt,
      records: current,
    });
    current = [];
    currentBytes = 0;
  };

  for (const record of records) {
    const recordBytes = encoder.encode(JSON.stringify(toClickHouseRow(record))).length;
    if (current.length > 0 && currentBytes + recordBytes > MAX_RETRY_MESSAGE_BYTES) {
      flush();
    }
    current.push(record);
    currentBytes += recordBytes;
  }
  flush();

  return chunks;
}
