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
 *   - intent_events           (FOLLOW-455 / audit F-20: K.3.6 tracer per-signal
 *                              event trail. FOLLOW-581: keyed on the String
 *                              `session_id` column — the SDK fingerprint — like
 *                              every other table here. Real rows are written
 *                              with `session_id` populated and the UUID
 *                              `intent_session_id` column left at its zero-UUID
 *                              default (the ingest writer
 *                              apps/ingest/src/handlers/intent-snapshot.ts omits
 *                              it; migrations 0015/0016), so the authoritative
 *                              subject key is `session_id` — confirmed by
 *                              clickhouse-tracer.ts ("Do NOT use
 *                              intent_session_id"). The pre-FOLLOW-581 erase
 *                              filter on `intent_session_id` matched zero real
 *                              rows — a latent Art. 17 no-op — now fixed so
 *                              erase and disclosure agree on `session_id`.)
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
 *
 * Every table — including `intent_events` (FOLLOW-581) — is keyed on the SDK
 * `session_id` fingerprint. See the module header for why `intent_events` is
 * NOT keyed on its zero-default `intent_session_id` UUID column.
 */
export const DSR_CLICKHOUSE_TABLES: readonly {
  table: string;
  column: string;
}[] = [
  { table: 'events', column: 'session_id' },
  { table: 'adaptation_decisions', column: 'session_id' },
  { table: 'llm_calls', column: 'session_id' },
  { table: 'session_quality', column: 'session_id' },
  { table: 'intent_events', column: 'session_id' },
];

export type DsrTableName = (typeof DSR_CLICKHOUSE_TABLES)[number]['table'];

// ─── Identifier allowlists (FOLLOW-462) ────────────────────────────────────────
//
// ClickHouse table/column identifiers and SQL comment markers cannot be bound
// via HTTP `param_*` parameter binding — parameters only substitute *values*
// inside `{name:Type}` placeholders, never bare identifiers or raw SQL text.
// These are therefore validated with a strict allowlist BEFORE any string
// concatenation, exactly as before this fix. Session/tenant/mutation id
// *values* (the part that was vulnerable, see below) are now bound as real
// ClickHouse parameters instead of being concatenated into the SQL text.

const TABLE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const COLUMN_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const MARKER_TOKEN_PATTERN = /^[a-zA-Z0-9_-]+$/;

function assertValidIdentifier(value: string, pattern: RegExp, label: string, fn: string): void {
  if (!pattern.test(value)) {
    throw new Error(`${fn}: invalid ${label} '${value}'`);
  }
}

// ─── ClickHouse HTTP parameter encoding (FOLLOW-462) ──────────────────────────

/**
 * Encode a raw string for transport as a ClickHouse HTTP `param_<name>` query
 * argument.
 *
 * ClickHouse parses `param_*` values using its "Escaped" text format (the
 * same escaping TabSeparated/TSV cells use), NOT SQL string-literal syntax —
 * the value is never embedded in the SQL text at all, so there is no quote
 * delimiter to escape. The only bytes that are structurally significant in
 * this format are backslash (the escape character itself) and the control
 * characters ClickHouse recognises escape sequences for; per the
 * TabSeparated format spec the minimum required escapes are backslash, tab,
 * and line feed — https://clickhouse.com/docs/interfaces/formats/TabSeparated
 * ("escape sequences used for output: \b \f \r \n \t \0 \' \\"). Backslash
 * MUST be escaped first so this function doesn't double-escape the
 * backslashes it just inserted for the other sequences.
 *
 * This is what makes a trailing backslash in a session_id safe: the
 * backslash never reaches the SQL text, so it cannot combine with the
 * surrounding SQL quote to reopen the string literal (the FOLLOW-462 bug).
 */
function escapeClickHouseParamValue(raw: string): string {
  return raw
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\0/g, '\\0')
    .replace(/\f/g, '\\f')
    .split('\b') // \b in a regex is a word-boundary assertion, not the backspace char — use split/join instead
    .join('\\b');
}

// ─── SQL builder ──────────────────────────────────────────────────────────────

/** A parameterized ClickHouse statement: SQL text plus its bound param values. */
export interface ParameterizedSql {
  /** SQL text with `{name:Type}` placeholders — never contains raw id values. */
  sql: string;
  /** Values to bind, keyed by placeholder name (sent as `param_<name>`). */
  params: Record<string, string>;
}

/**
 * Build an `ALTER TABLE ... DELETE WHERE session_id IN (...)` statement.
 *
 * FOLLOW-462: session IDs are bound as ClickHouse HTTP parameters
 * (`{dsr_id_N:String}` placeholders + `param_dsr_id_N=...`), not concatenated
 * into the SQL text. Quote-only escaping of arbitrary id values was defeated
 * by a trailing backslash (`'...\'` re-opens the string literal because
 * backslash is itself an escape character in ClickHouse string literals) —
 * parameter binding removes the id value from the SQL text entirely, so no
 * amount of quotes/backslashes in the value can alter the statement's shape.
 *
 * The returned SQL embeds a per-request marker comment so the mutation can be
 * uniquely identified in `system.mutations` after issuing. The marker is the
 * value of `markerToken` wrapped in `/* DSR:<token> *\/` SQL comment syntax.
 * `table`, `column`, and `markerToken` cannot be parameter-bound (ClickHouse
 * parameters only substitute values inside `{name:Type}`, never identifiers
 * or raw SQL/comment text) so they are validated against a strict allowlist
 * instead — table/column must look like ClickHouse identifiers, and
 * markerToken must be alphanumeric/`_`/`-` (we generate it ourselves as a
 * UUID with hyphens stripped).
 *
 * @param table - ClickHouse table name. Caller must restrict to known PII tables.
 * @param column - Column to filter on (typically `session_id`).
 * @param sessionIds - Non-empty array of session IDs to erase.
 * @param markerToken - Caller-supplied identifier (e.g. a UUID) embedded as a
 *   SQL comment so we can find the mutation in `system.mutations` later.
 * @returns `{ sql, params }` ready to POST to ClickHouse via `executeClickHouseSql`.
 * @throws Error if `sessionIds` is empty, or if `table`/`column`/`markerToken`
 *   fail their allowlist checks (caller should short-circuit instead).
 */
export function buildEraseMutationSql(
  table: string,
  column: string,
  sessionIds: readonly string[],
  markerToken: string,
): ParameterizedSql {
  if (sessionIds.length === 0) {
    throw new Error('buildEraseMutationSql: sessionIds must be non-empty');
  }
  assertValidIdentifier(table, TABLE_NAME_PATTERN, 'table name', 'buildEraseMutationSql');
  assertValidIdentifier(column, COLUMN_NAME_PATTERN, 'column name', 'buildEraseMutationSql');
  if (!MARKER_TOKEN_PATTERN.test(markerToken)) {
    throw new Error(`buildEraseMutationSql: marker token must be alphanumeric+_-`);
  }

  const params: Record<string, string> = {};
  const placeholders = sessionIds.map((id, i) => {
    const paramName = `dsr_id_${String(i)}`;
    params[paramName] = escapeClickHouseParamValue(id);
    return `{${paramName}:String}`;
  });
  // The /* DSR:<token> */ comment is preserved verbatim in
  // system.mutations.command — we'll look it up by substring. markerToken is
  // allowlist-validated above, so embedding it directly is safe.
  const sql = `ALTER TABLE ${table} DELETE WHERE ${column} IN (${placeholders.join(', ')}) /* DSR:${markerToken} */`;
  return { sql, params };
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
 *
 * `params`, if given, are sent as `param_<name>` URL query arguments — the
 * ClickHouse HTTP interface's parameterized-query binding mechanism. `sql`
 * must reference them via `{name:Type}` placeholders (see
 * `buildEraseMutationSql`); this mirrors the existing `chTracerQuery` /
 * `chTracerCount` pattern in `apps/control-plane/src/lib/clickhouse-tracer.ts`
 * (FOLLOW-261) so the control plane has one parameter-binding convention.
 */
export async function executeClickHouseSql(
  cfg: ClickHouseConfig,
  sql: string,
  params?: Record<string, string>,
): Promise<string> {
  const url = new URL(cfg.url);
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      url.searchParams.set(`param_${name}`, value);
    }
  }
  const res = await fetch(url.toString(), {
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
  params?: Record<string, string>,
): Promise<T[]> {
  const text = await executeClickHouseSql(cfg, `${sql} FORMAT JSON`, params);
  const parsed = JSON.parse(text) as { data?: T[] };
  return parsed.data ?? [];
}

// ─── DSR disclosure: full ClickHouse row export (FOLLOW-574) ─────────────────
//
// FOLLOW-574 Rule I note: this section supersedes the FOLLOW-455 aggregate
// `getSessionEventSummary` (count/first_at/last_at over `events`) that used to
// live here. Removing its own route callers (in favor of the full-row
// `clickhouse` disclosure below) orphaned that function — a zero-non-test-
// importer export — so it and its `SessionEventSummary` type were deleted
// rather than left dead (CLAUDE.md "remove what your changes made unused";
// Rule I). `getClickHouseDisclosure`'s per-table `events` export is a strict
// superset of what it reported.
//
// FOLLOW-574 / CEO ruling ESC-037 (2026-07-17): GET /api/dsr/access and
// GET /api/dsr/portability must disclose ACTUAL ROWS from every ClickHouse PII
// table in `DSR_CLICKHOUSE_TABLES`, not an aggregate over one of them. The
// disclosure SET is DERIVED from that constant (see `getClickHouseDisclosure`)
// so a new erase-set table is disclosed automatically — disclosure can never
// silently drift below erasure (Art. 15/20 completeness; anti-FOLLOW-576).
//
// `events` is high-volume per session, so its export is keyset-paginated with a
// hard in-memory row cap + a continuation cursor (CEO ruling: "NOT one
// unbounded in-memory response"). The lower-volume per-session tables use a
// single capped SELECT.

/** Hard in-memory cap on rows exported for the high-volume `events` table. */
const DSR_EVENTS_EXPORT_MAX_ROWS = 50_000;
/** Per-round-trip page size for the keyset-paginated `events` export. */
const DSR_EVENTS_EXPORT_PAGE_SIZE = 10_000;
/** Hard cap on rows exported for the lower-volume per-session tables. */
const DSR_TABLE_EXPORT_MAX_ROWS = 10_000;

/** One exported `events` row (subset of columns; identifiers stringified). */
interface ClickHouseEventRow {
  event_id: string;
  ts: string;
  ingest_received_at: string;
  region: string;
  type: string;
  schema_version: number;
  consent_state: string;
  listing_id: string;
  archetype_hint: string;
  payload: string;
}

/** Keyset continuation cursor for the paginated `events` export. */
interface EventsExportCursor {
  after_ts: string;
  after_event_id: string;
}

interface EventsExport {
  rows: ClickHouseEventRow[];
  /** True when the export hit `maxRows` and more rows exist beyond the cursor. */
  truncated: boolean;
  /** Continuation cursor when `truncated`; null otherwise. */
  next_cursor: EventsExportCursor | null;
}

/**
 * Fetch one keyset page of `events` rows for a (tenant_id, session_id).
 *
 * Column references in WHERE/ORDER BY are table-qualified (`e.ts`, `e.event_id`)
 * to avoid the ClickHouse alias-shadowing trap where a bare `ts` in WHERE binds
 * to the `toString(ts) AS ts` String alias and fails the `> DateTime64`
 * comparison (see apps/control-plane/src/lib/clickhouse-tracer.ts). `pageSize`
 * is an internally-computed integer (never user input) so it is interpolated
 * after an integer check rather than parameter-bound (ClickHouse LIMIT).
 */
async function fetchEventsPage(
  cfg: ClickHouseConfig,
  tenantId: string,
  sessionId: string,
  cursor: EventsExportCursor | null,
  pageSize: number,
): Promise<ClickHouseEventRow[]> {
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new Error('fetchEventsPage: pageSize must be a positive integer');
  }
  const cursorClause = cursor
    ? `AND (e.ts, e.event_id) > (toDateTime64({after_ts:String}, 3, 'UTC'), toUUID({after_event_id:String}))`
    : '';
  const sql = `
    SELECT
      toString(e.event_id)          AS event_id,
      toString(e.ts)                AS ts,
      toString(e.ingest_received_at) AS ingest_received_at,
      e.region                      AS region,
      e.type                        AS type,
      e.schema_version              AS schema_version,
      e.consent_state               AS consent_state,
      e.listing_id                  AS listing_id,
      e.archetype_hint              AS archetype_hint,
      e.payload                     AS payload
    FROM events AS e
    WHERE e.tenant_id = {tenant_id:String}
      AND e.session_id = {session_id:String}
      ${cursorClause}
    ORDER BY e.ts ASC, e.event_id ASC
    LIMIT ${String(pageSize)}
  `;
  const params: Record<string, string> = {
    tenant_id: escapeClickHouseParamValue(tenantId),
    session_id: escapeClickHouseParamValue(sessionId),
  };
  if (cursor) {
    params.after_ts = escapeClickHouseParamValue(cursor.after_ts);
    params.after_event_id = escapeClickHouseParamValue(cursor.after_event_id);
  }
  return queryClickHouseJson<ClickHouseEventRow>(cfg, sql, params);
}

/**
 * Export the subject's `events` rows for a (tenant_id, session_id) volume-safely.
 *
 * Keyset-paginates in pages of `DSR_EVENTS_EXPORT_PAGE_SIZE`, bounding total
 * memory to `maxRows` (+ one page). When more rows exist beyond `maxRows` the
 * result is `truncated` and carries a `next_cursor` the caller can surface as a
 * documented continuation token. `event_id` is a UUID (strictly unique) so the
 * keyset cursor always advances — no infinite loop.
 *
 * Module-internal (Rule I): the only external surface `access`/`portability`
 * need is `getClickHouseDisclosure`, which calls this. Exercised in tests via
 * that public function with a mocked ClickHouse client.
 */
async function exportSessionEvents(
  cfg: ClickHouseConfig,
  tenantId: string,
  sessionId: string,
  opts?: { maxRows?: number; cursor?: EventsExportCursor | null },
): Promise<EventsExport> {
  const maxRows = opts?.maxRows ?? DSR_EVENTS_EXPORT_MAX_ROWS;
  const rows: ClickHouseEventRow[] = [];
  let cursor: EventsExportCursor | null = opts?.cursor ?? null;

  for (;;) {
    const page = await fetchEventsPage(
      cfg,
      tenantId,
      sessionId,
      cursor,
      DSR_EVENTS_EXPORT_PAGE_SIZE,
    );
    rows.push(...page);
    if (page.length < DSR_EVENTS_EXPORT_PAGE_SIZE) break; // exhausted
    // page is full here, so its last row exists; advance the keyset cursor.
    const last = page[page.length - 1];
    if (!last) break;
    cursor = { after_ts: last.ts, after_event_id: last.event_id };
    if (rows.length > maxRows) break; // exceeded cap — stop fetching
  }

  if (rows.length > maxRows) {
    const kept = rows.slice(0, maxRows);
    const last = kept[kept.length - 1];
    return {
      rows: kept,
      truncated: true,
      next_cursor: last ? { after_ts: last.ts, after_event_id: last.event_id } : null,
    };
  }
  return { rows, truncated: false, next_cursor: null };
}

interface ClickHouseTableRowsExport {
  rows: Record<string, unknown>[];
  truncated: boolean;
}

/**
 * Export all rows of a lower-volume per-session ClickHouse table for a
 * (tenant_id, session_id), capped at `maxRows`. `SELECT *` so a table added to
 * `DSR_CLICKHOUSE_TABLES` is disclosed with no per-column code change. `table`
 * is allowlist-validated (bare identifier, not parameter-bindable). Fetches
 * `maxRows + 1` to detect truncation.
 *
 * Module-internal (Rule I): only `getClickHouseDisclosure` calls this.
 * Exercised in tests via that public function with a mocked ClickHouse client.
 */
async function exportSessionTableRows(
  cfg: ClickHouseConfig,
  table: string,
  tenantId: string,
  sessionId: string,
  maxRows: number = DSR_TABLE_EXPORT_MAX_ROWS,
): Promise<ClickHouseTableRowsExport> {
  assertValidIdentifier(table, TABLE_NAME_PATTERN, 'table name', 'exportSessionTableRows');
  if (!Number.isInteger(maxRows) || maxRows <= 0) {
    throw new Error('exportSessionTableRows: maxRows must be a positive integer');
  }
  const sql = `
    SELECT *
    FROM ${table}
    WHERE tenant_id = {tenant_id:String}
      AND session_id = {session_id:String}
    LIMIT ${String(maxRows + 1)}
  `;
  const rows = await queryClickHouseJson<Record<string, unknown>>(cfg, sql, {
    tenant_id: escapeClickHouseParamValue(tenantId),
    session_id: escapeClickHouseParamValue(sessionId),
  });
  if (rows.length > maxRows) {
    return { rows: rows.slice(0, maxRows), truncated: true };
  }
  return { rows, truncated: false };
}

interface ClickHouseTableDisclosure {
  table: string;
  rows: unknown[];
  truncated: boolean;
  next_cursor?: EventsExportCursor | null;
}

export interface ClickHouseDisclosure {
  /** False when ClickHouse is unconfigured or the query failed (see `note`). */
  available: boolean;
  note?: string;
  tables: ClickHouseTableDisclosure[];
}

/**
 * FOLLOW-574 — the ClickHouse axis of the DSR Art. 15/20 disclosure.
 *
 * Iterates `DSR_CLICKHOUSE_TABLES` (the SAME constant the erase route deletes
 * from) and exports each table's rows for the (tenant_id, session_id) subject.
 * Deriving the SET from that constant is the whole point: a table appended to
 * the erase set is disclosed here automatically, so disclosure can never
 * silently fall below erasure again (anti-FOLLOW-576).
 *
 * Subject key: every DSR ClickHouse PII table is identified by
 * (tenant_id, session_id) — including `intent_events` (FOLLOW-581 aligned the
 * erase-side filter onto the same `session_id` key this disclosure uses).
 */
export async function getClickHouseDisclosure(
  cfg: ClickHouseConfig,
  tenantId: string,
  sessionId: string,
): Promise<ClickHouseDisclosure> {
  const tables: ClickHouseTableDisclosure[] = [];

  for (const { table } of DSR_CLICKHOUSE_TABLES) {
    if (table === 'events') {
      const ev = await exportSessionEvents(cfg, tenantId, sessionId);
      tables.push({
        table,
        rows: ev.rows,
        truncated: ev.truncated,
        next_cursor: ev.next_cursor,
      });
      continue;
    }

    const res = await exportSessionTableRows(cfg, table, tenantId, sessionId);
    tables.push({
      table,
      rows: res.rows,
      truncated: res.truncated,
    });
  }

  return { available: true, tables };
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
  const { sql: alterSql, params } = buildEraseMutationSql(
    input.table,
    input.column,
    input.sessionIds,
    markerToken,
  );

  await executeClickHouseSql(cfg, alterSql, params);

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
  // FOLLOW-462: `table` is a bare identifier (cannot be parameter-bound) so
  // it is allowlist-validated instead of quote-escaped. `markerToken` is
  // validated too (this export is not guaranteed to receive an already
  // builder-validated token — see the mutation-poll retry path, which
  // recovers it via regex from stored SQL) and bound as a ClickHouse param
  // via `concat()` rather than being embedded in the `LIKE` pattern text.
  assertValidIdentifier(table, TABLE_NAME_PATTERN, 'table name', 'resolveMutationIdByMarker');
  if (!MARKER_TOKEN_PATTERN.test(markerToken)) {
    throw new Error(`resolveMutationIdByMarker: invalid marker token '${markerToken}'`);
  }
  const sql = `
    SELECT mutation_id
    FROM system.mutations
    WHERE table = '${table}'
      AND command LIKE concat('%DSR:', {marker:String}, '%')
    ORDER BY create_time DESC
    LIMIT 1
  `;
  const rows = await queryClickHouseJson<{ mutation_id: string }>(cfg, sql, {
    marker: escapeClickHouseParamValue(markerToken),
  });
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
  // FOLLOW-462: `table` is a bare identifier, allowlist-validated (cannot be
  // parameter-bound); `mutationId` is bound as a ClickHouse param.
  assertValidIdentifier(table, TABLE_NAME_PATTERN, 'table name', 'pollMutationStatus');
  const sql = `
    SELECT
      mutation_id,
      is_done,
      is_killed,
      coalesce(latest_failed_reason, '') AS latest_failed_reason,
      toString(create_time) AS create_time
    FROM system.mutations
    WHERE table = '${table}'
      AND mutation_id = {mutation_id:String}
    ORDER BY create_time DESC
    LIMIT 1
  `;
  const rows = await queryClickHouseJson<MutationStatusRow>(cfg, sql, {
    mutation_id: escapeClickHouseParamValue(mutationId),
  });
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
  // FOLLOW-462: every id/value below is bound as a ClickHouse param instead
  // of quote-escaped and concatenated. Note `clickhouse_mutation_id` can be
  // a comma-joined composite of several mutation ids (see
  // `_finalise.ts` `maybeFinaliseAuditLog`) — parameter binding handles that
  // transparently since the comma is just data, not SQL syntax.
  const completedAtClause = args.completed
    ? `, clickhouse_mutation_completed_at = now64(3, 'UTC')`
    : '';

  const sql = `
    ALTER TABLE dsr_audit_log
    UPDATE
      clickhouse_mutation_id = {mutation_id:String},
      clickhouse_mutation_status = {status:String}
      ${completedAtClause}
    WHERE tenant_id = {tenant_id:String}
      AND session_id = {session_id:String}
      AND dsr_type = 'erase'
      AND action = 'completed'
  `;
  await executeClickHouseSql(cfg, sql, {
    mutation_id: escapeClickHouseParamValue(args.clickhouse_mutation_id),
    status: escapeClickHouseParamValue(args.clickhouse_mutation_status),
    tenant_id: escapeClickHouseParamValue(args.tenant_id),
    session_id: escapeClickHouseParamValue(args.session_id),
  });
}
