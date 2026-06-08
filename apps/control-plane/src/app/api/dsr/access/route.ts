/**
 * GET /api/dsr/access?token=<OTP>
 *
 * Returns a summary of the data Estalara holds for the session identified by
 * the DSR OTP token. No JWT required — the OTP is the authorisation mechanism.
 *
 * Flow:
 *   1. Hash submitted OTP, look up dsr_verifications WHERE otp_hash = hash AND dsr_type = 'access'.
 *   2. Validate: not expired, not used.
 *   3. Mark used_at = now().
 *   4. Query session_embeddings and consent_records.
 *   5. Return data summary.
 *
 * ClickHouse event count is a follow-up (out of MVP scope).
 * For now, events_summary.count = 1 is returned with the session row.
 *
 * @module apps/control-plane/src/app/api/dsr/access/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { eq, and } from 'drizzle-orm';
import {
  createAdminClient,
  dsrVerifications,
  sessionEmbeddings,
  consentRecords,
} from '@estalara/db';
import { hashOtp } from '@/lib/dsr-otp';
import { DSR_AUDIT_ACTIONS, writeDsrAuditLog } from '../_clickhouse';

// ─── GET handler ───────────────────────────────────────────────────────────────

/**
 * GET /api/dsr/access?token=<6-digit-OTP>
 *
 * @returns 200 data access summary on success.
 * @returns 400 when token param is missing.
 * @returns 401 when OTP is expired or already used.
 * @returns 404 when OTP is not found or wrong type.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: "Query param 'token' is required" } },
      { status: 400 },
    );
  }

  const db = createAdminClient();
  const otpHash = hashOtp(token);

  // ── Look up the verification record ──────────────────────────────────────
  const [record] = await db
    .select()
    .from(dsrVerifications)
    .where(and(eq(dsrVerifications.otpHash, otpHash), eq(dsrVerifications.dsrType, 'access')))
    .limit(1);

  if (!record) {
    return NextResponse.json(
      { error: { code: 'NOT_FOUND', message: 'Token not found or invalid type' } },
      { status: 404 },
    );
  }

  // ── Validate: not expired ─────────────────────────────────────────────────
  if (record.expiresAt < new Date()) {
    return NextResponse.json(
      {
        error: {
          code: 'token_expired',
          message: 'This token has expired. Please request a new one.',
        },
      },
      { status: 401 },
    );
  }

  // ── Validate: not already used ────────────────────────────────────────────
  if (record.usedAt !== null) {
    return NextResponse.json(
      { error: { code: 'token_already_used', message: 'This token has already been used.' } },
      { status: 401 },
    );
  }

  // ── Mark as used ──────────────────────────────────────────────────────────
  const now = new Date();
  await db.update(dsrVerifications).set({ usedAt: now }).where(eq(dsrVerifications.id, record.id));

  // ── Query session data ─────────────────────────────────────────────────────
  const [session] = await db
    .select()
    .from(sessionEmbeddings)
    .where(
      and(
        eq(sessionEmbeddings.sessionId, record.sessionId),
        eq(sessionEmbeddings.tenantId, record.tenantId),
      ),
    )
    .limit(1);

  const consents = await db
    .select({
      consentType: consentRecords.consentType,
      granted: consentRecords.granted,
      grantedAt: consentRecords.grantedAt,
      revokedAt: consentRecords.revokedAt,
    })
    .from(consentRecords)
    .where(eq(consentRecords.sessionId, record.sessionId));

  // ── Audit log (fire-and-forget) ────────────────────────────────────────────
  void writeDsrAuditLog({
    tenant_id: record.tenantId,
    session_id: record.sessionId,
    dsr_type: 'access',
    action: DSR_AUDIT_ACTIONS.completed,
    email: record.email,
    requested_at: record.createdAt,
    completed_at: now,
  }).catch((err: unknown) => {
    console.error(
      '[dsr/access] ClickHouse audit log failed:',
      err instanceof Error ? err.message : err,
    );
  });

  return NextResponse.json(
    {
      session_id: record.sessionId,
      tenant_id: record.tenantId,
      events_summary: {
        // TODO: query ClickHouse for actual event count (FOLLOW-UP: post-MVP).
        // For now, return 1 if the session exists, 0 otherwise.
        count: session ? 1 : 0,
        first_at: session?.createdAt ? session.createdAt.toISOString() : null,
        last_at: session?.updatedAt ? session.updatedAt.toISOString() : null,
      },
      matched_archetype: session?.finalArchetype ?? session?.matchedArchetype ?? null,
      consent_records: consents.map((c) => ({
        consent_type: c.consentType,
        granted: c.granted,
        granted_at: c.grantedAt.toISOString(),
        revoked_at: c.revokedAt?.toISOString() ?? null,
      })),
    },
    { status: 200 },
  );
}
