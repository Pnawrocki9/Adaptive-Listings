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
 * One-active-row invariant (FOLLOW-301):
 *   When `is_active: true` is supplied, PUT performs an atomic swap within a
 *   single transaction:
 *     1. SET is_active = false on all OTHER active rows in the same scope as
 *        the target row (identified by first fetching the row's tenant_id).
 *     2. UPDATE the target row with the supplied fields.
 *   This avoids hitting the `intent_weight_configs_one_active` partial unique index
 *   under normal operation. If the constraint fires despite the swap (race), the
 *   error is mapped to 409 active_config_exists (not 500 db_error).
 *   A genuine DB failure (connection refused, timeout, etc.) still surfaces as
 *   500 + Sentry (Rule K.2).
 *   When `is_active: false` or `is_active` is not supplied, a plain UPDATE is used.
 *
 * Change-active-config workflow:
 *   To activate a staged (is_active=false) row, PUT { is_active: true } to its id.
 *   The currently-active row in the same scope is atomically deactivated.
 *   Alternatively, POST a new active row to let the system handle the full swap.
 *
 * Body (JSON — at least one of `weights` or `is_active` must be present):
 *   weights    {object?} Partial or complete IntentWeightsSchema object.
 *   is_active  {boolean?} Activate or deactivate this config row.
 *
 * Response 200:
 *   { id, tenant_id, is_active, weights, created_at }
 *
 * Error 409: { error: { code: 'active_config_exists', message, hint } }
 *   Returned when a unique-violation race occurs despite the atomic-swap attempt.
 *
 * Error 400: { error: { code: 'unknown_tenant', message } }
 *   Returned when the row's tenant_id FK is violated (should not occur in normal
 *   operation but included for completeness).
 *
 * @module apps/control-plane/src/app/api/admin/intent/config/[id]/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { and, eq, isNull, ne } from 'drizzle-orm';

import { createAdminClient, intentWeightConfigs } from '@estalara/db';
import { IntentWeightsSchema } from '@estalara/shared';

import { verifyTracerAdminAuth } from '@/lib/tracer-auth';

// ─── Postgres error codes ─────────────────────────────────────────────────────

/** Unique-constraint violation (intent_weight_configs_one_active partial index). */
const PG_UNIQUE_VIOLATION = '23505';

/** Foreign-key violation (tenant_id → tenants.id). */
const PG_FK_VIOLATION = '23503';

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

// ─── PG error helper ──────────────────────────────────────────────────────────

/**
 * Extract the Postgres error code from an unknown thrown value.
 * Works for `postgres` (the npm driver) error objects which expose `.code`.
 */
function pgCode(err: unknown): string | undefined {
  if (err !== null && typeof err === 'object' && 'code' in err) {
    // After `'code' in err`, TypeScript narrows err to `object & Record<'code', unknown>`.
    const record = err as Record<string, unknown>;
    const c = record.code;
    if (typeof c === 'string') return c;
  }
  return undefined;
}

// ─── PUT handler ──────────────────────────────────────────────────────────────

/**
 * PUT /api/admin/intent/config/[id]
 *
 * [id] = UUID primary key of the intent_weight_configs row.
 *
 * When `is_active: true` is supplied, first fetches the target row to discover its
 * scope (tenant_id), then runs an atomic transaction: deactivate sibling rows in
 * that scope, then update the target row.
 *
 * @returns 200 { id, tenant_id, is_active, weights, created_at } on success.
 * @returns 400 on Zod body validation failure, invalid [id], or FK violation.
 * @returns 401/403 if auth fails.
 * @returns 404 when no row with the given id exists.
 * @returns 409 if the unique constraint fires despite the swap attempt (race).
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

    let rows: {
      id: string;
      tenantId: string | null;
      isActive: boolean;
      weights: unknown;
      createdAt: Date;
    }[];

    if (isActive === true) {
      // Atomic swap: deactivate sibling active rows in the same scope, then update.
      // We first fetch the target row to discover its tenant_id (scope).
      rows = await db.transaction(async (tx) => {
        // Fetch the target row to learn its scope.
        const targetRows = await tx
          .select({
            id: intentWeightConfigs.id,
            tenantId: intentWeightConfigs.tenantId,
          })
          .from(intentWeightConfigs)
          .where(eq(intentWeightConfigs.id, rowId))
          .limit(1);

        if (targetRows.length === 0) {
          // Return empty to signal 404 after the transaction.
          return [];
        }

        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const target = targetRows[0]!;

        // Deactivate sibling rows in the same scope (exclude the target row itself).
        const scopeCondition =
          target.tenantId !== null
            ? eq(intentWeightConfigs.tenantId, target.tenantId)
            : isNull(intentWeightConfigs.tenantId);

        await tx
          .update(intentWeightConfigs)
          .set({ isActive: false })
          .where(
            and(
              eq(intentWeightConfigs.isActive, true),
              scopeCondition,
              ne(intentWeightConfigs.id, rowId),
            ),
          );

        // Now update the target row.
        return tx
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
      });
    } else {
      // No activation: plain update, no deactivation needed.
      rows = await db
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
    }

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
    const code = pgCode(err);

    // FK violation: tenant_id not found in tenants table.
    if (code === PG_FK_VIOLATION) {
      return NextResponse.json(
        {
          error: {
            code: 'unknown_tenant',
            message: 'The tenant_id on this row no longer exists in the tenants table',
          },
        },
        { status: 400 },
      );
    }

    // Unique violation: the one-active invariant was breached despite the atomic swap.
    if (code === PG_UNIQUE_VIOLATION) {
      return NextResponse.json(
        {
          error: {
            code: 'active_config_exists',
            message:
              'An active intent weight config already exists for this scope. ' +
              'Use PUT /api/admin/intent/config/[id] with is_active:false to deactivate it first, ' +
              'or retry.',
            hint: 'This error indicates a concurrent write race. Retry the PUT.',
          },
        },
        { status: 409 },
      );
    }

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
