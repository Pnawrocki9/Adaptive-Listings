/**
 * Postgres access for `quiz_runs` (FOLLOW-1358, plan Faza Q package Q3, ESC-086 items 2 and 6,
 * MASTER_DESIGN §E.4.8 v3.0): one row per quiz shown to a buyer, written by `POST /api/quiz/run`,
 * disclosed and erased by the DSR routes, read by the accuracy report (FOLLOW-1363).
 *
 * A typed raw-SQL helper rather than a drizzle schema file ON PURPOSE, exactly like
 * `lib/lift-snapshots.ts`: the table is created by `docs/handover/migrations/H002_quiz_runs.sql`,
 * which the CTO applies to production by hand (CEO ruling 2026-10-18 — `db-migrate.yml` applies
 * every file under `packages/db/migrations/**` to the live database on each push to `main`). A
 * schema file in `@estalara/db` without a matching migration would claim a table the database does
 * not have — and drizzle inserts every schema column, so a missing column would lose writes.
 *
 * Every statement is bound to ONE tenant id passed by the caller — the tenant of the authenticated
 * API key (`POST /api/quiz/run`) or of the verified DSR request. The admin client bypasses RLS, so
 * that `WHERE tenant_id = …` is the fence (ADR-0018 §2 invariant 5). A body-supplied tenant id is
 * never written.
 *
 * Missing table (SQLSTATE 42P01, H002 not applied yet):
 *   - the write path throws {@link QuizRunsTableMissingError}; the route answers 503
 *     `quiz_runs_table_missing` and captures it to Sentry (Rule K.2 — loud, never an empty 200);
 *   - the DSR paths tolerate it for THIS table only (a table that does not exist holds no personal
 *     data), log it once per process and continue. Any other error propagates.
 *
 * @module apps/control-plane/src/lib/quiz-runs
 */

import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { QUIZ_RUN_MAX_MS } from '@estalara/shared';
import type { QuizRunPing } from '@estalara/shared';
import { N_REQUIRED } from '@/lib/quiz-accuracy';
import type { AccuracyRun, FunnelGroupRow, HashSummary, WindowCount } from '@/lib/quiz-accuracy';

/** Wire code for "H002 has not been applied to this database yet" (Rule K.2: loud, not empty). */
export const QUIZ_RUNS_TABLE_MISSING = 'quiz_runs_table_missing';

const TABLE = 'quiz_runs';
/** SQLSTATE `undefined_table`. */
const PG_UNDEFINED_TABLE = '42P01';
/** Timings are stored in steps of this many milliseconds (ESC-086: "rounded and capped"). */
const TIMING_STEP_MS = 100;

/** The part of a drizzle database / transaction this module needs. */
interface SqlExecutor {
  execute(query: SQL): PromiseLike<unknown>;
}

/** A drizzle transaction: nested `transaction()` opens a SAVEPOINT. */
interface SavepointExecutor extends SqlExecutor {
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>;
}

/** Thrown by {@link recordQuizRunEvent} when `quiz_runs` does not exist (SQLSTATE 42P01). */
export class QuizRunsTableMissingError extends Error {
  /** Always {@link QUIZ_RUNS_TABLE_MISSING}; the route puts it on the wire. */
  readonly code = QUIZ_RUNS_TABLE_MISSING;

  /**
   * Deliberately keeps NO `cause`: the driver error's message carries the failed query and its
   * params (session_id, answers), and error sinks serialise the cause chain (FOLLOW-1358 C1).
   */
  constructor() {
    super('quiz_runs does not exist: apply docs/handover/migrations/H002_quiz_runs.sql');
    this.name = 'QuizRunsTableMissingError';
  }
}

/**
 * True when `err` (or anything in its `cause` chain) is Postgres `undefined_table` for THIS table.
 * Drizzle wraps the driver error with the original in `cause`, and the original carries `code`. The
 * table name must also appear in the chain's messages, so a missing `tenants` table (the FK target)
 * is not mistaken for a missing `quiz_runs`.
 */
export function isQuizRunsTableMissing(err: unknown): boolean {
  let code = false;
  let named = false;
  let cursor: unknown = err;
  for (let depth = 0; depth < 4 && cursor !== null && typeof cursor === 'object'; depth++) {
    const e = cursor as { code?: unknown; message?: unknown; cause?: unknown };
    if (e.code === PG_UNDEFINED_TABLE) code = true;
    if (typeof e.message === 'string' && e.message.includes(TABLE)) named = true;
    cursor = e.cause;
  }
  return code && named;
}

let missingTableLogged = false;

/** The DSR paths' "log once, continue" for a missing `quiz_runs` (one line per process). */
function logMissingTableOnce(where: string): void {
  if (missingTableLogged) return;
  missingTableLogged = true;
  console.warn(
    `[${where}] quiz_runs does not exist (H002 not applied) - treated as holding no rows. ` +
      'Apply docs/handover/migrations/H002_quiz_runs.sql (CTO_HANDOVER.md section 4).',
  );
}

/** Rows of a raw `execute()` result: postgres-js returns the array, PGlite `{ rows }`. */
function executedRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/** Round to {@link TIMING_STEP_MS} and clamp to `[0, QUIZ_RUN_MAX_MS]` (server-side, whatever the body). */
function roundTiming(ms: number): number {
  const rounded = Math.round(ms / TIMING_STEP_MS) * TIMING_STEP_MS;
  return Math.min(QUIZ_RUN_MAX_MS, Math.max(0, rounded));
}

/** `jsonb` parameter, or SQL NULL when the field is absent. */
function jsonOrNull(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

/**
 * The status rank the state machine compares: shown 0 → dismissed 1 | completed 2 → the three
 * confirmation outcomes 3. Rendered once as SQL so the INSERT and the guard cannot disagree.
 */
function statusRank(column: SQL): SQL {
  return sql`(case ${column} when 'shown' then 0 when 'dismissed' then 1 when 'completed' then 2 else 3 end)`;
}

/**
 * Fold one SDK ping into the run's row — a forward-only state machine, in ONE SQL statement.
 *
 * - First ping of a run (no row with this id): the row is inserted at the ping's status, whatever it
 *   is — a lost `shown` ping must not cost the `completed` one (pings are fire-and-forget).
 * - Later pings move the row only FORWARD and only from a non-terminal status:
 *   `shown → dismissed`, `shown → completed`, `shown | completed → confirmed | corrected |
 *   unconfirmed`. `dismissed` and the three confirmation outcomes are terminal, so the FIRST
 *   terminal status wins. A replay (same status), a backward step (`completed → dismissed`) or a
 *   move out of a terminal status changes nothing and returns `applied: false`.
 * - The update is fenced on the row's own tenant AND session: a foreign tenant or session reusing a
 *   run id changes nothing.
 * - An accepted update keeps every value the row already has unless the ping carries a new one
 *   (`COALESCE`), so a sparse later ping never erases what an earlier one recorded.
 * - Timings are rounded to 100 ms and capped at {@link QUIZ_RUN_MAX_MS} here, whatever the body says.
 *
 * @param db - the admin client (or a test engine); bypasses RLS, hence the explicit fence.
 * @param tenantId - the tenant of the authenticated API key. The body's `tenant_id` is not used.
 * @param ping - a body validated by `QuizRunPingSchema`.
 * @returns `applied: true` when a row was inserted or moved forward.
 * @throws {QuizRunsTableMissingError} when H002 has not been applied; any other driver error as is.
 */
export async function recordQuizRunEvent(
  db: SqlExecutor,
  tenantId: string,
  ping: QuizRunPing,
): Promise<{ applied: boolean }> {
  const stepMs =
    ping.step_ms === undefined ? null : `{${ping.step_ms.map((v) => roundTiming(v)).join(',')}}`;
  const resultMs = ping.result_ms === undefined ? null : roundTiming(ping.result_ms);
  const existing = sql.raw('r.status');
  const incoming = sql.raw('excluded.status');

  let result: unknown;
  try {
    result = await db.execute(sql`
      insert into quiz_runs as r
        (id, tenant_id, session_id, language, definition_hash, definition_version, sdk_version,
         status, last_step, resolved_archetype, answer_path, traits, step_ms, result_ms, offered,
         confirmed_archetype)
      values (
        ${ping.quiz_run_id}::uuid, ${tenantId}::uuid, ${ping.session_id}::text,
        ${ping.language ?? null}::text, ${ping.definition_hash ?? null}::text,
        ${ping.definition_version ?? null}::integer, ${ping.sdk_version ?? null}::text,
        ${ping.event}::text, ${ping.last_step ?? null}::integer,
        ${ping.resolved_archetype ?? null}::text, ${jsonOrNull(ping.answer_path)}::jsonb,
        ${jsonOrNull(ping.traits)}::jsonb, ${stepMs}::integer[], ${resultMs}::integer,
        ${jsonOrNull(ping.offered)}::jsonb, ${ping.confirmed_archetype ?? null}::text)
      on conflict (id) do update set
        status              = excluded.status,
        language            = coalesce(excluded.language, r.language),
        definition_hash     = coalesce(excluded.definition_hash, r.definition_hash),
        definition_version  = coalesce(excluded.definition_version, r.definition_version),
        sdk_version         = coalesce(excluded.sdk_version, r.sdk_version),
        last_step           = coalesce(excluded.last_step, r.last_step),
        resolved_archetype  = coalesce(excluded.resolved_archetype, r.resolved_archetype),
        answer_path         = coalesce(excluded.answer_path, r.answer_path),
        traits              = coalesce(excluded.traits, r.traits),
        step_ms             = coalesce(excluded.step_ms, r.step_ms),
        result_ms           = coalesce(excluded.result_ms, r.result_ms),
        offered             = coalesce(excluded.offered, r.offered),
        confirmed_archetype = coalesce(excluded.confirmed_archetype, r.confirmed_archetype),
        updated_at          = now()
      where r.tenant_id = excluded.tenant_id
        and r.session_id = excluded.session_id
        and r.status in ('shown', 'completed')
        and ${statusRank(existing)} < ${statusRank(incoming)}
      returning r.id
    `);
  } catch (err: unknown) {
    if (isQuizRunsTableMissing(err)) throw new QuizRunsTableMissingError();
    throw err;
  }
  return { applied: executedRows(result).length > 0 };
}

/**
 * DSR erase (Art. 17): delete one subject's runs on (tenant_id, session_id), inside the caller's
 * erase transaction. Runs in a SAVEPOINT so that a missing table (42P01) — tolerated for THIS table
 * only — rolls back just the savepoint and the rest of the cascade commits; any other error
 * propagates and aborts the erase. An empty `sessionId` never matches rows wholesale.
 *
 * @returns the number of rows deleted, or `'table_missing'` when H002 is not applied.
 */
export async function eraseQuizRunsForSession(
  tx: SavepointExecutor,
  tenantId: string,
  sessionId: string,
): Promise<number | 'table_missing'> {
  if (sessionId === '') return 0;
  try {
    return await tx.transaction(async (sp) => {
      const result = await sp.execute(sql`
        delete from quiz_runs
        where tenant_id = ${tenantId}::uuid and session_id = ${sessionId}::text and session_id <> ''
        returning id
      `);
      return executedRows(result).length;
    });
  } catch (err: unknown) {
    if (!isQuizRunsTableMissing(err)) throw err;
    logMissingTableOnce('dsr/erase');
    return 'table_missing';
  }
}

/** One `quiz_runs` row as the DSR access and portability reports disclose it. */
interface QuizRunDisclosure {
  id: string;
  status: string;
  language: string | null;
  definition_hash: string | null;
  definition_version: number | null;
  sdk_version: string | null;
  last_step: number | null;
  resolved_archetype: string | null;
  answer_path: unknown;
  traits: unknown;
  step_ms: number[] | null;
  result_ms: number | null;
  offered: unknown;
  confirmed_archetype: string | null;
  shown_at: string;
  updated_at: string;
}

/** postgres-js returns jsonb parsed; a driver that hands back text gets parsed here. */
function jsonValue(v: unknown): unknown {
  if (typeof v !== 'string') return v ?? null;
  try {
    return JSON.parse(v) as unknown;
  } catch {
    return v;
  }
}

/**
 * DSR access / portability (Art. 15 / 20): every run of one subject on (tenant_id, session_id),
 * oldest first. A missing table (42P01) is tolerated for THIS table only and reads as no rows.
 */
export async function readQuizRunsForSession(
  db: SqlExecutor,
  tenantId: string,
  sessionId: string,
): Promise<QuizRunDisclosure[]> {
  if (sessionId === '') return [];
  let result: unknown;
  try {
    result = await db.execute(sql`
      select id::text as id, status, language, definition_hash, definition_version, sdk_version,
             last_step, resolved_archetype, answer_path, traits, step_ms, result_ms, offered,
             confirmed_archetype,
             to_char(shown_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as shown_at,
             to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at
      from quiz_runs
      where tenant_id = ${tenantId}::uuid and session_id = ${sessionId}::text
      order by shown_at asc, id asc
    `);
  } catch (err: unknown) {
    if (!isQuizRunsTableMissing(err)) throw err;
    logMissingTableOnce('dsr/access');
    return [];
  }
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  return executedRows(result).map(
    (r): QuizRunDisclosure => ({
      id: String(r.id),
      status: String(r.status),
      language: str(r.language),
      definition_hash: str(r.definition_hash),
      definition_version: num(r.definition_version),
      sdk_version: str(r.sdk_version),
      last_step: num(r.last_step),
      resolved_archetype: str(r.resolved_archetype),
      answer_path: jsonValue(r.answer_path),
      traits: jsonValue(r.traits),
      step_ms: Array.isArray(r.step_ms) ? r.step_ms.map(Number) : null,
      result_ms: num(r.result_ms),
      offered: jsonValue(r.offered),
      confirmed_archetype: str(r.confirmed_archetype),
      shown_at: String(r.shown_at),
      updated_at: String(r.updated_at),
    }),
  );
}

/**
 * Staff read (FOLLOW-1362 C4): the `definition_version` each session's quiz was SERVED with, so
 * the completions viewer can resolve answer indexes against the definition the buyer actually saw.
 * One entry per session (the newest run that carries a version). A missing table (42P01) reads as
 * `available: false` with no versions - never an error (the viewer then falls back to the active
 * definition and marks the row "approximate").
 */
export async function readQuizRunVersionsForSessions(
  db: SqlExecutor,
  tenantId: string,
  sessionIds: readonly string[],
): Promise<{ available: boolean; versions: Map<string, number> }> {
  const versions = new Map<string, number>();
  const ids = [...new Set(sessionIds)].filter((s) => s !== '');
  if (ids.length === 0) return { available: true, versions };
  let result: unknown;
  try {
    result = await db.execute(sql`
      select distinct on (session_id) session_id, definition_version
      from quiz_runs
      where tenant_id = ${tenantId}::uuid
        and session_id in (${sql.join(
          ids.map((id) => sql`${id}::text`),
          sql`, `,
        )})
        and definition_version is not null
      order by session_id, shown_at desc
    `);
  } catch (err: unknown) {
    if (!isQuizRunsTableMissing(err)) throw err;
    logMissingTableOnce('admin/quiz-completions');
    return { available: false, versions };
  }
  for (const r of executedRows(result)) {
    if (typeof r.session_id === 'string' && r.definition_version !== null) {
      versions.set(r.session_id, Number(r.definition_version));
    }
  }
  return { available: true, versions };
}

/** One dismissed run, as the drop-off table needs it. */
interface DismissedQuizRun {
  last_step: number | null;
  answer_path: unknown;
  definition_version: number | null;
}

/** The run funnel of one tenant: counts per final status plus the dismissed runs' positions. */
type QuizRunFunnel =
  | { available: false }
  | { available: true; counts: Record<string, number>; dismissed: DismissedQuizRun[] };

/** The most recent dismissed runs read for the drop-off table (bounds the payload). */
const DISMISSED_SAMPLE = 5000;

/**
 * Staff read (FOLLOW-1362 C4): final-status counts of every `quiz_runs` row of the tenant and the
 * newest {@link DISMISSED_SAMPLE} dismissed runs. A missing table (42P01) is `available: false`.
 */
export async function readQuizRunFunnel(db: SqlExecutor, tenantId: string): Promise<QuizRunFunnel> {
  let counted: unknown;
  let dismissedRows: unknown;
  try {
    counted = await db.execute(sql`
      select status, count(*)::int as cnt from quiz_runs
      where tenant_id = ${tenantId}::uuid group by status
    `);
    dismissedRows = await db.execute(sql`
      select last_step, answer_path, definition_version from quiz_runs
      where tenant_id = ${tenantId}::uuid and status = 'dismissed'
      order by shown_at desc limit ${DISMISSED_SAMPLE}
    `);
  } catch (err: unknown) {
    if (!isQuizRunsTableMissing(err)) throw err;
    logMissingTableOnce('admin/quiz-analytics');
    return { available: false };
  }
  const counts: Record<string, number> = {};
  for (const r of executedRows(counted)) counts[String(r.status)] = Number(r.cnt);
  const optNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  return {
    available: true,
    counts,
    dismissed: executedRows(dismissedRows).map((r) => ({
      last_step: optNum(r.last_step),
      answer_path: jsonValue(r.answer_path),
      definition_version: optNum(r.definition_version),
    })),
  };
}

/** Filters of the accuracy read; `null` = unfiltered. `from` inclusive, `to` exclusive (ISO). */
interface QuizAccuracyFilters {
  from: string | null;
  to: string | null;
  definitionHash: string | null;
  language: string | null;
  /**
   * Default-hash rule when `definitionHash` is null: the hash with the most decided rows (the
   * report), or the most recently shown one (the monthly watch).
   */
  preferRecentHash?: boolean;
}

/** What the accuracy report is computed from (see `buildQuizAccuracyReport`). */
type QuizAccuracyData =
  | { available: false }
  | {
      available: true;
      /** The hash the rows below belong to; `null` when the tenant has no hashed run in range. */
      definitionHash: string | null;
      hashes: HashSummary[];
      runs: AccuracyRun[];
      funnelRows: FunnelGroupRow[];
      /** Analysis-window counts for the response rate and the pessimistic variant (A1). */
      windowCounts: WindowCount[];
      /** True when more than {@link ACCURACY_ROW_CAP} runs matched; only the oldest are returned. */
      truncated: boolean;
    };

/** Upper bound on the runs read for one report (decision order; the verdict needs only 400). */
const ACCURACY_ROW_CAP = 20_000;

/**
 * Staff read (FOLLOW-1363): the rows behind the quiz-accuracy report of ONE definition hash.
 *
 * Eligibility is PREREG §2: `status` confirmed / corrected, `resolved_archetype` not null and not `neutral`, one `definition_hash`
 * (the requested one, else the hash with the most decided rows in range), fenced to the tenant.
 * `quiz_runs` carries no staff / ops-key marker, so staff traffic cannot be excluded row by row:
 * only the tenant-level exclusion is implemented (the harness tenant is another tenant id, so it
 * never enters this tenant's read). Staff / ops-key sessions on the production tenant would need a
 * marker column on H002 - not available, reported as a limitation of the report.
 *
 * A missing table (42P01) is `available: false` - never an error, never an empty report.
 */
export async function readQuizAccuracyData(
  db: SqlExecutor,
  tenantId: string,
  filters: QuizAccuracyFilters,
): Promise<QuizAccuracyData> {
  const inRange = sql`(${filters.from}::timestamptz is null or shown_at >= ${filters.from}::timestamptz)
        and (${filters.to}::timestamptz is null or shown_at < ${filters.to}::timestamptz)`;
  const decidedNonNeutral = sql`status in ('confirmed', 'corrected')
        and resolved_archetype is not null and resolved_archetype <> 'neutral'`;
  let hashResult: unknown;
  try {
    hashResult = await db.execute(sql`
      select definition_hash as hash, max(definition_version)::int as version,
             count(*) filter (where ${decidedNonNeutral})::int as n,
             rank() over (order by max(shown_at) desc)::int as recency
      from quiz_runs
      where tenant_id = ${tenantId}::uuid and definition_hash is not null and ${inRange}
      group by definition_hash
      order by n desc, recency
    `);
  } catch (err: unknown) {
    if (!isQuizRunsTableMissing(err)) throw err;
    logMissingTableOnce('admin/quiz-accuracy');
    return { available: false };
  }
  const hashes: HashSummary[] = executedRows(hashResult).map((r) => ({
    hash: String(r.hash),
    version: r.version === null || r.version === undefined ? null : Number(r.version),
    n: Number(r.n),
  }));
  const rows0 = executedRows(hashResult);
  const recent = rows0.find((r) => Number(r.recency) === 1);
  const defaultHash = filters.preferRecentHash
    ? (recent?.hash as string | undefined)
    : hashes[0]?.hash;
  const definitionHash = filters.definitionHash ?? defaultHash ?? null;
  if (definitionHash === null) {
    return {
      available: true,
      definitionHash,
      hashes,
      runs: [],
      funnelRows: [],
      windowCounts: [],
      truncated: false,
    };
  }

  const scope = sql`tenant_id = ${tenantId}::uuid and definition_hash = ${definitionHash}::text
        and (${filters.language}::text is null or language = ${filters.language}::text)
        and ${inRange}`;
  let funnelResult: unknown;
  let runResult: unknown;
  let cutoffResult: unknown;
  let windowResult: unknown;
  try {
    funnelResult = await db.execute(sql`
      select to_char(shown_at at time zone 'UTC', 'YYYY-MM') as month, status,
             coalesce(resolved_archetype = 'neutral', false) as neutral,
             case when status = 'dismissed' then last_step end as last_step,
             count(*)::int as cnt
      from quiz_runs
      where ${scope}
      group by 1, 2, 3, 4
    `);
    runResult = await db.execute(sql`
      select status, resolved_archetype, confirmed_archetype, language,
             to_char(shown_at at time zone 'UTC', 'YYYY-MM') as month,
             (select sum(x) from unnest(step_ms) as x)::int as step_total_ms, result_ms
      from quiz_runs
      where ${scope}
        and ${decidedNonNeutral}
      order by updated_at asc, id asc
      limit ${ACCURACY_ROW_CAP + 1}
    `);
    // Decision time of the 400th decided row (A3): `updated_at` freezes at the terminal
    // transition because the upsert's WHERE blocks later updates. Text keeps microseconds.
    cutoffResult = await db.execute(sql`
      select updated_at::text as ts, id::text as id from quiz_runs
      where ${scope} and ${decidedNonNeutral}
      order by updated_at asc, id asc
      offset ${N_REQUIRED - 1} limit 1
    `);
    const cutoff = executedRows(cutoffResult)[0];
    // Analysis window (A1): non-neutral runs that reached the result screen with a decision (or
    // last-status) time at or before the cutoff; every such run when fewer than 400 are decided.
    windowResult = await db.execute(sql`
      select status, count(*)::int as cnt from quiz_runs
      where ${scope}
        and status in ('completed', 'confirmed', 'corrected', 'unconfirmed')
        and resolved_archetype is not null and resolved_archetype <> 'neutral'
        and (${cutoff ? String(cutoff.ts) : null}::timestamptz is null
             or (updated_at, id) <= (${cutoff ? String(cutoff.ts) : null}::timestamptz,
                                     ${cutoff ? String(cutoff.id) : null}::uuid))
      group by status
    `);
  } catch (err: unknown) {
    if (!isQuizRunsTableMissing(err)) throw err;
    logMissingTableOnce('admin/quiz-accuracy');
    return { available: false };
  }
  const optNum = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  const optStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
  const rows = executedRows(runResult);
  const truncated = rows.length > ACCURACY_ROW_CAP;
  return {
    available: true,
    definitionHash,
    hashes,
    truncated,
    windowCounts: executedRows(windowResult).map((r) => ({
      status: String(r.status) as WindowCount['status'],
      count: Number(r.cnt),
    })),
    funnelRows: executedRows(funnelResult).map((r) => ({
      month: String(r.month),
      status: String(r.status),
      neutral: r.neutral === true,
      last_step: optNum(r.last_step),
      count: Number(r.cnt),
    })),
    runs: rows.slice(0, ACCURACY_ROW_CAP).map(
      (r): AccuracyRun => ({
        status: String(r.status) as AccuracyRun['status'],
        resolved_archetype: String(r.resolved_archetype),
        confirmed_archetype: optStr(r.confirmed_archetype),
        language: optStr(r.language),
        month: String(r.month),
        step_total_ms: optNum(r.step_total_ms),
        result_ms: optNum(r.result_ms),
      }),
    ),
  };
}
