/**
 * POST /api/tenants/:id/answers — create an FAQ answer for a listing.
 * GET  /api/tenants/:id/answers?listing_id=X — list answers (without embeddings).
 *
 * Auth (ADR-0018 §2, FOLLOW-1334): `resolveTenantAccess` with `allowStaffOverride` via
 * `resolveAnswersAccess` (`lib/answers-access.ts`). Agency path (unchanged): Bearer JWT or Supabase
 * SSR browser session; the tenant in the claims must match the `:id` param — 401 for missing/invalid
 * session, 403 for mismatched tenant. Staff path: an Estalara staff session may act on any
 * `:id` that exists in `tenants` (404 otherwise); a staff POST needs `estalara:ops`+ (403 below) and
 * commits the insert and its `staff_audit_log` row in ONE transaction (ADR-0018 §3a).
 *
 * POST body:
 *   listing_id  — string, required
 *   question    — string, required (embedding is computed server-side)
 *   answer      — string, required
 *
 * GET query params:
 *   listing_id  — string, required
 *
 * @module apps/control-plane/src/app/api/tenants/[id]/answers/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';

import { createAdminClient, answers, staffAuditLog } from '@estalara/db';
import { requestIp, resolveAnswersAccess } from '@/lib/answers-access';
import { embedText } from '@/lib/openai-client';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const CreateAnswerSchema = z.object({
  listing_id: z.string().min(1).max(256),
  question: z.string().min(1).max(2000),
  answer: z.string().min(1).max(10000),
});

// ---------------------------------------------------------------------------
// POST — create answer
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: pathTenantId } = await params;

  const auth = await resolveAnswersAccess(req, pathTenantId, 'write');
  if (!auth.ok) return auth.response;
  const { access } = auth;
  const tenantId = access.tenantId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = CreateAnswerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { listing_id, question, answer } = parsed.data;

  // Compute question embedding via OpenAI
  let questionEmbedding: number[];
  try {
    questionEmbedding = await embedText(question);
  } catch (err) {
    console.error('[answers POST] embedding failed:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'Failed to compute question embedding. Check OPENAI_API_KEY.' },
      { status: 503 },
    );
  }

  const returningColumns = {
    id: answers.id,
    tenantId: answers.tenantId,
    listingId: answers.listingId,
    question: answers.question,
    answer: answers.answer,
    createdAt: answers.createdAt,
    updatedAt: answers.updatedAt,
  };

  if (access.via === 'staff') {
    // ── Atomic staff write (ADR-0018 §3a / FOLLOW-605 reference impl) ─────────────────────────
    // The insert and its staff_audit_log row commit-or-roll-back TOGETHER, so an answer can never
    // outlive a missing audit row. Fenced on access.tenantId (validated against `tenants`).
    try {
      const db = createAdminClient();
      const row = await db.transaction(async (tx) => {
        const inserted = await tx
          .insert(answers)
          .values({ tenantId, listingId: listing_id, question, answer, questionEmbedding })
          .returning(returningColumns);
        const created = inserted[0];
        if (!created) throw new Error('answers insert returned no row');
        await tx.insert(staffAuditLog).values({
          adminUserId: access.staff.sub,
          action: 'listing_answer.create',
          targetTenantId: tenantId,
          payload: { answer_id: created.id, listing_id, question, answer },
          ipAddress: requestIp(req),
          userAgent: req.headers.get('user-agent'),
        });
        return created;
      });
      return NextResponse.json(row, { status: 201 });
    } catch (err) {
      Sentry.captureException(err, {
        tags: { route: 'tenants/answers', staff_audit_error: 'true' },
        extra: { tenant_id: tenantId, admin_user_id: access.staff.sub },
      });
      return NextResponse.json(
        {
          error:
            'The answer could not be recorded atomically with its staff audit row; ' +
            'nothing was saved. Retry the action.',
          code: 'audit_write_failed',
        },
        { status: 500 },
      );
    }
  }

  try {
    const db = createAdminClient();
    const inserted = await db
      .insert(answers)
      .values({
        tenantId,
        listingId: listing_id,
        question,
        answer,
        questionEmbedding,
      })
      .returning(returningColumns);

    const row = inserted[0];
    if (!row) {
      return NextResponse.json({ error: 'Insert failed' }, { status: 500 });
    }

    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    console.error('[answers POST] DB insert failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to create answer' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// GET — list answers for (tenant_id, listing_id)
// ---------------------------------------------------------------------------

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: pathTenantId } = await params;

  const auth = await resolveAnswersAccess(req, pathTenantId, 'read');
  if (!auth.ok) return auth.response;
  const tenantId = auth.access.tenantId;

  const listingId = req.nextUrl.searchParams.get('listing_id');
  if (!listingId) {
    return NextResponse.json(
      { error: 'Missing required query param: listing_id' },
      { status: 400 },
    );
  }

  try {
    const db = createAdminClient();
    const rows = await db
      .select({
        id: answers.id,
        tenantId: answers.tenantId,
        listingId: answers.listingId,
        question: answers.question,
        answer: answers.answer,
        createdAt: answers.createdAt,
        updatedAt: answers.updatedAt,
      })
      .from(answers)
      .where(and(eq(answers.tenantId, tenantId), eq(answers.listingId, listingId)));

    return NextResponse.json(rows, { status: 200 });
  } catch (err) {
    console.error('[answers GET] DB query failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to fetch answers' }, { status: 500 });
  }
}
