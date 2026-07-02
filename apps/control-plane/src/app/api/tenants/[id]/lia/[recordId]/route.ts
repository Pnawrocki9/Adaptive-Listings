/**
 * DELETE /api/tenants/:id/lia/:recordId — soft-delete a specific LIA record.
 *
 * Compliance records must NEVER be physically deleted — audit trail integrity is a
 * legal requirement. Soft delete sets `metadata.deleted = true` on the JSONB column.
 *
 * Auth: STAFF JWT only (estalara_staff = true).
 * Tenant admins cannot self-delete their compliance records — this prevents accidental
 * or coerced removal of evidence of compliance assessments.
 *
 * Responses:
 *   200 { deleted: true }              — record soft-deleted.
 *   401 { error: "Unauthorized" }      — missing or invalid JWT.
 *   403 { error: "Forbidden" }         — caller is not Estalara staff.
 *   404 { error: "Record not found" }  — no record with recordId for this tenant.
 *   500 { error: "..." }               — DB error.
 *
 * TICKET-GDPR-003
 *
 * @module apps/control-plane/src/app/api/tenants/[id]/lia/[recordId]/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { eq, and, sql } from 'drizzle-orm';

import { createAdminClient, tenantComplianceRecords } from '@estalara/db';
import { isStaffClaims } from '@estalara/auth';
import { getSessionAuthClaims } from '@/lib/session-auth';

// ---------------------------------------------------------------------------
// DELETE — soft-delete a specific LIA record
// ---------------------------------------------------------------------------

/**
 * DELETE /api/tenants/:id/lia/:recordId
 *
 * Soft-deletes a LIA record by merging `{"deleted":true}` into the `metadata` JSONB column.
 * Physical deletion is explicitly prohibited to preserve the audit trail.
 * Only Estalara staff can perform this operation.
 *
 * @returns 200 `{ deleted: true }` on success.
 * @returns 401 if no valid JWT.
 * @returns 403 if the caller is not Estalara staff.
 * @returns 404 if the record does not exist for this tenant.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; recordId: string }> },
): Promise<NextResponse> {
  const { id: tenantId, recordId } = await params;

  // Staff-only: tenant admins cannot delete compliance records.
  const claims = await getSessionAuthClaims(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isStaffClaims(claims)) {
    return NextResponse.json(
      { error: 'Forbidden: only Estalara staff can delete compliance records' },
      { status: 403 },
    );
  }

  try {
    const db = createAdminClient();

    // Verify the record exists and belongs to this tenant before updating.
    const existing = await db
      .select({ id: tenantComplianceRecords.id })
      .from(tenantComplianceRecords)
      .where(
        and(
          eq(tenantComplianceRecords.id, recordId),
          eq(tenantComplianceRecords.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (!existing[0]) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    // Soft-delete: merge `{"deleted":true}` into the existing metadata JSONB.
    // The `||` operator merges JSONB objects in Postgres, overwriting duplicate keys.
    await db
      .update(tenantComplianceRecords)
      .set({
        metadata: sql`${tenantComplianceRecords.metadata} || '{"deleted":true}'::jsonb`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tenantComplianceRecords.id, recordId),
          eq(tenantComplianceRecords.tenantId, tenantId),
        ),
      );

    return NextResponse.json({ deleted: true }, { status: 200 });
  } catch (err) {
    console.error('[lia DELETE] DB update failed:', err instanceof Error ? err.message : err);
    return NextResponse.json({ error: 'Failed to soft-delete LIA record' }, { status: 500 });
  }
}
