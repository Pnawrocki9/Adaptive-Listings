/**
 * GET /api/cron/quiz-retention
 *
 * Vercel Cron handler (daily, `15 4 * * *` UTC; FOLLOW-1364, ESC-086 condition C6). Deletes
 * `quiz_runs` rows whose `shown_at` and `quiz_completions` rows whose `created_at` are older than
 * `QUIZ_RETENTION_MONTHS` months. Tenant-agnostic on purpose (single tenant, ESC-085): the
 * retention period is a property of the data, not of a tenant.
 *
 * **Mutating, so production-grade auth in this PR:** `CRON_SECRET` exactly as `cron/lift-snapshot`
 * (Vercel injects `Authorization: Bearer ${CRON_SECRET}`; `secretEquals` constant-time compare; an
 * unset secret is 401, never a dev bypass). Replay defense: the job is idempotent - a replay
 * deletes only rows that have since crossed the cutoff, and the cutoff is computed server-side.
 *
 * Deletes run in bounded batches of `BATCH_SIZE` rows, one statement each, until a statement
 * deletes fewer. Counts are logged and returned.
 *
 * **Fail-loud (Rule K.2):** DATABASE unset (dev / CI) is a 200 `data_source: 'not_configured'`;
 * `quiz_runs` missing (H002 not applied) is tolerated and reported as `quiz_runs.skipped:
 * 'table_missing'`; any other error is a 500 `quiz_retention_failed` plus ONE Sentry exception
 * carrying code + SQLSTATE only (never the driver error: its message holds the query and params).
 *
 * Localhost: `localhost-up.sh` schedules nothing; invoke by hand with
 * `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/quiz-retention`.
 *
 * @module apps/control-plane/src/app/api/cron/quiz-retention/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { createAdminClient } from '@estalara/db';
import { secretEquals } from '@/lib/secret-compare';
import { liftSnapshotStoreConfigured } from '@/lib/lift-snapshots';
import { isQuizRunsTableMissing } from '@/lib/quiz-runs';

/**
 * Retention window for quiz data, in months. CEO ruling 2026-10-20 (ESC-086 condition C6): 13
 * months, the `events` / `conversion_labels` precedent. ROPA, DPIA §2.5, the privacy notice and the
 * CTO handover quote this number; change them together.
 */
const QUIZ_RETENTION_MONTHS = 13;

/** Rows deleted per statement; keeps each transaction and its lock footprint small. */
const BATCH_SIZE = 5000;
/** Upper bound on batches per table per run (50 M rows); a runaway loop must end. */
const MAX_BATCHES = 10_000;

interface Executor {
  execute(query: SQL): PromiseLike<unknown>;
}

/** Response body of a 200. */
export interface QuizRetentionResponse {
  data_source: 'postgres' | 'not_configured';
  retention_months: number;
  quiz_runs?: { deleted: number; skipped?: 'table_missing' };
  quiz_completions?: { deleted: number };
  note?: string;
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const authHeader = req.headers.get('authorization') ?? '';
  const providedToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  return secretEquals(secret, providedToken);
}

/** SQLSTATE found anywhere in the `cause` chain, or `unknown`. Never the message. */
function sqlStateOf(err: unknown): string {
  let cursor: unknown = err;
  for (let depth = 0; depth < 4 && cursor !== null && typeof cursor === 'object'; depth++) {
    const e = cursor as { code?: unknown; cause?: unknown };
    if (typeof e.code === 'string' && /^[0-9A-Z]{5}$/.test(e.code)) return e.code;
    cursor = e.cause;
  }
  return 'unknown';
}

function countOf(result: unknown): number {
  const rows = Array.isArray(result) ? result : ((result as { rows?: unknown } | null)?.rows ?? []);
  const n = (rows as { n?: unknown }[])[0]?.n;
  return Number(n ?? 0);
}

/** Delete in batches until a statement removes fewer than `BATCH_SIZE`; returns the total. */
async function purge(
  db: Executor,
  table: 'quiz_runs' | 'quiz_completions',
  timeColumn: 'shown_at' | 'created_at',
): Promise<number> {
  const t = sql.identifier(table);
  const col = sql.identifier(timeColumn);
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const result = await db.execute(sql`
      WITH doomed AS (
        SELECT id FROM ${t}
        WHERE ${col} < now() - make_interval(months => ${QUIZ_RETENTION_MONTHS})
        ORDER BY ${col}
        LIMIT ${BATCH_SIZE}
      ), gone AS (
        DELETE FROM ${t} WHERE id IN (SELECT id FROM doomed) RETURNING 1
      )
      SELECT count(*)::int AS n FROM gone`);
    const n = countOf(result);
    total += n;
    if (n < BATCH_SIZE) break;
  }
  return total;
}

/**
 * @returns 200 {@link QuizRetentionResponse}; 401 on a failed auth check; 500
 *   `quiz_retention_failed`.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Cron secret invalid' } },
      { status: 401 },
    );
  }
  if (!liftSnapshotStoreConfigured()) {
    const body: QuizRetentionResponse = {
      data_source: 'not_configured',
      retention_months: QUIZ_RETENTION_MONTHS,
      note: 'DATABASE_URL_ADMIN_unset',
    };
    return NextResponse.json(body);
  }

  const body: QuizRetentionResponse = {
    data_source: 'postgres',
    retention_months: QUIZ_RETENTION_MONTHS,
  };
  try {
    const db = createAdminClient();
    try {
      body.quiz_runs = { deleted: await purge(db, 'quiz_runs', 'shown_at') };
    } catch (err: unknown) {
      if (!isQuizRunsTableMissing(err)) throw err;
      body.quiz_runs = { deleted: 0, skipped: 'table_missing' };
    }
    body.quiz_completions = { deleted: await purge(db, 'quiz_completions', 'created_at') };
    console.info(
      `[cron/quiz-retention] months=${String(QUIZ_RETENTION_MONTHS)} ` +
        `quiz_runs=${String(body.quiz_runs.deleted)} ` +
        `quiz_completions=${String(body.quiz_completions.deleted)}`,
    );
    return NextResponse.json(body);
  } catch (err: unknown) {
    const sqlState = sqlStateOf(err);
    Sentry.captureException(new Error(`quiz_retention_failed (sqlstate ${sqlState})`), {
      tags: { cron: 'quiz-retention', error_code: 'quiz_retention_failed', sqlstate: sqlState },
    });
    return NextResponse.json(
      {
        error: {
          code: 'quiz_retention_failed',
          message: 'Deleting expired quiz_runs / quiz_completions rows failed',
        },
      },
      { status: 500 },
    );
  }
}
