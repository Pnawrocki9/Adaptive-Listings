/**
 * The DSR erasure ledger, as the retry consumer reads it (FOLLOW-1308, retry vs erasure).
 *
 * A queued retry (`estalara-events-retry`, or a message replayed out of its DLQ) can carry rows of
 * a session that was erased after the rows were first accepted. Replaying it would re-insert the
 * erased `events` / `intent_events` rows or re-create the erased `intent_sessions` head. The
 * ledger is Postgres `dsr_verifications`: a row with `dsr_type = 'erase'` and `used_at` set is an
 * erasure that committed. `POST /api/dsr/erase` sets `used_at` inside the same transaction that
 * deletes the Postgres rows, and before it issues the ClickHouse mutations.
 *
 * Read through PostgREST with the service-role key the Worker already holds for `intent_sessions`.
 * No new table, no new secret.
 *
 * Failure posture: a configured ledger that cannot be read fails CLOSED (the caller retries the
 * message; nothing is inserted). An unconfigured ledger (no `SUPABASE_URL` / service-role key)
 * fails closed in `ENVIRONMENT=production` and open elsewhere (localhost and CI have no
 * PostgREST); the open case is logged. The control plane's mutation poller covers the remaining
 * window (a retry already past this check when the erase commits): it does not accept a done
 * mutation while rows of the subject are left (`countSessionRows`).
 *
 * @module apps/ingest/src/erasure-ledger
 */

import { logger } from './observability/logger.js';

/** The Worker bindings the ledger read needs. */
interface ErasureLedgerEnv {
  ENVIRONMENT?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

/** Sessions per PostgREST request; a retry message is one SDK batch, usually one session. */
const LEDGER_CHUNK = 50;

/** One `in.(…)` list member, double-quoted per PostgREST's reserved-character rule. */
function quoteInListValue(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/**
 * Which of `sessionIds` (for `tenantId`) have a committed DSR erasure.
 *
 * @returns `{ ok: true, erased }`, or `{ ok: false }` when the ledger could not be read and the
 *   caller must not insert.
 */
export async function readErasedSessions(
  env: ErasureLedgerEnv,
  tenantId: string,
  sessionIds: readonly string[],
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; erased: Set<string> } | { ok: false; reason: string }> {
  const unique = [...new Set(sessionIds.filter((s) => s !== ''))];
  if (unique.length === 0) return { ok: true, erased: new Set() };

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    if (env.ENVIRONMENT === 'production') return { ok: false, reason: 'ledger_unconfigured' };
    logger.warn({ tenant_id: tenantId }, 'erasure_ledger_unconfigured_fail_open');
    return { ok: true, erased: new Set() };
  }

  const base = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/dsr_verifications`;
  const headers = {
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Accept: 'application/json',
  };
  const erased = new Set<string>();
  for (let i = 0; i < unique.length; i += LEDGER_CHUNK) {
    const list = unique
      .slice(i, i + LEDGER_CHUNK)
      .map(quoteInListValue)
      .join(',');
    const url =
      `${base}?select=session_id` +
      `&tenant_id=eq.${encodeURIComponent(tenantId)}` +
      `&dsr_type=eq.erase&used_at=not.is.null` +
      `&session_id=in.${encodeURIComponent(`(${list})`)}`;
    let res: Response;
    try {
      res = await fetchImpl(url, { method: 'GET', headers });
    } catch {
      return { ok: false, reason: 'ledger_unreachable' };
    }
    if (!res.ok) return { ok: false, reason: `ledger_http_${String(res.status)}` };
    let rows: unknown;
    try {
      rows = await res.json();
    } catch {
      return { ok: false, reason: 'ledger_body_invalid' };
    }
    if (!Array.isArray(rows)) return { ok: false, reason: 'ledger_body_invalid' };
    for (const row of rows as unknown[]) {
      const id = (row as { session_id?: unknown } | null)?.session_id;
      if (typeof id === 'string') erased.add(id);
    }
  }
  return { ok: true, erased };
}
