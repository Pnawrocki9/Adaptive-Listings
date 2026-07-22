/**
 * FIXTURE — FOLLOW-613 bypass (6), violation variant: byte-identical to
 * ../../bypass6-barrel-reexport-delegated-mutation/ except the
 * barrel-reexport-delegated mutation call sits OUTSIDE the `db.transaction()`
 * that wraps the audit insert. The guard must FAIL this file, not SKIP it —
 * proving the fix recognises the barrel-delegated call as a mutation
 * regardless of tx placement (a naive fix that only counted the call as a
 * mutation when it happened to already be inside a tx scope would silently
 * SKIP this shape instead of failing it, which is zero enforcement in the
 * opposite direction — the exact wrong turn already rejected for bypass 4/5,
 * see this guard's module doc comment). Intentionally never imported or built;
 * the guard only parses it as text. See
 * scripts/__tests__/check-staff-write-atomicity.test.sh.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createAdminClient, staffAuditLog } from '@estalara/db';
import { upsertSomething } from '@/lib/store';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenantId = req.nextUrl.searchParams.get('tenant_id') ?? '';
  const db = createAdminClient();

  // VIOLATION: the barrel-delegated mutation is OUTSIDE the transaction below.
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
