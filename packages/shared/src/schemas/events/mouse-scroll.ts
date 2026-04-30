/**
 * Mouse and scroll behavioral events. Master Design C.1 row 2.
 *
 * Throughput: 50–500 per session (sampled by SDK to stay within budget).
 *
 * @module @estalara/shared/schemas/events/mouse-scroll
 */

import { z } from 'zod';

import { EventEnvelopeSchema } from '../event.js';

/**
 * `scroll.depth` — emitted at 10/25/50/75/90% scroll depth thresholds.
 *
 * @example { type: 'scroll.depth', payload: { pct: 50, viewport_height: 900, page_height: 4200 } }
 */
export const ScrollDepthPayloadSchema = z.object({
  pct: z.number().min(0).max(100),
  viewport_height: z.number().int().positive().optional(),
  page_height: z.number().int().positive().optional(),
});
export const ScrollDepthEventSchema = EventEnvelopeSchema.extend({
  type: z.literal('scroll.depth'),
  payload: ScrollDepthPayloadSchema,
});
export type ScrollDepthEvent = z.infer<typeof ScrollDepthEventSchema>;

/**
 * `mouse.dwell` — pointer hovered over a tracked element for ≥500ms.
 *
 * @example { type: 'mouse.dwell', payload: { element: 'feature.pool', dwell_ms: 1820 } }
 */
export const MouseDwellPayloadSchema = z.object({
  element: z.string().min(1),
  dwell_ms: z.number().int().nonnegative(),
});
export const MouseDwellEventSchema = EventEnvelopeSchema.extend({
  type: z.literal('mouse.dwell'),
  payload: MouseDwellPayloadSchema,
});
export type MouseDwellEvent = z.infer<typeof MouseDwellEventSchema>;

/**
 * `mouse.rage_click` — ≥3 clicks within 800ms on the same target (frustration signal).
 *
 * @example { type: 'mouse.rage_click', payload: { element: 'cta.contact', click_count: 5 } }
 */
export const MouseRageClickPayloadSchema = z.object({
  element: z.string().min(1),
  click_count: z.number().int().min(3),
});
export const MouseRageClickEventSchema = EventEnvelopeSchema.extend({
  type: z.literal('mouse.rage_click'),
  payload: MouseRageClickPayloadSchema,
});
export type MouseRageClickEvent = z.infer<typeof MouseRageClickEventSchema>;

/**
 * `mouse.exit_intent` — pointer crossed the top edge of the viewport (likely tab close).
 *
 * @example { type: 'mouse.exit_intent', payload: { dwell_ms: 28100 } }
 */
export const MouseExitIntentPayloadSchema = z.object({
  dwell_ms: z.number().int().nonnegative(),
});
export const MouseExitIntentEventSchema = EventEnvelopeSchema.extend({
  type: z.literal('mouse.exit_intent'),
  payload: MouseExitIntentPayloadSchema,
});
export type MouseExitIntentEvent = z.infer<typeof MouseExitIntentEventSchema>;
