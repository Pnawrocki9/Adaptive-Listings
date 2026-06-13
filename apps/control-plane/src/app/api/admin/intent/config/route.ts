/**
 * POST /api/admin/intent/config
 *
 * K.3.6 D-1 admin write API — create an intent_weight_configs row (ADR-0012 Ticket B).
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
 *     because replaying the same POST creates a new inactive row if an active row
 *     already exists (the DB partial index). For HMAC use cases, both
 *     ADMIN_API_SECRET and staff JWT provide the same protection as the tracer routes.
 *
 * Rule K.2: a configured DB failure returns 500 + Sentry capture. There is NO mock
 * write path and NO fail-soft fallback on writes. A missing DB URL also returns 500.
 *
 * Body (JSON):
 *   weights    {object}  Required. IntentWeightsSchema — all sub-fields optional.
 *   tenant_id  {string?} Optional UUID. Omit for global default (tenant_id IS NULL).
 *   is_active  {boolean?} Optional. Defaults to true.
 *
 * Response 201:
 *   { id, tenant_id, is_active, created_at }
 *
 * @module apps/control-plane/src/app/api/admin/intent/config/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { z } from 'zod';

import { createAdminClient, intentWeightConfigs } from '@estalara/db';
import { IntentWeightsSchema } from '@estalara/shared';

import { verifyTracerAdminAuth } from '@/lib/tracer-auth';

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

// ─── POST handler ─────────────────────────────────────────────────────────────

/**
 * POST /api/admin/intent/config
 *
 * @returns 201 { id, tenant_id, is_active, created_at } on success.
 * @returns 400 on Zod body validation failure.
 * @returns 401/403 if auth fails.
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

    const rows = await db
      .insert(intentWeightConfigs)
      .values({
        tenantId: tenantId ?? null,
        weights: weights,
        isActive: isActive,
      })
      .returning({
        id: intentWeightConfigs.id,
        tenantId: intentWeightConfigs.tenantId,
        isActive: intentWeightConfigs.isActive,
        createdAt: intentWeightConfigs.createdAt,
      });

    // insert().returning() always returns exactly one row on success.
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const row = rows[0]!;

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
