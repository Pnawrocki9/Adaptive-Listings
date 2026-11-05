/**
 * Cloudflare Queue consumer for `estalara-events-retry` — FOLLOW-482 / ADR-0017.
 *
 * Re-inserts each message's records into ClickHouse via the SAME `pushToClickHouse` path used by
 * the primary post-ACK insert (`handlers/events.ts`) — no drift between "normal" and "retried"
 * insert logic (ADR-0017 Decision §3).
 *
 * Per-message ack/retry (not a batch-level throw): a message that lands cleanly is acked; a
 * message whose re-insert still fails calls `message.retry()` so Cloudflare's native
 * per-message backoff and retry budget (`max_retries` in `wrangler.toml`) — and, after that
 * budget is exhausted, the native `estalara-events-retry-dlq` dead-letter queue — take over. No
 * bespoke backoff/DLQ code is needed here.
 *
 * A message whose body fails schema validation (a hypothetical malformed-producer bug, not a
 * ClickHouse-availability issue) is logged + Sentry-captured and acked immediately — retrying a
 * shape that can never parse would only burn the Queue's retry budget before landing in the DLQ
 * anyway, so there is no point Waiting for that.
 *
 * A message that parses the loose `schema_version` envelope but carries a version this build
 * doesn't know how to handle (`schema_version !== CURRENT_EVENTS_RETRY_SCHEMA_VERSION`) is treated
 * as retry-worthy, NOT malformed (FOLLOW-513 / LG-1): Cloudflare holds in-flight Queue messages
 * across deploys, so a future `schema_version` bump would otherwise ack-drop (permanently lose)
 * every message already in flight the moment the producer starts emitting the new version. Letting
 * it retry means it either gets picked up by a consumer deploy that adds support for that version,
 * or — worst case — lands in the native DLQ once retries are exhausted, where it is still
 * recoverable, instead of being silently discarded here.
 *
 * FOLLOW-1310: `schema_version: 2` messages are derived-store side-writes (`kind:
 * 'intent_snapshot'`, one `sink` each), replayed by `replaySideWrite` into that sink only. A
 * version-1 message whose every row is unencodable (a ts ClickHouse cannot hold) is acked and
 * reported, since no retry can succeed.
 *
 * @module apps/ingest/src/handlers/events-retry-consumer
 */

import * as Sentry from '@sentry/cloudflare';

import type { Env } from '../types.js';
import { CH_ROWS_UNENCODABLE_ERROR, pushToClickHouse } from '../clickhouse-producer.js';
import {
  CURRENT_EVENTS_RETRY_SCHEMA_VERSION,
  EventsRetryMessageEnvelopeSchema,
  EventsRetryMessageSchema,
  IntentSnapshotRetryMessageSchema,
  SIDE_WRITE_RETRY_SCHEMA_VERSION,
} from '../events-retry-queue.js';
import { logger } from '../observability/logger.js';
import { insertIntentEventToClickHouse, upsertIntentSessionToSupabase } from './intent-snapshot.js';

/**
 * Replay one `schema_version: 2` derived-store side-write into the ONE sink it names.
 * [FOLLOW-1310, Codex F-15]
 *
 * Same ack/retry contract as the events branch: a malformed body is acked (it can never parse),
 * a still-failing sink is `retry()`d so Cloudflare's `max_retries` and the native DLQ take over.
 * The Supabase write is monotonic, so replaying an old snapshot never moves the head backwards.
 */
async function replaySideWrite(message: Message, env: Env): Promise<void> {
  const parsed = IntentSnapshotRetryMessageSchema.safeParse(message.body);
  if (!parsed.success) {
    logger.error(
      { message_id: message.id, message_attempts: message.attempts },
      'events_retry_message_malformed',
    );
    Sentry.captureException(new Error('events_retry_message_malformed'), {
      tags: { area: 'events', sink: 'side_write', kind: 'malformed_retry_message' },
      extra: { message_id: message.id, message_attempts: message.attempts },
    });
    message.ack();
    return;
  }
  const { sink, snapshot, tenant_id, batch_id } = parsed.data;
  const event = {
    session_id: snapshot.session_id,
    tenant_id: snapshot.tenant_id,
    ts: snapshot.ts,
    payload: snapshot.payload,
    ...(snapshot.cross_session_id !== undefined
      ? { cross_session_id: snapshot.cross_session_id }
      : {}),
  };
  const result =
    sink === 'clickhouse'
      ? await insertIntentEventToClickHouse(event, event.session_id, env)
      : await upsertIntentSessionToSupabase(event, env);
  if (result.ok) {
    message.ack();
    return;
  }
  logger.error(
    {
      tenant_id,
      batch_id,
      sink,
      message_id: message.id,
      message_attempts: message.attempts,
      // Status class only: the writers append a slice of the store's response body after the
      // first `:`, and a store may quote the input it rejected (FOLLOW-845).
      error: (result.error ?? 'unknown').split(':')[0],
    },
    'intent_snapshot_retry_failed',
  );
  Sentry.captureException(new Error('intent_snapshot_retry_failed'), {
    tags: { area: 'intent-snapshot', sink, kind: 'retry_failed' },
    extra: { tenant_id, batch_id, message_id: message.id, message_attempts: message.attempts },
  });
  message.retry();
}

/**
 * `queue()` handler exported from `index.ts`'s Worker default export
 * (`export default { fetch, queue }`).
 */
export async function handleEventsRetryQueue(batch: MessageBatch, env: Env): Promise<void> {
  for (const message of batch.messages) {
    const envelope = EventsRetryMessageEnvelopeSchema.safeParse(message.body);

    if (!envelope.success) {
      logger.error(
        { message_id: message.id, message_attempts: message.attempts },
        'events_retry_message_malformed',
      );
      Sentry.captureException(new Error('events_retry_message_malformed'), {
        tags: { area: 'events', sink: 'clickhouse', kind: 'malformed_retry_message' },
        extra: { message_id: message.id, message_attempts: message.attempts },
      });
      message.ack();
      continue;
    }

    // FOLLOW-1308 HOOK (retry vs erasure) — NOT implemented here, by design. A message can sit
    // in this queue (and its DLQ) after a DSR erasure of the session it carries; replaying it
    // would re-insert erased rows (`events`, `intent_events`) or re-create the erased
    // `intent_sessions` head. FOLLOW-1308 owns the DSR chain and must, at THIS point, drop (ack)
    // every message whose `tenant_id` + session ids are in the erasure ledger, and erase the
    // DLQ the same way. Until it lands, an erasure issued while a retry is in flight is not
    // durable against that retry. [FOLLOW-1310]

    if (envelope.data.schema_version === SIDE_WRITE_RETRY_SCHEMA_VERSION) {
      await replaySideWrite(message, env);
      continue;
    }

    if (envelope.data.schema_version !== CURRENT_EVENTS_RETRY_SCHEMA_VERSION) {
      // Well-formed envelope, but a schema_version this build doesn't know how to process yet.
      // Retry (not ack) so an in-flight message from a future producer version survives until a
      // consumer that understands it deploys, or it lands in the native DLQ — never silently lost.
      logger.error(
        {
          message_id: message.id,
          message_attempts: message.attempts,
          received_schema_version: envelope.data.schema_version,
          expected_schema_version: CURRENT_EVENTS_RETRY_SCHEMA_VERSION,
        },
        'events_retry_unknown_schema_version',
      );
      Sentry.captureException(new Error('events_retry_unknown_schema_version'), {
        tags: { area: 'events', sink: 'clickhouse', kind: 'unknown_schema_version' },
        extra: {
          message_id: message.id,
          message_attempts: message.attempts,
          received_schema_version: envelope.data.schema_version,
          expected_schema_version: CURRENT_EVENTS_RETRY_SCHEMA_VERSION,
        },
      });
      message.retry();
      continue;
    }

    const parsed = EventsRetryMessageSchema.safeParse(message.body);

    if (!parsed.success) {
      logger.error(
        { message_id: message.id, message_attempts: message.attempts },
        'events_retry_message_malformed',
      );
      Sentry.captureException(new Error('events_retry_message_malformed'), {
        tags: { area: 'events', sink: 'clickhouse', kind: 'malformed_retry_message' },
        extra: { message_id: message.id, message_attempts: message.attempts },
      });
      message.ack();
      continue;
    }

    const { records, tenant_id, batch_id, attempt } = parsed.data;
    const result = await pushToClickHouse(records, env);

    if (result.ok) {
      message.ack();
      continue;
    }

    // Every row of the message is unencodable (a pre-FOLLOW-1310 message carrying a ts outside
    // DateTime64): nothing was sent and no retry can ever succeed, so re-driving it would only
    // walk it into the DLQ. Drop it, loudly. [FOLLOW-1310, Codex F-06]
    if (result.error.startsWith(CH_ROWS_UNENCODABLE_ERROR)) {
      logger.error(
        { tenant_id, batch_id, message_id: message.id, error: result.error },
        'events_retry_rows_unencodable_dropped',
      );
      Sentry.captureException(new Error(`events_retry_rows_unencodable: ${result.error}`), {
        tags: { area: 'events', sink: 'clickhouse', kind: 'rows_unencodable' },
        extra: { tenant_id, batch_id, message_id: message.id },
      });
      message.ack();
      continue;
    }

    // FOLLOW-845: same records, same sinks, same rule as the primary insert in
    // `handlers/events.ts` — `result.error` carries no ClickHouse response body, and
    // `ch_query_id` is the operator's pivot into `system.query_log` for the detail.
    logger.error(
      {
        tenant_id,
        batch_id,
        queue_attempt: attempt,
        message_attempts: message.attempts,
        ch_attempts: result.attempts,
        upstream_status: result.status,
        ch_error_code: result.chErrorCode,
        ch_query_id: result.queryId,
        error: result.error,
      },
      'events_retry_reinsert_failed',
    );
    Sentry.captureException(new Error(`events_retry_reinsert_failed: ${result.error}`), {
      tags: { area: 'events', sink: 'clickhouse', kind: 'retry_reinsert_failed' },
      extra: {
        tenant_id,
        batch_id,
        queue_attempt: attempt,
        message_attempts: message.attempts,
        upstream_status: result.status,
        ch_error_code: result.chErrorCode,
        ch_query_id: result.queryId,
      },
    });
    message.retry();
  }
}
