/**
 * Shared Worker bindings — single source of truth for `env` shape across the ingest app.
 *
 * @module apps/ingest/src/types
 */

import type { DurableObjectNamespace, KVNamespace } from '@cloudflare/workers-types';

import type { ClickHouseProducerEnv } from './clickhouse-producer.js';
import type { EventsRetryQueueEnv } from './events-retry-queue.js';
import type { IntentSnapshotEnv } from './handlers/intent-snapshot.js';
import type { ObservabilityEnv } from './observability.js';
import type { RateLimiterEnv } from './rate-limiter.js';
import type { RedpandaProducerEnv } from './redpanda-producer.js';

/**
 * Cloudflare Worker `env` for the ingest app. Composed of:
 * - Generic environment metadata (`ENVIRONMENT`)
 * - Observability env (`SENTRY_DSN_INGEST`, `GIT_SHA`)
 * - Redpanda REST proxy config (Phase-3 destination — currently no-op guard)
 * - ClickHouse direct-write config (ESC-017 pilot path — replaces the missing
 *   Pandaproxy hop on Redpanda Cloud Serverless)
 * - Cloudflare Queue producer binding for the post-ACK ClickHouse retry buffer
 *   (FOLLOW-482 / ADR-0017)
 * - Rate-limiter config (`RATE_LIMIT_PER_MIN`)
 * - KV namespace binding for API key lookup (replaces with Postgres in Sprint 2)
 * - KV namespace binding for idempotency key deduplication (TICKET-019, 24h TTL)
 * - Durable Object namespace binding for the per-tenant rate limiter (TICKET-013)
 * - Supabase config for intent-snapshot dual-write (FOLLOW-266)
 */
export interface Env
  extends
    ObservabilityEnv,
    RedpandaProducerEnv,
    ClickHouseProducerEnv,
    EventsRetryQueueEnv,
    IntentSnapshotEnv,
    RateLimiterEnv {
  ENVIRONMENT: string;
  KV_API_KEYS: KVNamespace;
  /** Batch-level idempotency cache. Key: `idem:<Idempotency-Key>`. TTL: 24h. */
  KV_IDEMPOTENCY: KVNamespace;
  RATE_LIMITER: DurableObjectNamespace;
}
