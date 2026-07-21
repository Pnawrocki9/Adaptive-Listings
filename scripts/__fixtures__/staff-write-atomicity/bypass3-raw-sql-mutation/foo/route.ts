/**
 * FIXTURE — FOLLOW-608 bypass (3): a raw-SQL mutation (`db.execute(sql\`UPDATE
 * ...\`)`) paired with a staff_audit_log insert, neither wrapped in a
 * transaction. Red-first proof: the FOLLOW-607 presence-only guard only
 * recognises `.update(`, `.delete(`, or a non-staffAuditLog `.insert(` as a
 * "mutation" — a raw-SQL `.execute(sql\`...\`)` call matches none of those
 * patterns, so the guard misclassifies this file as "audit-of-a-read" (no
 * mutation) and SKIPs it, even though a real unguarded mutation exists. The
 * FOLLOW-608 scope-aware guard must recognise the raw-SQL UPDATE as a mutation
 * and FAIL this file (no db.transaction() wraps it). Intentionally never
 * imported or built; the guard only parses it as text.
 * See scripts/__tests__/check-staff-write-atomicity.test.sh.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createAdminClient, staffAuditLog } from '@estalara/db';
import { sql } from 'drizzle-orm';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenantId = req.nextUrl.searchParams.get('tenant_id') ?? '';
  const db = createAdminClient();

  // VIOLATION: a raw-SQL mutation, not recognised by the .update(/.delete(
  // pattern, and NOT wrapped in a transaction with the audit insert below.
  await db.execute(sql`UPDATE tenants SET updated_at = now() WHERE id = ${tenantId}`);

  await db.insert(staffAuditLog).values({
    adminUserId: 'staff-user-id',
    action: 'fixture.raw_sql_update',
    targetTenantId: tenantId,
    payload: {},
  });

  return NextResponse.json({ ok: true });
}
