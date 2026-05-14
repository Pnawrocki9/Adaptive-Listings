/**
 * GET /api/internal/schema
 *
 * Internal schema lookup endpoint — consumed by the decision-api Cloudflare Worker
 * as a DB fallback when the Upstash Redis cache misses.
 *
 * Query params:
 *   tenant_id — required, tenant UUID (or 'est_demo_tenant')
 *
 * Auth:
 *   Authorization: Bearer <SCHEMA_API_TOKEN>
 *   When SCHEMA_API_TOKEN is not configured, presence-only auth is used.
 *
 * Response:
 *   200 — TenantSiteSchemaMin | null (JSON)
 *   400 — missing or invalid tenant_id
 *   401 — missing or invalid token
 *
 * @module apps/control-plane/src/app/api/internal/schema/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { getTenantSchema } from '@/lib/tenant-schema';

/**
 * GET /api/internal/schema?tenant_id=<id>
 *
 * Returns the minimal reorder schema for the given tenant, or null when the tenant
 * has no schema or is not reorder-capable.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // Auth gate
  const auth = req.headers.get('Authorization') ?? req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const schemaApiToken = process.env.SCHEMA_API_TOKEN;
  if (schemaApiToken && token !== schemaApiToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tenantId = req.nextUrl.searchParams.get('tenant_id');
  if (!tenantId || tenantId.trim().length === 0) {
    return NextResponse.json(
      { error: 'Missing required query parameter: tenant_id' },
      { status: 400 },
    );
  }

  const schema = await getTenantSchema(tenantId);
  return NextResponse.json(schema, { status: 200 });
}
