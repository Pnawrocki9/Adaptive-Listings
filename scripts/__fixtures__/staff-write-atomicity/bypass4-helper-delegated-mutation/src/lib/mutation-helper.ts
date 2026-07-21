/**
 * FIXTURE helper — the delegated data mutation for the bypass-4 fixtures
 * (../app/api/foo/route.ts in this fixture and in
 * ../../bypass4-helper-delegated-mutation-out-of-tx). Mirrors the real
 * demo-override-store.ts::upsertDemoOverride shape (FOLLOW-609): the route
 * delegates its data mutation to this imported local helper instead of
 * inlining `.update(`/`.insert(` directly. Intentionally never imported or
 * built outside the guard's own text parsing.
 */

import { tenants } from '@estalara/db';
import { eq } from 'drizzle-orm';

export async function upsertSomething(db: any, tenantId: string): Promise<void> {
  await db.update(tenants).set({ updatedAt: new Date() }).where(eq(tenants.id, tenantId));
}
