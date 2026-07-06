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
 * @module apps/ingest/src/handlers/events-retry-consumer
 */

import * as Sentry from '@sentry/cloudflare';

import type { Env } from '../types.js';
import { pushToClickHouse } from '../clickhouse-producer.js';
import { EventsRetryMessageSchema } from '../events-retry-queue.js';
import { logger } from '../observability/logger.js';

/**
 * `queue()` handler exported from `index.ts`'s Worker default export
 * (`export default { fetch, queue }`).
 */
export async function handleEventsRetryQueue(batch: MessageBatch, env: Env): Promise<void> {
  for (const message of batch.messages) {
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

    logger.error(
      {
        tenant_id,
        batch_id,
        queue_attempt: attempt,
        message_attempts: message.attempts,
        ch_attempts: result.attempts,
        upstream_status: result.status,
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
      },
    });
    message.retry();
  }
}
