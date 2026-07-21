/**
 * FIXTURE — deliberately violates ADR-0018 §3a (FOLLOW-607 red-first proof).
 *
 * This route performs a data mutation AND a staff_audit_log insert, but the two
 * are NOT wrapped in a single db.transaction() — the exact pre-FOLLOW-605
 * mutate-then-audit shape the guard must reject. It is intentionally never
 * imported or built; scripts/check-staff-write-atomicity.sh only greps it as
 * text. See scripts/__tests__/check-staff-write-atomicity.test.sh.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createAdminClient, tenants, staffAuditLog } from '@estalara/db';
import { eq } from 'drizzle-orm';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenantId = req.nextUrl.searchParams.get('tenant_id') ?? '';
  const db = createAdminClient();

  // VIOLATION: mutation and audit insert are two separate awaited calls with
  // no db.transaction() wrapper — a crash between them leaves an orphan write.
  await db.update(tenants).set({ updatedAt: new Date() }).where(eq(tenants.id, tenantId));

  await db.insert(staffAuditLog).values({
    adminUserId: 'staff-user-id',
    action: 'fixture.update',
    targetTenantId: tenantId,
    payload: {},
  });

  return NextResponse.json({ ok: true });
}
