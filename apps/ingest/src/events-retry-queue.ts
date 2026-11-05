/**
 * Durable retry queue for the post-ACK ClickHouse `events` insert — FOLLOW-482 / ADR-0017.
 *
 * `apps/ingest` writes the `events` table directly to ClickHouse (ESC-017 — there is no
 * event bus, so ClickHouse is the SOLE events sink). `handlers/events.ts` runs that insert off the ACK path via `ctx.waitUntil()`
 * (FOLLOW-459) with an in-process 3-attempt/backoff retry (`pushToClickHouse`). On terminal
 * failure the batch was previously only Sentry-captured — this module adds the durable retry
 * buffer: a Cloudflare Queue (`estalara-events-retry`) that the producer enqueues to and a
 * `queue()` consumer (`handlers/events-retry-consumer.ts`) drains via the same
 * `pushToClickHouse` path.
 *
 * FOLLOW-1310 (Codex F-15) adds two things: an EXACT byte bound on every message (see
 * `MAX_RETRY_MESSAGE_BYTES`), and a second message kind for the `intent.snapshot` side-writes
 * (ClickHouse `intent_events`, Supabase `intent_sessions`), which until then were best-effort with
 * no replay at all.
 *
 * `EventsRetryMessage` is internal to `apps/ingest` (producer and consumer are the same Worker
 * script) — not a cross-module contract, so it does not need a `packages/shared` schema (ADR-0017
 * Decision §5). It still gets a colocated Zod schema per repo-wide "Zod-validated at every
 * boundary" practice.
 *
 * @module apps/ingest/src/events-retry-queue
 */

import { z } from 'zod';

import { IntentSnapshotPayloadSchema } from '@estalara/shared';

/** Cloudflare Queues' hard per-message limit: 128 KB = 131,072 bytes. [FOLLOW-1310, Codex F-15] */
const QUEUE_MESSAGE_LIMIT_BYTES = 131_072;

/**
 * The bound every retry message is held to, measured EXACTLY over `JSON.stringify(message)` — the
 * bytes a `contentType: 'json'` send carries (every `.send()` in this Worker passes
 * `RETRY_QUEUE_SEND_OPTIONS`, so the encoding is not left to a platform default).
 * [FOLLOW-1310, Codex F-15]
 *
 * Until FOLLOW-1310 the bound was 100,000 B applied to a per-record ESTIMATE over
 * `toClickHouseRow(record)` — a different shape from the one enqueued (`payload` re-stringified,
 * fields dropped) — and a single record above it was still enqueued alone, so a message could
 * exceed the platform limit and the `.send()` failed. Now the whole message is measured; a record
 * that cannot fit even alone is reported as `oversize` and never sent, and ingest refuses such an
 * event up front (`event_too_large`, `handlers/events.ts`), so an ACKed event always fits. The
 * 3,072 B of headroom under the platform limit is for Cloudflare's own per-message metadata.
 */
export const MAX_RETRY_MESSAGE_BYTES = QUEUE_MESSAGE_LIMIT_BYTES - 3_072; // = 128,000

/** Send options used by every producer in this Worker — see `MAX_RETRY_MESSAGE_BYTES`. */
export const RETRY_QUEUE_SEND_OPTIONS = { contentType: 'json' } as const;

/**
 * `schema_version` of the ClickHouse `events` re-insert message. Its shape is UNCHANGED since
 * FOLLOW-482, so messages already in flight across a deploy parse as before. Bump only when this
 * shape changes — never just widen the schema in place (FOLLOW-513 / LG-1).
 */
export const CURRENT_EVENTS_RETRY_SCHEMA_VERSION = 1 as const;

/**
 * `schema_version` of a DERIVED-STORE side-write message — the first shape with a `kind`
 * discriminator, so a later derived store adds a `kind`, not a version. [FOLLOW-1310, Codex F-15]
 */
export const SIDE_WRITE_RETRY_SCHEMA_VERSION = 2 as const;

/**
 * Loose envelope schema — validates only that `schema_version` is present and is a non-negative
 * integer, without asserting anything about the rest of the shape. The consumer parses with this
 * FIRST to decide how to route the message (FOLLOW-513 / LG-1): a message whose `schema_version`
 * doesn't even parse this far is genuinely malformed (ack-drop, unchanged behavior); a message
 * that parses this far but carries a `schema_version` this build doesn't know how to handle yet
 * must NOT be ack-dropped — Cloudflare holds in-flight messages across deploys, so ack-dropping an
 * unknown-but-well-formed version would silently lose retries the day a version bump ships.
 */
export const EventsRetryMessageEnvelopeSchema = z.object({
  schema_version: z.number().int().nonnegative(),
});

/** Zod schema for a `schema_version: 1` retry-queue message. Colocated (not `packages/shared`) — see module doc. */
export const EventsRetryMessageSchema = z.object({
  schema_version: z.literal(CURRENT_EVENTS_RETRY_SCHEMA_VERSION),
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

/** The two derived stores an `intent.snapshot` writes besides `events` (`handlers/intent-snapshot.ts`). */
const IntentSnapshotSinkSchema = z.enum(['clickhouse', 'supabase']);
export type IntentSnapshotSink = z.infer<typeof IntentSnapshotSinkSchema>;

/**
 * A failed `intent.snapshot` side-write, ONE sink per message, so a Queue-level retry re-drives
 * only the store that failed (a whole-snapshot retry would duplicate the append-only
 * `intent_events` row whenever only Supabase had failed). Replaying an older snapshot is safe: the
 * Supabase head write is monotonic (FOLLOW-1310, Codex F-16). [FOLLOW-1310, Codex F-15]
 */
export const IntentSnapshotRetryMessageSchema = z.object({
  schema_version: z.literal(SIDE_WRITE_RETRY_SCHEMA_VERSION),
  kind: z.literal('intent_snapshot'),
  sink: IntentSnapshotSinkSchema,
  batch_id: z.string(),
  tenant_id: z.string(),
  first_failed_at: z.number(),
  attempt: z.number().int().nonnegative(),
  snapshot: z.object({
    session_id: z.string().min(1),
    cross_session_id: z.string().optional(),
    tenant_id: z.string().min(1),
    ts: z.number().int().positive(),
    payload: IntentSnapshotPayloadSchema,
  }),
});

type IntentSnapshotRetryMessage = z.infer<typeof IntentSnapshotRetryMessageSchema>;

/** Every message shape this Worker enqueues. */
type RetryQueueMessage = EventsRetryMessage | IntentSnapshotRetryMessage;

/** Bindings the retry-queue producer needs from `env`. */
export interface EventsRetryQueueEnv {
  /**
   * Cloudflare Queue producer binding for `estalara-events-retry` (`wrangler.toml`).
   * Absent in an environment that hasn't provisioned the queue yet (dev/local without the
   * binding) — the producer treats this the same as the other "not configured" guards in this
   * app (Phase 1 mode: skip and log, do not throw).
   */
  EVENTS_RETRY_QUEUE?: Queue<RetryQueueMessage>;
}

/** Metadata shared by every chunk produced from one failed batch. */
export interface EventsRetryMessageMeta {
  tenant_id: string;
  batch_id: string;
  first_failed_at: number;
  attempt: number;
}

const encoder = new TextEncoder();

/** UTF-8 byte length of `JSON.stringify(value)` — the exact size of a json-typed Queue body. */
function jsonBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).length;
}

/** Exact wire size of a retry message. */
function retryMessageBytes(message: RetryQueueMessage): number {
  return jsonBytes(message);
}

function emptyEventsMessage(meta: EventsRetryMessageMeta): EventsRetryMessage {
  return {
    schema_version: CURRENT_EVENTS_RETRY_SCHEMA_VERSION,
    batch_id: meta.batch_id,
    tenant_id: meta.tenant_id,
    first_failed_at: meta.first_failed_at,
    attempt: meta.attempt,
    records: [],
  };
}

/**
 * Exact size of a ONE-record events message for `record` under `meta`. JSON is compositional: a
 * message holding records r1..rn serialises to the empty-records message with `r1,…,rn` spliced
 * between the brackets, so its size is `base + Σ size(ri) + (n − 1)` — no estimate involved.
 */
export function singleRecordRetryBytes(
  record: Record<string, unknown>,
  meta: EventsRetryMessageMeta,
): number {
  return jsonBytes(emptyEventsMessage(meta)) + jsonBytes(record);
}

/** Result of chunking: sendable messages plus the input indexes that cannot fit any message. */
interface ChunkedRetryMessages {
  messages: EventsRetryMessage[];
  /** Indexes into `records` of rows whose one-record message alone exceeds the bound. */
  oversize: number[];
}

/**
 * Chunk a failed batch's `records` into `EventsRetryMessage`s that each serialise to at most
 * `MAX_RETRY_MESSAGE_BYTES` (ADR-0017 Decision §2; exact since FOLLOW-1310). A record that cannot
 * fit even alone is returned in `oversize` and is NOT in any message — the caller reports it.
 *
 * Returns no messages for an empty `records` array (empty-records guard).
 */
export function chunkRecordsForRetryQueue(
  records: readonly Record<string, unknown>[],
  meta: EventsRetryMessageMeta,
): ChunkedRetryMessages {
  const messages: EventsRetryMessage[] = [];
  const oversize: number[] = [];
  if (records.length === 0) return { messages, oversize };

  const baseBytes = jsonBytes(emptyEventsMessage(meta));
  let current: Record<string, unknown>[] = [];
  let currentBytes = baseBytes;

  const flush = (): void => {
    if (current.length === 0) return;
    messages.push({ ...emptyEventsMessage(meta), records: current });
    current = [];
    currentBytes = baseBytes;
  };

  records.forEach((record, index) => {
    const recordBytes = jsonBytes(record);
    if (baseBytes + recordBytes > MAX_RETRY_MESSAGE_BYTES) {
      oversize.push(index);
      return;
    }
    // `+ 1` is the comma separating it from the previous record of the same message.
    if (current.length > 0 && currentBytes + recordBytes + 1 > MAX_RETRY_MESSAGE_BYTES) flush();
    currentBytes += current.length === 0 ? recordBytes : recordBytes + 1;
    current.push(record);
  });
  flush();

  return { messages, oversize };
}

/**
 * Build the side-write retry message for one failed `intent.snapshot` sink, or `null` when it
 * would exceed `MAX_RETRY_MESSAGE_BYTES` (the caller reports that; it is never sent).
 */
export function buildIntentSnapshotRetryMessage(
  snapshot: IntentSnapshotRetryMessage['snapshot'],
  sink: IntentSnapshotSink,
  meta: EventsRetryMessageMeta,
): IntentSnapshotRetryMessage | null {
  const message: IntentSnapshotRetryMessage = {
    schema_version: SIDE_WRITE_RETRY_SCHEMA_VERSION,
    kind: 'intent_snapshot',
    sink,
    batch_id: meta.batch_id,
    tenant_id: meta.tenant_id,
    first_failed_at: meta.first_failed_at,
    attempt: meta.attempt,
    snapshot,
  };
  return retryMessageBytes(message) <= MAX_RETRY_MESSAGE_BYTES ? message : null;
}
