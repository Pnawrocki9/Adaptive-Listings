/**
 * Postgres access for `lift_daily_snapshots` (FOLLOW-1338, ruling D-K): the daily history of the
 * pilot lift, written by `api/cron/lift-snapshot` and read by `api/dashboard/analytics/lift/history`.
 *
 * This is a typed query helper rather than a drizzle schema file ON PURPOSE. The table is created by
 * `docs/handover/migrations/0042_lift_daily_snapshots.sql`, which the CTO applies to production by
 * hand (CEO ruling 2026-10-19: `.github/workflows/db-migrate.yml` applies every file under
 * `packages/db/migrations/**` to the live database on each push to `main`, so the file cannot live
 * there). A schema file in `@estalara/db` without a matching migration would claim a table the
 * database does not have.
 *
 * Every query is bound to ONE tenant id passed by the caller (the cron: the constant tenant; the
 * history route: the id `resolveTenantAccess` validated). The admin client bypasses RLS, so that
 * `WHERE tenant_id = …` is the fence (ADR-0018 §2 invariant 5).
 *
 * @module apps/control-plane/src/lib/lift-snapshots
 */

import { sql } from 'drizzle-orm';
import { createAdminClient } from '@estalara/db';
import type { LiftArm, LiftDayRow } from '@/app/api/dashboard/analytics/lift/route-helpers';

/** Wire code for "the table has not been created in this database yet" (Rule K.2: loud, not empty). */
export const LIFT_SNAPSHOT_TABLE_MISSING = 'lift_snapshot_table_missing';

/** Rows the History table shows at most. */
const LIFT_HISTORY_ROW_LIMIT = 90;

const TABLE = 'lift_daily_snapshots';
/** SQLSTATE `undefined_table`. */
const PG_UNDEFINED_TABLE = '42P01';

/** Whether the admin database URL is configured (dev / CI have none). */
export function liftSnapshotStoreConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT);
}

/**
 * True when `err` (or anything in its `cause` chain) is Postgres `undefined_table` for THIS table.
 * Drizzle wraps the driver error as `DrizzleQueryError` with the original in `cause`, and the
 * original carries `code`. The table name must also appear in the chain's messages, so a missing
 * `tenants` table (the FK target) is not mistaken for a missing snapshot table.
 */
export function isLiftSnapshotTableMissing(err: unknown): boolean {
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

/** Rows of a raw `db.execute()` result: postgres-js returns the array, PGlite `{ rows }`. */
function executedRows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  const rows = (result as { rows?: unknown } | null)?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

/**
 * UPSERT one tenant's rows on the unique key (tenant_id, day, arm). Idempotent: a second run for the
 * same day overwrites the figures and moves `computed_at`; it never adds a row.
 *
 * @returns the number of rows written.
 * @throws whatever the driver throws — including `undefined_table` ({@link isLiftSnapshotTableMissing}).
 */
export async function upsertLiftSnapshots(
  tenantId: string,
  rows: readonly LiftDayRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const db = createAdminClient();
  const tuples = rows.map(
    (r) =>
      sql`(${tenantId}::uuid, ${r.day}::date, ${r.arm}::text, ${r.sessions}::integer,
           ${r.conversions}::integer, ${r.live_signups}::integer, ${r.agent_contacts}::integer,
           ${r.relative_lift_pct}::double precision, ${r.p_value}::double precision,
           ${r.confidence}::text)`,
  );
  await db.execute(sql`
    insert into lift_daily_snapshots
      (tenant_id, day, arm, sessions, conversions, live_signups, agent_contacts,
       relative_lift_pct, p_value, confidence)
    values ${sql.join(tuples, sql`, `)}
    on conflict (tenant_id, day, arm) do update set
      sessions          = excluded.sessions,
      conversions       = excluded.conversions,
      live_signups      = excluded.live_signups,
      agent_contacts    = excluded.agent_contacts,
      relative_lift_pct = excluded.relative_lift_pct,
      p_value           = excluded.p_value,
      confidence        = excluded.confidence,
      computed_at       = now()
  `);
  return rows.length;
}

/** One stored snapshot row as the History table shows it. */
interface LiftSnapshotRow extends LiftDayRow {
  /** ISO instant the figures were last computed. */
  computed_at: string;
}

/** Body of `GET /api/dashboard/analytics/lift/history`. */
export interface LiftHistoryResponse {
  tenant_id: string;
  /** 'postgres' - read from the table; 'not_configured' - no admin database URL (dev / CI). */
  data_source: 'postgres' | 'not_configured';
  rows: LiftSnapshotRow[];
}

/**
 * The newest {@link LIFT_HISTORY_ROW_LIMIT} rows of one tenant, newest day first (adapted before
 * holdout within a day).
 *
 * @throws whatever the driver throws — including `undefined_table` ({@link isLiftSnapshotTableMissing}).
 */
export async function readLiftSnapshots(tenantId: string): Promise<LiftSnapshotRow[]> {
  const db = createAdminClient();
  const result: unknown = await db.execute(sql`
    select to_char(day, 'YYYY-MM-DD') as day, arm, sessions, conversions, live_signups,
           agent_contacts, relative_lift_pct, p_value, confidence,
           to_char(computed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as computed_at
    from lift_daily_snapshots
    where tenant_id = ${tenantId}::uuid
    order by day desc, arm asc
    limit ${LIFT_HISTORY_ROW_LIMIT}
  `);
  return executedRows(result).map(
    (r): LiftSnapshotRow => ({
      day: String(r.day),
      arm: r.arm as LiftArm,
      sessions: Number(r.sessions),
      conversions: Number(r.conversions),
      live_signups: Number(r.live_signups),
      agent_contacts: Number(r.agent_contacts),
      relative_lift_pct: r.relative_lift_pct === null ? null : Number(r.relative_lift_pct),
      p_value: Number(r.p_value),
      confidence: r.confidence as LiftDayRow['confidence'],
      computed_at: String(r.computed_at),
    }),
  );
}
