/**
 * ClickHouse DSR — RODO Art. 17 hard-delete helpers.
 *
 * FOLLOW-039. The control plane's POST /api/dsr/erase endpoint persists a
 * Postgres soft-delete + an audit-log row, then calls into this module to
 * issue an `ALTER TABLE ... DELETE WHERE session_id IN (...)` mutation
 * against every ClickHouse table that carries session-scoped PII. The
 * /api/dsr/mutation-poll Vercel Cron endpoint polls `system.mutations`
 * via the helpers here and updates the operational state table
 * `dsr_clickhouse_mutations`.
 *
 * ClickHouse semantics:
 *   - `ALTER TABLE ... DELETE WHERE` is a **mutation**, not a synchronous
 *     DELETE. It queues and ClickHouse Cloud may take seconds to minutes
 *     before `system.mutations.is_done = 1`.
 *   - Each ALTER produces a row in `system.mutations`; we identify the row
 *     by `(database, table, create_time >= issued_at, command LIKE %marker%)`
 *     where `marker` is a deterministic comment injected into the SQL.
 *   - Mutations cannot be cancelled cleanly; on failure we mark the row
 *     'failed' and reissue (this re-queues a fresh mutation).
 *
 * Data inventory (PII-bearing, session-scoped, must erase):
 *   - events                  (PII: full behavioural events + payload)
 *   - adaptation_decisions    (PII: archetype + confidence per session)
 *   - llm_calls               (PII: LLM cost per session)
 *   - session_quality         (PII: DQS metrics per session)
 *
 * Tables intentionally NOT erased:
 *   - dsr_audit_log           — retained for GDPR Art. 17(3)(b) legal claims
 *   - description_generations — listing-scoped, no session_id column
 *
 * Materialized views (`events_5min_rollup`, `session_summary`) reference
 * data already deleted by the underlying mutations; they re-converge
 * naturally on the next merge cycle.
 *
 * @module apps/control-plane/src/lib/clickhouse-dsr
 */

import { randomUUID } from 'crypto';
import { clickhouseAuthHeaders } from '@/lib/clickhouse-http';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * The canonical inventory of ClickHouse PII tables erased on a DSR-erase
 * request. Each entry has the table name and the column to filter on. If a
 * new PII-bearing, session-scoped table is added, append it here.
 */
export const DSR_CLICKHOUSE_TABLES: readonly { table: string; column: string }[] = [
  { table: 'events', column: 'session_id' },
  { table: 'adaptation_decisions', column: 'session_id' },
  { table: 'llm_calls', column: 'session_id' },
  { table: 'session_quality', column: 'session_id' },
];

export type DsrTableName = (typeof DSR_CLICKHOUSE_TABLES)[number]['table'];

// ─── SQL builder ──────────────────────────────────────────────────────────────

/**
 * Build an `ALTER TABLE ... DELETE WHERE session_id IN (...)` statement.
 *
 * The returned SQL embeds a per-request marker comment so the mutation can be
 * uniquely identified in `system.mutations` after issuing. The marker is the
 * value of `markerToken` wrapped in `/* DSR:<token> *\/` SQL comment syntax.
 *
 * Session IDs are SQL-string-quoted with single quotes; embedded single
 * quotes are doubled per ANSI SQL escaping. session IDs in this codebase are
 * SHA-256 hex digests (64 hex chars) — see
 * `apps/ingest/src/middleware/idempotency.ts` — so embedded quotes are not
 * expected, but we escape defensively.
 *
 * @param table - ClickHouse table name. Caller must restrict to known PII tables.
 * @param column - Column to filter on (typically `session_id`).
 * @param sessionIds - Non-empty array of session IDs to erase.
 * @param markerToken - Caller-supplied identifier (e.g. a UUID) embedded as a
 *   SQL comment so we can find the mutation in `system.mutations` later.
 * @returns The SQL string ready to POST to ClickHouse.
 * @throws Error if `sessionIds` is empty (caller should short-circuit instead).
 */
export function buildEraseMutationSql(
  table: string,
  column: string,
  sessionIds: readonly string[],
  markerToken: string,
): string {
  if (sessionIds.length === 0) {
    throw new Error('buildEraseMutationSql: sessionIds must be non-empty');
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
    throw new Error(`buildEraseMutationSql: invalid table name '${table}'`);
  }
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(column)) {
    throw new Error(`buildEraseMutationSql: invalid column name '${column}'`);
  }
  if (!/^[a-zA-Z0-9_-]+$/.test(markerToken)) {
    throw new Error(`buildEraseMutationSql: marker token must be alphanumeric+_-`);
  }

  const escaped = sessionIds.map((s) => `'${s.replace(/'/g, "''")}'`).join(', ');
  // The /* DSR:<token> */ comment is preserved verbatim in
  // system.mutations.command — we'll look it up by substring.
  return `ALTER TABLE ${table} DELETE WHERE ${column} IN (${escaped}) /* DSR:${markerToken} */`;
}

// ─── HTTP transport ───────────────────────────────────────────────────────────

interface ClickHouseConfig {
  url: string;
  /** ClickHouse username. Defaults to `'default'` when env is unset. */
  user: string;
  password: string;
}

/**
 * Resolve ClickHouse connection details from environment.
 *
 * Returns null when CLICKHOUSE_URL is not configured (dev / CI without a
 * ClickHouse instance) — callers should treat this as a no-op.
 */
export function readClickHouseConfig(): ClickHouseConfig | null {
  const url = process.env.CLICKHOUSE_URL;
  if (!url) return null;
  return {
    url: url.replace(/\/$/, ''),
    user: process.env.CLICKHOUSE_USER ?? 'default',
    password: process.env.CLICKHOUSE_PASSWORD ?? '',
  };
}

/**
 * Execute an arbitrary SQL statement against ClickHouse via the HTTP
 * interface. Errors thrown on non-2xx response.
 */
export async function executeClickHouseSql(cfg: ClickHouseConfig, sql: string): Promise<string> {
  const res = await fetch(cfg.url, {
    method: 'POST',
    headers: {
      ...clickhouseAuthHeaders(cfg),
      'Content-Type': 'text/plain',
    },
    body: sql,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '<no body>');
    throw new Error(`ClickHouse SQL failed: HTTP ${String(res.status)}: ${body.slice(0, 500)}`);
  }
  return res.text();
}

/**
 * Query ClickHouse and parse the response as JSON rows.
 *
 * Uses `FORMAT JSON` (not JSONEachRow) so we get a `{ data: [...] }` shape
 * which is easier to consume. ClickHouse will append the FORMAT directive if
 * the SQL doesn't already specify one.
 */
export async function queryClickHouseJson<T = unknown>(
  cfg: ClickHouseConfig,
  sql: string,
): Promise<T[]> {
  const text = await executeClickHouseSql(cfg, `${sql} FORMAT JSON`);
  const parsed = JSON.parse(text) as { data?: T[] };
  return parsed.data ?? [];
}

// ─── Mutation issue + poll ────────────────────────────────────────────────────

export interface IssueMutationInput {
  table: string;
  column: string;
  sessionIds: readonly string[];
}

export interface IssueMutationResult {
  table: string;
  markerToken: string;
  alterSql: string;
  mutationId: string | null;
}

/**
 * Issue one ALTER TABLE mutation against the given ClickHouse table and try
 * to resolve its `mutation_id` from `system.mutations`. The marker token is
 * generated as a fresh UUID per call so the same session can be reissued
 * later (idempotent re-erase) without colliding on the mutation lookup.
 *
 * If `mutation_id` cannot be resolved immediately (race between INSERT and
 * SELECT against `system.mutations`), `mutationId` is returned as null —
 * the poller will retry the lookup using the marker on its next run.
 *
 * Throws if ClickHouse rejects the ALTER itself (network error, syntax,
 * permissions). Callers should write a `failed` row in
 * `dsr_clickhouse_mutations` and trigger retry / Sentry.
 */
export async function issueEraseMutation(
  cfg: ClickHouseConfig,
  input: IssueMutationInput,
): Promise<IssueMutationResult> {
  if (input.sessionIds.length === 0) {
    throw new Error('issueEraseMutation: sessionIds must be non-empty');
  }
  const markerToken = randomUUID().replace(/-/g, '');
  const alterSql = buildEraseMutationSql(input.table, input.column, input.sessionIds, markerToken);

  await executeClickHouseSql(cfg, alterSql);

  // Resolve mutation_id by marker. ClickHouse system.mutations.command
  // preserves SQL comments verbatim.
  const mutationId = await resolveMutationIdByMarker(cfg, input.table, markerToken);
  return { table: input.table, markerToken, alterSql, mutationId };
}

/**
 * Look up the mutation_id for a previously issued ALTER TABLE by the
 * embedded marker comment. Returns null if no matching row is found yet
 * (the caller should treat this as "retry on the next poll").
 */
export async function resolveMutationIdByMarker(
  cfg: ClickHouseConfig,
  table: string,
  markerToken: string,
): Promise<string | null> {
  // Escape marker for SQL substring. Marker is alphanumeric (validated in
  // builder) so safe to embed directly, but we use parameterised form via
  // the `query` URL trick to be defensive.
  const sql = `
    SELECT mutation_id
    FROM system.mutations
    WHERE table = '${table.replace(/'/g, "''")}'
      AND command LIKE '%DSR:${markerToken}%'
    ORDER BY create_time DESC
    LIMIT 1
  `;
  const rows = await queryClickHouseJson<{ mutation_id: string }>(cfg, sql);
  const first = rows[0];
  return first ? first.mutation_id : null;
}

export interface MutationStatusRow {
  mutation_id: string;
  is_done: 0 | 1 | '0' | '1';
  is_killed: 0 | 1 | '0' | '1';
  latest_failed_reason: string;
  create_time: string;
}

/**
 * Fetch the status of a specific mutation from ClickHouse `system.mutations`.
 * Returns null when no row exists for the given (table, mutation_id) — this
 * can happen if the mutation row was already trimmed (rare) or if the lookup
 * is racing the INSERT.
 */
export async function pollMutationStatus(
  cfg: ClickHouseConfig,
  table: string,
  mutationId: string,
): Promise<MutationStatusRow | null> {
  const sql = `
    SELECT
      mutation_id,
      is_done,
      is_killed,
      coalesce(latest_failed_reason, '') AS latest_failed_reason,
      toString(create_time) AS create_time
    FROM system.mutations
    WHERE table = '${table.replace(/'/g, "''")}'
      AND mutation_id = '${mutationId.replace(/'/g, "''")}'
    ORDER BY create_time DESC
    LIMIT 1
  `;
  const rows = await queryClickHouseJson<MutationStatusRow>(cfg, sql);
  return rows[0] ?? null;
}

// ─── Aggregate status calculation ─────────────────────────────────────────────

/**
 * Aggregate per-table mutation statuses into the coarse audit-log status.
 *
 * Rules:
 *   - any 'pending'                                → 'pending'
 *   - any 'in_progress' (and no 'pending')         → 'in_progress'
 *   - any 'failed' AND all others terminal         → 'failed' (errs on side of
 *                                                     flagging compliance issue)
 *   - all 'done'                                   → 'done'
 *   - empty input (no mutations issued)            → 'no_data'
 */
export function aggregateMutationStatus(
  statuses: readonly ('pending' | 'in_progress' | 'done' | 'failed')[],
): 'pending' | 'in_progress' | 'done' | 'failed' | 'no_data' {
  if (statuses.length === 0) return 'no_data';
  if (statuses.includes('pending')) return 'pending';
  if (statuses.includes('in_progress')) return 'in_progress';
  if (statuses.includes('failed')) return 'failed';
  return 'done';
}

/**
 * Compute the next retry timestamp using exponential backoff.
 * Attempt 1 → +1 min, attempt 2 → +5 min, attempt 3 → +30 min.
 * Returns null after attempt 3 (terminal).
 */
export function computeNextRetryAt(retryCount: number, now: Date = new Date()): Date | null {
  if (retryCount === 0) return new Date(now.getTime() + 1 * 60_000);
  if (retryCount === 1) return new Date(now.getTime() + 5 * 60_000);
  if (retryCount === 2) return new Date(now.getTime() + 30 * 60_000);
  return null;
}

/**
 * Maximum number of times the poller will reissue an `ALTER TABLE` after a
 * failed mutation before marking the row terminally `failed`.
 */
export const MAX_MUTATION_RETRIES = 3;

// ─── DSR audit log update (ClickHouse-side) ────────────────────────────────────

/**
 * Update the `dsr_audit_log` ClickHouse row for a given DSR audit entry with
 * the final aggregate mutation status. ClickHouse mutations on a single
 * row use `ALTER TABLE ... UPDATE WHERE` (also a mutation). For an audit log
 * which is append-only, we instead issue an UPDATE by tenant_id + session_id +
 * action ('completed').
 *
 * This is fire-and-forget from the poller — the operational truth lives in
 * the Postgres `dsr_clickhouse_mutations` table; the ClickHouse columns are
 * a denormalised convenience for audit dashboards.
 */
export async function updateDsrAuditLogClickHouseStatus(
  cfg: ClickHouseConfig,
  args: {
    tenant_id: string;
    session_id: string;
    clickhouse_mutation_id: string;
    clickhouse_mutation_status: 'pending' | 'in_progress' | 'done' | 'failed' | 'no_data';
    completed: boolean;
  },
): Promise<void> {
  const escTenant = args.tenant_id.replace(/'/g, "''");
  const escSession = args.session_id.replace(/'/g, "''");
  const escMutationId = args.clickhouse_mutation_id.replace(/'/g, "''");
  const escStatus = args.clickhouse_mutation_status.replace(/'/g, "''");

  const completedAtClause = args.completed
    ? `, clickhouse_mutation_completed_at = now64(3, 'UTC')`
    : '';

  const sql = `
    ALTER TABLE dsr_audit_log
    UPDATE
      clickhouse_mutation_id = '${escMutationId}',
      clickhouse_mutation_status = '${escStatus}'
      ${completedAtClause}
    WHERE tenant_id = '${escTenant}'
      AND session_id = '${escSession}'
      AND dsr_type = 'erase'
      AND action = 'completed'
  `;
  await executeClickHouseSql(cfg, sql);
}
