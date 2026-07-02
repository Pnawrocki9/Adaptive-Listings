/**
 * intent_sessions → intent_events identifier resolution (FOLLOW-455 / audit F-20).
 *
 * ClickHouse `intent_events` is keyed on `intent_session_id`, the Postgres
 * `intent_sessions.id` UUID — NOT the SDK `session_id` (SHA-256 hex string)
 * used to key every other DSR-erased table. DSR erasure of `intent_events`
 * must resolve this id first (see `apps/control-plane/src/lib/clickhouse-dsr.ts`
 * `DSR_CLICKHOUSE_TABLES` entry for `intent_events`).
 *
 * Extracted into its own module (rather than inlined in the erase route) so
 * it is independently unit-testable and independently mockable in route
 * tests without perturbing the `db.select()` call ordering asserted
 * elsewhere in those tests.
 *
 * @module apps/control-plane/src/lib/intent-session-lookup
 */

import { and, eq } from 'drizzle-orm';
import type { createAdminClient } from '@estalara/db';
import { intentSessions } from '@estalara/db';

/**
 * Resolve the Postgres `intent_sessions.id` for a given (tenant_id,
 * session_id) pair.
 *
 * Returns `null` when no `intent_sessions` row exists for the subject — this
 * is the normal case for sessions that never triggered the K.3.6 archetype
 * tracer, or where the row has already been erased. Callers should treat
 * `null` as "nothing to erase in intent_events", not as an error.
 *
 * `intent_sessions` has a `unique(tenant_id, session_id)` constraint, so at
 * most one row can match.
 */
export async function resolveIntentSessionId(
  db: ReturnType<typeof createAdminClient>,
  tenantId: string,
  sessionId: string,
): Promise<string | null> {
  const [row] = await db
    .select({ id: intentSessions.id })
    .from(intentSessions)
    .where(and(eq(intentSessions.tenantId, tenantId), eq(intentSessions.sessionId, sessionId)))
    .limit(1);
  return row?.id ?? null;
}
