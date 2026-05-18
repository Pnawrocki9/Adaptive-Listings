/**
 * Page lifecycle events. Master Design C.1 row 1.
 *
 * Throughput: 5–15 per session.
 *
 * @module @estalara/shared/schemas/events/page-lifecycle
 */

import { z } from 'zod';

import { EventEnvelopeBaseSchema } from '../event.js';

/** Device form factor inferred client-side from viewport + UA hints. */
export const DeviceClassSchema = z.enum(['mobile', 'tablet', 'desktop']);
export type DeviceClass = z.infer<typeof DeviceClassSchema>;

/** Viewport in CSS pixels. */
export const ViewportSchema = z.object({
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type Viewport = z.infer<typeof ViewportSchema>;

/**
 * `page.view` — emitted on every distinct page navigation.
 *
 * `viewport` is optional: browser SDK collects it via window.innerWidth/innerHeight when
 * available, but non-browser environments (SSR, test harnesses) may omit it.
 * `url` is optional for the same reason — non-browser environments may not have location.href.
 * See RUNTIME_READINESS_AUDIT B3 fix (TICKET-RUNTIME-FIX-003).
 *
 * @example
 * {
 *   type: 'page.view',
 *   payload: {
 *     url: 'https://agencja.com/properties/123',
 *     referrer: 'https://google.com/search',
 *     viewport: { width: 1440, height: 900 },
 *     device_class: 'desktop'
 *   }
 * }
 */
export const PageViewPayloadSchema = z.object({
  url: z.string().url().optional(),
  referrer: z.string().url().optional(),
  viewport: ViewportSchema.optional(),
  device_class: DeviceClassSchema,
});
export const PageViewEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('page.view'),
  payload: PageViewPayloadSchema,
});
export type PageViewEvent = z.infer<typeof PageViewEventSchema>;

/**
 * `page.exit` — emitted when the user leaves a page (beforeunload, pagehide, or SPA route change).
 *
 * @example
 * {
 *   type: 'page.exit',
 *   payload: { url: 'https://agencja.com/properties/123', dwell_ms: 42180, scrolled_max_pct: 78 }
 * }
 */
export const PageExitPayloadSchema = z.object({
  url: z.string().url(),
  dwell_ms: z.number().int().nonnegative(),
  scrolled_max_pct: z.number().min(0).max(100).optional(),
});
export const PageExitEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('page.exit'),
  payload: PageExitPayloadSchema,
});
export type PageExitEvent = z.infer<typeof PageExitEventSchema>;

/**
 * `tab.visible` — Page Visibility API: tab returned to foreground.
 *
 * @example { type: 'tab.visible', payload: { hidden_for_ms: 12500 } }
 */
export const TabVisiblePayloadSchema = z.object({
  hidden_for_ms: z.number().int().nonnegative().optional(),
});
export const TabVisibleEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('tab.visible'),
  payload: TabVisiblePayloadSchema,
});
export type TabVisibleEvent = z.infer<typeof TabVisibleEventSchema>;

/**
 * `tab.hidden` — Page Visibility API: tab moved to background.
 *
 * @example { type: 'tab.hidden', payload: { visible_for_ms: 33000 } }
 */
export const TabHiddenPayloadSchema = z.object({
  visible_for_ms: z.number().int().nonnegative().optional(),
});
export const TabHiddenEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('tab.hidden'),
  payload: TabHiddenPayloadSchema,
});
export type TabHiddenEvent = z.infer<typeof TabHiddenEventSchema>;
