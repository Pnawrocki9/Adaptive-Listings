/**
 * Shared Worker bindings — single source of truth for `env` shape across the ingest app.
 *
 * @module apps/ingest/src/types
 */

import type { DurableObjectNamespace, KVNamespace } from '@cloudflare/workers-types';

import type { ClickHouseProducerEnv } from './clickhouse-producer.js';
import type { EventsRetryQueueEnv } from './events-retry-queue.js';
import type { ChatNlpDispatchEnv } from './handlers/chat-nlp-dispatch.js';
import type { IntentSnapshotEnv } from './handlers/intent-snapshot.js';
import type { ObservabilityEnv } from './observability.js';
import type { RateLimiterEnv } from './rate-limiter.js';

/**
 * Cloudflare Worker `env` for the ingest app. Composed of:
 * - Generic environment metadata (`ENVIRONMENT`)
 * - Observability env (`SENTRY_DSN_INGEST`, `GIT_SHA`)
 * - ClickHouse direct-write config (ESC-017 — replaces the missing event-bus REST-proxy
 *   hop; the event bus itself was retired ADR-0022 stage C / FOLLOW-1263)
 * - Cloudflare Queue producer binding for the post-ACK ClickHouse retry buffer
 *   (FOLLOW-482 / ADR-0017)
 * - Rate-limiter config (`RATE_LIMIT_PER_MIN`)
 * - KV namespace binding for API key lookup (replaces with Postgres in Sprint 2)
 * - KV namespace binding for idempotency key deduplication (TICKET-019, 24h TTL)
 * - Durable Object namespace binding for the per-tenant rate limiter (TICKET-013)
 * - Supabase config for intent-snapshot dual-write (FOLLOW-266)
 * - Modal chat-NLP direct invoke (F-01 / ADR-0016 pattern — MODAL_CHAT_NLP_URL)
 */
export interface Env
  extends
    ObservabilityEnv,
    ClickHouseProducerEnv,
    EventsRetryQueueEnv,
    IntentSnapshotEnv,
    ChatNlpDispatchEnv,
    RateLimiterEnv {
  ENVIRONMENT: string;
  /**
   * Cloudflare-populated deploy identity (`[version_metadata]` binding). [FOLLOW-938]
   *
   * Optional because it is absent in `vitest`/local `miniflare` runs and in any deploy made before
   * the binding existed. Surfaced by `GET /health` so "is this fix live?" is answerable by curl —
   * previously it was answerable by nobody: `/health` returned only status/service/environment,
   * and `GIT_SHA` (declared in `ObservabilityEnv`, used for the Sentry release tag) is set by
   * nothing at all.
   */
  CF_VERSION_METADATA?: { id: string; tag?: string };
  KV_API_KEYS: KVNamespace;
  /** Batch-level idempotency cache. Key: `idem:<Idempotency-Key>`. TTL: 24h. */
  KV_IDEMPOTENCY: KVNamespace;
  RATE_LIMITER: DurableObjectNamespace;
}
