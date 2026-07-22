/**
 * FIXTURE — FOLLOW-613 bypass (6): the SAME delegated-mutation shape as
 * bypass 4/5, but the mutating helper is reached THROUGH A BARREL re-export.
 * The route imports `upsertSomething` from `@/lib/store` (a barrel `index.ts`
 * whose only content is `export * from './mutation-helper'`), NOT from the
 * `./mutation-helper` module directly. This mirrors the real live defect:
 * `admin/labels/[id]/route.ts` imports `upsertConversionLabel` from the
 * `@estalara/db` PACKAGE barrel, which re-exports it via
 * `export { upsertConversionLabel } from './upsert-conversion-label.js'`.
 *
 * Red-first proof (RETRO-197): the pre-FOLLOW-613 guard's
 * `collectLocalImportedIdentifierSources` resolved `@/lib/store` to the barrel
 * `index.ts` and mapped `upsertSomething` to it, but `moduleContainsMutation`'s
 * bounded walk used `collectLocalImports`, which only visits
 * `ts.isImportDeclaration` nodes — NOT the barrel's `ts.isExportDeclaration`
 * re-export. So the walk reached the barrel, found zero direct mutations
 * there (correct — the barrel has none), could not follow the re-export one
 * hop further to `mutation-helper.ts`, and returned false: `upsertSomething`
 * was NOT promoted to a mutation, so this file was misclassified SKIP
 * ("insert(staffAuditLog) present but no other data mutation") even though the
 * helper call and the audit insert share ONE `db.transaction()` here — zero
 * enforcement, identical failure mode to bypass 4/5, one further call-shape
 * hop over (Rule AE).
 *
 * The FOLLOW-613 guard resolves `upsertSomething` THROUGH the barrel's
 * `export * from './mutation-helper'` re-export to the concrete
 * `mutation-helper.ts`, proves that module performs a mutation
 * (`moduleContainsMutation`, reused unchanged), and must OK this file: the
 * mutation and the audit insert are both inside the SAME `db.transaction()`.
 * Contrast with ../../bypass6-barrel-reexport-delegated-mutation-out-of-tx/,
 * which is identical except the helper call sits OUTSIDE the transaction and
 * must FAIL. Intentionally never imported or built; the guard only parses it
 * as text. See scripts/__tests__/check-staff-write-atomicity.test.sh.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createAdminClient, staffAuditLog } from '@estalara/db';
import { upsertSomething } from '@/lib/store';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenantId = req.nextUrl.searchParams.get('tenant_id') ?? '';
  const db = createAdminClient();

  await db.transaction(async (tx) => {
    // The data mutation is delegated to a helper reached through a barrel re-export.
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
