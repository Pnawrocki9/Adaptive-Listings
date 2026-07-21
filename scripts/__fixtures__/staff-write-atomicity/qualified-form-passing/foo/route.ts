/**
 * FIXTURE — FOLLOW-608 hardening proof: the audit-insert matcher must recognise
 * the QUALIFIED form (`schema.staffAuditLog`), not just the bare identifier, so
 * it is (a) still counted as the audit insert and (b) NOT miscounted as an
 * unrelated "other mutation" insert. The mutation and the qualified-form audit
 * insert are correctly inside ONE db.transaction() here — the guard must PASS
 * this file. Intentionally never imported or built; the guard only parses it as
 * text. See scripts/__tests__/check-staff-write-atomicity.test.sh.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createAdminClient, tenants, staffAuditLog as schemaStaffAuditLog } from '@estalara/db';
import { eq } from 'drizzle-orm';

const schema = { staffAuditLog: schemaStaffAuditLog };

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenantId = req.nextUrl.searchParams.get('tenant_id') ?? '';
  const db = createAdminClient();

  await db.transaction(async (tx) => {
    await tx.update(tenants).set({ updatedAt: new Date() }).where(eq(tenants.id, tenantId));

    // Qualified form: schema.staffAuditLog, not the bare identifier.
    await tx.insert(schema.staffAuditLog).values({
      adminUserId: 'staff-user-id',
      action: 'fixture.update',
      targetTenantId: tenantId,
      payload: {},
    });
  });

  return NextResponse.json({ ok: true });
}
