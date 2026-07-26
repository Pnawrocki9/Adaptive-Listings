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
import * as Sentry from '@sentry/nextjs';
import { afterResponse } from '@/lib/after-response';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import { getAuthClaims, isTenantClaims } from '@estalara/auth';
import { createAdminClient, sessionEmbeddings, dsrVerifications } from '@estalara/db';
import { generateOtp, hashOtp } from '@/lib/dsr-otp';
import { checkInitiateRateLimit } from '@/lib/dsr-rate-limit';
import { sendEmail, brandSenderFrom } from '@/lib/email/resend';
import { fetchBrandIdentity, isUnprovisionedExternalBrand } from '@/lib/brand-identity';
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

  // ── Resolve brand display identity (FOLLOW-654 leg 3) ──────────────────────
  // The data subject on a white-label deployment must see the brand's own name
  // as the sender and in the email body — not "Estalara". Fail-honest: a tenant
  // with no configured brand identity falls back to the Estalara identity, so
  // the first-party flow is byte-for-byte unchanged.
  const brand = await fetchBrandIdentity(db, tenantId);

  // ── Un-provisioned external brand → ALERT, but still send (FOLLOW-659) ─────
  // The fail-honest fallback above is correct for the first-party tenant and a silent
  // mis-branding for anyone else: an external brand's data subject gets an OTP from
  // "Estalara", a company they never heard of, and is likely to discard it.
  //
  // Deliberately NOT a refusal, unlike the consent-text gate in
  // `api/v1/consent/platform-registration` (which stops a WRONG legal attestation from
  // being created). This e-mail is the data subject's only path to exercising a GDPR
  // Art. 15/17/20 right; blocking it to punish an operator's missing config would turn a
  // branding defect into an obstruction of the right itself (Art. 12(2)). So: send the
  // mail, and make the misconfiguration impossible to miss in Sentry.
  //
  // Best-effort by design — the predicate's own fail-closed path only ever produces an
  // extra alert, and a throw here must never cost the data subject their e-mail.
  try {
    if (await isUnprovisionedExternalBrand(db, tenantId, brand)) {
      const msg =
        `[dsr/initiate] tenant ${tenantId} is a non-first-party brand with no ` +
        'brand_config.brand_name — this DSR e-mail is going out branded "Estalara". ' +
        'Set it via PATCH /api/config (brand-provisioning runbook, Step 3a).';
      console.error(msg);
      Sentry.captureMessage(msg, {
        level: 'error',
        tags: { route: 'dsr/initiate', brand_identity: 'unprovisioned_external' },
        extra: { tenant_id: tenantId, request_id: requestId },
      });
    }
  } catch (guardErr) {
    console.error(
      '[dsr/initiate] brand-identity provisioning check failed:',
      guardErr instanceof Error ? guardErr.message : guardErr,
    );
  }

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
