/**
 * GET  /api/admin/generation-model — return current global LLM generation model config
 * PUT  /api/admin/generation-model — update global LLM generation model (admin-only)
 *
 * This endpoint manages the GLOBAL default generation model (FOLLOW-161).
 * There is NO per-tenant override for this setting (locked CEO decision 2026-06-01).
 *
 * Auth:
 *   GET — agency:admin or agency:owner minimum (global admin setting, not viewer-visible)
 *   PUT — agency:admin or agency:owner (mutating; production-grade JWT via requireTenantAccess)
 *
 * Auth mechanism:
 *   - requireTenantAccess() verifies the Supabase JWT (HMAC-signed RS256),
 *     extracts agency_role from verified claims, and throws on invalid/expired tokens.
 *   - Tenant claims come from the JWT — never from the request body.
 *   - The PUT body carries only the new model value; all authorization comes from JWT claims.
 *
 * Replay defence:
 *   - Supabase JWTs carry an `exp` claim (typ HS256 HMAC). requireTenantAccess verifies
 *     expiry on every call. Replaying an expired token fails.
 *
 * Allow-list validation:
 *   - model must be one of ALLOWED_GENERATION_MODELS; setGlobalGenerationModel rejects
 *     any other value before the DB write.
 *
 * Fail-loud contract (Rule K.2):
 *   - DB configured-but-threw → 500 with explicit error code (never silently falls back).
 *   - DB not configured (env absent) → getGlobalGenerationModel returns the default.
 *
 * Response shape (200):
 *   {
 *     generation_model: string,         // current effective model
 *     allowed_models: string[],         // curated allow-list
 *     is_default: boolean,              // true when no DB row has been written yet
 *     updated_at: string | null         // ISO timestamp of last admin update
 *   }
 *
 * @module apps/control-plane/src/app/api/admin/generation-model/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireTenantAccess } from '@estalara/auth';
import {
  getGlobalGenerationModel,
  setGlobalGenerationModel,
  ALLOWED_GENERATION_MODELS,
  DEFAULT_GENERATION_MODEL,
} from '@/lib/global-config-store';
import { createAdminClient, appConfig } from '@estalara/db';
import { eq } from 'drizzle-orm';

// ─── Schema ───────────────────────────────────────────────────────────────────

const PutBodySchema = z.object({
  generation_model: z.enum(ALLOWED_GENERATION_MODELS),
});

// ─── Internal: read current row metadata ─────────────────────────────────────

async function readConfigRow(): Promise<{
  value: string;
  updatedAt: Date | null;
  isDefault: boolean;
} | null> {
  const dbUrl = process.env.DATABASE_URL ?? process.env.SUPABASE_DB_URL;
  if (!dbUrl) return null;

  try {
    const db = createAdminClient();
    const rows = await db
      .select({ value: appConfig.value, updatedAt: appConfig.updatedAt })
      .from(appConfig)
      .where(eq(appConfig.key, 'generation_model'))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return {
      value: row.value,
      updatedAt: row.updatedAt,
      isDefault: row.value === DEFAULT_GENERATION_MODEL,
    };
  } catch {
    return null;
  }
}

// ─── GET ──────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/generation-model
 *
 * Returns the current global generation model configuration.
 * Requires agency:admin or agency:owner role.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  let claims;
  try {
    claims = await requireTenantAccess(req, 'agency:admin');
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'unauthorized',
          message: 'Valid JWT with agency:admin or agency:owner role is required',
        },
      },
      { status: 401 },
    );
  }

  // Suppress unused warning — claims are required for auth gating even if not used in body.
  void claims;

  try {
    const model = await getGlobalGenerationModel();
    const row = await readConfigRow();

    return NextResponse.json({
      generation_model: model,
      allowed_models: [...ALLOWED_GENERATION_MODELS],
      is_default: row === null || row.value === DEFAULT_GENERATION_MODEL,
      updated_at: row?.updatedAt?.toISOString() ?? null,
    });
  } catch (err: unknown) {
    console.error(
      '[admin/generation-model GET] DB read failed:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to read generation model config' } },
      { status: 500 },
    );
  }
}

// ─── PUT ─────────────────────────────────────────────────────────────────────

/**
 * PUT /api/admin/generation-model
 *
 * Updates the global default LLM generation model.
 * Requires agency:admin or agency:owner role.
 *
 * Body: { "generation_model": "claude-sonnet-4-6" }
 */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  let claims;
  try {
    claims = await requireTenantAccess(req, 'agency:admin');
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'unauthorized',
          message: 'Valid JWT with agency:admin or agency:owner role is required',
        },
      },
      { status: 401 },
    );
  }

  const updatedBy = claims.sub;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'validation_failed', message: 'Request body must be valid JSON' } },
      { status: 400 },
    );
  }

  const parsed = PutBodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'validation_failed',
          message: 'Invalid request body — generation_model must be in the allowed list',
          details: parsed.error.flatten(),
          allowed_models: [...ALLOWED_GENERATION_MODELS],
        },
      },
      { status: 400 },
    );
  }

  const { generation_model } = parsed.data;

  try {
    await setGlobalGenerationModel(generation_model, updatedBy);

    return NextResponse.json({
      generation_model,
      allowed_models: [...ALLOWED_GENERATION_MODELS],
      is_default: generation_model === DEFAULT_GENERATION_MODEL,
      updated_at: new Date().toISOString(),
    });
  } catch (err: unknown) {
    console.error(
      '[admin/generation-model PUT] DB write failed:',
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to save generation model config' } },
      { status: 500 },
    );
  }
}
