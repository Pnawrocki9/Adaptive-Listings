/**
 * GET /api/admin/analytics/rollup
 *
 * The analytics rollup (sessions, arms, conversion lift, quiz completions, scoring-path and
 * reorder-withheld telemetry) for the Estalara tenant. FOLLOW-638 built it as a cross-brand
 * rollup; ESC-085 made the product single-tenant and FOLLOW-1330 scoped it to one tenant. See
 * `./data.ts` for the Rule K.2 fail-loud contract and the query design.
 *
 * The FOLLOW-819 harness calls this with `Authorization: Bearer <ADMIN_API_SECRET>` and NO
 * `tenant_id` for AC(5); `route.contract.test.ts` pins the response keys it reads.
 *
 * Tenant: no `?tenant_id` → `ESTALARA_TENANT_ID`. An explicit `?tenant_id` equal to it is accepted
 * (`scripts/dev/localhost-up.sh` warms the route that way); any other value → 400
 * `unknown_tenant`, the code the other staff admin routes use for a tenant they will not serve.
 *
 * Auth: STAFF-ONLY via `verifyTracerAdminAuth` — Bearer <ADMIN_API_SECRET> (constant-time
 * compare) OR a verified Estalara staff SSR session/JWT. Read-only route, so per Rule H amendment
 * no HMAC + replay-resistant auth is required (that applies to state-mutating endpoints; this route
 * makes zero writes).
 *
 * Rule K.2: a configured-but-failing ClickHouse rollup query returns HTTP 500 + Sentry capture —
 * never fabricated. `data_source` is 'mock' only when the stores are unconfigured (dev/CI).
 *
 * @module apps/control-plane/src/app/api/admin/analytics/rollup/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { ESTALARA_TENANT_ID } from '@/lib/estalara-tenant';
import { verifyTracerAdminAuth } from '@/lib/tracer-auth';
import { getTenantAnalyticsRollup } from './data';

/**
 * @returns 200 TenantAnalyticsRollup on success (live or mock).
 * @returns 400 `unknown_tenant` when `?tenant_id` names any tenant but the Estalara one.
 * @returns 401/403 when the caller is not a verified Estalara staff member.
 * @returns 500 when ClickHouse is configured but the rollup query fails (Rule K.2 — fail loud on
 *   the primary metric group).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authResult = await verifyTracerAdminAuth(req);
  if (!authResult.ok) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: authResult.message } },
      { status: authResult.status },
    );
  }

  const requested = req.nextUrl.searchParams.get('tenant_id');
  if (requested !== null && requested.toLowerCase() !== ESTALARA_TENANT_ID.toLowerCase()) {
    return NextResponse.json(
      {
        error: {
          code: 'unknown_tenant',
          message:
            'tenant_id must be omitted or equal the Estalara tenant (single tenant, ESC-085)',
        },
      },
      { status: 400 },
    );
  }

  const result = await getTenantAnalyticsRollup(ESTALARA_TENANT_ID);
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: 'query_failed', message: result.error } },
      { status: result.status },
    );
  }

  return NextResponse.json(result.data, { status: 200 });
}
