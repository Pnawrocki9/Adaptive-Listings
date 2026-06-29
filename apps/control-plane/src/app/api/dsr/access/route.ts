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
 *   5. Query conversion_labels on BOTH identifier namespaces (FOLLOW-246, Art. 15 completeness):
 *      - Pass A: lead_id = session_id (SDK feedback-ping labels)
 *      - Pass B: lead_id = durable_lead_id (CRM deep-outcome labels), when non-null/non-empty/!=
 *        session_id; empty-key guard on both passes (FOLLOW-180/LG-2).
 *      Rows are union-merged and deduplicated by primary key (id).
 *   6. Return data summary.
 *
 * ClickHouse event count is a follow-up (out of MVP scope).
 * For now, events_summary.count = 1 is returned with the session row.
 *
 * @module apps/control-plane/src/app/api/dsr/access/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { afterResponse } from '@/lib/after-response';
import { eq, and, ne } from 'drizzle-orm';
import {
  createAdminClient,
  dsrVerifications,
  sessionEmbeddings,
  consentRecords,
  conversionLabels,
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

  // ── FOLLOW-246: conversion_labels — both identifier namespaces (Art. 15 completeness) ──
  //
  // Mirror of the erase Pass A / Pass B pattern in dsr/erase/route.ts (FOLLOW-184).
  // Two SELECT passes cover both namespaces for this data subject:
  //
  //   Pass A — SDK feedback-ping labels (lead_id = session_id):
  //     These are rows written by the SDK feedback ping with lead_id = session_id.
  //
  //   Pass B — CRM deep-outcome labels (lead_id = durable_lead_id):
  //     CRM webhook writes use an opaque tenant-supplied token as lead_id, which is
  //     a DIFFERENT namespace from session_id. Without this pass those rows are
  //     UNDISCLOSED in the Art. 15 access report — compliance gap (RETRO-044 §4a LG-1).
  //
  // CRITICAL GUARD on BOTH passes (FOLLOW-180/LG-2):
  //   NEVER query when the key is empty — lead_id <> '' guards against accidentally
  //   returning ALL system labels for the tenant.
  //
  // Dedup: if durable_lead_id === session_id, Pass A already covers those rows;
  //   Pass B is skipped. Results are then union-merged and deduplicated by row id
  //   (a belt-and-suspenders guard for any edge-case overlap).
  //
  // Rule K.2: DB errors MUST surface as 500, never silently fall back to empty data.
  // The route MUST fail loud if a configured DB throws on these queries.

  const labelColumns = {
    id: conversionLabels.id,
    predictionId: conversionLabels.predictionId,
    leadId: conversionLabels.leadId,
    outcomeClass: conversionLabels.outcomeClass,
    labelSource: conversionLabels.labelSource,
    confidence: conversionLabels.confidence,
    labeledAt: conversionLabels.labeledAt,
    notes: conversionLabels.notes,
  } as const;

  interface LabelRow {
    id: string;
    predictionId: string;
    leadId: string;
    outcomeClass: string;
    labelSource: string;
    confidence: number | null;
    labeledAt: Date;
    notes: string | null;
  }

  // Pass A: session_id path (SDK ping labels).
  // Guard: session_id must be non-empty + lead_id <> '' (belt-and-suspenders).
  let labelsPassA: LabelRow[] = [];

  if (record.sessionId !== '') {
    labelsPassA = await db
      .select(labelColumns)
      .from(conversionLabels)
      .where(
        and(
          eq(conversionLabels.tenantId, record.tenantId),
          eq(conversionLabels.leadId, record.sessionId),
          // Double-guard: skip any row where lead_id was somehow stored as ''.
          ne(conversionLabels.leadId, ''),
        ),
      );
  }

  // Pass B: durable CRM lead_id path (CRM deep-outcome labels, FOLLOW-246).
  // Only runs when durable_lead_id is non-null, non-empty, and != session_id
  // (dedup: if equal, Pass A already covered those rows).
  const durableLeadId = record.durableLeadId;
  let labelsPassB: typeof labelsPassA = [];

  if (
    typeof durableLeadId === 'string' &&
    durableLeadId !== '' &&
    durableLeadId !== record.sessionId
  ) {
    labelsPassB = await db
      .select(labelColumns)
      .from(conversionLabels)
      .where(
        and(
          eq(conversionLabels.tenantId, record.tenantId),
          eq(conversionLabels.leadId, durableLeadId),
          // Double-guard: belt-and-suspenders — an empty stored lead_id must never match.
          ne(conversionLabels.leadId, ''),
        ),
      );
  }

  // Merge and deduplicate by primary key (id).
  // In normal operation there should be no overlap (Pass A and Pass B query
  // different lead_id values). The dedup is a safety net for edge cases.
  const seenIds = new Set<string>();
  const allLabels: typeof labelsPassA = [];
  for (const row of [...labelsPassA, ...labelsPassB]) {
    if (!seenIds.has(row.id)) {
      seenIds.add(row.id);
      allLabels.push(row);
    }
  }

  // ── Audit log (fire-and-forget) ────────────────────────────────────────────
  // FOLLOW-431 / ESC-033: registered via after() so the async write and its
  // fail-loud Sentry capture complete after the response before instance suspension.
  afterResponse(() =>
    writeDsrAuditLog({
      tenant_id: record.tenantId,
      session_id: record.sessionId,
      dsr_type: 'access',
      action: DSR_AUDIT_ACTIONS.completed,
      email: record.email,
      requested_at: record.createdAt,
      completed_at: now,
    }),
  );

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
      // FOLLOW-246: conversion_labels disclosed on BOTH identifier namespaces (Art. 15).
      // Fields: id, prediction_id, lead_id, outcome_class, label_source, confidence,
      // labeled_at, notes. Keyed by lead_id (session_id OR durable_lead_id).
      // compliance-engineer must verify these fields against DPIA §8 (see PR description).
      conversion_labels: allLabels.map((l) => ({
        id: l.id,
        prediction_id: l.predictionId,
        lead_id: l.leadId,
        outcome_class: l.outcomeClass,
        label_source: l.labelSource,
        confidence: l.confidence ?? null,
        labeled_at: l.labeledAt.toISOString(),
        notes: l.notes ?? null,
      })),
    },
    { status: 200 },
  );
}
