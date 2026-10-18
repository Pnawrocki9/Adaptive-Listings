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
 *         as the K.3.6 tracer admin routes / FOLLOW-267) and then on `isSuperadmin`
 *         (FOLLOW-598; ADR-0018 #3). Since FOLLOW-1321 the Bearer <ADMIN_API_SECRET>
 *         path is 403 here too: it carries no identity, and every write appends a
 *         `staff_audit_log` row attributed to the acting superadmin.
 *
 * Auth mechanism:
 *   - GET: requireTenantSessionAccess() accepts a Bearer JWT / legacy cookie OR the
 *     @supabase/ssr browser session (FOLLOW-555), verifies it, extracts agency_role
 *     from the resolved claims, and throws on invalid/expired/absent auth.
 *   - PUT: verifyTracerAdminAuth() must return `kind: 'staff'` (a verified Supabase
 *     JWT/session whose app_metadata/claims carry `estalara_staff: true`) with
 *     `isSuperadmin`. Tenant `agency:admin` JWTs are rejected (403) by the guard, ops /
 *     readonly staff and the ADMIN_API_SECRET Bearer are rejected (403) by the rank check.
 *   - The PUT body carries only the new model value; all authorization comes from
 *     the verified staff auth above, never from the request body.
 *
 * Replay defence:
 *   - Supabase JWTs carry an `exp` claim (HMAC-signed). Both requireTenantSessionAccess and
 *     verifyTracerAdminAuth's JWT path verify expiry on every call. Replaying an
 *     expired token fails. Replaying a live one re-sets the same model (idempotent
 *     state-wise) and appends one more attributed audit row.
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
// FOLLOW-555 (A3-F-04): GET is called by the settings dashboard page, so it must accept
// the @supabase/ssr browser session (not just Bearer/legacy cookie). PUT stays on
// verifyTracerAdminAuth (staff-only, already session-aware, carries the role rank).
import { requireTenantSessionAccess } from '@/lib/session-auth';
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
