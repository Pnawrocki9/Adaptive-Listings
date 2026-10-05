/**
 * GET /api/dashboard/analytics/lift
 *
 * The ONE CTA-lift route (FOLLOW-1289, WP-2.4). Serves both the analytics panels (`rows`) and the
 * pilot dashboard (`summary`, `funnel`, `by_archetype`) from the same ClickHouse queries and the
 * single lift computation in `@/lib/pilot-stats` — see `./route-helpers.ts`. The former
 * `/api/pilot/cta-lift` route now answers 410 and names this path.
 *
 *   GET /api/dashboard/analytics/lift?window_days=<7|14|30>[&tenant_id=<uuid>  (staff only)]
 *
 * Auth (ADR-0018 §2, FOLLOW-594): `resolveTenantAccess` with `allowStaffOverride`. Agency path:
 * tenant from the session claim. Estalara staff may read any tenant via an explicit
 * `?tenant_id=<uuid>` validated against the `tenants` table; that validated id is the SINGLE tenant
 * fence bound into the ClickHouse queries. Staff calls without `?tenant_id` are rejected (400).
 *
 * Identity caveat (RETRO-187): `resolveTenantAccess` REJECTS the headless `ADMIN_API_SECRET` Bearer
 * path for staff (403 — a shared secret is not attributable to a staff user for a tenant-scoped
 * read). Staff must authenticate with an identified SSR session or a staff JWT.
 *
 * Rule K.2 — fail loud: when CLICKHOUSE_URL is set but a query fails, this route returns HTTP 500
 * and captures the error in Sentry. It NEVER silently falls back to mock data when a real
 * ClickHouse is configured (RETRO-008 / FOLLOW-439). When CLICKHOUSE_URL is unset (dev / CI), the
 * mock fallback is legitimate and is tagged data_source:'mock' so it is never mistaken for real
 * data.
 *
 * @module apps/control-plane/src/app/api/dashboard/analytics/lift/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { accessErrorToResponse } from '@/lib/access-error-response';
import {
  buildMockRaw,
  buildResponseFromRaw,
  fetchLiftRaw,
  parseWindowDays,
  type ChRawData,
} from './route-helpers';

/**
 * GET /api/dashboard/analytics/lift
 *
 * @returns 200 LiftResponse on success.
 * @returns 400 when a staff caller omits `?tenant_id`.
 * @returns 401 when no valid session is present.
 * @returns 403 when the caller is not permitted (e.g. agency acting on a foreign tenant).
 * @returns 404 when a staff caller supplies an unknown tenant id.
 * @returns 500 when CLICKHOUSE_URL is set but the ClickHouse query fails
 *   (Rule K.2 — fail loud; never silently fall back to mock data when a real
 *   ClickHouse is configured).
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // One auth path for agency + staff (ADR-0018 invariant 5): `access.tenantId` is
  // the ONLY tenant fence — bound into the ClickHouse query as param_tenant_id for
  // BOTH paths.
  const tenantIdParam = req.nextUrl.searchParams.get('tenant_id');
  let access: TenantAccess;
  try {
    access = await resolveTenantAccess(req, {
      allowStaffOverride: true,
      // exactOptionalPropertyTypes: omit the key when absent rather than passing
      // `undefined`, so a staff caller without ?tenant_id still reaches resolve's 400.
      ...(tenantIdParam ? { tenantId: tenantIdParam } : {}),
      minAgencyRole: 'agency:viewer',
    });
  } catch (err) {
    return accessErrorToResponse(err);
  }

  const tenantId: string = access.tenantId;
  const windowDays = parseWindowDays(req.nextUrl.searchParams.get('window_days'));

  // Rule K.2: when CLICKHOUSE_URL is unset (dev / CI), serve deterministic mock
  // data tagged data_source:'mock' so consumers can distinguish it from real data.
  if (!process.env.CLICKHOUSE_URL) {
    const response = buildResponseFromRaw(
      tenantId,
      windowDays,
      buildMockRaw(tenantId, windowDays),
      'mock',
    );
    return NextResponse.json(response, { status: 200 });
  }

  // Rule K.2: CLICKHOUSE_URL is set — fail loud on any error; never fabricate data.
  let raw: ChRawData | null;
  try {
    raw = await fetchLiftRaw(tenantId, windowDays);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    Sentry.captureException(err, {
      tags: { route: 'dashboard/analytics/lift', tenant_id: tenantId },
      extra: { window_days: windowDays },
    });
    return NextResponse.json(
      {
        error: {
          code: 'clickhouse_query_failed',
          message: `ClickHouse query failed: ${message}`,
        },
      },
      { status: 500 },
    );
  }

  // raw is null only when CLICKHOUSE_URL is unset — already handled above.
  // Treat null as empty (no data) to satisfy the type without a non-null assertion.
  const data: ChRawData = raw ?? { groups: [], archetypes: [], funnel: [] };
  return NextResponse.json(buildResponseFromRaw(tenantId, windowDays, data, 'clickhouse'), {
    status: 200,
  });
}
