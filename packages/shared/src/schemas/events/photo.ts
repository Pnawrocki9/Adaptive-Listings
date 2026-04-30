/**
 * Photo interaction events. Master Design C.1 row 3.
 *
 * Throughput: 10–100 per session.
 *
 * @module @estalara/shared/schemas/events/photo
 */

import { z } from 'zod';

import { EventEnvelopeSchema } from '../event.js';

/**
 * `photo.opened` — gallery / lightbox opened on a specific photo.
 *
 * @example { type: 'photo.opened', payload: { photo_id: 'p_42', position: 0, total: 24 } }
 */
export const PhotoOpenedPayloadSchema = z.object({
  photo_id: z.string().min(1),
  position: z.number().int().nonnegative(),
  total: z.number().int().positive().optional(),
  category: z.string().optional(),
});
export const PhotoOpenedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal('photo.opened'),
  payload: PhotoOpenedPayloadSchema,
});
export type PhotoOpenedEvent = z.infer<typeof PhotoOpenedEventSchema>;

/**
 * `photo.gallery.next` — user navigated to the next photo in the gallery.
 *
 * @example { type: 'photo.gallery.next', payload: { from_photo_id: 'p_42', to_photo_id: 'p_43', direction: 'forward' } }
 */
export const PhotoGalleryNextPayloadSchema = z.object({
  from_photo_id: z.string().min(1),
  to_photo_id: z.string().min(1),
  direction: z.enum(['forward', 'backward']).optional(),
});
export const PhotoGalleryNextEventSchema = EventEnvelopeSchema.extend({
  type: z.literal('photo.gallery.next'),
  payload: PhotoGalleryNextPayloadSchema,
});
export type PhotoGalleryNextEvent = z.infer<typeof PhotoGalleryNextEventSchema>;

/**
 * `photo.zoomed` — user zoomed into a photo (pinch / scroll-wheel / button).
 *
 * @example { type: 'photo.zoomed', payload: { photo_id: 'p_42', zoom_level: 2.5 } }
 */
export const PhotoZoomedPayloadSchema = z.object({
  photo_id: z.string().min(1),
  zoom_level: z.number().positive(),
});
export const PhotoZoomedEventSchema = EventEnvelopeSchema.extend({
  type: z.literal('photo.zoomed'),
  payload: PhotoZoomedPayloadSchema,
});
export type PhotoZoomedEvent = z.infer<typeof PhotoZoomedEventSchema>;

/**
 * `photo.dwell` — user spent ≥1.5s on a single photo before navigating away.
 *
 * @example { type: 'photo.dwell', payload: { photo_id: 'p_42', dwell_ms: 4200 } }
 */
export const PhotoDwellPayloadSchema = z.object({
  photo_id: z.string().min(1),
  dwell_ms: z.number().int().nonnegative(),
  category: z.string().optional(),
});
export const PhotoDwellEventSchema = EventEnvelopeSchema.extend({
  type: z.literal('photo.dwell'),
  payload: PhotoDwellPayloadSchema,
});
export type PhotoDwellEvent = z.infer<typeof PhotoDwellEventSchema>;
