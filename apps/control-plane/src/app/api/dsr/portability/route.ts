/**
 * GET /api/dsr/portability?request_id=<uuid>&token=<OTP>
 *
 * Returns the same data as the access endpoint but as a downloadable JSON file.
 * No JWT required — the (request_id, OTP) pair is the authorisation mechanism.
 *
 * Differences from GET /api/dsr/access:
 *   - Response headers include Content-Disposition (attachment) and Content-Type: application/json.
 *   - The dsr_verifications record must have dsr_type = 'portability'.
 *
 * FOLLOW-246: conversion_labels rows are now exported on BOTH identifier namespaces (Art. 20):
 *   - Pass A: lead_id = session_id (SDK feedback-ping labels)
 *   - Pass B: lead_id = durable_lead_id (CRM deep-outcome labels), when non-null/non-empty/!=
 *     session_id; empty-key guard on both passes (FOLLOW-180/LG-2).
 *   Rows are union-merged and deduplicated by primary key (id).
 *
 * FOLLOW-455 / audit F-20: verification is now request-scoped (see
 * apps/control-plane/src/lib/dsr-verify.ts).
 *
 * FOLLOW-574 / CEO ruling ESC-037: the ClickHouse leg exports the ACTUAL ROWS
 * of every PII table in DSR_CLICKHOUSE_TABLES (the derived set, kept in parity
 * with GET /api/dsr/access), superseding the FOLLOW-455 aggregate count —
 * Art. 20 requires "a copy of the personal data". `events` is volume-safe
 * (keyset pagination + row cap + continuation cursor).
 *
 * FOLLOW-558 / audit A3-F-06: exports engagement_scores, quiz_completions, and
 * intent_sessions — all three already covered by the DSR erase cascade
 * (`apps/control-plane/src/app/api/dsr/erase/route.ts`) but previously
 * omitted from the portability export (Art. 20 completeness).
 *
 * @module apps/control-plane/src/app/api/dsr/portability/route
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
  engagementScores,
  quizCompletions,
  intentSessions,
} from '@estalara/db';
import { verifyAndConsumeOtp, dsrVerifyFailureResponse } from '@/lib/dsr-verify';
import { getClickHouseDisclosure, readClickHouseConfig } from '@/lib/clickhouse-dsr';
import type { ClickHouseDisclosure } from '@/lib/clickhouse-dsr';
import { DSR_AUDIT_ACTIONS, writeDsrAuditLog } from '../_clickhouse';

// ─── GET handler ───────────────────────────────────────────────────────────────

/**
 * GET /api/dsr/portability?request_id=<uuid>&token=<6-digit-OTP>
 *
 * @returns 200 downloadable JSON file on success.
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

  const verification = await verifyAndConsumeOtp(db, { requestId, token, dsrType: 'portability' });
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
    // ── FOLLOW-1108: consent_records disclosure MUST be tenant-scoped ────────
    //
    // session_id is a device fingerprint, not a per-tenant key
    // (packages/sdk/src/core/session.ts generateSessionId()), and
    // consent_records has NO unique constraint on (tenant_id, session_id) —
    // `id uuid primaryKey defaultRandom()` plus three plain indexes
    // (packages/db/src/schema/consent_records.ts). So an unscoped SELECT
    // returned a DIFFERENT controller's Art. 7(1) consent proof inside this
    // subject's bundle. Every sibling read in this route already carries
    // eq(tenantId); this one did not. Served by
    // consent_records_tenant_session_idx (tenant_id, session_id).
    //
    // This does NOT close the intra-tenant half: two people who share a device
    // fingerprint still share an id, so a same-tenant collision still
    // over-discloses. That is ESC-070 / FOLLOW-1105 / FOLLOW-1106.
    .where(
      and(
        eq(consentRecords.sessionId, record.sessionId),
        eq(consentRecords.tenantId, record.tenantId),
      ),
    );

  // ── FOLLOW-558 / audit A3-F-06: engagement_scores, quiz_completions, intent_sessions ──
  //
  // These three tables are already in the DSR erase cascade
  // (apps/control-plane/src/app/api/dsr/erase/route.ts) but were previously
  // undisclosed here — Art. 20 requires the portability export to cover every
  // store the controller demonstrably holds. See parity test:
  // apps/control-plane/src/app/api/dsr/disclosure-route-driven-pglite.test.ts
  // ("FOLLOW-558 PARITY" describe block).

  const [engagementScore] = await db
    .select({
      engagementScore: engagementScores.engagementScore,
      dwellScore: engagementScores.dwellScore,
      interactionScore: engagementScores.interactionScore,
      scrollScore: engagementScores.scrollScore,
      computedAt: engagementScores.computedAt,
    })
    .from(engagementScores)
    .where(
      and(
        eq(engagementScores.sessionId, record.sessionId),
        eq(engagementScores.tenantId, record.tenantId),
      ),
    )
    .limit(1);

  const quizCompletionRows = await db
    .select({
      id: quizCompletions.id,
      resolvedArchetype: quizCompletions.resolvedArchetype,
      branch: quizCompletions.branch,
      q1Answer: quizCompletions.q1Answer,
      q2Answer: quizCompletions.q2Answer,
      q3Answer: quizCompletions.q3Answer,
      language: quizCompletions.language,
      createdAt: quizCompletions.createdAt,
    })
    .from(quizCompletions)
    .where(
      and(
        eq(quizCompletions.sessionId, record.sessionId),
        eq(quizCompletions.tenantId, record.tenantId),
      ),
    );

  const [intentSession] = await db
    .select({
      id: intentSessions.id,
      crossSessionId: intentSessions.crossSessionId,
      startedAt: intentSessions.startedAt,
      lastEventAt: intentSessions.lastEventAt,
      finalizedAt: intentSessions.finalizedAt,
      finalArchetype: intentSessions.finalArchetype,
      finalConfidence: intentSessions.finalConfidence,
      signalCount: intentSessions.signalCount,
      quizCompleted: intentSessions.quizCompleted,
      quizLeaf: intentSessions.quizLeaf,
      chatTurns: intentSessions.chatTurns,
      intentState: intentSessions.intentState,
    })
    .from(intentSessions)
    .where(
      and(
        eq(intentSessions.sessionId, record.sessionId),
        eq(intentSessions.tenantId, record.tenantId),
      ),
    )
    .limit(1);

  // ── FOLLOW-246: conversion_labels — both identifier namespaces (Art. 20 completeness) ──
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
  //     UNEXPORTED in the Art. 20 portability export — compliance gap (RETRO-044 §4a LG-1).
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
      dsr_type: 'portability',
      action: DSR_AUDIT_ACTIONS.completed,
      email: record.email,
      requested_at: record.createdAt,
      completed_at: now,
    }),
  );

  // ── ClickHouse full-row disclosure (FOLLOW-574 / CEO ruling ESC-037) ──────
  // Art. 20 requires the exported machine-readable data to be "a copy of the
  // personal data", not an aggregate: every ClickHouse PII table in
  // DSR_CLICKHOUSE_TABLES is exported as ACTUAL ROWS (the derived set — kept in
  // parity with GET /api/dsr/access). `events` is volume-safe (keyset
  // pagination + cap + continuation cursor). When ClickHouse is unconfigured
  // (dev/CI) or the query fails, `available` is `false` with a note — never a
  // fabricated or silently-empty export (Rule K.2).
  let clickhouse: ClickHouseDisclosure = {
    available: false,
    note: 'clickhouse_not_configured',
    tables: [],
  };
  const chConfig = readClickHouseConfig();
  if (chConfig) {
    try {
      clickhouse = await getClickHouseDisclosure(chConfig, record.tenantId, record.sessionId);
    } catch (err: unknown) {
      console.error(
        '[dsr/portability] ClickHouse disclosure query failed:',
        err instanceof Error ? err.message : err,
      );
      clickhouse = { available: false, note: 'clickhouse_query_failed', tables: [] };
    }
  }

  const exportData = {
    session_id: record.sessionId,
    tenant_id: record.tenantId,
    exported_at: now.toISOString(),
    clickhouse,
    matched_archetype: session?.finalArchetype ?? session?.matchedArchetype ?? null,
    consent_records: consents.map((c) => ({
      consent_type: c.consentType,
      granted: c.granted,
      granted_at: c.grantedAt.toISOString(),
      revoked_at: c.revokedAt?.toISOString() ?? null,
    })),
    // FOLLOW-558 / audit A3-F-06: engagement_scores (single row per
    // (tenant_id, session_id), null when never computed).
    engagement_score: engagementScore
      ? {
          engagement_score: engagementScore.engagementScore ?? null,
          dwell_score: engagementScore.dwellScore ?? null,
          interaction_score: engagementScore.interactionScore ?? null,
          scroll_score: engagementScore.scrollScore ?? null,
          computed_at: engagementScore.computedAt.toISOString(),
        }
      : null,
    // FOLLOW-558 / audit A3-F-06: quiz_completions (0..n rows per session —
    // one per quiz completion event).
    quiz_completions: quizCompletionRows.map((q) => ({
      id: q.id,
      resolved_archetype: q.resolvedArchetype,
      branch: q.branch,
      q1_answer: q.q1Answer,
      q2_answer: q.q2Answer,
      q3_answer: q.q3Answer,
      language: q.language,
      created_at: q.createdAt.toISOString(),
    })),
    // FOLLOW-558 / audit A3-F-06: intent_sessions (single row per
    // (tenant_id, session_id) — unique constraint — null when the K.3.6
    // archetype tracer never ran for this session).
    intent_session: intentSession
      ? {
          id: intentSession.id,
          cross_session_id: intentSession.crossSessionId,
          started_at: intentSession.startedAt.toISOString(),
          last_event_at: intentSession.lastEventAt.toISOString(),
          finalized_at: intentSession.finalizedAt?.toISOString() ?? null,
          final_archetype: intentSession.finalArchetype,
          final_confidence: intentSession.finalConfidence,
          signal_count: intentSession.signalCount,
          quiz_completed: intentSession.quizCompleted,
          quiz_leaf: intentSession.quizLeaf,
          chat_turns: intentSession.chatTurns,
          intent_state: intentSession.intentState,
        }
      : null,
    // FOLLOW-246: conversion_labels exported on BOTH identifier namespaces (Art. 20).
    // Fields: id, prediction_id, lead_id, outcome_class, label_source, confidence,
    // labeled_at, notes. Keyed by lead_id (session_id OR durable_lead_id).
    // compliance-engineer must verify these fields against DPIA §8 and Art. 20
    // machine-readable structured format requirements (see PR description).
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
  };

  const filename = `estalara-data-export-${record.sessionId}.json`;

  return new NextResponse(JSON.stringify(exportData, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}
