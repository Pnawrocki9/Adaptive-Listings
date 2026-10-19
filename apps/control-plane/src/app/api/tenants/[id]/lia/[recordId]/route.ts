/**
 * DELETE /api/tenants/:id/lia/:recordId — soft-delete a specific LIA record.
 *
 * Compliance records must NEVER be physically deleted — audit trail integrity is a
 * legal requirement. Soft delete sets `metadata.deleted = true` on the JSONB column.
 *
 * Auth: `resolveLiaWriteAccess` (`lib/lia-access.ts`) — identified Estalara staff with rank ≥
 * `estalara:ops` on a tenant that exists (FOLLOW-1335 review F3, ADR-0018 #3). The soft-delete
 * and its `staff_audit_log` row (`lia.delete`, payload `{ record_id }` only) commit in ONE
 * transaction.
 *
 * Responses:
 *   200 { deleted: true }              — record soft-deleted (and audited).
 *   401 { error: "Unauthorized" }      — no staff session/JWT.
 *   403 { error: "..." }               — readonly staff, or the unattributable ADMIN_API_SECRET.
 *   404 { error: "..." }               — unknown tenant, or no record with recordId for it.
 *   500 { error: "...", code: "audit_write_failed" } — update or audit row failed; nothing kept.
 *
 * TICKET-GDPR-003
 *
 * @module apps/control-plane/src/app/api/tenants/[id]/lia/[recordId]/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { eq, and, sql } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';

import { createAdminClient, staffAuditLog, tenantComplianceRecords } from '@estalara/db';
import { resolveLiaWriteAccess } from '@/lib/lia-access';
import { requestIp } from '@/lib/answers-access';

/** A malformed id matches no row; checked before the uuid cast could throw inside the tx. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// DELETE — soft-delete a specific LIA record
// ---------------------------------------------------------------------------

/**
 * DELETE /api/tenants/:id/lia/:recordId
 *
 * Soft-deletes a LIA record by merging `{"deleted":true}` into the `metadata` JSONB column.
 * Physical deletion is explicitly prohibited to preserve the audit trail.
 * Only Estalara staff of rank ops or higher can perform this operation.
 *
 * @returns 200 `{ deleted: true }` on success.
 * @returns 401 if there is no staff session/JWT.
 * @returns 403 for readonly staff or the ADMIN_API_SECRET Bearer.
 * @returns 404 if the tenant is unknown or the record does not exist for it.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; recordId: string }> },
): Promise<NextResponse> {
  const { id: tenantId, recordId } = await params;

  const auth = await resolveLiaWriteAccess(req, tenantId);
  if (!auth.ok) return auth.response;
  const { access } = auth;

  if (!UUID_RE.test(recordId)) {
    return NextResponse.json({ error: 'Record not found' }, { status: 404 });
  }

  // ── Atomic staff write (ADR-0018 §3a) ──────────────────────────────────────────────────────
  // Soft-delete: merge `{"deleted":true}` into the existing metadata JSONB (`||` overwrites the
  // key). Fenced on the record id AND access.tenantId; the audit row commits with it or not at
  // all. A record that is not this tenant's matches no row: 404, no audit row.
  try {
    const db = createAdminClient();
    const removed = await db.transaction(async (tx) => {
      const updated = await tx
        .update(tenantComplianceRecords)
        .set({
          metadata: sql`${tenantComplianceRecords.metadata} || '{"deleted":true}'::jsonb`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tenantComplianceRecords.id, recordId),
            eq(tenantComplianceRecords.tenantId, access.tenantId),
          ),
        )
        .returning({ id: tenantComplianceRecords.id });
      const row = updated[0];
      if (!row) return null;
      await tx.insert(staffAuditLog).values({
        adminUserId: access.staff.sub,
        action: 'lia.delete',
        targetTenantId: access.tenantId,
        payload: { record_id: row.id },
        ipAddress: requestIp(req),
        userAgent: req.headers.get('user-agent'),
      });
      return row;
    });
    if (!removed) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }
    return NextResponse.json({ deleted: true }, { status: 200 });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: 'tenants/lia/[recordId]', staff_audit_error: 'true' },
      extra: { tenant_id: access.tenantId, admin_user_id: access.staff.sub, record_id: recordId },
    });
    return NextResponse.json(
      {
        error:
          'The LIA soft-delete could not be recorded atomically with its staff audit row; ' +
          'it was rolled back and NOT applied. Retry the action.',
        code: 'audit_write_failed',
      },
      { status: 500 },
    );
  }
}
