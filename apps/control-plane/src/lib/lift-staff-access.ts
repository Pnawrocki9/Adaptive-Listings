/**
 * Staff-only tenant access for the lift report's secondary routes (FOLLOW-1338): the CSV export and
 * the snapshot history. Both are READS, so any staff rank (including `estalara:readonly`) passes —
 * there is no write to rank-gate; an agency session is refused 403 `staff_only`.
 *
 * ADR-0018 §2: `resolveTenantAccess` with `allowStaffOverride`. The returned `tenantId` is the
 * existence-checked `?tenant_id=` and the SINGLE tenant fence for every query the caller runs.
 *
 * @module apps/control-plane/src/lib/lift-staff-access
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { accessErrorToResponse } from '@/lib/access-error-response';

/**
 * @returns the validated staff access, or the error response to return as-is (401 no session, 400
 *   missing `tenant_id`, 403 non-staff / foreign, 404 unknown tenant).
 */
export async function resolveLiftStaffAccess(
  req: NextRequest,
): Promise<{ access: Extract<TenantAccess, { via: 'staff' }> } | { error: NextResponse }> {
  const tenantIdParam = req.nextUrl.searchParams.get('tenant_id');
  let access: TenantAccess;
  try {
    access = await resolveTenantAccess(req, {
      allowStaffOverride: true,
      // exactOptionalPropertyTypes: omit the key when absent so a staff caller without
      // ?tenant_id reaches resolve's 400.
      ...(tenantIdParam ? { tenantId: tenantIdParam } : {}),
    });
  } catch (err) {
    return { error: accessErrorToResponse(err) };
  }
  if (access.via !== 'staff') {
    return {
      error: NextResponse.json(
        {
          error: {
            code: 'staff_only',
            message: 'The lift report export and history are an Estalara staff surface',
          },
        },
        { status: 403 },
      ),
    };
  }
  return { access };
}
