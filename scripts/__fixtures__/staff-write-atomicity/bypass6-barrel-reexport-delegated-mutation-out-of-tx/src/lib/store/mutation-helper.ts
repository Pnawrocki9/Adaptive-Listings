/**
 * FIXTURE helper — the delegated data mutation for the bypass-6 violation
 * variant (../app/api/foo/route.ts). Byte-identical to the co-scoped variant's
 * helper (../../bypass6-barrel-reexport-delegated-mutation/src/lib/store/mutation-helper.ts);
 * only the route's transaction placement differs. Intentionally never imported
 * or built outside the guard's own text parsing.
 */

import { tenants } from '@estalara/db';
import { eq } from 'drizzle-orm';

export async function upsertSomething(db: any, tenantId: string): Promise<void> {
  await db.update(tenants).set({ updatedAt: new Date() }).where(eq(tenants.id, tenantId));
}
