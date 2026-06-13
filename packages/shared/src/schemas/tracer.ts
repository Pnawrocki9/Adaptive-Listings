/**
 * K.3.6 Archetype Identification Tracer — shared response schemas.
 *
 * Canonical types for FOLLOW-267 admin API routes and the /api/intent/config
 * SDK-facing route. Imported by the route handlers and any non-test consumer
 * (Rule H: schema must have a production consumer in the same PR).
 *
 * Non-test consumers in this PR:
 *   - apps/control-plane/src/app/api/admin/tracer/sessions/route.ts
 *   - apps/control-plane/src/app/api/admin/tracer/sessions/[id]/route.ts
 *   - apps/control-plane/src/app/api/admin/tracer/sessions/[id]/stream/route.ts
 *   - apps/control-plane/src/app/api/admin/tracer/history/route.ts
 *   - apps/control-plane/src/app/api/admin/tracer/history/[session_id]/route.ts
 *   - apps/control-plane/src/app/api/admin/tracer/export/decisions/route.ts
 *   - apps/control-plane/src/app/api/admin/tracer/export/events/route.ts
 *   - apps/control-plane/src/app/api/intent/config/route.ts
 *
 * @module @estalara/shared/schemas/tracer
 */

import { z } from 'zod';

// ─── IntentSession row (Postgres intent_sessions) ────────────────────────────

/**
 * Shape of one row in the `intent_sessions` Postgres table as returned by the
 * admin tracer API. Field names match the Drizzle schema camelCase convention
 * (converted from snake_case column names by the Drizzle select).
 */
export const IntentSessionRowSchema = z.object({
  /** Raw session fingerprint (SHA-256 hex). Join key with ClickHouse intent_events. */
  session_id: z.string(),
  /** Tenant UUID. */
  tenant_id: z.string(),
  /** Cumulative number of signals processed for this session. */
  signal_count: z.number().int(),
  /**
   * Leading archetype after the most recent signal. Null until the first signal
   * is processed. Sourced from intent_state JSONB topArchetype field.
   */
  top_archetype: z.string().nullable(),
  /** Confidence score in [0, 1] for top_archetype. Null until first signal. */
  confidence: z.number().min(0).max(1).nullable(),
  /** When the most recent signal arrived (ISO 8601 UTC string). */
  last_event_at: z.string(),
  /** True when the quiz widget reached a leaf node this session. */
  quiz_completed: z.boolean(),
  /** Count of buyer chat turns observed this session. */
  chat_turns: z.number().int(),
});

export type IntentSessionRow = z.infer<typeof IntentSessionRowSchema>;

// ─── Response for AC1: GET /api/admin/tracer/sessions ────────────────────────

export const TracerSessionsResponseSchema = z.object({
  sessions: z.array(IntentSessionRowSchema),
  data_source: z.enum(['live', 'mock']),
});

export type TracerSessionsResponse = z.infer<typeof TracerSessionsResponseSchema>;

// ─── IntentEvent row (ClickHouse intent_events) ──────────────────────────────

/**
 * Shape of one row from the ClickHouse `intent_events` table as returned by
 * the admin tracer API.
 *
 * Column mapping (post-FOLLOW-287 fixes):
 *   - join key: session_id (String, migration 0015 ADD COLUMN)
 *   - intent_session_id: ORDER BY key (UUID zero-default, NOT used as join key)
 *   - event_at: DateTime64(3, 'UTC') formatted as ISO 8601 string
 *   - archetype_deltas: JSON string { archetype -> delta }
 *   - event_payload: JSON string, PII-free
 */
export const IntentEventRowSchema = z.object({
  /** Raw session fingerprint — join key with intent_sessions.session_id. */
  session_id: z.string(),
  /** Tenant UUID. */
  tenant_id: z.string(),
  /** When this signal was processed (ISO 8601 UTC string). */
  event_at: z.string(),
  /**
   * Signal type:
   * 'intent.snapshot' | 'quiz_answer' | 'chat_turn' | 'behavioral' |
   * 'dwell' | 'pageview' | 'referrer' | 'finalized'
   */
  event_type: z.string(),
  /** JSON string: { archetype -> weight delta } for this signal. */
  archetype_deltas: z.string(),
  /** Confidence before this signal was applied. */
  confidence_before: z.number(),
  /** Confidence after this signal was applied. */
  confidence_after: z.number(),
  /** Leading archetype after this signal. */
  top_archetype: z.string(),
  /** PII-free snapshot of raw signal inputs (content varies by event_type). */
  event_payload: z.string(),
});

export type IntentEventRow = z.infer<typeof IntentEventRowSchema>;

// ─── Response for AC2: GET /api/admin/tracer/sessions/[id] ──────────────────

export const TracerSessionDetailResponseSchema = z.object({
  session: IntentSessionRowSchema,
  events: z.array(IntentEventRowSchema),
  data_source: z.enum(['live', 'mock', 'clickhouse_unavailable']),
});

export type TracerSessionDetailResponse = z.infer<typeof TracerSessionDetailResponseSchema>;

// ─── Response for AC4: GET /api/admin/tracer/history ────────────────────────

export const TracerHistoryResponseSchema = z.object({
  events: z.array(IntentEventRowSchema),
  total: z.number().int(),
  limit: z.number().int(),
  offset: z.number().int(),
  data_source: z.enum(['live', 'mock']),
});

export type TracerHistoryResponse = z.infer<typeof TracerHistoryResponseSchema>;

// ─── Response for AC5: GET /api/admin/tracer/history/[session_id] ────────────

export const TracerSessionReplayResponseSchema = z.object({
  session: IntentSessionRowSchema.nullable(),
  events: z.array(IntentEventRowSchema),
  data_source: z.enum(['live', 'mock', 'clickhouse_unavailable']),
});

export type TracerSessionReplayResponse = z.infer<typeof TracerSessionReplayResponseSchema>;

// ─── Response for AC8: GET /api/intent/config ────────────────────────────────

export const IntentConfigResponseSchema = z.object({
  /** Signal weight configuration object (opaque — schema evolves independently). */
  weights: z.record(z.unknown()),
  /** ISO 8601 UTC string of when this config row was created (effective_at). */
  effective_at: z.string(),
  /** Whether this is a tenant-specific config (true) or the global default (false). */
  is_tenant_specific: z.boolean(),
  /** Provenance flag per Rule K.2. */
  data_source: z.enum(['live', 'mock']),
});

export type IntentConfigResponse = z.infer<typeof IntentConfigResponseSchema>;
