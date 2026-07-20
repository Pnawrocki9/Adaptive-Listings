/**
 * FIXTURE — agency-only write, no staff audit trail at all.
 *
 * A route that mutates data but never inserts into staff_audit_log must NOT be
 * flagged by scripts/check-staff-write-atomicity.sh — there is no audited
 * write to make atomic. It is intentionally never imported or built; the
 * guard only greps it as text. See
 * scripts/__tests__/check-staff-write-atomicity.test.sh.
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

import { createAdminClient, tenants } from '@estalara/db';
import { eq } from 'drizzle-orm';

export async function POST(req: NextRequest): Promise<NextResponse> {
  const tenantId = req.nextUrl.searchParams.get('tenant_id') ?? '';
  const db = createAdminClient();

  await db.update(tenants).set({ updatedAt: new Date() }).where(eq(tenants.id, tenantId));

  return NextResponse.json({ ok: true });
}
