/**
 * FIXTURE — FOLLOW-608 bypass (1): an unrelated db.transaction() elsewhere in the
 * file, PLUS an out-of-tx audited mutation. Red-first proof: the FOLLOW-607
 * presence-only guard treats ANY `.transaction(` appearing anywhere in the file as
 * satisfying the atomicity requirement, so this file WRONGLY PASSES that guard even
 * though the real mutation and its staff_audit_log row are never actually inside a
 * transaction together. The FOLLOW-608 scope-aware guard must FAIL this file. It is
 * intentionally never imported or built; the guard only parses it as text.
 * See scripts/__tests__/check-staff-write-atomicity.test.sh.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createAdminClient, tenants, staffAuditLog } from '@estalara/db';
import { eq } from 'drizzle-orm';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenantId = req.nextUrl.searchParams.get('tenant_id') ?? '';
  const db = createAdminClient();

  // An UNRELATED transaction, doing something else entirely — present in the
  // file, but it does not wrap the real mutation or the audit insert below.
  await db.transaction(async (tx) => {
    await tx.select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  });

  // VIOLATION: the real mutation and its audit insert are two separate awaited
  // calls, OUTSIDE any transaction — a crash between them leaves an orphan write.
  await db.update(tenants).set({ updatedAt: new Date() }).where(eq(tenants.id, tenantId));

  await db.insert(staffAuditLog).values({
    adminUserId: 'staff-user-id',
    action: 'fixture.update',
    targetTenantId: tenantId,
    payload: {},
  });

  return NextResponse.json({ ok: true });
}
