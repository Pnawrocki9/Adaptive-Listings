/**
 * GET /api/admin/analytics/rollup
 *
 * FOLLOW-638 — cross-brand aggregate analytics. Returns a platform-wide
 * rollup (sessions, adaptations, CTA lift, quiz completions summed across
 * every brand) PLUS a per-brand breakdown row for each tenant. See
 * `./data.ts` for the full Rule K.2 fail-loud contract and query design.
 *
 * Auth: STAFF-ONLY, deliberately UNFENCED (no single-tenant scope — this
 * route reads across every tenant by design). `resolveTenantAccess` does not
 * fit here: it always resolves to exactly ONE tenant fence (agency claim, or
 * a staff-supplied `?tenant_id=`), which is the opposite of what this route
 * needs. Instead this uses `verifyTracerAdminAuth` — the same staff-only gate
 * already used by the other unfenced staff routes (`/api/admin/tracer/sessions`,
 * `/api/admin/intent/config`): Bearer <ADMIN_API_SECRET> (constant-time
 * compare) OR a verified Estalara staff SSR session/JWT. Read-only route, so
 * per Rule H amendment no HMAC + replay-resistant auth is required (that
 * applies to state-mutating endpoints; this route makes zero writes).
 *
 * Rule K.2: a configured-but-failing ClickHouse or tenant-roster Postgres
 * query returns HTTP 500 + Sentry capture — never fabricated. `data_source`
 * is 'mock' only when both stores are unconfigured (dev/CI). The secondary
 * `quizCompletions` metric degrades independently via `quiz_data_source`.
 *
 * @module apps/control-plane/src/app/api/admin/analytics/rollup/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { verifyTracerAdminAuth } from '@/lib/tracer-auth';
import { getPlatformAnalyticsRollup } from './data';

/**
 * @returns 200 PlatformAnalyticsRollup on success (live or mock).
 * @returns 401/403 when the caller is not a verified Estalara staff member.
 * @returns 500 when ClickHouse or the tenant roster Postgres query is
 *   configured but fails (Rule K.2 — fail loud on the primary metric group).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const authResult = await verifyTracerAdminAuth(req);
  if (!authResult.ok) {
    return NextResponse.json(
      { error: { code: 'unauthorized', message: authResult.message } },
      { status: authResult.status },
    );
  }

  const result = await getPlatformAnalyticsRollup();
  if (!result.ok) {
    return NextResponse.json(
      { error: { code: 'query_failed', message: result.error } },
      { status: result.status },
    );
  }

  return NextResponse.json(result.data, { status: 200 });
}
