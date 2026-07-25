/**
 * PATCH /api/tenants/:id — update mutable tenant settings.
 *
 * Currently supports: quiz_enabled (boolean).
 *
 * Auth (ADR-0018 §2, FOLLOW-657): `resolveTenantAccess` with `allowStaffOverride`.
 * The agency path is byte-unchanged — tenant sourced from the session claim,
 * must match the `:id` param (401 for missing/invalid session, 403 for
 * mismatched tenant). An Estalara staff caller may act on any tenant: the `:id`
 * path segment itself IS the explicit tenant id (URL-scoped, per the ADR's own
 * `/admin/tenants/[id]/*` precedent — no separate `?tenant_id=` query param is
 * needed since this route already carries the target tenant in its path), and
 * it is validated against the `tenants` table before any query runs (invariant
 * 3/5). Staff writes require `estalara:ops` or higher (rank ≥ 2, CEO Q3); the
 * headless `ADMIN_API_SECRET` Bearer path is REJECTED for staff (RETRO-187 — a
 * shared secret is not attributable to a staff user).
 *
 * RLS: the update is scoped to the resolved tenant's own row (WHERE id = tenantId).
 * Only columns listed in the Zod schema are ever written — no other columns are touched.
 *
 * Staff write atomicity (ADR-0018 §3a, FOLLOW-657): a staff PATCH and its
 * `staff_audit_log` row commit-or-roll-back TOGETHER in ONE `db.transaction()`.
 * Any failure inside the tx rolls BOTH back → 500 (no orphan mutation). The
 * agency path is unchanged and NOT audited (ADR-0018 §3).
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
import * as Sentry from '@sentry/nextjs';

import { createAdminClient, tenants, staffAuditLog } from '@estalara/db';
import { resolveTenantAccess, AccessError, type TenantAccess } from '@/lib/session-auth';

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

/** Best-effort client IP for the staff audit trail (no throw if absent). */
function requestIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip');
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
 * @returns 403 if the authenticated tenant does not match the `:id` param, or a
 *   staff caller is below `estalara:ops` / not identifiable.
 * @returns 404 if the tenant row is not found (e.g. deleted).
 * @returns 500 on unexpected DB error.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: tenantId } = await params;

  // ── Auth: agency session (byte-unchanged, must match :id) OR Estalara staff
  // override (ADR-0018 §2, FOLLOW-657). `:id` doubles as the explicit staff
  // tenant param — validated against `tenants` before any query runs.
  let access: TenantAccess;
  try {
    access = await resolveTenantAccess(req, { allowStaffOverride: true, tenantId });
  } catch (err) {
    if (err instanceof AccessError) {
      // Preserves the pre-FOLLOW-657 body shape for the two agency-facing statuses
      // (401 'Unauthorized' / 403 'Forbidden: tenant mismatch'); other statuses
      // (400/404/500, only reachable via the new staff path) surface err.message.
      const message =
        err.status === 401
          ? 'Unauthorized'
          : err.status === 403
            ? 'Forbidden: tenant mismatch'
            : err.message;
      return NextResponse.json({ error: message }, { status: err.status });
    }
    throw err;
  }

  // Write-rank gate (CEO Q3, ADR-0018 §4): staff below `estalara:ops` is view-only.
  if (access.via === 'staff' && !access.canWrite) {
    return NextResponse.json(
      { error: 'Forbidden: staff write requires estalara:ops or higher' },
      { status: 403 },
    );
  }

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

  // ── STAFF write — atomic update + audit (ADR-0018 §3a, FOLLOW-657) ────────
  if (access.via === 'staff') {
    try {
      const db = createAdminClient();
      let row: { id: string; quizEnabled: boolean } | undefined;
      await db.transaction(async (tx) => {
        const updated = await tx
          .update(tenants)
          .set({ quizEnabled: body.quiz_enabled, updatedAt: new Date() })
          .where(eq(tenants.id, tenantId))
          .returning({ id: tenants.id, quizEnabled: tenants.quizEnabled });
        row = updated[0];
        if (!row) return; // tenant vanished mid-request; audit skipped, handled below.
        await tx.insert(staffAuditLog).values({
          adminUserId: access.staff.sub,
          action: 'tenant.quiz_enabled_update',
          targetTenantId: tenantId,
          payload: { quiz_enabled: body.quiz_enabled },
          ipAddress: requestIp(req),
          userAgent: req.headers.get('user-agent'),
        });
      });
      if (!row) {
        return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
      }
      return NextResponse.json({ id: row.id, quiz_enabled: row.quizEnabled }, { status: 200 });
    } catch (err: unknown) {
      Sentry.captureException(err, {
        tags: { route: 'tenants/[id]', staff_audit_error: 'true' },
        extra: { tenant_id: tenantId, admin_user_id: access.staff.sub },
      });
      return NextResponse.json(
        {
          error:
            'The tenant update could not be recorded atomically with its staff audit row; ' +
            'the change was rolled back and NOT applied. Retry the action.',
        },
        { status: 500 },
      );
    }
  }

  // ── AGENCY write — UNCHANGED, non-transactional, NOT audited (ADR-0018 §3) ─
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
