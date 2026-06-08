/**
 * GET /api/internal/retention/conversion-labels
 *
 * Vercel Cron handler. Deletes `conversion_labels` rows where
 * `labeled_at < NOW() - INTERVAL '13 months'`, implementing the 13-month
 * retention period documented in ROPA Activity 15 and DPIA §2.5
 * (FOLLOW-234, condition 9 of FOLLOW-187).
 *
 * **Implementation choice: Vercel Cron** (daily at 02:00 UTC).
 * Rationale:
 *   - The control-plane already has Vercel cron infrastructure (DSR mutation-poll).
 *   - Vercel Pro quota is 40 cron jobs / 1-min granularity — adding one daily
 *     cron is well within limits (see /api/dsr/mutation-poll rationale).
 *   - No additional scheduler dependency (Modal cron would couple to Modal auth
 *     for a simple DB DELETE that belongs with the control-plane's data lifecycle).
 *   - DELETE on `labeled_at` is bounded: rows expire at most once per 13-month
 *     horizon, so cardinality never explodes even at large tenant scale.
 *
 * **Auth:** Protected by `CRON_SECRET` header per Vercel Cron security guidance.
 * Vercel injects `Authorization: Bearer ${CRON_SECRET}` automatically for
 * cron-triggered invocations. Returns 401 when CRON_SECRET is not set
 * (infrastructure misconfiguration) or the header does not match.
 *
 * **Fail-loud (Rule K.2):** When DATABASE_URL_ADMIN is set and the DELETE
 * throws, this handler returns 500 and captures to Sentry — it does NOT
 * silently return 200 with zero deleted rows. When the env var is unset
 * (dev/CI) the route is a deliberate no-op (returns 200 with `note`).
 *
 * **Idempotency:** Safe to invoke multiple times; DELETE WHERE is idempotent.
 *
 * **Compliance references:**
 *   - ROPA Activity 15 — CRM Deep-Outcome Ingest, Retention Schedule row
 *   - DPIA §2.5 — conversion_labels retention row
 *   - Master Design §T (Conversion Label Loop)
 *   - FOLLOW-234 / FOLLOW-187 condition 9
 *
 * @module apps/control-plane/src/app/api/internal/retention/conversion-labels/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { lt } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient, conversionLabels } from '@estalara/db';
import { thirteenMonthsAgo } from './_utils';

// ─── Auth ────────────────────────────────────────────────────────────────────

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Reject when CRON_SECRET is not set — unconfigured secret is an
  // infrastructure misconfiguration, not a valid dev/CI bypass.
  if (!secret) return false;
  const authHeader = req.headers.get('authorization');
  return authHeader === `Bearer ${secret}`;
}

// ─── GET handler ────────────────────────────────────────────────────────────

/**
 * GET /api/internal/retention/conversion-labels
 *
 * Deletes `conversion_labels` rows older than 13 months by `labeled_at`.
 * Returns `{ deleted: number }` on success.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Cron secret invalid' } },
      { status: 401 },
    );
  }

  // When DATABASE_URL_ADMIN is not set this is dev/CI — deliberate no-op.
  const adminUrl = process.env.DATABASE_URL_ADMIN ?? process.env.DATABASE_URL_DIRECT;
  if (!adminUrl) {
    return NextResponse.json({
      deleted: 0,
      note: 'DATABASE_URL_ADMIN_unset',
    });
  }

  const db = createAdminClient();
  const cutoff = thirteenMonthsAgo();

  try {
    const result = await db
      .delete(conversionLabels)
      .where(lt(conversionLabels.labeledAt, cutoff))
      .returning({ id: conversionLabels.id });

    const deleted = result.length;

    if (deleted > 0) {
      // Sentry breadcrumb so the retention run is observable in dashboards.
      Sentry.addBreadcrumb({
        category: 'retention',
        message: `conversion_labels TTL cron: deleted ${String(deleted)} rows older than 13 months`,
        level: 'info',
        data: { deleted, cutoff: cutoff.toISOString() },
      });
    }

    return NextResponse.json({ deleted, cutoff: cutoff.toISOString() });
  } catch (err: unknown) {
    // Rule K.2 — fail loud when a configured store throws; never return a
    // plausible-looking 200 that hides a retention enforcement failure.
    Sentry.captureException(err, {
      tags: { retention_cron_failed: 'conversion_labels' },
      extra: { cutoff: cutoff.toISOString() },
    });
    return NextResponse.json(
      {
        error: {
          code: 'RETENTION_DELETE_FAILED',
          message: err instanceof Error ? err.message : String(err),
        },
      },
      { status: 500 },
    );
  }
}
