/**
 * Access gate for the per-listing FAQ answer routes (`/api/tenants/:id/answers[/:answerId]`).
 *
 * ADR-0018 §2 / FOLLOW-1334: the agency path (tenant from the session claim, `:id` as a cross-check)
 * is unchanged; an Estalara staff session may act on the tenant named by `:id`, which
 * `resolveTenantAccess` validates against the `tenants` table. A staff WRITE additionally needs
 * `estalara:ops` or higher (CEO Q3, ADR-0018 §4) and is audited by the route, in the same
 * transaction as the mutation (ADR-0018 §3a). Responses keep the legacy `{ error: string }` body
 * these routes have always returned.
 *
 * @module apps/control-plane/src/lib/answers-access
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { AccessError, resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';

type AnswersAccess = { ok: true; access: TenantAccess } | { ok: false; response: NextResponse };

/**
 * Resolve who is calling and which tenant they may touch.
 *
 * @param req - the incoming request
 * @param tenantId - the `:id` path segment (cross-check for agency, explicit target for staff)
 * @param mode - `'write'` additionally rejects a staff caller below `estalara:ops` (403)
 * @returns the resolved access, or the error response to return as-is
 */
export async function resolveAnswersAccess(
  req: NextRequest,
  tenantId: string,
  mode: 'read' | 'write',
): Promise<AnswersAccess> {
  let access: TenantAccess;
  try {
    access = await resolveTenantAccess(req, {
      allowStaffOverride: true,
      tenantId,
    });
  } catch (err) {
    if (err instanceof AccessError) {
      const error = err.status === 401 ? 'Unauthorized' : err.message;
      return { ok: false, response: NextResponse.json({ error }, { status: err.status }) };
    }
    throw err;
  }

  if (mode === 'write' && access.via === 'staff' && !access.canWrite) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Forbidden: staff write requires estalara:ops or higher' },
        { status: 403 },
      ),
    };
  }
  return { ok: true, access };
}

/** Best-effort client IP for the staff audit trail (no throw if absent). */
export function requestIp(req: NextRequest): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]?.trim() ?? null;
  return req.headers.get('x-real-ip');
}
