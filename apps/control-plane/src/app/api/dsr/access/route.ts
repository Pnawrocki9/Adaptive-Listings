/**
 * GET /api/dsr/access?request_id=<uuid>&token=<OTP>
 *
 * Returns a summary of the data Estalara holds for the session identified by
 * the DSR request. No JWT required — the (request_id, OTP) pair is the
 * authorisation mechanism.
 *
 * Flow:
 *   1. Verify (request_id, token) via verifyAndConsumeOtp() — request-scoped
 *      lookup + per-capability attempt cap/lockout + atomic mark-used
 *      (FOLLOW-455 / audit F-20; see apps/control-plane/src/lib/dsr-verify.ts).
 *   2. Query session_embeddings and consent_records.
 *   3. Query conversion_labels on BOTH identifier namespaces (FOLLOW-246, Art. 15 completeness):
 *      - Pass A: lead_id = session_id (SDK feedback-ping labels)
 *      - Pass B: lead_id = durable_lead_id (CRM deep-outcome labels), when non-null/non-empty/!=
 *        session_id; empty-key guard on both passes (FOLLOW-180/LG-2).
 *      Rows are union-merged and deduplicated by primary key (id).
 *   4. Query the REAL ClickHouse behavioral event count for the session
 *      (FOLLOW-455 / audit F-20 — replaces the previous `count = 1` stub).
 *      When ClickHouse is not configured, count is reported as `null`
 *      (Rule K.2 — never fabricate a number).
 *   5. Return data summary.
 *
 * @module apps/control-plane/src/app/api/dsr/access/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { afterResponse } from '@/lib/after-response';
import { eq, and, ne } from 'drizzle-orm';
import {
  createAdminClient,
  sessionEmbeddings,
  consentRecords,
  conversionLabels,
} from '@estalara/db';
import { verifyAndConsumeOtp, dsrVerifyFailureResponse } from '@/lib/dsr-verify';
import { getSessionEventSummary, readClickHouseConfig } from '@/lib/clickhouse-dsr';
import { DSR_AUDIT_ACTIONS, writeDsrAuditLog } from '../_clickhouse';

// ─── GET handler ───────────────────────────────────────────────────────────────

/**
 * GET /api/dsr/access?request_id=<uuid>&token=<6-digit-OTP>
 *
 * @returns 200 data access summary on success.
 * @returns 400 when request_id or token param is missing.
 * @returns 401 when OTP is expired, already used, or incorrect.
 * @returns 404 when request_id is not found or is a different capability.
 * @returns 429 when the request has been locked out after too many wrong guesses.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get('token');
  const requestId = req.nextUrl.searchParams.get('request_id');
  if (!token || !requestId) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: "Query params 'request_id' and 'token' are required",
        },
      },
      { status: 400 },
    );
  }

  const db = createAdminClient();

  const verification = await verifyAndConsumeOtp(db, { requestId, token, dsrType: 'access' });
  if (!verification.ok) {
    const { status, code, message } = dsrVerifyFailureResponse(verification.reason);
    return NextResponse.json({ error: { code, message } }, { status });
  }
  const record = verification.record;
  const now = new Date();

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

  // ── Real ClickHouse behavioral event count (FOLLOW-455 / audit F-20) ──────
  // Replaces the previous `count = 1` stub — Art. 15 requires disclosure of
  // the ACTUAL extent of processing. When ClickHouse is not configured
  // (dev/CI), count is reported as `null` rather than fabricated (Rule K.2).
  let eventsSummary: { count: number | null; first_at: string | null; last_at: string | null };
  const chConfig = readClickHouseConfig();
  if (chConfig) {
    try {
      const summary = await getSessionEventSummary(chConfig, record.tenantId, record.sessionId);
      eventsSummary = { count: summary.count, first_at: summary.firstAt, last_at: summary.lastAt };
    } catch (err: unknown) {
      console.error(
        '[dsr/access] ClickHouse event count query failed:',
        err instanceof Error ? err.message : err,
      );
      eventsSummary = {
        count: null,
        first_at: session?.createdAt ? session.createdAt.toISOString() : null,
        last_at: session?.updatedAt ? session.updatedAt.toISOString() : null,
      };
    }
  } else {
    eventsSummary = {
      count: null,
      first_at: session?.createdAt ? session.createdAt.toISOString() : null,
      last_at: session?.updatedAt ? session.updatedAt.toISOString() : null,
    };
  }

  return NextResponse.json(
    {
      session_id: record.sessionId,
      tenant_id: record.tenantId,
      events_summary: eventsSummary,
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
