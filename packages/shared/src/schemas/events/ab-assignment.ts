/**
 * A/B holdout assignment event. TICKET-AB-001.
 *
 * Emitted once per session when a new A/B group assignment is made.
 * This event is server-side — the Decision API emits it to the ingest
 * pipeline (Redpanda topic `estalara.events`). The SDK MUST NOT emit this.
 *
 * Fair-housing note (binding):
 * Assignment is keyed solely on (tenant_id, session_id) hash. No user
 * characteristic, location, price tier, or archetype is used as input.
 * See backlog/ESCALATIONS.md resolution for TICKET-AB-001.
 *
 * @module @estalara/shared/schemas/events/ab-assignment
 */

import { z } from 'zod';

import { EventEnvelopeBaseSchema } from '../event.js';

/**
 * Payload for `ab.assignment` — emitted when a session is deterministically
 * assigned to the holdout or treatment group.
 *
 * @example
 * {
 *   type: 'ab.assignment',
 *   payload: {
 *     session_id: 'a'.repeat(64),
 *     tenant_id: '550e8400-e29b-41d4-a716-446655440000',
 *     holdout_group: false,
 *     holdout_pct: 0.10,
 *     assigned_at: '2026-05-13T12:00:00.000Z'
 *   }
 * }
 */
export const AbAssignmentPayloadSchema = z.object({
  /** Session fingerprint — mirrors envelope session_id for ClickHouse self-contained rows. */
  session_id: z.string().min(1),

  /** Tenant UUID — mirrors envelope tenant_id. */
  tenant_id: z.string().uuid(),

  /**
   * Whether this session is in the holdout (control) group.
   * true  = holdout — served default (non-personalized) experience.
   * false = treatment — served adapted experience.
   */
  holdout_group: z.boolean(),

  /**
   * The holdout rate configured at the time of assignment (e.g. 0.10 = 10%).
   * Stored for retrospective analysis when the rate is changed mid-experiment.
   */
  holdout_pct: z.number().min(0).max(1),

  /** ISO 8601 timestamp of when the assignment was made. */
  assigned_at: z.string().datetime(),
});

export const AbAssignmentEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('ab.assignment'),
  payload: AbAssignmentPayloadSchema,
});

export type AbAssignmentEvent = z.infer<typeof AbAssignmentEventSchema>;
export type AbAssignmentPayload = z.infer<typeof AbAssignmentPayloadSchema>;
