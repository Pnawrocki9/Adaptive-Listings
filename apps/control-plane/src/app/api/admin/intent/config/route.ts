/**
 * GET + POST /api/admin/intent/config
 *
 * K.3.6 D-1 admin API — read and write the global intent_weight_configs row.
 *
 * GET  /api/admin/intent/config  (ADR-0013 Contract 2)
 *   Returns the currently-active global config row with its database `id` included.
 *   `id` is needed by the Weight Editor page to issue PUT updates instead of
 *   POST-creating a new row per save (fixes FOLLOW-309 LG-1).
 *   Returns `AdminIntentConfigResponse` from `@estalara/shared` — all fields always
 *   present; `id`/`created_at` are null when no active global row exists.
 *   ?tenant_id= returns 400 unsupported_param (global-only in v1; CEO decision 2026-06-14).
 *   Rule K.2: configured DB failure → 500 + Sentry; NO mock fallback for admin reads.
 *
 * POST /api/admin/intent/config  (ADR-0012 Ticket B)
 *   K.3.6 D-1 admin write API — create an intent_weight_configs row.
 *
 * Creates a new weight configuration row: global default when `tenant_id` is omitted
 * (tenant_id IS NULL in the DB), or a per-tenant override when `tenant_id` is supplied.
 * This is the write path that populates `intent_weight_configs` so that
 * `GET /api/intent/config` returns `data_source: 'live'`.
 *
 * Auth: Bearer <ADMIN_API_SECRET> OR Supabase JWT with estalara_staff: true.
 * Uses the same `verifyTracerAdminAuth` guard as the tracer admin routes (FOLLOW-267).
 *
 * Rule H amendment — mutation endpoint auth sign-off:
 *   - Cryptographic: HMAC-equivalent constant-time Bearer compare via `timingSafeEqual`
 *     in `verifyTracerAdminAuth`, OR Supabase-verified staff JWT.
 *   - Tenant-scoped: tenant_id is supplied in the body, not inferred from a caller-facing
 *     session; admin callers are verified before the body is trusted.
 *   - Replay-resistant: admin secret is a long-lived bearer; replay protection is
 *     provided by TLS + idempotency via the DB unique partial index on
 *     (tenant_id, is_active = true). No state-mutating-replay attack surface exists
 *     because replaying the same POST either atomically swaps the active row (same
 *     weights) or creates a new active row (idempotent from the admin's perspective).
 *
 * Rule K.2: a configured DB failure returns 500 + Sentry capture. There is NO mock
 * write path and NO fail-soft fallback on writes. A missing DB URL also returns 500.
 *
 * One-active-row invariant (FOLLOW-301):
 *   When `is_active` is true (the default), POST performs an atomic swap within a
 *   single transaction:
 *     1. SET is_active = false on all existing active rows in the same scope
 *        (same tenant_id, or the global NULL scope).
 *     2. INSERT the new row with is_active = true.
 *   This makes "set this config active" idempotent and avoids hitting the
 *   `intent_weight_configs_one_active` partial unique index under normal operation.
 *   If the DB constraint fires despite the swap (race), the error is mapped to
 *   409 active_config_exists (not 500 db_error). A genuine DB failure (connection
 *   refused, timeout, etc.) still surfaces as 500 + Sentry (Rule K.2).
 *   If `is_active` is false, no deactivation is needed and a plain INSERT is used.
 *
 * Body (JSON):
 *   weights    {object}  Required. IntentWeightsSchema — all sub-fields optional.
 *   tenant_id  {string?} Optional UUID. Omit for global default (tenant_id IS NULL).
 *   is_active  {boolean?} Optional. Defaults to true.
 *
 * Response 201:
 *   { id, tenant_id, is_active, created_at }
 *
 * Error 409: { error: { code: 'active_config_exists', message, hint } }
 *   Returned when a unique-violation race occurs despite the atomic-swap attempt.
 *   Callers should retry or use PUT /api/admin/intent/config/[id] to toggle an
 *   existing row.
 *
 * Error 400: { error: { code: 'unknown_tenant', message } }
 *   Returned when the supplied tenant_id UUID does not exist in the tenants table.
 *
 * @module apps/control-plane/src/app/api/admin/intent/config/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';

import { createAdminClient, intentWeightConfigs } from '@estalara/db';
import { IntentWeightsSchema, AdminIntentConfigResponseSchema } from '@estalara/shared';
import type { AdminIntentConfigResponse } from '@estalara/shared';

import { verifyTracerAdminAuth } from '@/lib/tracer-auth';

// ─── GET handler ──────────────────────────────────────────────────────────────

/**
 * GET /api/admin/intent/config
 *
 * Returns the active global intent weight config row, including the database `id`
 * which the Weight Editor page requires to PUT-update an existing row (FOLLOW-309).
 *
 * Global-only in v1: ?tenant_id= returns 400 unsupported_param (ADR-0013 §Decision 2).
 *
 * Rule K.2: if the DB is configured but throws, return 500 + Sentry capture.
 * There is no mock fallback for admin reads — a broken admin API must be visible.
 *
 * @returns 200 AdminIntentConfigResponse — all fields present, id/created_at null when no row.
 * @returns 400 if ?tenant_id= param is present (unsupported in v1).
 * @returns 401/403 if auth fails.
 * @returns 500 if DB is unconfigured or the configured DB throws (Rule K.2).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authResult = await verifyTracerAdminAuth(req);
  if (!authResult.ok) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: authResult.message } },
      { status: authResult.status },
    );
  }

  // ── Reject ?tenant_id= — global-only in v1 (ADR-0013, CEO decision 2026-06-14) ──
  const tenantIdParam = req.nextUrl.searchParams.get('tenant_id');
  if (tenantIdParam !== null) {
    return NextResponse.json(
      {
        error: {
          code: 'unsupported_param',
          message: '?tenant_id is not supported on this route in v1; omit it',
        },
      },
      { status: 400 },
    );
  }

  // ── Rule K.2: admin reads also require a configured DB ────────────────────
  const dbConfigured =
    Boolean(process.env.DATABASE_URL_ADMIN) || Boolean(process.env.DATABASE_URL_DIRECT);
  if (!dbConfigured) {
    return NextResponse.json(
      {
        error: {
          code: 'db_error',
          message:
            'DATABASE_URL_ADMIN or DATABASE_URL_DIRECT must be set to read intent weight configs',
        },
      },
      { status: 500 },
    );
  }

  // ── Query the active global row ───────────────────────────────────────────
  try {
    const db = createAdminClient();
    const rows = await db
      .select({
        id: intentWeightConfigs.id,
        tenantId: intentWeightConfigs.tenantId,
        weights: intentWeightConfigs.weights,
        isActive: intentWeightConfigs.isActive,
        createdAt: intentWeightConfigs.createdAt,
      })
      .from(intentWeightConfigs)
      .where(and(isNull(intentWeightConfigs.tenantId), eq(intentWeightConfigs.isActive, true)))
      .orderBy(desc(intentWeightConfigs.createdAt))
      .limit(1);

    // No active global row → return the nulled sentinel shape (ADR-0013 nullability contract).
    if (rows.length === 0) {
      const body: AdminIntentConfigResponse = AdminIntentConfigResponseSchema.parse({
        id: null,
        tenant_id: null,
        is_active: false,
        weights: {},
        created_at: null,
      });
      return NextResponse.json(body, { status: 200 });
    }

    // rows.length === 0 guard is above; rows[0] is always defined here.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length checked above
    const row = rows[0]!;
    // Parse weights through IntentWeightsSchema to validate stored data.
    const weightsResult = IntentWeightsSchema.safeParse(row.weights);
    const weights = weightsResult.success ? weightsResult.data : {};

    const body: AdminIntentConfigResponse = AdminIntentConfigResponseSchema.parse({
      id: row.id,
      tenant_id: null,
      is_active: true,
      weights,
      created_at: row.createdAt.toISOString(),
    });
    return NextResponse.json(body, { status: 200 });
  } catch (err: unknown) {
    // Configured-but-failed: fail loud (Rule K.2). NO mock fallback for reads.
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      extra: { route: 'GET /api/admin/intent/config', message },
    });
    return NextResponse.json(
      {
        error: {
          code: 'db_error',
          message: 'Postgres query failed — see Sentry for details',
        },
      },
      { status: 500 },
    );
  }
}

// ─── Postgres error codes ─────────────────────────────────────────────────────

/** Unique-constraint violation (intent_weight_configs_one_active partial index). */
const PG_UNIQUE_VIOLATION = '23505';

/** Foreign-key violation (tenant_id → tenants.id). */
const PG_FK_VIOLATION = '23503';

// ─── Request body schema ──────────────────────────────────────────────────────

/**
 * POST body schema.
 *
 * `weights` is required and validated against the canonical IntentWeightsSchema
 * (ADR-0012 §2, FOLLOW-294). `.strict()` on IntentWeightsSchema ensures unknown
 * keys from the old DEFAULT_WEIGHTS shape are rejected at this boundary.
 *
 * `tenant_id` is optional: omit for a global default row (tenant_id IS NULL),
 * supply a UUID for a per-tenant override.
 *
 * `is_active` defaults to true. Set to false to create an inactive config row
 * (useful for staging a config before activating it).
 */
const PostBodySchema = z.object({
  weights: IntentWeightsSchema,
  tenant_id: z.string().uuid('tenant_id must be a valid UUID').optional(),
  is_active: z.boolean().optional().default(true),
});

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

// ─── POST handler ─────────────────────────────────────────────────────────────

/**
 * POST /api/admin/intent/config
 *
 * When `is_active` is true (default), performs an atomic deactivate-then-insert
 * transaction so the one-active-row invariant is maintained without hitting the
 * `intent_weight_configs_one_active` partial unique index under normal operation.
 *
 * Change-active-config workflow:
 *   To replace an existing active config, POST with `{ weights: <new>, tenant_id: <id?> }`.
 *   The old active row is deactivated atomically and the new row becomes active.
 *   The old row is retained (soft-deactivated) for audit history.
 *   To inspect the current active row, use GET /api/intent/config (SDK-facing) or
 *   query intent_weight_configs directly via the admin DB.
 *
 * @returns 201 { id, tenant_id, is_active, created_at } on success.
 * @returns 400 on Zod body validation failure or unknown tenant_id FK.
 * @returns 401/403 if auth fails.
 * @returns 409 if the unique constraint fires despite the swap attempt (race).
 * @returns 500 if DB is unconfigured or the configured DB throws (Rule K.2 — fail loud).
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authResult = await verifyTracerAdminAuth(req);
  if (!authResult.ok) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: authResult.message } },
      { status: authResult.status },
    );
  }

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

  const parsed = PostBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: 'validation_error', details: parsed.error.flatten() } },
      { status: 400 },
    );
  }

  const { weights, tenant_id: tenantId, is_active: isActive } = parsed.data;

  // ── Rule K.2: no mock write path — DB must be configured ──────────────────
  // For write routes there is no "unconfigured DB" fallback. A missing DB URL
  // means we cannot durably store the config; surface 500 immediately.
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

  // ── Write to Postgres ─────────────────────────────────────────────────────
  try {
    const db = createAdminClient();

    let row: {
      id: string;
      tenantId: string | null;
      isActive: boolean;
      createdAt: Date;
    };

    if (isActive) {
      // Atomic swap: deactivate existing active rows in the same scope, then insert.
      // This prevents hitting the intent_weight_configs_one_active partial unique index
      // under normal operation. The transaction guarantees both steps are atomic.
      const rows = await db.transaction(async (tx) => {
        // Step 1: deactivate all currently-active rows in the same scope.
        // Scope: tenant_id = tenantId (per-tenant), or IS NULL (global).
        const scopeCondition =
          tenantId !== undefined
            ? eq(intentWeightConfigs.tenantId, tenantId)
            : isNull(intentWeightConfigs.tenantId);

        await tx
          .update(intentWeightConfigs)
          .set({ isActive: false })
          .where(and(eq(intentWeightConfigs.isActive, true), scopeCondition));

        // Step 2: insert the new active row.
        return tx
          .insert(intentWeightConfigs)
          .values({
            tenantId: tenantId ?? null,
            weights: weights,
            isActive: true,
          })
          .returning({
            id: intentWeightConfigs.id,
            tenantId: intentWeightConfigs.tenantId,
            isActive: intentWeightConfigs.isActive,
            createdAt: intentWeightConfigs.createdAt,
          });
      });

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      row = rows[0]!;
    } else {
      // is_active = false: plain insert, no deactivation needed.
      const rows = await db
        .insert(intentWeightConfigs)
        .values({
          tenantId: tenantId ?? null,
          weights: weights,
          isActive: false,
        })
        .returning({
          id: intentWeightConfigs.id,
          tenantId: intentWeightConfigs.tenantId,
          isActive: intentWeightConfigs.isActive,
          createdAt: intentWeightConfigs.createdAt,
        });

      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      row = rows[0]!;
    }

    return NextResponse.json(
      {
        id: row.id,
        tenant_id: row.tenantId,
        is_active: row.isActive,
        created_at: row.createdAt.toISOString(),
      },
      { status: 201 },
    );
  } catch (err: unknown) {
    const code = pgCode(err);

    // FK violation: tenant_id not found in tenants table.
    if (code === PG_FK_VIOLATION) {
      return NextResponse.json(
        {
          error: {
            code: 'unknown_tenant',
            message: `tenant_id '${tenantId ?? 'null'}' does not exist in the tenants table`,
          },
        },
        { status: 400 },
      );
    }

    // Unique violation: the one-active invariant was breached despite the atomic swap.
    // This can only happen under a concurrent write race. Surface as 409.
    if (code === PG_UNIQUE_VIOLATION) {
      return NextResponse.json(
        {
          error: {
            code: 'active_config_exists',
            message:
              'An active intent weight config already exists for this scope. ' +
              'Use PUT /api/admin/intent/config/[id] to update an existing row, or retry.',
            hint: 'This error indicates a concurrent write race. Retry the POST.',
          },
        },
        { status: 409 },
      );
    }

    // Configured-but-failed: fail loud (Rule K.2). NO mock fallback for writes.
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      extra: { route: 'POST /api/admin/intent/config', tenantId, message },
    });
    return NextResponse.json(
      {
        error: {
          code: 'db_error',
          message: 'Postgres insert failed — see Sentry for details',
        },
      },
      { status: 500 },
    );
  }
}
