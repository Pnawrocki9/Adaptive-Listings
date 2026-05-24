/**
 * Internal helper for /api/dsr/mutation-poll/route.ts.
 *
 * Lives in a non-route file so it can be exported (Next.js App Router
 * rejects non-handler exports from route.ts files).
 *
 * Inspects all `dsr_clickhouse_mutations` rows for the given verification.
 * If every row is in a terminal state ('done' or 'failed'), aggregate the
 * status and update the matching `dsr_audit_log` ClickHouse row's
 * clickhouse_mutation_status + clickhouse_mutation_completed_at.
 *
 * @module apps/control-plane/src/app/api/dsr/mutation-poll/_finalise
 */

import * as Sentry from '@sentry/nextjs';
import { eq } from 'drizzle-orm';
import { dsrClickhouseMutations } from '@estalara/db';
import type { createAdminClient } from '@estalara/db';
import { aggregateMutationStatus, updateDsrAuditLogClickHouseStatus } from '@/lib/clickhouse-dsr';
import type { readClickHouseConfig } from '@/lib/clickhouse-dsr';

export async function maybeFinaliseAuditLog(
  db: ReturnType<typeof createAdminClient>,
  cfg: ReturnType<typeof readClickHouseConfig>,
  verificationId: string,
): Promise<void> {
  if (!cfg) return;
  const rows = await db
    .select()
    .from(dsrClickhouseMutations)
    .where(eq(dsrClickhouseMutations.dsrVerificationId, verificationId));

  if (rows.length === 0) return;
  const nonTerminal = rows.filter((r) => r.status !== 'done' && r.status !== 'failed');
  if (nonTerminal.length > 0) return;

  const aggregate = aggregateMutationStatus(
    rows.map((r) => r.status as 'pending' | 'in_progress' | 'done' | 'failed'),
  );

  // Pick one row to source tenant_id + session_id (all are identical for a
  // given verification).
  const sample = rows[0];
  if (!sample) return;
  const mutationIds = rows
    .map((r) => r.mutationId)
    .filter((m) => m && m.length > 0)
    .join(',');

  try {
    await updateDsrAuditLogClickHouseStatus(cfg, {
      tenant_id: sample.tenantId,
      session_id: sample.sessionId,
      clickhouse_mutation_id: mutationIds,
      clickhouse_mutation_status: aggregate,
      completed: true,
    });
  } catch (err: unknown) {
    Sentry.captureException(err, {
      tags: { dsr_erase_audit_finalise_failed: 'true' },
      extra: { verification_id: verificationId },
    });
  }
}
