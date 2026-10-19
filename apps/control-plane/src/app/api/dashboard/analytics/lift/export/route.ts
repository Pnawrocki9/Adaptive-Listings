/**
 * GET /api/dashboard/analytics/lift/export?window=<7|14|30|90>&tenant_id=<uuid>
 *
 * CSV export of the Pilot tab's lift report (FOLLOW-1338, ruling D-K): a summary block for the
 * rolling window plus the daily trend, as one flat `text/csv` table (columns in `lib/lift-csv`).
 * `Content-Disposition: attachment; filename="lift-<tenant>-<window>d-<date>.csv"`.
 *
 * Auth (ADR-0018 §2): `resolveTenantAccess` with `allowStaffOverride`, staff only (a non-staff
 * caller is 401 since FOLLOW-1335). A read, so any staff rank including `estalara:readonly` may export; the validated
 * `?tenant_id` is the single tenant fence bound into the ClickHouse queries.
 *
 * One formula: the summary block is `buildResponseFromRaw` over `fetchLiftRaw` — the live reader's
 * own code path — and the daily rows are `buildLiftDayRows` over `fetchLiftDaily`, the function the
 * snapshot cron uses. Nothing is computed here.
 *
 * Rule K.2 — fail loud: when CLICKHOUSE_URL is set and a query fails the response is a JSON 500
 * (never a CSV with zeros) plus a Sentry capture. When CLICKHOUSE_URL is unset (dev / CI) the summary
 * is the reader's deterministic mock, tagged `data_source=mock` in EVERY row, and the daily block is
 * empty (no mock trend is invented).
 *
 * @module apps/control-plane/src/app/api/dashboard/analytics/lift/export/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { resolveLiftStaffAccess } from '@/lib/lift-staff-access';
import { buildLiftCsv } from '@/lib/lift-csv';
import {
  buildLiftDayRows,
  buildMockRaw,
  buildResponseFromRaw,
  fetchLiftDaily,
  fetchLiftRaw,
  parseWindowDays,
  utcDay,
  utcDaysEndingAt,
  type ChRawData,
  type LiftDayRow,
} from '../route-helpers';

const EXPORT_WINDOWS = ['7', '14', '30', '90'] as const;

/**
 * @returns 200 `text/csv` attachment; 400 on an unknown `window` or a staff call without
 *   `tenant_id`; 401 no session; 403 non-staff; 404 unknown tenant; 500 when ClickHouse is
 *   configured and a query fails.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const resolved = await resolveLiftStaffAccess(req);
  if ('error' in resolved) return resolved.error;
  const tenantId = resolved.access.tenantId;

  const windowParam = req.nextUrl.searchParams.get('window');
  if (windowParam !== null && !(EXPORT_WINDOWS as readonly string[]).includes(windowParam)) {
    return NextResponse.json(
      { error: { code: 'invalid_window', message: 'window must be one of 7, 14, 30, 90' } },
      { status: 400 },
    );
  }
  const windowDays = parseWindowDays(windowParam);
  const now = new Date();
  const days = utcDaysEndingAt(now, windowDays);

  let report: ReturnType<typeof buildResponseFromRaw>;
  let daily: LiftDayRow[] = [];
  if (!process.env.CLICKHOUSE_URL) {
    report = buildResponseFromRaw(tenantId, windowDays, buildMockRaw(tenantId, windowDays), 'mock');
  } else {
    try {
      const raw: ChRawData | null = await fetchLiftRaw(tenantId, windowDays);
      report = buildResponseFromRaw(
        tenantId,
        windowDays,
        raw ?? { groups: [], archetypes: [], funnel: [], callerClass: false },
        'clickhouse',
      );
      const perDay = await fetchLiftDaily(tenantId, days[0] ?? utcDay(now), utcDay(now));
      if (perDay?.callerClass) daily = buildLiftDayRows(perDay.rows, days);
    } catch (err: unknown) {
      Sentry.captureException(err, {
        tags: { route: 'dashboard/analytics/lift/export', tenant_id: tenantId },
        extra: { window_days: windowDays },
      });
      return NextResponse.json(
        {
          error: {
            code: 'clickhouse_query_failed',
            message: `ClickHouse query failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        },
        { status: 500 },
      );
    }
  }

  return new NextResponse(buildLiftCsv(report, daily), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="lift-${tenantId}-${String(windowDays)}d-${utcDay(now)}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
