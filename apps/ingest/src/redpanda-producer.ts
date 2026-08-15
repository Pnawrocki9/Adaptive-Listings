/**
 * Redpanda producer — pushes validated event batches to Redpanda Cloud via the HTTP REST proxy
 * (Pandaproxy). The native Kafka client (`kafkajs`) requires Node `net`, which Cloudflare Workers
 * don't expose; the REST proxy is the supported workaround for MVP. Native Kafka client is a
 * Sprint 4 follow-up if perf demands it.
 *
 * Retry policy: 3 attempts with exponential backoff (100ms, 500ms, 2500ms). 5xx responses and
 * network failures retry; 4xx responses surface the error immediately (caller-visible bug).
 *
 * Reference: https://docs.redpanda.com/current/develop/http-proxy/
 *
 * @module apps/ingest/src/redpanda-producer
 */

import { context, propagation } from '@opentelemetry/api';
import { logger } from './observability/logger.js';

/** Bindings the producer needs from `env`. */
export interface RedpandaProducerEnv {
  /**
   * HTTP REST proxy base URL (Pandaproxy). When absent or empty the producer
   * returns `{ ok: true, attempts: 0 }` immediately — Phase 1 Supabase-only
   * mode per DECISIONS_2026-05-18_v2.
   *
   * TODO(RUNTIME-FIX-004): Remove this guard when Redpanda is activated in Phase 3.
   */
  REDPANDA_REST_URL?: string;
  REDPANDA_TOPIC_EVENTS: string;
  /** Optional HTTP basic-auth for the REST proxy. Omit for unauthenticated dev clusters. */
  REDPANDA_REST_USERNAME?: string;
  REDPANDA_REST_PASSWORD?: string;
}

// Local, not exported: nothing outside this module names it. These were EXPORTED and
// invisible to Rule I only because `apps/decision-api/src/lib/redpanda-producer.ts`
// exported the identical names and had a consumer — Rule I matches by symbol NAME, so a
// live twin in another app MASKED the deadness here. Deleting that twin (ADR-0022 stage A)
// unmasked it. The types were always dead; the report is new, not the fact. [FOLLOW-988]
interface PushSuccess {
  ok: true;
  attempts: number;
}

interface PushFailure {
  ok: false;
  attempts: number;
  status?: number;
  error: string;
}

type PushResult = PushSuccess | PushFailure;

/**
 * Optional `fetch` injection for testing. Defaults to the global `fetch`.
 */
interface PushOptions {
  fetchImpl?: typeof fetch;
  /** Override per-attempt backoff (ms) — used by tests to skip real waits. */
  backoffMs?: readonly number[];
  /** Per-attempt request timeout in ms. Default 4000. */
  timeoutMs?: number;
}

const DEFAULT_BACKOFF_MS = [100, 500, 2500] as const;
const MAX_ATTEMPTS = 3;

/**
 * Push an array of validated event records to Redpanda. Each event is sent as one record in a
 * single batch POST to `${REDPANDA_REST_URL}/topics/${REDPANDA_TOPIC_EVENTS}` with content-type
 * `application/vnd.kafka.json.v2+json`.
 *
 * @returns `{ ok: true, attempts }` on success or `{ ok: false, attempts, status?, error }` on
 *          terminal failure (after exhausting retries).
 */
export async function pushToRedpanda(
  records: readonly unknown[],
  env: RedpandaProducerEnv,
  options: PushOptions = {},
): Promise<PushResult> {
  if (records.length === 0) return { ok: true, attempts: 0 };

  // No-bus guard: when REDPANDA_REST_URL is absent or empty we are operating in
  // Phase 1 (Supabase-only mode per DECISIONS_2026-05-18_v2). Events are already
  // persisted by the caller; we skip the publish step and return ok so the
  // Worker returns HTTP 200 to the SDK instead of 503.
  // TODO(RUNTIME-FIX-004): Remove this guard when Redpanda is activated in Phase 3.
  if (!env.REDPANDA_REST_URL) {
    logger.warn(
      { record_count: records.length },
      'redpanda_skipped: REDPANDA_REST_URL not configured (Phase 1 Supabase-only mode)',
    );
    return { ok: true, attempts: 0 };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const timeoutMs = options.timeoutMs ?? 4000;

  // env.REDPANDA_REST_URL is guaranteed non-empty here — the no-bus guard above
  // has already returned if it was absent or empty.
  const restUrl = env.REDPANDA_REST_URL;
  const url = `${restUrl.replace(/\/$/, '')}/topics/${env.REDPANDA_TOPIC_EVENTS}`;

  // Inject W3C trace context into a carrier and encode as Pandaproxy record headers.
  // btoa() is required — Pandaproxy JSON format expects base64-encoded header values.
  // try/catch guards against environments where OTel is not fully configured (including partial
  // test mocks of @opentelemetry/api that do not expose propagation).
  const carrier: Record<string, string> = {};
  try {
    propagation.inject(context.active(), carrier);
  } catch {
    // no-op: OTel propagation not available in this environment
  }
  const traceHeaders = Object.entries(carrier).map(([key, value]) => ({
    key,
    value: btoa(value),
  }));

  const body = JSON.stringify({
    records: records.map((value) => ({
      value,
      ...(traceHeaders.length > 0 ? { headers: traceHeaders } : {}),
    })),
  });
  const headers = buildHeaders(env);

  let lastStatus: number | undefined;
  let lastError = 'unknown';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.ok) {
        return { ok: true, attempts: attempt };
      }

      lastStatus = response.status;
      lastError = `redpanda_rest_status_${String(response.status)}`;

      // 4xx: terminal — caller bug, no retry
      if (response.status >= 400 && response.status < 500) {
        return { ok: false, attempts: attempt, status: response.status, error: lastError };
      }
      // else 5xx: fall through to retry
    } catch (cause) {
      clearTimeout(timer);
      lastError = cause instanceof Error ? cause.message : 'fetch_failed';
    }

    if (attempt < MAX_ATTEMPTS) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- backoff length matches attempts; bounded loop
      const delay = backoff[attempt - 1] ?? backoff[backoff.length - 1]!;
      await sleep(delay);
    }
  }

  return {
    ok: false,
    attempts: MAX_ATTEMPTS,
    ...(lastStatus !== undefined ? { status: lastStatus } : {}),
    error: lastError,
  };
}

function buildHeaders(env: RedpandaProducerEnv): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/vnd.kafka.json.v2+json',
    Accept: 'application/vnd.kafka.v2+json',
  };
  if (env.REDPANDA_REST_USERNAME && env.REDPANDA_REST_PASSWORD) {
    const auth = btoa(`${env.REDPANDA_REST_USERNAME}:${env.REDPANDA_REST_PASSWORD}`);
    headers.Authorization = `Basic ${auth}`;
  }
  return headers;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
