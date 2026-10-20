/**
 * GET /api/admin/tenants/quiz-accuracy?tenant_id=<uuid>&from=&to=&definition_hash=&language= —
 * staff-only, read-only quiz accuracy report (FOLLOW-1363, plan Faza Q package Q8).
 *
 * Implements `docs/decisions/PREREG-quiz-accuracy-2026-10.md`: one `definition_hash` at a time
 * (the requested one, else the hash with the most decided rows in range), decided = confirmed +
 * corrected on a non-neutral leaf, the Wilson verdict on the first 400 decided rows, the futility
 * looks at 130 and 200, the pessimistic variant, per-leaf precision/recall, the confusion matrix
 * with a `none_of_these` column, language / speed / monthly splits and the response-rate validity
 * flag. The arithmetic is `lib/quiz-accuracy.ts` (pure, golden-fixture tested); the SQL is
 * `readQuizAccuracyData` in `lib/quiz-runs.ts`.
 *
 * Auth (ADR-0018 §2): `resolveTenantAccess` with `allowStaffOverride`, STAFF-ONLY (a non-staff
 * caller is 401) exactly like the sibling `quiz-completions` feed. Read-only, so any staff rank may
 * call it. The validated `?tenant_id` is the single tenant fence bound into every query on the
 * service-role client (RLS bypassed).
 *
 * Rule K.2 / provenance: `data_source: 'quiz_runs'` is on every 200. A missing table (H002 not
 * applied) is a 200 `{ available: false, code: 'quiz_runs_table_missing' }` the page renders as
 * "not set up", never an empty report; any other DB failure is a 500 plus a Sentry capture.
 *
 * @module apps/control-plane/src/app/api/admin/tenants/quiz-accuracy/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';

import { createAdminClient } from '@estalara/db';
import { buildQuizAccuracyReport, type QuizAccuracyReport } from '@/lib/quiz-accuracy';
import { QUIZ_RUNS_TABLE_MISSING, readQuizAccuracyData } from '@/lib/quiz-runs';
import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { accessErrorToResponse } from '@/lib/access-error-response';

/** The 200 body: the report, or the explicit "H002 not applied" state. */
export type QuizAccuracyResponse =
  | ({
      available: true;
      data_source: 'quiz_runs';
      tenant_id: string;
      rows_truncated: boolean;
    } & QuizAccuracyReport)
  | {
      available: false;
      data_source: 'quiz_runs';
      tenant_id: string;
      code: typeof QUIZ_RUNS_TABLE_MISSING;
      message: string;
    };

const isoInstant = z
  .string()
  .max(40)
  .refine((v) => !Number.isNaN(Date.parse(v)), 'must be an ISO date or datetime');

const QuerySchema = z.object({
  from: isoInstant.optional(),
  to: isoInstant.optional(),
  definition_hash: z.string().min(1).max(128).optional(),
  language: z.string().min(1).max(16).optional(),
});

async function resolveStaffAccess(
  req: NextRequest,
): Promise<{ access: TenantAccess } | { error: NextResponse }> {
  const tenantIdParam = req.nextUrl.searchParams.get('tenant_id');
  try {
    const access = await resolveTenantAccess(req, {
      allowStaffOverride: true,
      ...(tenantIdParam ? { tenantId: tenantIdParam } : {}),
    });
    return { access };
  } catch (err) {
    return { error: accessErrorToResponse(err) };
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const resolved = await resolveStaffAccess(req);
  if ('error' in resolved) return resolved.error;
  const tenantId = resolved.access.tenantId;

  const sp = req.nextUrl.searchParams;
  const parsed = QuerySchema.safeParse({
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    definition_hash: sp.get('definition_hash') ?? undefined,
    language: sp.get('language') ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'invalid_query', message: parsed.error.issues[0]?.message ?? 'bad query' } },
      { status: 400 },
    );
  }
  const q = parsed.data;
  const filters = {
    from: q.from ? new Date(q.from).toISOString() : null,
    to: q.to ? new Date(q.to).toISOString() : null,
    definitionHash: q.definition_hash ?? null,
    language: q.language ?? null,
  };

  try {
    const data = await readQuizAccuracyData(createAdminClient(), tenantId, filters);
    if (!data.available) {
      const body: QuizAccuracyResponse = {
        available: false,
        data_source: 'quiz_runs',
        tenant_id: tenantId,
        code: QUIZ_RUNS_TABLE_MISSING,
        message: 'quiz_runs does not exist: apply docs/handover/migrations/H002_quiz_runs.sql',
      };
      return NextResponse.json(body, { status: 200 });
    }
    const report = buildQuizAccuracyReport({
      definitionHash: data.definitionHash,
      hashes: data.hashes,
      runs: data.runs,
      funnelRows: data.funnelRows,
      filters: { from: filters.from, to: filters.to, language: filters.language },
    });
    const body: QuizAccuracyResponse = {
      available: true,
      data_source: 'quiz_runs',
      tenant_id: tenantId,
      rows_truncated: data.truncated,
      ...report,
    };
    return NextResponse.json(body, { status: 200 });
  } catch (err: unknown) {
    // Rule K.2 - the DB is configured but a query threw: never an empty report.
    console.error('[quiz-accuracy GET] DB error:', err instanceof Error ? err.message : err);
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { route: 'admin/tenants/quiz-accuracy', op: 'get' },
      extra: { tenant_id: tenantId },
    });
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to load the quiz accuracy report' } },
      { status: 500 },
    );
  }
}
