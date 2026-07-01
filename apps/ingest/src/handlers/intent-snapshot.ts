/**
 * `intent.snapshot` dual-write handler — K.3.6 Archetype Identification Tracer (FOLLOW-266).
 *
 * Receives a validated `intent.snapshot` event and fire-and-forgets two writes in parallel:
 *   1. INSERT into ClickHouse `intent_events` (append-only event trail for ML training).
 *   2. UPSERT into Supabase `intent_sessions` via PostgREST (mutable session-level summary).
 *
 * Both writes are fire-and-forget (Promise.allSettled) — ingest ACK (HTTP 200) is returned to
 * the SDK regardless of whether either write succeeds. Failures are logged to console/Sentry so
 * operators can observe the degraded state (Rule K.2: fail loud on configured-store failures).
 *
 * FOLLOW-287 fixes applied:
 *   - CB-1: intent_session_id column type changed from UUID to String (migration 0016). The raw
 *     session fingerprint is written to both intent_session_id (ORDER BY key) and session_id
 *     (join key, migration 0015). Previously a 64-char SHA-256 hex would be rejected by UUID column.
 *   - CB-2: confidence_before uses 0.0 fallback (column is Float32 NOT NULL). The IntentSnapshotPayload
 *     has no confidence_before field; null was silently rejected by ClickHouse JSONEachRow.
 *   - DG-1: Promise.allSettled rejections are logged via console.error (visible in CF Worker logs)
 *     in addition to the structured logger, so operators can observe degraded state.
 *
 * FOLLOW-449 fix applied (Rule K.2 fire-and-forget amendment, RETRO-135 §6):
 *   - A rejected/failed write (HTTP non-ok OR network throw) on EITHER sink is captured to Sentry
 *     via `Sentry.captureException` with `tags: { area: 'intent-snapshot', sink, kind }`, mirroring
 *     `publishAbAssignmentEvent` (apps/control-plane/src/lib/ab-events.ts). `kind` distinguishes
 *     `insert_rejected` (HTTP-level rejection — e.g. a missing-column/SCHEMA error after a ClickHouse
 *     migration drift, the exact ESC-031/F-02 failure mode) from `network` (fetch-level failure —
 *     DNS, connection refused, timeout). Stays fully async: capture happens inside the same
 *     already-fire-and-forgotten `Promise.allSettled` continuation, adding zero ACK latency.
 *
 * Privacy:
 *   - `event_payload` sent to ClickHouse is PII-scrubbed: contains only { signal_count,
 *     quiz_completed, quiz_leaf, chat_turns }. Never includes `probabilities` (archetype weight
 *     map) or any chat content.
 *   - `intent_sessions.intent_state` stores `probabilities` (the full weight distribution) as
 *     session state — this is not chat content and is not PII under the current DPIA scope.
 *
 * Auth: this handler runs inside the ingest Worker auth boundary (API key + optional HMAC
 * verified in events.ts before this handler is called). No additional auth needed here — the
 * tenant_id is already extracted and verified by the outer auth layer.
 *
 * @module apps/ingest/src/handlers/intent-snapshot
 */

import * as Sentry from '@sentry/cloudflare';

import type { IntentSnapshotPayload } from '@estalara/shared';
import { INTENT_SNAPSHOT_EVENT_TYPE } from '@estalara/shared';

import { logger } from '../observability/logger.js';

export type { IntentSnapshotPayload };

/** Environment bindings needed by the intent-snapshot handler. */
export interface IntentSnapshotEnv {
  /** ClickHouse Cloud HTTPS interface base URL (e.g. https://host:8443). Empty = skip write. */
  CLICKHOUSE_URL?: string;
  /** ClickHouse database name. Defaults to 'default'. */
  CLICKHOUSE_DATABASE?: string;
  /** ClickHouse user. */
  CLICKHOUSE_USER?: string;
  /** ClickHouse password. */
  CLICKHOUSE_PASSWORD?: string;
  /**
   * Supabase project URL (e.g. https://xxxx.supabase.co).
   * Empty = skip Supabase upsert write.
   */
  SUPABASE_URL?: string;
  /**
   * Supabase service-role key. Required for PostgREST writes that bypass RLS
   * (the Worker operates as a service, not a tenant user).
   * Empty = skip Supabase upsert write.
   */
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

/** Enriched event as it arrives from the ingest handler (post-auth, post-validate). */
export interface IntentSnapshotEvent {
  /** Session fingerprint from event envelope (SHA-256 hex, 32–64 chars). */
  session_id: string;
  /** Durable cross-session identifier (optional, from event or enrichment). */
  cross_session_id?: string;
  /** Tenant UUID (from auth layer, not event body — trusted). */
  tenant_id: string;
  /** Event timestamp — milliseconds since Unix epoch (client clock). */
  ts: number;
  /** Type-validated intent.snapshot payload. */
  payload: IntentSnapshotPayload;
}

/**
 * Derive a deterministic UUID v5-style from a namespace + name string.
 *
 * NOTE: As of FOLLOW-286 (LG-2) and FOLLOW-287 (CB-1), this function is NO LONGER USED
 * to produce the join key written to ClickHouse `intent_events`. The `session_id` column
 * (migration 0015) and `intent_session_id` column (now String after migration 0016) both
 * store the RAW session fingerprint string so FOLLOW-269 can join:
 *   intent_events.session_id = intent_sessions.session_id (composite text key)
 * instead of relying on a derived UUID.
 *
 * This function is retained for any future use cases that require a deterministic UUID
 * from a non-UUID session identifier.
 *
 * Implementation: SHA-256 of `${tenantId}:${sessionId}`, take first 32 hex chars,
 * format as UUID v4 layout (version bits set to 4, variant bits set to 8).
 * This is NOT a standards-compliant UUID v5 (which requires SHA-1 + name space OID),
 * but is deterministic and collision-resistant for our key space.
 *
 * @internal exported for tests only — not called from production code paths (FOLLOW-287 AC6).
 * No non-test production caller exists after the CB-1 fix (FOLLOW-287).
 */
export async function deriveSessionUuid(tenantId: string, sessionId: string): Promise<string> {
  // If sessionId is already a UUID (8-4-4-4-12 hex), use it directly.
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidPattern.test(sessionId)) return sessionId;

  // Derive from SHA-256(tenantId + ':' + sessionId).
  const enc = new TextEncoder();
  const data = enc.encode(`${tenantId}:${sessionId}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');

  // Format as UUID: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  // y is one of 8, 9, a, b (variant bits 10xx)
  const variantNibble = ((parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),
    variantNibble + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * INSERT one row into ClickHouse `intent_events` via the HTTPS interface.
 *
 * Writes to the `intent_events` table (0014 DDL + 0015 ADD COLUMN + 0016 type fix migrations).
 *
 * Column mapping (post-FOLLOW-287 fixes):
 *   - `intent_session_id` (ORDER BY key, UUID): omitted from INSERT — ClickHouse uses zero-UUID
 *     default. MODIFY COLUMN is forbidden on ORDER BY key columns (error 524, migration 0016
 *     was therefore a no-op).
 *   - `session_id` (migration 0015 ADD COLUMN): String, authoritative join key for FOLLOW-269.
 *     FOLLOW-269 joins: intent_events.session_id = intent_sessions.session_id (+ tenant_id).
 *   - `event_type`: pinned to `INTENT_SNAPSHOT_EVENT_TYPE` from @estalara/shared.
 *   - `confidence_before`: 0.0 fallback (Float32 NOT NULL; IntentSnapshotPayload has no prior field).
 *
 * Fire-and-forget caller uses Promise.allSettled — this function resolves with a result
 * object indicating success or failure. It does NOT throw.
 *
 * @internal exported for tests
 */
export async function insertIntentEventToClickHouse(
  event: IntentSnapshotEvent,
  sessionId: string,
  env: IntentSnapshotEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; error?: string }> {
  if (!env.CLICKHOUSE_URL) {
    logger.warn(
      { session_id: event.session_id },
      'intent_snapshot_clickhouse_skipped: CLICKHOUSE_URL not configured',
    );
    return { ok: true };
  }

  const database = env.CLICKHOUSE_DATABASE ?? 'default';
  const url = `${env.CLICKHOUSE_URL.replace(/\/$/, '')}/?database=${encodeURIComponent(database)}&query=${encodeURIComponent('INSERT INTO intent_events FORMAT JSONEachRow')}`;

  const eventAt = new Date(event.ts).toISOString();
  const archetype_deltas = JSON.stringify(event.payload.last_signal_delta?.archetype_deltas ?? {});
  // PII-scrubbed payload: no probabilities map, no chat content.
  const event_payload = JSON.stringify({
    signal_count: event.payload.signal_count,
    quiz_completed: event.payload.quiz_completed,
    quiz_leaf: event.payload.quiz_leaf,
    chat_turns: event.payload.chat_turns,
  });

  // `intent_session_id` is the ORDER BY key (UUID column, migration 0014). ClickHouse
  // forbids MODIFY COLUMN on ORDER BY key columns (error 524). Omitting it from the
  // INSERT body lets ClickHouse use the column DEFAULT (zero UUID). This is safe —
  // the zero UUID signals "no surrogate assigned" and MergeTree can order on it.
  //
  // `session_id` (String, migration 0015) is the authoritative join key for FOLLOW-269:
  //   intent_events.session_id = intent_sessions.session_id (+ tenant_id)
  //
  // CB-2 fix (FOLLOW-287): confidence_before must be 0.0 — Float32 NOT NULL rejects null.
  const row = {
    // intent_session_id omitted — ClickHouse uses zero-UUID default (ORDER BY key, UUID NOT NULL).
    // LG-2 / migration 0015: authoritative raw session fingerprint join key.
    session_id: sessionId,
    tenant_id: event.tenant_id,
    event_at: eventAt,
    // LG-1 fix: pinned to the shared constant so the DDL vocabulary and the writer
    // cannot silently diverge. See INTENT_SNAPSHOT_EVENT_TYPE in @estalara/shared.
    event_type: INTENT_SNAPSHOT_EVENT_TYPE,
    archetype_deltas,
    // CB-2 fix: 0.0 sentinel — IntentSnapshotPayload carries no confidence_before field.
    // Float32 NOT NULL column cannot accept null in JSONEachRow (would reject the entire row).
    confidence_before: 0.0,
    confidence_after: event.payload.confidence,
    top_archetype: event.payload.archetype,
    event_payload,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-ndjson',
  };
  if (env.CLICKHOUSE_USER && env.CLICKHOUSE_PASSWORD) {
    const auth = btoa(`${env.CLICKHOUSE_USER}:${env.CLICKHOUSE_PASSWORD}`);
    headers.Authorization = `Basic ${auth}`;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, 4000);
    const response = await fetchImpl(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(row),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (response.ok) {
      return { ok: true };
    }
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 300);
    } catch {
      // body read failed; status alone is enough signal
    }
    const error = `clickhouse_intent_events_status_${String(response.status)}${detail ? `:${detail}` : ''}`;
    logger.error({ session_id: event.session_id, error }, 'intent_snapshot_clickhouse_failed');
    return { ok: false, error };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : 'fetch_failed';
    logger.error({ session_id: event.session_id, error }, 'intent_snapshot_clickhouse_failed');
    return { ok: false, error };
  }
}

/**
 * UPSERT one row into Supabase `intent_sessions` via PostgREST.
 *
 * Uses a PostgREST upsert with `?on_conflict=tenant_id,session_id` as a URL query
 * parameter (CB-1 fix, FOLLOW-286) and `Prefer: resolution=merge-duplicates,return=minimal`
 * as a header. The conflict target MUST be a URL param — PostgREST does NOT parse it from
 * the Prefer header.
 *
 * On conflict the row is updated with the latest snapshot values. `started_at` is NOT
 * included in the update column set — PostgREST `merge-duplicates` updates all writable
 * columns, so we exclude `started_at` from the row body on re-upserts. Since the row body
 * always includes `started_at` on INSERT (first snapshot), and PostgREST only updates
 * columns present in the POST body, we could omit it. However, the simpler correct
 * approach is: we include `started_at` in the body (PostgREST sets it on INSERT), and
 * `merge-duplicates` will NOT overwrite `started_at` on conflict because the column is
 * in the body — see AC5 trade-off: for now we accept that started_at is overwritten on
 * re-upsert with the same value (same session_id → same original start time from the SDK).
 * This is semantically safe because the SDK ts on the first snapshot IS the session start.
 *
 * signal_count is set from the SDK payload, which carries the cumulative count. This is
 * semantically correct: the SDK is the authoritative counter and the payload value IS the
 * running total on every snapshot.
 *
 * Fire-and-forget — does NOT throw.
 *
 * @internal exported for tests
 */
export async function upsertIntentSessionToSupabase(
  event: IntentSnapshotEvent,
  env: IntentSnapshotEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; error?: string }> {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    logger.warn(
      { session_id: event.session_id },
      'intent_snapshot_supabase_skipped: SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured',
    );
    return { ok: true };
  }

  // CB-1 fix (FOLLOW-286): on_conflict MUST be a URL query parameter, NOT in the Prefer header.
  // PostgREST only reads the conflict target from the query string. When it was in the Prefer
  // header, PostgREST ignored it and the 2nd+ snapshot hit the UNIQUE constraint → 409 silently
  // discarded by Promise.allSettled, freezing the intent_sessions row at first-snapshot state.
  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/intent_sessions?on_conflict=tenant_id%2Csession_id`;
  const startedAt = new Date(event.ts).toISOString();
  const lastEventAt = new Date(event.ts).toISOString();

  // intent_state stores the full probability distribution (not PII — no chat content).
  const intentState = JSON.stringify(event.payload.probabilities);

  const row = {
    tenant_id: event.tenant_id,
    session_id: event.session_id,
    cross_session_id: event.cross_session_id ?? null,
    started_at: startedAt,
    last_event_at: lastEventAt,
    signal_count: event.payload.signal_count,
    quiz_completed: event.payload.quiz_completed,
    quiz_leaf: event.payload.quiz_leaf ?? null,
    chat_turns: event.payload.chat_turns,
    intent_state: intentState,
  };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, 4000);
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        // CB-1 fix: on_conflict is a URL query param (above), NOT here.
        // Prefer header carries only resolution and return directives.
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(row),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (response.ok || response.status === 201) {
      return { ok: true };
    }
    let detail = '';
    try {
      detail = (await response.text()).slice(0, 300);
    } catch {
      // body read failed; status alone is enough signal
    }
    const error = `supabase_intent_sessions_status_${String(response.status)}${detail ? `:${detail}` : ''}`;
    logger.error({ session_id: event.session_id, error }, 'intent_snapshot_supabase_failed');
    return { ok: false, error };
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : 'fetch_failed';
    logger.error({ session_id: event.session_id, error }, 'intent_snapshot_supabase_failed');
    return { ok: false, error };
  }
}

/**
 * Handle one validated `intent.snapshot` event.
 *
 * Dual-writes in parallel (Promise.allSettled) to:
 *   1. ClickHouse `intent_events` — INSERT the granular event row (append-only).
 *      `session_id` (String column, migration 0015) carries the raw session fingerprint
 *      for FOLLOW-269 join. `intent_session_id` (ORDER BY key, now String after migration 0016)
 *      also carries the raw value. `event_type` is pinned to `INTENT_SNAPSHOT_EVENT_TYPE`.
 *      `confidence_before` is 0.0 (Float32 NOT NULL; no prior confidence on first snapshot).
 *   2. Supabase `intent_sessions` — UPSERT the mutable session-level summary row.
 *      Conflict target `(tenant_id, session_id)` is passed as a URL query parameter
 *      (`?on_conflict=tenant_id,session_id`) so PostgREST correctly routes to UPDATE
 *      instead of INSERT on 2nd+ snapshot per session.
 *
 * Both writes are fire-and-forget: ingest ACK is returned to the SDK regardless of
 * whether either write succeeds. Promise.allSettled rejections are surfaced via console.error
 * AND the structured logger so they are visible in CF Worker logs and Sentry (Rule K.2 / DG-1).
 *
 * Callers MUST pass `ctx.waitUntil(handleIntentSnapshot(...))` in CF Workers so the
 * writes complete before the Worker process exits.
 */
export async function handleIntentSnapshot(
  event: IntentSnapshotEvent,
  env: IntentSnapshotEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  // Pass raw session_id (not a derived UUID) so FOLLOW-269 can join:
  //   intent_events.session_id = intent_sessions.session_id (+ tenant_id).
  const [chResult, pgResult] = await Promise.allSettled([
    insertIntentEventToClickHouse(event, event.session_id, env, fetchImpl),
    upsertIntentSessionToSupabase(event, env, fetchImpl),
  ]);

  // DG-1 fix (FOLLOW-287): inspect Promise.allSettled results and surface all rejections
  // via console.error (visible in Cloudflare Worker logs and Sentry) so operators can observe
  // degraded state (Rule K.2). Both the structured logger AND console.error are emitted so
  // the failure is visible in both the JSON log stream and the raw CF Worker log tail.
  if (chResult.status === 'rejected') {
    const reason = String(chResult.reason);
    console.error(
      JSON.stringify({
        event: 'intent_snapshot_clickhouse_rejected',
        tenant_id: event.tenant_id,
        session_id: event.session_id,
        error: reason,
      }),
    );
    logger.error(
      { tenant_id: event.tenant_id, session_id: event.session_id, reason },
      'intent_snapshot_clickhouse_rejected',
    );
    // FOLLOW-449: an unexpected synchronous throw out of insertIntentEventToClickHouse
    // (it otherwise always resolves — this branch is a defensive backstop) must still
    // be observable, not just console/pino.
    Sentry.captureException(new Error(`intent_snapshot_clickhouse_rejected: ${reason}`), {
      tags: { area: 'intent-snapshot', sink: 'clickhouse', kind: 'network' },
      extra: { tenant_id: event.tenant_id, session_id: event.session_id, unexpected: true },
    });
  } else if (!chResult.value.ok) {
    console.error(
      JSON.stringify({
        event: 'intent_snapshot_clickhouse_write_failed',
        tenant_id: event.tenant_id,
        session_id: event.session_id,
        error: chResult.value.error,
      }),
    );
    logger.error(
      { tenant_id: event.tenant_id, session_id: event.session_id, error: chResult.value.error },
      'intent_snapshot_clickhouse_write_failed',
    );
    // FOLLOW-449 (Rule K.2 fire-and-forget amendment, RETRO-135 §6): `fetch` resolves
    // (does not reject) on an HTTP 4xx/5xx, so a `.catch()`-only handler is blind to a
    // ClickHouse SCHEMA/column-drift rejection — the exact ESC-031/F-02 failure mode
    // (migration not yet applied to prod -> every insert silently 4xx'd, count() stayed 0).
    // `insertIntentEventToClickHouse` already checks `response.ok`; this call makes that
    // HTTP-level rejection observable in Sentry, not just CF Worker logs.
    const isHttpRejection = (chResult.value.error ?? '').includes(
      'clickhouse_intent_events_status_',
    );
    Sentry.captureException(
      new Error(`intent_snapshot_clickhouse_write_failed: ${chResult.value.error ?? 'unknown'}`),
      {
        tags: {
          area: 'intent-snapshot',
          sink: 'clickhouse',
          kind: isHttpRejection ? 'insert_rejected' : 'network',
        },
        extra: { tenant_id: event.tenant_id, session_id: event.session_id },
      },
    );
  }

  if (pgResult.status === 'rejected') {
    const reason = String(pgResult.reason);
    console.error(
      JSON.stringify({
        event: 'intent_snapshot_supabase_rejected',
        tenant_id: event.tenant_id,
        session_id: event.session_id,
        error: reason,
      }),
    );
    logger.error(
      { tenant_id: event.tenant_id, session_id: event.session_id, reason },
      'intent_snapshot_supabase_rejected',
    );
    Sentry.captureException(new Error(`intent_snapshot_supabase_rejected: ${reason}`), {
      tags: { area: 'intent-snapshot', sink: 'supabase', kind: 'network' },
      extra: { tenant_id: event.tenant_id, session_id: event.session_id, unexpected: true },
    });
  } else if (!pgResult.value.ok) {
    console.error(
      JSON.stringify({
        event: 'intent_snapshot_supabase_write_failed',
        tenant_id: event.tenant_id,
        session_id: event.session_id,
        error: pgResult.value.error,
      }),
    );
    logger.error(
      { tenant_id: event.tenant_id, session_id: event.session_id, error: pgResult.value.error },
      'intent_snapshot_supabase_write_failed',
    );
    const isHttpRejection = (pgResult.value.error ?? '').includes(
      'supabase_intent_sessions_status_',
    );
    Sentry.captureException(
      new Error(`intent_snapshot_supabase_write_failed: ${pgResult.value.error ?? 'unknown'}`),
      {
        tags: {
          area: 'intent-snapshot',
          sink: 'supabase',
          kind: isHttpRejection ? 'insert_rejected' : 'network',
        },
        extra: { tenant_id: event.tenant_id, session_id: event.session_id },
      },
    );
  }
}
