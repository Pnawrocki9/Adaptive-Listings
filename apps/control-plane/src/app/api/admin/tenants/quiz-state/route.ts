/**
 * GET  /api/admin/tenants/quiz-state?tenant_id=<uuid> — read a tenant's quiz
 *      ON/OFF state (staff/superadmin only).
 * PUT  /api/admin/tenants/quiz-state?tenant_id=<uuid> — set `tenants.quiz_enabled`
 *      (staff/superadmin only, audited, atomic).
 *
 * FOLLOW-998: the audited staff write path for the per-tenant quiz on/off switch.
 * `tenants.quiz_enabled` is the single source of truth for whether the SDK quiz
 * widget renders (FOLLOW-271 — the `enabled` key was stripped from the JSONB blob);
 * it is consumed at runtime by `GET /api/quiz/public-config`. Until now its only
 * human write path was the AGENCY dashboard toggle (`PATCH /api/tenants/:id` from
 * `/dashboard/quiz`) — staff had no port, a gap the staff quiz-config editor
 * (`admin/tenants/[id]/quiz/quiz-config-editor.tsx`) explicitly documented as a
 * planned follow-up. This route closes it, mirroring the `al-state` sibling
 * (FOLLOW-633) rather than staff-porting `PATCH /api/tenants/:id`, whose surface
 * (name/domain/status) is much wider than this one boolean.
 *
 * Auth (ADR-0018 §2): `resolveTenantAccess` with `allowStaffOverride`.
 *   STAFF-ONLY — a resolved agency session is rejected 403 (`staff_only`); the
 *   agency's own toggle lives at `PATCH /api/tenants/:id` and is unaffected. An
 *   Estalara staff caller targets a tenant via `?tenant_id=<uuid>`, validated
 *   against the `tenants` table (invariant 4); that validated id is the SINGLE
 *   tenant fence bound into every query (invariant 5). This route uses
 *   `createAdminClient()` (service-role, RLS BYPASSED), so the explicit
 *   `eq(tenants.id, access.tenantId)` fence is the ONLY tenant boundary.
 *
 *   Identity caveat (RETRO-187): `resolveTenantAccess` REJECTS the headless
 *   `ADMIN_API_SECRET` Bearer path for staff (403) — a shared secret is not
 *   attributable to a staff user, and a privileged write MUST be attributable to
 *   `staff_audit_log.adminUserId`. Staff need an identified SSR session or staff JWT.
 *
 * Write-rank gate (ADR-0018 §4): PUT rejects any staff caller below
 *   `estalara:ops` (rank < 2) with 403, mirroring every sibling staff write.
 *
 * Staff-write atomicity (ADR-0018 §3a, RETRO-202): the PUT commits the `tenants`
 *   update and the `staff_audit_log` insert (`action: 'tenant_quiz_state.update'`)
 *   TOGETHER in ONE `db.transaction()`, kept INLINE in this route file so
 *   `scripts/check-staff-write-atomicity.cjs` proves the mutation and the audit
 *   insert share the same transaction scope directly (mirrors `al-state`).
 *
 * Rule K.2 — fail loud: a configured-but-failed DB read/write returns 500 (never a
 *   fabricated default that would misrepresent whether the quiz is on/off).
 *
 * @module apps/control-plane/src/app/api/admin/tenants/quiz-state/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';
import { eq } from 'drizzle-orm';

import { createAdminClient, tenants, staffAuditLog } from '@estalara/db';
import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { accessErrorToResponse } from '@/lib/access-error-response';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TenantQuizState {
  tenant_id: string;
  /** The quiz widget ON/OFF switch (`tenants.quiz_enabled`, FOLLOW-271 SoT). */
  quiz_enabled: boolean;
  updated_at: string;
}

const PutBodySchema = z.object({
  quiz_enabled: z.boolean(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Best-effort client IP for the staff audit trail (no throw if absent). */
function requestIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip');
}

/** Resolve access shared by GET + PUT, then enforce STAFF-ONLY (no agency path). */
async function resolveStaffAccess(
  req: NextRequest,
): Promise<{ access: Extract<TenantAccess, { via: 'staff' }> } | { error: NextResponse }> {
  const tenantIdParam = req.nextUrl.searchParams.get('tenant_id');
  let access: TenantAccess;
  try {
    access = await resolveTenantAccess(req, {
      allowStaffOverride: true,
      // Lowest agency floor: a resolved agency session is allowed THROUGH the role
      // check only to be rejected below with a clear staff-only 403 (rather than an
      // ambiguous role error). The agency's own quiz toggle lives on the dashboard.
      minAgencyRole: 'agency:viewer',
      // exactOptionalPropertyTypes (RETRO-189): omit the key when absent so a staff
      // caller without ?tenant_id reaches resolve's 400.
      ...(tenantIdParam ? { tenantId: tenantIdParam } : {}),
    });
  } catch (err) {
    return { error: accessErrorToResponse(err) };
  }

  if (access.via !== 'staff') {
    return {
      error: NextResponse.json(
        {
          error: {
            code: 'staff_only',
            message: 'This quiz on/off port is staff-only — agencies use the dashboard quiz toggle',
          },
        },
        { status: 403 },
      ),
    };
  }

  return { access };
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const resolved = await resolveStaffAccess(req);
  if ('error' in resolved) return resolved.error;
  const tenantId = resolved.access.tenantId;

  try {
    const db = createAdminClient();
    const rows = await db
      .select({
        quizEnabled: tenants.quizEnabled,
        updatedAt: tenants.updatedAt,
      })
      .from(tenants)
      // invariant 5: the ONLY tenant fence on this service-role client.
      .where(eq(tenants.id, tenantId))
      .limit(1);

    const row = rows[0];
    if (!row) {
      // resolveTenantAccess already validated existence (invariant 4); a missing row
      // here means the tenant was deleted between checks — 404, not a fabricated state.
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Tenant not found' } },
        { status: 404 },
      );
    }

    const body: TenantQuizState = {
      tenant_id: tenantId,
      quiz_enabled: row.quizEnabled,
      updated_at: row.updatedAt.toISOString(),
    };
    return NextResponse.json(body, { status: 200 });
  } catch (err: unknown) {
    // Rule K.2 — fail loud: the DB is configured but the query threw. A fabricated
    // "quiz_enabled: true" here could hide that a tenant's quiz is actually OFF.
    console.error('[quiz-state GET] DB error:', err instanceof Error ? err.message : err);
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { route: 'admin/tenants/quiz-state', op: 'get' },
      extra: { tenant_id: tenantId },
    });
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to load quiz state' } },
      { status: 500 },
    );
  }
}

// ─── PUT ──────────────────────────────────────────────────────────────────────

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const resolved = await resolveStaffAccess(req);
  if ('error' in resolved) return resolved.error;
  const access = resolved.access;
  const tenantId = access.tenantId;

  // Write-rank gate (ADR-0018 §4): staff below `estalara:ops` (rank < 2) is view-only.
  if (!access.canWrite) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'Staff write requires estalara:ops or higher' } },
      { status: 403 },
    );
  }

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
          message: 'Invalid request body',
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const nextQuizEnabled = parsed.data.quiz_enabled;
  const db = createAdminClient();

  // Read the current state first (fenced on tenantId — invariant 5) so the audit row
  // carries a real before/after. A read failure fails loud (500) — we never write a
  // state we cannot attribute a delta for.
  let beforeQuizEnabled: boolean;
  try {
    const rows = await db
      .select({ quizEnabled: tenants.quizEnabled })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const row = rows[0];
    if (!row) {
      return NextResponse.json(
        { error: { code: 'not_found', message: 'Tenant not found' } },
        { status: 404 },
      );
    }
    beforeQuizEnabled = row.quizEnabled;
  } catch (err: unknown) {
    console.error(
      '[quiz-state PUT] failed to read current state:',
      err instanceof Error ? err.message : err,
    );
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { route: 'admin/tenants/quiz-state', op: 'put_read' },
      extra: { tenant_id: tenantId },
    });
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to load quiz state' } },
      { status: 500 },
    );
  }

  const updatedAt = new Date();

  // ── Atomic staff write (ADR-0018 §3a) ──────────────────────────────────────
  // The `tenants.quiz_enabled` mutation and its `staff_audit_log` row commit-or-
  // roll-back TOGETHER in ONE transaction (RETRO-190 §4a / RETRO-202), kept INLINE
  // so scripts/check-staff-write-atomicity.cjs proves the shared tx scope directly.
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(tenants)
        .set({ quizEnabled: nextQuizEnabled, updatedAt })
        .where(eq(tenants.id, tenantId));

      // Staff audit trail (§3) — attributed to the acting staff user. AWAITED inside
      // the tx so it commits atomically with the update.
      await tx.insert(staffAuditLog).values({
        adminUserId: access.staff.sub,
        action: 'tenant_quiz_state.update',
        targetTenantId: tenantId,
        payload: {
          before: { quiz_enabled: beforeQuizEnabled },
          after: { quiz_enabled: nextQuizEnabled },
        },
        ipAddress: requestIp(req),
        userAgent: req.headers.get('user-agent'),
      });
    });
  } catch (err: unknown) {
    // Any failure INSIDE the tx (the update OR the audit insert) rolls BOTH back —
    // no orphan state mutation. Fail loud: capture to Sentry and return 500, never a
    // silent unattributed 200 (Rule K.2). Retry is safe (idempotent set + fresh audit).
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { route: 'admin/tenants/quiz-state', op: 'put', staff_audit_error: 'true' },
      extra: { tenant_id: tenantId, admin_user_id: access.staff.sub },
    });
    return NextResponse.json(
      {
        error: {
          code: 'audit_write_failed',
          message:
            'The quiz on/off change could not be recorded atomically with its staff ' +
            'audit row; the change was rolled back and NOT applied. Retry the action.',
        },
      },
      { status: 500 },
    );
  }

  const body: TenantQuizState = {
    tenant_id: tenantId,
    quiz_enabled: nextQuizEnabled,
    updated_at: updatedAt.toISOString(),
  };
  return NextResponse.json(body, { status: 200 });
}
