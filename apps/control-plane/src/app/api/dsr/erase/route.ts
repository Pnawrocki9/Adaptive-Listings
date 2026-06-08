/**
 * POST /api/dsr/erase
 *
 * Erases all Estalara-held data for the session identified by the DSR OTP token.
 * No JWT required — the OTP is the authorisation mechanism.
 *
 * Flow:
 *   1. Hash submitted OTP, look up dsr_verifications WHERE otp_hash = hash AND dsr_type = 'erase'.
 *   2. Validate: not expired, not used.
 *   3. Mark used_at = now().
 *   4. In a single transaction:
 *      - DELETE FROM session_embeddings WHERE session_id AND tenant_id
 *      - DELETE FROM consent_records WHERE session_id
 *      - DELETE FROM conversion_labels WHERE lead_id = session_id AND tenant_id (FOLLOW-172)
 *        GUARD: only when lead_id (= session_id) is non-empty — an empty lead_id would
 *        erase ALL system labels for the tenant (FOLLOW-180/LG-2 boundary).
 *      - DELETE FROM conversion_labels WHERE lead_id = durable_lead_id AND tenant_id (FOLLOW-184)
 *        Covers CRM-written rows where lead_id is an opaque CRM token ≠ session_id.
 *        Only runs when dsr_verifications.durable_lead_id is non-null/non-empty.
 *        Same empty-key guard as above (GDPR Art. 17 completeness, RETRO-031 §4a LG-1).
 *   5. Redis DEL session:{session_id}:* (fire-and-forget).
 *   6. **NEW (FOLLOW-039 — RODO Art. 17 hard-delete):**
 *      For each ClickHouse PII table (events, adaptation_decisions, llm_calls,
 *      session_quality) issue an `ALTER TABLE ... DELETE WHERE session_id IN (...)`
 *      mutation and persist a `dsr_clickhouse_mutations` Postgres row tracking
 *      its state. The `/api/dsr/mutation-poll` Vercel Cron polls `system.mutations`
 *      and finalises the audit log.
 *   7. Idempotency: re-running for an already-erased session inspects
 *      `dsr_clickhouse_mutations` and returns current status without reissuing.
 *   8. Return 200 { deleted_at, clickhouse_deletion: { status, mutations: [...] } }.
 *
 * @module apps/control-plane/src/app/api/dsr/erase/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { eq, and, ne, sql } from 'drizzle-orm';
import {
  createAdminClient,
  dsrVerifications,
  sessionEmbeddings,
  consentRecords,
  conversionLabels,
  engagementScores,
  dsrClickhouseMutations,
} from '@estalara/db';
import { hashOtp } from '@/lib/dsr-otp';
import { DSR_AUDIT_ACTIONS, writeDsrAuditLog } from '../_clickhouse';
import {
  DSR_CLICKHOUSE_TABLES,
  issueEraseMutation,
  readClickHouseConfig,
} from '@/lib/clickhouse-dsr';

// ─── Request schema ────────────────────────────────────────────────────────────

const EraseBodySchema = z.object({
  token: z.string().min(1),
});

// ─── Redis session DEL (fire-and-forget) ─────────────────────────────────────

async function deleteSessionFromRedis(sessionId: string): Promise<void> {
  const base = process.env.UPSTASH_REDIS_URL?.replace(/\/$/, '');
  if (!base) return;

  const token = process.env.UPSTASH_REDIS_TOKEN;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  // SCAN for session:{sessionId}:* keys then DEL them
  const matchPattern = `session:${sessionId}:*`;
  let cursor = '0';

  do {
    const scanUrl = `${base}/scan/${cursor}/match/${encodeURIComponent(matchPattern)}/count/100`;
    const resp = await fetch(scanUrl, { method: 'GET', headers });
    if (!resp.ok) break;

    const data = (await resp.json()) as { result?: unknown };
    const result = data.result;
    if (!Array.isArray(result) || result.length < 2) break;

    const nextCursor = String(result[0]);
    const maybeKeys: unknown = result[1];
    const keys: string[] = Array.isArray(maybeKeys) ? (maybeKeys as unknown[]).map(String) : [];
    cursor = nextCursor;

    if (keys.length > 0) {
      await fetch(`${base}/pipeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify([['DEL', ...keys]]),
      });
    }
  } while (cursor !== '0');
}

// ─── ClickHouse hard-delete (FOLLOW-039) ─────────────────────────────────────

interface MutationSummary {
  table: string;
  status: 'pending' | 'in_progress' | 'done' | 'failed' | 'reused';
  mutation_id: string | null;
}

/**
 * Issue ALTER TABLE mutations against every PII-bearing ClickHouse table for
 * the given (tenant_id, session_id) and persist tracking rows.
 *
 * Idempotency: if existing non-terminal rows already exist in
 * `dsr_clickhouse_mutations` for this (tenant, session) we return their
 * current statuses without reissuing. If all rows are 'done' we report
 * 'reused' so callers can short-circuit cleanly.
 *
 * On a CLICKHOUSE_URL=unset environment (dev / CI) this is a structured no-op
 * that returns `[{ table, status: 'no_op', ... }]` rows so tests can exercise
 * the route end-to-end.
 *
 * Errors per-table are caught and recorded as 'failed' rows; the poller will
 * retry. The function never throws — the DSR endpoint must remain 200-OK
 * after this step in order to honour the data subject's request.
 */
async function issueClickHouseEraseMutations(args: {
  db: ReturnType<typeof createAdminClient>;
  dsrVerificationId: string;
  tenantId: string;
  sessionId: string;
}): Promise<{
  overallStatus: 'pending' | 'done' | 'failed' | 'no_data';
  mutations: MutationSummary[];
}> {
  const cfg = readClickHouseConfig();

  // Idempotency check — look up any existing mutation rows for this
  // (tenant, session).
  const existing = await args.db
    .select()
    .from(dsrClickhouseMutations)
    .where(
      and(
        eq(dsrClickhouseMutations.tenantId, args.tenantId),
        eq(dsrClickhouseMutations.sessionId, args.sessionId),
      ),
    );

  if (existing.length > 0) {
    const allDone = existing.every((r) => r.status === 'done');
    const anyFailed = existing.some((r) => r.status === 'failed');
    const status: 'pending' | 'done' | 'failed' | 'no_data' = allDone
      ? 'done'
      : anyFailed
        ? 'failed'
        : 'pending';
    return {
      overallStatus: status,
      mutations: existing.map((r) => ({
        table: r.tableName,
        status: 'reused' as const,
        mutation_id: r.mutationId || null,
      })),
    };
  }

  // No prior rows — issue fresh mutations.
  const summaries: MutationSummary[] = [];

  // When ClickHouse is not configured (dev / CI), persist 'done' no-op rows
  // so the audit chain remains consistent and idempotency works on replay.
  if (!cfg) {
    for (const { table, column } of DSR_CLICKHOUSE_TABLES) {
      await args.db.insert(dsrClickhouseMutations).values({
        dsrVerificationId: args.dsrVerificationId,
        tenantId: args.tenantId,
        sessionId: args.sessionId,
        tableName: table,
        mutationId: '',
        status: 'done',
        retryCount: 0,
        completedAt: new Date(),
        alterSql: `-- CLICKHOUSE_URL unset; no-op for table ${table}.${column}`,
      });
      summaries.push({ table, status: 'done', mutation_id: null });
    }
    return { overallStatus: 'done', mutations: summaries };
  }

  for (const { table, column } of DSR_CLICKHOUSE_TABLES) {
    try {
      const result = await issueEraseMutation(cfg, {
        table,
        column,
        sessionIds: [args.sessionId],
      });
      await args.db.insert(dsrClickhouseMutations).values({
        dsrVerificationId: args.dsrVerificationId,
        tenantId: args.tenantId,
        sessionId: args.sessionId,
        tableName: table,
        mutationId: result.mutationId ?? '',
        status: 'pending',
        retryCount: 0,
        alterSql: result.alterSql,
      });
      summaries.push({ table, status: 'pending', mutation_id: result.mutationId });
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      await args.db.insert(dsrClickhouseMutations).values({
        dsrVerificationId: args.dsrVerificationId,
        tenantId: args.tenantId,
        sessionId: args.sessionId,
        tableName: table,
        mutationId: '',
        status: 'failed',
        retryCount: 0,
        lastFailedReason: reason.slice(0, 1000),
        alterSql: `-- ALTER TABLE issue failed: ${reason.slice(0, 200)}`,
      });
      summaries.push({ table, status: 'failed', mutation_id: null });
      console.error(
        `[dsr/erase] ClickHouse mutation for table ${table} failed:`,
        reason.slice(0, 500),
      );
    }
  }

  // Overall status: 'pending' as long as at least one mutation is non-terminal.
  const anyFailed = summaries.some((s) => s.status === 'failed');
  const anyPending = summaries.some((s) => s.status === 'pending');
  const overall: 'pending' | 'done' | 'failed' | 'no_data' = anyPending
    ? 'pending'
    : anyFailed
      ? 'failed'
      : 'done';
  return { overallStatus: overall, mutations: summaries };
}

// ─── POST handler ──────────────────────────────────────────────────────────────

/**
 * POST /api/dsr/erase
 *
 * Body: `{ token: string }` — the 6-digit OTP.
 *
 * @returns 200 `{ deleted_at, clickhouse_deletion: { status, mutations } }` on success.
 * @returns 400 on invalid body.
 * @returns 401 when OTP is expired or already used.
 * @returns 404 when OTP is not found or wrong type.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  // ── Parse + validate body ──────────────────────────────────────────────────
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'Request body is not valid JSON' } },
      { status: 400 },
    );
  }

  const parsed = EraseBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'body.token is required',
          details: parsed.error.flatten(),
        },
      },
      { status: 400 },
    );
  }

  const { token } = parsed.data;
  const db = createAdminClient();
  const otpHash = hashOtp(token);

  // ── Look up the verification record ──────────────────────────────────────
  const [record] = await db
    .select()
    .from(dsrVerifications)
    .where(and(eq(dsrVerifications.otpHash, otpHash), eq(dsrVerifications.dsrType, 'erase')))
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

  // ── Delete session data in a transaction ──────────────────────────────────
  await db.transaction(async (tx) => {
    await tx
      .delete(sessionEmbeddings)
      .where(
        and(
          eq(sessionEmbeddings.sessionId, record.sessionId),
          eq(sessionEmbeddings.tenantId, record.tenantId),
        ),
      );

    await tx.delete(consentRecords).where(eq(consentRecords.sessionId, record.sessionId));

    // ── FOLLOW-172 / FOLLOW-184: conversion_labels erasure cascade (GDPR Art. 17) ─
    //
    // Two DELETE passes cover both identifier namespaces for this data subject:
    //
    //   Pass A — SDK feedback-ping labels (existing, FOLLOW-172):
    //     conversion_labels WHERE lead_id = session_id
    //     These are rows written by the SDK feedback ping with lead_id = session_id.
    //
    //   Pass B — CRM deep-outcome labels (NEW, FOLLOW-184):
    //     conversion_labels WHERE lead_id = durable_lead_id
    //     CRM webhook writes use an opaque tenant-supplied token as lead_id, which is
    //     a DIFFERENT namespace from session_id. Without this pass those rows survive
    //     a DSR erasure — GDPR Art. 17 gap (RETRO-031 §4a LG-1).
    //
    // CRITICAL GUARD on BOTH passes (FOLLOW-180/LG-2):
    //   NEVER delete when the key is empty — an empty lead_id would erase ALL system
    //   labels for the tenant (data loss). Guarded at two layers:
    //     (a) application-layer: key !== '' before issuing the DELETE
    //     (b) DB-layer: ne(conversionLabels.leadId, '') predicate in the WHERE clause
    //
    // Pass A: session_id path (SDK ping labels).
    if (record.sessionId !== '') {
      await tx.delete(conversionLabels).where(
        and(
          eq(conversionLabels.tenantId, record.tenantId),
          eq(conversionLabels.leadId, record.sessionId),
          // Double-guard: skip any row where lead_id was somehow stored as ''.
          ne(conversionLabels.leadId, ''),
        ),
      );
    }

    // Pass B: durable CRM lead_id path (CRM deep-outcome labels, FOLLOW-184).
    // Only runs when the DSR initiator supplied a durable_lead_id AND it differs
    // from the session_id (dedup: if they happen to be equal, Pass A already covered
    // those rows — issuing a second DELETE is safe but wasteful).
    const durableLeadId = record.durableLeadId;
    if (
      typeof durableLeadId === 'string' &&
      durableLeadId !== '' &&
      durableLeadId !== record.sessionId
    ) {
      await tx.delete(conversionLabels).where(
        and(
          eq(conversionLabels.tenantId, record.tenantId),
          eq(conversionLabels.leadId, durableLeadId),
          // Double-guard: belt-and-suspenders — an empty stored lead_id must never match.
          ne(conversionLabels.leadId, ''),
        ),
      );
    }

    // ── FOLLOW-193 / DPIA §8 line 773: engagement_scores erasure cascade ─────
    // The DPIA explicitly lists engagement_scores in the Art. 17 erasure cascade.
    // Deleted in the SAME transaction for atomicity -- a partial erasure (e.g.
    // session_embeddings deleted but engagement_scores left behind) would be a
    // GDPR Art. 17 compliance gap.
    await tx
      .delete(engagementScores)
      .where(
        and(
          eq(engagementScores.sessionId, record.sessionId),
          eq(engagementScores.tenantId, record.tenantId),
        ),
      );
  });

  // ── FOLLOW-239 / FOLLOW-238: CRM erasure tenant-capability check (GDPR Art. 17) ──
  //
  // When durable_lead_id is NULL, Pass B above did not run. We detect whether
  // this tenant has CRM-written conversion_labels rows that were NOT covered by
  // Pass A (i.e. rows with lead_id != session_id and lead_id != '').
  //
  // FOLLOW-238 (AC1) semantic correction — TENANT-CAPABILITY WARNING, not a
  // subject-completeness claim:
  //   The count query is scoped to the TENANT, not the subject. conversion_labels
  //   has no per-subject identifier other than lead_id. When durable_lead_id is
  //   absent, we CANNOT know which CRM rows (if any) belong to THIS subject. We
  //   can only determine that the TENANT has un-erased CRM-namespace rows and no
  //   durable token was supplied. That is a capability gap, not a proven subject
  //   incompleteness. The Sentry message and status value reflect this distinction.
  //
  // This check runs OUTSIDE the transaction (read-only) after the erase transaction
  // commits, so it reflects the post-delete state.
  //
  // Observable on the wire: `crm_erasure_status` field in the 200 body:
  //   'complete'                  — Pass B ran (operator supplied lead_id), or
  //                                 no CRM-namespace rows exist for this tenant.
  //   'crm_tenant_unverifiable'   — Pass B skipped AND tenant has CRM-namespace rows.
  //                                 CRM completeness is UNVERIFIABLE for this subject.
  //                                 Operator must re-initiate with lead_id.
  //   'unverified'                — Count-query failed; CRM state unknown.
  //                                 (FOLLOW-238 AC2: never claim 'complete' when DB threw.)
  //
  // Rule K.2: mock/fabricated data is forbidden; this is a real DB read.

  type CrmErasureStatus = 'complete' | 'crm_tenant_unverifiable' | 'unverified';
  let crmErasureStatus: CrmErasureStatus = 'complete';

  const durableLeadId = record.durableLeadId;
  const passBRan =
    typeof durableLeadId === 'string' && durableLeadId !== '' && durableLeadId !== record.sessionId;

  if (!passBRan) {
    // Count CRM-namespace rows tenant-wide: non-empty lead_id that is NOT the session_id.
    // A non-zero count means this tenant has CRM rows AND no durable token was supplied —
    // CRM-namespace completeness is UNVERIFIABLE for this subject.
    try {
      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(conversionLabels)
        .where(
          and(
            eq(conversionLabels.tenantId, record.tenantId),
            ne(conversionLabels.leadId, ''),
            ne(conversionLabels.leadId, record.sessionId),
          ),
        );

      const tenantCrmRows = countRow?.count ?? 0;

      if (tenantCrmRows > 0) {
        // FOLLOW-238 (AC1): tenant-capability warning — NOT a subject-completeness claim.
        // We do not know if any of these rows belong to the erased subject.
        crmErasureStatus = 'crm_tenant_unverifiable';

        // ── Sentry warning (Rule K.2: capability gap must be observable) ─────────────
        console.warn(
          `[dsr/erase] FOLLOW-238: CRM-namespace completeness UNVERIFIABLE for tenant ` +
            `${record.tenantId} / session ${record.sessionId}. ` +
            `Tenant has ${String(tenantCrmRows)} CRM-namespace conversion_labels row(s) ` +
            `and no durable_lead_id was supplied at DSR initiation. ` +
            `Cannot confirm whether any belong to this subject. ` +
            `Operator must re-initiate with lead_id. See docs/ops/DSR_ALERTING.md.`,
        );

        if (typeof process !== 'undefined' && process.env.SENTRY_DSN_CONTROL_PLANE) {
          try {
            const Sentry = await import('@sentry/nextjs');
            Sentry.captureMessage(
              `[dsr/erase] CRM completeness unverifiable: tenant has ` +
                `${String(tenantCrmRows)} CRM rows; no durable_lead_id supplied`,
              {
                level: 'warning',
                tags: {
                  route: 'dsr/erase',
                  tenant_id: record.tenantId,
                  follow: 'FOLLOW-238',
                },
                extra: {
                  tenant_crm_row_count: tenantCrmRows,
                  session_id: record.sessionId,
                  dsr_verification_id: record.id,
                  reason: 'durable_lead_id_not_supplied',
                  semantic:
                    'tenant-capability-warning: cannot verify subject membership in CRM rows',
                  operator_action: 'Re-initiate DSR with lead_id. See docs/ops/DSR_ALERTING.md.',
                },
              },
            );
          } catch {
            // Sentry failure must not mask the real status.
          }
        }

        // ── ClickHouse audit entry (fire-and-forget) — unverifiable state is auditable ─
        // DSR_AUDIT_ACTIONS.crm_unverifiable is the canonical action literal (FOLLOW-238 AC3).
        void writeDsrAuditLog({
          tenant_id: record.tenantId,
          session_id: record.sessionId,
          dsr_type: 'erase',
          action: DSR_AUDIT_ACTIONS.crm_unverifiable,
          email: record.email,
          requested_at: record.createdAt,
          completed_at: now,
        }).catch((err: unknown) => {
          console.error(
            '[dsr/erase] ClickHouse crm-unverifiable audit log failed:',
            err instanceof Error ? err.message : err,
          );
        });
      }
      // If tenantCrmRows === 0: no CRM rows exist for this tenant at all.
      // crmErasureStatus stays 'complete' — correct and non-over-claiming.
    } catch (err: unknown) {
      // FOLLOW-238 (AC2): count-query failure — MUST NOT claim 'complete'.
      // The erase DID run (Pass A completed) but CRM state is UNKNOWN.
      crmErasureStatus = 'unverified';
      console.error(
        '[dsr/erase] FOLLOW-238: CRM count-query failed — CRM erasure state unverified:',
        err instanceof Error ? err.message : err,
      );
      if (typeof process !== 'undefined' && process.env.SENTRY_DSN_CONTROL_PLANE) {
        try {
          const Sentry = await import('@sentry/nextjs');
          Sentry.captureException(err, {
            tags: { route: 'dsr/erase', tenant_id: record.tenantId, follow: 'FOLLOW-238' },
          });
        } catch {
          // Sentry failure must not mask the real error.
        }
      }
    }
  }

  // ── Redis session DEL (fire-and-forget) ───────────────────────────────────
  void deleteSessionFromRedis(record.sessionId).catch((err: unknown) => {
    console.error('[dsr/erase] Redis DEL failed:', err instanceof Error ? err.message : err);
  });

  // ── ClickHouse hard-delete (FOLLOW-039 — RODO Art. 17) ────────────────────
  // Awaited (not fire-and-forget) so the response reflects mutation issuance.
  // Per Master Design §H.1, the controller has 1 month to fulfill erasure —
  // async mutation status is acceptable, so we return 'pending' immediately.
  let clickhouseDeletion: {
    status: 'pending' | 'done' | 'failed' | 'no_data';
    mutations: MutationSummary[];
  };
  try {
    const result = await issueClickHouseEraseMutations({
      db,
      dsrVerificationId: record.id,
      tenantId: record.tenantId,
      sessionId: record.sessionId,
    });
    clickhouseDeletion = { status: result.overallStatus, mutations: result.mutations };
  } catch (err: unknown) {
    // Mutation-issuance must NOT fail the DSR request. Log and record
    // 'failed' for downstream visibility.
    console.error(
      '[dsr/erase] ClickHouse hard-delete orchestration failed:',
      err instanceof Error ? err.message : err,
    );
    clickhouseDeletion = { status: 'failed', mutations: [] };
  }

  // ── Audit log (fire-and-forget) ────────────────────────────────────────────
  // We persist the audit row immediately. The poller will later update the
  // clickhouse_mutation_* columns once mutations resolve.
  void writeDsrAuditLog({
    tenant_id: record.tenantId,
    session_id: record.sessionId,
    dsr_type: 'erase',
    action: DSR_AUDIT_ACTIONS.completed,
    email: record.email,
    requested_at: record.createdAt,
    completed_at: now,
  }).catch((err: unknown) => {
    console.error(
      '[dsr/erase] ClickHouse audit log failed:',
      err instanceof Error ? err.message : err,
    );
  });

  return NextResponse.json(
    {
      deleted_at: now.toISOString(),
      // FOLLOW-238 / FOLLOW-239: observable CRM capability provenance (Rule K.2 — not silent).
      // 'complete'                 — Pass B ran, or no CRM-namespace rows exist for this tenant.
      // 'crm_tenant_unverifiable'  — Pass B skipped; tenant has CRM rows but subject membership
      //                              is UNVERIFIABLE. Operator must re-initiate with lead_id.
      //                              See docs/ops/DSR_ALERTING.md.
      // 'unverified'               — Count-query failed; CRM state unknown (Rule K.2 — never
      //                              claim 'complete' when DB threw).
      crm_erasure_status: crmErasureStatus,
      clickhouse_deletion: clickhouseDeletion,
    },
    { status: 200 },
  );
}
