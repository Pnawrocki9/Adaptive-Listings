/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return --
 * @estalara/auth and @estalara/db are workspace packages not built locally.
 * TypeScript sees their return types as `any` until packages are built.
 * CI builds packages before lint so these errors don't appear in CI.
 * Same pattern as middleware.ts, quiz/config/route.ts, and other routes.
 */
/**
 * GET /api/ab/weights
 *
 * Returns the current Thompson sampling bandit weights for the authenticated tenant.
 * Provides visibility into per-(archetype, variant) Beta distribution parameters (alpha, beta)
 * and the auto-pause state for the analytics dashboard.
 *
 * Used by the TICKET-AB-004 analytics dashboard (Anomaly feed panel).
 *
 * Auth: Bearer JWT required. tenant_id extracted from verified JWT claims — NOT from header.
 *
 * Query params:
 *   archetype: filter by archetype label (optional)
 *
 * Reads real rows from ab_bandit_weights (seeded by TICKET-AB-006/007, PR #107).
 *
 * @module apps/control-plane/src/app/api/ab/weights/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { accessErrorToResponse } from '@/lib/access-error-response';
import { createTenantClient, createAdminClient } from '@estalara/db';
import { abBanditWeights } from '@estalara/db';
import { eq, and } from 'drizzle-orm';

// ─── Response types ───────────────────────────────────────────────────────────

export interface BanditWeightRow {
  tenant_id: string;
  archetype: string;
  variant: string;
  /** Beta distribution alpha parameter (successes + 1). */
  alpha: number;
  /** Beta distribution beta parameter (failures + 1). */
  beta: number;
  /** Estimated conversion rate: alpha / (alpha + beta). */
  estimated_rate: number;
  /** Whether this (archetype, variant) is auto-paused due to regression detection. */
  paused: boolean;
  updated_at: string;
}

export interface AbWeightsResponse {
  tenant_id: string;
  rows: BanditWeightRow[];
  total: number;
  generated_at: string;
}

// ─── Route handler ────────────────────────────────────────────────────────────

/**
 * GET /api/ab/weights
 *
 * Auth (ADR-0018 §2, FOLLOW-594): `resolveTenantAccess` with `allowStaffOverride`.
 * Agency path unchanged (tenant from the session claim, RLS-enforced). Estalara
 * staff may read any tenant's weights via an explicit `?tenant_id=<uuid>`
 * validated against the `tenants` table; that validated id is the SINGLE tenant
 * fence. The staff path uses a service-role client (RLS BYPASSED), so the explicit
 * `WHERE tenant_id` filter is the only isolation (ADR-0018 invariant 5).
 *
 * Identity caveat (RETRO-187): `resolveTenantAccess` REJECTS the headless
 * `ADMIN_API_SECRET` Bearer path for staff (403 — a shared secret is not
 * attributable to a staff user for a tenant-scoped read). Staff must authenticate
 * with an identified SSR session or a staff JWT.
 *
 * @returns 200 AbWeightsResponse on success.
 * @returns 400 when a staff caller omits `?tenant_id`.
 * @returns 401 when no valid session is present.
 * @returns 403 when the caller is not permitted (e.g. agency acting on a foreign tenant).
 * @returns 404 when a staff caller supplies an unknown tenant id.
 * @returns 500 on DB error.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // Auth: tenant_id from verified claims / validated staff param — NEVER from an
  // x-tenant-id header (TICKET-FIX-014). `access.tenantId` is the single fence.
  const tenantIdParam = req.nextUrl.searchParams.get('tenant_id');
  let access: TenantAccess;
  try {
    access = await resolveTenantAccess(req, {
      allowStaffOverride: true,
      // exactOptionalPropertyTypes: omit the key when absent rather than passing
      // `undefined`, so a staff caller without ?tenant_id still reaches resolve's 400.
      ...(tenantIdParam ? { tenantId: tenantIdParam } : {}),
      minAgencyRole: 'agency:viewer',
    });
  } catch (err) {
    return accessErrorToResponse(err);
  }

  const tenantId: string = access.tenantId;
  const archetypeFilter = req.nextUrl.searchParams.get('archetype') ?? undefined;

  // Shared WHERE fence — built once, applied identically on BOTH paths. For the
  // staff (service-role) path it is the ONLY tenant isolation (invariant 5); for
  // the agency path it is defense-in-depth on top of RLS.
  const buildWhere = () => {
    const conditions = [eq(abBanditWeights.tenantId, tenantId)];
    if (archetypeFilter) {
      conditions.push(eq(abBanditWeights.archetype, archetypeFilter));
    }
    return conditions.length === 1 ? conditions[0] : and(...conditions);
  };

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- package types not compiled; the tenant fence (buildWhere) is applied explicitly on every path
    let dbRows: any[];

    if (access.via === 'agency') {
      // DATABASE_URL may not be set in dev/CI — graceful empty response.
      if (!process.env.DATABASE_URL) {
        const response: AbWeightsResponse = {
          tenant_id: tenantId,
          rows: [],
          total: 0,
          generated_at: new Date().toISOString(),
        };
        return NextResponse.json(response, { status: 200 });
      }
      // rawToken → RLS enforced (FOLLOW-454 SSR + programmatic callers).
      const db = createTenantClient(access.rawToken ?? undefined);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- tx is the uncompiled package Database type
      dbRows = await db.rls((tx: any) => tx.select().from(abBanditWeights).where(buildWhere()));
    } else {
      // Staff path: service-role client, RLS BYPASSED. The explicit
      // WHERE tenant_id = access.tenantId (buildWhere) is the ONLY fence.
      const db = createAdminClient();
      dbRows = await db.select().from(abBanditWeights).where(buildWhere());
    }

    const rows: BanditWeightRow[] = dbRows.map((r) => ({
      tenant_id: r.tenantId as string,
      archetype: r.archetype as string,
      variant: r.variant as string,
      alpha: r.alpha as number,
      beta: r.beta as number,
      estimated_rate:
        Math.round(((r.alpha as number) / ((r.alpha as number) + (r.beta as number))) * 10000) /
        10000,
      paused: r.paused as boolean,
      updated_at: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : (r.updatedAt as string),
    }));

    const response: AbWeightsResponse = {
      tenant_id: tenantId,
      rows,
      total: rows.length,
      generated_at: new Date().toISOString(),
    };

    return NextResponse.json(response, { status: 200 });
  } catch (err: unknown) {
    console.error('[ab/weights] DB error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: { code: 'internal_error', message: 'Failed to fetch bandit weights' } },
      { status: 500 },
    );
  }
}
