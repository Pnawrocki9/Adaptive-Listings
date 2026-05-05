/**
 * Device / context events. Master Design C.1 row 10.
 *
 * Throughput: 1 per session (emitted once at session start).
 *
 * @module @estalara/shared/schemas/events/device-context
 */

import { z } from 'zod';

import { EventEnvelopeBaseSchema } from '../event.js';
import { DeviceClassSchema, ViewportSchema } from './page-lifecycle.js';

/**
 * `session.started` — emitted once at the start of a session. Captures device class, viewport,
 * language, IP-derived country/city (server-side annotation), and time-of-day bucket.
 *
 * IP-derived `country` / `city` are populated server-side by the ingest worker, not by the SDK.
 * The SDK MAY populate them as `undefined`; the ingest worker fills them from CF-IPCountry headers.
 *
 * @example
 * {
 *   type: 'session.started',
 *   payload: {
 *     device_class: 'desktop',
 *     viewport: { width: 1440, height: 900 },
 *     language: 'en-GB',
 *     country: 'ES',
 *     city: 'Marbella',
 *     time_of_day: 'evening'
 *   }
 * }
 */
export const SessionStartedPayloadSchema = z.object({
  device_class: DeviceClassSchema,
  viewport: ViewportSchema,
  language: z.string().min(2).max(10),
  country: z
    .string()
    .length(2)
    .regex(/^[A-Z]{2}$/)
    .optional(),
  city: z.string().optional(),
  time_of_day: z.enum(['night', 'morning', 'afternoon', 'evening']).optional(),
  timezone_offset_minutes: z.number().int().optional(),
  user_agent_class: z.string().optional(),
});
export const SessionStartedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('session.started'),
  payload: SessionStartedPayloadSchema,
});
export type SessionStartedEvent = z.infer<typeof SessionStartedEventSchema>;
