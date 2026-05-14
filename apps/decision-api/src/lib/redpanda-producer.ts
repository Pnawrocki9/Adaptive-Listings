/**
 * Redpanda producer for decision-api — pushes event records to Redpanda Cloud via the HTTP REST
 * proxy (Pandaproxy). Mirrors the pattern in apps/ingest/src/redpanda-producer.ts so downstream
 * consumers receive a consistent wire format.
 *
 * Native Kafka client (kafkajs) requires Node.js `net` which Cloudflare Workers do not expose.
 * The REST proxy is the supported edge-compatible workaround for MVP.
 *
 * Retry policy: 3 attempts with exponential back-off (100 ms, 500 ms, 2500 ms).
 *   - 5xx responses and network failures are retried.
 *   - 4xx responses surface the error immediately (no retry — caller bug).
 *
 * Reference: https://docs.redpanda.com/current/develop/http-proxy/
 *
 * @module apps/decision-api/src/lib/redpanda-producer
 */

/** Environment bindings required by the producer. */
export interface RedpandaProducerEnv {
  REDPANDA_REST_URL: string;
  REDPANDA_TOPIC_EVENTS: string;
  /** Optional HTTP Basic-Auth for the REST proxy. Omit for unauthenticated dev clusters. */
  REDPANDA_REST_USERNAME?: string;
  REDPANDA_REST_PASSWORD?: string;
}

export interface PushSuccess {
  ok: true;
  attempts: number;
}

export interface PushFailure {
  ok: false;
  attempts: number;
  status?: number;
  error: string;
}

export type PushResult = PushSuccess | PushFailure;

/**
 * Optional injection points for testing.
 */
export interface PushOptions {
  /** Override the global `fetch`. Useful for mocking in tests. */
  fetchImpl?: typeof fetch;
  /** Override per-attempt back-off delays (ms). Used by tests to skip real waits. */
  backoffMs?: readonly number[];
  /** Per-attempt request timeout in ms. Default 4000. */
  timeoutMs?: number;
}

const DEFAULT_BACKOFF_MS = [100, 500, 2500] as const;
const MAX_ATTEMPTS = 3;

/**
 * Push an array of validated event records to Redpanda via the REST proxy.
 *
 * All records are sent as one batch POST to
 * `${REDPANDA_REST_URL}/topics/${REDPANDA_TOPIC_EVENTS}` with content-type
 * `application/vnd.kafka.json.v2+json`.
 *
 * @returns `{ ok: true, attempts }` on success or `{ ok: false, attempts, status?, error }` on
 *          terminal failure.
 */
export async function pushToRedpanda(
  records: readonly unknown[],
  env: RedpandaProducerEnv,
  options: PushOptions = {},
): Promise<PushResult> {
  if (records.length === 0) return { ok: true, attempts: 0 };

  const fetchImpl = options.fetchImpl ?? fetch;
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const timeoutMs = options.timeoutMs ?? 4000;

  const url = `${env.REDPANDA_REST_URL.replace(/\/$/, '')}/topics/${env.REDPANDA_TOPIC_EVENTS}`;

  const body = JSON.stringify({
    records: records.map((value) => ({ value })),
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

      // 4xx: terminal — caller bug, no retry.
      if (response.status >= 400 && response.status < 500) {
        return { ok: false, attempts: attempt, status: response.status, error: lastError };
      }
      // 5xx: fall through to retry.
    } catch (cause) {
      clearTimeout(timer);
      lastError = cause instanceof Error ? cause.message : 'fetch_failed';
    }

    if (attempt < MAX_ATTEMPTS) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- backoff array length bounded by loop
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
