/**
 * Inquiry / conversion events. Master Design C.1 row 9. Highest-value events for the funnel —
 * SDK flushes these immediately rather than batching every 2s.
 *
 * Throughput: 0–3 per session.
 *
 * @module @estalara/shared/schemas/events/inquiry
 */

import { z } from 'zod';

import { EventEnvelopeBaseSchema } from '../event.js';

/**
 * `inquiry.started` — user opened the contact / inquiry form.
 *
 * @example { type: 'inquiry.started', payload: { form_variant: 'contact_v2' } }
 */
export const InquiryStartedPayloadSchema = z.object({
  form_variant: z.string().optional(),
});
export const InquiryStartedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('inquiry.started'),
  payload: InquiryStartedPayloadSchema,
});
export type InquiryStartedEvent = z.infer<typeof InquiryStartedEventSchema>;

/**
 * `inquiry.completed` — user submitted the contact / inquiry form. Conversion event.
 *
 * Personally-identifying fields (name/email/phone) are NEVER part of the payload — they go to
 * the tenant's own CRM via a separate channel. This payload only captures aggregate signals
 * (whether contact details were filled, channel preference, budget hint, timeline hint).
 *
 * @example { type: 'inquiry.completed', payload: { channel: 'email', has_phone: true, budget_hint: '300k-500k', timeline: '0-3m' } }
 */
export const InquiryCompletedPayloadSchema = z.object({
  channel: z.enum(['email', 'phone', 'whatsapp', 'sms', 'in_person']).optional(),
  has_phone: z.boolean().optional(),
  budget_hint: z.string().optional(),
  timeline: z.enum(['0-3m', '3-6m', '6-12m', '12m+']).optional(),
  message_length: z.number().int().nonnegative().optional(),
});
export const InquiryCompletedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('inquiry.completed'),
  payload: InquiryCompletedPayloadSchema,
});
export type InquiryCompletedEvent = z.infer<typeof InquiryCompletedEventSchema>;

/**
 * `tour.requested` — user requested a property viewing / virtual tour.
 *
 * @example { type: 'tour.requested', payload: { mode: 'in_person', requested_date: '2026-05-15' } }
 */
export const TourRequestedPayloadSchema = z.object({
  mode: z.enum(['in_person', 'virtual', 'video_call']),
  requested_date: z.string().optional(),
});
export const TourRequestedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('tour.requested'),
  payload: TourRequestedPayloadSchema,
});
export type TourRequestedEvent = z.infer<typeof TourRequestedEventSchema>;
