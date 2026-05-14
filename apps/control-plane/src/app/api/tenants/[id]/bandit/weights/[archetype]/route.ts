/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return --
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
 * Auth: Bearer JWT required. Caller must be an agency user (agency:admin or above)
 * whose tenant_id matches the :id path parameter.
 *
 * @module apps/control-plane/src/app/api/tenants/[id]/bandit/weights/[archetype]/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getAuthClaims } from '@estalara/auth';
import { createTenantClient } from '@estalara/db';
import { abBanditWeights } from '@estalara/db';
import { eq, and } from 'drizzle-orm';

// ─── Route handler ─────────────────────────────────────────────────────────────

/**
 * PATCH /api/tenants/:id/bandit/weights/:archetype
 *
 * Sets paused = false for all variants of the given archetype for the tenant.
 *
 * @returns 200 { resumed: true, archetype } on success.
 * @returns 401 when no valid JWT or tenant mismatch.
 * @returns 403 when caller lacks agency:admin role.
 * @returns 500 on DB error.
 */
export async function PATCH(
  req: NextRequest,
  context: { params: Promise<{ id: string; archetype: string }> },
): Promise<NextResponse> {
  const claims = await getAuthClaims(req);
  if (!claims || !('tenant_id' in claims) || !claims.tenant_id) {
    return NextResponse.json(
      {
        error: { code: 'unauthorized', message: 'Valid Bearer JWT with tenant_id claim required' },
      },
      { status: 401 },
    );
  }

  const { id: tenantId, archetype } = await context.params;

  // Tenant isolation: JWT tenant_id must match the URL :id parameter.
  if (claims.tenant_id !== tenantId) {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'JWT tenant_id does not match resource tenant' } },
      { status: 403 },
    );
  }

  // Require at least agency:admin to resume a paused archetype.
  if ('agency_role' in claims && claims.agency_role === 'agency:viewer') {
    return NextResponse.json(
      { error: { code: 'forbidden', message: 'agency:admin or higher role required' } },
      { status: 403 },
    );
  }

  // DATABASE_URL may not be set in dev/CI — graceful mock response.
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ resumed: true, archetype, mock: true }, { status: 200 });
  }

  try {
    const rawToken =
      req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '') ??
      req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
      '';
    const db = createTenantClient(rawToken || undefined);

    // tx type is Database from @estalara/db — annotated explicitly to satisfy noImplicitAny.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- package types not compiled; any is safe here since db.rls enforces the DB type at runtime
    await db.rls((tx: any) =>
      tx
        .update(abBanditWeights)
        .set({ paused: false, updatedAt: new Date() })
        .where(
          and(eq(abBanditWeights.tenantId, tenantId), eq(abBanditWeights.archetype, archetype)),
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
