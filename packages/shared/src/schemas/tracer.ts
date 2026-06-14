/**
 * K.3.6 Archetype Identification Tracer — shared response schemas.
 *
 * Canonical types for FOLLOW-267 admin API routes and the /api/intent/config
 * SDK-facing route. Imported by the route handlers and any non-test consumer
 * (Rule H: schema must have a production consumer in the same PR).
 *
 * FOLLOW-299 change: IntentConfigResponseSchema.data_source enum widened from
 * ['live', 'mock'] to ['live', 'mock', 'error'] so the SDK (FOLLOW-268-sdk) can
 * safeParse HTTP 500 error bodies and observe the degraded signal (RETRO-070 CB-1).
 * weights/effective_at/is_tenant_specific are now optional to allow safeParse on
 * the error-path body which omits those fields.
 *
 * Non-test consumers:
 *   - apps/control-plane/src/app/api/admin/tracer/sessions/route.ts
 *   - apps/control-plane/src/app/api/admin/tracer/sessions/[id]/route.ts
 *   - apps/control-plane/src/app/api/admin/tracer/sessions/[id]/stream/route.ts
 *   - apps/control-plane/src/app/api/admin/tracer/history/route.ts
 *   - apps/control-plane/src/app/api/admin/tracer/history/[session_id]/route.ts
 *   - apps/control-plane/src/app/api/admin/tracer/export/decisions/route.ts
 *   - apps/control-plane/src/app/api/admin/tracer/export/events/route.ts
 *   - apps/control-plane/src/app/api/intent/config/route.ts
 *   - apps/control-plane/src/app/api/admin/intent/config/route.ts (AdminIntentConfigResponseSchema)
 *   - apps/control-plane/src/app/admin/tracer/weights/page.tsx (AdminIntentConfigResponse type)
 *
 * @module @estalara/shared/schemas/tracer
 */

import { z } from 'zod';

import { IntentWeightsSchema } from './intent-weights.js';

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

// ─── Response for GET /api/admin/intent/config (admin weight read) ───────────

/**
 * Response schema for `GET /api/admin/intent/config` (admin-only, ADR-0013 Contract 2).
 *
 * Returns the currently-active global weight config row with its database `id` included.
 * This is the admin-read counterpart to the SDK-facing `IntentConfigResponseSchema`; they
 * serve different callers with different field sets — `id` is admin-only.
 *
 * Global-only in v1: `tenant_id` is always `null`. A `?tenant_id=` query param returns 400.
 *
 * Nullability contract (ADR-0013 §2):
 *   - `id`:         string UUID when row exists; `null` when no active global row.
 *   - `tenant_id`:  always `null` in v1 (global scope only).
 *   - `is_active`:  `true` when row found; `false` when no row.
 *   - `weights`:    `IntentWeights` when row found; `{}` (empty) when no row.
 *   - `created_at`: ISO 8601 UTC string when row found; `null` when no row.
 *
 * All fields are always present — no field is `undefined`.
 *
 * Non-test consumers:
 *   - apps/control-plane/src/app/api/admin/intent/config/route.ts (GET handler)
 *   - apps/control-plane/src/app/admin/tracer/weights/page.tsx (loadConfig)
 */
export const AdminIntentConfigResponseSchema = z.object({
  /** Database row UUID, or null when no active global row exists. */
  id: z.string().uuid().nullable(),
  /** Always null in v1 (global scope only). */
  tenant_id: z.string().uuid().nullable(),
  /** True when an active row was found. */
  is_active: z.boolean(),
  /** Active weight config. Empty object {} when no row exists. */
  weights: IntentWeightsSchema,
  /** Row creation timestamp (ISO 8601 UTC), or null when no row exists. */
  created_at: z.string().nullable(),
});

export type AdminIntentConfigResponse = z.infer<typeof AdminIntentConfigResponseSchema>;

// ─── Response for AC8: GET /api/intent/config ────────────────────────────────

/**
 * Response schema for `GET /api/intent/config` (SDK-facing weight-config endpoint).
 *
 * `data_source` values (Rule K.2 — provenance flag):
 *   - `'live'`  — active row found in `intent_weight_configs`; weights are real.
 *   - `'mock'`  — DB unconfigured (dev/CI) OR no active row for this tenant.
 *                 SDK MUST treat this as "use internal defaults."
 *   - `'error'` — DB was configured but threw during the weight fetch (HTTP 500).
 *                 SDK MUST treat this as "use internal defaults" for adaptation,
 *                 but MAY branch on `'error'` (vs `'mock'`) for telemetry/logging.
 *                 This value is NEVER silently collapsed into `'mock'` (RETRO-070 CB-1).
 *
 * The `weights` field is ONLY present when `data_source` is `'live'` or `'mock'`.
 * On the error path (`data_source: 'error'`, HTTP 500) the server does NOT emit
 * `weights` — the SDK must use internal defaults. The schema reflects this: `weights`
 * is optional so that `safeParse` succeeds on the error-path body too, enabling
 * the SDK to read `data_source` without crashing.
 *
 * FOLLOW-268-sdk reads this schema directly. Do not narrow `data_source` back to
 * `['live', 'mock']` without coordinating with sdk-engineer.
 *
 * Non-test consumers:
 *   - apps/control-plane/src/app/api/intent/config/route.ts
 *   - FOLLOW-268-sdk (SDK fetch-and-apply path)
 */
export const IntentConfigResponseSchema = z.object({
  /**
   * Signal weight configuration object. Validated against IntentWeightsSchema
   * (ADR-0012 §2) — all sub-fields optional; empty object `{}` is valid and
   * means "use SDK defaults for all parameters".
   *
   * Present on `data_source: 'live'` and `data_source: 'mock'` responses.
   * ABSENT on `data_source: 'error'` responses (HTTP 500) — SDK uses internal defaults.
   */
  weights: IntentWeightsSchema.optional(),
  /** ISO 8601 UTC string of when this config row was created (effective_at). Present on 'live'/'mock'. */
  effective_at: z.string().optional(),
  /** Whether this is a tenant-specific config (true) or the global default (false). Present on 'live'/'mock'. */
  is_tenant_specific: z.boolean().optional(),
  /**
   * Provenance flag per Rule K.2.
   *   'live'  — real row served from Postgres.
   *   'mock'  — no row found or DB unconfigured; SDK uses internal defaults.
   *   'error' — configured DB threw; SDK uses internal defaults but CAN branch for telemetry.
   */
  data_source: z.enum(['live', 'mock', 'error']),
});

export type IntentConfigResponse = z.infer<typeof IntentConfigResponseSchema>;
