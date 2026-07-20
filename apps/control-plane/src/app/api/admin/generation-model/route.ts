/**
 * GET  /api/admin/generation-model — return current global LLM generation model config
 * PUT  /api/admin/generation-model — update global LLM generation model (admin-only)
 *
 * This endpoint manages the GLOBAL default generation model (FOLLOW-161).
 * There is NO per-tenant override for this setting (locked CEO decision 2026-06-01).
 *
 * Auth:
 *   GET — Estalara staff (any tier — read-only view of a platform setting), OR
 *         agency:admin / agency:owner (global admin setting, not viewer-visible).
 *         The staff path was added for the /admin/settings page (Phase 0 of the
 *         superadmin-access work, 2026-07-20): staff sessions carry no agency_role,
 *         so the original agency-only GET returned 401 for the very accounts that
 *         are the ONLY ones allowed to PUT — leaving the selector readable by
 *         accounts that cannot write and unreadable by the account that can.
 *   PUT — Estalara platform staff ONLY (FOLLOW-456 / audit F-13). This setting is
 *         PLATFORM-GLOBAL (no per-tenant override — locked CEO decision 2026-06-01),
 *         so a tenant's own `agency:admin`/`agency:owner` role must NOT be sufficient
 *         to mutate it: that would let any tenant's admin change the model every other
 *         tenant is generated with. Gated via `verifyTracerAdminAuth` (same staff gate
 *         as the K.3.6 tracer admin routes / FOLLOW-267) — Bearer <ADMIN_API_SECRET>
 *         (constant-time compare) OR a verified Supabase JWT/SSR session with
 *         `estalara_staff: true`.
 *
 * Auth mechanism:
 *   - GET: requireTenantSessionAccess() accepts a Bearer JWT / legacy cookie OR the
 *     @supabase/ssr browser session (FOLLOW-555), verifies it, extracts agency_role
 *     from the resolved claims, and throws on invalid/expired/absent auth.
 *   - PUT: verifyTracerAdminAuth() requires either a constant-time-compared
 *     ADMIN_API_SECRET Bearer token, or a verified Supabase JWT/session whose
 *     app_metadata/claims carry `estalara_staff: true`. Tenant `agency:admin` JWTs
 *     are explicitly rejected (403) by this guard, not merely unauthenticated (401).
 *   - The PUT body carries only the new model value; all authorization comes from
 *     the verified staff auth above, never from the request body.
 *
 * Replay defence:
 *   - Supabase JWTs carry an `exp` claim (HMAC-signed). Both requireTenantSessionAccess and
 *     verifyTracerAdminAuth's JWT path verify expiry on every call. Replaying an
 *     expired token fails. ADMIN_API_SECRET is a long-lived bearer secret; replay
 *     protection is TLS + the operation being idempotent (setting the same model
 *     twice is a no-op state-wise).
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
// FOLLOW-555 (A3-F-04): GET is called by the settings dashboard page, so it must accept
// the @supabase/ssr browser session (not just Bearer/legacy cookie). PUT stays on
// verifyTracerAdminAuth (staff-only, already session-aware).
import { requireTenantSessionAccess } from '@/lib/session-auth';
import { verifyTracerAdminAuth } from '@/lib/tracer-auth';
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
 * Accepts Estalara staff auth (ADMIN_API_SECRET / staff JWT / staff SSR session —
 * the /admin/settings page path) OR an agency:admin / agency:owner session (the
 * legacy /dashboard/settings page path). Read-only in both cases; PUT below
 * stays staff-only.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // Staff path first (additive — cannot loosen the agency gate below: a non-staff
  // agency session fails verifyTracerAdminAuth and falls through to the original
  // agency:admin check unchanged).
  const staffAuth = await verifyTracerAdminAuth(req);
  if (!staffAuth.ok) {
    let claims;
    try {
      claims = await requireTenantSessionAccess(req, 'agency:admin');
    } catch {
      return NextResponse.json(
        {
          error: {
            code: 'unauthorized',
            message:
              'Estalara staff auth, or a valid JWT with agency:admin or agency:owner role, is required',
          },
        },
        { status: 401 },
      );
    }

    // Suppress unused warning — claims are required for auth gating even if not used in body.
    void claims;
  }

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
 *
 * Estalara platform staff ONLY (FOLLOW-456 / audit F-13) — this is a
 * platform-global setting with no per-tenant override, so a tenant's own
 * agency:admin/agency:owner role must not authorize the write. See
 * `verifyTracerAdminAuth` (`@/lib/tracer-auth`) for the accepted auth paths.
 *
 * Body: { "generation_model": "claude-sonnet-4-6" }
 */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const authResult = await verifyTracerAdminAuth(req);
  if (!authResult.ok) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: authResult.message } },
      { status: authResult.status },
    );
  }

  // `claims` is null on the ADMIN_API_SECRET path (no user identity attached to
  // a shared secret) and a real Supabase user id on the staff_jwt/staff_session
  // paths. `updated_by` is a nullable uuid column — null is safe (never a
  // sentinel string in a uuid column, per CONVENTIONS_PATCH.md).
  const updatedBy = authResult.claims?.sub ?? null;

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
