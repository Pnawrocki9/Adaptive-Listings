/**
 * GET /api/cron/lift-snapshot
 *
 * Vercel Cron handler (daily, `15 1 * * *` UTC; FOLLOW-1338, ruling D-K). Computes the pilot lift of
 * YESTERDAY (UTC) for the one tenant (`ESTALARA_TENANT_ID`) and UPSERTs one row per arm into
 * `lift_daily_snapshots`, so the lift has a history that is independent of the live reader's rolling
 * window and of the 13-month ClickHouse `events` TTL.
 *
 * **One formula.** The counts come from `fetchLiftDaily` in the lift reader's `route-helpers` — the
 * same conversion definition (server-confirmed `live.signup` / `inquiry.completed`, one session with
 * both = one conversion, browser events excluded) and the same `computeArmLift` as
 * `GET /api/dashboard/analytics/lift`. Nothing here computes a rate.
 *
 * **Auth:** `CRON_SECRET` exactly as the other cron routes — Vercel injects
 * `Authorization: Bearer ${CRON_SECRET}`; compared with `secretEquals` (constant-time); an unset
 * `CRON_SECRET` is 401, never a dev bypass. Replay resistance is structural: the handler is a pure
 * idempotent UPSERT of a deterministic function of already-recorded events for a fixed past day —
 * replaying it any number of times rewrites the same two rows (and moves `computed_at`), and the
 * only thing a replayer can cause is a recomputation.
 *
 * **Fail-loud (Rule K.2):** every failure is a non-2xx with a fixed `error.code` and ONE Sentry
 * capture. Nothing is written when ClickHouse is unset (dev / CI -> 200 `data_source:
 * 'not_configured'`, no row) or when `CALLER_SIGNED_COLUMN_ENABLED` is off (200
 * `conversion_source: 'disabled'`, no row — zero counts would be a lie). Mock data is NEVER stored.
 *
 * **Deployment timing:** the control plane deploys on every merge to main, so until handover row 4
 * flips `CALLER_SIGNED_COLUMN_ENABLED` this route answers 200 `conversion_source: 'disabled'` and
 * never touches Postgres.
 *
 * **Missing table:** once that flag is on and the CTO has not yet applied `docs/handover/migrations/H001_lift_daily_snapshots.sql`
 * the INSERT fails with SQLSTATE 42P01 (`undefined_table`) naming `lift_daily_snapshots`
 * ({@link isLiftSnapshotTableMissing}). That is answered with 500 `lift_snapshot_table_missing` and
 * one Sentry capture — a single bounded request per scheduled run, no retry loop, no other effect.
 *
 * @module apps/control-plane/src/app/api/cron/lift-snapshot/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { secretEquals } from '@/lib/secret-compare';
import { ESTALARA_TENANT_ID } from '@/lib/estalara-tenant';
import {
  LIFT_SNAPSHOT_TABLE_MISSING,
  isLiftSnapshotTableMissing,
  liftSnapshotStoreConfigured,
  upsertLiftSnapshots,
} from '@/lib/lift-snapshots';
import {
  buildLiftDayRows,
  fetchLiftDaily,
  utcDay,
} from '@/app/api/dashboard/analytics/lift/route-helpers';

// ─── Auth ────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // An unset CRON_SECRET is an infrastructure misconfiguration, not a dev/CI bypass: this endpoint
  // writes to Postgres.
  if (!secret) return false;
  const authHeader = req.headers.get('authorization') ?? '';
  const providedToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  return secretEquals(secret, providedToken);
}

// ─── Failure answer: the single Sentry site of this route ────────────────────

function fail(code: string, message: string, err: unknown, day: string): NextResponse {
  Sentry.captureException(err, {
    tags: { cron: 'lift-snapshot', error_code: code },
    extra: { day },
  });
  return NextResponse.json({ error: { code, message } }, { status: 500 });
}

// ─── GET handler ─────────────────────────────────────────────────────────────

/**
 * Snapshot yesterday's (UTC) lift for the one tenant.
 *
 * @returns 200 `{ data_source: 'clickhouse', day, rows_written: 2 }` on success; 200 with
 *   `data_source: 'not_configured'` / `conversion_source: 'disabled'` and `rows_written: 0` when a
 *   dependency is deliberately absent; 401 on a failed auth check; 500 with `error.code`
 *   `lift_snapshot_table_missing` | `clickhouse_query_failed` | `lift_snapshot_write_failed`.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Cron secret invalid' } },
      { status: 401 },
    );
  }

  const day = utcDay(new Date(Date.now() - 86_400_000));

  if (!process.env.CLICKHOUSE_URL || !liftSnapshotStoreConfigured()) {
    // Dependency NOT CONFIGURED (dev / CI) - visible on the wire, nothing written.
    return NextResponse.json({
      data_source: 'not_configured',
      day,
      rows_written: 0,
      note: !process.env.CLICKHOUSE_URL ? 'CLICKHOUSE_URL_unset' : 'DATABASE_URL_ADMIN_unset',
    });
  }

  let daily: Awaited<ReturnType<typeof fetchLiftDaily>>;
  try {
    daily = await fetchLiftDaily(ESTALARA_TENANT_ID, day, day);
  } catch (err: unknown) {
    return fail(
      'clickhouse_query_failed',
      `ClickHouse query failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
      day,
    );
  }
  if (!daily?.callerClass) {
    // `daily === null` cannot happen after the CLICKHOUSE_URL check above; an off flag is a
    // configuration state, not zero conversions (same stance as the live reader).
    return NextResponse.json({
      data_source: 'clickhouse',
      conversion_source: 'disabled',
      day,
      rows_written: 0,
    });
  }

  const rows = buildLiftDayRows(daily.rows, [day]);
  try {
    const written = await upsertLiftSnapshots(ESTALARA_TENANT_ID, rows);
    return NextResponse.json({ data_source: 'clickhouse', day, rows_written: written });
  } catch (err: unknown) {
    if (isLiftSnapshotTableMissing(err)) {
      return fail(
        LIFT_SNAPSHOT_TABLE_MISSING,
        'lift_daily_snapshots does not exist in this database; the CTO applies ' +
          'docs/handover/migrations/H001_lift_daily_snapshots.sql first',
        err,
        day,
      );
    }
    return fail(
      'lift_snapshot_write_failed',
      `Writing lift_daily_snapshots failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
      day,
    );
  }
}
