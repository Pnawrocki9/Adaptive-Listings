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
 * @module apps/ingest/src/handlers/events-retry-consumer
 */

import * as Sentry from '@sentry/cloudflare';

import type { Env } from '../types.js';
import { pushToClickHouse } from '../clickhouse-producer.js';
import {
  CURRENT_EVENTS_RETRY_SCHEMA_VERSION,
  EventsRetryMessageEnvelopeSchema,
  EventsRetryMessageSchema,
} from '../events-retry-queue.js';
import { logger } from '../observability/logger.js';

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
