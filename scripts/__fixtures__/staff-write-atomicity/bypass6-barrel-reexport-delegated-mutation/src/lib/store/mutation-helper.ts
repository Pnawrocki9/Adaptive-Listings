/**
 * FIXTURE helper — the delegated data mutation for the bypass-6 fixtures
 * (../app/api/foo/route.ts in this fixture and in
 * ../../bypass6-barrel-reexport-delegated-mutation-out-of-tx). Byte-identical
 * to the bypass-4/5 helpers — bypass 6 is the SAME delegated-mutation shape,
 * but the helper is reached THROUGH A BARREL re-export (`./index.ts` does
 * `export * from './mutation-helper'`) rather than imported directly.
 * Intentionally never imported or built outside the guard's own text parsing.
 */

import { tenants } from '@estalara/db';
import { eq } from 'drizzle-orm';

export async function upsertSomething(db: any, tenantId: string): Promise<void> {
  await db.update(tenants).set({ updatedAt: new Date() }).where(eq(tenants.id, tenantId));
}
