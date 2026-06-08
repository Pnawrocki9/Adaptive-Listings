/**
 * POST /api/dsr/initiate
 *
 * Initiates a Data Subject Rights (DSR) request by generating a 6-digit OTP,
 * storing its hash in dsr_verifications, and emailing the OTP to the data subject.
 *
 * Auth: Bearer JWT (tenant-scoped agency user).
 *
 * Flow:
 *   1. Validate JWT — extract tenant_id.
 *   2. Validate body: session_id, email, dsr_type.
 *   3. Confirm session_id belongs to this tenant (query session_embeddings).
 *   4. Generate OTP, hash it, insert into dsr_verifications (15-min TTL).
 *   5. Send OTP email via Resend.
 *   6. Return 202 { request_id, expires_at }.
 *
 * Writes a fire-and-forget audit record to ClickHouse dsr_audit_log after
 * the response is returned.
 *
 * @module apps/control-plane/src/app/api/dsr/initiate/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { getAuthClaims, isTenantClaims } from '@estalara/auth';
import { createAdminClient, sessionEmbeddings, dsrVerifications } from '@estalara/db';
import { generateOtp, hashOtp } from '@/lib/dsr-otp';
import { sendEmail } from '@/lib/email/resend';
import { DSR_AUDIT_ACTIONS, writeDsrAuditLog } from '../_clickhouse';

// ─── Request schema ────────────────────────────────────────────────────────────

const InitiateBodySchema = z.object({
  session_id: z.string().min(1).max(256),
  email: z.string().email(),
  dsr_type: z.enum(['access', 'erase', 'portability']),
  /**
   * FOLLOW-184: Optional durable CRM lead_id for the data subject.
   *
   * When the tenant's CRM writes deep-outcome rows via POST /api/crm/outcome, it uses
   * an opaque pseudonymous token as `lead_id` (§T.6 Option i). That token is in a
   * DIFFERENT namespace from the Estalara session_id — so a DSR erase keyed only on
   * session_id would leave CRM-written conversion_labels rows behind (Art. 17 gap).
   *
   * To close the gap: when the tenant admin initiates a DSR for a data subject who has
   * a CRM record, they SHOULD supply this field using the same token the CRM webhook
   * used as `lead_id`. The erase route will then delete conversion_labels on BOTH:
   *   (a) lead_id = session_id   — SDK feedback-ping labels
   *   (b) lead_id = durable_lead_id — CRM deep-outcome labels
   *
   * min(1) rejects empty strings; use omission (undefined) to indicate "no CRM record".
   * PII boundary: must be the same opaque Estalara-assigned pseudonymous token sent to
   * the CRM — NOT a CRM contact ID, email address, or any identifying value.
   */
  lead_id: z.string().min(1).max(256).optional(),
});

// ─── POST handler ──────────────────────────────────────────────────────────────

/**
 * POST /api/dsr/initiate
 *
 * Body: `{ session_id: string, email: string, dsr_type: 'access'|'erase'|'portability' }`
 *
 * @returns 202 `{ request_id: string, expires_at: string }` on success.
 * @returns 400 on invalid body.
 * @returns 401 when Authorization header is absent or JWT is invalid.
 * @returns 403 when the authenticated user is not a tenant user.
 * @returns 404 when session_id is not found for this tenant.
 * @returns 500 on unexpected errors.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID();

  // ── Auth gate ──────────────────────────────────────────────────────────────
  const claims = await getAuthClaims(req);
  if (!claims) {
    return NextResponse.json(
      {
        error: {
          code: 'AUTH_REQUIRED',
          message: 'Authorization: Bearer <jwt> header is required',
          request_id: requestId,
        },
      },
      { status: 401 },
    );
  }
  if (!isTenantClaims(claims)) {
    return NextResponse.json(
      {
        error: { code: 'FORBIDDEN', message: 'Tenant user access required', request_id: requestId },
      },
      { status: 403 },
    );
  }
  const tenantId = claims.tenant_id;

  // ── Parse + validate body ──────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request body is not valid JSON',
          request_id: requestId,
        },
      },
      { status: 400 },
    );
  }

  const parsed = InitiateBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          request_id: requestId,
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const { session_id, email, dsr_type, lead_id: durableLeadId } = parsed.data;

  // ── Confirm session belongs to this tenant ─────────────────────────────────
  const db = createAdminClient();
  const sessions = await db
    .select({ sessionId: sessionEmbeddings.sessionId })
    .from(sessionEmbeddings)
    .where(
      and(eq(sessionEmbeddings.sessionId, session_id), eq(sessionEmbeddings.tenantId, tenantId)),
    )
    .limit(1);

  if (sessions.length === 0) {
    return NextResponse.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'Session not found for this tenant',
          request_id: requestId,
        },
      },
      { status: 404 },
    );
  }

  // ── Generate OTP, hash, insert record ──────────────────────────────────────
  const otp = generateOtp();
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  const [inserted] = await db
    .insert(dsrVerifications)
    .values({
      tenantId,
      sessionId: session_id,
      email,
      dsrType: dsr_type,
      otpHash,
      expiresAt,
      // FOLLOW-184: store the CRM lead_id if supplied — used by /api/dsr/erase to
      // delete CRM-written conversion_labels rows (lead_id != session_id namespace).
      ...(durableLeadId !== undefined ? { durableLeadId } : {}),
    })
    .returning({ id: dsrVerifications.id, expiresAt: dsrVerifications.expiresAt });

  // ── Send OTP email ─────────────────────────────────────────────────────────
  try {
    await sendEmail({
      to: email,
      subject: 'Your Estalara data request',
      html: `
        <p>You requested access to your personal data processed by Estalara.</p>
        <p>Your one-time verification code is:</p>
        <p style="font-size: 2em; letter-spacing: 0.2em; font-weight: bold;">${otp}</p>
        <p>This code is valid for <strong>15 minutes</strong>.</p>
        <p>If you did not request this, you can safely ignore this email.</p>
      `.trim(),
    });
  } catch (emailErr) {
    // Email failure should not expose the OTP or block the response.
    // The inserted record will expire naturally.
    console.error(
      '[dsr/initiate] Email send failed:',
      emailErr instanceof Error ? emailErr.message : emailErr,
    );
    return NextResponse.json(
      {
        error: {
          code: 'EMAIL_SEND_FAILED',
          message: 'Failed to send verification email',
          request_id: requestId,
        },
      },
      { status: 500 },
    );
  }

  // ── Audit log (fire-and-forget) ────────────────────────────────────────────
  void writeDsrAuditLog({
    tenant_id: tenantId,
    session_id,
    dsr_type,
    action: DSR_AUDIT_ACTIONS.initiated,
    email,
    requested_at: new Date(),
  }).catch((err: unknown) => {
    console.error(
      '[dsr/initiate] ClickHouse audit log failed:',
      err instanceof Error ? err.message : err,
    );
  });

  return NextResponse.json(
    {
      request_id: inserted?.id ?? requestId,
      expires_at: (inserted?.expiresAt ?? expiresAt).toISOString(),
    },
    { status: 202 },
  );
}
