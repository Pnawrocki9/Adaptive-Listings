/**
 * Write gate for the LIA compliance-record routes (`POST /api/tenants/:id/lia`,
 * `DELETE /api/tenants/:id/lia/:recordId`) — FOLLOW-1335 review F3, ADR-0018 #3.
 *
 * `resolveTenantAccess` with `allowStaffOverride` and the `:id` path segment as the explicit
 * tenant: a non-staff caller is 401, the unattributable `ADMIN_API_SECRET` Bearer is 403, an
 * unknown or soft-deleted tenant is 404. A write additionally needs `estalara:ops` or higher
 * (403 below, before any read or write). The routes then commit the mutation and its
 * `staff_audit_log` row in ONE transaction. Responses keep the legacy `{ error: string }` body
 * these routes have always returned.
 *
 * @module apps/control-plane/src/lib/lia-access
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { AccessError, resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';

/**
 * @param req - the incoming request
 * @param tenantId - the `:id` path segment (the explicit target tenant)
 * @returns the resolved write access, or the error response to return as-is
 */
export async function resolveLiaWriteAccess(
  req: NextRequest,
  tenantId: string,
): Promise<{ ok: true; access: TenantAccess } | { ok: false; response: NextResponse }> {
  let access: TenantAccess;
  try {
    access = await resolveTenantAccess(req, { allowStaffOverride: true, tenantId });
  } catch (err) {
    if (err instanceof AccessError) {
      const error = err.status === 401 ? 'Unauthorized' : err.message;
      return { ok: false, response: NextResponse.json({ error }, { status: err.status }) };
    }
    throw err;
  }
  if (!access.canWrite) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Forbidden: compliance-record writes require estalara:ops or higher' },
        { status: 403 },
      ),
    };
  }
  return { ok: true, access };
}
