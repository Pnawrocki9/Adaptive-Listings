/**
 * Sidebar widget interaction events. Emitted by the Tier 1 Observer sidebar UI.
 *
 * @module @estalara/shared/schemas/events/sidebar
 */

import { z } from 'zod';

import { EventEnvelopeBaseSchema } from '../event.js';

/**
 * `sidebar.closed` — the user explicitly closed the Tier 1 Observer sidebar widget.
 *
 * Emitted by: packages/sdk/src/index.ts (sidebar onClose callback)
 *
 * Payload is intentionally empty — no identifiable data is attached.
 *
 * @example { type: 'sidebar.closed', payload: {} }
 */
export const SidebarClosedPayloadSchema = z.object({}).strict();
export const SidebarClosedEventSchema = EventEnvelopeBaseSchema.extend({
  type: z.literal('sidebar.closed'),
  payload: SidebarClosedPayloadSchema,
});
export type SidebarClosedEvent = z.infer<typeof SidebarClosedEventSchema>;
export type SidebarClosedPayload = z.infer<typeof SidebarClosedPayloadSchema>;
