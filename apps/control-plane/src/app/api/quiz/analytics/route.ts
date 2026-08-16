/**
 * GET /api/quiz/analytics[?tenant_id=<uuid>] — real quiz analytics from
 * `quiz_completions` (FOLLOW-1000).
 *
 * Replaces the `/dashboard/quiz/analytics` mock ("TODO Sprint 5: fetch real
 * data" — never built). Every metric here is computed from the tenant's actual
 * `quiz_completions` rows (FOLLOW-200):
 *
 *   - `total_completions`     — all time
 *   - `completions_30d`       — rolling last 30 days
 *   - `daily`                 — per-day counts for the rolling last 14 days
 *                               (days with zero completions are absent; the
 *                               client fills gaps — Postgres has no rows to
 *                               group for them)
 *   - `by_archetype`          — all-time resolved-archetype distribution
 *   - `by_branch`             — all-time Q1 branch split (null = Q1-D skip)
 *
 * DELIBERATELY NOT INCLUDED — and why, so nobody re-adds fabricated numbers:
 * the mock showed "Impressions", "Completion Rate" and "Inquiry Lift". The SDK
 * emits `quiz.event` ONLY at completion (`step: 'completed'` /
 * `'micro_poll_answered'` — see `packages/sdk/src/index.ts`); there is NO
 * quiz-shown/impression event anywhere in the event schema, so an impression
 * count has no data source and a completion RATE has no denominator. Adding
 * one would require a new SDK event type — a public ingest-schema change that
 * needs its own escalation per CLAUDE.md, tracked as an explicit gap in
 * FOLLOW-1000, not silently faked here. Lift belongs to the A/B surfaces
 * (`/api/analytics/lift`), not the quiz page.
 *
 * Auth (ADR-0018 invariant 5, same shape as GET /api/quiz/config): ONE path for
 * agency + staff via `resolveTenantAccess` with `allowStaffOverride` —
 * `access.tenantId` is the ONLY tenant fence, bound into every query. The
 * agency branch sources it from the session claim; the staff branch from the
 * validated `?tenant_id`.
 *
 * Rule K.2 — fail loud: a configured-but-failed query returns 500, never
 * zeroes fabricated as "no quiz activity".
 *
 * @module apps/control-plane/src/app/api/quiz/analytics/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { and, eq, gte, sql } from 'drizzle-orm';

import { createAdminClient, quizCompletions } from '@estalara/db';
import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { accessErrorToResponse } from '@/lib/access-error-response';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QuizAnalyticsResponse {
  tenant_id: string;
  total_completions: number;
  completions_30d: number;
  /** Per-day counts, last 14 days, ascending; zero-days absent (client fills). */
  daily: { day: string; count: number }[];
  by_archetype: { archetype: string; count: number }[];
  by_branch: { branch: string | null; count: number }[];
}

const DAILY_WINDOW_DAYS = 14;
const ROLLING_WINDOW_DAYS = 30;

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const tenantIdParam = req.nextUrl.searchParams.get('tenant_id');
  let access: TenantAccess;
  try {
    access = await resolveTenantAccess(req, {
      allowStaffOverride: true,
      // exactOptionalPropertyTypes (RETRO-189): omit the key when absent rather than
      // passing `undefined`, so a staff caller without ?tenant_id reaches resolve's 400.
      ...(tenantIdParam ? { tenantId: tenantIdParam } : {}),
    });
  } catch (err) {
    return accessErrorToResponse(err);
  }

  const tenantId = access.tenantId;

  try {
    const db = createAdminClient();
    const now = Date.now();
    const since30d = new Date(now - ROLLING_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const since14d = new Date(now - DAILY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

    // Five reads, every one carrying the SAME explicit tenant fence (invariant 5).
    const totalRows = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(quizCompletions)
      .where(eq(quizCompletions.tenantId, tenantId));

    const rollingRows = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(quizCompletions)
      .where(and(eq(quizCompletions.tenantId, tenantId), gte(quizCompletions.createdAt, since30d)));

    const dailyRows = await db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${quizCompletions.createdAt}), 'YYYY-MM-DD')`,
        cnt: sql<number>`count(*)::int`,
      })
      .from(quizCompletions)
      .where(and(eq(quizCompletions.tenantId, tenantId), gte(quizCompletions.createdAt, since14d)))
      .groupBy(sql`date_trunc('day', ${quizCompletions.createdAt})`)
      .orderBy(sql`date_trunc('day', ${quizCompletions.createdAt})`);

    const byArchetype = await db
      .select({
        archetype: quizCompletions.resolvedArchetype,
        cnt: sql<number>`count(*)::int`,
      })
      .from(quizCompletions)
      .where(eq(quizCompletions.tenantId, tenantId))
      .groupBy(quizCompletions.resolvedArchetype);

    const byBranch = await db
      .select({
        branch: quizCompletions.branch,
        cnt: sql<number>`count(*)::int`,
      })
      .from(quizCompletions)
      .where(eq(quizCompletions.tenantId, tenantId))
      .groupBy(quizCompletions.branch);

    const body: QuizAnalyticsResponse = {
      tenant_id: tenantId,
      total_completions: totalRows[0]?.cnt ?? 0,
      completions_30d: rollingRows[0]?.cnt ?? 0,
      daily: dailyRows.map((r) => ({ day: r.day, count: r.cnt })),
      by_archetype: byArchetype
        .map((r) => ({ archetype: r.archetype, count: r.cnt }))
        .sort((a, b) => b.count - a.count),
      by_branch: byBranch
        .map((r) => ({ branch: r.branch, count: r.cnt }))
        .sort((a, b) => b.count - a.count),
    };
    return NextResponse.json(body, { status: 200 });
  } catch (err: unknown) {
    // Rule K.2 — fail loud: the DB is configured but a query threw. Zeroes here
    // would be indistinguishable from a tenant with genuinely no quiz activity.
    console.error('[quiz/analytics GET] DB error:', err instanceof Error ? err.message : err);
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { route: 'quiz/analytics', op: 'get' },
      extra: { tenant_id: tenantId },
    });
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to load quiz analytics' } },
      { status: 500 },
    );
  }
}
