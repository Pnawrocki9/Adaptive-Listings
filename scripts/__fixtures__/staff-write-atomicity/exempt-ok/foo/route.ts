/**
 * FIXTURE — FOLLOW-608 exemption-audit proof: a genuinely single-store
 * single-write route (NOT superadmin-gated) that documents its opt-out with a
 * `staff-write-atomicity-exempt:` comment. The guard must still honour the
 * exemption mechanism post-tightening and treat this as EXEMPT, not a failure.
 * Intentionally never imported or built; the guard only parses it as text.
 * See scripts/__tests__/check-staff-write-atomicity.test.sh.
 */

// staff-write-atomicity-exempt: single-store write, transaction wrapper would be meaningless

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createAdminClient, tenants, staffAuditLog } from '@estalara/db';
import { eq } from 'drizzle-orm';

export async function POST(req: NextRequest, access: { canWrite: boolean }): Promise<NextResponse> {
  const tenantId = req.nextUrl.searchParams.get('tenant_id') ?? '';
  if (!access.canWrite) {
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
