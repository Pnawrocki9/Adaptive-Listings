/**
 * Live session (live.signup) events. Master Design C.1 / CEO Decision D-4 (2026-05-30).
 *
 * `live.signup` is the PRIMARY pilot conversion event (alongside `chat.contact_initiated`).
 * Ratified in Master_Design v3.7: users who book a live session slot on a listing page are
 * the canonical positive outcome signal for Thompson sampling in the bandit feedback loop.
 *
 * SCHEMA-001 (FOLLOW-195). Producer: Estalara-app LiveSessions.svelte (FOLLOW-196 — sdk-engineer).
 * Consumer: SDK `registerFeedbackListener` default in packages/sdk/src/core/adapt.ts (this PR).
 *
 * Throughput: 0–1 per session (a buyer books at most one live slot per session).
 * SDK flushes this immediately (same priority as inquiry.completed).
 *
 * Rule H deferral: the CustomEvent producer in Estalara-app LiveSessions.svelte is FOLLOW-196
 * (sdk-engineer, Sprint 15 Week 2). The consumer wired in this PR is the
 * `registerFeedbackListener` default in adapt.ts. See backlog/HANDOFFS.md for the handoff note.
 *
 * @module @estalara/shared/schemas/events/live
 */

import { z } from 'zod';

import { EventEnvelopeBaseSchema } from '../event.js';

/**
 * `live.signup` payload — buyer booked a live session slot on a listing page.
 *
 * PII note: buyer name / contact details MUST NOT appear in this payload — they are captured by
 * the tenant's booking system. Only the slot identifier and source surface are recorded.
 *
 * @example
 * {
 *   type: 'live.signup',
 *   payload: {
 *     slot_uuid: '01928f00-7000-7000-8000-aaaaaaaaaa01',
 *     slot_label: '2026-06-15T14:00:00Z',
 *     source_surface: 'listing_detail'
 *   }
 * }
 */
export const LiveSignupPayloadSchema = z.object({
  /**
   * UUID of the live session slot the buyer booked. Provided by the tenant's booking system.
   * Must be a valid UUID so it can be joined to the tenant's slot table later.
   */
  slot_uuid: z.string().uuid(),

  /**
   * Human-readable label for the slot (ISO 8601 datetime or free text). Optional.
   * Never contains PII. Used only for debug / observability.
   */
  slot_label: z.string().min(1).max(64).optional(),

  /**
   * UI surface from which the buyer triggered the booking.
   * Allows A/B attribution (e.g. "listing_detail" vs "sidebar_widget").
   */
  source_surface: z
    .enum(['listing_detail', 'sidebar_widget', 'search_card', 'email_link', 'other'])
    .optional(),
});

export const LiveSignupEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('live.signup'),
  payload: LiveSignupPayloadSchema,
});

export type LiveSignupEvent = z.infer<typeof LiveSignupEventSchema>;
export type LiveSignupPayload = z.infer<typeof LiveSignupPayloadSchema>;
