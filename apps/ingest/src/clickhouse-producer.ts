/**
 * ClickHouse Cloud producer — pushes validated event batches directly to the
 * ClickHouse Cloud HTTPS interface (port 8443) using a single
 * `INSERT INTO events FORMAT JSONEachRow` POST. Cloudflare Workers cannot open
 * raw TCP sockets to the Redpanda broker, and Redpanda Cloud Serverless does
 * not expose Pandaproxy (ESC-017); for the Sprint 13a pilot we land events in
 * ClickHouse directly. The Redpanda → stream-consumer chain is the Phase-3
 * destination.
 *
 * Retry policy: 3 attempts with exponential backoff (100ms, 500ms, 2500ms).
 * 5xx and network failures retry; 4xx responses surface immediately
 * (caller bug — schema mismatch, bad auth, etc.).
 *
 * Auth: HTTP Basic. Credentials come from `env.CLICKHOUSE_USER` and
 * `env.CLICKHOUSE_PASSWORD` (set via `wrangler secret put`). No-creds guard
 * mirrors the Redpanda producer: when `CLICKHOUSE_URL` is absent or empty the
 * producer returns `{ ok: true, attempts: 0 }` so the Worker still returns
 * HTTP 200 to the SDK (Phase 1 mode — events validated but not persisted).
 *
 * Reference: https://clickhouse.com/docs/en/interfaces/http
 *
 * @module apps/ingest/src/clickhouse-producer
 */

import { logger } from './observability/logger.js';

/** Bindings the ClickHouse producer needs from `env`. */
export interface ClickHouseProducerEnv {
  /**
   * Base URL including protocol and port — e.g.
   * `https://hl0kc83gt4.eu-west-1.aws.clickhouse.cloud:8443`.
   * Absent or empty triggers the no-cred guard (Phase 1 mode).
   */
  CLICKHOUSE_URL?: string;
  /** Database name. Defaults to `default` (the database the events DDL targets). */
  CLICKHOUSE_DATABASE?: string;
  /** Database user (e.g. `ingest_worker` or `default`). */
  CLICKHOUSE_USER?: string;
  /** Database password. */
  CLICKHOUSE_PASSWORD?: string;
}

export interface CHPushSuccess {
  ok: true;
  attempts: number;
}

export interface CHPushFailure {
  ok: false;
  attempts: number;
  status?: number;
  error: string;
}

export type CHPushResult = CHPushSuccess | CHPushFailure;

export interface CHPushOptions {
  fetchImpl?: typeof fetch;
  backoffMs?: readonly number[];
  /** Per-attempt request timeout in ms. Default 4000. */
  timeoutMs?: number;
}

const DEFAULT_BACKOFF_MS = [100, 500, 2500] as const;
const MAX_ATTEMPTS = 3;

/**
 * Coerce an `unknown` JSON value to a string, returning `fallback` when the
 * value is not a primitive. Avoids the `'[object Object]'` footgun that
 * `String(unknown)` would land in ClickHouse columns if the SDK ever emits a
 * non-string value where a string is expected.
 */
function toStr(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return fallback;
}

/**
 * Map a validated, enriched event from the ingest handler into the column
 * shape ClickHouse's `events` table expects (see
 * `infra/clickhouse/migrations/0001_create_events.sql`).
 *
 * Same shape as the Python `_event_to_row` in
 * `apps/stream-consumer/src/clickhouse_client.py` — kept in sync because both
 * insert into the same table.
 *
 * Internal — exported only for tests.
 */
export function toClickHouseRow(event: Record<string, unknown>): Record<string, unknown> {
  const ts = typeof event.ts === 'number' ? event.ts : 0;
  const ingestReceivedAt =
    typeof event.ingest_received_at === 'number' ? event.ingest_received_at : ts;
  return {
    event_id: toStr(event.event_id),
    tenant_id: toStr(event.tenant_id),
    session_id: toStr(event.session_id),
    // ClickHouse DateTime64(3, 'UTC') accepts ms-epoch numbers as integer literal —
    // the JSON parser will treat numbers as Float64 by default. Send ISO-8601
    // strings so the parser uses the DateTime64 string codec (millisecond
    // precision preserved).
    ts: new Date(ts).toISOString(),
    ingest_received_at: new Date(ingestReceivedAt).toISOString(),
    region: toStr(event.region),
    type: toStr(event.type),
    schema_version: typeof event.schema_version === 'number' ? event.schema_version : 1,
    consent_state: toStr(event.consent_state, 'none'),
    listing_id: toStr(event.listing_id),
    archetype_hint: toStr(event.archetype_hint),
    payload: JSON.stringify(event.payload ?? {}),
  };
}

/**
 * Push an array of validated event records to ClickHouse via the HTTPS
 * interface. One POST = one batch INSERT (atomic).
 *
 * @returns `{ ok: true, attempts }` on success or `{ ok: false, attempts, status?, error }`
 *          on terminal failure (after exhausting retries).
 */
export async function pushToClickHouse(
  records: readonly Record<string, unknown>[],
  env: ClickHouseProducerEnv,
  options: CHPushOptions = {},
): Promise<CHPushResult> {
  if (records.length === 0) return { ok: true, attempts: 0 };

  // No-cred guard: when CLICKHOUSE_URL is absent or empty we are operating in
  // Phase 1 mode. Events were validated and would-be persisted; we skip the
  // publish step and return ok so the Worker returns HTTP 200 to the SDK.
  if (!env.CLICKHOUSE_URL) {
    logger.warn(
      { record_count: records.length },
      'clickhouse_skipped: CLICKHOUSE_URL not configured (Phase 1 mode)',
    );
    return { ok: true, attempts: 0 };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const backoff = options.backoffMs ?? DEFAULT_BACKOFF_MS;
  const timeoutMs = options.timeoutMs ?? 4000;
  const database = env.CLICKHOUSE_DATABASE ?? 'default';

  const url = `${env.CLICKHOUSE_URL.replace(/\/$/, '')}/?database=${encodeURIComponent(
    database,
  )}&query=${encodeURIComponent('INSERT INTO events FORMAT JSONEachRow')}`;

  // NDJSON body — one JSON object per line, no trailing newline.
  const body = records.map((r) => JSON.stringify(toClickHouseRow(r))).join('\n');
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
      // ClickHouse error text is short and informative (e.g. column type
      // mismatch); capture the first 500 chars so the runbook surfaces it.
      let detail = '';
      try {
        detail = (await response.text()).slice(0, 500);
      } catch {
        // body read failed; status alone is enough signal
      }
      lastError = `clickhouse_status_${String(response.status)}${detail ? `:${detail}` : ''}`;

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

function buildHeaders(env: ClickHouseProducerEnv): HeadersInit {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-ndjson',
  };
  if (env.CLICKHOUSE_USER && env.CLICKHOUSE_PASSWORD) {
    const auth = btoa(`${env.CLICKHOUSE_USER}:${env.CLICKHOUSE_PASSWORD}`);
    headers.Authorization = `Basic ${auth}`;
  }
  return headers;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
