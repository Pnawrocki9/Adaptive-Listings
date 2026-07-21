/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return --
 * @estalara/auth and @estalara/db are workspace packages not built locally.
 * TypeScript sees their return types as `any` until packages are built.
 * CI builds packages before lint so these errors don't appear in CI.
 * Same pattern as middleware.ts, quiz/config/route.ts, and other routes.
 */
/**
 * PATCH /api/tenants/:id/bandit/weights/:archetype
 *
 * Resumes a paused archetype in the Thompson sampling bandit by setting
 * `paused = false` on all `ab_bandit_weights` rows for the given
 * (tenant_id, archetype) pair.
 *
 * Used by the Panel 5 "Anomaly feed" Resume button in the analytics dashboard.
 *
 * Auth (ADR-0018 §6 Phase 3, FOLLOW-598 — HIGHEST-blast-radius staff write):
 *   `resolveTenantAccess` with `allowStaffOverride`. The tenant is URL-supplied
 *   (the `[id]` segment), NOT a query param.
 *
 *   Agency: `agency:admin`+ acting on its OWN tenant (the helper enforces that the
 *   session `tenant_id` equals `[id]`, invariant 2). RLS-enforced via
 *   `createTenantClient(rawToken)` + `db.rls()`; NOT audited, NO transaction —
 *   byte-unchanged from the pre-port behavior, including the dev/CI mock path.
 *
 *   Staff: `[id]` is validated against the `tenants` table (invariant 4) and
 *   becomes the SINGLE tenant fence (invariant 5). This route requires the
 *   STRICTER superadmin predicate (`access.isSuperadmin`, rank ≥
 *   `estalara:superadmin`, CEO Q3) — an ops-rank staff caller is 403 (NOT gated on
 *   `canWrite`; resuming a bandit archetype directly steers live adaptation
 *   traffic, so it is superadmin-only). Staff writes run under
 *   `createAdminClient()` (service-role, RLS BYPASSED), so `access.tenantId` is the
 *   ONLY tenant boundary; every staff query binds `WHERE tenant_id = <that id>`.
 *   ATOMICITY (ADR-0018 §3a): the `paused = false` mutation and the
 *   `staff_audit_log` insert commit-or-roll-back TOGETHER in ONE
 *   `db.transaction()` — mirrors `admin/intent-weights` PUT (FOLLOW-597) and
 *   `quiz/config` POST (FOLLOW-605). Any failure inside the tx rolls BOTH back →
 *   500 `audit_write_failed` (never a silent unattributed 200, Rule K.2).
 *
 *   The mutation is kept INLINE (not delegated through an `@estalara/db` helper) so
 *   the staff-write atomicity guard (`scripts/check-staff-write-atomicity.cjs`) can
 *   prove the mutation + audit insert share the same transaction (FOLLOW-613 — a
 *   delegated write would make the guard SKIP this route).
 *
 * @module apps/control-plane/src/app/api/tenants/[id]/bandit/weights/[archetype]/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { eq, and } from 'drizzle-orm';
import {
  createTenantClient,
  createAdminClient,
  abBanditWeights,
  staffAuditLog,
} from '@estalara/db';
import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { accessErrorToResponse } from '@/lib/access-error-response';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Best-effort client IP for the staff audit trail (no throw if absent). */
function requestIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip');
}

// ─── Route handler ─────────────────────────────────────────────────────────────

/**
 * PATCH /api/tenants/:id/bandit/weights/:archetype
 *
 * Sets paused = false for all variants of the given archetype for the tenant.
 *
 * @returns 200 { resumed: true, archetype } on success.
 * @returns 401/403/404 via {@link accessErrorToResponse} on auth failure.
 * @returns 403 when a staff caller is below `estalara:superadmin` (CEO Q3).
 * @returns 500 `audit_write_failed` when a staff write cannot commit atomically.
 * @returns 500 `internal_error` on an agency DB error.
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; archetype: string }> },
): Promise<NextResponse> {
  const { id: tenantId, archetype } = await context.params;

  let access: TenantAccess;
  try {
    access = await resolveTenantAccess(req, {
      allowStaffOverride: true,
      minAgencyRole: 'agency:admin',
      tenantId,
    });
  } catch (err) {
    return accessErrorToResponse(err);
  }

  // Superadmin gate (CEO Q3, ADR-0018 §4): this is the highest-blast-radius staff
  // write in the epic — a below-superadmin staff caller is 403 (stricter than the
  // `canWrite`/ops floor used by per-tenant config routes).
  if (access.via === 'staff' && !access.isSuperadmin) {
    return NextResponse.json(
      {
        error: {
          code: 'forbidden',
          message: 'Resuming a bandit archetype requires estalara:superadmin',
        },
      },
      { status: 403 },
    );
  }

  // DATABASE_URL may not be set in dev/CI — graceful mock response (dependency not
  // configured, Rule K.2). Placed AFTER the superadmin gate so an ops-rank staff
  // caller is rejected before ever reaching the mock success path.
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ resumed: true, archetype, mock: true }, { status: 200 });
  }

  // ── STAFF PATH — audited + atomic (ADR-0018 §3a), service-role (RLS bypassed). ──
  if (access.via === 'staff') {
    // invariant 5: the ONLY tenant fence — createAdminClient() bypasses RLS.
    const tenantFence = access.tenantId;
    try {
      const db = createAdminClient();

      await db.transaction(async (tx) => {
        // (a) the mutation — kept INLINE so the atomicity guard can prove it shares
        // the tx with the audit insert (FOLLOW-613).
        await tx
          .update(abBanditWeights)
          .set({ paused: false, updatedAt: new Date() })
          .where(
            and(
              eq(abBanditWeights.tenantId, tenantFence),
              eq(abBanditWeights.archetype, archetype),
            ),
          );

        // (b) the staff audit row — attributed to the acting superadmin, AWAITED
        // inside the tx so it commits atomically with (a).
        await tx.insert(staffAuditLog).values({
          adminUserId: access.staff.sub,
          action: 'bandit_weights.resume',
          targetTenantId: tenantFence,
          payload: { archetype, paused: false },
          ipAddress: requestIp(req),
          userAgent: req.headers.get('user-agent'),
        });
      });

      return NextResponse.json({ resumed: true, archetype }, { status: 200 });
    } catch (err: unknown) {
      // Any failure INSIDE the tx (the mutation OR the audit insert) rolls BOTH
      // back — no orphan resume to leave behind. Fail loud: capture + 500, never a
      // silent unattributed 200 (Rule K.2).
      Sentry.captureException(err, {
        tags: { route: 'tenants/bandit/weights/resume', staff_audit_error: 'true' },
        extra: { tenant_id: tenantFence, archetype },
      });
      return NextResponse.json(
        {
          error: {
            code: 'audit_write_failed',
            message:
              'The archetype resume could not be recorded atomically with its staff audit row; ' +
              'the change was rolled back and NOT applied. Retry the action.',
          },
        },
        { status: 500 },
      );
    }
  }

  // ── AGENCY PATH — byte-unchanged: RLS-enforced, NOT audited, NO transaction. ──
  try {
    const db = createTenantClient(access.rawToken ?? undefined);

    // tx type is Database from @estalara/db — annotated explicitly to satisfy noImplicitAny.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- package types not compiled; any is safe here since db.rls enforces the DB type at runtime
    await db.rls((tx: any) =>
      tx
        .update(abBanditWeights)
        .set({ paused: false, updatedAt: new Date() })
        .where(
          and(
            eq(abBanditWeights.tenantId, access.tenantId),
            eq(abBanditWeights.archetype, archetype),
          ),
        ),
    );

    return NextResponse.json({ resumed: true, archetype }, { status: 200 });
  } catch (err: unknown) {
    console.error('[bandit/weights/resume] DB error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to resume archetype' } },
      { status: 500 },
    );
  }
}
