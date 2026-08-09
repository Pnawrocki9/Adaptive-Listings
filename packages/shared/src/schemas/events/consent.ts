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
import { QuizLanguageSchema } from '../quiz-config.js';

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
  /**
   * UI language shown to the user when they accepted.
   *
   * Derived from {@link QuizLanguageSchema}, never restated. This field spent its whole life as
   * a hand-written `z.enum(['en', 'pl'])` while the banner shipped THREE locales, so a Spanish
   * visitor's acceptance failed `EventSchema.safeParse` at the ingest boundary and was dropped
   * into `rejected[]` — silently, per-event, with a 200 on the batch (FOLLOW-931 / RETRO-264
   * LG-4). `QUIZ_LANGUAGE_VALUES`'s own docblock had already said it: *"API, dashboard, and SDK
   * must all reference this constant — never repeat the literal set."*
   */
  language: QuizLanguageSchema,
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
  /**
   * UI language shown to the user when they declined.
   *
   * Derived from {@link QuizLanguageSchema}, never restated — see the note on
   * {@link ConsentGrantedPayloadSchema}. **The denial leg is the compliance-load-bearing one:**
   * DPIA §13.1 requires the refusal itself to reach the audit log, and a dropped `consent.denied`
   * means a visitor who said no leaves no record that they were asked.
   */
  language: QuizLanguageSchema,
  /** How consent was refused. */
  method: z.literal('banner'),
});
export const ConsentDeniedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('consent.denied'),
  payload: ConsentDeniedPayloadSchema,
});
export type ConsentDeniedEvent = z.infer<typeof ConsentDeniedEventSchema>;
export type ConsentDeniedPayload = z.infer<typeof ConsentDeniedPayloadSchema>;
