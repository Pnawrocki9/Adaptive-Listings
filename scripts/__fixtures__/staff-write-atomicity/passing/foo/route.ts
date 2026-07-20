/**
 * FIXTURE — mirrors the FOLLOW-605 reference shape (ADR-0018 §3a compliant).
 *
 * The mutation and the staff_audit_log insert commit-or-roll-back together in
 * ONE db.transaction(). scripts/check-staff-write-atomicity.sh must PASS this
 * file. It is intentionally never imported or built; the guard only greps it
 * as text. See scripts/__tests__/check-staff-write-atomicity.test.sh.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createAdminClient, tenants, staffAuditLog } from '@estalara/db';
import { eq } from 'drizzle-orm';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenantId = req.nextUrl.searchParams.get('tenant_id') ?? '';
  const db = createAdminClient();

  await db.transaction(async (tx) => {
    await tx.update(tenants).set({ updatedAt: new Date() }).where(eq(tenants.id, tenantId));

    await tx.insert(staffAuditLog).values({
      adminUserId: 'staff-user-id',
      action: 'fixture.update',
      targetTenantId: tenantId,
      payload: {},
    });
  });

  return NextResponse.json({ ok: true });
}
