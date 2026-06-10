/**
 * Session quality / DQS (Detection Quality Score) events. TICKET-DQS-001.
 *
 * Emitted periodically (every 5th archetype update + on session end) by the SDK's
 * DqsTracker. Forwarded to ClickHouse `session_quality` table for offline analysis.
 *
 * Throughput: ~1–5 per session.
 *
 * @module @estalara/shared/schemas/events/session-quality
 */

import { z } from 'zod';

import { EventEnvelopeBaseSchema } from '../event.js';

/**
 * `session.quality.snapshot` — periodic convergence metrics for a session.
 *
 * @example
 * {
 *   type: 'session.quality.snapshot',
 *   payload: {
 *     session_id: 'a'.repeat(64),
 *     prediction_stability_score: 0.8,
 *     convergence_time_events: 5,
 *     signal_density_per_min: 3.0,
 *     final_archetype: 'family_buyer',
 *     final_confidence: 0.72,
 *     total_events: 10
 *   }
 * }
 */
export const SessionQualitySnapshotPayloadSchema = z.object({
  /** Session fingerprint — mirrors envelope session_id for self-contained rows in ClickHouse. */
  session_id: z.string(),
  /** Fraction of last 5 predictions matching the current archetype. 0.0–1.0. */
  prediction_stability_score: z.number().min(0).max(1),
  /**
   * Total update count at first convergence (3 consecutive identical predictions).
   * Null until convergence is observed.
   */
  convergence_time_events: z.number().int().positive().nullable(),
  /** Count of update() calls in the last 60 seconds, capped at 10. */
  signal_density_per_min: z.number().min(0).max(10),
  /** Most recent archetype prediction. */
  final_archetype: z.string(),
  /** Most recent confidence score. 0.0–1.0. */
  final_confidence: z.number().min(0).max(1),
  /** Total cumulative update() calls for this session. */
  total_events: z.number().int().nonnegative(),
  /**
   * Listing views per minute at snapshot time. 0 until at least 2 views seen.
   * FOLLOW-258 F-03: added to stop listing_view_rate being stripped by Zod.
   */
  listing_view_rate: z.number().min(0).optional(),
});

export const SessionQualitySnapshotEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('session.quality.snapshot'),
  payload: SessionQualitySnapshotPayloadSchema,
});

export type SessionQualitySnapshotEvent = z.infer<typeof SessionQualitySnapshotEventSchema>;
export type SessionQualitySnapshotPayload = z.infer<typeof SessionQualitySnapshotPayloadSchema>;
