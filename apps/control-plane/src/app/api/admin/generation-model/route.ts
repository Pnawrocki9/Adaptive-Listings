/**
 * GET  /api/admin/generation-model — return current global LLM generation model config
 * PUT  /api/admin/generation-model — update global LLM generation model (admin-only)
 *
 * This endpoint manages the GLOBAL default generation model (FOLLOW-161).
 * There is NO per-tenant override for this setting (locked CEO decision 2026-06-01).
 *
 * Auth:
 *   GET — Estalara staff (any tier — read-only view of a platform setting). The
 *         agency admin/owner read (the deleted /dashboard/settings page) was
 *         removed with the agency roles by FOLLOW-1335.
 *   PUT — Estalara platform staff ONLY (FOLLOW-456 / audit F-13). This setting is
 *         PLATFORM-GLOBAL (no per-tenant override — locked CEO decision 2026-06-01),
 *         so only an identified Estalara superadmin may mutate it. Gated via
 *         `verifyTracerAdminAuth` (same staff gate
 *         as the K.3.6 tracer admin routes / FOLLOW-267) and then on `isSuperadmin`
 *         (FOLLOW-598; ADR-0018 #3). Since FOLLOW-1321 the Bearer <ADMIN_API_SECRET>
 *         path is 403 here too: it carries no identity, and every write appends a
 *         `staff_audit_log` row attributed to the acting superadmin.
 *
 * Auth mechanism:
 *   - GET: verifyTracerAdminAuth() must return ok (ADMIN_API_SECRET Bearer, a staff
 *     JWT, or a staff @supabase/ssr browser session); anything else is 401.
 *   - PUT: verifyTracerAdminAuth() must return `kind: 'staff'` (a verified Supabase
 *     JWT/session whose app_metadata/claims carry `estalara_staff: true`) with
 *     `isSuperadmin`. Ops / readonly staff and the ADMIN_API_SECRET Bearer are rejected
 *     (403) by the rank check.
 *   - The PUT body carries only the new model value; all authorization comes from
 *     the verified staff auth above, never from the request body.
 *
 * Replay defence — PARTIAL:
 *   - The SSR session path validates the token with Supabase (`getUser()`, expiry included).
 *     The Bearer / legacy-cookie JWT path does NOT check `exp` today (`getAuthClaims` verifies
 *     the HMAC signature only), so an expired staff token is still accepted there until
 *     FOLLOW-1307 (plan Phase 6 S1) adds the check. Replaying a live token re-sets the same
 *     model (idempotent state-wise) and appends one more attributed audit row.
 *
 * Audit (ADR-0018 §3/§3a, FOLLOW-1321): the `app_config` upsert and one
 * `staff_audit_log` row (`generation_model.update`) commit in ONE `db.transaction()`.
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
// GET and PUT both use verifyTracerAdminAuth (staff-only, session-aware, carries the role rank);
// the agency read via requireTenantSessionAccess went with FOLLOW-1335.
import { verifyTracerAdminAuth } from '@/lib/tracer-auth';
import {
  getGlobalGenerationModel,
  setGlobalGenerationModel,
  ALLOWED_GENERATION_MODELS,
  DEFAULT_GENERATION_MODEL,
} from '@/lib/global-config-store';
import { createAdminClient, appConfig, staffAuditLog } from '@estalara/db';
import type { Database } from '@estalara/db';
import { eq } from 'drizzle-orm';

// ─── Schema ───────────────────────────────────────────────────────────────────

const PutBodySchema = z.object({
  generation_model: z.enum(ALLOWED_GENERATION_MODELS),
});

/** Best-effort client IP for the staff audit trail (no throw if absent). */
function requestIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip');
}

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
 * the /admin/settings page path). Read-only; PUT below needs a superadmin.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const staffAuth = await verifyTracerAdminAuth(req);
  if (!staffAuth.ok) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: 'Estalara staff auth is required' } },
      { status: 401 },
    );
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
 * platform-global setting with no per-tenant override. See
 * `verifyTracerAdminAuth` (`@/lib/tracer-auth`) for the accepted auth paths.
 *
 * Tightened (RETRO-187 §4a LG-2 / CEO Q3, FOLLOW-598): staff callers must hold the
 * `estalara:superadmin` role — below-superadmin staff is 403. FOLLOW-1321 removed the
 * former `ADMIN_API_SECRET` exemption (see the gate comment in the body).
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

  // Superadmin gate (RETRO-187 §4a LG-2 / CEO Q3, FOLLOW-598; ADR-0018 #3 reaffirmed
  // by ESC-085): mutating the PLATFORM-GLOBAL generation model — the model EVERY
  // tenant is generated with — is a rank-3 (estalara:superadmin) action.
  //
  // FOLLOW-1321: the headless `ADMIN_API_SECRET` path (`kind: 'secret'`) used to be
  // exempt. It is now 403 like every other non-superadmin caller: it carries no staff
  // identity, so the write could not be attributed in `staff_audit_log`, and no
  // repo automation PUTs this route (the secret's only consumers are GET reads).
  if (authResult.kind !== 'staff' || !authResult.isSuperadmin) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'Changing the global generation model requires the estalara:superadmin role',
        },
      },
      { status: 403 },
    );
  }

  // A real Supabase user id on both staff paths (JWT `sub` / SSR `user.id`).
  const updatedBy = authResult.userId;

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
    const db = createAdminClient();
    await db.transaction(async (tx) => {
      // The shared store helper runs on this tx (FOLLOW-609 pattern, see
      // api/demo/override): the cast via `unknown` bridges Drizzle's transaction
      // generic and `Database`, which are structurally compatible at runtime.
      await setGlobalGenerationModel(generation_model, updatedBy, tx as unknown as Database);

      // Staff audit trail (ADR-0018 §3) — AWAITED inside the tx so the model change
      // and its audit row commit or roll back together (§3a).
      await tx.insert(staffAuditLog).values({
        adminUserId: updatedBy,
        action: 'generation_model.update',
        targetTenantId: null,
        payload: { generation_model },
        ipAddress: requestIp(req),
        userAgent: req.headers.get('user-agent'),
      });
    });

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
