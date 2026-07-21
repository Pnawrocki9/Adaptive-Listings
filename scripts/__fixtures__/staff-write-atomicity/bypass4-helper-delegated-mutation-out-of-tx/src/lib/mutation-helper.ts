/**
 * FIXTURE helper — see ../../bypass4-helper-delegated-mutation/src/lib/mutation-helper.ts
 * (byte-identical; duplicated per fixture directory so each is self-contained).
 */

import { tenants } from '@estalara/db';
import { eq } from 'drizzle-orm';

export async function upsertSomething(db: any, tenantId: string): Promise<void> {
  await db.update(tenants).set({ updatedAt: new Date() }).where(eq(tenants.id, tenantId));
}
