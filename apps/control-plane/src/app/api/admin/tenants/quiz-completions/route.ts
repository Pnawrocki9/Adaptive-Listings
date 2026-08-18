/**
 * GET /api/admin/tenants/quiz-completions?tenant_id=<uuid>&limit=&offset= —
 * staff-only, read-only viewer feed for a tenant's `quiz_completions` rows
 * (FOLLOW-999).
 *
 * `quiz_completions` (FOLLOW-200) has been written on every SDK quiz completion
 * since Sprint 16 — session fingerprint, resolved archetype, branch, Q1–Q3 answer
 * indexes, locale — but no UI anywhere could READ it: the only surface was the
 * aggregate COUNT on `/admin/analytics`, so inspecting actual answers meant raw
 * SQL against Supabase. This route feeds the staff viewer at
 * `/admin/tenants/[id]/quiz-completions` with a newest-first page of rows plus
 * two grouped aggregates (by archetype, by branch) computed over ALL of the
 * tenant's completions, not just the visible page.
 *
 * Auth (ADR-0018 §2): `resolveTenantAccess` with `allowStaffOverride`, STAFF-ONLY
 *   — a resolved agency session is rejected 403 (`staff_only`). Read-only: any
 *   staff rank (including `estalara:readonly`) may call it, mirroring the
 *   `al-state`/`quiz-state` GETs; there is no write here to rank-gate. The
 *   validated `?tenant_id` is the SINGLE tenant fence (invariant 5) bound into
 *   every query on the service-role client (RLS BYPASSED, so the explicit
 *   `eq(quizCompletions.tenantId, …)` fence is the ONLY tenant boundary).
 *
 * Privacy note: `session_id` is the SDK's anonymous SHA-256 fingerprint — no PII;
 *   answers are 0-based option indexes, not free text. Nothing in this response
 *   carries buyer-authored content.
 *
 * Rule K.2 — fail loud: a configured-but-failed DB query returns 500, never an
 *   empty list fabricated as "no completions".
 *
 * @module apps/control-plane/src/app/api/admin/tenants/quiz-completions/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';

import { createAdminClient, quizCompletions } from '@estalara/db';
import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { accessErrorToResponse } from '@/lib/access-error-response';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface QuizCompletionRow {
  id: string;
  /** SDK anonymous session fingerprint (SHA-256 hex) — joins to the signal stream. */
  session_id: string;
  resolved_archetype: string;
  /**
   * The question the root answer led to, or `null` for a root answer that is itself a leaf
   * (the "just browsing" skip). Legacy rows also carry `null` here — read `path_reported`
   * before interpreting it (FOLLOW-1020).
   */
  branch: string | null;
  q1_answer: number | null;
  q2_answer: number | null;
  q3_answer: number | null;
  /**
   * Whether this row carries a reported answer path (FOLLOW-1020).
   *
   * `false` for every completion written before the SDK sent one. Those rows are not skips
   * and not branchless — nothing about their walk was ever recorded, and rendering them with
   * the same `null` the skip case uses is the defect this flag closes.
   */
  path_reported: boolean;
  language: string;
  created_at: string;
}

export interface QuizCompletionsResponse {
  tenant_id: string;
  /** Total completions for the tenant (all time), independent of paging. */
  total: number;
  limit: number;
  offset: number;
  /** Grouped over ALL the tenant's completions, not just the visible page. */
  aggregates: {
    by_archetype: { archetype: string; count: number }[];
    /**
     * Computed over REPORTED rows only (FOLLOW-1020) — a row with no recorded path cannot be
     * attributed to a branch, and counting it as one made a full three-question walk show up
     * as a Q1 skip.
     */
    by_branch: { branch: string | null; count: number }[];
    /**
     * How many completions `by_branch` had to leave out. Surfaced rather than dropped: a split
     * computed over a subset reads as a split over everything unless the remainder is stated.
     */
    branch_not_reported: number;
  };
  completions: QuizCompletionRow[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse a non-negative integer query param with a default; NaN/negative → default. */
function intParam(raw: string | null, fallback: number): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return fallback;
  return n;
}

/** Resolve access, then enforce STAFF-ONLY (no agency path — mirrors quiz-state). */
async function resolveStaffAccess(
  req: NextRequest,
): Promise<{ access: Extract<TenantAccess, { via: 'staff' }> } | { error: NextResponse }> {
  const tenantIdParam = req.nextUrl.searchParams.get('tenant_id');
  let access: TenantAccess;
  try {
    access = await resolveTenantAccess(req, {
      allowStaffOverride: true,
      minAgencyRole: 'agency:viewer',
      // exactOptionalPropertyTypes (RETRO-189): omit the key when absent so a staff
      // caller without ?tenant_id reaches resolve's 400.
      ...(tenantIdParam ? { tenantId: tenantIdParam } : {}),
    });
  } catch (err) {
    return { error: accessErrorToResponse(err) };
  }

  if (access.via !== 'staff') {
    return {
      error: NextResponse.json(
        {
          error: {
            code: 'staff_only',
            message: 'The quiz completions viewer is an Estalara staff surface',
          },
        },
        { status: 403 },
      ),
    };
  }

  return { access };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const resolved = await resolveStaffAccess(req);
  if ('error' in resolved) return resolved.error;
  const tenantId = resolved.access.tenantId;

  const limit = Math.min(intParam(req.nextUrl.searchParams.get('limit'), DEFAULT_LIMIT), MAX_LIMIT);
  const offset = intParam(req.nextUrl.searchParams.get('offset'), 0);

  try {
    const db = createAdminClient();

    // Five reads, every one carrying the SAME explicit tenant fence (invariant 5).
    // Sequential, not Promise.all — the per-request latency of a staff viewer page
    // does not justify racing them and losing which one failed.
    const pageRows = await db
      .select({
        id: quizCompletions.id,
        sessionId: quizCompletions.sessionId,
        resolvedArchetype: quizCompletions.resolvedArchetype,
        branch: quizCompletions.branch,
        q1Answer: quizCompletions.q1Answer,
        q2Answer: quizCompletions.q2Answer,
        q3Answer: quizCompletions.q3Answer,
        answerPath: quizCompletions.answerPath,
        language: quizCompletions.language,
        createdAt: quizCompletions.createdAt,
      })
      .from(quizCompletions)
      .where(eq(quizCompletions.tenantId, tenantId))
      .orderBy(desc(quizCompletions.createdAt))
      .limit(limit)
      .offset(offset);

    const totalRows = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(quizCompletions)
      .where(eq(quizCompletions.tenantId, tenantId));

    const byArchetype = await db
      .select({
        archetype: quizCompletions.resolvedArchetype,
        cnt: sql<number>`count(*)::int`,
      })
      .from(quizCompletions)
      .where(eq(quizCompletions.tenantId, tenantId))
      .groupBy(quizCompletions.resolvedArchetype);

    // FOLLOW-1020: the split is over rows that actually reported a walk. `answer_path IS NULL`
    // is the discriminator — a genuine Q1 skip has a path (one entry, ending at a leaf) and a
    // null branch, whereas a pre-FOLLOW-1020 row has neither.
    const byBranch = await db
      .select({
        branch: quizCompletions.branch,
        cnt: sql<number>`count(*)::int`,
      })
      .from(quizCompletions)
      .where(and(eq(quizCompletions.tenantId, tenantId), isNotNull(quizCompletions.answerPath)))
      .groupBy(quizCompletions.branch);

    const notReportedRows = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(quizCompletions)
      .where(
        and(eq(quizCompletions.tenantId, tenantId), sql`${quizCompletions.answerPath} IS NULL`),
      );

    const body: QuizCompletionsResponse = {
      tenant_id: tenantId,
      total: totalRows[0]?.cnt ?? 0,
      limit,
      offset,
      aggregates: {
        by_archetype: byArchetype
          .map((r) => ({ archetype: r.archetype, count: r.cnt }))
          .sort((a, b) => b.count - a.count),
        by_branch: byBranch
          .map((r) => ({ branch: r.branch, count: r.cnt }))
          .sort((a, b) => b.count - a.count),
        branch_not_reported: notReportedRows[0]?.cnt ?? 0,
      },
      completions: pageRows.map((r) => ({
        id: r.id,
        session_id: r.sessionId,
        resolved_archetype: r.resolvedArchetype,
        branch: r.branch,
        q1_answer: r.q1Answer,
        q2_answer: r.q2Answer,
        q3_answer: r.q3Answer,
        path_reported: r.answerPath !== null,
        language: r.language,
        created_at: r.createdAt.toISOString(),
      })),
    };
    return NextResponse.json(body, { status: 200 });
  } catch (err: unknown) {
    // Rule K.2 — fail loud: the DB is configured but a query threw. An empty list
    // here would be indistinguishable from "this tenant has no completions".
    console.error('[quiz-completions GET] DB error:', err instanceof Error ? err.message : err);
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { route: 'admin/tenants/quiz-completions', op: 'get' },
      extra: { tenant_id: tenantId },
    });
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to load quiz completions' } },
      { status: 500 },
    );
  }
}
