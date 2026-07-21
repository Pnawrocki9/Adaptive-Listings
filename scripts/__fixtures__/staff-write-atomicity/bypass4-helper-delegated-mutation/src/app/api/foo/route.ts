/**
 * FIXTURE — FOLLOW-609 bypass (4): the data mutation is delegated to a bare
 * call of an imported LOCAL HELPER FUNCTION (`upsertSomething(tx, ...)`)
 * instead of a literal `.update(`/`.insert(` call — mirroring the real
 * `demo-override-store.ts::upsertDemoOverride` shape this ticket dedupes.
 *
 * Red-first proof (RETRO-194): the pre-FOLLOW-609 guard's `collectFileFacts`
 * only recognised `.update(`/`.delete(`/a non-audit `.insert(`/a raw-SQL
 * `.execute(sql\`...\`)` PropertyAccessExpression call as a "mutation" — a bare
 * identifier call like `upsertSomething(tx, tenantId)` matched none of those
 * shapes, so this file's `mutationCalls` list was EMPTY and the guard
 * misclassified it SKIP ("insert(staffAuditLog) present but no other data
 * mutation") even though the helper call and the audit insert share ONE
 * `db.transaction()` here — zero enforcement, not merely presence-only.
 *
 * The FOLLOW-609 guard resolves `upsertSomething` to
 * ../../../lib/mutation-helper.ts, proves that module itself performs a
 * mutation (`moduleContainsMutation`), and must OK this file: the mutation and
 * the audit insert are both inside the SAME `db.transaction()`. Contrast with
 * ../../../../bypass4-helper-delegated-mutation-out-of-tx/, which is
 * byte-identical except the helper call sits OUTSIDE the transaction and must
 * FAIL. Intentionally never imported or built; the guard only parses it as
 * text. See scripts/__tests__/check-staff-write-atomicity.test.sh.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createAdminClient, staffAuditLog } from '@estalara/db';
import { upsertSomething } from '@/lib/mutation-helper';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenantId = req.nextUrl.searchParams.get('tenant_id') ?? '';
  const db = createAdminClient();

  await db.transaction(async (tx) => {
    // The data mutation is delegated to the imported local helper, not inlined.
    await upsertSomething(tx, tenantId);

    await tx.insert(staffAuditLog).values({
      adminUserId: 'staff-user-id',
      action: 'fixture.update',
      targetTenantId: tenantId,
      payload: {},
    });
  });

  return NextResponse.json({ ok: true });
}
