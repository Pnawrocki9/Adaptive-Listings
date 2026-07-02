/**
 * ClickHouse audit log helper for DSR endpoints.
 *
 * Writes a row to the `dsr_audit_log` ClickHouse table (migration 0009).
 * All writes are fire-and-forget — callers must NOT await this in the response path.
 *
 * The email address is SHA-256 hashed before being written (PII protection).
 * Raw email is never stored in ClickHouse.
 *
 * When CLICKHOUSE_URL is not configured (dev / CI), the function is a no-op.
 *
 * @module apps/control-plane/src/app/api/dsr/_clickhouse
 */

import { createHash } from 'crypto';
import { clickhouseAuthHeaders } from '@/lib/clickhouse-http';
import * as Sentry from '@sentry/nextjs';

/**
 * Canonical set of DSR audit action strings written to `dsr_audit_log.action`.
 *
 * FOLLOW-238 (AC3): extracted from inline literals so both the erase route and
 * the DSR_ALERTING.md §5 ClickHouse query share the same source of truth.
 * Prevents route-vs-docs drift — any rename here is a single-point change.
 *
 * Consumers: apps/control-plane/src/app/api/dsr/erase/route.ts,
 *            apps/control-plane/src/app/api/dsr/initiate/route.ts,
 *            apps/control-plane/src/app/api/dsr/portability/route.ts,
 *            apps/control-plane/src/app/api/dsr/access/route.ts,
 *            docs/ops/DSR_ALERTING.md §5 (ClickHouse query reference).
 */
export const DSR_AUDIT_ACTIONS = {
  /** DSR request received and OTP sent to the data subject. */
  initiated: 'initiated',
  /** DSR fully completed (all Postgres + ClickHouse passes ran). */
  completed: 'completed',
  /** DSR OTP expired before use. */
  expired: 'expired',
  /** DSR processing encountered an unrecoverable error. */
  failed: 'failed',
  /**
   * FOLLOW-239 / FOLLOW-238: Pass B was skipped (no durable_lead_id) and this
   * tenant has CRM-namespace conversion_labels rows whose subject membership is
   * UNVERIFIABLE for this session. The CRM-namespace erasure completeness cannot
   * be confirmed. Operator must re-initiate with lead_id.
   *
   * Semantics (FOLLOW-238 AC1): this is a TENANT-CAPABILITY warning, not a
   * subject-completeness claim. The query cannot prove these rows belong to the
   * erased subject — it only proves the tenant has un-erased CRM rows and no
   * durable token was supplied.
   */
  crm_unverifiable: 'crm_unverifiable',
  /**
   * FOLLOW-455 / audit F-20: POST /api/dsr/initiate rejected a request
   * because (tenant_id, email) exceeded INITIATE_RATE_LIMIT_MAX within the
   * rolling window (anti email-bomb guard). No OTP was generated or sent.
   */
  rate_limited: 'rate_limited',
} as const;

/** Union of all valid DSR audit action strings. */
export type DsrAuditAction = (typeof DSR_AUDIT_ACTIONS)[keyof typeof DSR_AUDIT_ACTIONS];

export interface DsrAuditEntry {
  tenant_id: string;
  session_id: string;
  dsr_type: string;
  /**
   * One of the `DSR_AUDIT_ACTIONS` values. Typed as `DsrAuditAction` to prevent
   * raw-string drift between the route and the ClickHouse query in DSR_ALERTING.md §5.
   */
  action: DsrAuditAction;
  /** Raw email — will be hashed before writing to ClickHouse. */
  email: string;
  requested_at: Date;
  completed_at?: Date;
}

/**
 * Write a DSR audit record to ClickHouse.
 *
 * Fire-and-forget — do not await in request handlers.
 * Errors are non-fatal; the caller should log and continue.
 *
 * @param entry - The audit entry to write.
 */
export async function writeDsrAuditLog(entry: DsrAuditEntry): Promise<void> {
  const clickhouseUrl = process.env.CLICKHOUSE_URL;
  if (!clickhouseUrl) return;

  const emailHash = createHash('sha256').update(entry.email).digest('hex');

  const row = {
    tenant_id: entry.tenant_id,
    session_id: entry.session_id,
    dsr_type: entry.dsr_type,
    action: entry.action,
    email_hash: emailHash,
    requested_at: entry.requested_at.toISOString().replace('T', ' ').replace('Z', ''),
    completed_at: entry.completed_at
      ? entry.completed_at.toISOString().replace('T', ' ').replace('Z', '')
      : null,
  };

  const user = process.env.CLICKHOUSE_USER ?? 'default';
  const password = process.env.CLICKHOUSE_PASSWORD ?? '';
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain',
    'X-ClickHouse-Format': 'JSONEachRow',
    ...clickhouseAuthHeaders({ user, password }),
  };

  const url = new URL(clickhouseUrl.replace(/\/$/, ''));
  url.searchParams.set('query', 'INSERT INTO dsr_audit_log FORMAT JSONEachRow');

  try {
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '<unreadable body>');
      const msg = `[dsr] ClickHouse INSERT rejected: HTTP ${String(res.status)} — ${body.slice(0, 500)}`;
      console.error(msg);
      Sentry.captureException(new Error(msg), {
        tags: { area: 'dsr', sink: 'clickhouse', kind: 'insert_rejected', table: 'dsr_audit_log' },
        extra: { status: res.status },
      });
    }
  } catch (err: unknown) {
    // Network-layer failure (DNS, connection refused, malformed URL, timeout).
    // Analytics failures must not surface to callers — log + Sentry only.
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[dsr] ClickHouse log failed:', msg);
    Sentry.captureException(err instanceof Error ? err : new Error(msg), {
      tags: { area: 'dsr', sink: 'clickhouse', kind: 'network', table: 'dsr_audit_log' },
    });
  }
}
