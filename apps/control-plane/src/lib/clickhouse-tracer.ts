/**
 * ClickHouse helper for K.3.6 Archetype Identification Tracer admin routes.
 *
 * All queries use ClickHouse parameterized syntax ({param:Type}) with values
 * bound as `param_<name>` URL query parameters — zero string interpolation of
 * user input (Rule K.2 / RETRO-008 / FOLLOW-261 pattern).
 *
 * Join key: intent_events.session_id = intent_sessions.session_id (+ tenant_id).
 * Do NOT use intent_session_id (ORDER BY key, UUID zero-default, FOLLOW-287 CB-1).
 *
 * Rule K.2 compliance:
 *   - When CLICKHOUSE_URL is unset: returns null (caller handles as "unconfigured").
 *   - When CLICKHOUSE_URL is set but query fails: THROWS (caller must NOT silently
 *     return mock data — must surface error status or explicit degraded flag).
 *
 * @module apps/control-plane/src/lib/clickhouse-tracer
 */

import type { IntentEventRow } from '@estalara/shared';
import { clickhouseAuthHeaders } from '@/lib/clickhouse-http';

// ─── Config ──────────────────────────────────────────────────────────────────

export interface ClickHouseTracerConfig {
  url: string;
  /** ClickHouse username. Defaults to `'default'` when env is unset. */
  user: string;
  password: string;
  database: string;
}

/**
 * Resolve ClickHouse config from env. Returns null when CLICKHOUSE_URL is unset
 * (dev / CI — legitimate unconfigured state; callers fall back to mock).
 */
export function resolveClickHouseTracerConfig(): ClickHouseTracerConfig | null {
  const url = process.env.CLICKHOUSE_URL;
  if (!url) return null;
  return {
    url: url.replace(/\/$/, ''),
    user: process.env.CLICKHOUSE_USER ?? 'default',
    password: process.env.CLICKHOUSE_PASSWORD ?? '',
    database: process.env.CLICKHOUSE_DATABASE ?? 'default',
  };
}

// ─── Core parameterized query executor ───────────────────────────────────────

/**
 * Execute a parameterized SELECT against ClickHouse and parse JSONEachRow output.
 *
 * Params are bound as `param_<key>` URL query parameters (ClickHouse HTTP interface
 * parameterized query syntax). The SQL must use `{key:Type}` placeholders for every
 * user-supplied value — no string interpolation of input.
 *
 * THROWS on non-2xx response (Rule K.2 — configured-store failure must propagate).
 */
export async function chTracerQuery<T = unknown>(
  cfg: ClickHouseTracerConfig,
  sql: string,
  params: Record<string, string> = {},
): Promise<T[]> {
  const url = new URL(cfg.url);
  url.searchParams.set('database', cfg.database);
  url.searchParams.set('query', `${sql.trim()} FORMAT JSONEachRow`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(`param_${k}`, v);
  }

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'text/plain',
      ...clickhouseAuthHeaders(cfg),
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '<no body>');
    throw new Error(
      `ClickHouse tracer query failed: HTTP ${String(res.status)}: ${body.slice(0, 400)}`,
    );
  }

  const text = await res.text();
  if (!text.trim()) return [];
  return text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as T);
}

/**
 * Execute a ClickHouse COUNT query and return the numeric result.
 * Used for paginated responses to get total row count.
 *
 * THROWS on non-2xx response (Rule K.2).
 */
export async function chTracerCount(
  cfg: ClickHouseTracerConfig,
  sql: string,
  params: Record<string, string> = {},
): Promise<number> {
  const url = new URL(cfg.url);
  url.searchParams.set('database', cfg.database);
  url.searchParams.set('query', `${sql.trim()} FORMAT JSONEachRow`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(`param_${k}`, v);
  }

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'Content-Type': 'text/plain',
      ...clickhouseAuthHeaders(cfg),
    },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '<no body>');
    throw new Error(
      `ClickHouse tracer count failed: HTTP ${String(res.status)}: ${body.slice(0, 400)}`,
    );
  }

  const text = await res.text();
  if (!text.trim()) return 0;
  const rows = text
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { count: string });
  return parseInt(rows[0]?.count ?? '0', 10);
}

// ─── Intent event queries ─────────────────────────────────────────────────────
//
// IMPORTANT: every SELECT below projects `toString(event_at) AS event_at`, which
// shadows the underlying DateTime64 column with a String alias of the same name.
// ClickHouse resolves alias names inside WHERE/ORDER BY, so a bare `event_at` in a
// WHERE date comparison binds to the String alias → `String >= DateTime` →
// "NO_COMMON_TYPE" (Code 386) at query-analysis time, even on an empty table.
// Therefore any WHERE/ORDER BY reference to the *column* MUST be table-qualified
// as `intent_events.event_at`. The JSON output key stays `event_at` via the alias,
// so IntentEventRow parsing is unaffected. (FOLLOW-315)

/**
 * Fetch intent_events rows for a given session_id (ordered ASC by event_at).
 *
 * Join key: session_id (String, migration 0015). NOT intent_session_id (ORDER BY UUID).
 *
 * @throws when ClickHouse is configured but query fails (Rule K.2).
 */
export async function fetchIntentEventsForSession(
  cfg: ClickHouseTracerConfig,
  tenantId: string,
  sessionId: string,
): Promise<IntentEventRow[]> {
  const sql = `
    SELECT
      session_id,
      tenant_id,
      toString(event_at)    AS event_at,
      event_type,
      archetype_deltas,
      confidence_before,
      confidence_after,
      top_archetype,
      event_payload
    FROM intent_events
    WHERE tenant_id   = {p_tenant_id:String}
      AND session_id  = {p_session_id:String}
    ORDER BY intent_events.event_at ASC
  `;
  return chTracerQuery<IntentEventRow>(cfg, sql, {
    p_tenant_id: tenantId,
    p_session_id: sessionId,
  });
}

/**
 * Fetch paginated intent_events for history view.
 *
 * All user-supplied filter values are bound as parameterized ClickHouse params.
 *
 * @throws when ClickHouse is configured but query fails (Rule K.2).
 */
export async function fetchIntentEventsHistory(
  cfg: ClickHouseTracerConfig,
  opts: {
    tenantId: string;
    sessionId?: string;
    from?: string;
    to?: string;
    archetype?: string;
    limit: number;
    offset: number;
  },
): Promise<{ events: IntentEventRow[]; total: number }> {
  // Build WHERE clauses and param bindings without string interpolation.
  const whereClauses: string[] = ['tenant_id = {p_tenant_id:String}'];
  const params: Record<string, string> = { p_tenant_id: opts.tenantId };

  if (opts.sessionId) {
    whereClauses.push('session_id = {p_session_id:String}');
    params.p_session_id = opts.sessionId;
  }
  if (opts.from) {
    whereClauses.push('intent_events.event_at >= parseDateTimeBestEffort({p_from:String})');
    params.p_from = opts.from;
  }
  if (opts.to) {
    whereClauses.push('intent_events.event_at <= parseDateTimeBestEffort({p_to:String})');
    params.p_to = opts.to;
  }
  if (opts.archetype) {
    whereClauses.push('top_archetype = {p_archetype:String}');
    params.p_archetype = opts.archetype;
  }

  const whereStr = whereClauses.join('\n      AND ');

  const dataSql = `
    SELECT
      session_id,
      tenant_id,
      toString(event_at)    AS event_at,
      event_type,
      archetype_deltas,
      confidence_before,
      confidence_after,
      top_archetype,
      event_payload
    FROM intent_events
    WHERE ${whereStr}
    ORDER BY intent_events.event_at DESC
    LIMIT {p_limit:UInt32} OFFSET {p_offset:UInt32}
  `;

  const countSql = `
    SELECT count() AS count
    FROM intent_events
    WHERE ${whereStr}
  `;

  const countParams = { ...params };
  const dataParams = { ...params, p_limit: String(opts.limit), p_offset: String(opts.offset) };

  const [events, total] = await Promise.all([
    chTracerQuery<IntentEventRow>(cfg, dataSql, dataParams),
    chTracerCount(cfg, countSql, countParams),
  ]);

  return { events, total };
}

/**
 * Fetch all intent_events for export (tenant + time range).
 * Returns an async generator that yields rows in batches of 500 for streaming.
 *
 * @throws when ClickHouse is configured but query fails (Rule K.2).
 */
export async function fetchIntentEventsForExport(
  cfg: ClickHouseTracerConfig,
  opts: {
    tenantId: string;
    from: string;
    to: string;
  },
): Promise<IntentEventRow[]> {
  const sql = `
    SELECT
      session_id,
      tenant_id,
      toString(event_at)    AS event_at,
      event_type,
      archetype_deltas,
      confidence_before,
      confidence_after,
      top_archetype,
      event_payload
    FROM intent_events
    WHERE tenant_id  = {p_tenant_id:String}
      AND intent_events.event_at >= parseDateTimeBestEffort({p_from:String})
      AND intent_events.event_at <= parseDateTimeBestEffort({p_to:String})
    ORDER BY intent_events.event_at ASC
  `;
  return chTracerQuery<IntentEventRow>(cfg, sql, {
    p_tenant_id: opts.tenantId,
    p_from: opts.from,
    p_to: opts.to,
  });
}

/**
 * Poll for intent_events newer than lastEventAt for a given session.
 * Used by the SSE stream route (AC3).
 *
 * @throws when ClickHouse is configured but query fails (Rule K.2).
 */
export async function fetchNewIntentEvents(
  cfg: ClickHouseTracerConfig,
  tenantId: string,
  sessionId: string,
  lastEventAt: string,
): Promise<IntentEventRow[]> {
  const sql = `
    SELECT
      session_id,
      tenant_id,
      toString(event_at)    AS event_at,
      event_type,
      archetype_deltas,
      confidence_before,
      confidence_after,
      top_archetype,
      event_payload
    FROM intent_events
    WHERE tenant_id  = {p_tenant_id:String}
      AND session_id = {p_session_id:String}
      AND intent_events.event_at > parseDateTimeBestEffort({p_last_event_at:String})
    ORDER BY intent_events.event_at ASC
  `;
  return chTracerQuery<IntentEventRow>(cfg, sql, {
    p_tenant_id: tenantId,
    p_session_id: sessionId,
    p_last_event_at: lastEventAt,
  });
}
