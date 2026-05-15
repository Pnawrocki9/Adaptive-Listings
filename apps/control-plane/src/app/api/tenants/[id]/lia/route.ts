/**
 * GET  /api/tenants/:id/lia — fetch the latest active LIA record for a tenant.
 * POST /api/tenants/:id/lia — create a new LIA record (old records retained for audit trail).
 *
 * Auth:
 *   GET  — Bearer JWT scoped to the tenant OR a staff JWT.
 *   POST — Bearer JWT scoped to the tenant OR a staff JWT.
 *   Both: the tenant_id in the JWT must match the `:id` param (or caller must be staff).
 *
 * GET responses:
 *   200 { lia: TenantComplianceRecord } — active LIA found.
 *   404 { error: "no_lia_on_file" }    — no non-deleted LIA exists for this tenant.
 *   401 { error: "Unauthorized" }       — missing or invalid JWT.
 *   403 { error: "Forbidden" }          — JWT tenant mismatch.
 *
 * POST responses:
 *   201 { lia: TenantComplianceRecord } — record created.
 *   401 { error: "Unauthorized" }        — missing or invalid JWT.
 *   403 { error: "Forbidden" }           — JWT tenant mismatch.
 *   422 { error: "Validation failed", details: ... } — Zod validation failure.
 *   500 { error: "Failed to create LIA record" }     — DB error.
 *
 * TICKET-GDPR-003
 *
 * @module apps/control-plane/src/app/api/tenants/[id]/lia/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { desc, eq, and, isNull, or } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

import { createAdminClient, tenantComplianceRecords } from '@estalara/db';
import { getAuthClaims, isStaffClaims } from '@estalara/auth';
import { LiaRecordSchema } from '@estalara/shared';

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

/**
 * Validate the Bearer JWT and assert the caller has access to the given tenantId.
 *
 * Access is granted if:
 *   1. The caller is Estalara staff (estalara_staff = true), OR
 *   2. The caller's tenant_id matches the requested tenantId.
 *
 * Returns `{ ok: true }` on success, or a NextResponse error.
 */
async function validateLiaAuth(
  req: NextRequest,
  tenantId: string,
): Promise<{ ok: true } | NextResponse> {
  const claims = await getAuthClaims(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (isStaffClaims(claims)) {
    // Staff can access any tenant's compliance records.
    return { ok: true };
  }
  // Agency user — must match the requested tenant.
  if (!claims.tenant_id || claims.tenant_id !== tenantId) {
    return NextResponse.json({ error: 'Forbidden: tenant mismatch' }, { status: 403 });
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// GET — latest active LIA
// ---------------------------------------------------------------------------

/**
 * GET /api/tenants/:id/lia
 *
 * Returns the most recently created non-deleted LIA record for the tenant.
 * "Active" is defined as `metadata->>'deleted' IS NULL OR metadata->>'deleted' != 'true'`.
 *
 * @returns 200 `{ lia }` or 404 `{ error: "no_lia_on_file" }`.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: tenantId } = await params;

  const authResult = await validateLiaAuth(req, tenantId);
  if (authResult instanceof NextResponse) return authResult;

  try {
    const db = createAdminClient();

    // Fetch the latest non-deleted LIA record for this tenant.
    // "deleted" is stored as metadata->>'deleted' = 'true' (JSONB string).
    const rows = await db
      .select()
      .from(tenantComplianceRecords)
      .where(
        and(
          eq(tenantComplianceRecords.tenantId, tenantId),
          eq(tenantComplianceRecords.recordType, 'lia'),
          or(
            isNull(sql`(${tenantComplianceRecords.metadata}->>'deleted')`),
            sql`(${tenantComplianceRecords.metadata}->>'deleted') != 'true'`,
          ),
        ),
      )
      .orderBy(desc(tenantComplianceRecords.createdAt))
      .limit(1);

    const lia = rows[0];
    if (!lia) {
      return NextResponse.json({ error: 'no_lia_on_file' }, { status: 404 });
    }

    return NextResponse.json({ lia }, { status: 200 });
  } catch (err) {
    console.error('[lia GET] DB query failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to fetch LIA record' }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST — create new LIA record
// ---------------------------------------------------------------------------

/**
 * POST /api/tenants/:id/lia
 *
 * Inserts a new LIA record. Old records are NOT updated or removed — they are
 * retained for audit trail purposes. The new record becomes the "latest" record.
 *
 * @returns 201 `{ lia }` on success.
 * @returns 422 on Zod validation failure.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: tenantId } = await params;

  const authResult = await validateLiaAuth(req, tenantId);
  if (authResult instanceof NextResponse) return authResult;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = LiaRecordSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Validation failed', details: parsed.error.flatten() },
      { status: 422 },
    );
  }

  const body = parsed.data;

  try {
    const db = createAdminClient();

    const inserted = await db
      .insert(tenantComplianceRecords)
      .values({
        tenantId,
        recordType: 'lia',
        version: 'lia-v1.0',
        purposeStatement: body.purpose_statement,
        necessityJustification: body.necessity_justification,
        balancingConclusion: body.balancing_conclusion,
        optoutMechanism: body.optout_mechanism,
        signedByName: body.signed_by_name,
        signedByEmail: body.signed_by_email,
        signedAt: new Date(body.signed_at),
        metadata: {},
      })
      .returning();

    const lia = inserted[0];
    if (!lia) {
      return NextResponse.json({ error: 'Failed to create LIA record' }, { status: 500 });
    }

    return NextResponse.json({ lia }, { status: 201 });
  } catch (err) {
    console.error('[lia POST] DB insert failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to create LIA record' }, { status: 500 });
  }
}
