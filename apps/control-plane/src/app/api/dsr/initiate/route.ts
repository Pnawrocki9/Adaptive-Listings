/**
 * POST /api/dsr/initiate
 *
 * Initiates a Data Subject Rights (DSR) request by generating a 6-digit OTP,
 * storing its hash in dsr_verifications, and emailing the OTP to the data subject.
 *
 * Auth (FOLLOW-1308, absorbs FOLLOW-1279): identified Estalara staff of rank `estalara:ops` or
 * higher (SSR session or staff JWT), acting on the Estalara tenant, the only tenant (ESC-085).
 * The headless ADMIN_API_SECRET is refused (403) because the initiation must be attributable: one
 * `staff_audit_log` row (`dsr.initiate`) commits with the `dsr_verifications` row. Readonly staff
 * is 403. Before FOLLOW-1308 the route demanded a tenant-user JWT, which no verifier has issued
 * since FOLLOW-1335, so every caller was refused.
 *
 * Flow:
 *   1. Resolve the staff caller (`resolveTenantAccess`, explicit Estalara tenant).
 *   2. Validate body: session_id, email, dsr_type (+ optional lead_id).
 *   3. Ownership proof (FOLLOW-1308): we hold data under this session id. ClickHouse first, by
 *      `session_id` alone across `DSR_CLICKHOUSE_TABLES` (never by `tenant_id`: the SDK reports it
 *      as all zeros); then the tenant's Postgres `consent_records` / `intent_sessions` (a session
 *      that refused consent has no events but has a consent row). None → 404. A ClickHouse error
 *      → 503, never 404. This replaces the `session_embeddings` lookup: nothing ever wrote that
 *      table, so every initiation answered 404. What it does NOT prove is that the requester is
 *      that data subject: that is the identity check the staff member performs before calling
 *      (DPIA §8 step 2).
 *   4. Rate limit, then generate the OTP, hash it, insert into dsr_verifications (15-min TTL)
 *      in one transaction with the staff audit row.
 *   5. Send OTP email via Resend; an error-shaped Resend result is a failure (FOLLOW-1308, F-19).
 *   6. Return 202 { request_id, expires_at }.
 *
 * Writes a fire-and-forget audit record to ClickHouse dsr_audit_log after
 * the response is returned.
 *
 * @module apps/control-plane/src/app/api/dsr/initiate/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { afterResponse } from '@/lib/after-response';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import {
  createAdminClient,
  consentRecords,
  dsrVerifications,
  intentSessions,
  staffAuditLog,
} from '@estalara/db';
import { generateOtp, hashOtp } from '@/lib/dsr-otp';
import { checkInitiateRateLimit } from '@/lib/dsr-rate-limit';
import { sendEmail, brandSenderFrom } from '@/lib/email/resend';
import { ESTALARA_BRAND_IDENTITY, ESTALARA_TENANT_ID } from '@/lib/estalara-tenant';
import { AccessError, resolveTenantAccess, type TenantAccess } from '@/lib/session-auth';
import { requestIp } from '@/lib/answers-access';
import { readClickHouseConfig, sessionHasClickHouseRows } from '@/lib/clickhouse-dsr';
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
   * To close the gap: when the initiator acts for a data subject who has a CRM record, they
   * SHOULD supply this field using the same token the CRM webhook
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

// ─── Ownership proof (FOLLOW-1308) ─────────────────────────────────────────────

/**
 * Does any store hold data for this session? ClickHouse by `session_id` only, then the tenant's
 * Postgres rows.
 *
 * @throws when ClickHouse is configured and rejects the query (the caller answers 503).
 */
async function sessionIsKnown(
  db: ReturnType<typeof createAdminClient>,
  tenantId: string,
  sessionId: string,
): Promise<boolean> {
  const cfg = readClickHouseConfig();
  if (cfg && (await sessionHasClickHouseRows(cfg, sessionId))) return true;

  const consent = await db
    .select({ sessionId: consentRecords.sessionId })
    .from(consentRecords)
    .where(and(eq(consentRecords.sessionId, sessionId), eq(consentRecords.tenantId, tenantId)))
    .limit(1);
  if (consent.length > 0) return true;

  const intent = await db
    .select({ sessionId: intentSessions.sessionId })
    .from(intentSessions)
    .where(and(eq(intentSessions.sessionId, sessionId), eq(intentSessions.tenantId, tenantId)))
    .limit(1);
  return intent.length > 0;
}

// ─── POST handler ──────────────────────────────────────────────────────────────

/**
 * POST /api/dsr/initiate
 *
 * Body: `{ session_id: string, email: string, dsr_type: 'access'|'erase'|'portability', lead_id? }`
 *
 * @returns 202 `{ request_id: string, expires_at: string }` on success.
 * @returns 400 on invalid body.
 * @returns 401 when there is no staff session or JWT.
 * @returns 403 for readonly staff and for the unattributable ADMIN_API_SECRET.
 * @returns 404 when no store holds data for session_id.
 * @returns 429 when (tenant, email) exceeded the initiation rate limit.
 * @returns 503 `OWNERSHIP_CHECK_UNAVAILABLE` when ClickHouse could not be read.
 * @returns 500 when Resend did not accept the OTP e-mail, or on unexpected errors.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const requestId = crypto.randomUUID();

  // ── Auth gate (FOLLOW-1308): identified ops+ staff on the Estalara tenant ───
  let access: TenantAccess;
  try {
    access = await resolveTenantAccess(req, {
      allowStaffOverride: true,
      tenantId: ESTALARA_TENANT_ID,
    });
  } catch (err) {
    if (!(err instanceof AccessError)) throw err;
    const code =
      err.status === 401 ? 'AUTH_REQUIRED' : err.status === 403 ? 'FORBIDDEN' : 'ACCESS_ERROR';
    return NextResponse.json(
      { error: { code, message: err.message, request_id: requestId } },
      { status: err.status },
    );
  }
  if (!access.canWrite) {
    return NextResponse.json(
      {
        error: {
          code: 'FORBIDDEN',
          message: 'Initiating a DSR requires estalara:ops or higher',
          request_id: requestId,
        },
      },
      { status: 403 },
    );
  }
  const tenantId = access.tenantId;
  const staffUserId = access.staff.sub;

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

  // ── Ownership proof (FOLLOW-1308): we hold data under this session id ──────
  const db = createAdminClient();
  let known: boolean;
  try {
    known = await sessionIsKnown(db, tenantId, session_id);
  } catch {
    // A code only: a store error message can quote the query and its parameters.
    console.error('[dsr/initiate] ownership check failed: ownership_check_unavailable');
    return NextResponse.json(
      {
        error: {
          code: 'OWNERSHIP_CHECK_UNAVAILABLE',
          message: 'The session could not be looked up. Retry later.',
          request_id: requestId,
        },
      },
      { status: 503 },
    );
  }

  if (!known) {
    return NextResponse.json(
      {
        error: {
          code: 'NOT_FOUND',
          message: 'No data is held for this session',
          request_id: requestId,
        },
      },
      { status: 404 },
    );
  }

  // ── Rate limit (anti email-bomb, FOLLOW-455 / audit F-20) ──────────────────
  const rateLimit = await checkInitiateRateLimit(db, tenantId, email);
  if (!rateLimit.allowed) {
    afterResponse(() =>
      writeDsrAuditLog({
        tenant_id: tenantId,
        session_id,
        dsr_type,
        action: DSR_AUDIT_ACTIONS.rate_limited,
        email,
        requested_at: new Date(),
      }),
    );
    return NextResponse.json(
      {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many data subject requests for this email. Please try again later.',
          request_id: requestId,
        },
      },
      { status: 429 },
    );
  }

  // ── Generate OTP, hash, insert record + staff audit row (one transaction) ──
  const otp = generateOtp();
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  // The audit payload names the request and its type, not the subject (no session id, no e-mail).
  const inserted = await db.transaction(async (tx) => {
    const [row] = await tx
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
    await tx.insert(staffAuditLog).values({
      adminUserId: staffUserId,
      action: 'dsr.initiate',
      targetTenantId: tenantId,
      payload: {
        request_id: row?.id ?? null,
        dsr_type,
        lead_id_supplied: durableLeadId !== undefined,
      },
      ipAddress: requestIp(req),
      userAgent: req.headers.get('user-agent'),
    });
    return row;
  });

  // ── Brand display identity (FOLLOW-654 leg 3 → FOLLOW-1332) ────────────────
  // The sender name and body name Estalara, the only tenant (ESC-085). Before FOLLOW-1332 this
  // was read per tenant from `tenants.brand_config` with Estalara as the fallback, plus an alert
  // for an unprovisioned external brand; the Estalara path through that is this constant.
  const brand = ESTALARA_BRAND_IDENTITY;

  // ── Send OTP email ─────────────────────────────────────────────────────────
  try {
    await sendEmail({
      from: brandSenderFrom(brand.brandName),
      to: email,
      subject: `Your ${brand.brandName} data request`,
      html: `
        <p>You requested access to your personal data processed by ${brand.brandName}.</p>
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
  // FOLLOW-431 / ESC-033: registered via after() so the async write and its
  // fail-loud Sentry capture complete after the response before instance suspension.
  afterResponse(() =>
    writeDsrAuditLog({
      tenant_id: tenantId,
      session_id,
      dsr_type,
      action: DSR_AUDIT_ACTIONS.initiated,
      email,
      requested_at: new Date(),
    }),
  );

  return NextResponse.json(
    {
      request_id: inserted?.id ?? requestId,
      expires_at: (inserted?.expiresAt ?? expiresAt).toISOString(),
    },
    { status: 202 },
  );
}
