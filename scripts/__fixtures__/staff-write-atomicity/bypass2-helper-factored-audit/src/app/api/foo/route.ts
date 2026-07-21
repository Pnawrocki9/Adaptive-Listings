/**
 * FIXTURE — FOLLOW-608 bypass (2): the staff_audit_log insert is factored into a
 * shared helper (imported via the `@/` alias, mirroring the real
 * demo-override-store.ts pattern flagged by RETRO-193) instead of appearing
 * literally in the route file. Red-first proof: the FOLLOW-607 presence-only
 * guard greps the route file text for the literal `insert(staffAuditLog)`; since
 * it is not present here (it lives in ../../../lib/audit-helper.ts), the guard
 * treats this file as a plain agency-only mutation with ZERO audit trail and
 * SKIPs it — a silent false negative on what is actually an unguarded audited
 * write. The FOLLOW-608 scope-aware guard must resolve the local import and FAIL
 * this file: an audit insert factored into a separate module opens its own DB
 * client and can never be proven to commit atomically with the mutation. It is
 * intentionally never imported or built; the guard only parses it as text.
 * See scripts/__tests__/check-staff-write-atomicity.test.sh.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createAdminClient, tenants } from '@estalara/db';
import { eq } from 'drizzle-orm';
import { writeStaffAudit } from '@/lib/audit-helper';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenantId = req.nextUrl.searchParams.get('tenant_id') ?? '';
  const db = createAdminClient();

  await db.update(tenants).set({ updatedAt: new Date() }).where(eq(tenants.id, tenantId));

  // The audit insert is factored out into a helper — no db.transaction() anywhere
  // in THIS file, and the helper opens its own client, so it cannot possibly
  // share a transaction with the update() above.
  await writeStaffAudit(tenantId, 'fixture.update');

  return NextResponse.json({ ok: true });
}
