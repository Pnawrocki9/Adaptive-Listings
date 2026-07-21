/**
 * FIXTURE helper — the delegated data mutation for the bypass-5 fixtures
 * (../app/api/foo/route.ts in this fixture and in
 * ../../bypass5-namespace-import-delegated-mutation-out-of-tx). Byte-identical
 * to the bypass-4 helper (../../bypass4-helper-delegated-mutation/src/lib/mutation-helper.ts) —
 * bypass 5 is the SAME delegated-mutation shape, imported as a NAMESPACE
 * instead of a named import (see the route.ts fixture in this directory).
 * Intentionally never imported or built outside the guard's own text parsing.
 */

import { tenants } from '@estalara/db';
import { eq } from 'drizzle-orm';

export async function upsertSomething(db: any, tenantId: string): Promise<void> {
  await db.update(tenants).set({ updatedAt: new Date() }).where(eq(tenants.id, tenantId));
}
