/**
 * GET /api/cron/quiz-accuracy-watch
 *
 * Vercel Cron handler (monthly, `30 3 1 * *` UTC; FOLLOW-1363, PREREG §7). Recomputes the quiz
 * accuracy report for the one tenant (`ESTALARA_TENANT_ID`, default definition hash) and raises a
 * Sentry WARNING when the PREVIOUS UTC month had at least 100 decided runs and either its Wilson
 * upper bound is below 0.90 or its response rate is below 60 %. The arithmetic is the same
 * `buildQuizAccuracyReport` the staff tab renders - nothing is computed here.
 *
 * **Read-only.** No write, no cache invalidation: the only effect is the warning. Auth is still
 * production grade because the route is public to the internet: `CRON_SECRET` exactly as
 * `cron/lift-snapshot` (Vercel injects `Authorization: Bearer ${CRON_SECRET}`; `secretEquals`
 * constant-time compare; an unset secret is 401, never a dev bypass). Replaying a request can only
 * cause another recomputation and, at worst, a duplicate warning.
 *
 * **Fail-loud (Rule K.2):** a failing read is a 500 `quiz_accuracy_read_failed` plus ONE Sentry
 * exception. DATABASE unset (dev / CI) is a 200 `data_source: 'not_configured'`; `quiz_runs` not yet
 * created (H002 not applied) is a 200 `available: false` - both visible on the wire, neither a
 * silent "no warning".
 *
 * @module apps/control-plane/src/app/api/cron/quiz-accuracy-watch/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@estalara/db';
import { secretEquals } from '@/lib/secret-compare';
import { ESTALARA_TENANT_ID } from '@/lib/estalara-tenant';
import { liftSnapshotStoreConfigured } from '@/lib/lift-snapshots';
import { buildQuizAccuracyReport } from '@/lib/quiz-accuracy';
import { readQuizAccuracyData } from '@/lib/quiz-runs';

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = req.headers.get('authorization') ?? '';
  const providedToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  return secretEquals(secret, providedToken);
}

/** `YYYY-MM` (UTC) of the month before `now`. */
function previousUtcMonth(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

/**
 * @returns 200 `{ data_source: 'quiz_runs', month, warned, ... }`; 200 `data_source:
 *   'not_configured'` / `available: false` when a dependency is deliberately absent; 401 on a failed
 *   auth check; 500 `quiz_accuracy_read_failed`.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Cron secret invalid' } },
      { status: 401 },
    );
  }
  const month = previousUtcMonth(new Date());
  if (!liftSnapshotStoreConfigured()) {
    return NextResponse.json({
      data_source: 'not_configured',
      month,
      warned: false,
      note: 'DATABASE_URL_ADMIN_unset',
    });
  }

  try {
    const data = await readQuizAccuracyData(createAdminClient(), ESTALARA_TENANT_ID, {
      from: null,
      to: null,
      definitionHash: null,
      language: null,
    });
    if (!data.available) {
      return NextResponse.json({
        data_source: 'quiz_runs',
        available: false,
        code: 'quiz_runs_table_missing',
        month,
        warned: false,
      });
    }
    const report = buildQuizAccuracyReport({
      definitionHash: data.definitionHash,
      hashes: data.hashes,
      runs: data.runs,
      funnelRows: data.funnelRows,
      filters: { from: null, to: null, language: null },
    });
    const row = report.monthly.find((m) => m.month === month);
    const warn = row?.warn;
    const warned = Boolean(warn && (warn.upper_bound_below_target || warn.response_rate_below_min));
    if (row && warn && warned) {
      Sentry.captureMessage('quiz accuracy monthly warning', {
        level: 'warning',
        tags: { cron: 'quiz-accuracy-watch', month },
        extra: {
          definition_hash: report.definition_hash,
          decided: row.decided,
          accuracy: row.accuracy,
          wilson95: row.wilson95,
          response_rate: row.response_rate,
          upper_bound_below_target: warn.upper_bound_below_target,
          response_rate_below_min: warn.response_rate_below_min,
        },
      });
    }
    return NextResponse.json({
      data_source: 'quiz_runs',
      available: true,
      month,
      decided: row?.decided ?? 0,
      warned,
    });
  } catch (err: unknown) {
    Sentry.captureException(err, {
      tags: { cron: 'quiz-accuracy-watch', error_code: 'quiz_accuracy_read_failed' },
      extra: { month },
    });
    return NextResponse.json(
      {
        error: {
          code: 'quiz_accuracy_read_failed',
          message: 'Reading quiz_runs for the accuracy watch failed',
        },
      },
      { status: 500 },
    );
  }
}
