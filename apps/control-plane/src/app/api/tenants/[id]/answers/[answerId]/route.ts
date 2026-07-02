/**
 * PATCH /api/tenants/:id/answers/:answerId — update question and/or answer.
 * DELETE /api/tenants/:id/answers/:answerId — delete an answer row.
 *
 * Auth: Bearer JWT or Supabase SSR browser session via `getSessionAuthClaims()`
 * (apps/control-plane/src/lib/session-auth.ts, FOLLOW-454). Tenant must match `:id` — 403 on mismatch.
 *
 * PATCH:
 *   - If `question` changes, re-embeds via OpenAI and persists the new vector.
 *   - If only `answer` changes, reuses the existing embedding (no API call).
 *
 * @module apps/control-plane/src/app/api/tenants/[id]/answers/[answerId]/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';

import { createAdminClient, answers } from '@estalara/db';
import { getSessionAuthClaims } from '@/lib/session-auth';
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

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

async function validateTenantAuth(
  req: NextRequest,
  tenantId: string,
): Promise<{ ok: true } | NextResponse> {
  const claims = await getSessionAuthClaims(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!claims.tenant_id || claims.tenant_id !== tenantId) {
    return NextResponse.json({ error: 'Forbidden: tenant mismatch' }, { status: 403 });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// PATCH — update answer
// ---------------------------------------------------------------------------

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; answerId: string }> },
): Promise<NextResponse> {
  const { id: tenantId, answerId } = await params;

  const authResult = await validateTenantAuth(req, tenantId);
  if (authResult instanceof NextResponse) return authResult;

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
      question: answers.question,
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

  try {
    const updated = await db
      .update(answers)
      .set(updateValues)
      .where(and(eq(answers.id, answerId), eq(answers.tenantId, tenantId)))
      .returning({
        id: answers.id,
        tenantId: answers.tenantId,
        listingId: answers.listingId,
        question: answers.question,
        answer: answers.answer,
        createdAt: answers.createdAt,
        updatedAt: answers.updatedAt,
      });

    const row = updated[0];
    if (!row) {
      return NextResponse.json({ error: 'Update failed' }, { status: 500 });
    }

    return NextResponse.json(row, { status: 200 });
  } catch (err) {
    console.error('[answers PATCH] DB update failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to update answer' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE — remove answer
// ---------------------------------------------------------------------------

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; answerId: string }> },
): Promise<NextResponse> {
  const { id: tenantId, answerId } = await params;

  const authResult = await validateTenantAuth(req, tenantId);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const db = createAdminClient();
    const deleted = await db
      .delete(answers)
      .where(and(eq(answers.id, answerId), eq(answers.tenantId, tenantId)))
      .returning({ id: answers.id });

    if (deleted.length === 0) {
      return NextResponse.json({ error: 'Answer not found' }, { status: 404 });
    }

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[answers DELETE] DB delete failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to delete answer' }, { status: 500 });
  }
}
