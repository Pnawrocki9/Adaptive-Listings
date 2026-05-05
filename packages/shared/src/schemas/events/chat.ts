/**
 * Chat (NLP target) events. Master Design C.1 row 7 + C.3.
 *
 * Throughput: 0–30 per session. `chat.intent.detected` is server-side, NOT emitted by the SDK
 * (the intent engine writes it after Haiku 4.5 NLP extraction).
 *
 * @module @estalara/shared/schemas/events/chat
 */

import { z } from 'zod';

import { EventEnvelopeBaseSchema } from '../event.js';

/**
 * `chat.opened` — user opened the chat widget.
 *
 * @example { type: 'chat.opened', payload: { trigger: 'cta_click' } }
 */
export const ChatOpenedPayloadSchema = z.object({
  trigger: z.enum(['cta_click', 'auto_prompt', 'inline_link']).optional(),
});
export const ChatOpenedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('chat.opened'),
  payload: ChatOpenedPayloadSchema,
});
export type ChatOpenedEvent = z.infer<typeof ChatOpenedEventSchema>;

/**
 * `chat.message.sent` — buyer-authored message in the chat. Triggers real-time intent extraction
 * (target latency < 500ms per Master Design C.3).
 *
 * @example
 * {
 *   type: 'chat.message.sent',
 *   payload: { message: 'Looking for 3-bed near international school', char_count: 41, locale: 'en-GB' }
 * }
 */
export const ChatMessageSentPayloadSchema = z.object({
  message: z.string().min(1).max(4000),
  char_count: z.number().int().nonnegative().optional(),
  locale: z.string().min(2).max(10).optional(),
});
export const ChatMessageSentEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('chat.message.sent'),
  payload: ChatMessageSentPayloadSchema,
});
export type ChatMessageSentEvent = z.infer<typeof ChatMessageSentEventSchema>;

/**
 * `chat.intent.detected` — **server-side** annotation. The intent engine writes this after running
 * NLP on a `chat.message.sent`. SDK MUST NOT emit this. Mirrors the 12 intent dimensions described
 * in Master Design D.4.
 *
 * @example
 * {
 *   type: 'chat.intent.detected',
 *   payload: { dimensions: { budget_signal: 0.8, urgency: 0.5 }, confidence: 0.74, model: 'claude-haiku-4-5' }
 * }
 */
export const ChatIntentDetectedPayloadSchema = z.object({
  dimensions: z.record(z.number().min(-1).max(1)),
  confidence: z.number().min(0).max(1),
  model: z.string().min(1).optional(),
  source_event_id: z.string().uuid().optional(),
});
export const ChatIntentDetectedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('chat.intent.detected'),
  payload: ChatIntentDetectedPayloadSchema,
});
export type ChatIntentDetectedEvent = z.infer<typeof ChatIntentDetectedEventSchema>;
