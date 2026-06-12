/**
 * `intent.snapshot` event — K.3.6 Archetype Identification Tracer periodic snapshot.
 *
 * Emitted by the SDK's intent engine every 5 signal updates OR on `window.beforeunload`.
 * The CF Worker ingest handler dual-writes this event to:
 *   1. ClickHouse `intent_events` (append-only event trail for ML training + replay)
 *   2. Supabase `intent_sessions` (mutable session-level summary via UPSERT)
 *
 * Privacy: `probabilities` (the full archetype weight map) is stored in Supabase
 * `intent_sessions.intent_state` as session state, NOT in ClickHouse `event_payload`
 * (which is PII-scrubbed). Chat content is never included in any server-side event.
 *
 * Throughput: ~1–10 per session (every 5 signals + unload).
 *
 * @module @estalara/shared/schemas/events/intent-snapshot
 */

import { z } from 'zod';

import { EventEnvelopeBaseSchema } from '../event.js';

/**
 * Canonical `event_type` string written to ClickHouse `intent_events` for snapshot rows.
 *
 * This constant is shared between the ingest CF Worker handler
 * (`apps/ingest/src/handlers/intent-snapshot.ts`) and this schema module to ensure
 * both sides never diverge. The ClickHouse `intent_events` table uses a
 * `LowCardinality(String)` column — the DDL vocabulary is documented in
 * `infra/clickhouse/migrations/0014_intent_events.sql` and extended by
 * `0015_intent_events_session_id_fix.sql` to include this value.
 *
 * FOLLOW-286 fix (LG-1): previously hardcoded as the string `'intent.snapshot'` in the
 * handler, making it impossible for a DDL vocab grep to confirm parity. Now shared here.
 */
export const INTENT_SNAPSHOT_EVENT_TYPE = 'intent.snapshot' as const;

/**
 * Full `event_type` vocabulary documented in the ClickHouse `intent_events` DDL
 * (`infra/clickhouse/migrations/0014_intent_events.sql` + `0015_intent_events_session_id_fix.sql`).
 *
 * Used by contract tests to assert written values stay within the DDL vocabulary.
 * LowCardinality(String) has no enforced constraint in ClickHouse; this constant
 * is the single source of truth for the expected vocabulary.
 *
 * @internal test-only — no non-test production caller exists (FOLLOW-287 LG-B audit).
 * Do not use this constant in production code paths; it is retained solely for the
 * TG-1 contract tests in apps/ingest/src/handlers/__tests__/intent-snapshot.test.ts.
 */
export const INTENT_EVENTS_VOCABULARY = [
  'quiz_answer',
  'chat_turn',
  'behavioral',
  'dwell',
  'pageview',
  'referrer',
  'finalized',
  INTENT_SNAPSHOT_EVENT_TYPE,
] as const;

/**
 * @internal test-only — see INTENT_EVENTS_VOCABULARY annotation above (FOLLOW-287 LG-B).
 */
export type IntentEventType = (typeof INTENT_EVENTS_VOCABULARY)[number];

/**
 * The per-archetype probability map from the intent engine.
 * Keys are archetype identifiers (e.g. 'family_buyer', 'yield_hunter').
 * Values are floats in [0, 1] that sum to ~1.0.
 */
export const ArchetypeProbabilitiesSchema = z.record(z.string(), z.number().min(0).max(1));
export type ArchetypeProbabilities = z.infer<typeof ArchetypeProbabilitiesSchema>;

/**
 * Delta summary from the last signal processed before this snapshot.
 * Describes how the archetype weights shifted on the most recent signal.
 */
export const LastSignalDeltaSchema = z
  .object({
    /** Map of archetype → weight change (positive = boosted, negative = demoted). */
    archetype_deltas: z.record(z.string(), z.number()).optional(),
    /** Event type of the last signal (e.g. 'chat.message.sent', 'quiz.event'). */
    event_type: z.string().optional(),
  })
  .optional();
export type LastSignalDelta = z.infer<typeof LastSignalDeltaSchema>;

/**
 * Payload for `intent.snapshot` events.
 *
 * @example
 * {
 *   archetype: 'family_buyer',
 *   confidence: 0.74,
 *   signal_count: 10,
 *   probabilities: { family_buyer: 0.74, yield_hunter: 0.12, ... },
 *   quiz_completed: false,
 *   quiz_leaf: null,
 *   chat_turns: 3,
 *   last_signal_delta: { archetype_deltas: { family_buyer: 0.08 }, event_type: 'quiz.event' }
 * }
 */
export const IntentSnapshotPayloadSchema = z.object({
  /** Current top archetype label. */
  archetype: z.string(),
  /** Confidence score for the top archetype. Float in [0, 1]. */
  confidence: z.number().min(0).max(1),
  /** Total number of signals processed in this session so far. */
  signal_count: z.number().int().nonnegative(),
  /**
   * Full archetype probability distribution. Stored server-side in
   * `intent_sessions.intent_state` for session-level state; deliberately
   * excluded from ClickHouse `event_payload` (privacy guard).
   */
  probabilities: ArchetypeProbabilitiesSchema,
  /** Whether the quiz widget has reached a leaf node this session. */
  quiz_completed: z.boolean(),
  /** The leaf archetype from the quiz (null until quiz_completed). */
  quiz_leaf: z.string().nullable(),
  /** Count of buyer chat turns observed this session. */
  chat_turns: z.number().int().nonnegative(),
  /** Delta summary from the last signal before this snapshot. */
  last_signal_delta: LastSignalDeltaSchema,
});

export const IntentSnapshotEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('intent.snapshot'),
  payload: IntentSnapshotPayloadSchema,
});

export type IntentSnapshotPayload = z.infer<typeof IntentSnapshotPayloadSchema>;
export type IntentSnapshotEvent = z.infer<typeof IntentSnapshotEventSchema>;
