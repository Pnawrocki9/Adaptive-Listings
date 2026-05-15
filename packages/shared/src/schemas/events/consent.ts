/**
 * Consent audit events — TICKET-041 (GDPR/CCPA consent gate).
 *
 * These events are emitted regardless of consent state, as they form the minimum
 * required compliance audit trail. They MUST reach the ingest worker even when
 * consent is denied.
 *
 * Throughput: 1 per session (one decision — granted or denied).
 *
 * @module @estalara/shared/schemas/events/consent
 */

import { z } from 'zod';

import { EventEnvelopeBaseSchema } from '../event.js';

/**
 * `consent.granted` — user clicked "Accept" on the consent banner.
 *
 * @example
 * {
 *   type: 'consent.granted',
 *   payload: { language: 'en', method: 'banner' }
 * }
 */
export const ConsentGrantedPayloadSchema = z.object({
  /** UI language shown to the user when they accepted. */
  language: z.enum(['en', 'pl']),
  /** How consent was obtained. */
  method: z.literal('banner'),
});
export const ConsentGrantedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('consent.granted'),
  payload: ConsentGrantedPayloadSchema,
});
export type ConsentGrantedEvent = z.infer<typeof ConsentGrantedEventSchema>;
export type ConsentGrantedPayload = z.infer<typeof ConsentGrantedPayloadSchema>;

/**
 * `consent.denied` — user clicked "Decline" on the consent banner.
 *
 * @example
 * {
 *   type: 'consent.denied',
 *   payload: { language: 'en', method: 'banner' }
 * }
 */
export const ConsentDeniedPayloadSchema = z.object({
  /** UI language shown to the user when they declined. */
  language: z.enum(['en', 'pl']),
  /** How consent was refused. */
  method: z.literal('banner'),
});
export const ConsentDeniedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('consent.denied'),
  payload: ConsentDeniedPayloadSchema,
});
export type ConsentDeniedEvent = z.infer<typeof ConsentDeniedEventSchema>;
export type ConsentDeniedPayload = z.infer<typeof ConsentDeniedPayloadSchema>;
