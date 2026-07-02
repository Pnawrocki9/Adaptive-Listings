/**
 * PATCH /api/tenants/:id — update mutable tenant settings.
 *
 * Currently supports: quiz_enabled (boolean).
 *
 * Auth: Bearer JWT or Supabase SSR browser session via `getSessionAuthClaims()`
 * (apps/control-plane/src/lib/session-auth.ts, FOLLOW-454). The tenant in the
 * resolved claims must match the `:id` param — 401 for missing/invalid session,
 * 403 for mismatched tenant.
 *
 * RLS: the update is scoped to the authenticated tenant's own row (WHERE id = tenantId).
 * Only columns listed in the Zod schema are ever written — no other columns are touched.
 *
 * FOLLOW-102 (AC2): Adds quiz_enabled toggle. Default true — pilot tenant
 * behavior is unchanged. Sprint 13b freeze rule: no pilot-tenant data is modified.
 *
 * @module apps/control-plane/src/app/api/tenants/[id]/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { eq } from 'drizzle-orm';

import { createAdminClient, tenants } from '@estalara/db';
import { getSessionAuthClaims } from '@/lib/session-auth';

// ─── Request schema ────────────────────────────────────────────────────────────

/**
 * Accepted fields for PATCH /api/tenants/:id.
 *
 * All fields are optional — a PATCH request may update any subset.
 * quiz_enabled: boolean — controls the quiz widget for the tenant (FOLLOW-102).
 */
const PatchTenantSchema = z.object({
  quiz_enabled: z.boolean().optional(),
});

type PatchTenantBody = z.infer<typeof PatchTenantSchema>;

// ─── Auth helper ───────────────────────────────────────────────────────────────

/**
 * Validate the Bearer JWT and assert the caller's tenant matches `tenantId`.
 * Returns `{ ok: true }` on success, or a NextResponse error on failure.
 */
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

// ─── PATCH handler ─────────────────────────────────────────────────────────────

/**
 * PATCH /api/tenants/:id
 *
 * Updates mutable tenant settings. Currently: quiz_enabled.
 *
 * @returns 200 `{ id, quiz_enabled }` on success.
 * @returns 400 on validation failure or when no updatable fields are supplied.
 * @returns 401 if auth token is missing or invalid.
 * @returns 403 if the authenticated tenant does not match the `:id` param.
 * @returns 404 if the tenant row is not found (e.g. deleted).
 * @returns 500 on unexpected DB error.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: tenantId } = await params;

  // ── Auth: tenant-scoped JWT, must match :id ──────────────────────────────
  const authResult = await validateTenantAuth(req, tenantId);
  if (authResult instanceof NextResponse) return authResult;

  // ── Parse body ────────────────────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = PatchTenantSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const body: PatchTenantBody = parsed.data;

  // ── Require at least one updatable field ──────────────────────────────────
  if (body.quiz_enabled === undefined) {
    return NextResponse.json(
      { error: 'No updatable fields provided. Accepted: quiz_enabled' },
      { status: 400 },
    );
  }

  // ── Mock path — no DB in CI ───────────────────────────────────────────────
  if (!process.env.DATABASE_URL_ADMIN && !process.env.DATABASE_URL_DIRECT) {
    return NextResponse.json(
      {
        id: tenantId,
        quiz_enabled: body.quiz_enabled,
        mock: true,
      },
      { status: 200 },
    );
  }

  // ── DB update ─────────────────────────────────────────────────────────────
  try {
    const db = createAdminClient();

    const updated = await db
      .update(tenants)
      .set({
        quizEnabled: body.quiz_enabled,
        updatedAt: new Date(),
      })
      .where(eq(tenants.id, tenantId))
      .returning({
        id: tenants.id,
        quizEnabled: tenants.quizEnabled,
      });

    const row = updated[0];
    if (!row) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    return NextResponse.json(
      {
        id: row.id,
        quiz_enabled: row.quizEnabled,
      },
      { status: 200 },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[tenants/[id] PATCH] DB error:', msg);
    return NextResponse.json({ error: 'Failed to update tenant' }, { status: 500 });
  }
}
