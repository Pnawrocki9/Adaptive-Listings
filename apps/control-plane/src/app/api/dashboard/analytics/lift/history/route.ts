/**
 * GET /api/dashboard/analytics/lift/history?tenant_id=<uuid>
 *
 * The newest 90 rows of `lift_daily_snapshots` for one tenant (FOLLOW-1338) — the "History" table
 * of the Pilot tab. Written by `api/cron/lift-snapshot`.
 *
 * Auth: staff-only, any staff rank (a read) — `lib/lift-staff-access`. The validated `?tenant_id`
 * is the single tenant fence (the admin client bypasses RLS).
 *
 * Rule K.2 — provenance and failure: `data_source: 'postgres'` on success (an empty `rows` is a
 * genuinely empty table, not an error); `data_source: 'not_configured'` when no admin database URL
 * is set (dev / CI); 500 `lift_snapshot_table_missing` when the CTO has not yet applied
 * `docs/handover/migrations/0042_lift_daily_snapshots.sql` (SQLSTATE 42P01 — no Sentry here, the
 * cron already raises it daily); any other failure is a 500 `lift_snapshot_read_failed` plus one
 * Sentry capture. Never an empty list standing in for a failed read.
 *
 * @module apps/control-plane/src/app/api/dashboard/analytics/lift/history/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { resolveLiftStaffAccess } from '@/lib/lift-staff-access';
import {
  LIFT_SNAPSHOT_TABLE_MISSING,
  isLiftSnapshotTableMissing,
  liftSnapshotStoreConfigured,
  readLiftSnapshots,
  type LiftHistoryResponse,
} from '@/lib/lift-snapshots';

/**
 * @returns 200 {@link LiftHistoryResponse}; 400/401/403/404 from the staff gate; 500 with
 *   `error.code` `lift_snapshot_table_missing` | `lift_snapshot_read_failed`.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const resolved = await resolveLiftStaffAccess(req);
  if ('error' in resolved) return resolved.error;
  const tenantId = resolved.access.tenantId;

  if (!liftSnapshotStoreConfigured()) {
    const body: LiftHistoryResponse = {
      tenant_id: tenantId,
      data_source: 'not_configured',
      rows: [],
    };
    return NextResponse.json(body);
  }

  try {
    const rows = await readLiftSnapshots(tenantId);
    const body: LiftHistoryResponse = { tenant_id: tenantId, data_source: 'postgres', rows };
    return NextResponse.json(body);
  } catch (err: unknown) {
    if (isLiftSnapshotTableMissing(err)) {
      return NextResponse.json(
        {
          error: {
            code: LIFT_SNAPSHOT_TABLE_MISSING,
            message:
              'lift_daily_snapshots does not exist in this database yet (CTO handover step: ' +
              'docs/handover/migrations/0042_lift_daily_snapshots.sql)',
          },
        },
        { status: 500 },
      );
    }
    Sentry.captureException(err, {
      tags: { route: 'dashboard/analytics/lift/history', tenant_id: tenantId },
    });
    return NextResponse.json(
      {
        error: {
          code: 'lift_snapshot_read_failed',
          message: `Reading lift_daily_snapshots failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      },
      { status: 500 },
    );
  }
}
