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

export interface DsrAuditEntry {
  tenant_id: string;
  session_id: string;
  dsr_type: string;
  /** 'initiated' | 'completed' | 'expired' | 'failed' */
  action: string;
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

  const password = process.env.CLICKHOUSE_PASSWORD ?? '';
  const headers: Record<string, string> = {
    'Content-Type': 'text/plain',
    'X-ClickHouse-Format': 'JSONEachRow',
  };
  if (password) {
    headers.Authorization = `Basic ${Buffer.from(`:${password}`).toString('base64')}`;
  }

  const url = new URL(clickhouseUrl.replace(/\/$/, ''));
  url.searchParams.set('query', 'INSERT INTO dsr_audit_log FORMAT JSONEachRow');

  await fetch(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify(row),
  });
}
