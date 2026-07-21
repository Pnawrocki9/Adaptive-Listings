/**
 * FIXTURE helper — the factored-out staff_audit_log insert for the bypass-2
 * fixture (../app/api/foo/route.ts). See that file's doc comment. Intentionally
 * never imported or built outside the guard's own text parsing.
 */

import { createAdminClient, staffAuditLog } from '@estalara/db';

export async function writeStaffAudit(tenantId: string, action: string): Promise<void> {
  const db = createAdminClient();
  await db.insert(staffAuditLog).values({
    adminUserId: 'staff-user-id',
    action,
    targetTenantId: tenantId,
    payload: {},
  });
}
