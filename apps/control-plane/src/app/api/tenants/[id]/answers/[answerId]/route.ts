/**
 * PATCH /api/tenants/:id/answers/:answerId — update question and/or answer.
 * DELETE /api/tenants/:id/answers/:answerId — delete an answer row.
 *
 * Auth (ADR-0018 §2, FOLLOW-1334; staff-only since FOLLOW-1335 removed the agency path):
 * `resolveTenantAccess` with `allowStaffOverride` via `resolveAnswersAccess`
 * (`lib/answers-access.ts`). An Estalara staff session may act on any `:id` that exists in
 * `tenants` (404 otherwise; 401 without a staff session); a PATCH/DELETE needs `estalara:ops`+
 * (403 below) and commits the mutation and its `staff_audit_log` row in ONE transaction
 * (ADR-0018 §3a).
 *
 * PATCH:
 *   - If `question` changes, re-embeds via OpenAI and persists the new vector.
 *   - If only `answer` changes, reuses the existing embedding (no API call).
 *
 * @module apps/control-plane/src/app/api/tenants/[id]/answers/[answerId]/route
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

const PatchAnswerSchema = z
  .object({
    question: z.string().min(1).max(2000).optional(),
    answer: z.string().min(1).max(10000).optional(),
  })
  .refine((d) => d.question !== undefined || d.answer !== undefined, {
    message: 'At least one of question or answer must be provided',
  });

/** `answers.id` is a uuid column: any other shape can never match a row (and would make the query throw). */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// PATCH — update answer
// ---------------------------------------------------------------------------

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; answerId: string }> },
): Promise<NextResponse> {
  const { id: pathTenantId, answerId } = await params;

  const auth = await resolveAnswersAccess(req, pathTenantId, 'write');
  if (!auth.ok) return auth.response;
  const { access } = auth;
  const tenantId = access.tenantId;

  // A malformed id matches no row. 404 it here, before any query or transaction: otherwise the
  // uuid cast throws and a staff write reports a false `audit_write_failed` (+ Sentry).
  if (!UUID_RE.test(answerId)) {
    return NextResponse.json({ error: 'Answer not found' }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = PatchAnswerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const db = createAdminClient();

  // Fetch existing row to verify ownership and read current question if needed
  const existing = await db
    .select({
      id: answers.id,
      listingId: answers.listingId,
      question: answers.question,
      answer: answers.answer,
    })
    .from(answers)
    .where(and(eq(answers.id, answerId), eq(answers.tenantId, tenantId)))
    .limit(1);

  if (existing.length === 0) {
    return NextResponse.json({ error: 'Answer not found' }, { status: 404 });
  }

  const { question: newQuestion, answer: newAnswer } = parsed.data;
  const questionChanged = newQuestion !== undefined && newQuestion !== existing[0]?.question;

  // Re-embed only when the question text actually changed
  const updateValues: Partial<{
    question: string;
    answer: string;
    questionEmbedding: number[];
    updatedAt: Date;
  }> = { updatedAt: new Date() };

  if (newQuestion !== undefined) updateValues.question = newQuestion;
  if (newAnswer !== undefined) updateValues.answer = newAnswer;

  // questionChanged implies newQuestion !== undefined (see its definition above).
  if (questionChanged) {
    try {
      updateValues.questionEmbedding = await embedText(newQuestion);
    } catch (err) {
      console.error('[answers PATCH] embedding failed:', err instanceof Error ? err.message : err);
      return NextResponse.json(
        { error: 'Failed to compute question embedding. Check OPENAI_API_KEY.' },
        { status: 503 },
      );
    }
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

  // ── Atomic staff write (ADR-0018 §3a / FOLLOW-605 reference impl) ─────────────────────────
  // The update and its staff_audit_log row commit-or-roll-back TOGETHER. Fenced on
  // access.tenantId (validated against `tenants`) AND the answer id.
  try {
    const outcome = await db.transaction(async (tx) => {
      // Re-read the row UNDER A LOCK so the audited `before` is exactly what the UPDATE replaces
      // (a concurrent edit waits; a concurrent delete is a plain 404, not an audit failure).
      const locked = await tx
        .select({
          listingId: answers.listingId,
          question: answers.question,
          answer: answers.answer,
        })
        .from(answers)
        .where(and(eq(answers.id, answerId), eq(answers.tenantId, tenantId)))
        .limit(1)
        .for('update');
      const before = locked[0];
      if (!before) return 'not_found' as const;
      // The embedding above was decided from the unlocked read; if the question moved under us
      // the vector would not match the stored text — refuse instead of writing it.
      if (
        newQuestion !== undefined &&
        newQuestion !== before.question &&
        updateValues.questionEmbedding === undefined
      ) {
        return 'conflict' as const;
      }
      const updated = await tx
        .update(answers)
        .set(updateValues)
        .where(and(eq(answers.id, answerId), eq(answers.tenantId, tenantId)))
        .returning(returningColumns);
      const changed = updated[0];
      if (!changed) throw new Error('answers update returned no row');
      await tx.insert(staffAuditLog).values({
        adminUserId: access.staff.sub,
        action: 'listing_answer.update',
        targetTenantId: tenantId,
        payload: {
          answer_id: answerId,
          listing_id: before.listingId,
          before: { question: before.question, answer: before.answer },
          after: { question: changed.question, answer: changed.answer },
        },
        ipAddress: requestIp(req),
        userAgent: req.headers.get('user-agent'),
      });
      return changed;
    });
    if (outcome === 'not_found') {
      return NextResponse.json({ error: 'Answer not found' }, { status: 404 });
    }
    if (outcome === 'conflict') {
      return NextResponse.json(
        { error: 'The answer was changed by someone else meanwhile. Reload and retry.' },
        { status: 409 },
      );
    }
    const row = outcome;
    return NextResponse.json(row, { status: 200 });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: 'tenants/answers/[answerId]', staff_audit_error: 'true' },
      extra: { tenant_id: tenantId, admin_user_id: access.staff.sub, answer_id: answerId },
    });
    return NextResponse.json(
      {
        error:
          'The answer change could not be recorded atomically with its staff audit row; ' +
          'it was rolled back and NOT applied. Retry the action.',
        code: 'audit_write_failed',
      },
      { status: 500 },
    );
  }
}

// ---------------------------------------------------------------------------
// DELETE — remove answer
// ---------------------------------------------------------------------------

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; answerId: string }> },
): Promise<NextResponse> {
  const { id: pathTenantId, answerId } = await params;

  const auth = await resolveAnswersAccess(req, pathTenantId, 'write');
  if (!auth.ok) return auth.response;
  const { access } = auth;
  const tenantId = access.tenantId;

  // A malformed id matches no row. 404 it here, before any query or transaction: otherwise the
  // uuid cast throws and a staff write reports a false `audit_write_failed` (+ Sentry).
  if (!UUID_RE.test(answerId)) {
    return NextResponse.json({ error: 'Answer not found' }, { status: 404 });
  }

  // ── Atomic staff write (ADR-0018 §3a / FOLLOW-605 reference impl) ─────────────────────────
  // The delete and its staff_audit_log row commit-or-roll-back TOGETHER; the audit payload keeps
  // the deleted question/answer, so the row stays recoverable by hand. Fenced on access.tenantId.
  try {
    const db = createAdminClient();
    const removed = await db.transaction(async (tx) => {
      const rows = await tx
        .delete(answers)
        .where(and(eq(answers.id, answerId), eq(answers.tenantId, tenantId)))
        .returning({
          id: answers.id,
          listingId: answers.listingId,
          question: answers.question,
          answer: answers.answer,
        });
      const gone = rows[0];
      if (!gone) return null;
      await tx.insert(staffAuditLog).values({
        adminUserId: access.staff.sub,
        action: 'listing_answer.delete',
        targetTenantId: tenantId,
        payload: {
          answer_id: gone.id,
          listing_id: gone.listingId,
          question: gone.question,
          answer: gone.answer,
        },
        ipAddress: requestIp(req),
        userAgent: req.headers.get('user-agent'),
      });
      return gone;
    });
    if (!removed) {
      return NextResponse.json({ error: 'Answer not found' }, { status: 404 });
    }
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: 'tenants/answers/[answerId]', staff_audit_error: 'true' },
      extra: { tenant_id: tenantId, admin_user_id: access.staff.sub, answer_id: answerId },
    });
    return NextResponse.json(
      {
        error:
          'The answer deletion could not be recorded atomically with its staff audit row; ' +
          'it was rolled back and NOT applied. Retry the action.',
        code: 'audit_write_failed',
      },
      { status: 500 },
    );
  }
}
