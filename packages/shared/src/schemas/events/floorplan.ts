/**
 * Floorplan engagement events. Master Design C.1 row 4.
 *
 * Throughput: 0–20 per session (skewed — many sessions never open the floorplan).
 *
 * @module @estalara/shared/schemas/events/floorplan
 */

import { z } from 'zod';

import { EventEnvelopeSchema } from '../event.js';

/**
 * `floorplan.opened` — floorplan modal / inline view shown for the first time in a session.
 *
 * @example { type: 'floorplan.opened', payload: { source: 'gallery_button' } }
 */
export const FloorplanOpenedPayloadSchema = z.object({
  source: z.enum(['gallery_button', 'inline_link', 'sidebar', 'auto']).optional(),
});
export const FloorplanOpenedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal('floorplan.opened'),
  payload: FloorplanOpenedPayloadSchema,
});
export type FloorplanOpenedEvent = z.infer<typeof FloorplanOpenedEventSchema>;

/**
 * `floorplan.zoom` — user zoomed into the floorplan.
 *
 * @example { type: 'floorplan.zoom', payload: { zoom_level: 1.8 } }
 */
export const FloorplanZoomPayloadSchema = z.object({
  zoom_level: z.number().positive(),
});
export const FloorplanZoomEventSchema = EventEnvelopeSchema.extend({
  type: z.literal('floorplan.zoom'),
  payload: FloorplanZoomPayloadSchema,
});
export type FloorplanZoomEvent = z.infer<typeof FloorplanZoomEventSchema>;

/**
 * `floorplan.dwell` — user spent ≥3s with the floorplan open before closing.
 *
 * @example { type: 'floorplan.dwell', payload: { dwell_ms: 8200 } }
 */
export const FloorplanDwellPayloadSchema = z.object({
  dwell_ms: z.number().int().nonnegative(),
});
export const FloorplanDwellEventSchema = EventEnvelopeSchema.extend({
  type: z.literal('floorplan.dwell'),
  payload: FloorplanDwellPayloadSchema,
});
export type FloorplanDwellEvent = z.infer<typeof FloorplanDwellEventSchema>;
