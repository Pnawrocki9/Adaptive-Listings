/**
 * GET /api/admin/tenants/optout-widget?tenant_id=<uuid> — read a tenant's per-brand opt-out
 *     toggle widget config (staff/superadmin only).
 * PUT /api/admin/tenants/optout-widget?tenant_id=<uuid> — save the tenant's opt-out widget
 *     config (staff/superadmin only, validated, audited, atomic).
 *
 * FOLLOW-641 / ADR-0019 D2 + D7: the audited WRITE PATH for the per-brand appearance/placement/
 * label config of the EXISTING profiling opt-out toggle
 * (`packages/sdk/src/ui/profiling-toggle.ts`, mounted since PR #337). The stored config is
 * consumed at runtime by `GET /api/quiz/public-config` (the `opt_out_widget` slice) → the SDK
 * toggle renderer. This route is that column's only human write path.
 *
 * §H.9 scope note (do NOT re-litigate — `project_optout_enforcement_h9_scope`): this route
 * configures the toggle's LOOK/PLACEMENT/LABELS only. The opt-out SEMANTICS (suppress AL
 * profiling + DOM adaptation) are unchanged and owned elsewhere.
 *
 * Auth (ADR-0018 §2): `resolveTenantAccess` with `allowStaffOverride`. STAFF-ONLY — the opt-out
 *   widget config is an Estalara operator control (no agency write path), so a resolved agency
 *   session is rejected 403 (`staff_only`), mirroring `al-state` / `quiz-definition`. An Estalara
 *   staff caller targets a tenant via `?tenant_id=<uuid>`, validated against the `tenants` table;
 *   that validated id is the SINGLE tenant fence bound into every query (invariant 5). This route
 *   uses `createAdminClient()` (service-role, RLS BYPASSED), so the explicit `eq(tenants.id, …)`
 *   fence is the ONLY tenant boundary.
 *
 *   Identity caveat (RETRO-187): a privileged write MUST be attributable to
 *   `staff_audit_log.adminUserId`; the headless `ADMIN_API_SECRET` Bearer path is rejected for
 *   staff by `resolveTenantAccess`. Staff need an identified SSR session or staff JWT.
 *
 * Write-rank gate (ADR-0018 §4, FOLLOW-615): PUT rejects any staff caller below `estalara:ops`
 *   (rank < 2) with 403, mirroring every sibling staff write.
 *
 * Staff-write atomicity (ADR-0018 §3a): the PUT updates `tenants.optout_widget_config` AND
 *   inserts the `staff_audit_log` row (`action: 'optout_widget.update'`) TOGETHER in ONE
 *   `db.transaction()`, kept INLINE so `scripts/check-staff-write-atomicity.cjs` proves the shared
 *   tx scope directly.
 *
 * @module apps/control-plane/src/app/api/admin/tenants/optout-widget/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';
import { eq } from 'drizzle-orm';

import { createAdminClient, tenants, staffAuditLog } from '@estalara/db';
import type { OptOutWidgetConfig } from '@estalara/shared';
import { OptOutWidgetConfigSchema } from '@estalara/shared';
import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { accessErrorToResponse } from '@/lib/access-error-response';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OptOutWidgetState {
  tenant_id: string;
  /** The stored config, or an empty object when the tenant configured nothing (SDK defaults). */
  config: OptOutWidgetConfig;
}

const PutBodySchema = z.object({
  config: OptOutWidgetConfigSchema,
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
      // Lowest agency floor: a resolved agency session is allowed THROUGH the role check only to
      // be rejected below with a clear staff-only 403. The opt-out widget config is an operator
      // control.
      minAgencyRole: 'agency:viewer',
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
            message: 'The opt-out widget config is an Estalara staff/superadmin control',
          },
        },
        { status: 403 },
      ),
    };
  }

  return { access };
}

/** Coerce a stored JSONB blob into a valid config; an invalid/absent blob reads as empty. */
function parseStored(raw: unknown): OptOutWidgetConfig {
  const parsed = OptOutWidgetConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest): Promise<NextResponse> {
  const resolved = await resolveStaffAccess(req);
  if ('error' in resolved) return resolved.error;
  const tenantId = resolved.access.tenantId;

  try {
    const db = createAdminClient();
    const rows = await db
      .select({ optoutWidgetConfig: tenants.optoutWidgetConfig })
      .from(tenants)
      // invariant 5: the ONLY tenant fence on this service-role client.
      .where(eq(tenants.id, tenantId))
      .limit(1);

    const body: OptOutWidgetState = {
      tenant_id: tenantId,
      config: parseStored(rows[0]?.optoutWidgetConfig),
    };
    return NextResponse.json(body, { status: 200 });
  } catch (err: unknown) {
    // Rule K.2 — fail loud: the DB is configured but the query threw.
    console.error('[optout-widget GET] DB error:', err instanceof Error ? err.message : err);
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { route: 'admin/tenants/optout-widget', op: 'get' },
      extra: { tenant_id: tenantId },
    });
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to load opt-out widget config' } },
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

  // Write-rank gate (CEO Q3, ADR-0018 §4; FOLLOW-615): staff below `estalara:ops` is view-only.
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
          message: 'Invalid opt-out widget config',
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const config = parsed.data.config;
  const db = createAdminClient();

  // Read the current config (fenced on tenantId — invariant 5) so the audit row carries a real
  // before/after AND to 404 a non-existent tenant. A read failure fails loud (500).
  let before: OptOutWidgetConfig;
  try {
    const rows = await db
      .select({ optoutWidgetConfig: tenants.optoutWidgetConfig })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!rows[0]) {
      return NextResponse.json(
        { error: { code: 'unknown_tenant', message: 'Tenant not found' } },
        { status: 404 },
      );
    }
    before = parseStored(rows[0].optoutWidgetConfig);
  } catch (err: unknown) {
    console.error(
      '[optout-widget PUT] failed to read current config:',
      err instanceof Error ? err.message : err,
    );
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { route: 'admin/tenants/optout-widget', op: 'put_read' },
      extra: { tenant_id: tenantId },
    });
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to load opt-out widget config' } },
      { status: 500 },
    );
  }

  // ── Atomic staff write (ADR-0018 §3a) ──────────────────────────────────────
  // The config update AND the `staff_audit_log` row commit-or-roll-back TOGETHER in ONE
  // transaction, kept INLINE so scripts/check-staff-write-atomicity.cjs proves the shared tx.
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(tenants)
        .set({ optoutWidgetConfig: config, updatedAt: new Date() })
        .where(eq(tenants.id, tenantId));

      // Staff audit trail (§3) — attributed to the acting staff user. AWAITED inside the tx so
      // it commits atomically with the mutation.
      await tx.insert(staffAuditLog).values({
        adminUserId: access.staff.sub,
        action: 'optout_widget.update',
        targetTenantId: tenantId,
        payload: { before, after: config },
        ipAddress: requestIp(req),
        userAgent: req.headers.get('user-agent'),
      });
    });
  } catch (err: unknown) {
    // Any failure INSIDE the tx rolls ALL of it back — no un-audited write.
    Sentry.captureException(err instanceof Error ? err : new Error(String(err)), {
      tags: { route: 'admin/tenants/optout-widget', op: 'put', staff_audit_error: 'true' },
      extra: { tenant_id: tenantId, admin_user_id: access.staff.sub },
    });
    return NextResponse.json(
      {
        error: {
          code: 'audit_write_failed',
          message:
            'The opt-out widget config change could not be recorded atomically with its staff ' +
            'audit row; the change was rolled back and NOT applied. Retry the action.',
        },
      },
      { status: 500 },
    );
  }

  const body: OptOutWidgetState = { tenant_id: tenantId, config };
  return NextResponse.json(body, { status: 200 });
}
