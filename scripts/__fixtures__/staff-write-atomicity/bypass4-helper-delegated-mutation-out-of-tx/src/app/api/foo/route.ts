/**
 * FIXTURE — FOLLOW-609 bypass (4), violation variant: byte-identical to
 * ../../bypass4-helper-delegated-mutation/ except the helper-delegated
 * mutation call sits OUTSIDE the `db.transaction()` that wraps the audit
 * insert. The guard must FAIL this file, not SKIP it — proving the fix
 * correctly recognises the delegated call as a mutation regardless of tx
 * placement (a naive fix that only counted a helper call as a mutation when
 * it happened to already be inside a tx scope would silently SKIP this
 * shape instead of failing it, which is zero enforcement in the opposite
 * direction). Intentionally never imported or built; the guard only parses
 * it as text. See scripts/__tests__/check-staff-write-atomicity.test.sh.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createAdminClient, staffAuditLog } from '@estalara/db';
import { upsertSomething } from '@/lib/mutation-helper';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenantId = req.nextUrl.searchParams.get('tenant_id') ?? '';
  const db = createAdminClient();

  // VIOLATION: the helper-delegated mutation is OUTSIDE the transaction below.
  await upsertSomething(db, tenantId);

  await db.transaction(async (tx) => {
    await tx.insert(staffAuditLog).values({
      adminUserId: 'staff-user-id',
      action: 'fixture.update',
      targetTenantId: tenantId,
      payload: {},
    });
  });

  return NextResponse.json({ ok: true });
}
