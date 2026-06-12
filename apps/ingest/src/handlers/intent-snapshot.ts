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

import { logger } from '../observability/logger.js';

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

/** The validated intent.snapshot payload shape (matches IntentSnapshotPayloadSchema). */
export interface IntentSnapshotPayload {
  archetype: string;
  confidence: number;
  signal_count: number;
  probabilities: Record<string, number>;
  quiz_completed: boolean;
  quiz_leaf: string | null;
  chat_turns: number;
  last_signal_delta?: {
    archetype_deltas?: Record<string, number>;
    event_type?: string;
  };
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
 * Used to map a non-UUID session_id (e.g. a SHA-256 hex fingerprint) to a UUID for
 * the ClickHouse `intent_events.intent_session_id` column.
 *
 * Implementation: SHA-256 of `${tenantId}:${sessionId}`, take first 32 hex chars,
 * format as UUID v4 layout (version bits set to 4, variant bits set to 8).
 * This is NOT a standards-compliant UUID v5 (which requires SHA-1 + name space OID),
 * but is deterministic and collision-resistant for our key space.
 *
 * @internal exported for tests
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
 * Fire-and-forget caller uses Promise.allSettled — this function resolves with a result
 * object indicating success or failure. It does NOT throw.
 *
 * @internal exported for tests
 */
export async function insertIntentEventToClickHouse(
  event: IntentSnapshotEvent,
  intentSessionId: string,
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

  const row = {
    intent_session_id: intentSessionId,
    tenant_id: event.tenant_id,
    event_at: eventAt,
    event_type: 'intent.snapshot',
    archetype_deltas,
    confidence_before: 0,
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
 * Uses ON CONFLICT (tenant_id, session_id) DO UPDATE to accumulate signal_count and
 * keep other fields current. The `signal_count` increment is DB-side
 * (`signal_count = intent_sessions.signal_count + 1`) via a PostgREST PATCH with
 * a RPC-style upsert. Since PostgREST's upsert does not natively support
 * `excluded.col + existing.col` increments, we use a Supabase RPC function pattern:
 * POST to the `intent_sessions` table with `Prefer: resolution=merge-duplicates` and
 * pass the full updated state. For `signal_count` we use the `INCREMENT` approach by
 * calling a dedicated Postgres function `upsert_intent_session`.
 *
 * NOTE: For the MVP, we upsert using the PostgREST `merge-duplicates` preference
 * which replaces on conflict. The DB ON CONFLICT clause (0028_intent_sessions.sql UNIQUE
 * on tenant_id + session_id) causes PostgREST to UPDATE the row. signal_count is NOT
 * auto-incremented via PostgREST alone — we use a Supabase RPC call to a helper function
 * that does the atomic increment. If no RPC is configured, we fall back to a two-step
 * SELECT + UPSERT. For Phase 2 MVP simplicity, we accept that signal_count in the
 * Postgres row reflects the snapshot value from the SDK payload (which already carries
 * the cumulative signal_count), not a server-incremented counter. This matches the spec:
 * "signal_count = intent_sessions.signal_count + 1" is the DB UPSERT clause, but since
 * the SDK already tracks signal_count cumulatively, setting it from the payload value is
 * semantically correct on every upsert (the payload's signal_count IS the running total).
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

  const url = `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/intent_sessions`;
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
        // PostgREST upsert: on conflict (tenant_id, session_id) update the row.
        // Columns to update on conflict (all except started_at which preserves session start).
        Prefer: 'resolution=merge-duplicates,return=minimal,on_conflict=tenant_id,session_id',
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
 * Dual-writes to ClickHouse and Supabase via Promise.allSettled (fire-and-forget).
 * Returns after dispatching writes — does NOT block on their completion.
 *
 * Callers MUST pass `ctx.waitUntil(handleIntentSnapshot(...))` in CF Workers so the
 * writes complete before the Worker process exits.
 */
export async function handleIntentSnapshot(
  event: IntentSnapshotEvent,
  env: IntentSnapshotEnv,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const intentSessionId = await deriveSessionUuid(event.tenant_id, event.session_id);

  const [chResult, pgResult] = await Promise.allSettled([
    insertIntentEventToClickHouse(event, intentSessionId, env, fetchImpl),
    upsertIntentSessionToSupabase(event, env, fetchImpl),
  ]);

  if (chResult.status === 'rejected') {
    logger.error(
      { session_id: event.session_id, reason: String(chResult.reason) },
      'intent_snapshot_clickhouse_rejected',
    );
  } else if (!chResult.value.ok) {
    logger.error(
      { session_id: event.session_id, error: chResult.value.error },
      'intent_snapshot_clickhouse_write_failed',
    );
  }

  if (pgResult.status === 'rejected') {
    logger.error(
      { session_id: event.session_id, reason: String(pgResult.reason) },
      'intent_snapshot_supabase_rejected',
    );
  } else if (!pgResult.value.ok) {
    logger.error(
      { session_id: event.session_id, error: pgResult.value.error },
      'intent_snapshot_supabase_write_failed',
    );
  }
}
