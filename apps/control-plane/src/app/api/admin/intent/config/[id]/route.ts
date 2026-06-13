/**
 * PUT /api/admin/intent/config/[id]
 *
 * K.3.6 D-1 admin write API — update an existing intent_weight_configs row
 * (ADR-0012 Ticket B).
 *
 * Updates `weights`, `is_active`, or both on an existing row identified by its UUID
 * primary key. Returns 404 when the row does not exist.
 *
 * Auth: Bearer <ADMIN_API_SECRET> OR Supabase JWT with estalara_staff: true.
 * Same `verifyTracerAdminAuth` guard as the tracer admin routes (FOLLOW-267).
 *
 * Rule H amendment — mutation endpoint auth sign-off: see POST route sibling.
 *
 * Rule K.2: a configured DB failure returns 500 + Sentry capture. No mock path.
 *
 * Body (JSON — at least one of `weights` or `is_active` must be present):
 *   weights    {object?} Partial or complete IntentWeightsSchema object.
 *   is_active  {boolean?} Activate or deactivate this config row.
 *
 * Response 200:
 *   { id, tenant_id, is_active, weights, created_at }
 *
 * @module apps/control-plane/src/app/api/admin/intent/config/[id]/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { eq } from 'drizzle-orm';

import { createAdminClient, intentWeightConfigs } from '@estalara/db';
import { IntentWeightsSchema } from '@estalara/shared';

import { verifyTracerAdminAuth } from '@/lib/tracer-auth';

// ─── Request body schema ──────────────────────────────────────────────────────

/**
 * PUT body schema.
 *
 * At least one of `weights` or `is_active` must be provided — an empty body
 * is rejected with 400 so callers get immediate feedback on accidental no-ops.
 *
 * `weights` is validated against the canonical IntentWeightsSchema with `.strict()`
 * inherited from the shared schema — unknown keys are rejected.
 */
const PutBodySchema = z
  .object({
    weights: IntentWeightsSchema.optional(),
    is_active: z.boolean().optional(),
  })
  .refine(
    (data: { weights?: unknown; is_active?: unknown }) =>
      data.weights !== undefined || data.is_active !== undefined,
    { message: 'At least one of `weights` or `is_active` must be provided' },
  );

// ─── PUT handler ──────────────────────────────────────────────────────────────

/**
 * PUT /api/admin/intent/config/[id]
 *
 * [id] = UUID primary key of the intent_weight_configs row.
 *
 * @returns 200 { id, tenant_id, is_active, weights, created_at } on success.
 * @returns 400 on Zod body validation failure or invalid [id].
 * @returns 401/403 if auth fails.
 * @returns 404 when no row with the given id exists.
 * @returns 500 if DB is unconfigured or the configured DB throws (Rule K.2 — fail loud).
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authResult = await verifyTracerAdminAuth(req);
  if (!authResult.ok) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: authResult.message } },
      { status: authResult.status },
    );
  }

  // ── Validate [id] path param ──────────────────────────────────────────────
  const { id } = await params;
  const idParsed = z.string().uuid('id must be a valid UUID').safeParse(id);
  if (!idParsed.success) {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'id must be a valid UUID' } },
      { status: 400 },
    );
  }
  const rowId = idParsed.data;

  // ── Parse + validate body ─────────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'validation_error', message: 'Request body must be valid JSON' } },
      { status: 400 },
    );
  }

  const parsed = PutBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation_error', details: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { weights, is_active: isActive } = parsed.data;

  // ── Rule K.2: no mock write path ──────────────────────────────────────────
  const dbConfigured =
    Boolean(process.env.DATABASE_URL_ADMIN) || Boolean(process.env.DATABASE_URL_DIRECT);

  if (!dbConfigured) {
    return NextResponse.json(
      {
        error: {
          code: 'db_unconfigured',
          message:
            'DATABASE_URL_ADMIN or DATABASE_URL_DIRECT must be set to write intent weight configs',
        },
      },
      { status: 500 },
    );
  }

  // ── Update Postgres row ───────────────────────────────────────────────────
  try {
    const db = createAdminClient();

    // Build the set object from whichever fields were supplied.
    const setValues: { weights?: typeof weights; isActive?: boolean } = {};
    if (weights !== undefined) setValues.weights = weights;
    if (isActive !== undefined) setValues.isActive = isActive;

    const rows = await db
      .update(intentWeightConfigs)
      .set(setValues)
      .where(eq(intentWeightConfigs.id, rowId))
      .returning({
        id: intentWeightConfigs.id,
        tenantId: intentWeightConfigs.tenantId,
        isActive: intentWeightConfigs.isActive,
        weights: intentWeightConfigs.weights,
        createdAt: intentWeightConfigs.createdAt,
      });

    if (rows.length === 0) {
      return NextResponse.json(
        { error: { code: 'not_found', message: `No intent_weight_configs row with id: ${rowId}` } },
        { status: 404 },
      );
    }

    // update().returning() returns exactly one row when the row exists.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const row = rows[0]!;

    return NextResponse.json(
      {
        id: row.id,
        tenant_id: row.tenantId,
        is_active: row.isActive,
        weights: row.weights,
        created_at: row.createdAt.toISOString(),
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    // Configured-but-failed: fail loud (Rule K.2). NO mock fallback for writes.
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      extra: { route: 'PUT /api/admin/intent/config/[id]', rowId, message },
    });
    return NextResponse.json(
      {
        error: {
          code: 'db_error',
          message: 'Postgres update failed — see Sentry for details',
        },
      },
      { status: 500 },
    );
  }
}
