/**
 * POST /api/tenants/:id/answers — create an FAQ answer for a listing.
 * GET  /api/tenants/:id/answers?listing_id=X — list answers (without embeddings).
 *
 * Auth: Bearer JWT via `getAuthClaims()`. The tenant in the JWT must match the
 * `:id` param — 401 for missing/invalid token, 403 for mismatched tenant.
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
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';

import { createAdminClient, answers } from '@estalara/db';
import { getAuthClaims } from '@estalara/auth';
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
// Auth helper
// ---------------------------------------------------------------------------

/**
 * Validate the Bearer JWT and assert the caller's tenant matches `tenantId`.
 * Returns the claims on success, or a NextResponse with the appropriate error.
 */
async function validateTenantAuth(
  req: NextRequest,
  tenantId: string,
): Promise<{ ok: true } | NextResponse> {
  const claims = await getAuthClaims(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!claims.tenant_id || claims.tenant_id !== tenantId) {
    return NextResponse.json({ error: 'Forbidden: tenant mismatch' }, { status: 403 });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// POST — create answer
// ---------------------------------------------------------------------------

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: tenantId } = await params;

  const authResult = await validateTenantAuth(req, tenantId);
  if (authResult instanceof NextResponse) return authResult;

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
      .returning({
        id: answers.id,
        tenantId: answers.tenantId,
        listingId: answers.listingId,
        question: answers.question,
        answer: answers.answer,
        createdAt: answers.createdAt,
        updatedAt: answers.updatedAt,
      });

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
  const { id: tenantId } = await params;

  const authResult = await validateTenantAuth(req, tenantId);
  if (authResult instanceof NextResponse) return authResult;

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
