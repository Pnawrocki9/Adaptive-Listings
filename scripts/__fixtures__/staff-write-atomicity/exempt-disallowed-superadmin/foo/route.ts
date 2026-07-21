/**
 * FIXTURE — FOLLOW-608 exemption-audit proof: a route gated on
 * `access.isSuperadmin` (rank-3/superadmin-only) that carries a
 * `staff-write-atomicity-exempt:` comment. FOLLOW-608 DISALLOWS the exemption on
 * superadmin-gated routes (this is the precedent for the future FOLLOW-598
 * bandit-weight route, the highest-blast-radius staff write) — the guard must
 * still FAIL this file even though the exemption marker is present.
 * Intentionally never imported or built; the guard only parses it as text.
 * See scripts/__tests__/check-staff-write-atomicity.test.sh.
 */

// staff-write-atomicity-exempt: fixture only — DISALLOWED, see FOLLOW-608

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createAdminClient, tenants, staffAuditLog } from '@estalara/db';
import { eq } from 'drizzle-orm';

export async function POST(
  req: NextRequest,
  access: { isSuperadmin: boolean },
): Promise<NextResponse> {
  const tenantId = req.nextUrl.searchParams.get('tenant_id') ?? '';
  if (!access.isSuperadmin) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  const db = createAdminClient();

  await db.update(tenants).set({ updatedAt: new Date() }).where(eq(tenants.id, tenantId));

  await db.insert(staffAuditLog).values({
    adminUserId: 'staff-user-id',
    action: 'fixture.update',
    targetTenantId: tenantId,
    payload: {},
  });

  return NextResponse.json({ ok: true });
}
