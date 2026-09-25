/**
 * GET /api/internal/schema
 *
 * Internal schema lookup endpoint. Its only in-repo caller was the Decision API
 * Cloudflare Worker (DB fallback on an Upstash Redis cache miss); that Worker was
 * removed 2026-09-24 by FOLLOW-1262, so this route currently has no in-repo caller.
 *
 * Query params:
 *   tenant_id — required, tenant UUID (or 'est_demo_tenant')
 *
 * Auth:
 *   Authorization: Bearer <SCHEMA_API_TOKEN>, compared constant-time via
 *   `secretEquals`.
 *
 *   Fail-closed (FOLLOW-490 / FOLLOW-456 / audit F-13): when the env var is
 *   unset, every request is rejected with 401 — previously an unset secret
 *   accepted ANY non-empty bearer token.
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
import { secretEquals } from '@/lib/secret-compare';

/**
 * GET /api/internal/schema?tenant_id=<id>
 *
 * Returns the minimal reorder schema for the given tenant, or null when the tenant
 * has no schema or is not reorder-capable.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  // Auth gate
  // Fail CLOSED: an unset SCHEMA_API_TOKEN denies every request rather than
  // accepting any non-empty bearer (FOLLOW-490 / FOLLOW-456 / audit F-13).
  const auth = req.headers.get('Authorization') ?? req.headers.get('authorization');
  const token = auth?.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const schemaApiToken = process.env.SCHEMA_API_TOKEN;
  if (!token || !schemaApiToken || !secretEquals(schemaApiToken, token)) {
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
