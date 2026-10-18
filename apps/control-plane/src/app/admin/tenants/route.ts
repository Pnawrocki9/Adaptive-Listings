/**
 * GET /admin/tenants — bookmark-compat entry (FOLLOW-1329, ESC-085).
 *
 * The tenant fleet list was removed (single tenant). This index only forwards to the Estalara
 * tenant hub so old bookmarks and links keep working. It is a route handler, not a `page.tsx`,
 * on purpose: the N1 single-tenant gate (`scripts/check-single-tenant.sh`) tracks
 * `admin/tenants/page.tsx` as a REMOVED path, so a page at that path would never let the ratchet
 * reach zero.
 *
 * 307 (not 308): the target depends on per-environment config (`NEXT_PUBLIC_ESTALARA_TENANT_ID`),
 * and browsers cache a permanent redirect. Auth: `/admin/*` is staff-gated by `middleware.ts`
 * before this handler runs; the handler reads nothing and writes nothing, and the hub itself
 * verifies the tenant exists (`getTenantById`, fail loud).
 *
 * @module apps/control-plane/src/app/admin/tenants/route
 */

import { NextResponse } from 'next/server';

import { ESTALARA_TENANT_ID } from '@/lib/estalara-tenant';

export function GET(request: Request): NextResponse {
  return NextResponse.redirect(new URL(`/admin/tenants/${ESTALARA_TENANT_ID}`, request.url), 307);
}
