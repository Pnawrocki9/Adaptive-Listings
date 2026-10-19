/**
 * GET  /api/tenants/:id/lia — fetch the latest active LIA record for a tenant.
 * POST /api/tenants/:id/lia — create a new LIA record (old records retained for audit trail).
 *
 * Auth:
 *   GET  — Estalara staff, any rank (Bearer JWT or SSR session).
 *   POST — `resolveLiaWriteAccess` (`lib/lia-access.ts`): identified staff with rank ≥
 *     `estalara:ops`, on a tenant that exists (FOLLOW-1335 review F3, ADR-0018 #3). The insert
 *     and its `staff_audit_log` row (`lia.create`) commit in ONE transaction.
 *   FOLLOW-1335 removed the tenant-user path (JWT `tenant_id` matching `:id`) with the
 *   agency roles.
 *
 * GET responses:
 *   200 { lia: TenantComplianceRecord } — active LIA found.
 *   404 { error: "no_lia_on_file" }    — no non-deleted LIA exists for this tenant.
 *   401 { error: "Unauthorized" }       — missing or invalid JWT.
 *   403 { error: "Forbidden" }          — the caller is not Estalara staff.
 *
 * POST responses:
 *   201 { lia: TenantComplianceRecord } — record created (and audited).
 *   401 { error: "Unauthorized" }        — no staff session/JWT.
 *   403 { error: "..." }                 — readonly staff, or the unattributable ADMIN_API_SECRET.
 *   404 { error: "Unknown tenant" }      — `:id` is not a live tenant.
 *   422 { error: "Validation failed", details: ... } — Zod validation failure.
 *   500 { error: "...", code: "audit_write_failed" } — insert or audit row failed; nothing kept.
 *
 * TICKET-GDPR-003
 *
 * @module apps/control-plane/src/app/api/tenants/[id]/lia/route
 */

import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { desc, eq, and, isNull, or } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

import * as Sentry from '@sentry/nextjs';

import { createAdminClient, staffAuditLog, tenantComplianceRecords } from '@estalara/db';
import { isStaffClaims } from '@estalara/auth';
import { getSessionAuthClaims } from '@/lib/session-auth';
import { resolveLiaWriteAccess } from '@/lib/lia-access';
import { requestIp } from '@/lib/answers-access';
import { LiaRecordSchema } from '@estalara/shared';

// ---------------------------------------------------------------------------
// Auth helper
// ---------------------------------------------------------------------------

/**
 * Validate the caller's session/JWT and assert it is Estalara staff, who may access any
 * tenant's compliance records (FOLLOW-1335: the tenant-user path is gone).
 *
 * Returns `{ ok: true }` on success, or a NextResponse error.
 */
async function validateLiaAuth(req: NextRequest): Promise<{ ok: true } | NextResponse> {
  const claims = await getSessionAuthClaims(req);
  if (!claims) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isStaffClaims(claims)) {
    return NextResponse.json({ error: 'Forbidden: Estalara staff only' }, { status: 403 });
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

  const authResult = await validateLiaAuth(req);
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
 * The `staff_audit_log` payload carries the record id, type, version and `signed_at` only — not
 * the signer's name/e-mail nor the free-text statements (personal data stays in the record).
 *
 * @returns 201 `{ lia }` on success.
 * @returns 422 on Zod validation failure.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id: tenantId } = await params;

  const auth = await resolveLiaWriteAccess(req, tenantId);
  if (!auth.ok) return auth.response;
  const { access } = auth;

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

  // ── Atomic staff write (ADR-0018 §3a) ──────────────────────────────────────────────────────
  // The insert and its staff_audit_log row commit-or-roll-back TOGETHER, fenced on the
  // existence-checked access.tenantId.
  try {
    const db = createAdminClient();
    const lia = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(tenantComplianceRecords)
        .values({
          tenantId: access.tenantId,
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
      const created = inserted[0];
      if (!created) throw new Error('tenant_compliance_records insert returned no row');
      await tx.insert(staffAuditLog).values({
        adminUserId: access.staff.sub,
        action: 'lia.create',
        targetTenantId: access.tenantId,
        payload: {
          record_id: created.id,
          record_type: 'lia',
          version: created.version,
          signed_at: created.signedAt.toISOString(),
        },
        ipAddress: requestIp(req),
        userAgent: req.headers.get('user-agent'),
      });
      return created;
    });
    return NextResponse.json({ lia }, { status: 201 });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: 'tenants/lia', staff_audit_error: 'true' },
      extra: { tenant_id: access.tenantId, admin_user_id: access.staff.sub },
    });
    return NextResponse.json(
      {
        error:
          'The LIA record could not be recorded atomically with its staff audit row; ' +
          'nothing was saved. Retry the action.',
        code: 'audit_write_failed',
      },
      { status: 500 },
    );
  }
}
