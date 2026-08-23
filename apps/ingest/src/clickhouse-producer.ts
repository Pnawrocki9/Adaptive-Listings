/**
 * ClickHouse Cloud producer — pushes validated event batches directly to the
 * ClickHouse Cloud HTTPS interface (port 8443) using a single
 * `INSERT INTO events FORMAT JSONEachRow` POST. Cloudflare Workers cannot open
 * raw TCP sockets to a Kafka broker, and Redpanda Cloud Serverless never
 * exposed Pandaproxy (ESC-017); this direct write is the permanent path, not
 * a stopgap — the Redpanda/stream-consumer chain it would have fed was
 * retired outright (ADR-0022 stage C, FOLLOW-988).
 *
 * Retry policy: 3 attempts with exponential backoff (100ms, 500ms, 2500ms).
 * 5xx and network failures retry; 4xx responses surface immediately
 * (caller bug — schema mismatch, bad auth, etc.).
 *
 * Auth: HTTP Basic. Credentials come from `env.CLICKHOUSE_USER` and
 * `env.CLICKHOUSE_PASSWORD` (set via `wrangler secret put`). When
 * `CLICKHOUSE_URL` is absent or empty the no-creds guard fires and the
 * producer returns `{ ok: true, attempts: 0 }` so the Worker still returns
 * HTTP 200 to the SDK (Phase 1 mode — events validated but not persisted).
 *
 * FOLLOW-845 — the response BODY is never read. The rows this module POSTs
 * carry `payload: JSON.stringify(event.payload)`, and for `chat.message.sent`
 * that payload is up to 4000 characters of buyer-authored chat text. ClickHouse
 * quotes the offending input verbatim in its parse errors, so the failure
 * detail returned to the caller (which lands in Sentry, twice) is built from
 * the RESPONSE HEADERS only — see `describeChFailure` and the `!response.ok`
 * arm below.
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
  /**
   * Rows ClickHouse says it actually wrote, from the `X-ClickHouse-Summary` response header.
   *
   * `undefined` when the header is absent — some versions and proxies omit it — which is NOT
   * treated as a failure, because absence of evidence is not evidence of zero. [FOLLOW-986]
   */
  writtenRows?: number;
}

export interface CHPushFailure {
  ok: false;
  attempts: number;
  status?: number;
  /**
   * Operator-facing failure descriptor. Derived ONLY from the HTTP status, the
   * `X-ClickHouse-Exception-Code` response header and a local code→class map —
   * never from the response body (FOLLOW-845). Shape:
   * `clickhouse_status_<http>[:ch_code_<n>:<class>]`, or the transport error
   * message on a network-layer failure.
   */
  error: string;
  /**
   * ClickHouse's own error code, read from the `X-ClickHouse-Exception-Code`
   * response header (e.g. `27` = CANNOT_PARSE_INPUT_ASSERTION_FAILED). Absent
   * when the failure was network-level, or when the response came from
   * something in front of ClickHouse (a Cloud load balancer 502) that does not
   * set the header.
   */
  chErrorCode?: number;
  /**
   * Server-generated `X-ClickHouse-Query-Id`. The operator pivot that replaces
   * the response body: `SELECT exception FROM system.query_log WHERE query_id =
   * '<this>'` returns ClickHouse's FULL error — including the quoted input —
   * inside the store that already holds those rows by design, instead of
   * exporting it to Sentry. Absent when ClickHouse rejected the request before
   * assigning a query id (e.g. authentication failure).
   */
  queryId?: string;
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
 * Encode an epoch-ms instant as the ClickHouse DateTime64(3) text literal
 * `YYYY-MM-DD hh:mm:ss.mmm` (UTC, no zone suffix).
 *
 * WHY THIS SHAPE AND NOT ISO-8601 — read before changing it. [FOLLOW-853]
 *
 * The JSONEachRow parser's acceptance of a DateTime64 string is governed by the
 * server-side `date_time_input_format` setting, NOT by the string's precision:
 *
 *   - `basic` (the ClickHouse OSS default, and the default in the
 *     `clickhouse/clickhouse-server:25.8` container CI and localhost run)
 *     accepts ONLY this shape. It stops at the `Z` of an ISO-8601 string and
 *     rejects the whole batch with Code 27 CANNOT_PARSE_INPUT_ASSERTION_FAILED.
 *   - `best_effort` (what the prod ClickHouse Cloud service reads — see
 *     `docs/runbooks/CLICKHOUSE_DATETIME_INPUT_FORMAT.md`) accepts BOTH this
 *     shape and the trailing-`Z` ISO-8601 one.
 *
 * So this shape is the intersection: it parses under every value of the setting,
 * which makes the writer independent of a vendor default that is pinned nowhere.
 * Until FOLLOW-853 these two writers emitted `.toISOString()` — accepted in prod
 * only because Cloud happens to default to `best_effort`, and silently rejected
 * on every container-local run, which is why `events` never populated on
 * localhost.
 *
 * The rejected alternative was appending `&date_time_input_format=best_effort`
 * to the insert URL. It leaves the emitted bytes unchanged, but it trades a
 * dependency on the server DEFAULT for a dependency on the user profile's
 * PERMISSION to override that setting per-request (a readonly constraint on the
 * profile answers Code 452 SETTING_CONSTRAINT_VIOLATION), and it would leave the
 * repo with two byte shapes for one logical column. This encoding needs no
 * permission and converges the ingest writers on the shape the control-plane
 * ClickHouse writers already send (`api/adapt/route.ts`, `api/dsr/_clickhouse.ts`,
 * `api/internal/description-cache/route.ts`).
 *
 * Millisecond precision is preserved — that part of the pre-FOLLOW-853 rationale
 * was correct, it just named the wrong constraint. `.toISOString()` always emits
 * exactly 3 fractional digits, which is the scale of `DateTime64(3, 'UTC')`.
 *
 * Both parser modes are asserted against a live engine in
 * `src/__tests__/integration/clickhouse-producer.integration.test.ts`.
 */
export function toClickHouseDateTime64(epochMs: number): string {
  return new Date(epochMs).toISOString().replace('T', ' ').replace('Z', '');
}

/**
 * Map a validated, enriched event from the ingest handler into the column
 * shape ClickHouse's `events` table expects (see
 * `infra/clickhouse/migrations/0001_create_events.sql`).
 *
 * Same COLUMN SET and order as the Python `_event_to_row` in
 * `apps/stream-consumer/src/clickhouse_client.py`, because both insert into the
 * same table. The TIMESTAMP ENCODING is deliberately NOT shared and the two must
 * not be reconciled: that consumer passes native `datetime` objects over
 * clickhouse-connect's binary protocol, which never reaches the JSONEachRow text
 * parser and so is unaffected by `date_time_input_format`. This module's
 * `toClickHouseDateTime64` is a text-protocol concern only. (The two are not a
 * registered Rule J mirror pair — see `scripts/mirror-files.json`.)
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
    // A ms-epoch NUMBER is not an option here: the JSON parser reads numbers as
    // Float64, losing millisecond fidelity. Send the DateTime64(3) text literal —
    // see `toClickHouseDateTime64` for why it is space-separated and zone-less
    // rather than ISO-8601 (FOLLOW-853).
    ts: toClickHouseDateTime64(ts),
    ingest_received_at: toClickHouseDateTime64(ingestReceivedAt),
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
  let lastChErrorCode: number | undefined;
  let lastQueryId: string | undefined;

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
        // A 2xx is NOT the success criterion for an INSERT. ClickHouse answers 200 to a request
        // it parsed and accepted even when that request produced ZERO rows — which is exactly
        // what the nightly E2E hit: `attempts: 1`, `record_count: 50`, HTTP ok, and
        // `SELECT count()` returning 0. Reading `written_rows` is what turns "the server did not
        // complain" into "the rows exist". [FOLLOW-986]
        //
        // Read from the HEADER, never the body — FOLLOW-845 established that ClickHouse quotes
        // the offending input verbatim in its body, so the body carries visitor data and must not
        // reach a log or Sentry. `X-ClickHouse-Summary` is a small JSON summary and carries none.
        const writtenRows = readWrittenRows(response.headers);
        if (writtenRows === 0 && records.length > 0) {
          return {
            ok: false,
            attempts: attempt,
            status: response.status,
            error: `clickhouse_wrote_zero_rows:sent_${String(records.length)}`,
          };
        }
        return {
          ok: true,
          attempts: attempt,
          ...(writtenRows === undefined ? {} : { writtenRows }),
        };
      }

      lastStatus = response.status;
      // FOLLOW-845: the response BODY is NOT read. It used to be sliced to 500
      // chars into `lastError`, which `handlers/events.ts` and
      // `handlers/events-retry-consumer.ts` put into BOTH a `logger.error`
      // (which emits via `console.log`, a Sentry breadcrumb source because
      // `consoleIntegration()` is a default of `@sentry/cloudflare@10.50.0`) and
      // a `Sentry.captureException` value. ClickHouse quotes the offending input
      // verbatim on a parse failure — driven against `clickhouse-server:25.8`,
      // transcripts in the FOLLOW-845 PR body — and the rows in that input carry
      // the buyer's chat message. The signal is replaced, not deleted: the
      // exception code and query id below come from RESPONSE HEADERS, which
      // ClickHouse generates and which contain no request bytes.
      lastChErrorCode = readExceptionCode(response.headers);
      lastQueryId = readQueryId(response.headers);
      lastError = describeChFailure(response.status, lastChErrorCode);

      // 4xx: terminal — caller bug, no retry
      if (response.status >= 400 && response.status < 500) {
        return {
          ok: false,
          attempts: attempt,
          status: response.status,
          error: lastError,
          ...(lastChErrorCode !== undefined ? { chErrorCode: lastChErrorCode } : {}),
          ...(lastQueryId !== undefined ? { queryId: lastQueryId } : {}),
        };
      }
      // else 5xx: fall through to retry
    } catch (cause) {
      clearTimeout(timer);
      // FOLLOW-845, and the same assessed boundary as the `.catch()` arm in
      // `handlers/chat-nlp-dispatch.ts`: a transport-layer rejection message is
      // generated by the Workers runtime (`Network connection lost.`, an
      // AbortError from the timeout above, `TypeError: Invalid URL`) and no leg
      // of it derives from the request body or the credentials (auth rides an
      // `Authorization` header, not the URL). Kept for triage on the failure
      // mode most likely to actually fire; pinned by a test asserting it DOES
      // reach the wire.
      lastError = cause instanceof Error ? cause.message : 'fetch_failed';
      // This attempt produced no ClickHouse response, so a previous attempt's
      // header-derived values must not be reported as if they described it.
      lastChErrorCode = undefined;
      lastQueryId = undefined;
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
    ...(lastChErrorCode !== undefined ? { chErrorCode: lastChErrorCode } : {}),
    ...(lastQueryId !== undefined ? { queryId: lastQueryId } : {}),
  };
}

/**
 * ClickHouse error code → coarse operator class.
 *
 * Every code below was resolved against the server this repo pins in CI
 * (`clickhouse/clickhouse-server:25.8`) with `SELECT errorCodeToName(<n>)`
 * rather than read off a doc page, so the names in the comments are the ones
 * that server actually reports. Unlisted codes fall through to
 * `unclassified` and still carry the numeric code, which is the part an
 * operator can look up — the map is a convenience, not the signal.
 *
 * Module-private: its only consumer is `describeChFailure` below (Rule I).
 */
const CH_ERROR_CLASS: ReadonlyMap<number, string> = new Map([
  // The ESC-031 / F-02 schema-drift class: ClickHouse parsed the request but
  // rejected the ROW SHAPE. This is the failure mode the 500-char body slice
  // existed to diagnose, and the one that quotes buyer text.
  [6, 'row_rejected'], // CANNOT_PARSE_TEXT
  [26, 'row_rejected'], // CANNOT_PARSE_QUOTED_STRING
  [27, 'row_rejected'], // CANNOT_PARSE_INPUT_ASSERTION_FAILED
  [33, 'row_rejected'], // CANNOT_READ_ALL_DATA
  [53, 'row_rejected'], // TYPE_MISMATCH
  [117, 'row_rejected'], // INCORRECT_DATA
  // The target of the INSERT does not exist — a migration that never ran, or a
  // Worker pointed at the wrong database.
  [60, 'schema_missing'], // UNKNOWN_TABLE
  [81, 'schema_missing'], // UNKNOWN_DATABASE
  [62, 'query_invalid'], // SYNTAX_ERROR
  // Credentials: `wrangler secret` drift, not an outage.
  [192, 'auth'], // UNKNOWN_USER
  [193, 'auth'], // WRONG_PASSWORD
  [194, 'auth'], // REQUIRED_PASSWORD
  [516, 'auth'], // AUTHENTICATION_FAILED
  // Back-pressure / resource ceilings — retry-worthy, page on sustained.
  [159, 'capacity'], // TIMEOUT_EXCEEDED
  [202, 'capacity'], // TOO_MANY_SIMULTANEOUS_QUERIES
  [241, 'capacity'], // MEMORY_LIMIT_EXCEEDED
  [252, 'capacity'], // TOO_MANY_PARTS
  [290, 'capacity'], // LIMIT_EXCEEDED
]);

/**
 * Build the operator-facing failure descriptor from the HTTP status and the
 * ClickHouse exception code — the FOLLOW-845 replacement for the response-body
 * slice.
 *
 * The output vocabulary is bounded on purpose: this string ends up as the
 * Sentry exception VALUE at both call sites, and a body-derived string gave
 * every distinct failing row its own issue fingerprint. Grouping now happens
 * per failure class.
 */
function describeChFailure(status: number, chErrorCode: number | undefined): string {
  const base = `clickhouse_status_${String(status)}`;
  if (chErrorCode === undefined) return base;
  const cls = CH_ERROR_CLASS.get(chErrorCode) ?? 'unclassified';
  return `${base}:ch_code_${String(chErrorCode)}:${cls}`;
}

/**
 * Rows written, parsed out of the `X-ClickHouse-Summary` JSON header.
 *
 * Returns `undefined` when the header is missing or unparseable, so a caller can distinguish
 * "ClickHouse said zero" from "ClickHouse did not say" — two different facts that a `0` default
 * would silently merge. [FOLLOW-986]
 */
function readWrittenRows(headers: Headers): number | undefined {
  const raw = headers.get('X-ClickHouse-Summary');
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const value = (parsed as Record<string, unknown>).written_rows;
    if (typeof value !== 'string' && typeof value !== 'number') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Read ClickHouse's error code from `X-ClickHouse-Exception-Code`.
 *
 * Validated as 1–5 digits before use: the value is coerced to a number and
 * cannot carry text, which is the property that makes it safe to log where the
 * body is not.
 */
function readExceptionCode(headers: Headers): number | undefined {
  const raw = headers.get('X-ClickHouse-Exception-Code');
  if (raw === null || !/^\d{1,5}$/.test(raw)) return undefined;
  return Number(raw);
}

/**
 * Read the server-assigned `X-ClickHouse-Query-Id`.
 *
 * Shape-validated as a UUID, not merely passed through: the HTTP interface
 * ECHOES a client-supplied `query_id` when one is sent. This module never sends
 * one — so the value is always server-generated today — but validating means a
 * future caller cannot turn this field into a free-text channel by adding one.
 */
function readQueryId(headers: Headers): string | undefined {
  const raw = headers.get('X-ClickHouse-Query-Id');
  if (raw === null || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(raw)) return undefined;
  return raw;
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
