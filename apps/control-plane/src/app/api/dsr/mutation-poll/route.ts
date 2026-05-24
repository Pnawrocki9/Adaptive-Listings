/**
 * GET /api/dsr/mutation-poll
 *
 * Vercel Cron handler. Polls ClickHouse `system.mutations` for every
 * non-terminal row in `dsr_clickhouse_mutations` and updates state.
 *
 * **Polling strategy chosen: Vercel Cron** (every 5 minutes).
 *
 * Rationale documented in PR description:
 *   - Existing infra already on Vercel (control-plane is the only place to
 *     run a poller alongside the DSR endpoint).
 *   - Free tier on Hobby allows 2 cron jobs; this is the first one. We are on
 *     Vercel Pro per `apps/control-plane/vercel.json` so quota is not a
 *     concern (40 cron jobs / 1-min granularity available).
 *   - 5-minute granularity is well within the GDPR 30-day SLA and the
 *     ClickHouse Cloud expected completion window (seconds to minutes per
 *     mutation in our row-volume regime).
 *   - No external scheduler dependency (Modal cron would couple us to
 *     Modal's auth + secrets for what is a Next.js-native concern).
 *
 * Auth: protected by `CRON_SECRET` header per Vercel Cron security guidance
 * (https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs).
 * Vercel injects `Authorization: Bearer ${CRON_SECRET}` automatically for
 * cron-triggered invocations.
 *
 * Returns 401 if CRON_SECRET env var is not set (infrastructure misconfiguration)
 * or if the Authorization header does not match.
 *
 * Retry-on-failure (Acceptance Criteria):
 *   - When system.mutations.latest_failed_reason is non-empty, we increment
 *     retry_count and reissue ALTER TABLE up to 3 times with exponential
 *     backoff (1m → 5m → 30m).
 *   - On final (4th) failure the row stays terminal `failed`, the parent
 *     dsr_audit_log row is updated to clickhouse_mutation_status='failed',
 *     and Sentry captures an error tagged dsr_erase_clickhouse_mutation_failed.
 *
 * Idempotency:
 *   - This handler is safe to invoke multiple times concurrently; each row is
 *     advanced based solely on its current ClickHouse status.
 *
 * @module apps/control-plane/src/app/api/dsr/mutation-poll/route
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { and, eq, inArray, isNull, lte, or } from 'drizzle-orm';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient, dsrClickhouseMutations } from '@estalara/db';
import {
  computeNextRetryAt,
  issueEraseMutation,
  MAX_MUTATION_RETRIES,
  pollMutationStatus,
  readClickHouseConfig,
  resolveMutationIdByMarker,
} from '@/lib/clickhouse-dsr';
import { maybeFinaliseAuditLog } from './_finalise';

/**
 * The set of statuses the poller still needs to advance.
 */
const NON_TERMINAL_STATUSES = ['pending', 'in_progress', 'failed'] as const;

/**
 * Maximum number of rows polled per invocation. Defends against an unbounded
 * job in the (unexpected) event of a backlog.
 */
const MAX_ROWS_PER_RUN = 200;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Reject when CRON_SECRET is not set — unconfigured secret is an
  // infrastructure misconfiguration, not a valid dev/CI bypass.
  if (!secret) return false;
  const authHeader = req.headers.get('authorization');
  return authHeader === `Bearer ${secret}`;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Cron secret invalid' } },
      { status: 401 },
    );
  }

  const cfg = readClickHouseConfig();
  if (!cfg) {
    // No-op when ClickHouse is unconfigured.
    return NextResponse.json({ polled: 0, advanced: 0, note: 'CLICKHOUSE_URL_unset' });
  }

  const db = createAdminClient();
  const now = new Date();

  // Pick up rows that need progression:
  //   - status in ('pending', 'in_progress') always considered
  //   - status = 'failed' AND retry_count < MAX_MUTATION_RETRIES AND
  //     (next_retry_at IS NULL OR next_retry_at <= now)
  const rows = await db
    .select()
    .from(dsrClickhouseMutations)
    .where(
      and(
        inArray(dsrClickhouseMutations.status, [...NON_TERMINAL_STATUSES]),
        or(
          isNull(dsrClickhouseMutations.nextRetryAt),
          lte(dsrClickhouseMutations.nextRetryAt, now),
        ),
      ),
    )
    .limit(MAX_ROWS_PER_RUN);

  let polled = 0;
  let advanced = 0;
  const verificationsToFinalise = new Set<string>();

  for (const row of rows) {
    polled += 1;
    try {
      const before = row.status;

      // Resolve mutation_id if we don't have one yet.
      let mutationId = row.mutationId;
      if (!mutationId) {
        // Recover the marker from the alter_sql comment, if any.
        const markerMatch = /DSR:([a-zA-Z0-9_-]+)/.exec(row.alterSql);
        const markerToken = markerMatch?.[1];
        if (markerToken) {
          const resolved = await resolveMutationIdByMarker(cfg, row.tableName, markerToken);
          if (resolved) {
            mutationId = resolved;
            await db
              .update(dsrClickhouseMutations)
              .set({ mutationId, updatedAt: new Date() })
              .where(eq(dsrClickhouseMutations.id, row.id));
          }
        }
      }

      // Without a resolved mutation_id we can't query status — wait for the
      // next run. Stamp next_retry_at to throttle the lookup.
      if (!mutationId) {
        await db
          .update(dsrClickhouseMutations)
          .set({
            updatedAt: new Date(),
            nextRetryAt: new Date(Date.now() + 5 * 60_000),
          })
          .where(eq(dsrClickhouseMutations.id, row.id));
        continue;
      }

      // Failure handling — if this row was already 'failed' and we are here
      // for a retry, reissue ALTER TABLE.
      if (row.status === 'failed') {
        if (row.retryCount >= MAX_MUTATION_RETRIES) {
          continue; // terminal — shouldn't be picked up but guard anyway.
        }
        // Reissue the mutation. Use the existing alter_sql verbatim to
        // preserve the marker for traceability across retries.
        try {
          const result = await issueEraseMutation(cfg, {
            table: row.tableName,
            column: 'session_id',
            sessionIds: [row.sessionId],
          });
          await db
            .update(dsrClickhouseMutations)
            .set({
              mutationId: result.mutationId ?? '',
              alterSql: result.alterSql,
              status: 'pending',
              retryCount: row.retryCount + 1,
              lastFailedReason: null,
              nextRetryAt: null,
              updatedAt: new Date(),
            })
            .where(eq(dsrClickhouseMutations.id, row.id));
          advanced += 1;
        } catch (err: unknown) {
          const reason = err instanceof Error ? err.message : String(err);
          const nextRetryCount = row.retryCount + 1;
          const nextRetryAt = computeNextRetryAt(nextRetryCount);
          await db
            .update(dsrClickhouseMutations)
            .set({
              retryCount: nextRetryCount,
              lastFailedReason: reason.slice(0, 1000),
              nextRetryAt,
              updatedAt: new Date(),
            })
            .where(eq(dsrClickhouseMutations.id, row.id));
          if (nextRetryCount >= MAX_MUTATION_RETRIES && !nextRetryAt) {
            Sentry.captureException(err, {
              tags: { dsr_erase_clickhouse_mutation_failed: 'true' },
              extra: {
                tenant_id: row.tenantId,
                table: row.tableName,
                retry_count: nextRetryCount,
              },
            });
            verificationsToFinalise.add(row.dsrVerificationId);
          }
        }
        continue;
      }

      // Normal poll of system.mutations.
      const status = await pollMutationStatus(cfg, row.tableName, mutationId);
      if (!status) {
        // Row not yet visible — could be a race or the mutation has been
        // garbage-collected from system.mutations. Treat as in_progress; if
        // it persists, we'll fall through to the failed path on a later run.
        await db
          .update(dsrClickhouseMutations)
          .set({
            status: 'in_progress',
            updatedAt: new Date(),
            nextRetryAt: new Date(Date.now() + 5 * 60_000),
          })
          .where(eq(dsrClickhouseMutations.id, row.id));
        if (before !== 'in_progress') advanced += 1;
        continue;
      }

      const isDone = status.is_done === 1 || status.is_done === '1';
      const failedReason = status.latest_failed_reason;

      if (isDone && !failedReason) {
        await db
          .update(dsrClickhouseMutations)
          .set({
            status: 'done',
            completedAt: new Date(),
            updatedAt: new Date(),
            nextRetryAt: null,
            lastFailedReason: null,
          })
          .where(eq(dsrClickhouseMutations.id, row.id));
        advanced += 1;
        verificationsToFinalise.add(row.dsrVerificationId);
        continue;
      }

      if (failedReason) {
        const nextRetryCount = row.retryCount + 1;
        const nextRetryAt = computeNextRetryAt(nextRetryCount);
        const terminal = nextRetryCount >= MAX_MUTATION_RETRIES && !nextRetryAt;
        await db
          .update(dsrClickhouseMutations)
          .set({
            status: terminal ? 'failed' : 'failed', // remains failed; reissued on next eligible run
            retryCount: nextRetryCount,
            lastFailedReason: failedReason.slice(0, 1000),
            nextRetryAt,
            updatedAt: new Date(),
            completedAt: terminal ? new Date() : null,
          })
          .where(eq(dsrClickhouseMutations.id, row.id));
        advanced += 1;
        if (terminal) {
          Sentry.captureException(
            new Error(`ClickHouse DSR mutation permanent failure: ${failedReason}`),
            {
              tags: { dsr_erase_clickhouse_mutation_failed: 'true' },
              extra: {
                tenant_id: row.tenantId,
                table: row.tableName,
                retry_count: nextRetryCount,
                latest_failed_reason: failedReason,
              },
            },
          );
          verificationsToFinalise.add(row.dsrVerificationId);
        }
        continue;
      }

      // Still running.
      if (row.status !== 'in_progress') {
        await db
          .update(dsrClickhouseMutations)
          .set({
            status: 'in_progress',
            updatedAt: new Date(),
            nextRetryAt: new Date(Date.now() + 5 * 60_000),
          })
          .where(eq(dsrClickhouseMutations.id, row.id));
        advanced += 1;
      } else {
        await db
          .update(dsrClickhouseMutations)
          .set({
            updatedAt: new Date(),
            nextRetryAt: new Date(Date.now() + 5 * 60_000),
          })
          .where(eq(dsrClickhouseMutations.id, row.id));
      }
    } catch (err: unknown) {
      // Defensive — never let one row break the whole poll.
      Sentry.captureException(err, {
        tags: { dsr_erase_poll_row_error: 'true' },
        extra: { row_id: row.id, table: row.tableName },
      });
    }
  }

  // Finalise dsr_audit_log rows for verifications whose mutations all reached
  // a terminal state in this run.
  for (const verificationId of verificationsToFinalise) {
    await maybeFinaliseAuditLog(db, cfg, verificationId);
  }

  return NextResponse.json({ polled, advanced });
}
