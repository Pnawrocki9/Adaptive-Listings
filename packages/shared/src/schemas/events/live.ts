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
   * Optional — some tenant integrations may not always provide this (e.g. booking confirmed
   * asynchronously). When absent, use adapt_decision_id for conversion attribution.
   * FOLLOW-258 F-04: made optional to stop 100% event loss when tenant omits it.
   */
  slot_uuid: z.string().uuid().optional(),

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

  /**
   * SDK-derived hashed buyer identifier. Links this conversion to a session.
   * Derived from user_uuid via SHA-256 (Rule L — raw user_uuid never stored).
   * FOLLOW-258 F-03: added to stop lead_id being stripped by Zod.
   */
  lead_id: z.string().optional(),

  /**
   * adapt_decision_id from the most recent /api/adapt response at booking time.
   * Enables attribution: which adaptation decision drove this conversion?
   * FOLLOW-258 F-04: threading adapt response for conversion attribution when slot_uuid absent.
   */
  adapt_decision_id: z.string().uuid().optional(),
});

export const LiveSignupEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('live.signup'),
  payload: LiveSignupPayloadSchema,
});

export type LiveSignupEvent = z.infer<typeof LiveSignupEventSchema>;
export type LiveSignupPayload = z.infer<typeof LiveSignupPayloadSchema>;
