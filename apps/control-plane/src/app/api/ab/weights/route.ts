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
import { getAuthClaims } from '@estalara/auth';
import { createTenantClient } from '@estalara/db';
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
 * @returns 200 AbWeightsResponse on success.
 * @returns 401 when no valid Bearer JWT or JWT lacks tenant_id.
 * @returns 500 on DB error.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // Auth: tenant_id from verified JWT claims — NEVER from x-tenant-id header (TICKET-FIX-014).
  const claims = await getAuthClaims(req);
  if (!claims || !('tenant_id' in claims) || !claims.tenant_id) {
    return NextResponse.json(
      {
        error: { code: 'unauthorized', message: 'Valid Bearer JWT with tenant_id claim required' },
      },
      { status: 401 },
    );
  }

  const tenantId: string = claims.tenant_id;
  const archetypeFilter = req.nextUrl.searchParams.get('archetype') ?? undefined;

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

  try {
    const rawToken =
      req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ??
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
      '';
    const db = createTenantClient(rawToken || undefined);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- package types not compiled; any is safe here since db.rls enforces the DB type at runtime
    const dbRows: any[] = await db.rls((tx: any) => {
      const conditions = [eq(abBanditWeights.tenantId, tenantId)];
      if (archetypeFilter) {
        conditions.push(eq(abBanditWeights.archetype, archetypeFilter));
      }
      return tx
        .select()
        .from(abBanditWeights)
        .where(conditions.length === 1 ? conditions[0] : and(...conditions));
    });

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
