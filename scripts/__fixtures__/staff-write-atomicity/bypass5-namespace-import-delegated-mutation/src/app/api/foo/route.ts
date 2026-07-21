/**
 * FIXTURE — FOLLOW-612 bypass (5): the SAME delegated-mutation shape as
 * bypass 4 (`../../../../../bypass4-helper-delegated-mutation/`), but the
 * helper is imported as a NAMESPACE (`import * as helper from ...`) and
 * called via property access (`helper.upsertSomething(tx, ...)`) instead of a
 * bare identifier call.
 *
 * Red-first proof (RETRO-196): the pre-FOLLOW-612 guard's `collectFileFacts`
 * widened its bare-identifier branch (`ts.isIdentifier(node.expression)`) to
 * recognise a delegated mutation call for bypass 4, but a property-access
 * callee (`helper.upsertSomething`) falls into the OTHER branch
 * (`ts.isPropertyAccessExpression(node.expression)`), which only recognised
 * the fixed method names `transaction`/`insert`/`update`/`delete`/`execute`.
 * `upsertSomething` matches none of those, so this file's `mutationCalls`
 * list was EMPTY and the guard misclassified it SKIP ("insert(staffAuditLog)
 * present but no other data mutation") even though the helper call and the
 * audit insert share ONE `db.transaction()` here — zero enforcement,
 * identical failure mode to bypass 4, one further call-shape hop over.
 *
 * The FOLLOW-612 guard resolves `helper` (the namespace import's local
 * binding) to ../../../lib/mutation-helper.ts via the SAME
 * `collectLocalImportedIdentifierSources` map bypass 4 already builds, proves
 * that module itself performs a mutation (`moduleContainsMutation`, reused
 * unchanged), and must OK this file: the mutation and the audit insert are
 * both inside the SAME `db.transaction()`. Contrast with
 * ../../../../bypass5-namespace-import-delegated-mutation-out-of-tx/, which is
 * byte-identical except the helper call sits OUTSIDE the transaction and must
 * FAIL. Intentionally never imported or built; the guard only parses it as
 * text. See scripts/__tests__/check-staff-write-atomicity.test.sh.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createAdminClient, staffAuditLog } from '@estalara/db';
import * as helper from '@/lib/mutation-helper';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenantId = req.nextUrl.searchParams.get('tenant_id') ?? '';
  const db = createAdminClient();

  await db.transaction(async (tx) => {
    // The data mutation is delegated to the namespace-imported local helper.
    await helper.upsertSomething(tx, tenantId);

    await tx.insert(staffAuditLog).values({
      adminUserId: 'staff-user-id',
      action: 'fixture.update',
      targetTenantId: tenantId,
      payload: {},
    });
  });

  return NextResponse.json({ ok: true });
}
